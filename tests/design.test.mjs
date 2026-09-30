import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { design } from '../src/design.mjs';
import { externalConfiguration } from '../src/external.mjs';
import { writeJson } from '../src/common.mjs';

test('comparison does not invent a choice and selection binds the chosen image',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bfs-own-design-'));
  const image=path.join(root,'direction.png'),board=path.join(root,'board.html');
  fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
  assert.equal(design(['compare','--images',image,'--output',board]).selection,null);
  assert.equal(design(['selection','--board',board]),null);
  const chosen=design(['select','--board',board,'--index','1','--reason','User chose direction 1']);
  assert.equal(chosen.selected.path,image);
  assert.deepEqual(design(['selection','--board',board]),chosen);
  fs.appendFileSync(image,'changed');
  assert.throws(()=>design(['select','--board',board,'--index','1','--reason','Previous choice']),/changed/);
  assert.throws(()=>design(['selection','--board',board]),/changed/);
});

test('regenerated comparisons invalidate choices and old selection files are checked',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bfs-design-regeneration-'));
  const first=path.join(root,'first.png'),second=path.join(root,'second.png'),board=path.join(root,'board.html');
  fs.writeFileSync(first,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
  fs.copyFileSync(first,second);
  for(const args of [ ['compare','--images',second],['gallery','--designs-dir',root],['diff','--before',first,'--after',second] ]) {
    design(['compare','--images',first,'--output',board]);
    design(['select','--board',board,'--index','1','--reason','Fixture user chose direction 1']);
    design([...args,'--output',board]);
    assert.equal(design(['selection','--board',board]),null,args[0]);
  }
  design(['compare','--images',first,'--output',board]);
  const old=design(['select','--board',board,'--index','1','--reason','Fixture user chose direction 1']);
  design(['compare','--images',second,'--output',board]);
  writeJson(`${board}.selection.json`,old);
  assert.throws(()=>design(['selection','--board',board]),/changed/);
  const fresh=design(['select','--board',board,'--index','1','--reason','Fixture user chose the new direction']);
  assert.deepEqual(design(['selection','--board',board]),fresh);
  writeJson(`${board}.selection.json`,{schema:1});
  assert.throws(()=>design(['selection','--board',board]),/Invalid/);
});

test('optional tools require explicit executable configuration and never install themselves',()=>{
  assert.throws(()=>externalConfiguration('design-md',{}),/Install the external tool/);
  assert.throws(()=>externalConfiguration('design-detect',{BFS_IMPECCABLE_COMMAND:'["relative.exe"]'}),/absolute/);
  const setting=JSON.stringify([process.execPath,'external-tool.mjs']);
  assert.equal(externalConfiguration('design-md',{BFS_DESIGN_MD_COMMAND:setting}).command[0],process.execPath);
});

test('failed session replacement retains the previous saved bytes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bfs-own-state-')), file=path.join(root,'session.json');
  writeJson(file,{selected:1});const before=fs.readFileSync(file,'utf8');
  t.mock.method(fs,'renameSync',()=>{throw new Error('Injected disk failure');});
  assert.throws(()=>writeJson(file,{selected:2}),/disk failure/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
});
