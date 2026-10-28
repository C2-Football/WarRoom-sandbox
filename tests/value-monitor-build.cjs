'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createClient}=require('@supabase/supabase-js');
const {database,transport,owner}=require('./helpers/value-monitor-db.cjs');
(async()=>{const {db,migrate}=await database();try{
 await migrate();const calls=[];
 const b={App:{CONFIG:{supabaseUrl:'http://127.0.0.1:9999',supabaseAnon:'fixture'}},OD:{},document:{querySelector:()=>null,addEventListener(){}},addEventListener(){},location:{pathname:'/'},localStorage:{getItem:k=>k==='fw_session_v1'?JSON.stringify({token:'fixture-token',user:{id:owner}}):null},console,setTimeout:()=>0,setInterval:()=>0,clearTimeout,
 supabase:{createClient:(url,key,opts)=>createClient(url,key,{...opts,global:{...opts.global,fetch:transport(db,{calls})},auth:{persistSession:false}})}};b.window=b;vm.createContext(b);
 for(const name of ['reconai-shared/value-history.js','reconai-shared/supabase-client.js','js/shared/value-engine-version.js'])vm.runInContext(fs.readFileSync('dist-deploy/'+name,'utf8'),b);
 const row={leagueId:'L',playerId:'p',season:2026,week:8,value:0,valueType:'redraft',source:'periodic'};
 assert.equal((await b.OD.recordValueSnapshot(row)).verified,true);assert.equal((await b.OD.recordValueSnapshots([{...row,playerId:'q'}])).verified,true);
 assert.equal(calls.filter(c=>c.method==='POST').length,2);assert.equal((await b.OD.loadValueSnapshots({leagueId:'L'})).length,2);
 const {createHost}=require('../reconai-shared/value-monitor-runtime.cjs'),{engineFiles}=require('../scripts/value-monitor/worker.cjs');
 const host=createHost({state:{},fetcher:async()=>{throw Error('No test network');},files:engineFiles()});assert.equal(b.App.ValueEngineVersion,host.engineVersion);
 const html=fs.readFileSync('dist-deploy/index.html','utf8');assert(html.includes('value-history.js'));assert(html.includes('js/components/value-monitor.js'));assert(!html.includes('type="text/babel"'));
 console.log('PASS minified production snapshot writers dispatch and read back; browser/server canonical engine fingerprints match; UI reaches production entrypoint');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
