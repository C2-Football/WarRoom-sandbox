#!/usr/bin/env node
'use strict';
// Operator-only Node process. Never package service credentials into browser JS.
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const {collect,enroll,checked,H}=require('./worker.cjs');
(async()=>{
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Server SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const args=process.argv.slice(2);
 if(args[0]==='enroll')console.log(JSON.stringify({runId:await enroll(db,JSON.parse(fs.readFileSync(args[1],'utf8')))}));
 else if(args[0]==='report'){
  const run=await checked(db.from('value_monitor_runs').select('*').eq('id',args[1]).single());
  const captures=await checked(db.from('value_monitor_captures').select('*').eq('run_id',run.id));
  let rows=[];for(let offset=0;;offset+=500){const page=await checked(db.from('player_value_snapshots').select('*').eq('run_id',run.id).order('id').range(offset,offset+499));rows.push(...page);if(page.length<500)break;}
  console.log(JSON.stringify(H.report(run,captures,rows),null,2));
 }else if(args[0]==='collect'){
  const results=await collect(db,{buildVersion:process.env.GITHUB_SHA||undefined});console.log(JSON.stringify(results,null,2));if(results.some(r=>r.error))process.exitCode=1;
 }else throw Error('Usage: run.cjs enroll CONFIG.json | collect | report RUN_ID');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
