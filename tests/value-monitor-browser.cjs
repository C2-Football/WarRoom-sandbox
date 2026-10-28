'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('@playwright/test');
const {fixture}=require('./helpers/value-monitor-inputs.cjs'),{reportFixture}=require('./helpers/value-monitor-report.cjs');
const base=process.env.VALUE_MONITOR_URL||'http://127.0.0.1:3528';
(async()=>{
 const f=fixture(),r=reportFixture(),out='output/value-monitor';fs.mkdirSync(out,{recursive:true});fs.rmSync(out+'/debug.json',{force:true});
 fs.writeFileSync(out+'/dated-fixture-report.json',JSON.stringify({fixtureOnly:true,...r.report},null,2));
 const styles=[...fs.readFileSync('index.html','utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 fs.writeFileSync(out+'/fixture.html',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\nbody{display:block;overflow:auto;padding:12px}main{max-width:900px;margin:auto}.value-monitor-panel select{max-width:100%}#wr-player-card-root{display:none}</style></head><body><main><h2>Controlled dated fixture — not live monitoring</h2><div id="fixture"></div></main>
 <script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script><script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
 <script>window.App={};window.S=${JSON.stringify({currentLeagueId:'L',leagues:[f.league],players:f.players,rosters:f.rosters})};window.WR={useViewport:()=>({isPhone:window.innerWidth<768})};</script>
 <script src="/dist-deploy/reconai-shared/value-history.js"></script><script src="/dist-deploy/js/components/value-monitor.js"></script><script src="/dist-deploy/js/components/player-card.js"></script>
 <script>const fixture=${JSON.stringify(r)};window.OD={loadValueSnapshots:async({valueType,playerId})=>{if(window.failHistory)throw Error('Fixture: database read failed');return valueType==='dynasty'?[]:fixture.rows.filter(r=>!playerId||r.player_id===playerId);},loadValueMonitorRuns:async()=>[fixture.run],loadValueMonitorReport:async()=>App.ValueHistory.report(fixture.run,fixture.captures,fixture.rows)};ReactDOM.createRoot(document.getElementById('fixture')).render(React.createElement(PlayerCard,{pid:'p1',playersData:S.players,statsData:{},embedded:true,initialTab:'value-history'}));</script></body></html>`);
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{for(const width of [390,1365]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('**/*',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method()))return route.abort();if(/supabase|sleeper|espn|fantasycalc/.test(req.url()))return route.fulfill({status:503,body:'Fixture external services disabled'});return route.continue();});
  await context.route(base+'/value-monitor-fixture.html',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(out+'/fixture.html','utf8')}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/value-monitor-fixture.html',{waitUntil:'networkidle'});
  await page.locator('.value-monitor-panel summary').first().click({timeout:10000}).catch(async e=>{fs.writeFileSync(out+'/debug.json',JSON.stringify({errors,text:await page.locator('body').innerText()},null,2));throw e;});
  await page.getByText('Largest risers',{exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/14\/16 player observations stored/);
  assert.match(await page.locator('body').innerText(),/Fixture: source fetch failed/);
  assert.match(await page.locator('body').innerText(),/comparison limited/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:out+'/history-'+width+'.png',fullPage:true});
  await page.getByLabel('Value format').selectOption('dynasty');await page.getByText('No persisted observations in this format.',{exact:false}).waitFor();
  await page.evaluate(()=>{window.failHistory=true;});await page.getByLabel('Value format').selectOption('redraft');await page.getByText('Fixture: database read failed',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();console.log('PASS production Value History + monitor report fixture '+width+'px, format separation and read error');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
