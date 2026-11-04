-- Local-only migration. No enrollment, cron, credentials, or provider writes.
create table public.advice_runs (
 seq bigint generated always as identity unique,
 id uuid primary key default gen_random_uuid(), owner_key text not null, league_id text not null,
 config jsonb not null, active boolean not null default false, created_at timestamptz not null default clock_timestamp()
);
create table public.advice_cases (
 seq bigint generated always as identity unique,
 decision_id text primary key, run_id uuid not null references public.advice_runs(id) on delete cascade,
 spec jsonb not null, status text not null default 'scheduled', error text
);
create table public.advice_records (
 seq bigint generated always as identity unique,
 decision_id text primary key references public.advice_cases(decision_id) on delete cascade,
 payload jsonb not null, received_at timestamptz not null default clock_timestamp(),
 check(octet_length(payload::text)<=16000000)
);
create table public.advice_packets (
 id bigint generated always as identity primary key, decision_id text not null references public.advice_cases(decision_id) on delete cascade,
 week integer not null check(week between 1 and 18), kind text not null check(kind in ('lineup','outcome','grade','transactions')),
 payload jsonb not null, fingerprint text not null, received_at timestamptz not null default clock_timestamp(),
 unique(decision_id,week,kind,fingerprint)
);
create unique index advice_one_lineup on public.advice_packets(decision_id,week) where kind='lineup';
create table public.advice_jobs (
 id bigint generated always as identity primary key, decision_id text not null references public.advice_cases(decision_id) on delete cascade,
 kind text not null check(kind in ('capture','lineup','outcome')), week integer not null,
 scheduled_at timestamptz not null, deadline timestamptz not null, next_at timestamptz not null,
 status text not null default 'pending', attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
 last_success_at timestamptz, error text, unique(decision_id,kind,week)
);
-- A database constraint is the final overlap guard, including concurrent claim
-- transactions that begin before another claimant's lease becomes visible.
create unique index advice_one_running_case on public.advice_jobs(decision_id) where status='running';
create table public.advice_observations (
 seq bigint generated always as identity unique,
 owner_key text not null, observation_id text not null, league_id text not null, payload jsonb not null,
 received_at timestamptz not null default clock_timestamp(), primary key(owner_key,observation_id),
 check(octet_length(payload::text)<=16000000)
);
-- Account and legacy JWT identities follow the existing value-history/forecast contract.
create function public.advice_owner() returns text language sql stable security invoker set search_path='' as $$
 select case when public.current_app_user_id() is not null then 'account:'||public.current_app_user_id()::text
 when nullif(auth.jwt()->'app_metadata'->>'sleeper_username','') is not null then 'sleeper:'||(auth.jwt()->'app_metadata'->>'sleeper_username') else null end;
$$;
alter table public.advice_runs enable row level security;
alter table public.advice_cases enable row level security;
alter table public.advice_records enable row level security;
alter table public.advice_packets enable row level security;
alter table public.advice_jobs enable row level security;
alter table public.advice_observations enable row level security;
revoke all on public.advice_runs,public.advice_cases,public.advice_records,public.advice_packets,public.advice_jobs,public.advice_observations from public,anon,authenticated;
grant all on public.advice_runs,public.advice_cases,public.advice_records,public.advice_packets,public.advice_jobs,public.advice_observations to service_role;
grant usage,select on sequence public.advice_packets_id_seq,public.advice_jobs_id_seq,public.advice_runs_seq_seq,public.advice_cases_seq_seq,public.advice_records_seq_seq,public.advice_observations_seq_seq to service_role;
create function public.advice_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Advice predictions and evidence are immutable; append a new revision';end;$$;
create trigger advice_record_immutable before update on public.advice_records for each row execute function public.advice_immutable();
create trigger advice_packet_immutable before update on public.advice_packets for each row execute function public.advice_immutable();
create trigger advice_observation_immutable before update on public.advice_observations for each row execute function public.advice_immutable();
create trigger advice_case_spec_immutable before update of spec,run_id on public.advice_cases for each row execute function public.advice_immutable();
create trigger advice_run_config_immutable before update of config,owner_key,league_id on public.advice_runs for each row execute function public.advice_immutable();

create function public.enroll_advice_run(p_config jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; s jsonb; w jsonb; d text; start_week integer; stop_week integer;
begin
 if coalesce(p_config->>'ownerKey','')!~'^(account:|sleeper:).+' or coalesce(p_config->>'leagueId','')='' or
 p_config->>'cohort' not in ('tuning','validation') or jsonb_typeof(p_config->'cases') is distinct from 'array' or jsonb_array_length(p_config->'cases')=0 or
 coalesce(p_config->>'engineHash','')!~'^[a-f0-9]{64}$' then raise exception 'Explicit owner, league, cohort, immutable engine hash and cases required';end if;
 insert into public.advice_runs(owner_key,league_id,config,active) values(p_config->>'ownerKey',p_config->>'leagueId',p_config,false) returning id into r;
 for s in select * from jsonb_array_elements(p_config->'cases') loop
  if s->>'kind' not in ('waiver','trade') or coalesce(s->>'key','')='' or (s->>'captureAt')::timestamptz<=clock_timestamp() or
   (s->>'deadline')::timestamptz<=(s->>'captureAt')::timestamptz then raise exception 'Cases must be preregistered in the future';end if;
  d=r::text||':'||(s->>'key');start_week=(s->>'firstWeek')::integer;stop_week=(p_config->>'endWeek')::integer;
  insert into public.advice_cases(decision_id,run_id,spec) values(d,r,s);
  insert into public.advice_jobs(decision_id,kind,week,scheduled_at,deadline,next_at) values(d,'capture',start_week,(s->>'captureAt')::timestamptz,(s->>'deadline')::timestamptz,(s->>'captureAt')::timestamptz);
  for w in select * from jsonb_array_elements(p_config->'weeks') loop
   if (w->>'week')::integer<start_week or (w->>'week')::integer>stop_week or s->>'kind'='waiver' and (w->>'week')::integer>=start_week+4 then continue;end if;
   insert into public.advice_jobs(decision_id,kind,week,scheduled_at,deadline,next_at) values(d,'lineup',(w->>'week')::integer,(w->>'freezeAt')::timestamptz,(w->>'firstKickoffAt')::timestamptz,(w->>'freezeAt')::timestamptz);
   insert into public.advice_jobs(decision_id,kind,week,scheduled_at,deadline,next_at) values(d,'outcome',(w->>'week')::integer,(w->>'endsAt')::timestamptz,(w->>'endsAt')::timestamptz+interval '14 days',(w->>'endsAt')::timestamptz);
  end loop;
 end loop;
 return r;
end;$$;
create function public.claim_advice_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.advice_jobs%rowtype; c public.advice_cases%rowtype; r public.advice_runs%rowtype;
begin
 update public.advice_jobs set status=case when attempts>=5 then 'failed' else 'retry' end,
  error='Collector lease expired before completion',lease_token=null,lease_until=null
 where status='running' and lease_until<clock_timestamp();
 update public.advice_jobs expired set status=case when kind='outcome' and last_success_at is not null then 'closed' else 'missing' end,error=case when kind='outcome' and last_success_at is not null then error else coalesce(error,'Missed registered collection interval') end,lease_token=null,lease_until=null
 where deadline<=clock_timestamp() and status in ('pending','running','retry') and (lease_until is null or lease_until<clock_timestamp());
 update public.advice_cases missing_case set status=expired_job.status,error=expired_job.error from public.advice_jobs expired_job where expired_job.decision_id=missing_case.decision_id and expired_job.kind='capture' and expired_job.status in ('missing','failed') and missing_case.status<>'captured';
 select j0.* into j from public.advice_jobs j0 join public.advice_cases c0 using(decision_id) join public.advice_runs r0 on r0.id=c0.run_id
 where r0.active and j0.status in ('pending','retry','running') and j0.next_at<=clock_timestamp() and j0.deadline>clock_timestamp()
 and (j0.lease_until is null or j0.lease_until<clock_timestamp())
 and (j0.kind='capture' or exists(select 1 from public.advice_records a where a.decision_id=j0.decision_id))
 and not exists(select 1 from public.advice_jobs busy where busy.decision_id=j0.decision_id and busy.lease_until>clock_timestamp())
 order by j0.next_at,j0.id for update of j0,c0 skip locked limit 1;
 if not found then return null;end if;
 update public.advice_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes' where id=j.id returning * into j;
 select * into c from public.advice_cases where decision_id=j.decision_id;select * into r from public.advice_runs where id=c.run_id;
 return jsonb_build_object('job',to_jsonb(j),'case',to_jsonb(c),'run',to_jsonb(r));
end;$$;
create function public.finish_advice_job(p_id bigint,p_token uuid,p_payload jsonb default null,p_error text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.advice_jobs%rowtype; c public.advice_cases%rowtype; saved public.advice_records%rowtype; t timestamptz:=clock_timestamp();v jsonb; fingerprint text;
begin
 select * into j from public.advice_jobs where id=p_id for update;
 if not found or j.lease_token is distinct from p_token or j.lease_until<=t or j.status<>'running' then raise exception 'Expired or invalid advice lease';end if;
 if p_error is not null then
  update public.advice_jobs set status=case when attempts>=5 then 'failed' else 'retry' end,error=left(p_error,2000),next_at=t+interval '10 minutes',lease_token=null,lease_until=null where id=p_id;
  if j.kind='capture' then update public.advice_cases set status=case when j.attempts>=5 then 'failed' else 'retry' end,error=left(p_error,2000) where decision_id=j.decision_id;end if;
  return jsonb_build_object('error',p_error);
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Missing payload';end if;
 if j.kind='capture' then
  select * into c from public.advice_cases where decision_id=j.decision_id;
  if p_payload->>'kind' is distinct from 'dhq_advice' or p_payload->>'decisionId' is distinct from j.decision_id or p_payload->'context'->>'deadline' is distinct from c.spec->>'deadline' or p_payload->'context'->>'effectiveAt' is distinct from c.spec->>'effectiveAt' then raise exception 'Record does not match registered decision';end if;
  insert into public.advice_records(decision_id,payload) values(j.decision_id,p_payload) on conflict do nothing;
  select * into saved from public.advice_records where decision_id=j.decision_id;
  if saved.payload<>p_payload then raise exception 'Decision already has different immutable content';end if;
  update public.advice_cases set status='captured',error=null where decision_id=j.decision_id;
 else
  if jsonb_typeof(p_payload->'packets') is distinct from 'array' or jsonb_array_length(p_payload->'packets')=0 then raise exception 'At least one evidence packet required';end if;
  for v in select * from jsonb_array_elements(p_payload->'packets') loop
   if (v->>'week')::integer<>j.week or v->>'kind' not in ('lineup','outcome','grade','transactions') or j.kind='lineup' and v->>'kind'<>'lineup' or j.kind='outcome' and v->>'kind'='lineup' then raise exception 'Packet does not match job';end if;
   fingerprint=md5((v->'payload')::text);
   -- Outcomes may change after corrections. Lineups can never change.
   if v->>'kind'='lineup' and exists(select 1 from public.advice_packets where decision_id=j.decision_id and week=j.week and kind='lineup' and payload<>v->'payload') then raise exception 'Lineup snapshot is immutable';end if;
   insert into public.advice_packets(decision_id,week,kind,payload,fingerprint) values(j.decision_id,j.week,v->>'kind',v->'payload',fingerprint) on conflict do nothing;
  end loop;
 end if;
 update public.advice_jobs set status=case when kind='outcome' then 'pending' else 'complete' end,next_at=t+interval '6 hours',last_success_at=t,error=null,attempts=0,lease_token=null,lease_until=null where id=p_id;
 return jsonb_build_object('decisionId',j.decision_id,'receivedAt',coalesce(saved.received_at,t));
end;$$;

create function public.observe_advice(p_record jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare principal text:=public.advice_owner();saved public.advice_observations%rowtype;
begin
 if principal is null then raise exception 'Authentication required' using errcode='42501';end if;
 if coalesce(p_record->>'id','')!~'^[a-f0-9]{64}$' or coalesce(p_record->>'leagueId','')='' or p_record->>'kind' not in ('waiver','trade','capture_failure') or p_record->>'ownerKey' is distinct from principal then raise exception 'Invalid owner-bound displayed advice';end if;
 insert into public.advice_observations(owner_key,observation_id,league_id,payload) values(principal,p_record->>'id',p_record->>'leagueId',p_record) on conflict do nothing;
 select * into saved from public.advice_observations where owner_key=principal and observation_id=p_record->>'id';
 if (saved.payload-'capturedAt')<>(p_record-'capturedAt') then raise exception 'Observation ID conflict';end if;
 return jsonb_build_object('id',saved.observation_id,'receivedAt',saved.received_at);
end;$$;
create function public.note_advice_readback_failure(p_id bigint,p_error text) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.advice_jobs set error='Post-save readback: '||left(p_error,1800) where id=p_id;
end;$$;
create function public.read_advice_data(p_league_id text,p_table text,p_after bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare principal text:=public.advice_owner();result jsonb;
begin
 if principal is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_table='runs' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select * from public.advice_runs where owner_key=principal and league_id=p_league_id and seq>p_after order by seq limit 100) x;
 elsif p_table='cases' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select c.* from public.advice_cases c join public.advice_runs r on r.id=c.run_id where r.owner_key=principal and r.league_id=p_league_id and c.seq>p_after order by c.seq limit 100) x;
 elsif p_table='records' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select a.* from public.advice_records a join public.advice_cases c using(decision_id) join public.advice_runs r on r.id=c.run_id where r.owner_key=principal and r.league_id=p_league_id and a.seq>p_after order by a.seq limit 100) x;
 elsif p_table='packets' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select a.* from public.advice_packets a join public.advice_cases c using(decision_id) join public.advice_runs r on r.id=c.run_id where r.owner_key=principal and r.league_id=p_league_id and a.id>p_after order by a.id limit 100) x;
 elsif p_table='jobs' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select a.* from public.advice_jobs a join public.advice_cases c using(decision_id) join public.advice_runs r on r.id=c.run_id where r.owner_key=principal and r.league_id=p_league_id and a.id>p_after order by a.id limit 100) x;
 elsif p_table='observations' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select * from public.advice_observations where owner_key=principal and league_id=p_league_id and seq>p_after order by seq limit 100) x;
 else raise exception 'Unknown advice report table';end if;
 return result;
end;$$;
revoke all on function public.advice_owner(),public.enroll_advice_run(jsonb),public.claim_advice_job(),public.finish_advice_job(bigint,uuid,jsonb,text),public.note_advice_readback_failure(bigint,text),public.observe_advice(jsonb),public.read_advice_data(text,text,bigint) from public;
grant execute on function public.enroll_advice_run(jsonb),public.claim_advice_job(),public.finish_advice_job(bigint,uuid,jsonb,text),public.note_advice_readback_failure(bigint,text) to service_role;
grant execute on function public.observe_advice(jsonb),public.read_advice_data(text,text,bigint) to anon,authenticated;
