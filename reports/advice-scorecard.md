# DHQ Advice Scorecard — internal backend evaluation

The scorecard is an internal backend system, not a feature in the app. The product panel, browser collector, activation JSON and CSS are removed. No scorecard UI, browser polling or displayed-advice collection remains. Canonical evaluation code is synchronized into ignored `server/generated/`, outside the public app bundle. Release checks reject retired advice assets or hooks in the source, compiled frontend or actual Pages artifact.

The collector runs the actual canonical waiver/trade, valuation and projection engines on the server. Only that caller supplies an optional input-inspection callback to preserve the calculations used. It records current/candidate/hold/simple results from one frozen context before the deadline. These are internal engine evaluations; they do not claim a user saw or followed the advice. The existing app recommendations and weights are unchanged.

The original migration `20261104000000_advice_scorecard.sql` preserves immutable records, server receipts, append-only revisions, leased jobs and readback verification. Follow-up migration `20261105000000_advice_backend_only.sql` revokes anonymous/authenticated access to the retired observation and report RPCs. Direct table reads and collector operations require service credentials. Historical data and tables are preserved. Value-history and player forecasts remain separate.

Collection stays disabled until authorized leagues and future cases are enrolled. No real advice capture, completed real outcome grade or improvement in advice quality is claimed.

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


## Evidence boundaries

Only registered server cases with pre-deadline receipts and timely pre-kickoff snapshots qualify for prospective grades. Failed captures, holds, missing candidates and exclusions remain in coverage. Past forecasts or browser observations are not reconstructed into recommendations.

Capture supports Sleeper redraft/dynasty. Unsupported formats/providers and unavailable scoring or schedule evidence fail explicitly. The existing Sleeper raw-stat/projection feeds and ESPN schedule/status are used. A completed game needs an explicit participation/stat row; absent player rows stay missing. Retrieval times and available provider headers are retained without inventing publication times. Schedule changes invalidate affected registered comparisons.

Unsent offers and absent matching transactions have unknown acceptance. Conditional benefit is distinct from observed acquisitions and causal wins. Manager intent and acceptance text remain unverified heuristics. Generic confidence is not a probability. Probability scoring requires a precise event and horizon.

Outcome jobs retry every six hours through a 14-day correction window; later corrections require reviewed requeueing. Changed stats append revised grades while predictions and lineup snapshots remain unchanged. Missed pregame checkpoints are not reconstructed. Uncertainty clusters repeated player/week exposures across leagues; fewer than eight groups yields no interval. Tuning and later validation cases stay separate. No collection duration automatically proves improvement or promotes an engine.

## Private reporting

With protected server credentials, use the administrative CLI:

```sh
node scripts/advice/run.cjs report RUN_UUID > /private/path/advice-report.json
node scripts/evaluate-advice-scorecard.cjs /private/path/advice-report.json > /private/path/advice-evaluation.json
```

Reports include immutable evidence and receipts, coverage/failures/exclusions, completed versus partial horizons, starter-point deltas versus hold/simple, helped/tied/hurt rates, costly drops, FAAB, paired engine performance, distinct exposures, uncertainty and transaction observations. Offline exports check content integrity but do not independently authenticate database receipts. There is no product dashboard or browser-accessible reporting API.

## Verification

```sh
npm run sync:shared
npm run test:advice-scorecard
npm run test:roster-lenses
node scripts/build-deploy.cjs
node tests/advice-backend-only.cjs --artifact=dist-deploy
```

The Pages workflow also runs `node tests/advice-backend-only.cjs --artifact=pages-artifact`. Focused tests use real calculation modules, the pinned Supabase client and a local PostgreSQL-compatible database with simulated provider inputs. They verify persistence/readback, immutable/versioned evidence, Supabase default grants, service-only access, legal lineups, bench points, byes/drops/FAAB, acquisition times, late/future/stale evidence, paired identity, missing versus zero outcomes, partial horizons, retries/corrections, failed coverage and unknown acceptance. Passing tests do not establish improved football advice.

## Deploy and activate

The app and canonical source remain isolated in `work/warroom` and `work/dhq-shared` beneath `/Users/jacobc/Documents/Codex/2026-11-04/files-pasted-by-the-user-implement`. Existing unrelated work is preserved.

1. Publish canonical shared revision `10a21ff6cf525df3bab7285fd25d0e300b91087e` and the app commit pinning it. The Pages release removes the previous app-facing feature. Internal code remains outside the published artifact.
2. Apply only the two advice migrations, in order, if absent from the migration ledger. Use a transaction preview and the established single-migration process. Do not replay unrelated migrations or reset the database. Verify exact source, all six RLS tables, five immutable triggers and denied browser access to capture/report/collector routines.
3. Keep `ADVICE_SCORECARD_ENABLED` unset/false. Deployment does not enroll leagues or turn collection on. The old `captureDisplayedAdvice` option no longer exists.
4. For separately authorized collection, configure protected GitHub environment `advice-scorecard` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Set repository variable `ADVICE_SHARED_REVISION` to the exact reviewed shared commit. Never publish or log service credentials.
5. Copy `scripts/advice/enrollment.seed.example.json` to a private operator file. Set authorized owner/league/roster, season/format, season-end week, tuning/validation boundaries, and all intended future cases. Verify decision deadlines and assumed effective times; do not choose cases after seeing outcomes.
6. Prepare, inspect and validate the preregistration:

   ```sh
   node scripts/advice/run.cjs prepare /private/path/advice-seed.json > /private/path/advice-enrollment.json
   node scripts/advice/run.cjs validate /private/path/advice-enrollment.json
   node scripts/advice/run.cjs fingerprint
   ```

   Capture must precede the deadline; deadline and effective time must precede the first weekly freeze. The calendar covers every evaluated week and all 32 teams. New runtime versions require new preregistered runs.
7. Enroll using server credentials with `node scripts/advice/run.cjs enroll /private/path/advice-enrollment.json`. The new run is inactive. After reviewing its owner, case list, calendar and fingerprint, activate only that run using `update public.advice_runs set active=true where id='REVIEWED_RUN_UUID';`, then set `ADVICE_SCORECARD_ENABLED=true` and dispatch the workflow. The half-hour schedule is best effort. Empty results before capture time are not a successful capture.

## Verify the first real capture and completed grade

Require a collector result with the decision ID, `kind: capture`, server `receivedAt`, and `readbackVerified: true`. Independently export the report. Confirm real roster/league, move or explicit hold, required drops, bid, supporting calculations, versions and identical frozen input IDs. Capture/receipt must precede the deadline and evaluated kickoffs. Missing candidates and failures must stay visible. This verifies an internal engine record, not delivery to a user.

```sql
select c.decision_id,c.status,a.received_at,
 a.payload->'context'->>'capturedAt' as captured_at,
 a.payload->'context'->>'deadline' as deadline,
 a.payload->'engineInputs' as paired_inputs,
 a.payload->'sourceIssues' as source_issues
from public.advice_cases c left join public.advice_records a using(decision_id)
where c.run_id='REVIEWED_RUN_UUID';
```

Wait for a real completed horizon. Require timely original weekly snapshots, captured scoring, final games and complete actual starter rows. A next-week waiver grade can mature before four-week/season grades; partial horizons stay separate. Verify deltas against both hold and simple, with costs and feasibility separate.

```sql
select decision_id,week,received_at,
 payload->'grade'->>'eligible' as eligible,
 payload->'grade'->'horizons' as horizons,
 payload->'outcomeVersions' as outcome_versions
from public.advice_packets where kind='grade' and decision_id='REVIEWED_DECISION_ID'
order by id;
```

Unchanged retries must not add duplicate evidence or grades. Corrections append versions while original recommendation and lineup bytes remain unchanged. No real capture or completed grade is claimed until verified.

## Recovery

Disable `ADVICE_SCORECARD_ENABLED` and set affected runs inactive to stop collection without deleting history. Repair source/access failures before requeuing outcome jobs within a reviewed correction window. Never reconstruct missed capture/lineup checkpoints after their deadline; preregister new future cases. Model promotion remains a separate manual decision.
