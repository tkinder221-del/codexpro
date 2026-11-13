import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { knowledgeStatus, knowledgeSearch, knowledgeRemember } from "../dist/knowledgeOps.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexpro-knowledge-test-"));
try {
  const dir = path.join(root, "codexpro-knowledge");
  await fs.mkdir(dir, { mode: 0o700 });
  await fs.writeFile(path.join(dir, "PROJECTS.md"), "# Example\nSafe project record\n");
  assert.equal((await knowledgeStatus(root)).count, 1);
  assert.equal((await knowledgeSearch(root, "project")).length, 1);
  await knowledgeRemember(root, "task", "Verified new project");
  assert.equal((await knowledgeSearch(root, "Verified")).length, 1);
  await assert.rejects(knowledgeRemember(root, "task", "password=abcdef123456"));
  await fs.writeFile(path.join(dir, "DECISIONS.md"), "api_key: secret12345\n");
  assert.equal((await knowledgeStatus(root)).count, 2);
  assert.equal((await knowledgeSearch(root, "secret12345")).length, 0);
  console.log("knowledge plugin smoke passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
