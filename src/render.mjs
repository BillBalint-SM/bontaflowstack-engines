import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { options, ensure, outputFile, webUrl, print, fail } from './common.mjs';

export async function render(args,cwd=process.cwd()) {
  if(args.includes('--help'))return 'render <file.html|url> --screenshot <file.png> [--width 1280] [--height 800] [--pdf file.pdf]';
  const {values,rest}=options(args), source=rest[0];ensure(source,'Provide a local HTML file or URL');
  const width=Number(values.width || 1280),height=Number(values.height || 800);
  ensure(Number.isInteger(width) && Number.isInteger(height) && width>=100 && height>=100 && width<=8192 && height<=8192,'Viewport must be 100..8192 pixels');
  const url=/^https?:/.test(source)?webUrl(source):pathToFileURL(path.resolve(cwd,source)).href;
  const browser=await chromium.launch({headless:true,chromiumSandbox:true}), errors=[];
  try {
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(url,{waitUntil:'load',timeout:30000});
    ensure(!response || response.ok(),`Page returned HTTP ${response?.status()}`);
    await page.evaluate(()=>document.fonts.ready);
    const screenshot=outputFile(cwd,values.screenshot || 'render.png');
    await page.screenshot({path:screenshot,fullPage:true});
    let pdf=null;
    if(values.pdf){pdf=outputFile(cwd,values.pdf);await page.pdf({path:pdf,printBackground:true});}
    const layout=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
    ensure(fs.statSync(screenshot).size>0,'Screenshot was not saved');
    return {status:'completed',source:url,screenshot,pdf,viewport:{width,height},horizontalOverflow:layout.content>layout.viewport,errors};
  } finally {await browser.close();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))render(process.argv.slice(2)).then(print).catch(fail);
