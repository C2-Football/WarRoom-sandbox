-- Internal evaluation only. Preserve existing evidence while removing browser access.
revoke all on function public.observe_advice(jsonb),public.read_advice_data(text,text,bigint) from public,anon,authenticated;
grant execute on function public.observe_advice(jsonb),public.read_advice_data(text,text,bigint) to service_role;
