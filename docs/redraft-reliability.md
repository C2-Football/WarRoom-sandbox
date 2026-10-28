# Redraft recommendation reliability — local implementation

This pass preserves the existing app layout and uses its current forecast,
roster-lens, trade-season and shared-engine paths. It adds stricter evidence gates,
correct scoring, scoped refresh behavior and explanations at the decision point.
No league transactions, pushes, merges or deployments were performed.

## Checkouts and scope

- App: `C2-Football/WarRoom-sandbox`, isolated branch
  `fix/redraft-reliability-20261027`, based on verified current remote
  `7182aa9a469d60a1c6e2c9d711a229c6f028e73b`.
- Shared: `C2-Football/dhq-shared`, matching isolated branch, based on verified
  `74d6369224db5b814a9f3fdeff8fb7d60735aa81`.
- Shared release candidate: `877d59df32de7bf49ee3d944b8c09e5472feebd7`.
- Both original dirty working copies remain untouched. These are sibling worktrees
  under `/Users/jacobc/Projects/work/redraft-reliability/`.

## Behavior and regression evidence

| Defect | Implemented behavior | Regression |
| --- | --- | --- |
| QB completions/first downs omitted; ordinary D/ST sacks/interceptions omitted | Canonical configured-rule scorer, used by actual WeeklyProj → StartSit path | QB 18 → 38; D/ST 0 → 6 |
| TE premium/aliases/zero settings could diverge | Position passed into one scorer; alias precedence, yard thresholds, kicking buckets and explicit zero tested; unsupported nonzero rules pause forecasts | TE 19; IDP aliases counted once; configured zero remains zero |
| Missing redraft values inherited 8,000 dynasty prices | Seasonal-format gate remains active before loading, after failure, on league change and after season end; unavailable prices stay null | Production Trade Center wrapper and actual PlayerValue tested |
| Injured players implicitly healthy forever or out forever | Healthy production and availability separate; no invented return date; unresolved future weeks have no central forecast | IR values unknown; conditional healthy scenario retained; trade injury forecast withheld |
| Wrong drop on tied season gains | Full legal add/drop matching, weekly delta tie-break, then lower immediate drop production | Healthy 10-point starter retained over 2-point bench in IR scenario |
| Partial ownership / disabled acquisitions / exhausted FAAB | Shared preflight reused by boards and Home lenses; full roster count, ownership, capacity, protected players, scoring and rules checked | Partial roster, owned player, disabled adds and $0 remaining block recommendations |
| FLEX/superflex demand omitted | Slot-derived demand included in positional need | FLEX/SF regression |
| Permanent caches / failed empty maps / late response overwrites | TTLs, request deduplication, retryable failures, generation/scope guards and full dependency invalidation | Actual weekly fetcher, shared season fetcher and core player-refresh functions tested |
| High package price hid roster harm | Finder requires positive legal-lineup benefit and ranks by that delta; price, other roster and negotiation remain separate | High-value harmful trade has negative delta; capacity requires explicit legal drops |
| Unsupported acceptance/bid probabilities | Negotiation shown as an explained uncalibrated /100 comparison; no FAAB winning probabilities or uncontested claims | No-history bid is null; five completed same-position observations support descriptive history |
| One-QB calibration in two-QB leagues; wrong week boundaries | Dedicated QB count included; actual NFL week precedes display week; championship and completed-game boundaries modeled | Two-QB request, upcoming current week, championship, completed game and season end tests |

The 19 focused regressions all fail against archived audited app/shared sources
and all pass on this implementation. They execute production functions with
controlled fixtures. Test scaffolding does not replace the production scorer.
Some original failures are absence of the new required safeguards/APIs; the
38-point/6-point assertions directly reproduce the numerical scoring failures.

## Verification performed

- `npm run test:redraft-reliability`: **37/37 affected test files pass**, including
  redraft, waiver, trade, Alex context, forecast ledger/evaluation, roster lenses,
  market widgets, hydration, draft callers and mobile render contracts.
- `node tests/run.js`: **97/97 core tests pass**.
- Shared repository: seven production scoring/forecast tests pass; existing elite
  player equivalence and all nine provenance tests pass.
- Production build: **six entrypoints**, **167 JSX scripts / 320 minified modules**.
- `npm run test:redraft-reliability:build`: exact shared/source twin hashes match;
  executed minified WeeklyProj and StartSit with the canonical packaged scorer,
  reproducing QB 38, D/ST 6 and TE 19. No browser Babel in built entrypoints.
- `npm run test:redraft-reliability:browser`: real local built app with controlled
  provider fixtures. Phone Waivers offers measured upgrades with complete inputs,
  blocks partial rosters/disabled adds/exhausted FAAB, and Trade Finder completes
  with an honest hold outcome. The populated Builder shows the required-drop
  capacity blocker. Trade views checked at 390 and 1365 pixels.
  Backend requests are disabled and external mutations are intercepted.
- Changed runtime files: ESLint **zero errors** (19 unused-variable warnings).
  `git diff --check` passes.

Evidence is in `output/reliability/`: test-file logs and result JSON;
`browser/` contains screenshot/text evidence. Screenshots were visually inspected.
This is local synthetic calculation and browser evidence, not hosted delivery,
physical-device, live AI, real-league transaction or predictive-accuracy proof.
The entire unrelated application test matrix was not run.

## Freshness and recovery policy

| Dependency | Window / recovery |
| --- | --- |
| Player directory and current-season raw stats/projections | 15-minute memory/disk TTL; concurrent calls deduplicate; failures retry |
| Historical season raw data | 30 days; existing completed-season policy retained |
| Weekly projection snapshots | 15-minute success TTL, 30-second failed-fetch backoff; manual force/invalidation bypasses the wait |
| Seasonal calculated values | 15 minutes, plus immediate league/configuration/season/week/horizon/input invalidation |
| FantasyCalc seasonal market input | 1 hour, 30-second retry backoff; keyed by league, scoring, season and roster configuration |
| NFL score/context | 1 minute, retryable failures; invalidation and league guards prevent late publication |
| Strength of schedule | 1 hour, refresh invalidates memory and session state |
| Trade scenario preparation | Re-evaluated on changed inputs and a five-minute calculation refresh; underlying input timestamps retained |

Full Refresh Data invalidates players, raw season data, weekly projections,
seasonal values, FantasyCalc, NFL context and SOS. Hydration also rejects late
responses after a league switch. `fetchedAt`, provider `asOf`, and `calculatedAt`
remain separate. APIs without a trustworthy provider timestamp report it unknown;
recalculating an older input is not a new fetch. The forecast ledger records these
provenance fields without rewriting earlier entries.

## Model limits and deliberate hold outcomes

- Healthy production remains a model using provider projections or current/prior
  production fallback, plus existing matchup assumptions. It is not calibrated
  predictive accuracy. Uncertain injury participation is not assigned a made-up
  probability. Explicit sourced availability evidence is required for central
  injury estimates.
- Season waiver benefit is a fixed-roster estimate. Trade benefit optimizes legal
  lineups week by week; current-week, remaining regular-season and playoff effects
  stay distinct. No free-agent replacement or future injury is invented.
- Known started/completed games do not generate a new full-week waiver gain.
  Partial-week changes require verified locks; otherwise the weekly move pauses.
  Unknown platform claim/drop locks remain an explicit condition, not a guarantee.
- Trade timing defaults to the next full week unless upcoming games and zero review
  delay are verified. Championship end uses explicit configuration where available;
  otherwise one-week playoff rounds or a Week 17 fallback are labeled assumptions.
  Unusual multi-week playoff/review formats need explicit cutoff/timing evidence.
- The Finder searches candidate packages; it is not an exhaustive optimizer.
  Over-capacity packages are withheld instead of assuming a free replacement/drop.
  The season analyzer supports explicit protected/required drops for both teams.
- Market values are comparative prices, not roster benefit. Negotiation scores are
  hand-set comparisons. Completed bid ranges describe history, not the probability
  of acquiring this particular player. A hold is a valid answer.
- The existing append-only forecast ledger and evaluation coverage rules remain.
  Prospective validation still requires freezing forecasts before games, waiting
  for verified outcomes, measuring error/coverage by format and horizon, evaluating
  availability assumptions, and comparing recommendation outcomes against a stated
  baseline. Acceptance and bid outcomes need a separate prospective calibration
  dataset before any probability claims can return.

## Coordinated release — prepared, not executed

Shared changes are canonical in `dhq-shared`, including the forecast/context twins.
The app sync process copies those modules and verifies `player-value.js` byte
identity. App-only eligibility, roster decision, hydration, widget and explanation
changes remain in WarRoom-sandbox.

The active `.github/workflows/deploy.yml` still pins the accessible audited shared
revision. **Do not deploy this app candidate alone:** its new twin check requires
the coordinated shared release. The unapplied
[`redraft-reliability-pin.patch`](redraft-reliability-pin.patch) contains the exact
local shared SHA above plus CI regression/artifact checks; `git apply --check`
passes. It is documentation for the authorized release handoff, not an active pin.

After explicit release authorization:

1. Review and publish the shared candidate. Verify that the deploy account can
   fetch the exact final commit. If review/squash changes its SHA, regenerate the
   pending patch with the real published SHA; do not invent or guess a revision.
2. Apply the pending app pin patch only after that verification. Commit the pin
   together with these app changes. Do not widen repository visibility.
3. Set `SHARED_SOURCE` to that verified checkout, run `npm run sync:shared`, then
   the focused suites, core tests and production build. Run
   `npm run test:redraft-reliability:build` against the same checkout.
4. Review the app changes and publish/deploy only when authorized. Verify deployed
   source revisions and served asset bytes independently; a push/build alone is
   not release proof. Other shared consumers need their own compatibility checks.

For a local browser rerun, build the preview, run
`node scripts/serve-static.cjs --port=3517`, then
`npm run test:redraft-reliability:browser`. No live provider writes are needed.
