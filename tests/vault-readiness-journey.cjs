#!/usr/bin/env node
'use strict';
// Disposable local fixtures; no account, hosted room or existing user save.
// --baseline serves exact fc10c31 UI/engine sources, preserving before evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'output/playwright/vault-readiness'),base='http://vault-qa.test:3038';
const baseline=process.argv.includes('--baseline'),useWebKit=process.argv.includes('--webkit');fs.mkdirSync(output,{recursive:true});
global.window=globalThis;global.App={};for(const name of['roster','helmet','rules','draft-room','era-rules','types','season','player-cards','engine','hidden-years','strategy','rivals','ai','actions','gamecast','player-stats','storage'])require('../js/shared/time-league-'+name+'.js');
const E=App.TimeLeagueEngine,A=App.TimeLeagueActions,AI=App.TimeLeagueAI,S=App.TimeLeagueSeason,P=App.TimeLeaguePlayerStats;
const data={cards:App.TimeLeaguePlayerCards.buildPlayerCardIndex(JSON.parse(fs.readFileSync(path.join(root,'data/time-league/player-cards.json'),'utf8'))),logIndex:S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync(path.join(root,'data/time-league/regular-season-game-logs.csv'),'utf8')).logs),eraFactors:new Map()};
const stamp='2026-10-21T00:00:00Z';const actor={seat_team_id:'t1',role:'commissioner'};
function act(state,type,patch={}){return E.normalizeTimeLeague(A.applyOnlineAction(state,{type,...patch},actor,data,stamp));}
function league(name,count,{humans=1,playoffs=0,weak=false,bench=0}={}){let state=E.normalizeTimeLeague(E.createTimeLeague({name,seed:'vault-readiness-'+name,createdAt:stamp,seats:Array.from({length:count},(_,i)=>({name:i===0?'Solo Atlas':i===1&&humans>1?'Missing Morgan':'Rival '+(i+1),manager:i<humans?'human':'ai',aiPersona:i%2?'steward':'warlord'})),settings:{gameDeckVersion:1,hiddenYears:false,rosterSlots:{QB:1,BN:bench},maxQuarterbacks:2,regularSeasonWeeks:playoffs?12:14,playoffTeams:playoffs,draftPickSeconds:0,draftAiSeconds:.5,eraRules:{mode:'any-era',decades:[]},waiversEnabled:true,tradesEnabled:true,scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2}}}));state=E.startDraft(state,stamp);let n=0;while(state.phase==='draft'&&n++<80){const seat=E.currentDraftSeat(state),team=state.teams.find(t=>t.teamId===seat.teamId);const desired=weak&&seat.teamId==='t1'&&team.roster.length===0?[...data.cards.values()].find(c=>c.name==='Ryan Leaf'&&c.position==='QB'):null;const card=desired&&!E.draftedIdentities(state).has(desired.identity)?desired:AI.aiDraftChoice(state,data.cards);assert(card);state=E.normalizeTimeLeague(E.applyDraftPick(state,card,{madeBy:team.manager,createdAt:stamp}));}assert.equal(state.phase,'season');return state;}
function readyFixture(state){if(state.weekStage==='postgame')state=act(state,'advance-week');if(state.weekStage==='claims')state=act(state,'process-claims');if(state.weekStage==='lineup')state=act(state,'finalize-rosters');assert.equal(state.weekStage,'ready');return state;}
function advanceOne(state){state=readyFixture(state);state=act(state,'week');if(state.phase==='season')state=act(state,'advance-week');return state;}
function fixtures(){const files=['normal','bye','observer','missing','no-record','locked'];if(files.every(f=>fs.existsSync(path.join(output,f+'-fixture.json'))))return;let normal=league('Normal first game',2);let bye=league('Three team bye',3);const byeWeek=bye.schedule.find(w=>!w.pairs.some(p=>p.includes('t1'))).week;while(bye.currentWeek<byeWeek)bye=advanceOne(bye);bye=readyFixture(bye);let observer=league('Playoff observer',8,{playoffs:4,weak:true});while(observer.currentWeek<=observer.settings.regularSeasonWeeks)observer=advanceOne(observer);assert(!E.playoffPairs(observer,observer.currentWeek).some(pair=>pair.includes('t1')),'Weak human fixture must miss playoffs');observer=E.normalizeTimeLeague({...observer,teams:observer.teams.map(t=>t.teamId==='t1'?{...t,roster:[]}:t)});observer=readyFixture(observer);let missing=league('Other human missing',3,{humans:2,bench:1});missing=act(missing,'process-claims');missing=E.normalizeTimeLeague({...missing,teams:missing.teams.map(t=>t.teamId==='t2'?{...t,roster:t.roster.filter(e=>e.slot!=='QB')}:t)});assert(E.lineupProblems(missing,'t2').length);let noRecord=league('Legal no record',2,{weak:true});let loops=0;while(P.signals(noRecord,noRecord.teams[0].roster[0],data.logIndex).currentAvailable!==false&&loops++<13)noRecord=advanceOne(noRecord);assert.equal(P.signals(noRecord,noRecord.teams[0].roster[0],data.logIndex).currentAvailable,false);noRecord=readyFixture(noRecord);let locked=readyFixture(league('Legacy locked malformed',2));locked=E.normalizeTimeLeague({...locked,teams:locked.teams.map(t=>t.teamId==='t1'?{...t,roster:[]}:t)});for(const [name,value]of Object.entries({normal:readyFixture(normal),bye,observer,missing,noRecord,locked}))fs.writeFileSync(path.join(output,name.replace('noRecord','no-record')+'-fixture.json'),JSON.stringify(value,null,2));}
function additionalFixtures(){
    const read=name=>JSON.parse(fs.readFileSync(path.join(output,name+'-fixture.json'),'utf8'));
    const write=(name,value)=>fs.writeFileSync(path.join(output,name+'-fixture.json'),JSON.stringify(value,null,2));
    const normal=read('normal');
    write('locked-repair',E.normalizeTimeLeague({...normal,settings:{...normal.settings,rosterSlots:{QB:1,BN:1}},teams:normal.teams.map(team=>team.teamId==='t1'?{...team,roster:team.roster.map(entry=>({...entry,slot:'BN'}))}:team)}));
    write('no-record-lineup',E.normalizeTimeLeague({...read('no-record'),weekStage:'lineup'}));
}
const evidence={scope:'Local '+(useWebKit?'WebKit':'Chromium')+'; disposable fixtures; no backend writes',baseline,startedAt:new Date().toISOString(),checks:[],findings:[],screenshots:[],blocked:0,pageErrors:[]};let browser,page;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const state=page=>page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId)))});
async function open(name,tabId='home'){const fixture=JSON.parse(fs.readFileSync(path.join(output,name+'-fixture.json'),'utf8'));const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});await ctx.addInitScript(({fixture,tabId})=>{if(location.hostname!=='vault-qa.test'||sessionStorage.getItem('qa-readiness-installed'))return;localStorage.setItem('wr-time-leagues-v1',JSON.stringify([{leagueId:fixture.leagueId,name:fixture.name,phase:fixture.phase,teamCount:fixture.teams.length,currentWeek:fixture.currentWeek,weekStage:fixture.weekStage,createdAt:fixture.createdAt}]));localStorage.setItem('wr-time-league-v1:'+fixture.leagueId,JSON.stringify(fixture));localStorage.setItem('wr-time-league-ui-v1',JSON.stringify({leagueId:fixture.leagueId,tab:tabId,teamId:'t1',onlineRowId:null}));sessionStorage.setItem('qa-readiness-installed','1');},{fixture,tabId});const old=new Map();if(baseline)for(const file of['js/tabs/time-league.js','js/shared/time-league-engine.js','js/shared/time-league-actions.js','js/components/time-league-home-panel.js','js/components/time-league-team-panel.js','js/components/time-league-gamecast-panel.js','js/components/time-league-week-gates.js','js/components/time-league-standings-panel.js','time-league-focus.css','time-league-roster-home.css'])old.set('/'+file,execFileSync('git',['show','fc10c31:'+file],{cwd:root,encoding:'utf8'}));await ctx.route('**/*',async route=>{try{const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':req.headers().origin||base,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']||'*'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:''});if(['POST','PUT','PATCH','DELETE'].includes(req.method())){evidence.blocked++;return route.fulfill({status:url.pathname==='/rest/v1/analytics_events'?204:403,headers,body:''});}if(old.has(url.pathname))return route.fulfill({status:200,contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:old.get(url.pathname)});if(useWebKit&&url.hostname==='vault-qa.test')return route.fulfill({response:await route.fetch({url:req.url().replace('vault-qa.test','127.0.0.1')})});return route.continue();}catch(error){if(!/closed|disposed/i.test(error.message)){evidence.routeErrors??=[];evidence.routeErrors.push(error.message);}try{await route.abort();}catch{}}});page=await ctx.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>{if(/analytics_events/.test(error.message)&&/access control/i.test(error.message)){evidence.expectedBlockedErrors??=[];evidence.expectedBlockedErrors.push(error.message);}else evidence.pageErrors.push(error.message);});await page.goto(base+'/?vault=1',{waitUntil:'domcontentloaded'});await ready(page);return{ctx,page,fixture};}
async function ready(page){await page.locator('.tl-root.tl-play').waitFor();await page.getByText('Loading player cards…',{exact:true}).waitFor({state:'hidden',timeout:60000});}
async function tab(page,name){const labels={HOME:'Home',GAMEDAY:baseline?'Game day':'Game Day',ROSTER:baseline?'My team':'Lineup',WAIVERS:baseline?'Players':'Waivers'};if(await page.locator('.tl-sidenav').isVisible())await page.locator('.tl-sidenav').getByRole('button',{name,exact:true}).click();else await page.locator('.tl-mobile-nav').getByRole('button',{name:labels[name],exact:true}).click();}
async function shot(page,name,all=false){
    for(const [width,height]of(useWebKit?[[390,844],[430,932]]:all?[[390,844],[430,932],[1024,1366],[1366,1024],[1440,900]]:[[390,844],[1440,900]])){
        await page.setViewportSize({width,height});await wait(150);
        assert.equal(await page.locator('.tl-root.tl-play').count(),1,'One Vault application root');
        const geometry=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,footerHeight:document.querySelector('.tl-week-action-row')?.getBoundingClientRect().height||0}));
        assert(geometry.scrollWidth<=width+1,name+' overflows '+width);
        assert(geometry.footerHeight<=height*.4,name+' footer occupies too much viewport at '+width);
        evidence.viewportChecks??=[];evidence.viewportChecks.push({name,width,height,...geometry});
        const file=(baseline?'before-':'after-')+(useWebKit?'webkit-':'')+name+'-'+width+'.png';
        // Full-page Chrome capture can repeat the fixed app shell. After evidence uses real viewports.
        await page.screenshot({path:path.join(output,file),fullPage:baseline,animations:'disabled'});evidence.screenshots.push(file);
    }
    await page.setViewportSize({width:390,height:844});await wait(150);
}
async function hitTest(locator){assert.equal(await locator.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top===el||el.contains(top);}),true,'Action center is reachable by touch');}
async function start(page){
    await tab(page,'GAMEDAY');
    const before=(await state(page)).finalizedWeeks.length;
    await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Start game day',exact:true}).evaluate(el=>{el.click();el.click();});
    await page.getByRole('button',{name:'INSTANT',exact:true}).waitFor();
    assert.equal((await state(page)).finalizedWeeks.length,before+1,'Repeated Start events commit one saved result');
    if(!baseline)assert.equal(await page.getByRole('region',{name:'Saved week archive',exact:true}).count(),0,'First playback withholds its saved archive');
}
async function waitStage(page,value){await page.waitForFunction(value=>{const prefs=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(prefs.leagueId))).weekStage===value;},value);}

async function interruption(){const {ctx,page}=await open('normal');await start(page);await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Next quarter',exact:true}).click();const before=JSON.stringify((await state(page)).finalizedWeeks);await shot(page,'interrupted-q1');await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(JSON.stringify((await state(page)).finalizedWeeks),before);const text=await page.locator('body').innerText();fs.writeFileSync(path.join(output,(baseline?'before-':'after-')+'interrupted-reload.txt'),text);await shot(page,'interrupted-reload');await page.getByRole('button',{name:'REPLAY',exact:true}).first().click();await page.getByRole('button',{name:'INSTANT',exact:true}).click();assert.equal(JSON.stringify((await state(page)).finalizedWeeks),before);evidence.checks.push('Replay playback controls preserve the original committed final without a second grant');evidence.checks.push('Reload after first-playback quarter preserves the committed final exactly; presentation is inspected separately');evidence.findings.push({kind:'presentation',name:'Reloaded interrupted first playback',hasInstant:!!await page.getByRole('button',{name:'INSTANT',exact:true}).count(),hasEndWeek:!!await page.getByRole('button',{name:'End week',exact:true}).count(),hasFinalText:/FINAL/.test(text)});await tab(page,'HOME');const end=page.locator('.tl-week-action-buttons').getByRole('button',{name:'End week',exact:true});await end.evaluate(el=>{el.click();el.click();});await wait(250);const after=await state(page);assert.equal(JSON.stringify(after.finalizedWeeks),before);assert.equal(after.weekStage,'claims');assert.equal(after.currentWeek,2);evidence.checks.push('Repeated actual End week events advance once to Week2 claims and preserve the single saved result');await ctx.close();}
async function bye(){
    const{ctx,page,fixture}=await open('bye');
    if(!baseline)assert.match(await page.locator('.tl-home').innerText(),/points for and all-play/);
    await shot(page,'bye-ready-home',!baseline);
    await start(page);
    if(!baseline){
        await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Pause',exact:true}).click();
        const context=page.getByRole('region',{name:'Regular-season bye',exact:true});
        assert.match(await context.innerText(),/Lineup points so far: 0.00/);
        const lineup=page.getByRole('region',{name:'Starting lineup on a regular-season bye',exact:true});
        assert.match(await lineup.innerText(),new RegExp(fixture.teams[0].roster[0].name));
        await shot(page,'bye-playback',true);
        evidence.checks.push('Bye playback exposes the actual own scoring lineup and landed points only; its first-playback archive remains withheld');
    }
    await page.getByRole('button',{name:'INSTANT',exact:true}).click();await tab(page,'HOME');
    const after=await state(page),result=after.finalizedWeeks.at(-1);
    assert(!result.matchups.some(m=>m.home==='t1'||m.away==='t1'));
    const old=E.computeStandings(fixture).find(t=>t.teamId==='t1'),now=E.computeStandings(after).find(t=>t.teamId==='t1'),own=result.results.find(r=>r.teamId==='t1');
    assert(own);assert.equal(now.wins,old.wins);assert.equal(now.losses,old.losses);assert.equal(now.ties,old.ties);
    assert.equal(Math.round((now.pointsFor-old.pointsFor)*100),Math.round(own.total*100));
    assert.equal(now.allPlayWins-old.allPlayWins,result.results.filter(r=>r.teamId!=='t1'&&r.total<own.total).length);
    await shot(page,'bye-recap',!baseline);fs.writeFileSync(path.join(output,(baseline?'before-':'after-')+'bye-recap.txt'),await page.locator('body').innerText());
    evidence.checks.push('Regular-season bye records starter production and points-for/all-play while adding no head-to-head win/loss/tie');
    if(!baseline){
        await page.getByRole('button',{name:'Scoring & box scores →',exact:true}).click();
        const archive=page.getByRole('region',{name:'Saved week archive',exact:true});await archive.waitFor();
        const box=page.getByRole('region',{name:'Solo Atlas box score',exact:true});await box.waitFor();
        assert.equal(await page.locator('.tl-box-team').first().getAttribute('aria-label'),'Solo Atlas box score');
        assert.match(await box.innerText(),new RegExp(own.total.toFixed(2).replace('.','\.')));
        assert.match(await page.locator('.tl-box-unpaired-note').first().innerText(),/Regular-season bye.*points for and all-play/);
        const summary=box.locator('summary').first();await summary.focus();await page.keyboard.press('Enter');
        assert.equal(await box.locator('details').first().getAttribute('open'),'');
        assert.match(await box.innerText(),/Saved fantasy points/);
        await shot(page,'bye-scoring-receipt',true);
        const total=box.locator('.tl-score-saved-total').first();await total.evaluate(el=>el.scrollIntoView({block:'center',behavior:'auto'}));await hitTest(total);assert.match(await total.innerText(),new RegExp(own.total.toFixed(2).replace('.','\\.')));
        const saved=JSON.stringify(after.finalizedWeeks);await page.reload({waitUntil:'domcontentloaded'});await ready(page);
        assert.equal(JSON.stringify((await state(page)).finalizedWeeks),saved);
        evidence.checks.push('The Home scoring link opens the own unpaired bye box score first; native keyboard receipt reconciles saved points and reload preserves the final');
    }
    await ctx.close();
}
async function observer(){
    const{ctx,page}=await open('observer');
    if(!baseline){const home=await page.locator('.tl-home').innerText();assert.match(home,/Follow the playoffs/i);assert.doesNotMatch(home,/has a bye this week/);}
    await shot(page,'observer-ready-home',!baseline);
    if(!baseline){await tab(page,'ROSTER');assert.match(await page.locator('.tl-roster-lineup-status').innerText(),/No lineup required this round/);assert.match(await page.locator('.tl-roster-fill-help').innerText(),/does not block kickoff/);await shot(page,'observer-roster');}
    await start(page);
    if(!baseline){
        const context=page.getByRole('region',{name:'Following the playoffs',exact:true});assert.match(await context.innerText(),/lineup does not block kickoff/);
        assert.equal(await page.getByRole('button',{name:'MY MATCHUP',exact:true}).count(),0);
    }
    await shot(page,'observer-playback',!baseline);await page.getByRole('button',{name:'INSTANT',exact:true}).click();await tab(page,'HOME');
    const after=await state(page);assert.equal(after.phase,'season');assert.equal(after.currentWeek,14);assert(!after.finalizedWeeks.at(-1).results.some(r=>r.teamId==='t1'));
    const text=await page.locator('body').innerText();await shot(page,'observer-recap',!baseline);fs.writeFileSync(path.join(output,(baseline?'before-':'after-')+'observer-recap.txt'),text);
    if(baseline){if(/bye week is complete/i.test(text))evidence.findings.push({kind:'defect',name:'Excluded playoff observer is told their bye week is complete'});}
    else {assert.match(text,/Your team did not play this round/);assert.doesNotMatch(text,/bye week is complete/i);assert.equal(await page.getByRole('button',{name:'End week',exact:true}).isEnabled(),true);}
    evidence.checks.push('Playoff observer with an empty irrelevant roster advances semifinals without being blocked by personal lineup gaps; the recap identifies an unplayed round');
    await ctx.close();
}
async function missing(){
    const{ctx,page,fixture}=await open('missing');await tab(page,'ROSTER');
    const footer=page.getByRole('contentinfo',{name:'Week actions',exact:true});
    assert.match(await footer.innerText(),/Missing Morgan: QB slot is empty/);
    assert.equal(await footer.getByRole('button',{name:'Lock lineup',exact:true}).isDisabled(),true);
    await footer.locator('.tl-gate-readiness > summary').click();
    await shot(page,'missing-other-manager',true);
    const fix=footer.getByRole('button',{name:'Fix Missing Morgan lineup',exact:true});await hitTest(fix);
    const summary=footer.locator('.tl-gate-readiness > summary');
    await fix.focus();await page.keyboard.press('Escape');assert.equal(await summary.evaluate(el=>el===document.activeElement),true);assert.equal(await footer.locator('.tl-gate-readiness').getAttribute('open'),null);
    await shot(page,'missing-closed-readiness');
    await summary.focus();await page.keyboard.press('Enter');await footer.getByRole('button',{name:'Close lineup readiness',exact:true}).click();assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
    await summary.focus();await page.keyboard.press('Enter');
    evidence.checks.push('Lineup readiness Escape and close control both collapse the list and restore focus to its summary; closed/open footer actions remain reachable');
    if(!useWebKit){
        await page.evaluate(()=>{const values=[...document.querySelectorAll('.tl-root *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);for(const[el,size]of values)el.style.fontSize=(size*1.25)+'px';});
        await shot(page,'missing-enlarged-text');await hitTest(fix);
        await page.evaluate(()=>document.querySelectorAll('.tl-root *').forEach(el=>el.style.removeProperty('font-size')));
        await page.setViewportSize({width:390,height:844});await wait(150);
    }
    await fix.click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Hotseat manager"]')?.value==='t2');
    assert.match(await page.locator('.tl-roster-toolbar').innerText(),/Missing Morgan/);
    await page.getByRole('button',{name:'Fill empty slots',exact:true}).click();
    await page.waitForFunction(()=>!App.TimeLeagueEngine.lineupReadiness(App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(JSON.parse(localStorage.getItem('wr-time-league-ui-v1')).leagueId)))).blockers.length);
    const repaired=await state(page);assert.equal(repaired.teams[1].roster.length,fixture.teams[1].roster.length);
    assert.deepEqual(repaired.teams[0].roster,fixture.teams[0].roster);
    await footer.getByRole('button',{name:'Lock lineup',exact:true}).click();await waitStage(page,'ready');
    evidence.checks.push('Another required human is named before locking; Fix Missing Morgan switches to the correct hotseat roster, fills its eligible gap and permits one shared lock');
    await ctx.close();
}
async function noRecord(){
    const{ctx,page}=await open('no-record-lineup');await tab(page,'ROSTER');
    const warning=page.getByRole('region',{name:'Current no-game starters',exact:true});await warning.waitFor();
    assert.match(await warning.innerText(),/Ryan Leaf/);assert.match(await warning.innerText(),/legal starters; keeping them does not prevent kickoff/);
    assert.equal(await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Lock lineup',exact:true}).isEnabled(),true);
    await shot(page,'legal-no-record-starter',true);
    await warning.getByRole('button',{name:'Compare replacements for Ryan Leaf',exact:true}).click();
    await page.getByRole('dialog',{name:'Move Ryan Leaf',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close lineup choices',exact:true}).click();
    await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Lock lineup',exact:true}).click();await waitStage(page,'ready');
    await start(page);await page.getByRole('button',{name:'INSTANT',exact:true}).click();
    const own=(await state(page)).finalizedWeeks.at(-1).results.find(result=>result.teamId==='t1');assert.equal(own.total,0);assert.equal(own.starters[0].availability,'no-record');
    evidence.checks.push('A public no-record starter is named with a reachable real Move comparison, remains a legal lineup and settles its known zero without blocking kickoff');
    await ctx.close();
}
async function locked(){
    const{ctx,page,fixture}=await open('locked-repair');await tab(page,'GAMEDAY');
    const footer=page.getByRole('contentinfo',{name:'Week actions',exact:true});
    assert.match(await footer.innerText(),/Solo Atlas: QB slot is empty/);
    assert.equal(await footer.getByRole('button',{name:'Start game day',exact:true}).isDisabled(),true);
    await shot(page,'locked-legacy-repair',true);
    await footer.getByRole('button',{name:'Reopen lineups',exact:true}).focus();await page.keyboard.press('Enter');
    await waitStage(page,'lineup');await page.locator('.tl-roster-toolbar').waitFor();
    await page.getByRole('button',{name:'Fill empty slots',exact:true}).click();
    await page.waitForFunction(()=>!App.TimeLeagueEngine.lineupProblems(App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(JSON.parse(localStorage.getItem('wr-time-league-ui-v1')).leagueId))),'t1').length);
    const repaired=await state(page);assert.equal(repaired.teams[0].roster[0].entryId,fixture.teams[0].roster[0].entryId);assert.equal(repaired.teams[0].roster[0].slot,'QB');
    await page.locator('.tl-week-action-buttons').getByRole('button',{name:'Lock lineup',exact:true}).click();await waitStage(page,'ready');
    evidence.checks.push('A malformed locked local legacy lineup cannot kick off; commissioner keyboard Reopen lineups reaches the actual roster and repairs without losing its player');
    await ctx.close();
}
async function safeArea(){
    const{ctx,page}=await open('missing');await tab(page,'ROSTER');
    for(const[width,height,scale,label]of[[390,844,1,'initial'],[390,844,1.25,'enlarged'],[430,932,1.25,'enlarged'],[430,932,1,'restored'],[667,375,1,'landscape'],[667,375,1.25,'landscape-enlarged'],[740,390,1,'tablet-navigation'],[1440,900,1,'desktop-restored'],[390,844,1,'phone-return']]){
        await page.setViewportSize({width,height});
        await page.evaluate(scale=>{
            if(window.__qaFontSizes){for(const[el,value,priority]of window.__qaFontSizes)if(el.isConnected){if(value)el.style.setProperty('font-size',value,priority);else el.style.removeProperty('font-size');}delete window.__qaFontSizes;}
            if(scale!==1){const elements=[...document.querySelectorAll('.tl-root *')];window.__qaFontSizes=elements.map(el=>[el,el.style.getPropertyValue('font-size'),el.style.getPropertyPriority('font-size')]);const sizes=elements.map(el=>parseFloat(getComputedStyle(el).fontSize));elements.forEach((el,index)=>el.style.setProperty('font-size',(sizes[index]*scale)+'px','important'));}
        },scale);await wait(250);
        const geometry=await page.evaluate(()=>{
            const nav=document.querySelector('.tl-mobile-nav'),navRect=nav.getBoundingClientRect(),footer=document.querySelector('.tl-week-action-row').getBoundingClientRect();
            const navVisible=getComputedStyle(nav).display!=='none'&&navRect.height>0;
            return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,navVisible,navTop:navVisible?navRect.top:innerHeight,navHeight:navRect.height,footerTop:footer.top,footerBottom:footer.bottom,navSpace:document.querySelector('.tl-root').style.getPropertyValue('--tl-mobile-nav-space'),buttons:[...document.querySelectorAll('.tl-week-action-buttons button,.tl-week-action-more > button')].map(el=>{const r=el.getBoundingClientRect();return{text:el.textContent,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};
        });
        assert(geometry.scrollWidth<=width+1,'No horizontal overflow '+label);
        assert(geometry.footerBottom<=geometry.navTop+1,'Footer must finish above navigation '+label);
        if(width>=1024){assert(!geometry.navVisible);assert.equal(geometry.navSpace,'','Desktop removes the measured mobile spacing');assert(geometry.footerBottom>=height-1,'Desktop has no stale mobile bottom gap');}
        for(const button of geometry.buttons){if(width<1024)assert(button.height>=43.5&&button.width>=43.5,'Entire 44px touch target '+button.text+' '+label);assert(button.top>=0&&button.bottom<=geometry.navTop+1&&button.left>=0&&button.right<=width+1,'Entire visible button '+button.text+' '+label);}
        evidence.safeAreaChecks??=[];evidence.safeAreaChecks.push({label,scale,...geometry});
        const file='after-'+(useWebKit?'webkit-':'')+'safe-area-'+width+'x'+height+'-'+label+'.png';await page.screenshot({path:path.join(output,file),animations:'disabled'});evidence.screenshots.push(file);
    }
    evidence.checks.push('Normal and125% text at390/430 and short landscape retain full44px week-action targets above navigation; restoring normal and desktop removes stale spacing');
    await ctx.close();
}
(async()=>{try{fixtures();additionalFixtures();if(process.argv.includes('--fixtures-only'))return;browser=useWebKit?await webkit.launch({headless:true,...(process.env.PLAYWRIGHT_WEBKIT_PATH?{executablePath:process.env.PLAYWRIGHT_WEBKIT_PATH}:{})}):await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--host-resolver-rules=MAP vault-qa.test 127.0.0.1']});const modes=baseline?{interruption,bye,observer}:{interruption,bye,observer,missing,noRecord,locked,safeArea};const args=process.argv.slice(2).filter(x=>!['--baseline','--webkit'].includes(x)).map(x=>x==='--no-record'?'noRecord':x==='--safe-area'?'safeArea':x.slice(2));for(const name of args.length?args:Object.keys(modes).filter(name=>name!=='safeArea')){assert(modes[name]);await modes[name]();console.log('PASS '+name);}assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.routeErrors||[],[]);evidence.passed=true;}catch(error){evidence.error=error.message;evidence.passed=false;console.error(error);if(page&&!page.isClosed()){fs.writeFileSync(path.join(output,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}process.exitCode=1;}finally{if(browser)await Promise.race([browser.close(),wait(5000).then(()=>{evidence.browserCleanupTimeout=true;})]);evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,(baseline?'baseline':useWebKit?'webkit':'verification')+(process.argv.includes('--safe-area')?'-safe-area':'')+'.json'),JSON.stringify(evidence,null,2)+'\n');process.exit(process.exitCode||0);}})();
