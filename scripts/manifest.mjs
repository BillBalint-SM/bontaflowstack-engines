import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(!fs.existsSync(chromium.executablePath()))throw new Error('Install Chromium before generating the engine manifest');
const files=Object.fromEntries(fs.readdirSync(path.join(root,'src')).filter(name=>name.endsWith('.mjs')).map(name=>['src/'+name,hash(path.join(root,'src',name))]));
const browserRequired=['node_modules/playwright/package.json',path.relative(root,chromium.executablePath()).replaceAll('\\','/')];
const command=(entry,requires=[],extra={})=>({program:'node',args:['src/'+entry+'.mjs'],requires:[...Object.keys(files),...requires],...extra});
const commands={
  browser:command('browser',browserRequired),
  render:command('render',browserRequired),
  design:command('design'),
  'design-md':command('external',[],{args:['src/external.mjs','design-md'],environment:'BFS_DESIGN_MD_COMMAND'}),
  'design-detect':command('external',[],{args:['src/external.mjs','design-detect'],environment:'BFS_IMPECCABLE_COMMAND'}),
  pretext:{resource:'node_modules/@chenglou/pretext/dist/layout.js',requires:['node_modules/@chenglou/pretext/LICENSE']}
};
const manifest={schema:1,name:'bontaflowstack-engines',version:pkg.version,platform:'win32-x64',browserDirectory:'.browsers',commands,files};
fs.writeFileSync(path.join(root,'engine.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({manifest:path.join(root,'engine.json'),sha256:hash(path.join(root,'engine.json')),commands:Object.keys(commands)}));
