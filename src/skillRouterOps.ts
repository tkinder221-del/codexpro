import fs from "node:fs/promises";
import path from "node:path";
import type { Workspace } from "./guard.js";
import { discoverSkillInventory, loadSkill } from "./capabilitiesOps.js";

const MAX_LOG = 500;
const SECRET = /(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+|-----BEGIN .*PRIVATE KEY-----|(?:sk-proj|ghp_|github_pat_)[a-z0-9_-]{12,}/i;
function safeTask(task: string): string {
  const t = task.trim();
  if (!t || t.length > 300 || /[\r\n\0]/.test(t) || SECRET.test(t)) throw new Error("Invalid task or potential secret");
  return t;
}
function paths(root: string) {
  return { skills: path.join(root, ".agents", "skills"), history: path.join(root, ".codexpro", "skill-usage.jsonl") };
}
async function history(root: string): Promise<Array<{task:string;skill:string;outcome:string;at:string}>> {
  const file = paths(root).history;
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 2_000_000) return [];
    return (await fs.readFile(file,"utf8")).split("\n").filter(Boolean).slice(-MAX_LOG).flatMap(line=>{
      try { const o=JSON.parse(line); return typeof o.task==="string" && typeof o.skill==="string" ? [o] : []; } catch { return []; }
    });
  } catch(e) { if ((e as NodeJS.ErrnoException).code==="ENOENT") return []; throw e; }
}
export async function selectSkill(workspace: Workspace, task: string) {
  const t=safeTask(task).toLowerCase();
  const skills=await discoverSkillInventory(workspace,{includeGlobal:true,maxSkills:300});
  const logs=await history(workspace.root);
  const tokens=new Set(t.match(/[\p{L}\p{N}]{3,}/gu)??[]);
  const ranked=skills.map(skill=>{
    const label=(skill.name+" "+(skill.description??"")).toLowerCase();
    const matched=[...tokens].filter(token=>label.includes(token));
    const previous=logs.filter(l=>l.skill===skill.name && l.outcome==="success" && [...tokens].some(token=>l.task.toLowerCase().includes(token)));
    return {...skill,score:matched.length*3+Math.min(previous.length,5)*2,matched,previous_successes:previous.length};
  }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
  return {task, matches:ranked, suggestion:ranked.length?"load_skill and follow its instructions, then record result":"No matching skill. Review task and use skill_create only if a reusable workflow is justified.", history_entries:logs.length};
}
export async function createSkill(workspace: Workspace, name: string, description: string, instructions: string) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name) || name.includes("--")) throw new Error("Invalid skill name");
  if (!description.trim() || description.length>250 || !instructions.trim() || instructions.length>12000 || SECRET.test(description+" "+instructions)) throw new Error("Invalid instructions or possible secret");
  const dir=paths(workspace.root).skills;
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const target=path.join(dir,name);
  await fs.mkdir(target,{mode:0o700});
  const file=path.join(target,"SKILL.md");
  const body=`---\nname: ${name}\ndescription: ${description.replace(/[\r\n]/g," ")}\n---\n\n# ${name}\n\n${instructions.trim()}\n`;
  const handle=await fs.open(file,"wx",0o600);
  try {await handle.writeFile(body);} finally {await handle.close();}
  return {name,path:`.agents/skills/${name}/SKILL.md`,created:true};
}
export async function recordSkill(workspace: Workspace, task: string, skill: string, outcome: "success"|"failure"|"partial") {
  safeTask(task);
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(skill)) throw new Error("Invalid skill name");
  await loadSkill(workspace,{name:skill,includeGlobal:true});
  const file=paths(workspace.root).history;
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const record={task,skill,outcome,at:new Date().toISOString()};
  const fh=await fs.open(file,"a",0o600);
  try {await fh.writeFile(JSON.stringify(record)+"\n");} finally {await fh.close();}
  return record;
}
