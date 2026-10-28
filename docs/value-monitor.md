# Value history repair and finite seven-day monitor

## Milestones

- **Implemented locally:** yes, on `feature/value-monitor-20261028` in both isolated worktrees under `/Users/jacobc/Projects/work/value-monitor/`.
- **Frontend deployment:** subsequently authorized. The release workflow builds this source; verify the served `release.json` and assets for the exact deployed revision. Hosted verification is reported separately from local tests.
- **Production migration applied:** yes, `20261028000000`, on the shared `sxshiqyxhhifvtfqawbq` backend after a transactional compatibility/readback check. The original table had zero records; the migration retains zero historical rows rather than fabricating observations.
- **Scheduler enabled:** no. The workflow is gated and no activation variables or secrets were set.
- **First real capture verified:** no.
- **Completed real seven-day report:** no. Only explicitly labeled controlled fixtures exist locally.

Original dirty checkouts and the earlier reliability/CBS worktrees were preserved. The app starts from sandbox `0ba4481`; canonical shared code starts from `a3b9952`. The initial implementation remained local. A subsequent explicit deploy instruction authorized publication, the additive database migration and the WarRoom-sandbox frontend release. No league transaction, monitoring enrollment or live collector activation was performed.

## What changed

`dhq-shared/supabase-client.js` now awaits both snapshot write paths, checks returned database errors, rejects authentication/validation/transport failures, and reads persisted rows back before returning `{ok:true, verified:true, rows}`. Duplicate capture keys retain the original observation; completion returns the stored record, which can differ from a later retry's attempted value. Readers surface failures and paginate beyond PostgREST's first page.

`dhq-shared/value-history.js` owns the canonical record contract and report calculations. `value-monitor-runtime.cjs` hosts the actual canonical browser engine modules in an isolated Node VM with a new input/cache scope for every capture. It does not contain an alternative value formula. Dynasty uses `loadLeagueIntel`; redraft uses `PlayerValue.computePrices`, the same seasonal calculation used by the app. Missing seasonal evidence stays null. A zero remains zero.

The app synchronization script vendors the new shared modules and generates an engine-source fingerprint identical to the server host's. `player-value.js` remains byte-identical through the established twin check. The production build explicitly emits the dynamically loaded history contract and database client, and cache versions for changed shared scripts are advanced.

The additive migration `20261028000000_value_monitor.sql`:

- Preserves existing IDs, values, source labels and timestamps. Legacy rows receive `legacy:<existing uuid>` capture identities; no past values or calculation times are fabricated.
- Replaces the weekly uniqueness key with `(league_id, player_id, value_type, capture_key)` and allows null values with explicit calculation status.
- Stores capture/calculation times, format, roster memberships and provenance separately. Updates to existing observations are rejected. Original account deletion/access policies remain in place.
- Adds private, owner-readable run/capture metadata. Enrollment and collection RPCs are service-role-only. Browser writers cannot forge monitor records. Existing authenticated league-history read policy is preserved; it is not broadened by this migration.
- Claims due slots with row locks, a 15-minute lease and a fencing token. Atomic finish inserts the complete selected scope and queries persisted coverage before updating status. Missing/unsupported player values remain recorded as missing observations.

Browser observations use a UTC calendar-day capture bucket and freeze the first observation per player/format/day. They are labeled separately from a server monitor. Batch completion/failure is observable without blocking rendering, with per-league state and correct late-response isolation. Local aggregate team timelines remain browser-local and are not presented as persisted player-history evidence.

Draft/trade captures use stable event identities. Newly discovered old events are recorded with **today's capture time**, keeping their original event time as context. They do not create invented trade-date history. Previously stored legacy history is retained but its old provenance cannot be retroactively verified. New discovery observations are excluded from historical trade-date price lookups.

## Run semantics and freshness

An operator explicitly selects one Sleeper league, `dynasty` or `redraft`, season, report owner, timezone, and 1–500 stable player IDs. A roster-scoped enrollment must list the selected roster IDs; their player scope freezes at enrollment. Later roster changes are recorded as membership changes, not silent changes in the monitored population. Keeper and other platforms/formats are rejected by this first collector rather than mislabeled.

A run has a baseline plus seven subsequent captures, 24 hours apart. Subsequent slots are anchored to the actual baseline observation time, covering at least 168 hours. The timezone is used for reporting; daylight saving can shift the local clock time. Hourly scheduler ticks may be delayed. A due slot has a six-hour capture window; it is never backfilled later with current values. Network/database failures retry after 15 minutes, at most three attempts. A lost worker lease can be reclaimed after expiry. Partial captures preserve missing/stale/error rows and are not overwritten to suggest complete coverage. The terminal run is complete only with all eight supported captures; otherwise it is incomplete. Finished runs are retained and no longer collected.

The Node collector freshly reads the league, complete rosters, player directory, NFL state and engine dependencies. Dynasty reloads historical scoring/draft/transaction inputs through the canonical provider; redraft reloads current/prior stats, seasonal projections, NFL game context and FantasyCalc redraft inputs. Bundled rookie reference files retain their content hashes. No prior calculated value is reused as a fresh calculation. Requests within a capture deduplicate, with a new host for each capture. Required request failures remain explicit, including failures swallowed into fallback paths by the underlying engine. Values from incomplete required retrievals are flagged `error`; current-input responses with HTTP cache Age over 15 minutes are flagged `stale` (30 days for completed-season stat files). Malformed player/stat/market structures are rejected, even if an engine fallback would otherwise swallow the error. Unknown provider currency remains explicit.

`fetchedAt` means successful retrieval, not proof the provider updated its underlying dataset. Provider as-of is null when not supplied. The report retains source content hashes, fetch times, cache age, missing/fallback details, engine messages, engine hash, build revision, settings hash, selected format, roster membership, week, horizon and market version. Configuration, engine, source-data and roster changes are **associations**; unexplained movement is unknown. The same source hashes on two days are legitimate repeated observations, not evidence of failed collection.

CBS is optional and uses the existing validated market snapshot. Its absence is disclosed and follows the app's bounded fallback. No CBS source scraping or activation is added by this task. Market prices remain distinct from fantasy-point estimates.

## Reporting UI

Open a player's **Value History** tab. The existing chart/history view now separates dynasty and redraft, preserves zero/unknown, shows capture dates/status/provenance, and surfaces database errors. It shows the latest 40 listed records; the reader retains the full paginated history. Legacy provenance is identified as potentially unverified.

Expand **Seven-day value monitor** to see the selected run, explicit player scope, timezone/start/end, collection status, last successful capture, next scheduled slot, expected/stored/valid observations, missing/failed/partial days, stale values, attempts and errors. Endpoint changes require actual baseline and day-7 values. Percentage change is unavailable when the baseline is zero. Risers, fallers, conspicuous jumps (at least 1,000 points or 25%) and engine/settings comparison limitations are shown. A failed collection is distinct from a measured zero change. The report is owner-scoped and read-only; viewing a league never enrolls it.

This evaluates value movement and collection reliability. It does not establish forecast accuracy or trustworthiness of waiver/trade recommendations. Preserve the existing forecast ledger for separate prospective evaluation.

## Local verification

Commands from the app worktree:

```sh
npm ci --ignore-scripts
SHARED_SOURCE=../dhq-shared npm run sync:shared
npm run test:value-monitor
npm run test:redraft-reliability
node tests/run.js
node scripts/build-deploy.cjs
npm run test:value-monitor:build
# In a separate local terminal:
node scripts/serve-static.cjs --port=3528
npm run test:value-monitor:browser
```

The focused tests use the actual pinned Supabase JS **2.101.1** with mocked HTTP transport backed by a local PGlite PostgreSQL database executing the real old/new migrations, policies and RPCs. They reproduce zero requests from both old write functions and exercise repaired POSTs plus persistence/readback, returned errors/rejected requests, legacy preservation, same-week daily observations, idempotency, zero/missing, format separation, pagination, scoped browser capture, leases, partial/failed/missed runs, terminal completion, immutability, RLS and representative dynasty/redraft server/app parity. This is not a live Supabase/PostgREST service test; production PostgREST schema-cache/RLS/session reconciliation remains an activation check.

The minified production writer test repeats dispatch/readback and verifies browser/server engine fingerprints. Browser tests load the production PlayerCard/monitor components with dated controlled fixtures, at 390 and 1365 pixels, checking format separation, explicit read errors and report evidence. Fixture outputs are in ignored `output/value-monitor/`, including `dated-fixture-report.json`, generated review HTML and screenshots. They are marked fixture-only and never inserted into production.

Most recent local results: **15/15 focused tests**, **37/37 affected test files**, **97/97 core tests**, **22/22 CBS tests**, **18/18 shared contract/scoring/provenance tests**, six production entrypoints, minified history/forecast/market checks, and report UI at 390/1365 pixels all pass. The existing integrated browser fixtures also pass complete rosters, partial rosters, disabled adds and exhausted FAAB. ESLint reports zero errors and eight existing unused-variable warnings. `git diff --check` passes. No unresolved test failures remain. Logs and a source-hash/milestone manifest are retained in `output/value-monitor/verification/`.

## Coordinated release and remaining collector activation

Shared commit `61883813d6d56d0582259c8b18fc88024574f8b5` has been published on `feature/value-monitor-20261028`; its raw source bytes were verified publicly. The migration passed a live transactional rollback test before installation, with RPC grants/RLS and REST schema visibility verified. These checks do not constitute a real monitoring observation. Steps below describe the complete release/activation procedure; publication/pinning/migration are complete for this release, while explicit scope, collector credentials and scheduler activation remain pending.

1. **Publish canonical shared code first.** Commit/review the shared branch containing `supabase-client.js`, `dhq-engine.js`, `value-history.js` and `value-monitor-runtime.cjs`; publish it only when authorized. Read the actual final 40-character SHA from the remote. Verify that the runner's GitHub connection can check out that exact commit. Do not use a guessed or unpublished SHA.
2. **Update both app pins.** Set `.github/workflows/deploy.yml`'s `shared-src` checkout ref to that published SHA. Set repository variable `VALUE_MONITOR_SHARED_REVISION` to the same SHA for the separate collector workflow. The subsequent authorized release pins both frontend and backend-validation workflows to the published shared commit `61883813d6d56d0582259c8b18fc88024574f8b5`. The collector remains disabled; its revision variable is an activation setting. Run `SHARED_SOURCE=<exact checkout> npm run sync:shared`, tests and build against that revision. Include all app code, migration, synchronized-module configuration, package lock and collector workflow in the reviewed app release.
3. **Apply the one new migration to a staging/test Supabase first**, with the earlier `20260809000000_player_value_snapshots.sql` and existing app identity migrations already present. Confirm legacy row count/IDs/values are unchanged, the new columns/indexes/functions exist, RLS is enabled, and schema cache has reloaded. Re-run using a real test account and service-role worker. After approval, apply `supabase/migrations/20261028000000_value_monitor.sql` to the intended project through the established migration lane. Do not reset the database or replay unrelated migrations blindly.
4. **Deploy the app/collector workflow** only under separate authorization. No new Edge Function is required: the Node worker uses the existing Supabase REST/RPC backend. GitHub scheduled workflows must be on the default branch and Actions enabled. The app release must include the matching canonical source; an old shared pin will correctly fail sync rather than deploy a partial repair.
5. **Configure server credentials** in a protected GitHub Actions environment named `value-monitor`: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put the service key into app config, public data, screenshots or browser storage. The job needs read-only repository access; it writes only the monitoring database through service RPCs. No service key was read or configured during this task.
6. **Explicitly enroll selected scope.** Copy `scripts/value-monitor/enrollment.example.json` to an operator-only file and replace league ID, format, current season, future baseline timestamp, timezone, actual `app_users.id` report owner, and selected player IDs. For roster scope use `"scope":{"kind":"rostered","roster_ids":[1,2]}`; only these rosters are resolved and frozen. No wildcard or all-users enrollment exists. Set the server environment securely, then run:

```sh
node scripts/value-monitor/run.cjs enroll /secure/selected-league.json
```

Keep the returned `runId`. An existing active run for the same league/format blocks overlapping enrollment. Use a future baseline close to the activation time. Enrollment does not start a browser task or a recurring Codex task.

7. **Enable and verify the scheduler.** Set `VALUE_MONITOR_ENABLED=true`, then manually dispatch **Seven-day value monitor**. It checks hourly at minute 17 and requires `VALUE_MONITOR_SHARED_REVISION`; its collection routine also runs independently from a server command:

```sh
node scripts/value-monitor/run.cjs collect
node scripts/value-monitor/run.cjs report THE_RETURNED_RUN_UUID
```

The scheduler processes up to four due captures per invocation, with a 12-minute job timeout. This is deliberately a small-scope monitor; stagger baselines or adjust capacity before enrolling many leagues. GitHub cron delays/outages can create missing days, which remain visible. Disabling `VALUE_MONITOR_ENABLED` stops future invocations; changing a run to `cancelled` through an authorized operator stops that run. The monitor itself finishes each finite run and retains its report.

## Verify the first real capture

After the first authorized job, perform database readback (not just an Actions success/log):

```sql
select id, league_id, value_type, player_ids, starts_at, ends_at, status
from public.value_monitor_runs where id = 'THE_RETURNED_RUN_UUID';
select capture_index, scheduled_at, status, attempts, captured_at,
       saved_count, valid_count, readback_at, error
from public.value_monitor_captures where run_id = 'THE_RETURNED_RUN_UUID'
order by capture_index;
select player_id, value_type, ts, calculated_at, value, calculation_status,
       capture_key, roster_ids, provenance
from public.player_value_snapshots
where run_id = 'THE_RETURNED_RUN_UUID' and capture_index = 0
order by player_id;
```

Verify exactly the frozen selected IDs are present, `saved_count` matches their number, the actual capture/calculation times belong to this run, zero/null/status distinctions are correct, hashes/format/settings/source evidence are present, and `readback_at` is set. Log in as the configured report owner and refresh the monitor panel; confirm the same capture appears. Retry collection and confirm row counts/IDs remain unchanged. Verify the next scheduled capture occurs from a server tick without an open app. Only then mark **scheduler enabled** and **first real capture verified**. After the actual eighth supported capture, inspect complete coverage and the 168-hour span before calling the real seven-day report complete.
