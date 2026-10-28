'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('./helpers/cbs-fixture.cjs'),M=require('../js/shared/redraft-market.js');
(async()=>{
 const f=fixture(),shared=process.env.SHARED_SOURCE||path.resolve('../dhq-shared');assert.equal(fs.readFileSync(path.join(shared,'redraft-market.js'),'utf8'),fs.readFileSync('js/shared/redraft-market.js','utf8'));
 const html=fs.readFileSync('dist-deploy/index.html','utf8');for(const file of ['redraft-market.js','cbs-market-store.js'])assert(html.includes(file),'production entry loads '+file);
 const b={App:{},S:{currentLeagueId:'L',nflState:{season:'2026',week:8}},console,Date,Map,Set,Promise,setTimeout,clearTimeout,fetch:async()=>({ok:false})};b.window=b;b.globalThis=b;vm.createContext(b);
 for(const p of ['reconai-shared/sleeper-api.js','dist-deploy/js/shared/startsit-engine.js','dist-deploy/js/shared/weekly-proj.js','dist-deploy/js/shared/redraft-market.js','dist-deploy/js/utils/player-value.js'])vm.runInContext(fs.readFileSync(p,'utf8'),b);
 const ctx={league:f.league,playersData:f.players,statsData:f.stats,week:8,now:f.now,skin:{type:'redraft'}};
 const before=b.App.PlayerValue.computePrices(ctx);f.chart.rows.find(r=>r.position==='WR'&&r.name.endsWith(' 15')).values.PPR=100;
 const cbsSnapshot=await M.createSnapshot(f.chart,f.players,f),after=b.App.PlayerValue.computePrices({...ctx,cbsSnapshot});assert.notEqual(before.values.WR15,after.values.WR15);assert.deepEqual(before.points,after.points);
 const config=JSON.parse(fs.readFileSync('content/markets/cbs/config.json','utf8'));assert.equal(config.weights.cbs,.15);
 console.log('PASS minified production market → PlayerValue: validated CBS price changes, unchanged fantasy-point projections, canonical source and entrypoint verified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
