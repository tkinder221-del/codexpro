import fs from "node:fs/promises";
import path from "node:path";

const FILES = ["README.md", "PROJECTS.md", "DECISIONS.md", "TASKS.md", "INCIDENTS.md", "SERVICES.md", "DATABASES.md"] as const;
const TARGETS = { task: "TASKS.md", decision: "DECISIONS.md", incident: "INCIDENTS.md" } as const;
const SECRET = /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|authorization|secret)\s*[:=]\s*[^\s#]+|(?:sk-proj|ghp_|github_pat_|AKIA)[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{10,}/i;
const MAX_BYTES = 128 * 1024;

function memoryDir(root: string): string {
  return path.join(root, "codexpro-knowledge");
}
async function safeRead(root: string, file: string): Promise<string | null> {
  const dir = memoryDir(root);
  const p = path.join(dir, file);
  try {
    const stat = await fs.lstat(p);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return null;
    const content = await fs.readFile(p, "utf8");
    if (content.includes("\0") || SECRET.test(content)) return null;
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function knowledgeStatus(root: string) {
  const files = [];
  for (const name of FILES) if (await safeRead(root, name) !== null) files.push(name);
  return { root, memory_directory: memoryDir(root), readable_files: files, count: files.length, search_type: "bounded keyword search", note: "Local curated notes only; no database access or automatic embeddings." };
}
export async function knowledgeSearch(root: string, query: string, limit = 10) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || query.length > 200) throw new Error("Query must contain 1-200 characters");
  const matches: Array<{ file: string; line: number; excerpt: string }> = [];
  for (const file of FILES) {
    const text = await safeRead(root, file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (words.every((word) => lines[i].toLowerCase().includes(word))) {
        matches.push({ file, line: i + 1, excerpt: lines[i].slice(0, 350) });
        if (matches.length >= limit) return matches;
      }
    }
  }
  return matches;
}
export async function knowledgeRemember(root: string, kind: keyof typeof TARGETS, text: string) {
  const message = text.trim();
  if (!message || message.length > 1000 || /[\r\n]/.test(message) || SECRET.test(message)) throw new Error("Invalid note or possible secret");
  const dir = memoryDir(root);
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Memory directory must be a real directory");
  const file = TARGETS[kind];
  const dest = path.join(dir, file);
  try {
    const existing = await fs.lstat(dest);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size > MAX_BYTES) throw new Error("Unsafe memory file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const stamp = new Date().toISOString();
  const handle = await fs.open(dest, "a", 0o600);
  try {
    await handle.writeFile(`\n- ${stamp} | ${kind} | ${message}\n`);
  } finally {
    await handle.close();
  }
  return { file, timestamp: stamp, written: true };
}
