'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const M=require('../js/shared/redraft-market.js'),I=require('../scripts/cbs/importer.cjs'),{fixture,html,now}=require('./helpers/cbs-fixture.cjs');
const clone=v=>JSON.parse(JSON.stringify(v)),temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cbs-test-'));
const snap=(f=fixture())=>M.createSnapshot(f.chart,f.players,f);
test('published schema parses QB/PPR columns; changed and missing tables fail closed',()=>{
 const f=fixture(),out=I.parseArticle(html(f.chart),f.chart.sourceUrl);assert.equal(out.rows.length,110);assert.deepEqual(out.columns,M.COLUMNS);
 assert.throws(()=>I.parseArticle(html(f.chart).replace('1QB-4','4PT'),f.chart.sourceUrl),/structure/);
 assert.equal(M.validateChart({...out,rows:out.rows.filter(r=>r.position!=='TE')},f).valid,false);
 assert.throws(()=>I.parseArticle(html(f.chart).replace('<td>50</td>','<td>five</td>'),f.chart.sourceUrl),/numeric/);
});
test('discovery uses sitemap titles/links and accepts changed article slugs without guessing URLs',()=>{
 const u='https://www.cbssports.com/fantasy/football/news/brand-new-editorial-slug/';
 assert.deepEqual(I.discover(`<urlset><url><loc>${u}</loc><news:title>Week 8 Trade Value Chart</news:title></url></urlset>`),[u]);
 assert.deepEqual(I.discover(`<a href="${u}">Week 8 trade chart</a>`,'https://www.cbssports.com'),[u]);
});
test('names, punctuation, suffixes, aliases, collisions and team changes have explicit mapping outcomes',()=>{
 const players={a:{full_name:"Ja’Marr Chase Jr.",position:'WR',team:'NEW'},b:{full_name:'Josh Smith',position:'WR',team:'BUF'},c:{full_name:'Josh Smith',position:'WR',team:'BUF'},d:{full_name:'Kenneth Walker III',position:'RB',team:'KC'}};
 const rows=[{name:'JaMarr Chase',position:'WR',team:'CIN'},{name:'J. Smith',position:'WR',team:'BUF'},{name:'Ken Walker',position:'RB',team:'SEA'}];
 const out=M.mapRows(rows,players,{'ken walker|RB':'d'});assert.equal(out[0].playerId,'a');assert.equal(out[0].teamMismatch,true);assert.equal(out[1].mappingStatus,'ambiguous');assert.equal(out[1].playerId,null);assert.equal(out[2].playerId,'d');
 const resolved=M.mapRows([{name:'Josh Smith',position:'WR',team:'BUF'}],players,{'josh smith|WR':'c'});assert.equal(resolved[0].playerId,'c');
});
test('invalid numbers, duplicate identities/IDs, and insufficient mapped coverage reject activation',async()=>{
 for(const mutation of [f=>f.chart.rows[0].values['1QB-4']=-1,f=>f.chart.rows.push(clone(f.chart.rows[0])),f=>f.players={}]){const f=fixture();mutation(f);await assert.rejects(snap(f));}
 const s=await snap();s.chart.rows[1].playerId=s.chart.rows[0].playerId;assert.equal(M.validateSnapshot(s,fixture()).valid,false);
});
test('missing, unlisted and explicit zero remain different; no CBS prices are manufactured',async()=>{
 const f=fixture();f.chart.rows[0].values['1QB-4']=null;f.chart.rows[1].values['1QB-4']=0;
 const input=M.input(await snap(f),f.league,8,now);assert.equal(input.entries.QB0.original,null);assert.equal(input.entries.QB1.original,0);assert.equal(input.values.QB1,0);assert.equal(input.values.QB0,undefined);assert.equal(input.entries.ghost,undefined);
});
test('1QB/2QB/superflex select deliberately; premiums/custom formats are excluded',()=>{
 const f=fixture();assert.equal(M.format(f.league).columns.QB,'1QB-4');f.league.roster_positions=['QB','QB'];assert.equal(M.format(f.league).columns.QB,'2QB');f.league.roster_positions=['QB','SUPER_FLEX'];assert.equal(M.format(f.league).approximate,true);
 f.league.scoring_settings.bonus_rec_te=.5;assert.equal(M.format(f.league).supported,false);delete f.league.scoring_settings.bonus_rec_te;f.league.scoring_settings.rec=.7;assert.equal(M.format(f.league).supported,false);
});
test('old seasons/future weeks are rejected; delayed charts expire by NFL week and actual publication age',async()=>{
 const f=fixture();const s=await snap(f);assert.equal(M.input(s,f.league,9,now+7*86400000).status,'previous-week');assert.equal(M.input(s,f.league,10,now+8*86400000).active,false);assert.equal(M.input(s,f.league,8,now+11*86400000).active,false);
 f.chart.season=2025;await assert.rejects(snap(f),/season/);f.chart.season=2026;f.chart.week=9;await assert.rejects(snap(f),/future/);
});
test('new week and same-week revisions activate atomically; unchanged fetch keeps original import time',async()=>{
 const f=fixture(),dir=temp();const first=await I.publish(f.chart,{...f,dir});
 const unchanged=await I.publish(f.chart,{...f,dir,now:now+3600000});assert.equal(unchanged.changed,false);assert.equal(unchanged.snapshot.fetchedAt,first.snapshot.fetchedAt);
 f.chart.rows[0].values['1QB-4']=40;f.chart.updatedAt='2026-10-27T17:00:00Z';const revision=await I.publish(f.chart,{...f,dir});assert.notEqual(revision.snapshot.id,first.snapshot.id);assert.equal(I.read(path.join(dir,'current.json')).id,revision.snapshot.id);
 f.chart.week=9;f.week=9;f.now=now+7*86400000;f.chart.publishedAt='2026-11-03T12:00:00Z';f.chart.updatedAt=null;const next=await I.publish(f.chart,{...f,dir});assert.equal(next.snapshot.chart.week,9);assert.equal(fs.readdirSync(path.join(dir,'snapshots')).length,3);
});
test('older articles, chronology rollback, malformed imports and anomalous corrections retain last valid snapshot',async()=>{
 const f=fixture(),dir=temp(),first=await I.publish(f.chart,{...f,dir});
 for(const mutate of [c=>c.week=7,c=>c.updatedAt='2026-10-27T12:30:00Z',c=>c.rows[0].values['1QB-4']='NaN',c=>c.rows.forEach(r=>Object.keys(r.values).forEach(k=>r.values[k]=180))]){
  const c=clone(f.chart);mutate(c);await assert.rejects(I.publish(c,{...f,dir}));assert.equal(I.read(path.join(dir,'current.json')).id,first.snapshot.id);
 }
 const earlier=clone(first.snapshot);earlier.fetchedAt='2026-10-27T17:00:00Z';earlier.contentHash='f'.repeat(64);assert.equal(M.compare(earlier,first.snapshot).allowed,false);
 assert.equal(fs.readdirSync(path.join(dir,'quarantine')).length,1);
});
test('permission blocker prevents all network requests; failed fetch leaves last valid snapshot and writes honest health',async()=>{
 const f=fixture(),dir=temp(),first=await I.publish(f.chart,{...f,dir});let calls=0;
 await assert.rejects(I.run({...f,chart:undefined,dir,fetcher:async()=>{calls++;throw Error('offline');}}),/permission/);assert.equal(calls,0);
 await assert.rejects(I.run({...f,chart:undefined,dir,permissionReference:'fixture only',fetcher:async()=>{calls++;throw Error('offline');}}),/offline/);
 assert.equal(I.read(path.join(dir,'current.json')).id,first.snapshot.id);assert.equal(I.read(path.join(dir,'status.json')).status,'blocked');
});
test('authorized autonomous discovery selects new-week article and rechecks same-week correction, independent of a browser',async()=>{
 const f=fixture(),dir=temp(),old=clone(f.chart);old.week=7;
 const urls=[f.chart.sourceUrl,old.sourceUrl+'old/'];let changed=false;
 const fetcher=async url=>({ok:true,text:async()=>url.includes('sitemap')?`<urlset>${urls.map(u=>`<url><loc>${u}</loc><news:title>Trade Chart</news:title></url>`).join('')}</urlset>`:url.endsWith('/football/')?'':html(url===urls[1]?old:changed?{...f.chart,rows:f.chart.rows.map((r,i)=>i? r:{...r,values:{...r.values,'1QB-4':44}})}:f.chart)});
 const first=await I.run({...f,chart:undefined,dir,permissionReference:'fixture only',fetcher});assert.equal(first.snapshot.chart.week,8);changed=true;
 const next=await I.run({...f,chart:undefined,dir,permissionReference:'fixture only',fetcher});assert.notEqual(first.snapshot.id,next.snapshot.id);
});
test('manual CLI runs with file fixtures and no browser or server; invalid import cannot overwrite active data',()=>{
 const f=fixture(),dir=temp();for(const [name,data] of Object.entries({chart:f.chart,players:f.players,state:{season:2026,week:8,season_type:'regular'}}))fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(data));
 const args=['scripts/update-cbs-market.cjs','--import',path.join(dir,'chart.json'),'--players',path.join(dir,'players.json'),'--state',path.join(dir,'state.json'),'--out',path.join(dir,'out')];
 const result=cp.spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert(I.read(path.join(dir,'out/current.json')).id);
 f.chart.week=6;fs.writeFileSync(path.join(dir,'chart.json'),JSON.stringify(f.chart));const failed=cp.spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(failed.status,1);assert.equal(I.read(path.join(dir,'out/current.json')).chart.week,8);
});
test('one normalized influence budget caps arbitrary weights; missing source weights stay with engine',()=>{
 const base={a:100,b:20,zero:0};const result=M.blend(base,{cbs:{active:true,values:{a:10,b:100,zero:0}},fantasyCalc:{a:1000,b:5000},weights:{budget:9,cbs:8,fantasyCalc:2}});
 assert.equal(result.weights.budget,.25);assert.equal(result.details.a.engineWeight,.75);assert.equal(result.values.b,40);assert.equal(result.values.zero,0);
 const absent=M.blend(base,{cbs:{active:true,values:{a:20,b:100}},fantasyCalc:null});assert.equal(absent.details.a.engineWeight,.85);assert.equal(absent.details.a.sources.cbs.weight,.15);assert.equal(absent.details.b.sources.fantasyCalc,undefined);
});
function production(f){
 class Clock extends Date{static now(){return now;}}
 const b={App:{RedraftMarket:M},S:{currentLeagueId:'L',leagues:[f.league],nflState:{season:'2026',week:8}},Date:Clock,console,Map,Set,Promise,setTimeout,clearTimeout,fetch:async()=>({ok:false})};b.window=b;b.globalThis=b;vm.createContext(b);
 const shared=process.env.SHARED_SOURCE||path.resolve('../dhq-shared');for(const file of ['sleeper-api.js','startsit-engine.js','weekly-proj.js','player-value.js','trade-engine.js'])vm.runInContext(fs.readFileSync(path.join(shared,file),'utf8'),b);
 b.App.LeagueSkin={getCurrent:()=>({type:'redraft'})};b.App.normPos=p=>p;
 return b;
}
test('validated revisions change real PlayerValue and Trade Finder package/negotiation calculations but never projected points',async()=>{
 const f=fixture(),b=production(f),ctx={league:f.league,leagueId:'L',playersData:f.players,statsData:f.stats,noMarketFetch:true,skin:{type:'redraft'}};
 const first=await snap(f),a=b.App.PlayerValue.ensureRos({...ctx,cbsInput:M.input(first,f.league,8,now)});
 const Babel=require('@babel/standalone'),source=fs.readFileSync('js/trade-calc.js','utf8'),names=['getPlayerValue','playerAsset','sideBreakdown','buildDeal','dealWindowImpact'];
 Babel.packages.traverse.default(Babel.packages.parser.parse(source,{plugins:['jsx']}),{FunctionDeclaration(p){if(names.includes(p.node.id?.name))vm.runInContext(source.slice(p.node.start,p.node.end),b);}});
 Object.assign(b,{resolvedLeagueSkin:{type:'redraft'},playersData:f.players,normPos:p=>p,FAAB_RATE:2,ownerDna:{},DNA_TYPES:{NONE:{}},grudges:[],myRosterId:1,ownerBehaviorByRosterId:{},teamContextByRosterId:{},leagueProfile:null,finderQuery:{intent:'help'},formatReasonsForAssets:()=>[],formatReadoutForDeal:()=>'',explainRosterSwing:()=> 'need covered',myAssessment:{ownerId:'me',rosterId:1,needs:[],posAssessment:{},window:'win'}});
 const partner={ownerId:'them',rosterId:2,needs:[],posAssessment:{},window:'win'};
 const deal=()=>b.buildDeal(partner,{givePlayers:[b.playerAsset('RB15')],receivePlayers:[b.playerAsset('WR15')]});const before=deal();
 f.chart.rows.find(r=>r.position==='WR'&&r.name.endsWith(' 15')).values.PPR=100;const second=await snap(f),afterBoard=b.App.PlayerValue.ensureRos({...ctx,cbsInput:M.input(second,f.league,8,now)}),after=deal();
 assert.notEqual(a.values.WR15,afterBoard.values.WR15);assert.deepEqual(a.points,afterBoard.points);assert.notEqual(before.totals.receive.total,after.totals.receive.total);assert.notEqual(before.userGain,after.userGain);assert.notEqual(before.likelihood,after.likelihood);assert.equal(after.receivePlayers[0].value,afterBoard.values.WR15);
 const off=b.App.PlayerValue.ensureRos({...ctx,cbsInput:M.input(second,f.league,8,now),marketWeights:{budget:0,cbs:.15,fantasyCalc:.1}});assert.equal(off.marketApplied,false);assert.equal(off.marketBasis.cbsApplied,false);
 const keeper=b.App.PlayerValue.computePrices({...ctx,skin:{type:'keeper'},cbsSnapshot:second});assert.equal(keeper.marketBasis,null);
 const chopped=b.App.PlayerValue.computePrices({...ctx,skin:{type:'chopped'},cbsSnapshot:second});assert.equal(chopped.marketBasis,null);
 assert.deepEqual(Object.keys(b.App.PlayerValue.marketEvidence(['WR15']).players),['WR15']);
});
test('snapshot integrity verifies source dates and rejects mutated provenance',async()=>{const s=await snap();await M.verify(s,fixture());s.chart.publishedAt='2026-10-26T12:00:00Z';await assert.rejects(M.verify(s,fixture()),/integrity/);});
test('browser store deduplicates, retries, invalidates price caches, and ignores a late response after full refresh',async()=>{
 const f=fixture(),s=await snap(f),events=[];let clock=now,calls=0,fail=true,wait=null;
 class Clock extends Date{static now(){return clock;}}
 const b={Date:Clock,URL,AbortSignal,TextEncoder,crypto:require('node:crypto').webcrypto,console,document:{baseURI:'http://fixture/'},localStorage:{getItem:()=>null,setItem(){}},S:{nflState:{season:'2026'},currentWeek:8},App:{PlayerValue:{marketChanged:()=>events.push('invalidate')},WeeklyProj:{currentWeek:()=>b.S.currentWeek}},CustomEvent:function(type,opts){this.type=type;this.detail=opts.detail;},dispatchEvent:e=>events.push(e.type),setInterval:()=>1};b.window=b;b.globalThis=b;vm.createContext(b);
 vm.runInContext(fs.readFileSync('js/shared/redraft-market.js','utf8'),b);
 b.fetch=async url=>{calls++;if(String(url).includes('config.json'))return{ok:true,json:async()=>({snapshotUrl:'http://fixture/current.json',statusUrl:'http://fixture/status.json'})};if(String(url).includes('status.json'))return{ok:true,json:async()=>({status:'ok',checkedAt:new Date(now).toISOString()})};if(wait)await new Promise(resolve=>wait.resolve=resolve);return{ok:!fail,status:503,json:async()=>s};};
 vm.runInContext(fs.readFileSync('js/shared/cbs-market-store.js','utf8'),b);const store=b.App.CbsMarket;
 await Promise.all([store.ensure(),store.ensure()]);assert.equal(calls,2);assert.match(store.state().error,/503/);assert.equal(store.snapshot,null);
 await store.ensure();assert.equal(calls,2);clock+=31000;fail=false;await store.ensure();assert.equal(store.snapshot.id,s.id);assert(events.includes('invalidate'));const importedAt=store.snapshot.fetchedAt;
 clock+=16*60000;await store.ensure();assert.equal(store.snapshot.fetchedAt,importedAt);assert.equal(calls,6);
 store.invalidate();wait={};const old=store.ensure();while(!wait.resolve)await new Promise(r=>setImmediate(r));store.invalidate();wait.resolve();await old;assert.equal(store.state().checkedAt,0);
 const version=store.identity(f.league,8);clock+=11*86400000;assert.notEqual(store.identity(f.league,8),version);assert.equal(store.read(f.league,8).active,false);
});
test('same-week corrections without provider dates preserve first-import age',async()=>{
 const f=fixture(),dir=temp();f.chart.publishedAt=null;f.chart.updatedAt=null;
 const first=await I.publish(f.chart,{...f,dir});f.chart.rows[0].values['1QB-4']=45;
 const next=await I.publish(f.chart,{...f,dir,now:now+8*86400000});assert.equal(next.snapshot.firstImportedAt,first.snapshot.fetchedAt);assert.equal(M.input(next.snapshot,f.league,8,now+11*86400000).active,false);
});
test('market prices cannot manufacture unknown or genuinely zero seasonal value',()=>{
 const result=M.blend({zero:0,known:100},{cbs:{active:true,values:{zero:100,unknown:80,known:10}},fantasyCalc:{zero:9000}});
 assert.equal(result.values.zero,0);assert.equal(result.values.unknown,undefined);
});
test('explicit review is recorded on an anomalous import and verifies through the reader contract',async()=>{
 const f=fixture(),dir=temp();await I.publish(f.chart,{...f,dir});f.chart.rows.forEach(r=>Object.keys(r.values).forEach(k=>r.values[k]=180));
 const candidate=await snap(f),result=await I.publish(f.chart,{...f,dir,approveChange:candidate.contentHash});assert.equal(result.snapshot.reviewedChanges.contentHash,candidate.contentHash);await M.verify(result.snapshot,f);
});
test('market version participates in Alex and Trade Finder invalidation; source inputs survive serialization',()=>{
 const Babel=require('@babel/standalone'),source=fs.readFileSync('js/trade-calc.js','utf8');let key,loop;
 Babel.packages.traverse.default(Babel.packages.parser.parse(source,{plugins:['jsx']}),{FunctionDeclaration(p){if(p.node.id?.name==='tcTradeVerdictKey')key=source.slice(p.node.start,p.node.end);},VariableDeclarator(p){if(p.node.id.name==='finderLoopKey')loop=source.slice(p.node.init.start,p.node.init.end);}});
 const b={finderActive:true,effPartnerId:null,partnerBoard:[{}],finderQuery:{intent:'best'},effMode:'fillNeed',finderFocusKey:null,finderTuningHash:'t',finderBoardSig:'a',finderMarketKey:'v1'};vm.createContext(b);vm.runInContext(key,b);
 assert.notEqual(b.tcTradeVerdictKey({marketKey:'v1'}),b.tcTradeVerdictKey({marketKey:'v2'}));const first=vm.runInContext(loop,b);b.finderMarketKey='v2';assert.notEqual(vm.runInContext(loop,b),first);
});
test('unmapped published leaders still anchor the CBS scale',async()=>{
 const f=fixture();f.chart.rows[0].values['1QB-4']=150;delete f.players.QB0;const s=await snap(f),input=M.input(s,f.league,8,now);
 assert.equal(input.values.QB0,undefined);assert.equal(input.maximum,150);
 const result=M.blend({RB0:100},{cbs:input});assert.equal(result.details.RB0.sources.cbs.normalized,52/150*100);
});
test('explanation distinguishes both directions of price/roster disagreement and preserves source labels',async()=>{
 const f=fixture(),snapshot=await snap(f),cbs=M.input(snapshot,f.league,8,now),Babel=require('@babel/standalone'),source=fs.readFileSync('js/trade-calc.js','utf8');let node;
 Babel.packages.traverse.default(Babel.packages.parser.parse(source,{plugins:['jsx']}),{FunctionDeclaration(p){if(p.node.id?.name==='TcCbsBasis')node=p.node;}});
 const board={marketBasis:{cbs,cbsApplied:true,weights:M.DEFAULT_WEIGHTS,details:{}},values:{},scale:1};
 const b={React:{useState:()=>['',()=>{}],createElement:(type,props,...children)=>({type,props,children})},window:{App:{PlayerValue:{rosState:()=>board},CbsMarket:{weights:M.DEFAULT_WEIGHTS,state:()=>({})}}}};vm.createContext(b);vm.runInContext(Babel.transform(source.slice(node.start,node.end),{presets:['react']}).code,b);
 const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):(Array.isArray(n)?n:n.children||[]).map(text).join(' ');
 let copy=text(b.TcCbsBasis({league:f.league,playersData:f.players,giveIds:['RB1'],receiveIds:['RB0'],impact:{before:100,after:90,delta:-10}}));assert.match(copy,/received package higher.*lineup loses points/);assert.match(copy,/2026.*Week\s+8/);assert.match(copy,/Published:/);
 copy=text(b.TcCbsBasis({league:f.league,playersData:f.players,giveIds:['RB0'],receiveIds:['RB1'],impact:{before:100,after:110,delta:10}}));assert.match(copy,/received package lower.*lineup gains points/);assert.doesNotMatch(copy,/roster downside/);
});
