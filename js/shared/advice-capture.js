/* global module */
(function(root){
 'use strict';
 const prepared=new WeakMap(),status={enabled:false,pending:0,error:null,lastReceipt:null};
 const stable=x=>root.App.AdviceScorecard.stable(x);
 const clone=x=>JSON.parse(JSON.stringify(x,(_key,value)=>Object.prototype.toString.call(value)==='[object Set]'?Array.from(value):Object.prototype.toString.call(value)==='[object Map]'?Object.fromEntries(value):value));
 const owner=()=>root.OD?.getCurrentUserId?.()?'account:'+root.OD.getCurrentUserId():root.OD?.getCurrentUsername?.()?'sleeper:'+root.OD.getCurrentUsername():null;
 async function digest(x){const bytes=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(x)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
 function createClient({client=()=>root.OD?.getClient?.(),token=()=>root.OD?.getSessionToken?.(),principal=owner,storage=()=>root.localStorage}={}){
  const key=id=>'dhq-advice-outbox-v1:'+id;
  async function rpc(name,args){if(!token()||!principal())throw Error('Sign in to record or read advice');const db=client();if(!db)throw Error('Advice connection unavailable');const {data,error}=await db.rpc(name,args);if(error)throw Error(error.message);return data;}
  async function readTable(leagueId,table){const account=principal(),session=token();let offset=0,rows=[];for(;;){if(principal()!==account||token()!==session)throw Error('Account changed during scorecard read');const page=await rpc('read_advice_data',{p_league_id:String(leagueId),p_table:table,p_after:offset});if(principal()!==account||token()!==session)throw Error('Account changed during scorecard read');if(!Array.isArray(page))throw Error('Invalid advice report response');rows.push(...page);if(page.length<100)return rows;offset=['packets','jobs'].includes(table)?page.at(-1).id:page.at(-1).seq;if(!Number.isFinite(Number(offset)))throw Error('Invalid advice pagination cursor');}}
  function outbox(account){try{return JSON.parse(storage().getItem(key(account))||'[]');}catch(e){throw Error('Advice outbox unavailable: '+e.message);}}
  function write(account,rows){const value=JSON.stringify(rows);storage().setItem(key(account),value);if(storage().getItem(key(account))!==value)throw Error('Advice outbox readback failed');status.pending=rows.length;}
  let inflight;
  async function flush(){if(inflight)return inflight;inflight=(async()=>{const account=principal(),session=token();if(!account)return;let rows=outbox(account);status.pending=rows.length;
   while(rows.length){
    const record=rows[0];
    if(principal()!==account||token()!==session)throw Error('Account changed during advice upload');
    const receipt=await rpc('observe_advice',{p_record:record});
    if(receipt?.id!==record.id||!Number.isFinite(Date.parse(receipt.receivedAt)))throw Error('Advice server receipt missing');
    const stored=(await readTable(record.leagueId,'observations')).find(x=>x.observation_id===record.id);
    if(!stored||stable({...stored.payload,capturedAt:null})!==stable({...record,capturedAt:null}))throw Error('Advice persistence readback failed');
    if(principal()!==account||token()!==session)throw Error('Account changed during advice upload');
    // Re-read to retain observations queued while the network request was pending.
    rows=outbox(account).filter(r=>r.id!==record.id);write(account,rows);status.lastReceipt=receipt;status.error=null;
   }
  })().catch(e=>{status.error=e.message;throw e;}).finally(()=>{inflight=null;root.dispatchEvent?.(new root.CustomEvent('wr:advice-status'));});return inflight;}
  async function save(body){const account=principal();if(!account)throw Error('No owner-bound advice session');const frozen=clone({...body,ownerKey:account}),id=await digest(frozen);if(principal()!==account)throw Error('Account changed before advice capture');
   const rows=outbox(account);if(!rows.some(r=>r.id===id))rows.push({...frozen,id,capturedAt:new Date().toISOString()});write(account,rows);await flush();return id;}
  async function read(leagueId){const data={},account=principal(),session=token();for(const table of ['runs','cases','records','packets','jobs','observations']){if(principal()!==account||token()!==session)throw Error('Account changed during scorecard read');data[table]=await readTable(leagueId,table);if(principal()!==account||token()!==session)throw Error('Account changed during scorecard read');}return data;}
  return {save,flush,read,readTable};
 }
 const client=createClient();
 function inputs(args){const pids=new Set([...Object.keys(args.projectionsByPid||{}),...(args.rosters||[]).flatMap(r=>r.players||[])]);return clone({league:args.league,roster:args.roster,rosters:args.rosters,
  players:Object.fromEntries([...pids].filter(p=>args.players?.[p]).map(p=>{const x=args.players[p];return [p,{position:x.position,fantasy_positions:x.fantasy_positions,team:x.team,injury_status:x.injury_status,status:x.status,active:x.active,age:x.age,depth_chart_order:x.depth_chart_order}];})),
  projectionsByPid:args.projectionsByPid,valuesByPid:args.valuesByPid,rosState:args.rosState,gm:args.gm,week:args.week,basis:args.basis,averageWindow:args.averageWindow,
  sourceTimestamps:args.sourceTimestamps||null,sourceTimestampsVerified:false,engineVersion:root.App.ValueEngineVersion||null});}
 const api={status,createClient,...client,
  prepared(kind,args,result){if(status.enabled)try{prepared.set(result,{kind,inputs:inputs(args)});}catch(e){status.error='Capture preparation failed: '+e.message;}},
  async shown(kind,result,args){if(!status.enabled)return null;try{const saved=prepared.get(result);return await client.save({kind,leagueId:String(args.league.league_id||args.league.id),issued:clone(result),inputs:saved?.inputs||inputs(args),view:clone(args.view||null),
   provenance:'Actual displayed advice. Browser source timestamps/deadlines are unverified; these observations are not substituted for registered prospective cases.',eligibility:'unregistered_display',actionObserved:false});}catch(e){status.error=e.message;root.dispatchEvent?.(new root.CustomEvent('wr:advice-status'));return null;}}
 };
 root.App=root.App||{};root.App.AdviceCapture=api;
 if(root.document&&root.fetch)root.fetch('content/advice-scorecard.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Advice activation settings unavailable');return r.json();}).then(c=>{status.enabled=c.captureDisplayedAdvice===true;if(status.enabled)return client.flush();}).catch(e=>{status.error=e.message;});
 root.addEventListener?.('online',()=>{if(status.enabled)client.flush().catch(()=>{});});
 root.addEventListener?.('wr:auth-changed',()=>{if(status.enabled)client.flush().catch(()=>{});});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
