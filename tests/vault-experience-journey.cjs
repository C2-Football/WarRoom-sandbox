#!/usr/bin/env node
'use strict';
// Local browser evidence only. Fresh, disposable browser contexts; every network
// mutation is intercepted without transmission. No account, hosted room, or user's existing save is used.
// Run with the compiled server on3038 allowing vault-qa.test; Chrome resolves
// that test-only host to loopback. --webkit-smoke uses a loopback route adapter
// and the fixture produced by the main run. Optional PLAYWRIGHT_WEBKIT_PATH
// selects an installed WebKit runtime when Playwright's default is unavailable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/vault-experience');
const base = process.env.VAULT_QA_BASE || 'http://vault-qa.test:3038';
assert(['127.0.0.1','localhost','vault-qa.test'].includes(new URL(base).hostname), 'Only an isolated local preview is allowed');
fs.mkdirSync(output, { recursive: true });
global.window = globalThis; global.App = {};
for (const name of ['roster','helmet','rules','draft-room','era-rules','types','season','player-cards','engine','hidden-years','strategy','rivals','ai','actions','gamecast','player-stats','storage']) require('../js/shared/time-league-'+name+'.js');
const {TimeLeagueEngine:E,TimeLeagueAI:AI,TimeLeagueActions:A,TimeLeagueSeason:S,TimeLeagueStorage:Storage}=App;
const data = {
 cards: App.TimeLeaguePlayerCards.buildPlayerCardIndex(JSON.parse(fs.readFileSync(path.join(root,'data/time-league/player-cards.json'),'utf8'))),
 logIndex: S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync(path.join(root,'data/time-league/regular-season-game-logs.csv'),'utf8')).logs),
 eraFactors: new Map(),
};
const sizes = [[390,844],[430,932],[1024,1366],[1366,1024],[1440,900]];
const evidence={scope:'Local Chromium browser, disposable solo saves and bounded fixtures; no hosted writes or physical-device proof',checks:[],screenshots:[],blockedMutations:0,pageErrors:[],startedAt:new Date().toISOString()};
let browser;
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const read = page => page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1')||'null');return p?.leagueId?App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId))):null;});
const prefs = page => page.evaluate(()=>JSON.parse(localStorage.getItem('wr-time-league-ui-v1')||'null'));
async function context(options={}) {
 const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',serviceWorkers:'block',...options});
 await ctx.route('**/*',async route=>{try{
  const request=route.request();const cors={'access-control-allow-origin':request.headers().origin||new URL(base).origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']||'*'};if(request.method()==='OPTIONS')return route.fulfill({status:200,headers:cors,body:''});
  if(['POST','PUT','PATCH','DELETE'].includes(request.method())){evidence.blockedMutations++;if(new URL(request.url()).pathname==='/rest/v1/analytics_events')return route.fulfill({status:204,headers:cors,body:''});return route.fulfill({status:403,contentType:'application/json',headers:cors,body:'{"ok":false,"error":"Local fixture QA blocks network writes"}'});}
  if(browser.browserType().name()==='webkit'&&new URL(request.url()).hostname==='vault-qa.test'){const response=await route.fetch({url:request.url().replace('vault-qa.test','127.0.0.1')});return route.fulfill({response});}return route.continue();}catch(error){if(!/closed|disposed/i.test(error.message)){evidence.routeErrors??=[];evidence.routeErrors.push(error.message);}try{await route.abort();}catch{}}
 });
 ctx.on('page',page=>{page.setDefaultTimeout(30000);page.on('pageerror',error=>{evidence.rawPageErrors??=[];evidence.rawPageErrors.push(error.message);if(/analytics_events/.test(error.message)&&/access control checks/i.test(error.message)){evidence.expectedBlockedNetworkErrors??=[];evidence.expectedBlockedNetworkErrors.push(error.message);}else evidence.pageErrors.push(error.message);});});
 return ctx;
}
async function open(ctx){const page=await ctx.newPage();await page.goto(base+'/?vault=1',{waitUntil:'domcontentloaded'});return page;}
async function ready(page){await page.locator('.tl-root.tl-play').waitFor();await page.getByText('Loading player cards…',{exact:true}).waitFor({state:'hidden',timeout:60000});}
async function tab(page,id){
 const desktop=page.locator('.tl-sidenav .tl-tabbtn').filter({hasText:({home:'HOME',roster:'ROSTER',gameday:'GAMEDAY',messages:'MESSAGES',career:'MY PROFILE'})[id]});
 if(await desktop.first().isVisible())await desktop.first().click();
 else {
  const labels={home:'Home',roster:'Lineup',gameday:'Game Day',messages:'Messages',career:'My profile'};
  let button=page.locator('.tl-mobile-nav').getByRole('button',{name:labels[id],exact:true});
  if(!await button.count()){await page.locator('.tl-mobile-nav').getByRole('button',{name:/^More/}).click();button=page.getByRole('dialog',{name:'More Vault views'}).getByRole('button',{name:labels[id],exact:true});}
  await button.click();
 }
 await page.waitForFunction(id=>document.querySelector('.tl-root')?.dataset.vaultTab===id,id);
}
async function shot(page,stage,all=true){console.log('Capturing '+stage);
 const chosen=all?sizes:[[390,844],[1440,900]];
 for(const [width,height] of chosen){await page.setViewportSize({width,height});await wait(100);await page.evaluate(()=>scrollTo(0,0));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${stage} overflows at ${width}x${height}`);
  const file=`after-${stage}-${width}.png`;await page.screenshot({path:path.join(output,file),fullPage:true,animations:'disabled'});evidence.screenshots.push(file);
  const footer=page.locator('.tl-week-action-buttons .primary');
  if(await footer.isVisible())assert(await footer.evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.x>=-1&&r.right<=innerWidth+1;}),`${stage}: primary footer target not reachable at ${width}`);
 }
 await page.setViewportSize({width:1440,height:900});
}
async function gate(page,names){const b=page.locator('.tl-week-action-buttons').getByRole('button',{name:names,exact:true});await b.click();await wait(150);}
async function saveFixture(ctx,state,tabId='home'){
 const entries=[{leagueId:state.leagueId,name:state.name,phase:state.phase,teamCount:state.teams.length,currentWeek:state.currentWeek,createdAt:state.createdAt}];
 await ctx.addInitScript(({state,entries,tabId})=>{
  if(!['vault-qa.test','127.0.0.1','localhost'].includes(location.hostname))return;const key='qa-fixture-installed:'+state.leagueId;
  if(sessionStorage.getItem(key))return;
  localStorage.setItem('wr-time-leagues-v1',JSON.stringify(entries));localStorage.setItem('wr-time-league-v1:'+state.leagueId,JSON.stringify(state));localStorage.setItem('wr-time-league-ui-v1',JSON.stringify({leagueId:state.leagueId,tab:tabId,teamId:'t1',onlineRowId:null}));sessionStorage.setItem(key,'1');
 },{state,entries,tabId});
}
function act(state,action){return E.normalizeTimeLeague(A.applyOnlineAction(state,action,{seat_team_id:'t1',role:'commissioner'},data,'2026-10-21T00:00:00Z'));}
async function core(){
 const ctx=await context();let page;if(process.argv.includes('--resume-core')){await saveFixture(ctx,JSON.parse(fs.readFileSync(path.join(output,'drafted-fixture.json'),'utf8')),'home');page=await open(ctx);await ready(page);}else{page=await open(ctx);await page.getByText('Start your season',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>App.OD?.getCurrentUserId?.()||null),null,'Fresh local alias has no account identity');await page.getByRole('button',{name:'← BACK',exact:true}).click();await page.locator('.hub-experience-card.time-league-hero').click();await page.getByText('Start your season',{exact:true}).waitFor();evidence.checks.push('Direct guest entry, Back to Dynasty HQ hub, and hub Vault card reopen the same setup');await shot(page,'lobby');
 await page.getByRole('button',{name:/All-Era Classic/}).click();await page.getByLabel('Draft order mode',{exact:true}).selectOption('manual');await page.getByLabel('Draft clock duration',{exact:true}).selectOption('0');await page.getByLabel('AI draft pace',{exact:true}).selectOption('0.5');
 await page.getByPlaceholder('My Vault Season',{exact:true}).fill('Disposable QA season');await page.getByPlaceholder('Name your team',{exact:true}).fill('Archive Expedition With A Deliberately Long Team Name');
 for(let i=0;i<4;i++)await page.getByLabel('Remove last team',{exact:true}).click();
 await page.locator('.tl-advanced > summary').click();await page.getByLabel('Roster size').selectOption('compact');
 await shot(page,'setup',false);await page.getByRole('button',{name:'START SOLO DRAFT →',exact:true}).click();await ready(page);await page.getByLabel('Start draft clock',{exact:true}).waitFor();await shot(page,'draft');await page.getByLabel('Start draft clock',{exact:true}).click();
 let passes=0;
 while((await read(page)).phase==='draft'&&passes++<60){
  const state=await read(page),seat=E.currentDraftSeat(state);
  if(seat.teamId!=='t1'){await wait(700);continue;}
  const choice=AI.aiDraftChoice(state,data.cards);assert(choice,'Legal human pick must exist');
  await page.getByLabel('Search draft players',{exact:true}).fill(choice.name);
  const button=page.getByRole('button',{name:'Draft '+choice.name,exact:true});await button.click();console.log('Drafted '+choice.name);
  await page.waitForFunction(identity=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));const s=App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId)));return s.draftPicks.some(x=>x.identity===identity)},choice.identity);
  assert.equal((await read(page)).draftPicks.filter(x=>x.identity===choice.identity).length,1,'Pick is recorded exactly once');await wait(250);
 }
 }let state=await read(page);assert.equal(state.phase,'season','Real draft reaches season');assert.equal(state.draftPicks.length,12);assert(state.teams.every(t=>E.lineupProblems(state,t.teamId).length===0));evidence.checks.push(process.argv.includes('--resume-core')?'Resumed a fixture captured from the real UI draft':'Fresh signed-out user creates local solo game through real setup, drafts six legal selections against AI, and reaches a complete legal roster');
 await page.reload({waitUntil:'domcontentloaded'});await ready(page);state=await read(page);assert.equal(state.draftPicks.length,12);fs.writeFileSync(path.join(output,'drafted-fixture.json'),JSON.stringify(state,null,2));await tab(page,'home');await shot(page,'home');await tab(page,'roster');await page.getByRole('heading',{name:'My Roster',exact:true}).waitFor();await shot(page,'roster');
 // Two independently rendered tabs share one disposable save. A stale action
 // must not replace the first tab's newer committed stage.
 const stale=await open(ctx);await ready(stale);await tab(stale,'roster');
 await tab(page,'home');
 if(state.weekStage==='claims'){
  const footer=page.locator('.tl-week-action-buttons');
  const openButton=footer.getByRole('button',{name:/^(Review bids|Review trades|Review team)$/});
  if(await openButton.count())await openButton.click();
  await gate(page,/^(Run waivers|Continue to lineup)$/);await page.waitForFunction(()=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId))).weekStage==='lineup'});
 }
 const latest=await read(page);const beforeStale=state;let pair;for(const from of beforeStale.teams[0].roster)for(const to of beforeStale.teams[0].roster){if(from.entryId!==to.entryId&&from.slot!==to.slot&&E.setEntrySlot(beforeStale,'t1',from.entryId,to.slot,to.entryId)!==beforeStale)pair=[from,to];}assert(pair,'The draft supplies a legal alternate lineup');await stale.getByRole('button',{name:'Move '+pair[0].name,exact:true}).click();await stale.getByRole('button',{name:'Swap '+pair[0].name+' with '+pair[1].name,exact:true}).click();await wait(500);console.log('Stale action UI: '+(await stale.locator('.tl-main').innerText()).slice(0,2600));await stale.getByRole('button',{name:'Load latest save',exact:true}).first().waitFor();assert.deepEqual(await read(stale),latest,'Stale tab preserves newer durable state');await shot(stale,'save-recovery',false);const recovery=stale.getByRole('button',{name:'Load latest save',exact:true}).first();await recovery.scrollIntoViewIfNeeded();assert(await recovery.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Recovery button must be reachable above every overlay');await recovery.focus();await stale.keyboard.press('Enter');await page.waitForTimeout(100);assert.equal((await read(stale)).weekStage,latest.weekStage);await stale.close();evidence.checks.push('Two-tab stale roster action is rejected; reachable Load latest save accepts keyboard Enter and restores the newer stage without overwriting durable progress');
 await tab(page,'roster');assert(await page.getByRole('button',{name:'Fill empty slots',exact:true}).isDisabled(),'A full legal lineup has no gap-fill action');await gate(page,'Lock lineup');await tab(page,'gameday');await shot(page,'gameday-ready');
 await gate(page,'Start game day');await page.getByRole('button',{name:'INSTANT',exact:true}).waitFor();const finalBefore=JSON.stringify((await read(page)).finalizedWeeks);await page.getByRole('button',{name:'INSTANT',exact:true}).click();await tab(page,'home');await page.getByRole('heading',{name:'What decided the game',exact:true}).waitFor();await shot(page,'recap');
 state=await read(page);assert.equal(state.finalizedWeeks.length,1);assert.equal(state.weekStage,'postgame');const matchup=state.finalizedWeeks[0].matchups[0];const mine=matchup.home==='t1'?matchup.homePoints:matchup.awayPoints;assert((await page.locator('.tl-home').innerText()).includes(mine.toFixed(2)),'Home shows exact saved score');
 await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(JSON.stringify((await read(page)).finalizedWeeks),finalBefore,'Reload and instant playback do not reroll or duplicate result');evidence.checks.push('Real controls run planning, legal lineup lock, game day, instant playback, exact-score explanation and durable postgame reload');
 await page.getByRole('button',{name:'Scoring & box scores →',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tl-root').dataset.vaultTab==='gameday');await tab(page,'home');await gate(page,'End week');assert.equal((await read(page)).currentWeek,2);assert.equal((await read(page)).weekStage,'claims');
 // Save old-format plain JSON from a real played game, finish through authoritative
 // actions offscreen, then resume the final boundary in a new disposable context.
 state=await read(page);evidence.checks.push('Week recap opens scoring evidence and End week preserves final while opening Week 2 planning');
 fs.writeFileSync(path.join(output,'journey-fixture.json'),JSON.stringify(state,null,2));await ctx.close();return state;
}
async function completion(state){
 let steps=0;while(state.phase==='season'&&steps++<60){const map={claims:'process-claims',lineup:'finalize-rosters',ready:'week',postgame:'advance-week'};if(state.weekStage==='lineup')state=act(state,{type:'auto-lineup',teamId:'t1'});state=act(state,{type:map[state.weekStage]});}
 assert.equal(state.phase,'complete');assert.equal(state.finalizedWeeks.length,14);assert.equal(new Set(state.finalizedWeeks.map(w=>w.week)).size,14);
 const ctx=await context();await saveFixture(ctx,state);const page=await open(ctx);await ready(page);await page.getByText('CROWNED VAULT CHAMPION',{exact:true}).waitFor();await shot(page,'complete');const saved=JSON.stringify((await read(page)).finalizedWeeks);await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(JSON.stringify((await read(page)).finalizedWeeks),saved);
 await page.getByRole('button',{name:'My career →',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tl-root').dataset.vaultTab==='career');assert.equal((await prefs(page)).tab,'career');
 await tab(page,'home');await page.getByLabel('League options',{exact:true}).click();await page.getByRole('button',{name:'Switch league',exact:true}).click();await page.getByText('Continue playing',{exact:true}).waitFor();assert((await page.locator('.tl-season-card').innerText()).includes('COMPLETE'));await page.locator('.tl-season-card').getByRole('button',{name:'SEASON RECORD →',exact:true}).click();await page.getByText('CROWNED VAULT CHAMPION',{exact:true}).waitFor();
 evidence.checks.push('Fixture-assisted 14-week completion uses shared authoritative actions; champion, career route, completed shelf, resume and final reload preserve all 14 settled results');await ctx.close();return state;
}
async function hidden(state){
 const h=E.normalizeTimeLeague({...state,leagueId:state.leagueId+'-hidden',phase:'season',currentWeek:2,weekStage:'postgame',settings:{...state.settings,hiddenYears:true},yearsRevealed:false,yearReveals:[],championTeamId:null,finalizedWeeks:[state.finalizedWeeks[0]]});
 const ctx=await context();await saveFixture(ctx,h);const page=await open(ctx);await ready(page);await page.getByRole('heading',{name:'What decided the game',exact:true}).waitFor();const text=await page.locator('.tl-home-result-explainer').innerText();
 for(const player of h.finalizedWeeks[0].results.flatMap(r=>r.starters)){assert(!text.includes(String(player.drawnSeason)),`Result explanation exposes hidden ${player.drawnSeason}`);}
 await shot(page,'hidden-recap',false);evidence.checks.push('Hidden-year fixture result explanation does not expose any drawn season; browser storage remains full local game state and is not secure secrecy');await ctx.close();
}
async function acceptance(){
 const state=JSON.parse(fs.readFileSync(path.join(output,'drafted-fixture.json'),'utf8'));const ctx=await context();await saveFixture(ctx,state);const page=await open(ctx);await ready(page);await tab(page,'messages');const text='Good season. I enjoyed competing with your team.';await page.getByLabel('Message tone',{exact:true}).selectOption('friendly');await page.locator('.tl-chat-compose textarea').fill(text);await page.getByRole('button',{name:/^Send message to /}).click();await page.waitForFunction(text=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));const s=App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId)));return s.rivalMessages?.some(m=>m.fromTeamId==='t1'&&m.text===text);},text);const before=await read(page);const ids=before.rivalMessages.map(m=>m.id);await page.reload({waitUntil:'domcontentloaded'});await ready(page);const after=await read(page);assert.deepEqual(after.rivalMessages.map(m=>m.id),ids);assert.equal(after.rivalMessages.filter(m=>m.fromTeamId==='t1'&&m.text===text).length,1);evidence.checks.push('Actual rival composer sends a friendly reply; message and authored AI reply persist exactly once across reload');await ctx.close();
 const modalCtx=await context();await saveFixture(modalCtx,state);const modal=await open(modalCtx);await ready(modal);const other=await open(modalCtx);await ready(other);await other.locator('.tl-sidenav .tl-tabbtn').filter({hasText:'WAIVERS'}).click();await modal.locator('.tl-sidenav .tl-tabbtn').filter({hasText:'WAIVERS'}).click();const claimButton=modal.getByRole('button',{name:/^Claim /}).first();const targetName=(await claimButton.getAttribute('aria-label')).replace(/^Claim /,'');const target=[...data.cards.values()].find(card=>card.name===targetName);const compatibleDrop=state.teams[0].roster.find(entry=>entry.position===target?.position);assert(compatibleDrop,'Recovery fixture chooses a legal same-position replacement');await claimButton.click();const dialog=modal.getByRole('dialog',{name:'Waiver claim',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'Drop '+compatibleDrop.name,exact:true}).click();assert(await dialog.getByRole('button',{name:'⚖ FILE CLAIM',exact:true}).isEnabled(),'A legal claim is enabled before the other tab advances');await gate(other,'Run waivers');const saved=await read(other);await dialog.getByRole('button',{name:'⚖ FILE CLAIM',exact:true}).click();await modal.getByRole('button',{name:'Load latest save',exact:true}).first().waitFor();assert.equal(await modal.locator('dialog.tl-waiver-claim[open]').count(),0,'Recovery closes native top-layer claim dialog');assert.deepEqual(await read(modal),saved);const recovery=modal.getByRole('button',{name:'Load latest save',exact:true}).first();await recovery.click();assert.equal((await read(modal)).weekStage,'lineup');evidence.checks.push('Stale native waiver claim closes top-layer dialog, leaves newer game untouched and allows Load latest save recovery');await modalCtx.close();
}
async function webkitSmoke(){
 const state=JSON.parse(fs.readFileSync(path.join(output,'drafted-fixture.json'),'utf8'));const ctx=await context({viewport:{width:390,height:844}});await saveFixture(ctx,state);const page=await open(ctx);await ready(page);assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 await page.locator('.tl-mobile-nav').getByRole('button',{name:/^More/}).click();await page.getByRole('dialog',{name:'More Vault views',exact:true}).waitFor();await page.keyboard.press('Escape');assert(!await page.getByRole('dialog',{name:'More Vault views',exact:true}).isVisible());assert(await page.locator('.tl-mobile-nav').getByRole('button',{name:/^More/}).evaluate(el=>el===document.activeElement));
 const openButton=page.locator('.tl-week-action-buttons').getByRole('button',{name:/^(Review bids|Review trades|Review team)$/});if(await openButton.count())await openButton.click();await gate(page,/^(Run waivers|Continue to lineup)$/);await tab(page,'roster');
 let pair;const current=await read(page);for(const from of current.teams[0].roster)for(const to of current.teams[0].roster)if(from.entryId!==to.entryId&&from.slot!==to.slot&&E.setEntrySlot(current,'t1',from.entryId,to.slot,to.entryId)!==current)pair=[from,to];assert(pair);await page.getByRole('button',{name:'Move '+pair[0].name,exact:true}).click();await page.getByRole('button',{name:'Swap '+pair[0].name+' with '+pair[1].name,exact:true}).click();assert.equal(E.lineupProblems(await read(page),'t1').length,0);await gate(page,'Lock lineup');await tab(page,'gameday');await gate(page,'Start game day');await page.getByRole('button',{name:'INSTANT',exact:true}).click();await tab(page,'home');await page.getByRole('heading',{name:'What decided the game',exact:true}).waitFor();
 for(const [width,height] of sizes.slice(0,2)){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=`after-webkit-recap-${width}.png`;await page.screenshot({path:path.join(output,file),fullPage:true,animations:'disabled'});evidence.screenshots.push(file);}
 await page.setViewportSize({width:390,height:844});await page.addStyleTag({content:'html { font-size: 125%; }'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal((await read(page)).finalizedWeeks.length,1);evidence.checks.push('WebKit phone smoke: 390/430 widths, reduced motion, More dialog Escape/focus return, legal Move-sheet swap, lineup lock, game day, instant final, enlarged text and reload');await ctx.close();
}
(async()=>{try{
 if(process.argv.includes('--webkit-smoke')){browser=await webkit.launch({headless:true,...(process.env.PLAYWRIGHT_WEBKIT_PATH?{executablePath:process.env.PLAYWRIGHT_WEBKIT_PATH}:{})});await webkitSmoke();assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.routeErrors||[],[]);evidence.passed=true;evidence.scope='Local WebKit browser phone emulation with disposable fixture; loopback route, no network writes or physical-device proof';console.log('PASS '+evidence.checks.join('\nPASS '));return;}
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--host-resolver-rules=MAP vault-qa.test 127.0.0.1']});
 if(process.argv.includes('--acceptance-only')){await acceptance();assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.routeErrors||[],[]);evidence.passed=true;console.log('PASS '+evidence.checks.join('\nPASS '));return;}const state=process.argv.includes('--fixtures-only')?JSON.parse(fs.readFileSync(path.join(output,fs.existsSync(path.join(output,'journey-fixture.json'))?'journey-fixture.json':'drafted-fixture.json'),'utf8')):await core();const final=await completion(state);await hidden(final);assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.routeErrors||[],[]);evidence.passed=true;
 evidence.webkit='Separate --webkit-smoke run exercises phone controls on an isolated fixture';
 console.log('PASS '+evidence.checks.join('\nPASS '));
}catch(error){if(browser)for(const ctx of browser.contexts())for(const page of ctx.pages()){try{fs.writeFileSync(path.join(output,'failure-body.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}}evidence.passed=false;evidence.error=error.message;console.error(error);process.exitCode=1;}finally{if(browser)await browser.close();evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,process.argv.includes('--webkit-smoke')?'webkit-verification.json':process.argv.includes('--acceptance-only')?'acceptance-verification.json':process.argv.includes('--fixtures-only')?'completion-verification.json':'verification.json'),JSON.stringify(evidence,null,2)+'\n');}})();
