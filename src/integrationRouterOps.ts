import fs from "node:fs/promises";
import path from "node:path";
import type { Workspace } from "./guard.js";
import type { CodexProConfig } from "./config.js";
import { codexproInventory } from "./capabilitiesOps.js";

const SECRET = /(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+|-----BEGIN .*PRIVATE KEY-----|(?:sk-proj|ghp_|github_pat_)[a-z0-9_-]{12,}/i;
function validate(text: string, max: number): string {
  const value=text.trim();
  if (!value || value.length>max || /[\r\n\0]/.test(value) || SECRET.test(value)) throw new Error("Invalid text or possible credential");
  return value;
}
function historyFile(root:string){return path.join(root,".codexpro","integration-usage.jsonl");}
async function history(root:string){
  try {
    const file=historyFile(root), st=await fs.lstat(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>2_000_000)return [];
    return (await fs.readFile(file,"utf8")).split("\n").filter(Boolean).slice(-500).flatMap(line=>{try{const v=JSON.parse(line);return typeof v.task==="string"&&Array.isArray(v.integrations)?[v]:[]}catch{return []}});
  }catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}
}
export async function integrationPlan(config:CodexProConfig,workspace:Workspace,task:string){
  const clean=validate(task,300);
  const inv=await codexproInventory(config,workspace,{includeGlobalSkills:false,includeMcpServers:true,maxSkills:1});
  const logs=await history(workspace.root);
  const words=new Set(clean.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]);
  const matches=inv.mcpServers.map(server=>{
    const name=server.name.toLowerCase();
    const tokens=name.split(/[-_.\s]+/).filter(Boolean);
    const relevance=tokens.filter(t=>words.has(t)||[...words].some(w=>w.includes(t)&&t.length>=4)).length*4;
    const remembered=logs.filter(l=>l.outcome==="success"&&l.integrations.includes(server.name)&&[...words].some(w=>l.task.toLowerCase().includes(w))).length;
    return {...server,score:relevance+Math.min(remembered,4)*2,previous_successes:remembered};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8);
  return {task:clean,discovered_server_count:inv.mcpServers.length,recommended:matches,history_entries:logs.length,
    execution:"not_executed",guidance:"Only discovered MCP server names are suggested. A server name is not a connection or authorization. Use the host's separately connected plugin tools to execute steps, and record only verified outcomes. Do not forward credentials or cross-service private data without authorization."};
}
export async function integrationRecord(config:CodexProConfig,workspace:Workspace,task:string,integrations:string[],outcome:"success"|"partial"|"failure"){
  const clean=validate(task,300);
  if(!integrations.length||integrations.length>12)throw new Error("Select 1-12 integrations");
  const inv=await codexproInventory(config,workspace,{includeGlobalSkills:false,includeMcpServers:true,maxSkills:1});
  const names=new Set(inv.mcpServers.map(s=>s.name));
  for(const name of integrations)if(!names.has(name))throw new Error("Integration not in discovered MCP inventory: "+name);
  const record={task:clean,integrations:[...new Set(integrations)],outcome,at:new Date().toISOString()};
  const file=historyFile(workspace.root);
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const fh=await fs.open(file,"a",0o600);
  try{await fh.writeFile(JSON.stringify(record)+"\n");}finally{await fh.close();}
  return record;
}
