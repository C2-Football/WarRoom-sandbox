# Availability forecasts and versioned shadow ledger

Implemented September 6, 2026. **No displayed values or recommendations are changed.**

## What runs

- Successful live redraft/keeper ROS calculations record a baseline and availability challenger through a non-blocking side channel.
- League-intelligence load and weekly-data events also build a standalone production shadow for dynasty leagues. This does not populate/replace the redraft cache or change dynasty values.
- Dynasty/keeper captures preserve the current one-, two- and three-year age-based value scenarios, labeled uncalibrated. Their future market accuracy is not scored by the ROS evaluator.
- Historical/time-travel contexts, cross-league inputs, and Chopped/survival horizons are excluded. Captures use the existing engine's next-week-through-fantasy-season-end horizon; this does not fix or redefine the existing current-week convention.

## Availability contract

Healthy per-week production and future availability are separate fields. Byes are zero-probability playing weeks. Healthy players follow an explicitly uncalibrated status-quo assumption; no new injury hazard is inferred.

For IR, OUT, suspension, inactive status, unsigned players or missing team data, future availability is unresolved unless explicit evidence is supplied. Today's OUT status is not treated as proof the player misses every future week. No return date is invented.

Unresolved cases preserve a null central estimate and low/high **availability scenarios**, not confidence intervals. These bounds do not capture uncertainty in performance while active. A missing production baseline is null, not an assertion of zero value; known zero production remains distinguishable.

The evidence adapter accepts `availabilityEvidence[pid]` in the valuation context:

```json
{
  "season": 2026,
  "source": "identifier of the actual evidence source",
  "asOf": "2026-09-06T12:00:00Z",
  "probabilityByWeek": {"2": 0, "3": 0.5}
}
```

This illustrates the input contract, not a recommended injury probability. Evidence must name its source, match the forecast season, predate capture, and contain numeric probabilities between zero and one. Byes still override supplied participation. Unknown weeks stay unresolved. **No automated return-probability feed is connected yet.** Therefore many injured/unsigned players will have scenarios but no central challenger estimate. Healthy cases normally match the baseline unless specific evidence changes availability. This is instrumentation and a cautious first model, not a claim of improved predictive accuracy.

## Ledger guarantees

Storage: IndexedDB `dhq-forecast-ledger-v1`, object store `forecasts`, schema version 1. Append-only first write for a capture identity; no update/delete API is exposed by the module. Identity incorporates canonical input hash, selected runtime-function signature hash, and UTC capture day. Identical repeated captures do not overwrite the earlier record; changed inputs/versions create another record.

Each record includes:

- Actual capture time, season, decision week and forecast horizon.
- League identity, scoring and roster settings, and configuration hash.
- Explicit baseline/challenger model versions and a fingerprint of selected loaded runtime functions. This is **not a complete source-bundle hash**; bump model versions when changing helper behavior or model assumptions.
- Frozen current/prior stats, available season projection rows, observed recent weekly points, player status/team/bye/age, availability evidence and available market input per player.
- Baseline healthy production, ROS points/value, current dynasty value, challenger expected active weeks/points when resolved, unresolved weeks and scenario bounds.
- Current dynasty age scenarios and available age-curve/decay settings for later examination.
- Zero and missing-data players from the baseline universe, including non-rostered candidates where the existing engine prices them. The ledger does not manufacture missing players outside that universe.
- `dataObservedAt` separate from provider `sourceAsOf`. Existing provider timestamps are unavailable in this integration, so source timestamps are explicitly unverified rather than mislabeled fresh.

Inputs are copied before asynchronous hashing/storage, preventing league switches or mutable app state from altering the saved capture. Failures leave displayed calculations unchanged and are exposed through `App.ForecastLedger.status.error`; they are not reported as successful saves.

**Durability limits:** local to this browser profile/origin, best-effort while the app is open. Clearing site data removes unexported history. There is no automatic server mirror, cross-device sync, retention deletion, scheduled capture or automatic outcome ingestion in this first version. Production deployment has not been performed. Back up exports before clearing browser data. Storage/quota failures are reported but no old forecasts are silently evicted.

## Inspect and export

Developer API, after opening a live league:

```js
App.ForecastLedger.status
await App.ForecastLedger.read(S.currentLeagueId)
await App.ForecastLedger.exportLeague(S.currentLeagueId)
```

`exportLeague` returns JSON; it does not send league data to another service. The app currently has no end-user export button. Support/developer tooling can save that JSON for evaluation.

## Compare after outcomes exist

```sh
node scripts/evaluate-forecast-ledger.cjs ledger-export.json outcomes.json
```

Outcomes are an array of completed-week records with `leagueId`, numeric `season`/`week`, `configHash` matching the captured configuration, a source `asOf` timestamp later than capture, `complete: true`, and league-scored `points` keyed by player ID. The caller must certify a complete player-week dataset; incomplete rosters/matchups cannot be labeled complete.

The evaluator:

- Refuses incomplete, missing, mismatched-scoring or pre-capture outcomes.
- Treats a missing player as zero **only within a certified complete week**.
- Requires the whole captured ROS horizon to finish; no partial-horizon success claims.
- Reports paired-sample MAE and bias for baseline and challenger, plus coverage and individual rows including unresolved cases. Null forecasts are never silently zero-filled.
- Uses the earliest run per league/season/week/config/runtime fingerprint in an export, avoiding inflated counts from repeated app openings. Runs across checkpoints and seasons can still overlap; no statistical independence or significance is claimed.

Promotion remains manual. There is no mechanism that automatically switches displayed values to the challenger. Compare coverage and error by player type, not only the healthy paired subset. Test future revisions on chronologically untouched forecasts before changing the user-facing model.

## Verification

- `npm run test:forecast-ledger` — model assumptions, evidence cutoff, immutable capture, missing/zero coverage, context isolation, failure isolation, mature-outcome evaluation and unchanged public valuations.
- Existing redraft-value and football-audit integrity suites remain passing.
- Real browser IndexedDB probe confirmed save → reload → recover and duplicate suppression. Its one synthetic record was deleted afterward; no user forecast records were removed.
- The live league preview remained at league sync during testing, so no live-roster capture is claimed. The production integration is covered with isolated engine fixtures; check `status.lastCapture` after the league finishes hydrating.

### Server archive groundwork (staged, not deployed)

`20260906000000_forecast_archive.sql` adds a private archive with server-derived account identity and receipt timestamps. Direct table access is denied; narrowly scoped RPCs allow append-only writes and paginated owner-only reads. Duplicate IDs with identical content return the original receipt; different content is rejected. A server receipt proves when bytes arrived, not that the forecast or its inputs are valid.

`App.ForecastArchive.save(record)` explicitly archives one record and returns its receipt. `App.ForecastArchive.read(leagueId)` recovers all pages as `{record, receipt}` entries. Neither operation changes valuations or rewrites local records. Network/schema/authentication errors reject visibly to the caller; the original local record remains available for retry. Account switching during a paginated read aborts recovery.

No automatic upload is enabled: existing local records are browser-scoped, not owner-scoped, and must not silently be assigned to whichever account next signs in. There is no archive UI yet. The migration must be applied and tested against both account and legacy-session identities before enabling production use. Local tests cover the transport and SQL contract, not live database permissions/concurrency.

Server receipt time is kept separate from client capture time. No source timestamps, completed-week certification, injury probabilities, or accuracy improvements are invented by this archive.

### Evaluation integrity and registration cutoff checks

The offline evaluation command now verifies the captured input/configuration/runtime fingerprints and capture identity before scoring. It rejects malformed or duplicate player rows, reports rejected records, and suppresses repeated captures. Fingerprints detect inconsistent edits; they are not signatures and cannot authenticate an export whose author recalculated its hashes. Some envelope metadata, including the full client capture timestamp, was not covered by the v1 input fingerprint. Do not describe v1 exports as tamper-proof.

The shared evaluator also requires outcome league identity, even if two leagues have identical scoring. An array or string cannot stand in for a complete player-points map. Missing weeks, duplicate outcomes, invalid point values, and future outcome timestamps still fail closed.

The existing two-file command remains explicitly `exploratory`. To additionally check receipt timing:

```sh
node scripts/evaluate-forecast-ledger.cjs ledger-export.json outcomes.json registration.json
```

The third file has this shape (all dates below are synthetic examples, not NFL schedule facts):

```json
{
  "receipts": [{"id": "the captured forecast ID", "receivedAt": "2026-09-07T00:00:00Z"}],
  "cutoffs": [{
    "season": 2026,
    "week": 2,
    "firstKickoffAt": "2026-09-13T00:00:00Z",
    "completeSchedule": true,
    "source": "identifier of an independently checked complete schedule"
  }]
}
```

Use original receipts retrieved from the account-private archive and a complete schedule's earliest kickoff for the forecast's first predicted week, not a selected player's later kickoff. Receipt time must be on/after client capture, strictly before that kickoff, and not in the future relative to evaluation. Missing, ambiguous, or invalid receipts/cutoffs are rejected. Among comparable runs, earliest server receipt wins, independently of accuracy; later runs remain listed as superseded. No automatic model promotion is performed.

The output is labeled `receipt_cutoff_checked`, **not verified prospective validation**. `externalEvidenceAuthenticated: false` remains explicit: this local command cannot prove that a receipt came from the server, that a cutoff is the true earliest kickoff, or that outcomes are a complete authoritative feed. Operators must establish those facts outside the command. This is a timing/integrity gate ready for integration, not the completed automated evidence pipeline.

Verification: 11 additional executable evaluation checks cover real capture fingerprint compatibility, altered exports, repeated runs, late and boundary uploads, invalid evidence, cross-league results, malformed outcomes, and selection independent of realized accuracy. Forecast and archive checks remain part of the same test command.

Next infrastructure work: deploy and exercise the archive permissions, bind new local captures to their account before automatic retries, preserve timestamps from the actual input fetch/cache layer, and connect certified completed-week outcome and schedule ingestion to the registration gate. A maintained availability-evidence feed is also still needed. These are required before describing this as a continuously running, cross-device validation system.
