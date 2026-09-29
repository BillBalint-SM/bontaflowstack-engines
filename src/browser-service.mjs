import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { ensure, noLinks, writeJson, readJson } from './common.mjs';
import { BrowserSession } from './browser-session.mjs';

const file = path.resolve(process.argv[2]); noLinks(file);
const token = randomBytes(32).toString('hex'), instance = randomUUID();
const session = new BrowserSession(chromium, path.dirname(file));
let queue = Promise.resolve(), closing = false;
const server = http.createServer(async (req,res) => {
  const reply = (status,data) => {
    if(res.destroyed)return;
    res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(JSON.stringify({instance,...data}));
  };
  try {
    ensure(req.method==='POST' && req.url==='/' && !req.headers.origin && req.headers.authorization===`Bearer ${token}`,'Unauthorized local browser request');
    ensure(req.headers.host===`127.0.0.1:${server.address().port}`,'Invalid local host');
    let body='';
    for await(const part of req) { body+=part; ensure(body.length<=1024*1024,'Browser request exceeds 1 MiB'); }
    const input=JSON.parse(body);
    ensure(Array.isArray(input.args) && input.args.length && input.args.every(x=>typeof x==='string' && !x.includes('\0')),'Expected command arguments');
    if(input.args[0]==='status')return reply(200,{result:{status:closing?'stopping':'ready',pid:process.pid,instance,visible:session.visible,tabs:session.pages().length}});
    ensure(!closing,'Browser is shutting down');
    const cwd=input.cwd || process.cwd(); ensure(path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory(),'Invalid project directory');
    const perform=()=>session.run(input.args,cwd,input.stdin);
    const work=queue.then(perform); queue=work.catch(()=>{});
    const result=await work;
    reply(200,{result});
    if(input.args[0]==='stop') { closing=true; server.close(); server.closeIdleConnections(); }
  } catch(error) { reply(400,{error:error.message}); }
});
server.requestTimeout=45000;
server.headersTimeout=10000;
server.on('error',error=>{process.stderr.write(`Browser service: ${error.message}\n`);process.exitCode=1;});
async function close() {
  closing=true; await session.close(); server.close(); server.closeAllConnections();
}
process.on('SIGTERM',()=>close().catch(()=>{}));
process.on('SIGINT',()=>close().catch(()=>{}));
server.on('close',()=>{
  try { if(readJson(file)?.instance===instance)fs.unlinkSync(file); } catch {}
});
server.listen(0,'127.0.0.1',()=>writeJson(file,{schema:1,pid:process.pid,port:server.address().port,token,instance}));
