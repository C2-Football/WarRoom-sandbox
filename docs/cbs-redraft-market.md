# CBS redraft market integration

This adds CBS to **trade price**, not fantasy-point projections, roster-benefit estimates, or acceptance probabilities. The current code applies the combined market adapter only to the `redraft` skin. Dynasty, keeper, Chopped, and other formats retain their existing pricing behavior.

## Activation status and source access

**CBS automation is not live. No CBS snapshot has been activated or published by this integration. The daily CBS job remains disabled; no CBS permission agreement or activation variables are configured. App deployment is separate from data-source activation.**

A public CBS article and its fantasy sitemap were accessible in a local read on 2026-10-27. The article's QB / RB / WR / TE tables matched the parser (142 rows). That is an access/structure check, not an authorized production feed or a successful scheduled import. CBS's [Terms of Use, section 10](https://www.viacomcbs.legal/us/en/cbsi/terms-of-use) prohibit unauthorized automated data collection. No permission agreement is present in this repository. The automated importer therefore stops **before network access** unless `CBS_PERMISSION_REFERENCE` identifies an actual permission/source agreement. Do not use that setting merely to bypass the restriction.

The explicit local blocked-path run returned: `CBS automatic retrieval blocked: permission or an authorized source agreement is required under CBS Terms of Use section 10. Manual import remains available.` Its health record is under ignored `output/reliability/cbs-access-check/status.json`.

No alternate host, proxy, search snippet, login bypass, or changed user agent is used to get around a denied source. If CBS provides a licensed feed instead, adapt discovery/transport to that agreement while retaining the validator, mapping, snapshots and market adapter below.

## Snapshots, validation and discovery

Canonical contract and pricing code: `dhq-shared/redraft-market.js`, synchronized to `js/shared/redraft-market.js`. App transport/parser: `scripts/cbs/importer.cjs`; CLI: `scripts/update-cbs-market.cjs`.

An authorized automated run reads CBS's current fantasy sitemap and football landing page, follows discovered canonical CBS football article links/titles, and also rechecks the active article for corrections after sitemap rollover. It does **not** construct weekly article URLs. More than 30 candidates, failed retrieval of a candidate, unknown table structure, or ambiguous discovery chronology stops activation. Season and week come from article headline/publication metadata, checked against Sleeper's actual `state.week` and `state.season` (not `display_week`). Current-season applicable candidates are ordered by chart week, then provider update/publication time. Offseason runs record an idle status.

Each immutable snapshot includes:

- Schema/parser version, SHA-256 content hash, SHA-256 complete snapshot ID, mapping hash.
- CBS URL/attribution, season/week, provider publication/update times or explicit nulls.
- Fetch/import time and first import time for that chart week, kept distinct from provider timestamps and browser check time.
- Original numeric CBS values, exact published column names, explicit null for `--`/empty cells, player position and source team.
- Stable Sleeper player ID or null, mapped/unmapped/ambiguous status, mapping method, unresolved candidates, and team mismatch flag.

`contentHash` hashes the normalized source chart including provider metadata and original values, excluding unrelated article HTML/ads. `id` hashes the complete snapshot payload (including mapping and provenance). Re-fetching the same chart/mapping does not create a revision or reset the original import time. Undated same-week corrections preserve the original first-import age.

Activation requires the exact recognized table contract; finite numeric values from 0 through 200; no duplicate source identity or stable ID; minimum coverage of 12 QB, 25 RB, 30 WR and 10 TE; at least 90% unambiguously mapped players; valid dates and season/week. Name mapping normalizes punctuation, accents and suffixes, uses position, maintained aliases, and supporting team evidence. A unique full name survives a team change with a disclosure. Initial-only matches require matching team evidence. Ambiguity never creates a player price. Maintain reviewed `normalized name|POSITION` → stable-ID overrides in `content/markets/cbs/aliases.json` (initially empty).

Older seasons/weeks, earlier same-week revisions, and ambiguous same-week alternate URLs cannot replace the active version. A row-count loss over 25%, or more than 30% of comparable values jumping by over both 50% and five points, is quarantined. Review the full candidate/diff before a CLI override using its **exact content hash**; the approval and warnings become part of the signed-by-hash snapshot record. This is a change-review guard, not a cryptographic publisher signature.

The immutable archive is written first, then `current.json` is replaced with one atomic rename. The published data branch updates as one Git commit/ref change. A browser verifies the complete snapshot hash before one immutable in-memory swap. A trade uses one board version; changed market identity invalidates prices, Finder caches/pools, and outstanding Alex reads. Forecast ledger records append source versions and original prices without rewriting prior evidence or altering forecast points.

## Market adapter and format support

Starting weights are **provisional engineering choices**, not empirically optimized:

| Input | Maximum share |
| --- | ---: |
| DHQ league-scored seasonal baseline | At least 75% |
| CBS | 15% |
| FantasyCalc redraft | 10% |
| Combined market budget | 25% |

Configuration lives in `content/markets/cbs/config.json`. Requested nonnegative source weights are scaled down together if they exceed the budget, which is hard-capped at 25%. Missing/unlisted/stale/unsupported source weight stays with the engine; it is not silently reallocated to the other source. A missing seasonal value stays unknown; a genuine seasonal zero stays zero even if a market source prices that player.

For unblended seasonal values `E`, let `H=max(E)`. For each source, normalize a player's original source value to `sourceValue / sourceMaximum * H`. CBS's maximum is over the selected published columns, including unmapped rows, so an unresolved top player does not inflate everyone else. Blend once:

`combined = E × (1 − availableCBSWeight − availableFCWeight) + normalizedCBS × CBSWeight + normalizedFC × FCWeight`

The existing final board display scale maps the highest combined value to 9,500. The UI explains the normalized contribution in that same final display scale. Raw CBS points are never averaged directly with DHQ's thousands-scale numbers. Package totals, value grades, generation price filters and comparative negotiation calculations consume the resulting DHQ values. Legal lineup/season gains remain separately computed and continue to gate/rank actionable redraft recommendations. A favorable market price cannot override negative roster benefit.

Compatible receiving columns: `non`, `0.5`, `PPR` for exact 0/.5/1 reception scoring. One dedicated QB selects `1QB-4` or `1QB-6` from passing-TD scoring. Two dedicated QBs select `2QB`; superflex uses that column explicitly as an approximation. CBS provides no separate 2QB passing-TD variants, and no league-size calibration; those limitations are disclosed. More exotic QB counts, nonstandard offensive scoring, first-down/completion scoring and positional premiums exclude CBS instead of manufacturing an adjustment. Standard defensive scoring does not create CBS D/ST/IDP prices; those players remain unlisted.

## Freshness, failures and manual use

A current-week snapshot is labeled current-week. The previous week's chart may contribute during a delayed release, with an explicit previous-week label. CBS stops contributing when the chart is more than **one NFL week behind** or older than **ten days since publication** (first import when publication is unknown). Re-fetching or recalculating cannot freshen that age. Wrong-season/future snapshots are excluded.

The browser checks the imported dataset every 15 minutes while a redraft surface is open, deduplicates concurrent requests, retries a failure after 30 seconds, and rejects late results after full refresh/season change. A failed fetch/parser retains the last valid snapshot and its real age; source expiration still applies. Full Refresh Data clears recommendation/market dependency caches and forces a new check. Snapshot persistence is best effort in localStorage, not a requirement for correctness.

The Trade Finder and Builder have a compact CBS disclosure with chart week, source link, source dates, age, version, selected columns, source contribution, original player/package prices, separate roster impact, discrepancies, and fallback status. **Refresh imported CBS chart** reloads the published snapshot; it does not pretend to trigger a server scrape. The Actions **Run workflow** option or CLI below performs a source refresh once access is authorized.

Manual browser import accepts a chart JSON or a snapshot's `chart` object. IDs are always remapped against the current player catalog; the same schema/mapping/chronology/change checks apply. It affects **this browser only** and is labeled accordingly. It does not publish anything. An invalid import retains the prior chart. If an authorized global snapshot is newer, subsequent refresh can supersede the local one.

Operator CLI, using lawfully supplied HTML or JSON:

```sh
node scripts/update-cbs-market.cjs --import /path/chart.html --url https://www.cbssports.com/fantasy/football/news/THE-ACTUAL-ARTICLE/ --out /path/dataset
# JSON uses the same sourceUrl/season/week/dates/columns/rows contract:
node scripts/update-cbs-market.cjs --import /path/chart.json --out /path/dataset
# Optional deterministic/offline inputs:
node scripts/update-cbs-market.cjs --import /path/chart.json --state /path/nfl-state.json --players /path/sleeper-players.json --out /path/dataset
# Only after inspecting an anomalous candidate:
node scripts/update-cbs-market.cjs --import /path/chart.json --approve-change EXACT-CONTENT-HASH --out /path/dataset
```

JSON structure: `{sourceUrl, attribution, season, week, publishedAt:null|ISO, updatedAt:null|ISO, columns:{QB:["1QB-4","1QB-6","2QB"],RB:["non","0.5","PPR"],WR:["non","0.5","PPR"],TE:["non","0.5","PPR"]}, rows:[{name,position,team,values:{...exact position columns with numeric or null values}}]}`. A full chart meeting coverage is required, not a small arbitrary list.

## Scheduler and coordinated release

`.github/workflows/cbs-market.yml` configures a daily 14:23 UTC check plus manual dispatch. It uses Node 22, needs no browser, and publishes only dataset files to `cbs-market-data`. It does not deploy/merge application code or perform league transactions. GitHub cron runs from the default branch, may be delayed, and is not an exact-time guarantee. Errors preserve `current.json`, publish a distinct failed health check, and fail the workflow for operational visibility.

Before activation:

1. Obtain CBS permission/an authorized source agreement; adapt transport if the approved source differs.
2. Publish canonical shared commit `a3b99522da9a6086385c26841e6c6dfecdeb1cb5` on `feature/cbs-redraft-market-20261027`, verify the actual commit is remotely accessible, then apply `docs/cbs-market-shared-pin.patch`. The shared branch has been published, and its raw source bytes verified publicly against the local canonical files. This patch is now **applied** to the app workflow; retain it as a release record, not a patch to apply again. Do not deploy using an unpublished local SHA. If the shared commit changes during review/merge, regenerate the patch with the real published SHA.
3. Sync canonical code, run the tests/builds below, then release the app/workflow only with separate authorization. The deployment pin now targets the verified published CBS/reliability shared commit above.
4. On the intended repository, enable Actions with data-branch write permission, set `CBS_PERMISSION_REFERENCE` to the real non-sensitive agreement reference (never an access token), and `CBS_UPDATES_ENABLED=true`. Ensure the data branch can publish. The checked-in reader URL targets **WarRoom-sandbox**. A production release must explicitly configure its own approved dataset URL/CORS/access; do not silently share a sandbox feed.
5. Manually run the job, inspect validation/health and exact raw snapshot bytes from an unauthenticated browser, then verify the next scheduled run. Only after this may automatic updates be described as live. A private/inaccessible raw GitHub branch needs an authorized public static/object-store endpoint; do not expose tokens in the browser or change repository visibility.

Release preparation: the shared feature branch was published and verified, and the app dependency pin updated for the requested WarRoom-sandbox deployment. CBS automation activation steps remain outstanding; no retrieval permission, scheduler activation variable, or data branch was configured.

## Verification and proof limits

- `npm run test:cbs-market`: 22 passing regression cases covering discovery, structure changes, coverage, mapping collisions/team changes, null vs zero, formats, new weeks/corrections, delayed publication, old season, chronology rollback, anomalous changes/explicit review, failed fetch, permission blocker, atomic retention, autonomous CLI, normalized budget, actual production PlayerValue/Trade Finder package calculations, reader integrity/cache invalidation, and source age.
- `npm run test:redraft-reliability`: 37/37 affected test files pass; existing affected redraft/waiver/trade/AI-context/forecast/roster/hydration suites. The append-only forecast-ledger regression includes a CBS revision with unchanged forecast points.
- `node tests/run.js`: 97/97 core tests pass. Shared `redraft-market`/`redraft-scoring`: 10/10 pass; elite equivalence and provenance suites also pass.
- `node scripts/build-deploy.cjs`, `npm run test:redraft-reliability:build`, `npm run test:cbs-market:build`: all six production entrypoints, canonical shared byte identity, actual minified scoring and market pricing paths.
- `npm run build:preview`, local static server on port 3517, `npm run test:cbs-market:browser`: fixture-only real-browser phone/desktop flow; manual import changes actual displayed package price, invalid/older import and failed refresh retain evidence; source label/date and zero page-error checks. The representative player moves from DHQ 4,878 to 5,705 while season points remain 238. Artifacts are under ignored `output/playwright/cbs/`.

These establish deterministic behavior, not predictive accuracy, live CBS permission/retrieval, hosted automation, or real-league outcomes. Starting weights, the ten-day/one-week staleness cutoff, normalization and format approximations need prospective evaluation. Preserve the existing forecast ledger and collect future roster outcomes against baseline models; assess market-price agreement separately from fantasy-point accuracy. Neither CBS values nor negotiation scores are calibrated acceptance probabilities.
