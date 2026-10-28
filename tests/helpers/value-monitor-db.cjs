'use strict';
const fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const owner='10000000-0000-4000-8000-000000000001';
async function database(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table app_users(id uuid primary key);
 create function public.current_app_user_id() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;
 insert into app_users values('${owner}');`);
 await db.exec(fs.readFileSync('supabase/migrations/20260809000000_player_value_snapshots.sql','utf8'));
 const migration=fs.readFileSync('supabase/migrations/20261028000000_value_monitor.sql','utf8');
 return {db,migrate:()=>db.exec(migration),owner};
}
function transport(db,{calls=[],failure=()=>null}={}){
 return async (url,init={})=>{
  const u=new URL(url),table=u.pathname.split('/').at(-1),method=init.method||'GET';calls.push({url:String(url),method,body:init.body});
  const fail=failure({url:u,method});if(fail==='reject')throw Error('Fixture network failure');if(fail)return new Response(JSON.stringify({message:fail,code:'42501'}),{status:403,headers:{'Content-Type':'application/json'}});
  try{
   let data=[];
   if(u.pathname.includes('/rpc/')){
    const params=JSON.parse(init.body||'{}');const keys=Object.keys(params);
    const result=await db.query(`select public.${table}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,Object.values(params).map(x=>typeof x==='object'?JSON.stringify(x):x));data=result.rows[0].result;
   }else if(method==='POST'){
    const body=JSON.parse(init.body);const rows=Array.isArray(body)?body:[body];
    await db.exec('begin');try{for(const row of rows){const keys=Object.keys(row);await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict do nothing`,Object.values(row).map(x=>x&&typeof x==='object'?JSON.stringify(x):x));}await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
   }else if(method==='GET'){
    const params=[],clauses=[];for(const [key,value]of u.searchParams){if(['select','order','offset','limit'].includes(key))continue;const [op,...rest]=value.split('.'),v=rest.join('.');if(op==='eq'){params.push(v);clauses.push(`${key}=$${params.length}`);}else if(op==='in'){const ids=v.slice(1,-1).split(',').map(x=>x.replace(/^"|"$/g,''));const slots=ids.map(id=>{params.push(id);return '$'+params.length;});clauses.push(`${key} in (${slots.join(',')})`);}}
    const order=(u.searchParams.get('order')||'').split(',').filter(Boolean).map(x=>x.replace('.asc',' asc').replace('.desc',' desc')).join(',');
    data=(await db.query(`select * from ${table}${clauses.length?' where '+clauses.join(' and '):''}${order?' order by '+order:''} limit ${Number(u.searchParams.get('limit')||1000)} offset ${Number(u.searchParams.get('offset')||0)}`,params)).rows;
   }else throw Error('Unsupported fixture method '+method);
   return new Response(JSON.stringify(data,(k,v)=>k==='value'&&v!==null?Number(v):v),{status:method==='POST'&&!u.pathname.includes('/rpc/')?201:200,headers:{'Content-Type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({message:e.message,code:e.code||'XX000'}),{status:400,headers:{'Content-Type':'application/json'}});}
 };
}
module.exports={database,transport,owner};
