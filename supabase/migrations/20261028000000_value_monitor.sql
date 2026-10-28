-- Additive history repair. Existing rows retain IDs, values, timestamps and source.
-- No production scheduling/enrollment is performed by this migration.
begin;
alter table public.player_value_snapshots
 add column if not exists capture_key text,
 add column if not exists calculated_at timestamptz,
 add column if not exists calculation_status text not null default 'ok',
 add column if not exists provenance jsonb not null default '{}',
 add column if not exists roster_ids jsonb not null default '[]',
 add column if not exists run_id uuid,
 add column if not exists capture_index integer;
update public.player_value_snapshots set capture_key='legacy:'||id::text where capture_key is null;
alter table public.player_value_snapshots alter column capture_key set not null;
alter table public.player_value_snapshots alter column value drop not null;
-- Constraint names may have been truncated by PostgreSQL; find the exact old key.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.player_value_snapshots'::regclass and contype='u'
 and pg_get_constraintdef(oid)='UNIQUE (league_id, player_id, season, week, source)'
 loop execute format('alter table public.player_value_snapshots drop constraint %I',c.conname); end loop;
end $$;
alter table public.player_value_snapshots drop constraint if exists player_value_snapshots_source_check;
alter table public.player_value_snapshots add constraint player_value_snapshots_source_check check(source in ('draft','trade','periodic','monitor'));
alter table public.player_value_snapshots drop constraint if exists value_snapshot_status_check;
alter table public.player_value_snapshots add constraint value_snapshot_status_check check(calculation_status in ('ok','missing','stale','error') and (calculation_status<>'ok' or value is not null));
create unique index if not exists value_snapshot_capture_identity on public.player_value_snapshots(league_id,player_id,value_type,capture_key);
create index if not exists value_snapshot_run on public.player_value_snapshots(run_id,capture_index);

create table if not exists public.value_monitor_runs (
 id uuid primary key default gen_random_uuid(), league_id text not null,
 value_type text not null check(value_type in ('dynasty','redraft')),
 season integer not null, player_ids jsonb not null check(jsonb_array_length(player_ids) between 1 and 500),
 scope jsonb not null, timezone text not null default 'UTC',
 starts_at timestamptz not null, ends_at timestamptz not null,
 capture_times jsonb not null check(jsonb_array_length(capture_times)=8),
 status text not null default 'active' check(status in ('active','complete','incomplete','cancelled')),
 user_id uuid references public.app_users(id) on delete cascade, username text,
 created_at timestamptz not null default now(), check ((user_id is null) <> (username is null))
);
create unique index if not exists value_monitor_one_active on public.value_monitor_runs(league_id,value_type) where status='active';
create table if not exists public.value_monitor_captures (
 run_id uuid references public.value_monitor_runs(id) on delete cascade,
 capture_index integer check(capture_index between 0 and 7), scheduled_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','collecting','complete','partial','failed','missing')),
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
 captured_at timestamptz, saved_count integer not null default 0, valid_count integer not null default 0,
 error text, readback_at timestamptz, primary key(run_id,capture_index)
);
alter table public.value_monitor_runs enable row level security;
alter table public.value_monitor_captures enable row level security;
drop policy if exists value_monitor_owner_read on public.value_monitor_runs;
create policy value_monitor_owner_read on public.value_monitor_runs for select using(
 (user_id is not null and user_id=public.current_app_user_id()) or
 (username is not null and username=auth.jwt()->'app_metadata'->>'sleeper_username'));
drop policy if exists value_monitor_capture_read on public.value_monitor_captures;
create policy value_monitor_capture_read on public.value_monitor_captures for select using(exists(select 1 from public.value_monitor_runs r where r.id=run_id));
grant select on public.value_monitor_runs,public.value_monitor_captures to anon,authenticated;
grant all on public.value_monitor_runs,public.value_monitor_captures,public.player_value_snapshots to service_role;
-- Browser principals cannot forge scheduled captures, even with their own owner ID.
drop policy if exists value_snapshot_monitor_guard on public.player_value_snapshots;
create policy value_snapshot_monitor_guard on public.player_value_snapshots as restrictive for insert to anon,authenticated with check(source<>'monitor' and run_id is null and capture_index is null);

create or replace function public.claim_value_monitor_capture() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed public.value_monitor_captures; run_row public.value_monitor_runs; token uuid:=gen_random_uuid();
begin
 -- Never backfill a missed day with today's values. Six-hour collection window.
 update value_monitor_captures x set status=case when attempts>0 then 'failed' else 'missing' end,error=coalesce(error,'Capture window expired')
 from value_monitor_runs r where r.id=x.run_id and r.status='active' and x.status in ('scheduled','collecting') and x.scheduled_at+interval '6 hours'<now() and (x.lease_until is null or x.lease_until<now());
 update value_monitor_runs r set status=case when (select count(*) from value_monitor_captures c where c.run_id=r.id and c.status='complete')=8 then 'complete' else 'incomplete' end
 where r.status='active' and r.ends_at<=now() and not exists(select 1 from value_monitor_captures c where c.run_id=r.id and c.status in ('scheduled','collecting'));
 select x.* into claimed from value_monitor_captures x join value_monitor_runs r on r.id=x.run_id
 where r.status='active' and x.status in ('scheduled','collecting') and x.scheduled_at<=now() and x.scheduled_at+interval '6 hours'>=now()
 and (x.lease_until is null or x.lease_until<now()) order by x.scheduled_at for update of x skip locked limit 1;
 if not found then return null; end if;
 update value_monitor_captures set status='collecting',attempts=attempts+1,lease_token=token,lease_until=now()+interval '15 minutes' where run_id=claimed.run_id and capture_index=claimed.capture_index returning * into claimed;
 select * into run_row from value_monitor_runs where id=claimed.run_id;
 return jsonb_build_object('run',to_jsonb(run_row),'capture',to_jsonb(claimed));
end $$;

create or replace function public.finish_value_monitor_capture(p_run uuid,p_index integer,p_token uuid,p_rows jsonb,p_error text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.value_monitor_captures; r public.value_monitor_runs; n integer; good integer; baseline_at timestamptz;
begin
 select * into c from value_monitor_captures where run_id=p_run and capture_index=p_index for update;
 if not found or c.status<>'collecting' or c.lease_token is distinct from p_token or c.lease_until<now() then raise exception 'Expired or invalid capture lease'; end if;
 select * into r from value_monitor_runs where id=p_run;
 if p_error is not null then
  update value_monitor_captures set status=case when attempts>=3 then 'failed' else 'scheduled' end,error=left(p_error,2000),lease_until=now()+interval '15 minutes' where run_id=p_run and capture_index=p_index;
  return jsonb_build_object('ok',false,'error',p_error);
 end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<>jsonb_array_length(r.player_ids) or
 (select count(distinct x->>'player_id') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(r.player_ids) or
 exists(select 1 from jsonb_array_elements(p_rows) x where not(r.player_ids ? (x->>'player_id')) or x->>'value_type'<>r.value_type or x->>'league_id'<>r.league_id or (x->>'season')::int<>r.season or (x->>'ts')::timestamptz<c.scheduled_at or (x->>'ts')::timestamptz>now()+interval '1 minute' or x->>'calculated_at' is null or (x->>'calculated_at')::timestamptz<c.scheduled_at or (x->>'calculated_at')::timestamptz>now()+interval '1 minute')
 then raise exception 'Invalid capture scope/coverage/time'; end if;
 insert into player_value_snapshots(league_id,player_id,season,week,ts,value,value_type,source,context,capture_key,calculated_at,calculation_status,provenance,roster_ids,run_id,capture_index,user_id,username)
 select r.league_id,x->>'player_id',r.season,(x->>'week')::int,(x->>'ts')::timestamptz,(x->>'value')::numeric,r.value_type,'monitor',coalesce(x->'context','{}'),
 'monitor:'||p_run||':'||p_index,(x->>'calculated_at')::timestamptz,x->>'calculation_status',x->'provenance',x->'roster_ids',p_run,p_index,r.user_id,r.username
 from jsonb_array_elements(p_rows) x on conflict(league_id,player_id,value_type,capture_key) do nothing;
 select count(*),count(*) filter(where calculation_status='ok' and value is not null) into n,good from player_value_snapshots where run_id=p_run and capture_index=p_index;
 if n<>jsonb_array_length(r.player_ids) then raise exception 'Persisted readback incomplete';end if;
 update value_monitor_captures set status=case when good=n then 'complete' else 'partial' end,captured_at=now(),saved_count=n,valid_count=good,readback_at=now(),error=null,lease_until=null where run_id=p_run and capture_index=p_index;
 -- Anchor subsequent days to the actual baseline observation, so a late first
 -- scheduler tick cannot shorten the seven-day measurement interval.
 if p_index=0 then
  select min(ts) into baseline_at from player_value_snapshots where run_id=p_run and capture_index=0;
  update value_monitor_runs set starts_at=baseline_at,ends_at=baseline_at+interval '168 hours',
   capture_times=(select jsonb_agg(baseline_at+i*interval '24 hours' order by i) from generate_series(0,7) i) where id=p_run;
  update value_monitor_captures set scheduled_at=baseline_at+capture_index*interval '24 hours' where run_id=p_run and capture_index>0 and status='scheduled';
 end if;
 update value_monitor_runs set status=case when (select count(*) from value_monitor_captures where run_id=p_run and status='complete')=8 then 'complete' else 'incomplete' end
 where id=p_run and ends_at<=now() and not exists(select 1 from value_monitor_captures where run_id=p_run and status in ('scheduled','collecting'));
 return jsonb_build_object('ok',true,'stored',n,'valid',good,'readbackAt',now());
end $$;
revoke all on function public.claim_value_monitor_capture() from public,anon,authenticated;
revoke all on function public.finish_value_monitor_capture(uuid,integer,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_value_monitor_capture() to service_role;
grant execute on function public.finish_value_monitor_capture(uuid,integer,uuid,jsonb,text) to service_role;
create or replace function public.enroll_value_monitor(p_config jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare id uuid:=gen_random_uuid(); start_at timestamptz:=(p_config->>'starts_at')::timestamptz; times jsonb;
begin
 if start_at<now()-interval '5 minutes' or start_at>now()+interval '90 days' then raise exception 'Baseline must be scheduled now or in future';end if;
 if not exists(select 1 from pg_timezone_names where name=p_config->>'timezone') then raise exception 'Unknown timezone';end if;
 if (select count(distinct x) from jsonb_array_elements_text(p_config->'player_ids') x)<>jsonb_array_length(p_config->'player_ids') then raise exception 'Duplicate player IDs';end if;
 select jsonb_agg(start_at+i*interval '24 hours' order by i) into times from generate_series(0,7) i;
 insert into value_monitor_runs(id,league_id,value_type,season,player_ids,scope,timezone,starts_at,ends_at,capture_times,user_id,username)
 values(id,p_config->>'league_id',p_config->>'value_type',(p_config->>'season')::int,p_config->'player_ids',p_config->'scope',p_config->>'timezone',start_at,start_at+interval '168 hours',times,(p_config->>'user_id')::uuid,p_config->>'username');
 insert into value_monitor_captures(run_id,capture_index,scheduled_at) select id,i,start_at+i*interval '24 hours' from generate_series(0,7) i;
 return id;
end $$;
revoke all on function public.enroll_value_monitor(jsonb) from public,anon,authenticated;
grant execute on function public.enroll_value_monitor(jsonb) to service_role;
create or replace function public.reject_value_snapshot_update() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Value observations are immutable'; end $$;
drop trigger if exists value_snapshot_immutable on public.player_value_snapshots;
create trigger value_snapshot_immutable before update on public.player_value_snapshots for each row execute function public.reject_value_snapshot_update();
commit;
