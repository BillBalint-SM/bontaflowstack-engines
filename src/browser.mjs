import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensure, noLinks, readJson, print, fail } from './common.mjs';

export const help = `BontaFlowStack browser
Navigation: goto <url>, back, forward, reload, url
Read: snapshot [-i] [-s selector], accessibility, text [selector], html [selector], links, forms, data
Actions: click <selector>, fill <selector> <value>, select <selector> <value>, hover <selector>, type <text>, press <key>, scroll [selector|x y], wait <selector|--load|--networkidle>, viewport <WxH>, upload <selector> <files...>
Inspect: js <expression>, eval <file>, css <selector> <property>, attrs <selector>, is <property> <selector>, console [--clear|--errors], network [--clear], dialog [--clear], cookies, storage [set <key> <value>], perf
Capture: screenshot [path] [--viewport] [--selector selector], pdf [path], responsive [prefix]
Tabs: tabs, newtab [url], tab <id>, closetab [id]
Session: status, connect [url], handoff [message], resume, stop, restart
Configuration: cookie <name=value>, header <name:value>, useragent <value>, dialog-accept [text], dialog-dismiss
Batch: chain (JSON arrays on stdin), diff <url1> <url2>
Selectors may use @e references from the latest snapshot. Refresh after navigation.
Only this task's browser and profile are managed. No saved automation commands.`;

export function sessionFile() {
  const folder = process.env.BFS_ENGINE_SESSION || (process.env.BROWSE_STATE_FILE && path.join(path.dirname(process.env.BROWSE_STATE_FILE), 'own-engine'));
  ensure(folder && path.isAbsolute(folder), 'BFS_ENGINE_SESSION must be an absolute task session path');
  const file = path.join(folder, 'browser-service.json'); noLinks(file); return file;
}
export function request(state, payload, timeout = 45000) {
  ensure(state?.schema === 1 && Number.isInteger(state.port) && state.port > 0 && state.port < 65536 && /^[a-f0-9]{64}$/.test(state.token), 'Invalid browser service record; preserve it and inspect the session');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({hostname:'127.0.0.1',port:state.port,path:'/',method:'POST',headers:{authorization:`Bearer ${state.token}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}}, res => {
      let result = '';
      res.on('data', chunk => { result += chunk; if (result.length > 16 * 1024 * 1024) req.destroy(new Error('Browser output exceeds 16 MiB')); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(result);
          ensure(parsed.instance === state.instance, 'Browser service identity mismatch');
          if (res.statusCode !== 200) { const error = new Error(parsed.error || 'Browser request rejected'); error.exitCode = 1; throw error; }
          resolve(parsed.result);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Browser response timed out; inspect state before repeating a mutating action')));
    req.on('error', reject); req.end(body);
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start(file) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const lock = `${file}.launch`; noLinks(lock);
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    for (let n=0;n<80;n++) {
      await delay(250);
      const state = readJson(file);
      if (state) { try { await request(state,{args:['status']},1000); return state; } catch {} }
    }
    throw new Error('Browser startup is already in progress or its launch lock needs inspection');
  }
  try {
    const log = fs.openSync(path.join(path.dirname(file),'startup.log'),'a',0o600);
    const child = spawn(process.execPath,[fileURLToPath(new URL('./browser-service.mjs',import.meta.url)),file],{detached:true,windowsHide:true,stdio:['ignore',log,log],env:process.env});
    fs.closeSync(log);
    let startupError; child.on('error',error => { startupError=error; }); child.unref();
    for (let n=0;n<120;n++) {
      if(startupError)throw startupError;
      await delay(250);
      const state = readJson(file);
      if(state?.pid === child.pid) { await request(state,{args:['status']},3000); return state; }
      if(child.exitCode !== null)throw new Error('Browser service stopped during startup; inspect startup.log');
    }
    throw new Error('Browser startup timed out; inspect startup.log before retrying');
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
export async function browser(args, cwd = process.cwd(), stdin) {
  if(!args.length || ['--help','help'].includes(args[0]))return help;
  const file = sessionFile(); let state = readJson(file);
  if(state) {
    try { await request(state,{args:['status']},2000); }
    catch(error) {
      let alive=true;
      try { process.kill(state.pid,0); } catch(probe) { if(probe.code==='ESRCH')alive=false; }
      ensure(!alive,`An existing browser service is unresponsive; no replacement was started. ${error.message}`);
      state=null;
    }
  }
  if(!state && args[0]==='stop')return {status:'stopped'};
  if(!state && args[0]==='status')return {status:'stopped'};
  state ||= await start(file);
  const result=await request(state,{args,cwd,stdin});
  if(args[0]==='stop') {
    for(let n=0;n<100 && readJson(file)?.instance===state.instance;n++)await delay(50);
    ensure(readJson(file)?.instance!==state.instance,'Browser accepted stop but is still shutting down; inspect it before restarting');
  }
  return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  browser(args,process.cwd(),args[0]==='chain'?fs.readFileSync(0,'utf8'):undefined).then(print).catch(fail);
}
