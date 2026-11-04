# DHQ Advice Scorecard — local implementation and activation guide

Status on November 4, 2026: implemented locally. Not deployed. No production migration, live enrollment, live scheduled job, real advice capture, or completed real outcome grade was performed. No claim of improved football advice is made. Test data and the preview are simulations.

## Implementation

The scorecard is available under My Roster → DHQ Advice Scorecard. Displayed-advice capture defaults to off in `content/advice-scorecard.json`. Its archive preserves the returned advice, every candidate and hold, the visible horizon/selected package/FAAB input, roster and scoring context, player status, projections and supporting calculations. An account-bound outbox retries interrupted saves, waits for the database request, checks the server receipt, and independently reads saved bytes back. Repeated identical views retain their first receipt and do not increase evaluation sample size.

Prospective monitored decisions are registered before their capture times. Each has a stable run/case ID, deadline, assumed effective time, cohort, calendar and pinned runtime. The autonomous Node collector uses the existing Supabase stack and actual canonical valuation, weekly projection, waiver and trade lens paths. It records current advice, a named candidate, hold, and a simple strategy from one frozen context. This includes ignored advice and no-upgrade holds. Failure to produce advice remains a failed/missing case, never an invented hold. Scheduled advice is available to read in the scorecard even if the owner never opens the original lens.

Recommendation history is distinct from the old player forecast ledger. Nothing imports or reinterprets old forecasts as advice. `scripts/lib/advice-evaluation.cjs` and `scripts/evaluate-advice-scorecard.cjs` follow the existing forecast evaluator/export pattern without changing its semantics.

Canonical additions in `dhq-shared`: `advice-scorecard.js` and the existing waiver/trade/eligibility/basis modules, now explicitly synchronized from their canonical copies. The current recommendation algorithms are retained; their only integration change is a failure-isolated capture callback. App synchronization still verifies the player-value twin. Value-history writers and monitor tables are preserved.

The additive migration is `supabase/migrations/20261104000000_advice_scorecard.sql`. Tables store runs, expected cases, original recommendations, append-only lineup/outcome/grade/transaction packets, leased jobs, and actual displayed observations. Owner-only RPCs derive identity from the existing account or legacy JWT. Browser roles cannot claim jobs, enroll monitors, edit predictions, write outcomes, or supply server receipt times. Service credentials are required only in the server collector. No fantasy transaction API writes exist.

## Predeclared evaluation policy

- Primary measure: actual starting-lineup points after the recommended move minus holding. Also show points versus the simple baseline.
- Waivers: next eligible **full** scoring week and a four-week window. Trades: four weeks and the remaining declared fantasy season. A four-week window near season end stays incomplete if fewer than four weeks exist; it is not silently shortened.
- The first eligible full week must begin after the assumed acquisition/trade effective time. For any delayed effect, the move does not affect a week whose lineup checkpoint has already passed.
- At each registered checkpoint (normally two hours before the week's first kickoff), choose a legal lineup with frozen pregame projections. Weighted assignment honors dedicated slots, FLEX, multi-position eligibility and captured reserve/taxi exclusions. Known byes and inactive players are excluded. Empty slots score zero; missing projections prevent grading. Missing actual player rows never become zero.
- No subsequent additions, drops, trades, reserve promotions, late injury substitutions or post-checkpoint lineup swaps are simulated. Every comparison uses this same policy. This is a fixed-roster conditional comparison, not a replay of the owner's later management decisions.
- A player who scores heavily on the bench does not add starting-lineup points. Bench totals, assumed FAAB, lost players, and dropped-player points that would have started are retained separately. Actual FAAB from observed matching transactions is separate from assumed spending.
- Simple strategy: choose the greatest next-week projected starting-lineup gain from all legal single add/drop or one-for-one trade alternatives, plus the exact multi-player packages issued by DHQ. Ties prefer less lost projected depth. It uses the same eligible player pool, scoring, ownership, locks, capacity and budget. It is conditional on obtaining the move; it does not predict partner acceptance or winning bids.
- Candidate `depth-aware-v1`: same opportunity context and lineup calculations, ranked by projected lineup gain minus 0.1 times outgoing projected production, with hold when the adjusted gain is not positive. This is an explicitly testable candidate, not a validated improvement. The scorecard reports actual points and costs separately; the ranking rule is disclosed. Production weights are never changed by collection or evaluation.
- Training/tuning and validation windows are declared at enrollment; validation starts strictly after the tuning cutoff. New versions require a separate pinned run. Promotion remains manual.

## Evidence and limitations

Prospective grading uses **registered scheduled cases**, original server receipts and weekly pre-kickoff snapshots. Browser history captures actual screen output, but existing browser data loaders do not expose complete verified source/deadline timestamps. Those observations are visibly excluded from prospective grades. They are not backfilled using current data. The monitored recommendation surface is the existing roster waiver/trade lenses; unrelated free-agent/home/chat surfaces are not represented as captured advice.

Autonomous capture currently supports Sleeper redraft and dynasty. Unsupported providers, keeper/custom modes and unavailable scoring/calendar evidence fail explicitly. Format reporting distinguishes team count, PPR, QB/Superflex, TE premium and IDP. Standard roster capacity, reserve/taxi, locks, protected players and copy availability are checked. Trade packages needing an unprovided partner drop are rejected.

Sources are the app's existing Sleeper raw-stat/projection feeds and ESPN schedule/game status feed. Public API smoke checks on November 4 returned a current schedule and 2,080 week-8 stat rows, including 1,367 rows with explicit participation fields. This verifies endpoint availability only. It is **not** a real advice capture or an accuracy result. The raw-stat endpoint is not documented as a complete player-stat service in [Sleeper's API documentation](https://docs.sleeper.com/). A final game plus an explicit player participation/stat row is required; absent rows remain missing. Provider publication times are not invented: retrieval times, cache age, available Last-Modified values and input hashes are retained separately. Schedule changes invalidate the affected registered comparison until explicitly reviewed.

Only a successful matching observed transaction establishes a completed acquisition. A missing transaction means the offer/acceptance outcome is unknown. Matching transactions do not prove that DHQ caused the action. No causal win claims are made. Manager-direction and acceptance text are labeled heuristics. Calculation explanations are cross-checked against the captured legal-lineup calculation; mismatches are counted. There is no general natural-language fact-checker, private offer-history feed, or automated verification of manager intent.

The current engine's acceptance heuristics have no precisely defined event horizon and are not calibrated probabilities. No generic confidence is converted to probability. The evaluator supports explicit event ID/horizon probability observations, Brier score, log loss and reliability bins, but no real qualifying probability forecast is currently supplied by these engines.

Outcome jobs retry with backoff and case-level lease fencing. They run every six hours after the registered week end and retain a 14-day correction window. A raw outcome change appends a new version and grade; unchanged retries reuse the existing evidence. Corrections after that window require an explicit operator requeue. Predictions and lineup snapshots never change. GitHub scheduling is best effort; missed pregame windows are exposed and never reconstructed afterward.

Uncertainty groups all decisions connected by any repeated player/week exposure, including across leagues. With fewer than eight distinct exposure groups, no interval is shown. Otherwise a deterministic cluster bootstrap provides a descriptive interval. Groups are conservative and may leave very few effective observations. Neither seven days nor a positive average automatically produces an improved verdict. Reports preserve exclusions, unmatched candidate cases, partial horizons and coverage gaps.

## Local verification

Verified on November 4, 2026:

| Check | Result |
| --- | --- |
| Focused advice capture, database, runtime and evaluation suite | 23 passed, 0 failed; includes Supabase default-role-grant regression |
| Existing value-history and value-monitor suite | 15 passed |
| Existing forecast ledger, archive and evaluation suites | 36 passed |
| Existing core suite | 97 passed |
| Existing redraft reliability suite | All 37 test files passed |
| Roster trade and roster lens UI checks | 20 trade checks and 53 UI checks passed; waiver checks passed |
| Production build | All six entry pages built; 167 JSX and 330 total modules compiled/minified |
| Built scorecard browser checks | Passed at 390px and 1365px: rendering, coverage, unknown acceptance, evidence export, read failures and no horizontal overflow |

Local verification used Node 25.8.1 and desktop Chromium. The scheduled workflow targets Node 22; its hosted environment, authenticated hosted capture, mobile Safari and physical devices have not been exercised. Local persistence tests use the actual Supabase client against a local PostgreSQL-compatible database with simulated provider responses. No hosted database or production credentials were used.

Run from the isolated app checkout with its sibling canonical shared checkout:

```sh
npm run sync:shared
npm run test:advice-scorecard
npm run test:value-monitor
npm run test:forecast-ledger
npm run test:redraft-reliability
npm run test:core
node scripts/build-deploy.cjs
node scripts/serve-static.cjs --port=3534
# In another terminal:
npm run test:advice-scorecard:browser
```

The focused suite exercises real calculation modules, the pinned Supabase client and a local PostgreSQL-compatible database, plus simulated provider responses. It checks persistence/readback, owner boundaries, immutable predictions, late/future/stale evidence, lineups and benched points, byes, drops, budgets, effective times, hold/simple comparisons, paired identity, missing versus zero outcomes, partial horizons, retries/corrections, failed coverage and unknown trade acceptance. These tests are evidence about implementation behavior only.

The authorized deployment dry run exposed Supabase's direct default grants to browser roles. The migration now explicitly revokes those grants on collector routines before granting service-only access. The regression reproduces those hosted defaults, and the Pages release workflow runs the full focused suite on Node 22 before publishing. The initial dry run rolled back; the unsafe grants were never applied persistently.

## Local source locations

The existing working copies and their uncommitted work were preserved. Implementation is isolated in two local branches:

- App: `work/warroom`, branch `codex/dhq-advice-scorecard-20261104`, based on sandbox commit `3c602325c13692656f817193844856873f11586a`.
- Canonical shared: `work/dhq-shared`, branch `codex/dhq-advice-shared-20261104`, based on the sandbox's existing shared pin `991718aef72bf14d18cead3e2adee1312055e304`.

Both directories are beneath `/Users/jacobc/Documents/Codex/2026-11-04/files-pasted-by-the-user-implement`. The delivery archive includes patches against those exact base commits, the migration, this guide, verification logs, and clearly labeled simulated screenshots. The release manifest identifies the final local commits. Neither branch has been pushed.

## Exact activation sequence — requires separate authorization

1. Review both local branches and the implementation diff. Publish the canonical shared commit first when authorized. The local app deployment workflows already pin canonical shared commit `71e9a09ef1c2404f0e5eff4f177bc6805c863b43`; publish that exact shared commit before the app is published. The source sync adds required modules; deploying against an older shared pin must fail instead of silently using an old engine.
2. Link the intended Supabase project using the existing administrator tooling. Preview pending migrations:

   ```sh
   supabase db push --linked --dry-run
   ```

   Proceed with `supabase db push --linked` **only if the preview contains the intended advice migration and no unauthorized migrations**. Otherwise apply `20261104000000_advice_scorecard.sql` through the established single-migration process and record its version. Do not replay old migrations or reset the database. Verify table RLS, immutable triggers and the owner/service RPC grants before enabling capture.
3. Deploy the app from its reviewed commit, with `content/advice-scorecard.json` still false and `ADVICE_SCORECARD_ENABLED` unset/false. Check that the scorecard renders and an authenticated owner can read an empty report. A deployed interface is a separate milestone from collection.
4. Configure the protected GitHub environment `advice-scorecard` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put the service key in browser configuration, local fixtures, a published JSON file or logs. Set repository variable `ADVICE_SHARED_REVISION` to the exact published 40-character shared commit. Use the app commit containing the matching pinned runtime.
5. Copy `scripts/advice/enrollment.seed.example.json` to an operator-controlled private working file. Set the authorized app owner, Sleeper league and roster, season/format, fantasy end week, cohort and tuning/validation cutoff. List **all** intended future waiver/trade cases before outcomes, with each capture time, verified decision deadline, assumed effective time and FAAB. Do not select cases by later results. The platform's waiver processing/trade review timing must be checked by the operator; the collector does not guess it.
6. Prepare the complete schedule, inspect the result and validate it (read-only; no enrollment):

   ```sh
   node scripts/advice/run.cjs prepare /private/path/advice-seed.json > /private/path/advice-enrollment.json
   node scripts/advice/run.cjs validate /private/path/advice-enrollment.json
   node scripts/advice/run.cjs fingerprint
   ```

   Preserve this configuration as the preregistration. Capture must precede the decision deadline; deadline and effective time must precede the first weekly freeze. The calendar covers every evaluated week and all 32 teams. Unsupported/missing schedules stop enrollment.
7. With protected server credentials in the collector's environment, enroll the validated configuration:

   ```sh
   node scripts/advice/run.cjs enroll /private/path/advice-enrollment.json
   ```

   This returns `runId` with `active:false`. After checking its owner, case list, calendar and fingerprint, activate only that run through the administrative SQL console:

   ```sql
   update public.advice_runs set active = true where id = 'THE_REVIEWED_RUN_UUID';
   ```

   Set `ADVICE_SCORECARD_ENABLED=true` only after the run and service permissions are verified. Dispatch the “DHQ advice scorecard” workflow once, then rely on its half-hour schedule. Empty output before the registered capture time is expected, not a successful capture.
8. Enable actual screen-history capture separately by changing `captureDisplayedAdvice` to true in `content/advice-scorecard.json` and publishing that reviewed configuration. This starts owner-bound observation capture on roster waiver/trade views. It does not enroll a monitor or turn those observations into prospective evidence.

## First real recommendation capture

At the first registered capture interval:

- Inspect the workflow result for the case ID, `kind: capture`, a server `receivedAt`, and `readbackVerified: true`.
- Independently read the owner-private scorecard and open “Registered advice and evidence.” Confirm the real roster/league, add/drop or trade (or explicit hold), required drops, assumed bid, current/candidate versions, input hashes and supporting calculations.
- Export the server evidence with `node scripts/advice/run.cjs report RUN_UUID > /private/path/first-advice-report.json` and check the original payload using `node scripts/evaluate-advice-scorecard.cjs /private/path/first-advice-report.json`.
- Verify `received_at` and `context.capturedAt` are before the registered deadline and first kickoff; source issues and legal-rule exclusions must be empty. Confirm the current, candidate and simple input IDs are identical. A candidate failure must remain visible.
- For a screen observation, view a roster lens, then refresh its scorecard and confirm a row in “Displayed advice history.” Retry after a simulated network failure; the original owner-bound observation and first receipt must survive. This is a separate milestone from a registered eligible case.

Read-only administrative proof:

```sql
select c.decision_id, c.status, a.received_at,
       a.payload->'context'->>'capturedAt' as captured_at,
       a.payload->'context'->>'deadline' as deadline,
       a.payload->'engineInputs' as paired_inputs,
       a.payload->'sourceIssues' as source_issues
from public.advice_cases c
left join public.advice_records a using (decision_id)
where c.run_id = 'THE_REVIEWED_RUN_UUID';
```

## First completed outcome evaluation

Wait for a **real completed horizon**, not an arbitrary collection duration. A next-week waiver result can mature first; four-week and season trade horizons remain partial until all required weeks have complete legal lineups and actual starter outcomes.

Check every weekly snapshot's original receipt before the earliest kickoff, confirmed player/game outcome status, captured scoring hash, and the absence of missing starter rows. The scorecard must show completed, eligible results with actual points versus both hold and simple, while other horizons stay partial. An observed trade is still conditional roster evidence, not proof of acceptance or additional wins.

```sql
select decision_id, week, received_at,
       payload->'grade'->>'eligible' as eligible,
       payload->'grade'->'horizons' as horizons,
       payload->'outcomeVersions' as outcome_versions
from public.advice_packets
where kind = 'grade'
  and decision_id = 'THE_REVIEWED_DECISION_ID'
order by id;
```

Re-run the collector on unchanged data: the grade/evidence row count should not increase. A genuine correction should append an outcome and grade revision while the original recommendation and lineup payloads remain byte-equivalent. Refresh/export the report and inspect both versions. A failed or missed checkpoint stays visible; it never becomes a zero score.

## Recovery and shutdown

Disable `ADVICE_SCORECARD_ENABLED` and set the affected run's `active=false` to stop work without deleting history. Retry a failed outcome job only after repairing its source/access issue, using the same pinned runtime. A service administrator can reset its `status='retry'`, `next_at=now()`, `attempts=0`, `lease_token=null`, and `lease_until=null` within a reviewed correction window. Never requeue a missed capture or lineup checkpoint after its deadline. Register a new future case instead. Model promotion is a separate reviewed code change.
