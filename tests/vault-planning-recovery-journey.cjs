#!/usr/bin/env node
'use strict';
// Disposable local fixtures; no account, hosted room or existing user save.
// --webkit uses the installed runtime override; all saves and actions are disposable local QA data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'output/playwright/vault-recovery'),base='http://vault-qa.test:3038';
const baseline=false,useWebKit=process.argv.includes('--webkit');fs.mkdirSync(output,{recursive:true});
global.window=globalThis;global.App={};for(const name of['roster','helmet','rules','draft-room','era-rules','types','season','player-cards','engine','hidden-years','strategy','rivals','ai','actions','gamecast','player-stats','storage'])require(path.join(root,'js/shared/time-league-'+name+'.js'));
const E=App.TimeLeagueEngine,A=App.TimeLeagueActions,AI=App.TimeLeagueAI,S=App.TimeLeagueSeason,P=App.TimeLeaguePlayerStats;
const data={cards:App.TimeLeaguePlayerCards.buildPlayerCardIndex(JSON.parse(fs.readFileSync(path.join(root,'data/time-league/player-cards.json'),'utf8'))),logIndex:S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync(path.join(root,'data/time-league/regular-season-game-logs.csv'),'utf8')).logs),eraFactors:new Map()};
const stamp='2026-10-21T00:00:00Z';const actor={seat_team_id:'t1',role:'commissioner'};
function act(state,type,patch={}){return E.normalizeTimeLeague(A.applyOnlineAction(state,{type,...patch},actor,data,stamp));}
const evidence={scope:'Local '+(useWebKit?'WebKit':'Chromium')+'; disposable fixtures; no backend writes',baseline,startedAt:new Date().toISOString(),checks:[],findings:[],screenshots:[],blocked:0,pageErrors:[]};let browser,page,activePage;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const state=page=>page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId)))});
async function open(name,tabId='home'){const fixture=JSON.parse(fs.readFileSync(path.join(output,name+'-fixture.json'),'utf8'));const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});await ctx.addInitScript(({fixture,tabId})=>{if(location.hostname!=='vault-qa.test'||localStorage.getItem('qa-acquisitions-installed'))return;localStorage.setItem('wr-time-leagues-v1',JSON.stringify([{leagueId:fixture.leagueId,name:fixture.name,phase:fixture.phase,teamCount:fixture.teams.length,currentWeek:fixture.currentWeek,weekStage:fixture.weekStage,createdAt:fixture.createdAt}]));localStorage.setItem('wr-time-league-v1:'+fixture.leagueId,JSON.stringify(fixture));localStorage.setItem('wr-time-league-ui-v1',JSON.stringify({leagueId:fixture.leagueId,tab:tabId,teamId:'t1',onlineRowId:null}));localStorage.setItem('qa-acquisitions-installed','1');},{fixture,tabId});const old=new Map();if(baseline)for(const file of['js/tabs/time-league.js','js/shared/time-league-engine.js','js/shared/time-league-ai.js','js/shared/time-league-actions.js','js/components/time-league-home-panel.js','js/components/time-league-team-panel.js','js/components/time-league-gamecast-panel.js','js/components/time-league-week-gates.js','js/components/time-league-standings-panel.js','time-league-focus.css','time-league-roster-home.css'])old.set('/'+file,execFileSync('git',['show','082a06f:'+file],{cwd:root,encoding:'utf8'}));await ctx.route('**/*',async route=>{try{const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':req.headers().origin||base,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']||'*'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:''});if(['POST','PUT','PATCH','DELETE'].includes(req.method())){evidence.blocked++;return route.fulfill({status:url.pathname==='/rest/v1/analytics_events'?204:403,headers,body:''});}if(old.has(url.pathname))return route.fulfill({status:200,contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:old.get(url.pathname)});if(useWebKit&&url.hostname==='vault-qa.test')return route.fulfill({response:await route.fetch({url:req.url().replace('vault-qa.test','127.0.0.1')})});return route.continue();}catch(error){if(!/closed|disposed/i.test(error.message)){evidence.routeErrors??=[];evidence.routeErrors.push(error.message);}try{await route.abort();}catch{}}});page=await ctx.newPage();activePage=page;page.setDefaultTimeout(30000);page.on('pageerror',error=>{if(/analytics_events/.test(error.message)&&/access control/i.test(error.message)){evidence.expectedBlockedErrors??=[];evidence.expectedBlockedErrors.push(error.message);}else evidence.pageErrors.push(error.message);});ctx.on('page',newPage=>newPage.on('pageerror',error=>{if(/analytics_events/.test(error.message)&&/access control/i.test(error.message)){evidence.expectedBlockedErrors??=[];evidence.expectedBlockedErrors.push(error.message);}else evidence.pageErrors.push(error.message);}));await page.goto(base+'/?vault=1',{waitUntil:'domcontentloaded'});await ready(page);return{ctx,page,fixture};}
async function ready(page){await page.locator('.tl-root.tl-play').waitFor();await page.getByText('Loading player cards…',{exact:true}).waitFor({state:'hidden',timeout:60000});}
async function tab(page,name){
    activePage=page;
    await page.bringToFront();
    const labels={HOME:'Home',GAMEDAY:'Game Day',ROSTER:'Lineup',WAIVERS:'Waivers',TRADES:'Trades',ACTIVITY:'Activity'};
    if(await page.locator('.tl-sidenav').isVisible()){
        const target=page.locator('.tl-sidenav').getByRole('button',{name,exact:true});if(!/\bactive\b/.test(await target.getAttribute('class')||''))await target.click();
    }else if(name==='ACTIVITY'){
        await page.locator('.tl-mobile-nav').getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'More Vault views',exact:true}).getByRole('button',{name:labels[name],exact:true}).click();
    }else{
        const target=page.locator('.tl-mobile-nav').getByRole('button',{name:labels[name],exact:true});if(await target.getAttribute('aria-current')!=='page')await target.click();
    }
    // Navigation intentionally scrolls the game root on the next animation frame.
    // Let that completed navigation settle before scrolling to a later action.
    let frameTimer;
    try{
        await Promise.race([
            page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),
            new Promise((resolve,reject)=>{frameTimer=setTimeout(()=>reject(new Error('Navigation did not settle within3s')),3000);})
        ]);
    }catch(error){error.message+=': '+JSON.stringify(await page.evaluate(()=>({visibility:document.visibilityState,hasFocus:document.hasFocus(),title:document.title})));throw error;}
    finally{clearTimeout(frameTimer);}
}
async function shot(page,name,all=false){
    await page.bringToFront();
    for(const [width,height]of(useWebKit?[[390,844],[430,932]]:all?[[390,844],[430,932],[1024,1366],[1366,1024],[1440,900]]:[[390,844],[1440,900]])){
        await page.setViewportSize({width,height});await wait(150);
        assert.equal(await page.locator('.tl-root.tl-play').count(),1,'One Vault application root');if(name==='quarterback-cap-reason'){const problem=page.locator('#vault-claim-problem');assert(await problem.evaluate(el=>{const r=el.getBoundingClientRect(),d=el.closest('dialog').getBoundingClientRect();return r.top>=Math.max(0,d.top)&&r.bottom<=Math.min(innerHeight,d.bottom);}), 'Named QB-cap reason remains in the visible modal beside disabled File');await hitTest(problem);}
        const geometry=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,footerHeight:document.querySelector('.tl-week-action-row')?.getBoundingClientRect().height||0}));
        assert(geometry.scrollWidth<=width+1,name+' overflows '+width);
        assert(geometry.footerHeight<=height*.4,name+' footer occupies too much viewport at '+width);
        evidence.viewportChecks??=[];evidence.viewportChecks.push({name,width,height,...geometry});
        const file=(baseline?'before-':'after-')+(useWebKit?'webkit-':'')+name+'-'+width+'.png';
        // Full-page Chrome capture can repeat the fixed app shell. After evidence uses real viewports.
        await page.screenshot({path:path.join(output,file),fullPage:false,animations:'disabled'});evidence.screenshots.push(file);
    }
    await page.setViewportSize({width:390,height:844});await wait(150);
}
async function hitTest(locator){
    let details;
    for(let attempt=0;attempt<40;attempt++){
        details=await locator.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{reachable:top===el||el.contains(top),target:{text:el.textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right},blocking:top?{tag:top.tagName,className:String(top.className),text:top.textContent.slice(0,160)}:null};});
        if(details.reachable)return;await wait(50);
    }
    if(process.argv.includes('--diagnose-scroll')){
        const inspect=el=>{const rect=node=>{const r=node.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};const entries=[];for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);entries.push({tag:node.tagName,className:String(node.className),id:node.id,rect:rect(node),overflowY:style.overflowY,overflowX:style.overflowX,scrollBehavior:style.scrollBehavior,position:style.position,height:style.height,minHeight:style.minHeight,maxHeight:style.maxHeight,scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,inlineOverflow:node.style.overflow});}const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{reachable:top===el||el.contains(top),ancestors:entries,window:{scrollY,innerHeight,docHeight:document.documentElement.scrollHeight,bodyOverflow:document.body.style.overflow,htmlOverflow:document.documentElement.style.overflow},footer:rect(document.querySelector('.tl-week-action-row')),nav:rect(document.querySelector('.tl-mobile-nav'))};};
        const diagnostic={before:await locator.evaluate(inspect)},diagPage=locator.page(),prefix='scroll-diagnostic-'+(useWebKit?'webkit':'chromium');await diagPage.screenshot({path:path.join(output,prefix+'-before.png'),animations:'disabled'});
        diagnostic.ancestorScroll=await locator.evaluate(el=>{const changes=[];for(let node=el.parentElement;node;node=node.parentElement){if(node.scrollHeight>node.clientHeight+1){const before=node.scrollTop;node.scrollTop+=250;changes.push({tag:node.tagName,className:String(node.className),before,after:node.scrollTop});}}return changes;});await wait(300);diagnostic.afterAncestorScroll=await locator.evaluate(inspect);
        await diagPage.evaluate(()=>window.scrollBy(0,250));await wait(300);diagnostic.afterWindowScroll=await locator.evaluate(inspect);
        await diagPage.mouse.move(180,380);await diagPage.mouse.wheel(0,250);await wait(300);diagnostic.afterWheel=await locator.evaluate(inspect);await diagPage.screenshot({path:path.join(output,prefix+'-after.png'),animations:'disabled'});fs.writeFileSync(path.join(output,prefix+'.json'),JSON.stringify(diagnostic,null,2));
    }
    assert.equal(details.reachable,true,'Action center remains obstructed after settled scroll: '+JSON.stringify(details));
}
function makeFixture(hiddenYears=false,{bench=1,maxQBs=2}={}){
    let s=E.normalizeTimeLeague(E.createTimeLeague({name:'Acquisition QA',seed:'vault-acquisition-qa',createdAt:stamp,seats:[{name:'Archive Atlas',manager:'human'},{name:'Morgan Rival',manager:'human'}],settings:{gameDeckVersion:1,hiddenYears,rosterSlots:{QB:1,RB:1,WR:1,BN:bench},maxQuarterbacks:maxQBs,regularSeasonWeeks:14,playoffTeams:0,draftPickSeconds:0,draftAiSeconds:.5,eraRules:{mode:'any-era',decades:[]},waiversEnabled:true,waiverMode:'faab',faabBudget:100,tradesEnabled:true,scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2}}}));
    s=E.startDraft(s,stamp);
    const choices={t1:['Patrick Mahomes','LaDainian Tomlinson','Calvin Johnson','Marvin Harrison'],t2:['Josh Allen','Barry Sanders','Jerry Rice','Randy Moss']};
    while(s.phase==='draft'){
        const seat=E.currentDraftSeat(s),team=s.teams.find(t=>t.teamId===seat.teamId),name=choices[team.teamId][team.roster.length],card=[...data.cards.values()].find(c=>c.name===name);
        assert(card,name);s=E.normalizeTimeLeague(E.applyDraftPick(s,card,{madeBy:'human',createdAt:stamp}));
    }
    assert(s.teams.every(t=>!E.lineupProblems(s,t.teamId).length));return s;
}
function save(name,s){fs.writeFileSync(path.join(output,name+'-fixture.json'),JSON.stringify(s,null,2));}
async function stage(page,wanted){await page.waitForFunction(wanted=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId))).weekStage===wanted;},wanted);}
async function manager(page,id){await page.getByRole('combobox',{name:'Hotseat manager',exact:true}).selectOption(id);await page.waitForFunction(id=>document.querySelector('[aria-label="Hotseat manager"]')?.value===id,id);}
async function buildClaim(page,target,drop,bid){
    await tab(page,'WAIVERS');await page.getByRole('textbox',{name:'Search free agents',exact:true}).fill(target);
    const targetButton=page.getByRole('button',{name:'Claim '+target,exact:true});await targetButton.evaluate(el=>el.scrollIntoView({block:'center',behavior:'auto'}));await hitTest(targetButton);await targetButton.click();const dialog=page.getByRole('dialog',{name:'Waiver claim',exact:true});await dialog.waitFor();
    if(drop)await dialog.getByRole('button',{name:'Drop '+drop,exact:true}).click();
    await dialog.getByRole('spinbutton',{name:'FAAB bid',exact:true}).fill(String(bid));return dialog;
}
async function touchTarget(locator){await locator.evaluate(el=>el.scrollIntoView({block:'center',behavior:'auto'}));await hitTest(locator);assert(await locator.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=43.5&&r.height>=43.5;}));}
async function fileClaim(page,target,drop,bid,{capture=false}={}){
    let dialog=await buildClaim(page,target,drop,bid);
    if(capture){
        await shot(page,'claim-decision',true);await textScale(page,1.25);
        assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Enlarged modal has no horizontal overflow');
        await touchTarget(dialog.getByRole('button',{name:'Close',exact:true}));await phoneShot(page,'claim-enlarged-close');
        await touchTarget(dialog.getByRole('button',{name:'⚖ FILE CLAIM',exact:true}));await phoneShot(page,'claim-enlarged-submit');
        await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
        assert.equal(await page.getByRole('button',{name:'Claim '+target,exact:true}).evaluate(el=>el===document.activeElement),true,'Native Escape restores focus to the target');
        await textScale(page,1);dialog=await buildClaim(page,target,drop,bid);
        evidence.checks.push('At125% text the claim modal fits without horizontal overflow, Close and submit remain44px touch targets; native Escape closes and returns focus to the selected player');
    }
    await repeated(dialog.getByRole('button',{name:'⚖ FILE CLAIM',exact:true}));
    await page.waitForFunction(target=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId))).pendingClaims.some(c=>c.addName===target);},target);
    assert.match(await dialog.innerText(),/Claim filed for/);
    await dialog.getByRole('button',{name:'Review pending claims',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('.tl-pending-claims')===document.activeElement,{},{timeout:2000});assert.equal(await page.getByRole('region',{name:'Your pending claims',exact:true}).evaluate(el=>el===document.activeElement),true,'Review moves settled keyboard focus to the pending list');
}
async function cancel(page,target){activePage=page;await page.bringToFront();const cancelButton=page.getByRole('button',{name:'Cancel claim for '+target,exact:true});await touchTarget(cancelButton);await cancelButton.evaluate(el=>{el.click();el.click();});await page.waitForFunction(target=>{const p=JSON.parse(localStorage.getItem('wr-time-league-ui-v1'));return !App.TimeLeagueStorage.decode(localStorage.getItem(App.TimeLeagueTypes.timeLeagueStorageKey(p.leagueId))).pendingClaims.some(c=>c.addName===target);},target);}
async function runWaivers(page){await tab(page,'WAIVERS');await repeated(page.locator('.tl-week-action-buttons').getByRole('button',{name:'Run waivers',exact:true}));await stage(page,'lineup');}

function recoveryFixture(priorClaim=true){
    let clean=makeFixture();
    if(priorClaim){
        const drop=clean.teams[0].roster.find(e=>e.slot==='BN'),card=E.freeAgents(clean,data.cards).find(c=>c.position==='WR');
        clean=act(clean,'claim',{teamId:'t1',identity:card.identity,dropEntryId:drop.entryId,bidAmount:7});
    }
    clean=act(clean,'process-claims');clean=act(clean,'finalize-rosters');clean=act(clean,'week');
    assert.equal(clean.weekStage,'postgame');assert.equal(clean.finalizedWeeks.length,1);
    clean=act(clean,'advance-week');clean=act(clean,'process-claims');
    const current=App.TimeLeagueEngine;
    require('node:vm').runInThisContext(execFileSync('git',['show','b9dbf36:js/shared/time-league-engine.js'],{cwd:root,encoding:'utf8'}),{filename:'legacy-b9dbf36-engine.js'});
    const legacy=App.TimeLeagueEngine;App.TimeLeagueEngine=current;
    const from=clean.teams[0],to=clean.teams[1],give=from.roster.find(e=>e.position==='RB'),receive=to.roster.find(e=>e.name==='Jerry Rice');
    let broken=legacy.proposeTrade(clean,{fromTeamId:'t1',toTeamId:'t2',giveEntryIds:[give.entryId],receiveEntryIds:[receive.entryId]},stamp);
    broken=legacy.respondToTrade(broken,broken.trades.at(-1).tradeId,true,'Legacy accepted position exchange',stamp);
    broken=E.normalizeTimeLeague(broken);
    for(const team of broken.teams)broken=E.autoFillLineup(broken,team.teamId,data.cards);
    assert.equal(broken.trades.at(-1).status,'accepted');assert(!broken.teams[0].roster.some(e=>e.position==='RB'));
    assert.equal(E.rosterFeasibility(broken.teams[0].roster,broken.settings).legal,false);
    assert.equal(E.rosterFeasibility(broken.teams[1].roster,broken.settings).legal,true);
    assert.equal(broken.finalizedWeeks.length,1);return broken;
}
function init(){
    const broken=recoveryFixture();save('acceptance-lineup',broken);save('acceptance-ready',{...broken,weekStage:'ready'});
    save('acceptance-trades-only',{...broken,settings:{...broken.settings,waiversEnabled:false,tradesEnabled:true}});
    save('acceptance-disabled',{...broken,settings:{...broken.settings,waiversEnabled:false,tradesEnabled:false}});
    let fixable=makeFixture();fixable=act(fixable,'process-claims');fixable={...fixable,teams:fixable.teams.map((team,index)=>index?team:{...team,roster:team.roster.map(e=>e.position==='RB'?{...e,slot:'BN'}:e)})};
    assert.equal(E.rosterFeasibility(fixable.teams[0].roster,fixable.settings).legal,true);assert(E.lineupProblems(fixable,'t1').length);save('acceptance-fixable',fixable);
    fs.writeFileSync(path.join(output,'acceptance-fixture-provenance.json'),JSON.stringify({source:'Real draft/cards/logs; real7FAAB week1WR waiver; scored week1; week2 older b9dbf36 engine accepts RB-for-WR exchange; eligible bench autofill; current normalization. No live data used.',budget:broken.teams[0].faabRemaining,oldWaiverResults:broken.waiverResults.length,oldFinalizedWeeks:broken.finalizedWeeks.length,legacyTrade:broken.trades.at(-1).status},null,2));
}
async function guardChecks(){
    const lineup=JSON.parse(fs.readFileSync(path.join(output,'acceptance-lineup-fixture.json'))),before=JSON.stringify(lineup);
    assert.equal(E.planningRecovery(lineup).available,true);
    assert.throws(()=>A.applyOnlineAction(lineup,{type:'reopen-planning'},{seat_team_id:'t1',role:'member'},data,stamp),/commissioner/i);
    assert.throws(()=>A.applyOnlineAction(lineup,{type:'reopen-planning'},{seat_team_id:'t999',role:'commissioner'},data,stamp),/manager/i);
    const reopened=act(lineup,'reopen-planning');assert.equal(reopened.weekStage,'claims');assert.equal(reopened.planningRecoveryWeek,lineup.currentWeek);assert.equal(E.planningRecovery(reopened).active,true);
    assert.throws(()=>act(reopened,'reopen-planning'),/already open/i);
    const scored={...lineup,currentWeek:1};assert.throws(()=>act(scored,'reopen-planning'),/already been scored/i);
    for(const stageName of['claims','postgame'])assert.throws(()=>act({...lineup,weekStage:stageName},'reopen-planning'),/before kickoff/i);
    const bothOff=JSON.parse(fs.readFileSync(path.join(output,'acceptance-disabled-fixture.json')));assert.throws(()=>act(bothOff,'reopen-planning'),/both disabled/i);
    const tradesOnly=JSON.parse(fs.readFileSync(path.join(output,'acceptance-trades-only-fixture.json')));assert.equal(E.planningRecovery(tradesOnly).available,true);
    const fixable=JSON.parse(fs.readFileSync(path.join(output,'acceptance-fixable-fixture.json')));assert.equal(E.planningRecovery(fixable).available,false);
    assert.equal(JSON.stringify(lineup),before);assert.deepEqual(reopened.finalizedWeeks,lineup.finalizedWeeks);assert.deepEqual(reopened.waiverResults,lineup.waiverResults);assert.deepEqual(reopened.trades,lineup.trades);assert.deepEqual(reopened.teams,lineup.teams);
    evidence.checks.push('Shared action fixtures: only a commissioner with a human seat can reopen an unscored impossible roster in lineup/ready; repeated, scored, claims/postgame and both-acquisitions-disabled intents reject; trades-only is permitted; merely misplaced eligible players do not reopen. Failed intents mutate nothing; saved results, awards, trade and teams remain exact.');
}

async function repeated(button){await button.click({trial:true});await button.evaluate(el=>{el.click();el.click();});}
function kept(before,after){
    assert.deepEqual(after.finalizedWeeks,before.finalizedWeeks,'Reopening preserves saved games');
    assert.deepEqual(after.waiverResults,before.waiverResults,'Reopening preserves settled awards');
    assert.deepEqual(after.trades,before.trades,'Reopening preserves settled trades');
    assert.deepEqual(after.teams,before.teams,'Reopening preserves all teams and spent FAAB');
}
async function recoveryPrompt(page){
    await tab(page,'ROSTER');const region=page.getByRole('region',{name:'Roster recovery required',exact:true});await region.waitFor();
    assert.match(await region.innerText(),/cannot fill every required slot/);
    await region.locator('summary').click();
    assert.match(await region.innerText(),/Existing waiver awards, settled trades, spent FAAB and completed games stay saved/);
    return region;
}
async function textScale(page,scale){await page.evaluate(scale=>{if(window.__qaFontSizes){for(const[el,value,priority]of window.__qaFontSizes)if(el.isConnected){if(value)el.style.setProperty('font-size',value,priority);else el.style.removeProperty('font-size');}delete window.__qaFontSizes;}if(scale!==1){const elements=[...document.querySelectorAll('.tl-root *')];window.__qaFontSizes=elements.map(el=>[el,el.style.getPropertyValue('font-size'),el.style.getPropertyPriority('font-size')]);const sizes=elements.map(el=>parseFloat(getComputedStyle(el).fontSize));elements.forEach((el,index)=>el.style.setProperty('font-size',(sizes[index]*scale)+'px','important'));}},scale);await wait(200);}
async function phoneShot(page,name){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file='after-'+(useWebKit?'webkit-':'')+name+'-390.png';await page.screenshot({path:path.join(output,file),animations:'disabled'});evidence.screenshots.push(file);}
async function reopen(page,{capture=false}={}){
    const before=await state(page),footerSurface=before.weekStage==='ready';let region,details;if(footerSurface){await tab(page,'HOME');details=page.locator('.tl-gate-planning-recovery');await details.locator('summary').click();region=page.getByRole('region',{name:'Confirm planning recovery',exact:true});await region.waitFor();const readiness=page.locator('.tl-gate-readiness');await readiness.locator('summary').click();assert.equal(await details.getAttribute('open'),null);const review=page.getByRole('button',{name:'Review Archive Atlas roster',exact:true});await touchTarget(review);await shot(page,'recovery-ready-readiness-after-toggle');await details.locator('summary').click();assert.equal(await readiness.getAttribute('open'),null);await region.waitFor();evidence.checks.push('Actual footer recovery→readiness→recovery summary clicks keep one disclosure open; named roster review is44px and unobstructed, so the confirmations cannot cover each other.');}else{region=await recoveryPrompt(page);details=region.locator('details');}const summary=details.locator('summary'),prefix='recovery-'+before.weekStage,confirm=region.getByRole('button',{name:'Confirm reopen planning',exact:true});
    await touchTarget(confirm);
    if(capture){
        await shot(page,prefix+'-confirmation',true);await textScale(page,1.25);
        await touchTarget(confirm);await phoneShot(page,prefix+'-enlarged-confirm');
        await touchTarget(region.getByRole('button',{name:'Keep current stage',exact:true}));await phoneShot(page,prefix+'-enlarged-cancel');
        await region.getByRole('button',{name:'Keep current stage',exact:true}).click();assert.equal(await details.getAttribute('open'),null);assert(await summary.evaluate(el=>el===document.activeElement));
        await summary.click();await confirm.focus();await page.keyboard.press('Escape');assert.equal(await details.getAttribute('open'),null);assert(await summary.evaluate(el=>el===document.activeElement));
        kept(before,await state(page));await textScale(page,1);await summary.click();
    }
    await touchTarget(confirm);await repeated(confirm);await stage(page,'claims');
    const after=await state(page);kept(before,after);assert.equal(after.planningRecoveryWeek,before.currentWeek);assert.equal(after.activity.filter(event=>event.message.includes('Planning reopened W'+before.currentWeek)).length,1);
    assert.equal(await page.locator('.tl-mobile-nav').getByRole('button',{name:'Waivers',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.getByRole('combobox',{name:'Hotseat manager',exact:true}).inputValue(),'t1');
    const saved=JSON.stringify(after);await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(JSON.stringify(await state(page)),saved);
    const active=page.getByRole('region',{name:'Reopened planning window',exact:true});await active.waitFor();assert.match(await active.innerText(),/Computer managers will not file another automatic waiver batch/);await active.scrollIntoViewIfNeeded();await shot(page,prefix+'-open-window',true);return after;
}
async function completeRepair(page,before){
    const target=E.freeAgents(before,data.cards).find(c=>c.position==='RB'),drop=before.teams[0].roster.find(e=>e.name==='Jerry Rice');assert(target&&drop);
    await fileClaim(page,target.name,drop.name,7);const filed=await state(page);assert.equal(filed.teams[0].faabRemaining,93);assert.equal(filed.pendingClaims.length,1);
    await runWaivers(page);const repaired=await state(page);assert.equal(repaired.pendingClaims.length,0);assert.equal(repaired.teams[0].faabRemaining,86);assert.equal(repaired.waiverResults.filter(r=>r.week===2&&r.identity===target.identity).length,1);assert.deepEqual(repaired.waiverResults.filter(r=>r.week===1),before.waiverResults.filter(r=>r.week===1));assert.deepEqual(repaired.finalizedWeeks,before.finalizedWeeks);assert.deepEqual(repaired.trades,before.trades);assert.equal(E.lineupProblems(repaired,'t1').length,0);
    const receipt=page.getByRole('region',{name:'Week 2 waiver results',exact:true});await receipt.waitFor();assert((await receipt.innerText()).includes('Added '+target.name));await receipt.scrollIntoViewIfNeeded();await shot(page,'recovery-repaired-roster',true);
    await receipt.getByRole('button',{name:'View waiver activity',exact:true}).click();const full=page.getByRole('region',{name:'Week 2 waiver results',exact:true});assert((await full.innerText()).includes(target.name));await full.getByRole('button',{name:'View lineup',exact:true}).click();
    const lock=page.locator('.tl-week-action-buttons').getByRole('button',{name:'Lock lineup',exact:true});assert(await lock.isEnabled());await repeated(lock);await stage(page,'ready');
    await tab(page,'GAMEDAY');await repeated(page.locator('.tl-week-action-buttons').getByRole('button',{name:'Start game day',exact:true}));
    await page.getByRole('button',{name:'INSTANT',exact:true}).waitFor();let saved=await state(page);assert.equal(saved.finalizedWeeks.length,2);assert.deepEqual(saved.finalizedWeeks[0],before.finalizedWeeks[0]);assert.equal(saved.teams[0].faabRemaining,86);
    await page.getByRole('button',{name:'INSTANT',exact:true}).click();await tab(page,'WAIVERS');const postReceipt=page.getByRole('region',{name:'Week 2 waiver results',exact:true});await postReceipt.waitFor();assert((await postReceipt.innerText()).includes(target.name));await tab(page,'HOME');await shot(page,'recovery-week2-saved-result',true);
    const exact=JSON.stringify(saved.finalizedWeeks);await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(JSON.stringify((await state(page)).finalizedWeeks),exact);
    await repeated(page.locator('.tl-week-action-buttons').getByRole('button',{name:'End week',exact:true}));await stage(page,'claims');saved=await state(page);assert.equal(saved.currentWeek,3);assert.equal(JSON.stringify(saved.finalizedWeeks),exact);assert.deepEqual(saved.trades,before.trades);
    evidence.checks.push('Actual recovery claim replaces the excessWR with an eligibleRB, spends exactly7 from the already-spent93budget, preserves W1award/result and legacy acceptedtrade, then legal Lock→Start→savedW2result→reload→repeatedEndweek advances once toW3.');
}
async function journey(){
    for(const name of['lineup','ready']){
        const{ctx,page,fixture}=await open('acceptance-'+name,'roster');if(name==='ready'){await tab(page,'HOME');const guidance=page.getByRole('button',{name:'Review roster needs →',exact:true});await guidance.waitFor();assert.match(await page.locator('body').innerText(),/This roster cannot fill every required slot/);await shot(page,'ready-home-recovery-guidance',true);await guidance.click();await page.getByRole('region',{name:'Roster recovery required',exact:true}).waitFor();await manager(page,'t2');}await reopen(page,{capture:true});
        evidence.checks.push(`${name} recovery: named impossible roster and inline consequences lead to one persisted planning reopening; cancel/Escape preserve state, local affected manager is selected, active Players route and reload retain the same saved window.`);
        if(name==='lineup')await completeRepair(page,fixture);await ctx.close();
    }
}
async function affordances(){
    for(const name of['fixable','disabled','trades-only']){
        const{ctx,page}=await open('acceptance-'+name,'roster'),before=await state(page);
        const region=page.getByRole('region',{name:'Roster recovery required',exact:true});
        if(name==='fixable'){assert.equal(await region.count(),0);assert.equal(await page.getByText('Reopen planning',{exact:true}).count(),0);}
        else if(name==='disabled'){await region.waitFor();assert.match(await region.innerText(),/both disabled/);assert.equal(await region.locator('summary').count(),0);await region.scrollIntoViewIfNeeded();await shot(page,'recovery-both-disabled');}
        else {await region.waitFor();await region.locator('summary').click();assert.match(await region.innerText(),/propose compatible trades/);const confirm=region.getByRole('button',{name:'Confirm reopen planning',exact:true});await touchTarget(confirm);await confirm.click();await stage(page,'claims');await page.getByRole('button',{name:'Trade builder',exact:true}).waitFor();kept(before,await state(page));await shot(page,'recovery-trades-only');}
        evidence.checks.push(`${name}: recovery affordance follows actual roster feasibility and enabled acquisitions; supported trades-only route preserves saved state.`);await ctx.close();
    }
}
async function failedSave(){
    const{ctx,page}=await open('acceptance-ready','roster'),before=await state(page);await manager(page,'t2');await tab(page,'HOME');await page.locator('.tl-gate-planning-recovery > summary').click();const region=page.getByRole('region',{name:'Confirm planning recovery',exact:true});await region.waitFor();
    await page.evaluate(()=>{window.__qaStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('wr-time-league-v1:'))throw new DOMException('Disposable QA storage quota','QuotaExceededError');return window.__qaStorageSet.call(this,key,value);};});
    await region.getByRole('button',{name:'Confirm reopen planning',exact:true}).click();const alert=page.getByRole('alert',{name:'Save recovery',exact:true});await alert.waitFor();assert.equal(JSON.stringify(await state(page)),JSON.stringify(before));await shot(page,'recovery-save-failed');
    await page.evaluate(()=>{Storage.prototype.setItem=window.__qaStorageSet;delete window.__qaStorageSet;});await alert.getByRole('button',{name:'Retry save',exact:true}).click();await alert.waitFor({state:'hidden'});await stage(page,'claims');const retried=await state(page);kept(before,retried);assert.equal(await page.getByRole('combobox',{name:'Hotseat manager',exact:true}).inputValue(),'t1');assert.equal(retried.activity.filter(e=>e.message.includes('Planning reopened W2')).length,1);assert.equal(await page.locator('.tl-mobile-nav').getByRole('button',{name:'Waivers',exact:true}).getAttribute('aria-current'),'page');
    const exact=JSON.stringify(retried);await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(JSON.stringify(await state(page)),exact);evidence.checks.push('A real local persistence failure leaves the old ready save exact; accessible Retry saves the same reopening once, selects the active Players route, and reload preserves it.');await ctx.close();
}
(async()=>{try{init();evidence.sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();await guardChecks();if(!process.argv.includes('--guards-only')){browser=useWebKit?await webkit.launch({headless:true,executablePath:process.env.PLAYWRIGHT_WEBKIT_PATH||'/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh'}):await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--host-resolver-rules=MAP vault-qa.test 127.0.0.1']});await journey();await affordances();await failedSave();}assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.routeErrors||[],[]);evidence.passed=true;}catch(error){evidence.passed=false;evidence.error=error.message;console.error(error);if(activePage&&!activePage.isClosed()){fs.writeFileSync(path.join(output,(useWebKit?'webkit-':'')+'failure.txt'),await activePage.locator('body').innerText());await activePage.screenshot({path:path.join(output,(useWebKit?'webkit-':'')+'failure.png'),animations:'disabled'});}process.exitCode=1;}finally{if(browser)await Promise.race([browser.close(),wait(5000)]);evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,process.argv.includes('--guards-only')?'guard-verification.json':useWebKit?'webkit-verification.json':'verification.json'),JSON.stringify(evidence,null,2));process.exit(process.exitCode||0);}})();
