-- Private, append-only forecast archive. Clients cannot supply receipt time or owner.
-- Staged migration: no background upload is enabled by this file.
create table public.forecast_archive (
    owner_key text not null,
    forecast_id text not null check (forecast_id ~ '^[a-f0-9]{64}$'),
    league_id text not null,
    received_at timestamptz not null default clock_timestamp(),
    payload jsonb not null,
    primary key (owner_key, forecast_id),
    check (octet_length(payload::text) <= 8000000)
);
alter table public.forecast_archive enable row level security;
revoke all on public.forecast_archive from public, anon, authenticated;

create function public.forecast_archive_owner() returns text
language sql stable security invoker set search_path = '' as $$
    select case
        when public.current_app_user_id() is not null
            then 'account:' || public.current_app_user_id()::text
        when nullif(auth.jwt() -> 'app_metadata' ->> 'sleeper_username', '') is not null
            then 'sleeper:' || (auth.jwt() -> 'app_metadata' ->> 'sleeper_username')
        else null end;
$$;

create function public.archive_forecast(p_record jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    principal text := public.forecast_archive_owner();
    saved public.forecast_archive%rowtype;
begin
    if principal is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if p_record is null or p_record->>'schemaVersion' is distinct from '1'
       or p_record->>'mode' is distinct from 'shadow'
       or coalesce(p_record->>'leagueId', '') = ''
       or coalesce(p_record->>'id', '') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(p_record->'rows') is distinct from 'array'
       or octet_length(p_record::text) > 8000000 then
        raise exception 'Invalid forecast envelope';
    end if;
    insert into public.forecast_archive(owner_key, forecast_id, league_id, payload)
    values (principal, p_record->>'id', p_record->>'leagueId', p_record)
    on conflict (owner_key, forecast_id) do nothing;
    select * into saved from public.forecast_archive
        where owner_key = principal and forecast_id = p_record->>'id';
    if saved.payload <> p_record then raise exception 'Forecast ID already has different content'; end if;
    return jsonb_build_object('id', saved.forecast_id, 'receivedAt', saved.received_at);
end;
$$;

-- Cursor pagination avoids silently truncating a season's archive.
create function public.read_forecast_archive(p_league_id text, p_after text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare principal text := public.forecast_archive_owner(); result jsonb;
begin
    if principal is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('record', page.payload,
        'receipt', jsonb_build_object('id', page.forecast_id, 'receivedAt', page.received_at))
        order by page.forecast_id), '[]'::jsonb) into result
    from (select forecast_id, received_at, payload from public.forecast_archive
        where owner_key = principal and league_id = p_league_id and forecast_id > p_after
        order by forecast_id limit 25) page;
    return result;
end;
$$;
revoke all on function public.forecast_archive_owner() from public;
revoke all on function public.archive_forecast(jsonb) from public;
revoke all on function public.read_forecast_archive(text, text) from public;
grant execute on function public.archive_forecast(jsonb) to anon, authenticated;
grant execute on function public.read_forecast_archive(text, text) to anon, authenticated;
