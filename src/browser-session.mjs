import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ensure, noLinks, readJson, writeJson, webUrl, outputFile } from './common.mjs';

export class BrowserSession {
  constructor(chromium, folder) {
    this.chromium=chromium; this.folder=folder; this.context=null; this.current=null;
    const identity=createHash('sha256').update(path.resolve(folder).toLowerCase()).digest('hex');
    this.profile=path.join(os.homedir(),'.bontaflowstack','browser-profiles',identity);
    noLinks(this.profile);
    this.visible=false; this.refs=new Map(); this.serial=0; this.logs={console:[],network:[],dialog:[]};
    this.dialogChoice={accept:false}; this.userAgent=undefined; this.extraHTTPHeaders={};
  }
  pages() { return this.context?.pages().filter(p=>!p.isClosed()) || []; }
  log(kind,item) {
    this.logs[kind].push({...item,time:new Date().toISOString()});
    // ponytail: retain the latest 200 entries; use a streamed report for long traces.
    if(this.logs[kind].length>200)this.logs[kind].shift();
  }
  attach(page) {
    page.on('console',message=>this.log('console',{level:message.type(),text:message.text()}));
    page.on('pageerror',error=>this.log('console',{level:'error',text:error.message}));
    page.on('response',response=>{
      const url=new URL(response.url()); url.search=''; url.hash='';
      this.log('network',{url:url.href,status:response.status(),method:response.request().method()});
    });
    page.on('dialog',dialog=>{
      this.log('dialog',{type:dialog.type(),message:dialog.message(),action:this.dialogChoice.accept?'accepted':'dismissed'});
      const choice=this.dialogChoice; this.dialogChoice={accept:false};
      (choice.accept?dialog.accept(choice.text):dialog.dismiss()).catch(()=>{});
    });
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())this.refs.clear();});
  }
  async launch(visible=this.visible) {
    this.visible=visible;
    // Chromium's Windows profile creation rejects deeply nested state paths.
    this.context=await this.chromium.launchPersistentContext(this.profile,{
      headless:!visible,chromiumSandbox:true,viewport:{width:1280,height:800},userAgent:this.userAgent,extraHTTPHeaders:this.extraHTTPHeaders,
      acceptDownloads:true,downloadsPath:path.join(this.folder,'downloads')
    });
    this.context.setDefaultTimeout(15000); this.context.setDefaultNavigationTimeout(25000);
    this.context.on('page',page=>this.attach(page)); this.pages().forEach(page=>this.attach(page));
    this.current=this.pages()[0] || await this.context.newPage();
    const saved=readJson(path.join(this.folder,'tabs.json'));
    if(saved?.tabs?.length)await this.restore(saved);
  }
  async save() {
    if(!this.context)return;
    const tabs=[];
    for(const page of this.pages()) {
      const data=await page.evaluate(()=>({session:Object.fromEntries(Object.entries(sessionStorage)),scroll:[scrollX,scrollY]})).catch(()=>({session:{},scroll:[0,0]}));
      tabs.push({url:page.url(),...data});
    }
    writeJson(path.join(this.folder,'tabs.json'),{schema:1,selected:Math.max(0,this.pages().indexOf(this.current)),tabs});
  }
  async restore(saved) {
    const pages=this.pages();
    for(let i=0;i<saved.tabs.length;i++) {
      const item=saved.tabs[i], page=pages[i] || await this.context.newPage();
      if(item.url==='about:blank')continue;
      const url=webUrl(item.url);
      await page.addInitScript(({origin,values})=>{if(location.origin===origin)for(const [key,value] of Object.entries(values))sessionStorage.setItem(key,value);},{origin:new URL(url).origin,values:item.session || {}});
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.evaluate(([x,y])=>scrollTo(x,y),item.scroll || [0,0]);
    }
    this.current=this.pages()[saved.selected] || this.pages()[0];
  }
  async close() {
    if(!this.context)return;
    await this.save(); const context=this.context; this.context=null; this.current=null; this.refs.clear(); await context.close();
  }
  async switchVisible() {
    if(!this.visible) { await this.close(); await this.launch(true); }
    await this.current.bringToFront();
  }
  locate(value) {
    ensure(value,'A selector is required');
    if(value.startsWith('@')) {
      const reference=this.refs.get(value);
      ensure(reference && reference.page===this.current,'Stale element reference; take a new snapshot');
      return this.current.locator(`[data-bfs-ref="${reference.id}"]`);
    }
    return this.current.locator(value);
  }
  async snapshot(args) {
    const index=args.indexOf('-s'), selector=index>=0?args[index+1]:'body';
    ensure(selector,'Snapshot -s requires a selector');
    this.refs.clear(); const prefix=`bfs${++this.serial}-`;
    const interactive=await this.current.locator(selector).evaluate((root,prefix)=>{
      const nodes=[...root.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]')];
      return nodes.filter(el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden').slice(0,1000).map((el,index)=>{
        const id=prefix+(index+1); el.setAttribute('data-bfs-ref',id);
        return {id,tag:el.tagName.toLowerCase(),name:(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('name') || '').trim().slice(0,300),disabled:el.matches(':disabled')};
      });
    },prefix);
    const lines=interactive.map((row,i)=>{const ref=`@e${i+1}`;this.refs.set(ref,{id:row.id,page:this.current});return `${ref} ${row.tag} ${JSON.stringify(row.name)}${row.disabled?' disabled':''}`;});
    const tree=args.includes('-i')?'':await this.current.locator(selector).ariaSnapshot();
    return `${this.current.url()}\n${tree}\n${lines.join('\n')}`.trim();
  }
  async run(args,cwd,stdin) {
    const [action,...rest]=args;
    if(action==='stop'){await this.close();return 'Server stopped';}
    if(!this.context)await this.launch(['connect','handoff'].includes(action));
    if(!this.current || this.current.isClosed())this.current=this.pages()[0] || await this.context.newPage();
    const page=this.current, first=rest[0];
    switch(action) {
      case 'goto': await page.goto(webUrl(first),{waitUntil:'domcontentloaded'}); return {url:page.url(),title:await page.title()};
      case 'back': await page.goBack({waitUntil:'domcontentloaded'});return page.url();
      case 'forward': await page.goForward({waitUntil:'domcontentloaded'});return page.url();
      case 'reload': await page.reload({waitUntil:'domcontentloaded'});return page.url();
      case 'url': return page.url();
      case 'snapshot': return this.snapshot(rest);
      case 'accessibility': return page.locator('body').ariaSnapshot();
      case 'text': return this.locate(first || 'body').innerText();
      case 'html': return first?this.locate(first).evaluate(el=>el.outerHTML):page.content();
      case 'links': return page.locator('a[href]').evaluateAll(nodes=>nodes.map(el=>({text:el.innerText,url:el.href})));
      case 'forms': return page.locator('form').evaluateAll(nodes=>nodes.map(form=>({action:form.action,method:form.method,fields:[...form.elements].map(el=>({name:el.name,type:el.type,required:el.required}))})));
      case 'data': return page.locator('table').evaluateAll(tables=>tables.map(table=>[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent.trim()))));
      case 'click': await this.locate(first).click();this.refs.clear();return {clicked:first};
      case 'fill': ensure(rest.length>=2,'fill requires selector and value');await this.locate(first).fill(rest[1]);return {filled:first};
      case 'select': await this.locate(first).selectOption(rest.slice(1));return {selected:first};
      case 'hover': await this.locate(first).hover();return {hovered:first};
      case 'type': ensure(first!==undefined,'type requires text');await page.keyboard.insertText(rest.join(' '));return {typed:true};
      case 'press': ensure(first,'press requires a key');await page.keyboard.press(first);return {pressed:first};
      case 'scroll':
        if(rest.length===2 && rest.every(v=>Number.isFinite(Number(v))))await page.mouse.wheel(Number(first),Number(rest[1]));
        else if(first)await this.locate(first).scrollIntoViewIfNeeded();
        else await page.mouse.wheel(0,600);
        return {scrolled:true};
      case 'wait':
        if(first==='--networkidle')await page.waitForLoadState('networkidle');
        else if(first==='--load')await page.waitForLoadState('load');
        else await this.locate(first).waitFor();return {ready:true};
      case 'viewport': {
        const match=/^(\d+)x(\d+)$/.exec(first || '');ensure(match,'Use widthxheight');
        const width=Number(match[1]),height=Number(match[2]);ensure(width>=100 && height>=100 && width<=8192 && height<=8192,'Viewport is outside 100..8192');
        await page.setViewportSize({width,height});return {width,height};
      }
      case 'upload': {
        const files=rest.slice(1).map(file=>path.resolve(cwd,file));ensure(files.length && files.every(file=>fs.statSync(file).isFile()),'Select existing upload files');
        await this.locate(first).setInputFiles(files);return {uploaded:files.length};
      }
      case 'js': ensure(first,'js requires an expression');return page.evaluate(rest.join(' '));
      case 'eval': return page.evaluate(fs.readFileSync(path.resolve(cwd,first),'utf8'));
      case 'css': return this.locate(first).evaluate((el,property)=>getComputedStyle(el).getPropertyValue(property),rest[1]);
      case 'attrs': return this.locate(first).evaluate(el=>Object.fromEntries([...el.attributes].map(a=>[a.name,a.value])));
      case 'is': {
        const methods={visible:'isVisible',hidden:'isHidden',enabled:'isEnabled',disabled:'isDisabled',checked:'isChecked',editable:'isEditable'};
        if(first==='focused')return this.locate(rest[1]).evaluate(el=>el===document.activeElement);
        ensure(methods[first],'Unknown element state');return this.locate(rest[1])[methods[first]]();
      }
      case 'console': case 'network': case 'dialog': {
        let result=[...this.logs[action]];
        if(rest.includes('--clear'))this.logs[action]=[];
        if(rest.includes('--errors'))result=result.filter(row=>row.level==='error');return result;
      }
      case 'dialog-accept': this.dialogChoice={accept:true,text:first};return {nextDialog:'accept'};
      case 'dialog-dismiss': this.dialogChoice={accept:false};return {nextDialog:'dismiss'};
      case 'cookies': return this.context.cookies(page.url());
      case 'storage':
        if(first==='set'){ensure(rest.length===3,'storage set requires key and value');await page.evaluate(([key,value])=>localStorage.setItem(key,value),rest.slice(1));return {stored:rest[1]};}
        return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
      case 'cookie': {
        const split=first?.indexOf('=');ensure(split>0,'Use name=value');await this.context.addCookies([{name:first.slice(0,split),value:first.slice(split+1),url:page.url()}]);return {stored:first.slice(0,split)};
      }
      case 'header': {
        const split=first?.indexOf(':');ensure(split>0,'Use name:value');
        const headers={[first.slice(0,split).trim()]:first.slice(split+1).trim()};
        await this.context.setExtraHTTPHeaders(headers);this.extraHTTPHeaders=headers;return {header:first.slice(0,split)};
      }
      case 'useragent': this.userAgent=rest.join(' ');await this.close();await this.launch();return {userAgent:this.userAgent};
      case 'perf': return page.evaluate(async()=>{
        let lcp=null;
        const observer=new PerformanceObserver(list=>{const entries=list.getEntries();if(entries.length)lcp=entries.at(-1).startTime;});
        try {observer.observe({type:'largest-contentful-paint',buffered:true});await new Promise(resolve=>setTimeout(resolve,100));}catch{}finally{observer.disconnect();}
        return {url:location.href,navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),paint:performance.getEntriesByType('paint').map(e=>e.toJSON()),resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),largestContentfulPaint:lcp};
      });
      case 'screenshot': {
        const selectorIndex=rest.indexOf('--selector'), selected=selectorIndex>=0?rest[selectorIndex+1]:null;
        const destination=rest.find((x,i)=>!x.startsWith('--') && (selectorIndex<0 || i!==selectorIndex+1)) || 'screenshot.png';
        const file=outputFile(cwd,destination);
        if(selected)await this.locate(selected).screenshot({path:file});else await page.screenshot({path:file,fullPage:!rest.includes('--viewport')});
        return {path:file};
      }
      case 'pdf': {const file=outputFile(cwd,first || 'page.pdf');await page.pdf({path:file,printBackground:true});return {path:file};}
      case 'responsive': {
        const original=page.viewportSize(),files=[];
        try {for(const width of [375,768,1440]){await page.setViewportSize({width,height:900});const file=outputFile(cwd,`${first || 'responsive'}-${width}.png`);await page.screenshot({path:file,fullPage:true});files.push(file);}}
        finally{if(original)await page.setViewportSize(original);}return files;
      }
      case 'tabs': return Promise.all(this.pages().map(async(p,i)=>({id:String(i+1),url:p.url(),title:await p.title(),selected:p===this.current})));
      case 'newtab': this.current=await this.context.newPage();if(first)await this.current.goto(webUrl(first),{waitUntil:'domcontentloaded'});this.refs.clear();return {url:this.current.url(),id:String(this.pages().indexOf(this.current)+1)};
      case 'tab': ensure(this.pages()[Number(first)-1],'Unknown tab');this.current=this.pages()[Number(first)-1];this.refs.clear();return {url:this.current.url()};
      case 'closetab': {const target=first?this.pages()[Number(first)-1]:page;ensure(target,'Unknown tab');await target.close();this.current=this.pages()[0] || await this.context.newPage();this.refs.clear();return {closed:true};}
      case 'handoff': case 'connect': await this.switchVisible();if(action==='connect' && first)await this.current.goto(webUrl(first),{waitUntil:'domcontentloaded'});return {visible:true,url:this.current.url(),message:action==='handoff'?rest.join(' '):'Browser ready'};
      case 'resume': await this.save();return this.snapshot([]);
      case 'restart': await this.close();await this.launch();return {restarted:true,url:this.current.url()};
      case 'chain': {
        const commands=JSON.parse(stdin);ensure(Array.isArray(commands) && commands.length<=50 && commands.every(c=>Array.isArray(c) && c.every(x=>typeof x==='string') && !['chain','stop'].includes(c[0])),'Use at most 50 command arrays, excluding chain and stop');
        const results=[];for(const command of commands)results.push(await this.run(command,cwd));return results;
      }
      case 'diff': {
        ensure(rest.length===2,'diff requires two URLs');const samples=[];
        for(const url of rest){const temp=await this.context.newPage();try{await temp.goto(webUrl(url),{waitUntil:'domcontentloaded'});samples.push((await temp.locator('body').innerText()).split('\n'));}finally{await temp.close();}}
        return {removed:samples[0].filter(line=>!samples[1].includes(line)),added:samples[1].filter(line=>!samples[0].includes(line))};
      }
      default: throw new Error(`Unknown browser command: ${action}`);
    }
  }
}
