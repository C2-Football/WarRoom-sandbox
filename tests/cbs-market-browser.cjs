'use strict';
// Local built entrypoint, synthetic provider inputs, all backend calls disabled.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('@playwright/test');
const {installReadOnlyRoutes}=require('./helpers/browser-readonly.cjs');
const {createLeagueSkinFixture}=require('./helpers/league-skin-fixture.cjs');
const Market=require('../js/shared/redraft-market.js');
const origin=process.env.RELIABILITY_URL||'http://127.0.0.1:3517';
const id='qa-redraft',user='reliability-fixture',source=createLeagueSkinFixture({redraftId:id,dynastyId:'qa-dynasty',user});
const players=Object.fromEntries(Array.from({length:180},(_,i)=>{
 const pos=['QB','RB','WR','TE','RB','WR'][i%6];return ['r'+i,{player_id:'r'+i,full_name:'Fixture '+pos+' '+i,first_name:'Fixture',last_name:pos+' '+i,position:pos,fantasy_positions:[pos],team:'BUF',active:true,status:'Active',age:25,years_exp:3,depth_chart_order:1,...(i===37?{injury_status:'IR'}:{})}];
}));
const line=(pid,gp=1)=>{const i=Number(pid.slice(1)),v=i<36?10+i%6:15+i%7;return {gp,pass_att:30*gp,pass_cmp:20*gp,pass_yd:v*15*gp,pass_td:2*gp,pass_fd:10*gp,rush_att:10*gp,rush_yd:v*5*gp,rec:4*gp,rec_tgt:7*gp,rec_yd:v*5*gp};};
const stats=gp=>Object.fromEntries(Object.keys(players).map(pid=>[pid,line(pid,gp)]));
function fixture(mode){return url=>{
 if(url.hostname.includes('fantasycalc'))return [];
 if(url.pathname.includes('nfl-scoreboard')||url.hostname.includes('espn'))return {events:[]};
 const data=source(url);if(!/^api\.sleeper\.(app|com)$/.test(url.hostname))return data;
 const p=url.pathname;
 if(p.endsWith('/players/nfl'))return players;
 if(p.endsWith('/state/nfl'))return {season:'2026',league_season:'2026',season_type:'regular',week:8,display_week:9};
 if(/\/(stats|projections)\//.test(p))return stats(/\/2026\/\d+$/.test(p)?1:p.includes('projections')?17:7);
 const transform=l=>({...l,name:'Reliability fixture',status:'in_season',roster_positions:['QB','RB','WR','TE','BN','BN'],settings:{...l.settings,leg:8,playoff_end_week:17,waiver_budget:100,disable_adds:mode==='disabled'?1:0}});
 if(p.endsWith('/rosters'))return source(new URL('https://api.sleeper.app/v1/league/qa-dynasty/rosters')).slice(0,mode==='partial'?5:6).map((r,i)=>({...r,league_id:id,players:Array.from({length:6},(_,j)=>'r'+(i*6+j)),starters:Array.from({length:4},(_,j)=>'r'+(i*6+j)),settings:{...r.settings,wins:4,losses:3,fpts:700,waiver_budget_used:mode==='exhausted'?100:20}}));
 if(p.includes('/matchups/'))return Array.from({length:6},(_,i)=>({roster_id:i+1,matchup_id:Math.floor(i/2)+1,players:Array.from({length:6},(_,j)=>'r'+(i*6+j)),starters:Array.from({length:4},(_,j)=>'r'+(i*6+j)),points:70,players_points:Object.fromEntries(Array.from({length:6},(_,j)=>['r'+(i*6+j),10]))}));
 if(Array.isArray(data)&&data[0]?.league_id&&data[0]?.scoring_settings)return data.filter(l=>l.league_id===id).map(transform);
 if(data?.scoring_settings)return transform(data);
 if(p.endsWith('/drafts')&&Array.isArray(data))return data.map(d=>({...d,status:'complete'}));
 if(data?.draft_id)return {...data,status:'complete'};
 return data;
};}
(async()=>{
 fs.mkdirSync('output/playwright/cbs',{recursive:true});
 const now=Date.now(),chart={sourceUrl:'https://www.cbssports.com/fantasy/football/news/fixture-trade-chart/',attribution:'CBS Sports (synthetic browser fixture)',season:2026,week:8,publishedAt:new Date(now-3600000).toISOString(),updatedAt:null,columns:Market.COLUMNS,rows:Object.entries(players).map(([id,p],i)=>({name:p.full_name,position:p.position,team:p.team,values:Object.fromEntries(Market.COLUMNS[p.position].map(c=>[c,50-i%20]))}))};
 const snapshot=await Market.createSnapshot(chart,players,{season:2026,week:8,now});let failSnapshot=false;
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{for(const mode of ['complete']){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await installReadOnlyRoutes(context,{fixture:fixture(mode)});
 await context.route('**/*.supabase.co/**',route=>route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:'{"error":"Fixture backend disabled"}'}));
 await context.addInitScript(({user})=>{const account='10000000-0000-4000-8000-000000000017';const payload=btoa(JSON.stringify({sub:account,exp:Math.floor(Date.now()/1000)+3600}));localStorage.setItem('fw_session_v1',JSON.stringify({token:'fixture.'+payload+'.fixture',user:{id:account,email:'fixture@example.invalid'}}));localStorage.setItem('wr_active_connection_owner_v1','account:'+account);localStorage.setItem('od_auth_v1',JSON.stringify({username:user,sleeperUsername:user}));localStorage.setItem('dynastyhq_username',user);localStorage.setItem('od_profile_v1',JSON.stringify({onboardingComplete:true}));localStorage.setItem('wr_tutorial_done_v1','1');},{user});
 await context.route('**/content/markets/cbs/config.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({snapshotUrl:'https://raw.githubusercontent.com/fixture/cbs/current.json',statusUrl:'https://raw.githubusercontent.com/fixture/cbs/status.json',automationStatus:'Fixture only; no live automation.'})}));
 await context.route('https://raw.githubusercontent.com/fixture/cbs/**',route=>route.fulfill({status:failSnapshot?503:200,contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('status.json')?{status:'ok',checkedAt:new Date(now).toISOString()}:snapshot)}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/dist-preview/?dev=true&user='+user+'#league='+id+'&tab=fa',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.App?.buildFreeAgencyActionBoard&&window.S?.currentLeagueId==='qa-redraft',null,{timeout:60000}).catch(async e=>{fs.writeFileSync('output/playwright/cbs/debug.txt',JSON.stringify({text:await page.locator('body').innerText(),errors,state:await page.evaluate(()=>({id:window.S?.currentLeagueId,app:Object.keys(window.App||{})}))},null,2));throw e;});
 const read=await page.evaluate(()=>{const league=window.S.leagues.find(l=>l.league_id==='qa-redraft');const roster=league.rosters[0];const board=App.buildFreeAgencyActionBoard({currentLeague:league,myRoster:roster,playersData:S.players,statsData:S.statsData,prevStatsData:S.prevStatsData,leagueSkin:{type:'redraft'},readOnly:true});return {reason:board.reason,count:board.priorityAdds.length,leagueCount:league.rosters.length,pts:calcFantasyPts({pass_cmp:20,pass_fd:10,pass_yd:250,pass_td:2},{pass_cmp:.5,pass_fd:1,pass_yd:.04,pass_td:4},'QB')};});
 assert.equal(read.pts,38);if(mode==='complete') {assert.equal(read.reason,undefined);assert(read.count>0,'complete fixture must offer measured upgrades');} if(mode==='exhausted')assert.match(read.reason,/FAAB|minimum|budget/);if(mode!=='complete'){assert.equal(read.count,0);assert.match(read.reason,/rosters|disabled|budget|FAAB|minimum/i);}
 await page.screenshot({path:'output/playwright/cbs/waivers-'+mode+'.png',fullPage:true});
 fs.writeFileSync('output/playwright/cbs/'+mode+'.txt',await page.locator('body').innerText());
 if(mode==='complete'){
   await page.evaluate(()=>window.wrNavigateTab('trades'));
   await page.waitForFunction(()=>document.body.innerText.includes('Trade Finder'),{timeout:60000});
   await page.waitForFunction(()=>window.App?.CbsMarket?.snapshot && window.App?.PlayerValue?.rosState?.()?.marketBasis?.cbs?.active,null,{timeout:30000});
   await page.locator('.tc-cbs-basis summary').first().click();
   assert.match(await page.locator('.tc-cbs-basis').first().innerText(),/Week 8/);
   assert.match(await page.locator('.tc-cbs-basis').first().innerText(),/Published:/);
   await page.getByRole('button',{name:'Find trade ideas',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.mc-trade-board') || document.body.innerText.includes('No supported roster improvement'),null,{timeout:60000}).catch(async e=>{fs.writeFileSync('output/playwright/cbs/scan-debug.txt',JSON.stringify({text:await page.locator('body').innerText(),errors},null,2));throw e;});
   assert.doesNotMatch(await page.locator('body').innerText(),/winning chance|uncontested|Est.\s*accept/i);
   fs.writeFileSync('output/playwright/cbs/trades.txt',await page.locator('body').innerText());
   await page.screenshot({path:'output/playwright/cbs/trades-390.png',fullPage:true});
   await page.getByRole('button',{name:'Add Fixture WR 11 to the builder',exact:true}).click();
   await page.locator('.mc-trade-builder-sides').waitFor({timeout:15000});
   const basis=page.locator('.tc-cbs-basis').last();await basis.locator('summary').click();
   const before=await page.evaluate(()=>({value:App.PlayerValue.getSeasonValue('r11'),points:App.PlayerValue.getRosPoints('r11'),version:App.CbsMarket.snapshot.id}));
   const next=JSON.parse(JSON.stringify(chart));next.rows.find(r=>r.name==='Fixture WR 11').values={'non':160,'0.5':160,PPR:160};
   await page.getByLabel('Import CBS chart JSON',{exact:true}).last().setInputFiles({name:'chart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(next))});
   await page.waitForFunction(version=>App.CbsMarket.snapshot.id!==version&&App.PlayerValue.rosState(),before.version);
   const after=await page.evaluate(()=>({value:App.PlayerValue.getSeasonValue('r11'),points:App.PlayerValue.getRosPoints('r11'),version:App.CbsMarket.snapshot.id}));
   assert.notEqual(after.value,before.value);assert.equal(after.points,before.points);
   assert.match(await basis.innerText(),/CBS 160/);assert.match(await basis.innerText(),/15%/);
   assert((await page.locator('.mc-trade-packages').innerText()).includes(after.value.toLocaleString()),'live package uses revised CBS-influenced value');
   const invalid={...next,week:7};
   await page.getByLabel('Import CBS chart JSON',{exact:true}).last().setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
   await page.waitForFunction(()=>document.body.innerText.includes('Import rejected; last valid chart retained.'));
   assert.equal(await page.evaluate(()=>App.CbsMarket.snapshot.id),after.version);
   failSnapshot=true;await page.getByRole('button',{name:'Refresh imported CBS chart',exact:true}).last().click();
   await page.waitForFunction(()=>App.CbsMarket.state().error?.includes('503'));
   assert.equal(await page.evaluate(()=>App.CbsMarket.snapshot.id),after.version);
   fs.writeFileSync('output/playwright/cbs/pricing-proof.json',JSON.stringify({before,after},null,2));
   await page.screenshot({path:'output/playwright/cbs/builder-390.png',fullPage:true});
   await page.setViewportSize({width:1365,height:900});
   await page.goto(origin+'/dist-preview/?dev=true&cbsDesktop=1&user='+user+'#league='+id+'&tab=trades',{waitUntil:'networkidle'});
   await page.locator('.tc-cbs-basis summary').first().waitFor({timeout:60000}).catch(async e=>{fs.writeFileSync('output/playwright/cbs/desktop-debug.json',JSON.stringify({errors,text:await page.locator('body').innerText(),state:await page.evaluate(()=>({league:S?.currentLeagueId,skin:App?.LeagueSkin?.getCurrent?.()?.type,store:App?.CbsMarket?.state?.()}))},null,2));await page.screenshot({path:'output/playwright/cbs/desktop-debug.png'});throw e;});
   await page.locator('.tc-cbs-basis summary').first().click();
   await page.locator('.tc-cbs-basis').first().scrollIntoViewIfNeeded();
   assert.match(await page.locator('.tc-cbs-basis').first().innerText(),/Week 8/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'desktop has no horizontal overflow');
   await page.screenshot({path:'output/playwright/cbs/trades-1365.png',fullPage:false});
   await page.getByRole('button',{name:'Trade Builder',exact:true}).click();
   await page.locator('#tc-active-builder .tc-cbs-basis summary').click();
   assert.match(await page.locator('#tc-active-builder .tc-cbs-basis').innerText(),/CBS Sports chart/);
   await page.screenshot({path:'output/playwright/cbs/builder-1365.png',fullPage:false});
 }
 assert.deepEqual(errors,[]);console.log('PASS built UI '+mode+' '+JSON.stringify(read));await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
