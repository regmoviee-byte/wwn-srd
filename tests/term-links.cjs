/* Run: node tests/term-links.cjs [URL]. Requires Playwright; optionally set
   PLAYWRIGHT_MODULE and PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'regressions.json'),'utf8'));
let url=process.argv[2],browser,server;
const report={repo:fixtures.repo,regressions:[],languages:{},ui:[],errors:[]};
(async()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const rules=html.match(/<script[^>]*id="srd-data"[^>]*>([\s\S]*?)<\/script>/)[1];
 assert.equal(crypto.createHash('sha256').update(rules).digest('hex'),fixtures.rules_sha256,'Rules data changed');
 if(!url){server=require('http').createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port+'/';}
 report.url=url;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
 for(const c of fixtures.cases){
  const result=await page.evaluate(c=>{
   setLang(c.language);go(pageFor(c.source));
   const links=[...document.querySelectorAll('#view .term')].filter(el=>(el.closest('section.sub')?.id.slice(4)||cur)===c.source && el.textContent===c.text).map(el=>({key:el.dataset.term,...TERMS.get(el.dataset.term)}));
   const record=c.record_name ? [...TERMS.values()].find(t=>t.name.toLowerCase()===c.record_name.toLowerCase() && t.sec===c.target) : null;
   return{links,record,exists:byNum.has(c.source)};
  },c);
  assert(result.exists,c.id+' source missing');
  assert(result.links.every(t=>c.target && t.sec===c.target),c.id+' wrong generated link '+JSON.stringify(result.links));
  if(c.record_name){assert(result.record,c.id+' canonical definition missing');assert(result.record.def && result.record.def!==c.old_def,c.id+' stale popup');}
  if(c.positive)assert(result.links.length,c.id+' expected positive link');
  report.regressions.push({id:c.id,passed:true,links:result.links.map(t=>t.sec)});
 }
 for(const language of ['ru','en']){
  const result=await page.evaluate(language=>{
   setLang(language);const issues=[],counts={pages:0,links:0,popups:0,toc:0},covered=new Set();
   for(const p of PAGES){cur=p.n;const home=new Set([cur,...childrenOf(cur).map(s=>s.n)]);home.forEach(n=>covered.add(n));
    const linker=linkTerms;linkTerms=()=>{};drawPage();linkTerms=linker;
    const view=document.getElementById('view'),plain=view.textContent;linker(view,home);
    if(view.textContent!==plain)issues.push('Rendered rules text changed '+p.n);
    counts.pages++;
    const ids=[...view.querySelectorAll('[id]')].map(el=>el.id);
    if(ids.length!==new Set(ids).size)issues.push('Duplicate anchor '+p.n);
    for(const s of SECS.filter(s=>pageFor(s.n)===p.n && s.n!==p.n))if(!document.getElementById('sub-'+s.n))issues.push('Missing anchor '+s.n);
    for(const el of view.querySelectorAll('.term')){counts.links++;const rec=TERMS.get(el.dataset.term);if(!rec || !byNum.has(rec.sec) || !rec.def || home.has(rec.sec))issues.push('Bad link '+p.n);}
    for(const el of view.querySelectorAll('a[href^="#s="]')){counts.toc++;if(!byNum.has(el.hash.slice(3)))issues.push('Bad TOC '+el.hash);}
   }
   for(const [key,rec]of TERMS){const el=document.createElement('span');el.dataset.term=key;showTip(el);counts.popups++;if(document.querySelector('#tip [data-go]')?.dataset.go!==rec.sec || !document.querySelector('#tip .td')?.textContent)issues.push('Bad popup '+key);}
   hideTip();
   for(const s of SECS)if(!covered.has(s.n))issues.push('Unrendered '+s.n);
   for(const key of ['уровень 1','уровень 2','level 1','level 2'])if(TERMS.has(key))issues.push('Service label '+key);
   const synthetic={};for(const word of ['Фокусы','Фокусов','Кости травмы','Костей травмы','Кибердека','Сторона','Скрытую','Работая']){const el=document.createElement('p');el.textContent=word;cur='4.1.0';linkTerms(el,new Set());synthetic[word]=[...el.querySelectorAll('.term')].map(x=>TERMS.get(x.dataset.term).sec);}
   return{issues,counts,synthetic};
  },language);
  assert.deepEqual(result.issues,[],language+' full crawl failures');
  if(language==='ru'){
   assert(result.synthetic['Фокусы'].includes('1.6.0'));assert(result.synthetic['Фокусов'].includes('1.6.0'));
   assert.deepEqual(result.synthetic['Сторона'],[]);assert.deepEqual(result.synthetic['Скрытую'],[]);assert.deepEqual(result.synthetic['Работая'],[]);
  }
  report.languages[language]=result;
 }
 // Positive definitions: selected from the actual rule paragraph, not a generic intro.
 const definitions=await page.evaluate(repo=>{
  setLang('ru');const find=(name,sec)=>[...TERMS.values()].find(t=>t.name===name && (!sec||t.sec===sec))?.def||'';
  return repo==='cwn'?{hp:find('ПЗ'),strain:find('Системная нагрузка'),shock:find('Шок'),main:find('Основное действие'),move:find('Действие перемещения'),instant:find('Мгновенное действие')}:{art:find('Искусство'),asset:find('Актив'),wealth:find('Богатство'),main:find('Основное действие'),move:find('Действие перемещения'),instant:find('Мгновенное действие')};
 },fixtures.repo);
 if(fixtures.repo==='cwn'){assert.match(definitions.hp,/здоровья/i);assert.match(definitions.strain,/Системн/i);assert.match(definitions.shock,/промах/i);}else{assert.match(definitions.art,/Искусства —/);assert.match(definitions.asset,/важные ресурсы/);assert.match(definitions.wealth,/измеряется от 1 до 8/);}
 assert.match(definitions.main,/^Основные/);assert.match(definitions.move,/^Действия перемещения/);assert.match(definitions.instant,/^Мгновенные/);
 // Search covers the other language and navigates through the real controls.
 await page.evaluate(()=>{setLang('ru');go('intro')});await page.locator('#q').fill('Attributes');
 await page.locator('#rail [data-sec="1.1.0"]').click();assert.equal(await page.evaluate(()=>cur),'1.1.0');
 await page.locator('#q').fill('');report.ui.push('cross-language search');
 const english=fixtures.repo==='cwn'?{source:'1.6.0',key:'hp',target:'1.7.1'}:{source:'6.2.0',key:'wealth',target:'6.1.0'};
 await page.evaluate(s=>{setLang('en');go(s.source)},english);
 const englishLink=page.locator('#view .term[data-term="'+english.key+'"]').first();await englishLink.scrollIntoViewIfNeeded();await englishLink.hover();
 assert.equal(await page.locator('#tip [data-go]').getAttribute('data-go'),english.target);await page.locator('#tip .go').click();assert.equal(await page.evaluate(()=>location.hash),'#s='+english.target);report.ui.push('English desktop hover and Open section');
 const selected=fixtures.repo==='cwn'?{source:'4.1.0',key:'кибердек',target:'3.7.0'}:{source:'6.2.0',key:'богатство',target:'6.1.0'};
 await page.evaluate(s=>{setLang('ru');go(s.source)},selected);
 const link=page.locator('#view .term[data-term="'+selected.key+'"]').first();await link.scrollIntoViewIfNeeded();await link.hover();
 assert.equal(await page.locator('#tip [data-go]').getAttribute('data-go'),selected.target);await page.locator('#tip .go').click();
 assert.equal(await page.evaluate(()=>location.hash),'#s='+selected.target);report.ui.push('desktop hover and Open section');
 await page.goBack();assert.equal(await page.evaluate(()=>location.hash),'#s='+selected.source);await page.goForward();assert.equal(await page.evaluate(()=>location.hash),'#s='+selected.target);report.ui.push('back/forward');
 await page.evaluate(()=>go('1.5.2'));await page.locator('#lEn').click();
 assert.equal(await page.evaluate(()=>location.hash),'#s=1.5.2');assert(Math.abs(await page.locator('[id="sub-1.5.2"]').evaluate(el=>el.getBoundingClientRect().top))<200);report.ui.push('language switch preserves deep link');
 await page.reload();assert.equal(await page.evaluate(()=>lang),'en');assert.equal(await page.evaluate(()=>location.hash),'#s=1.5.2');report.ui.push('reload and language persistence');
 await page.evaluate(s=>{setLang('ru');go(s.source)},selected);await link.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>location.hash),'#s='+selected.target);report.ui.push('keyboard activation');
 for(const language of ['ru','en']){
  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});mobile.on('pageerror',e=>report.errors.push(e.message));await mobile.goto(url);
  const s=language==='ru'?selected:english;
  await mobile.evaluate(({s,language})=>{setLang(language);go(s.source)},{s,language});const m=mobile.locator('#view .term[data-term="'+s.key+'"]').first();await m.scrollIntoViewIfNeeded();await m.tap();
  assert.equal(await mobile.evaluate(()=>location.hash),'#s='+s.target);assert.equal(await mobile.locator('#tip').evaluate(el=>el.classList.contains('on')),false);
  await mobile.locator('#navBtn').click();assert.equal(await mobile.locator('#navBtn').getAttribute('aria-expanded'),'true');await mobile.locator('#rail [data-sec="1.1.0"]').click();assert.equal(await mobile.locator('#navBtn').getAttribute('aria-expanded'),'false');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.ui.push('mobile tap and navigation '+language);await mobile.close();
 }
 // Same cross-origin iframe contract used by the Tilda wrapper: size and scroll messages.
 const embed=await browser.newPage({viewport:{width:1200,height:900}});embed.on('pageerror',e=>report.errors.push(e.message));
 await embed.route('http://srd-embed.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Tilda wrapper test</title><script>window.events=[];addEventListener("message",e=>events.push(e.data))</script><iframe title="SRD" style="width:100%;height:700px;border:0"></iframe>'}));
 await embed.goto('http://srd-embed.test/');await embed.locator('iframe').evaluate((el,url)=>el.src=url,url);const frame=await(await embed.locator('iframe').elementHandle()).contentFrame();await frame.waitForSelector('#view h1');
 assert.equal(await frame.evaluate(()=>EMBED),true);await frame.evaluate(()=>go('1.1.2'));
 await embed.waitForFunction(()=>events.some(e=>e.height>0)&&events.some(e=>e.offset>0));assert.equal(await embed.title(),'Tilda wrapper test');report.ui.push('cross-origin iframe height and deep-link scroll');await embed.close();
 assert.deepEqual(report.errors,[],'Browser errors');await page.close();await browser.close();if(server)await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(report));
})().catch(async error=>{console.error(error);if(browser)await browser.close();if(server)server.close();process.exitCode=1});
