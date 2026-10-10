import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {BrowserSession} from '../src/browser-session.mjs';

test('handoff retains session cookies before the server can issue replacements',async()=>{
  const requests=[];
  const server=http.createServer((req,res)=>{
    requests.push(req.headers.cookie || '');
    if(requests.length===1)res.setHeader('set-cookie',['plain=kept; Path=/','http=kept; HttpOnly; Path=/']);
    res.setHeader('content-type','text/html');res.end('<title>Cookie handoff</title><p>Own fixture</p>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bfs-session-cookie-'));
  const session=new BrowserSession(chromium,folder);
  try {
    await session.launch();await session.current.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal((await session.context.cookies()).length,2);
    const before=requests.length;await session.switchVisible();
    assert.match(requests[before],/plain=kept/);assert.match(requests[before],/http=kept/);
    assert.equal((await session.context.cookies()).length,2);
  } finally {await session.close();await new Promise(resolve=>server.close(resolve));}
});
