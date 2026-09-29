import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensure, fail } from './common.mjs';

const descriptions={
  'design-md':{variable:'BFS_DESIGN_MD_COMMAND',url:'https://github.com/google-labs-code/design.md'},
  'design-detect':{variable:'BFS_IMPECCABLE_COMMAND',url:'https://github.com/pbakaus/impeccable'}
};
export function externalConfiguration(capability,env=process.env) {
  const entry=descriptions[capability];ensure(entry,'Unknown external capability');
  const value=env[entry.variable];
  ensure(value,`Install the external tool from ${entry.url} and set ${entry.variable} to its executable argument array in JSON`);
  const command=JSON.parse(value);
  ensure(Array.isArray(command) && command.length && command.every(x=>typeof x==='string' && !x.includes('\0')),'External command must be a JSON array of strings');
  ensure(path.isAbsolute(command[0]) && fs.statSync(command[0]).isFile(),'External executable must be an existing absolute path');
  ensure(!/\.(cmd|bat|ps1)$/i.test(command[0]),'Use the actual executable, or node.exe followed by the installed CLI JavaScript path');
  return {entry,command};
}
export function external(capability,args) {
  const {command}=externalConfiguration(capability);
  if(capability==='design-md') {
    if(args[0]==='check')args=['lint',...args.slice(1)];
    else if(args[0]==='tokens')args=['export','--format','dtcg',...args.slice(1)];
  }
  const result=spawnSync(command[0],[...command.slice(1),...args],{cwd:process.cwd(),windowsHide:true,shell:false,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  if(result.error)throw result.error;
  process.stdout.write(result.stdout || '');process.stderr.write(result.stderr || '');
  process.exitCode=result.status ?? 1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{external(process.argv[2],process.argv.slice(3));}catch(error){fail(error);}
}
