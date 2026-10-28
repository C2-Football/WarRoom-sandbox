'use strict';
const path=require('node:path'),fs=require('node:fs');
const H=require('../../reconai-shared/value-history.js');
const runtime=require('../../reconai-shared/value-monitor-runtime.cjs');
const ROOT=path.resolve(__dirname,'../..');
function engineFiles(){return Object.fromEntries(['startsit-engine.js','weekly-proj.js','nfl-context.js','redraft-market.js','availability-forecast.js'].map(n=>[n,path.join(ROOT,'js/shared',n)]).concat([['player-value.js',path.join(ROOT,'js/utils/player-value.js')]]));}
async function checked(query){const {data,error}=await query;if(error)throw Error(error.message);return data;}
async function collect(db,{calculate=runtime.calculate,fetcher=fetch,buildVersion='local-source:'+runtime.hash(fs.readFileSync(__filename,'utf8')+fs.readFileSync(path.join(ROOT,'reconai-shared/value-monitor-runtime.cjs'),'utf8')),maxCaptures=4}={}){
 const results=[];
 for(let count=0;count<maxCaptures;count++){
  const job=await checked(db.rpc('claim_value_monitor_capture'));if(!job)break;
  const {run,capture}=job;
  try{
   const config=JSON.parse(fs.readFileSync(path.join(ROOT,'content/markets/cbs/config.json'),'utf8'));
   let cbsSnapshot=null,cbsError=null;
   if(run.value_type==='redraft'&&config.snapshotUrl){try{const r=await fetcher(config.snapshotUrl,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);cbsSnapshot=await r.json();}catch(e){cbsError=e.message;}}
   const result=await calculate({run:{...run,capture_index:capture.capture_index,buildVersion},files:engineFiles(),dataDir:ROOT,fetcher,cbsSnapshot,marketWeights:config.weights});
   result.rows.forEach(row=>{row.provenance.cbsImportStatus=cbsError?'Unavailable: '+cbsError:cbsSnapshot?'Validated imported snapshot':'No imported snapshot';});
   const saved=await checked(db.rpc('finish_value_monitor_capture',{p_run:run.id,p_index:capture.capture_index,p_token:capture.lease_token,p_rows:result.rows}));
   const stored=await checked(db.from('player_value_snapshots').select('*').eq('run_id',run.id).eq('capture_index',capture.capture_index).limit(500));
   if(stored.length!==run.player_ids.length||!run.player_ids.every(id=>stored.some(r=>r.player_id===id)))throw Error('Post-save readback incomplete');
   results.push({runId:run.id,index:capture.capture_index,...saved,readbackVerified:true});
  }catch(e){
   try{await checked(db.rpc('finish_value_monitor_capture',{p_run:run.id,p_index:capture.capture_index,p_token:capture.lease_token,p_rows:[],p_error:e.message}));}catch(recordError){results.push({runId:run.id,error:e.message,recordError:recordError.message});continue;}
   results.push({runId:run.id,index:capture.capture_index,error:e.message});
  }
 }
 return results;
}
async function enroll(db,config,fetcher=fetch){
 if(!config.league_id||!['redraft','dynasty'].includes(config.value_type)||(!config.user_id&&!config.username))throw Error('Explicit league, format and report owner required');
 new Intl.DateTimeFormat('en',{timeZone:config.timezone}).format();
 const read=async url=>{const r=await fetcher(url);if(!r.ok)throw Error('Enrollment input HTTP '+r.status);return r.json();};
 const league=await read('https://api.sleeper.app/v1/league/'+config.league_id);
 if(league.settings?.type==null||String(league.season)!==String(config.season)||Number(league.settings?.type)!==(config.value_type==='dynasty'?2:0))throw Error('Enrollment league season/format mismatch');
 let ids=config.player_ids;
 if(config.scope?.kind==='rostered'){
  const rosters=await read('https://api.sleeper.app/v1/league/'+config.league_id+'/rosters');
  if(rosters.length!==Number(league.total_rosters))throw Error('Incomplete rosters');
  const selected=config.scope.roster_ids;
  if(!Array.isArray(selected)||!selected.length||selected.some(id=>!rosters.some(r=>r.roster_id===id)))throw Error('Explicit valid roster IDs required');
  ids=[...new Set(rosters.filter(r=>selected.includes(r.roster_id)).flatMap(r=>r.players||[]))];
 }else if(config.scope?.kind!=='players')throw Error('Explicit players or rostered scope required');
 if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'||!id))throw Error('Select 1–500 stable player IDs');
 const players=await read('https://api.sleeper.app/v1/players/nfl');
 if(ids.some(id=>!players[id]))throw Error('Unknown player ID');
 return checked(db.rpc('enroll_value_monitor',{p_config:{...config,player_ids:[...new Set(ids)]}}));
}
module.exports={collect,enroll,checked,engineFiles,H};
