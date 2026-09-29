import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { browser, request, sessionFile } from '../src/browser.mjs';
import { readJson } from '../src/common.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'bfs-own-browser-'));
process.env.BFS_ENGINE_SESSION=path.join(root,'session');
const html=`<!doctype html><html lang="en"><title>Engine test</title><h1>Own browser</h1><button id="button" onclick="document.querySelector('#result').textContent='Done'">Choose offer</button><p id="result">Ready</p><input aria-label="Name" id="name"><select id="pick"><option>A</option><option>B</option></select><table><tr><td>Starter</td><td>19</td></tr></table><script>if(location.pathname==='/cookie')document.cookie='test=present; SameSite=Lax';</script></html>`;
const site=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(html);});
await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${site.address().port}`;
test('own browser supports scoped actions, auth, actual handoff and persistent state',async()=>{
  try {
    assert.match(await browser(['--help']),/BontaFlowStack/);
    await browser(['goto',url+'/cookie']);
    const snapshot=await browser(['snapshot','-i']);assert.match(snapshot,/@e1 button "Choose offer"/);
    await browser(['click','@e1']);assert.match(await browser(['text']),/Done/);
    await assert.rejects(browser(['click','@e1']),/Stale/);
    await browser(['fill','#name','BontaFlow']);assert.equal(await browser(['js','document.querySelector("#name").value']),'BontaFlow');
    await browser(['select','#pick','B']);
    await browser(['js',"localStorage.setItem('local','kept');sessionStorage.setItem('session','kept')"]);
    const state=readJson(sessionFile());await assert.rejects(request({...state,token:'0'.repeat(64)},{args:['status']}),/Unauthorized/);
    await browser(['handoff','Native visible session']);
    assert.match(await browser(['resume']),/Own browser/);
    assert.equal(await browser(['js',"localStorage.getItem('local')"]),'kept');
    assert.equal(await browser(['js',"sessionStorage.getItem('session')"]),'kept');
    assert.ok((await browser(['cookies'])).some(item=>item.name==='test' && item.value==='present'));
    assert.deepEqual(await browser(['data']),[[['Starter','19']]]);
    const screenshot=path.join(root,'actual.png');await browser(['screenshot',screenshot]);assert.ok(fs.statSync(screenshot).size>100);
    const performance=await browser(['perf']);assert.equal(performance.navigation.length,1);
    await browser(['newtab',url+'/second']);assert.equal((await browser(['tabs'])).length,2);
    await browser(['stop']);
    await browser(['goto',url]);assert.equal(await browser(['js',"localStorage.getItem('local')"]),'kept');
    assert.equal((await browser(['tabs'])).length,2);
    assert.equal(fs.existsSync(path.join(root,'.gitignore')),false);
  } finally {
    await browser(['stop']).catch(()=>{});await new Promise(resolve=>site.close(resolve));
  }
});
