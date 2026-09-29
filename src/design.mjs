import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { options, ensure, imageData, escapeHtml, outputFile, writeJson, readJson, print, fail } from './common.mjs';

const help=`BontaFlowStack design
compare --images <file1.png,file2.png> --output <board.html> [--title title]
select --board <board.html> --index <1-based-number> --reason <user-choice>
selection --board <board.html>
gallery --designs-dir <directory> --output <board.html>
diff --before <image> --after <image> --output <comparison.html>
prompt --image <approved-image> [--brief text]
Image generation and editing use Codex's image generation tool through design-consultation.
This local tool needs no provider account or API key.`;
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function design(args,cwd=process.cwd()) {
  const [action,...parameters]=args;
  if(!action || ['help','--help'].includes(action))return help;
  const {values}=options(parameters);
  if(action==='selection')return readJson(path.resolve(cwd,`${values.board}.selection.json`));
  if(action==='select') {
    ensure(values.board && values.reason,'A board and the actual user choice are required');
    const board=path.resolve(cwd,values.board), metadata=readJson(`${board}.json`), index=Number(values.index)-1;
    ensure(metadata && Number.isInteger(index) && metadata.images[index],'Select an existing board image');
    const selected=metadata.images[index];
    ensure(sha(selected.path)===selected.sha256,'The selected image changed; regenerate the comparison before choosing');
    const result={schema:1,selected,reason:values.reason,chosenAt:new Date().toISOString()};
    writeJson(`${board}.selection.json`,result);return result;
  }
  if(action==='prompt') {
    const file=path.resolve(cwd,values.image || '');ensure(fs.statSync(file).isFile(),'An approved image is required');
    return {image:file,sha256:sha(file),brief:values.brief || '',instructions:'Read the approved image and brief. Identify layout, typography, colors, states and responsive behavior. Implement semantic project-native markup, then render desktop and narrow layouts and check keyboard operation. Treat unseen behavior as an explicit assumption.'};
  }
  let files=[];
  if(action==='compare') {ensure(typeof values.images==='string','Use --images with comma-separated image paths');files=values.images.split(',').map(file=>path.resolve(cwd,file.trim()));}
  else if(action==='gallery') {
    const folder=path.resolve(cwd,values['designs-dir'] || '');
    files=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)).map(e=>path.join(folder,e.name));
  } else if(action==='diff') {
    ensure(values.before && values.after,'Provide before and after images');files=[path.resolve(cwd,values.before),path.resolve(cwd,values.after)];
  } else throw new Error(`Unknown local design command: ${action}. Use the Codex image tool for generation or editing.`);
  ensure(files.length>0 && files.length<=24,'Use 1..24 images');
  const images=files.map(file=>({path:file,sha256:sha(file),data:imageData(file)}));
  const destination=outputFile(cwd,values.output || 'comparison.html'),title=values.title || 'Choose a design direction';
  const cards=images.map((item,index)=>`<label class="option"><input type="radio" name="direction" value="${index+1}"><span>Direction ${index+1} · ${escapeHtml(path.basename(item.path))}</span><img src="${item.data}" alt="Design direction ${index+1}"></label>`).join('\n');
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;padding:clamp(16px,4vw,56px);background:#f3f0eb;color:#202722;font:17px/1.5 system-ui}main{max-width:1440px;margin:auto}h1{font-size:clamp(28px,4vw,48px);line-height:1.1}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:24px}.option{display:block;padding:16px;background:white;border:2px solid #cbcfc8;border-radius:12px;cursor:pointer}.option:has(input:checked){border-color:#27613e;box-shadow:0 0 0 3px #cce6d2}.option:focus-within{outline:3px solid #c16825;outline-offset:4px}.option span{display:inline-block;margin-bottom:16px}img{display:block;width:100%;height:auto;border-radius:4px}input{accent-color:#27613e}button{font:inherit;padding:12px 20px;border:0;border-radius:8px;background:#27613e;color:white;margin-top:24px}button:disabled{opacity:.5}#result{min-height:1.5em}</style><main><h1>${escapeHtml(title)}</h1><p>Compare the images at their actual proportions. Select the direction to continue with.</p><div class="grid">${cards}</div><button id="save" disabled>Download selection</button><p id="result" aria-live="polite"></p></main><script>const button=document.querySelector('#save');document.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{button.disabled=false;document.querySelector('#result').textContent='Direction '+input.value+' selected';}));button.addEventListener('click',()=>{const index=Number(document.querySelector('input:checked').value);const blob=new Blob([JSON.stringify({direction:index,chosenAt:new Date().toISOString()},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='design-selection.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});</script></html>`;
  fs.writeFileSync(destination,html);
  writeJson(`${destination}.json`,{schema:1,images:images.map(({data,...item})=>item),createdAt:new Date().toISOString()});
  return {board:destination,images:files.length,selection:null,...(action==='diff'?{identical:images[0].sha256===images[1].sha256}: {})};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {print(design(process.argv.slice(2)));}catch(error){fail(error);}
}
