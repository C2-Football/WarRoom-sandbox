-- Server-side product analytics rollup for internal launch operations.
-- Browsers remain insert-only through RLS; this function is service-role only.

create index if not exists analytics_events_ts_idx
  on public.analytics_events (event_ts desc);

create index if not exists analytics_events_platform_ts_idx
  on public.analytics_events (platform, event_ts desc);

create index if not exists analytics_events_module_ts_idx
  on public.analytics_events (module, event_ts desc);

create or replace function public.admin_analytics_report(
  p_since timestamptz default now() - interval '7 days'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with scoped as (
  select *
  from public.analytics_events
  where event_ts >= p_since
),
funnel_steps(ord, event_name, label) as (
  values
    (1, 'landing_viewed', 'Landing viewed'),
    (2, 'signup_started', 'Signup started'),
    (3, 'signup_succeeded', 'Signup succeeded'),
    (4, 'checkout_started', 'Checkout started'),
    (5, 'module_viewed', 'Product opened'),
    (6, 'alex_prompt_sent', 'AI prompt sent')
),
funnel_counts as (
  select
    fs.ord,
    fs.event_name,
    fs.label,
    count(s.event_id) as events,
    count(distinct s.session_id) as sessions,
    count(distinct s.username) filter (where s.username is not null) as users
  from funnel_steps fs
  left join scoped s on s.event_name = fs.event_name
  group by fs.ord, fs.event_name, fs.label
),
funnel_dropoffs as (
  select
    a.ord,
    a.event_name as from_event,
    b.event_name as to_event,
    a.sessions as from_sessions,
    b.sessions as to_sessions,
    case
      when a.sessions = 0 then null
      else round(((a.sessions - b.sessions)::numeric / a.sessions::numeric) * 100, 1)
    end as dropoff_pct
  from funnel_counts a
  join funnel_counts b on b.ord = a.ord + 1
)
select jsonb_build_object(
  'since', p_since,
  'generatedAt', now(),
  'totals', (
    select jsonb_build_object(
      'events', count(*),
      'sessions', count(distinct session_id),
      'knownUsers', count(distinct username) filter (where username is not null),
      'anonymousSessions', count(distinct session_id) filter (where username is null),
      'clientErrors', count(*) filter (where event_name = 'client_error'),
      'sentryLinkedErrors', count(*) filter (
        where event_name = 'client_error'
          and coalesce(metadata->>'sentryEventId', '') <> ''
      )
    )
    from scoped
  ),
  'funnel', coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventName', event_name,
      'label', label,
      'events', events,
      'sessions', sessions,
      'users', users
    ) order by ord)
    from funnel_counts
  ), '[]'::jsonb),
  'dropoffs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'from', from_event,
      'to', to_event,
      'fromSessions', from_sessions,
      'toSessions', to_sessions,
      'dropoffPct', dropoff_pct
    ) order by ord)
    from funnel_dropoffs
  ), '[]'::jsonb),
  'topEvents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventName', event_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select event_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by event_name
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topModules', coalesce((
    select jsonb_agg(jsonb_build_object(
      'module', module_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(module, 'unknown') as module_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by coalesce(module, 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topWidgets', coalesce((
    select jsonb_agg(jsonb_build_object(
      'widget', widget_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(widget, 'unknown') as widget_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      where event_name in ('ui_clicked', 'widget_clicked')
      group by coalesce(widget, 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topRoutes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'route', route,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(metadata->>'route', 'unknown') as route, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by coalesce(metadata->>'route', 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'errors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'source', source,
      'errorName', error_name,
      'events', event_count,
      'sessions', sessions,
      'sentryIssues', sentry_issues,
      'lastSeen', last_seen
    ) order by event_count desc)
    from (
      select
        coalesce(metadata->>'source', 'unknown') as source,
        coalesce(metadata->>'errorName', 'Error') as error_name,
        count(*) as event_count,
        count(distinct session_id) as sessions,
        count(distinct (metadata->>'sentryEventId')) filter (
          where coalesce(metadata->>'sentryEventId', '') <> ''
        ) as sentry_issues,
        max(event_ts) as last_seen
      from scoped
      where event_name = 'client_error'
      group by coalesce(metadata->>'source', 'unknown'), coalesce(metadata->>'errorName', 'Error')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb)
);
$$;

revoke all on function public.admin_analytics_report(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_analytics_report(timestamptz) to service_role;
