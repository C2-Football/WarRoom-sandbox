#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const W=require('./worker.cjs'),R=require('./runtime.cjs');
(async()=>{
 const [command,arg]=process.argv.slice(2);
 if(command==='fingerprint'){console.log(R.engineHash());return;}
 if(command==='prepare'){console.log(JSON.stringify(await W.prepare(JSON.parse(fs.readFileSync(arg,'utf8'))),null,2));return;}
 if(command==='validate'){await W.validateEnrollment(JSON.parse(fs.readFileSync(arg,'utf8')));console.log('Configuration valid; no enrollment or activation performed');return;}
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Server credentials are required');
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 if(command==='enroll'){const config=await W.validateEnrollment(JSON.parse(fs.readFileSync(arg,'utf8')));console.log(JSON.stringify({runId:await W.checked(db.rpc('enroll_advice_run',{p_config:config})),active:false}));}
 else if(command==='collect'){const results=await W.collect(db);console.log(JSON.stringify(results,null,2));if(results.some(r=>r.error))process.exitCode=1;}
 else if(command==='report')console.log(JSON.stringify(await W.readReport(db,arg),null,2));
 else throw Error('Usage: run.cjs fingerprint | prepare SEED | validate CONFIG | enroll CONFIG | collect | report RUN_ID');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
