# DHQ football-logic audit

Date: September 6, 2026. Checkout at start: `15a6a0a`.

## Executive conclusion

DHQ has useful production signal, but its forward-looking numbers have not earned the status of calibrated forecasts. This audit found measurable weaknesses in the redraft historical-production fallback and a material evidence gap for full dynasty valuation. No production scoring was changed.

This is a **retrospective component replay**, not a replay of historical published DHQ scores and not proof of out-of-sample predictive accuracy. Current rules may already reflect knowledge of these historical seasons. No coefficients were fitted during the audit; exploratory ablations are hypotheses for a later untouched evaluation, not validated replacements.

## Coverage and exclusions

| Question | What was measured | Status |
| --- | --- | --- |
| Can the redraft history fallback predict remaining production? | Actual `computePrices` → `buildBaseline` → `projectPlayerWeek` → `scoreProjection`, without provider or market inputs | Measured |
| Does the recent-form adjustment improve that fallback? | Same engine/inputs with only the recent-form hook disabled inside an isolated audit process | Measured diagnostic |
| Does dynasty's production blend improve on prior-year PPG? | Actual `_dhqComputeProductionPPG` helper compared with subsequent season PPG, retaining exits | Measured component only |
| Are multi-year DHQ values accurate market-price forecasts? | No vintage-matched historical starting values, market inputs and future price outcomes were recovered | Not established |
| Are preseason redraft/provider projections accurate? | No verified historical, timestamp-matched provider projection corpus was obtained | Not measured |
| Are league-specific trades, superflex, TE premium, IDP, keeper and team-fit recommendations accurate? | Not represented by this production benchmark | Not measured |

The production tests are not a scorecard for the full app. In particular, healthy-production estimates, availability-adjusted expected production, market prices, and roster-fit recommendations are different targets.

## Historical data and protocol

Sources: [nflverse player-stat release](https://github.com/nflverse/nflverse-data/releases/tag/stats_player), [player-stat documentation](https://nflreadr.nflverse.com/reference/load_player_stats.html), and [data availability](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html).

- Downloaded 2021–2025 weekly player statistics; only regular-season QB/RB/WR/TE rows enter the analysis.
- Main redraft sample: 2022–2025, after completed weeks 6, 10 and 14; outcome is subsequent points through week 17. This avoids claiming preseason coverage without archived projections.
- Full PPR with 4-point passing TDs, 0.04/pass yard, 0.1/rush or receiving yard, 6-point rushing/receiving TDs, -2/interception or lost offensive fumble, and 2-point conversions. Return TDs, bonuses, kickers and IDP are excluded. Half-PPR and non-PPR sensitivity runs use the same protocol with cohorts reselected under that scoring.
- At each cutoff, candidate membership uses only last season or stat rows already observed this season. Eligibility requires at least four previous-season stat-row games or two current-season stat-row games, plus positive production.
- Select 24 QBs, 60 RBs, 60 WRs and 24 TEs using the larger of prior PPG × min(prior stat games/8, 1) and current PPG × min(current stat games/4, 1). Selection does not use future production or the audited model's forecast.
- Main sample: **2,016 player/checkpoint observations, 302 unique players**. These observations overlap; they are not 2,016 independent experiments. No statistical significance or confidence-interval claim is made.
- Absent future players remain in the sample with zero future production. No selection of only future survivors.
- Player identity is GSIS ID. Team/position come from the latest pre-cutoff stat row, with prior-season fallback. No future team transfer information enters player context.
- Remaining bye adjustment is inferred from team appearances in the season's game data, using only schedule membership, not future performance. This is a retrospective schedule reconstruction, not a archived preseason schedule feed; cancellations and subsequent team changes are limitations.
- **Games played means the count of available weekly stat rows**, including zero-opportunity rows when supplied. It is not an exact replay of Sleeper's GP denominator or snap participation. This affects PPG and reliability. All compared baselines use the same mapped inputs.
- Historical stats are the current corrected dataset, not point-in-time stat vintages. No future player statistics enter predictor features, but later stat corrections can be present.
- Market inputs are absent; the scored universe is seeded with dummy values solely to call the existing engine. The audit scores its **points output**, not the 0–10,000 value output, cross-position VOR ranks, or trade prices.

## Redraft results

Mean absolute error (MAE) is the average absolute miss in **remaining-season fantasy points**, not points per week. Lower is better. Bias is forecast minus actual; positive means overprediction.

| Predictor, full PPR | MAE | Bias | RMSE |
| --- | ---: | ---: | ---: |
| DHQ historical-production fallback | 35.586 | +21.055 | 48.694 |
| Carry forward prior-season PPG | 39.655 | +13.836 | 53.726 |
| Carry forward current-season PPG | **30.864** | +15.827 | 43.630 |
| Equal prior/current PPG blend | 32.711 | +19.236 | 45.061 |
| DHQ with recent-form adjustment disabled | 32.336 | +19.294 | 44.760 |
| DHQ × observed participation fraction, diagnostic only | 30.554 | +9.040 | 42.987 |

For a missing prior/current season, that single-season baseline is zero. The equal blend uses the available season when only one exists. The participation diagnostic multiplies DHQ points by min(1, current stat-row games / elapsed games for the last observed team). It cannot distinguish injury, benching, team changes or return dates, and is **not proposed as a production fix**.

DHQ error is 15.3% higher than the current-season-average baseline in the primary sample. This is not just a few no-current-data players: among the 1,962 observations already seen this season, DHQ MAE is 34.412 versus 31.381 for current-season PPG. Disabling recent form scores 31.073 in that subgroup, slightly better than current-season PPG; retaining a historical blend can still be useful.

Last-year PPG is an especially weak comparison for the 152 observations without prior-year stat rows. Among the 1,864 observations with prior-year rows, DHQ still improves over that baseline (35.462 vs 37.270), but loses to current-season PPG (30.614).

### Consistency across seasons

| Season | DHQ MAE | Current-season PPG MAE | DHQ without recent form MAE |
| --- | ---: | ---: | ---: |
| 2022 | 35.765 | 31.050 | 33.098 |
| 2023 | 34.692 | 29.501 | 31.511 |
| 2024 | 34.287 | 30.711 | 31.059 |
| 2025 | 37.601 | 32.193 | 33.677 |

The same broad result appears in all four seasons, all four positions, and all three cutoff weeks: current-season PPG has lower pooled MAE than the unmodified fallback. Disabling recent form also improves pooled MAE in each season.

### Scoring sensitivity

| Scoring | DHQ MAE | Current-season PPG MAE | DHQ without recent form MAE |
| --- | ---: | ---: | ---: |
| Full PPR | 35.586 | 30.864 | 32.336 |
| Half PPR | 32.054 | 27.659 | 29.056 |
| Non-PPR | 28.823 | 24.778 | 26.042 |

Each scoring run has 2,016 observations; these are overlapping sensitivity runs, not three independent datasets. This does not establish performance in custom scoring, TE premium, IDP or superflex decision-making.

Average within-position Spearman correlation across 48 season/cutoff/position boards is 0.379 for DHQ points, 0.457 for current-season PPG and 0.412 without recent form. These are rankings of remaining **production**, not validation of dynasty or trade values.

### What some large misses look like

These are replayed fallback forecasts, **not historical numbers shown by the app**. Subsequent injuries and role changes are outcomes to manage probabilistically, not events a model should magically know.

| After week 6 | Fallback points through week 17 | Actual mapped points |
| --- | ---: | ---: |
| Justin Fields, 2024 | 234.2 | 5.8 |
| Breece Hall, 2022 | 212.0 | 13.2 |
| Christian McCaffrey, 2024 | 244.6 | 47.8 |

These cases illustrate why a healthy PPG extrapolation is not enough to represent expected realized output. Archived role/availability context is needed to distinguish avoidable misses from genuinely unforeseeable events. No causal breakdown of these misses is claimed by this audit.

## Dynasty: useful signal, insufficient forecast evidence

The production helper was evaluated using 2021-forward histories, selecting 24/60/60/24 players by origin-season points with at least four stat-row games. Origins are 2021–2024; only fully observable horizons through 2025 are scored.

Target: average of the subsequent one, two or three seasons' PPG, with a missing season assigned zero. This deliberately includes exits but is **not cumulative points, expected active games, market value, or the output of the full dynasty forecast**. Production estimates are held constant across the diagnostic horizon; no age/situation/market adjustments are represented. Histories are truncated at 2021, so this is not the full career history available to the live engine.

| Horizon | Observations | DHQ production helper MAE | Prior-season PPG MAE | DHQ bias |
| --- | ---: | ---: | ---: | ---: |
| Next season | 672 | 3.412 | 3.520 | +1.673 |
| Mean of next two seasons | 504 | 3.744 | 3.843 | +2.370 |
| Mean of next three seasons | 336 | 4.171 | 4.259 | +3.255 |

The helper modestly improves over last season's PPG. That does **not** prove the 1–3 year DHQ forecast is accurate. If the three-year sample is restricted to players with stat rows in all three future seasons, helper MAE falls to 2.891—but this hindsight-selected subset hides exits. The full cohort's 4.171 is the relevant attrition-inclusive diagnostic. Horizon samples differ, so changes in error across horizons are not a controlled same-cohort comparison.

The full `projectPlayerValue` function remains a deterministic transformation of today's DHQ with hand-set age bands, usage and trend adjustments. Verified structural behaviors:

- Identical synthetic healthy/on-IR/unsigned player inputs receive 229.2 ROS points and 5,000 redraft value each when provider production is identical. Availability is not independently incorporated in this path.
- A synthetic 21-year-old WR starting at 5,000 projects to 6,469 in three years with the clock in August versus 5,944 in September. Only calendar month changed. The function's “confidence” changes growth, rather than returning calibrated uncertainty.
- Unknown age leaves a 5,000 score unchanged three years into the future. Missing information is effectively presented as stability.

## Evidence capture gap

The existing `player_value_snapshots` migration and browser capture code are a useful start, but are not a complete forecast ledger:

- The migration is dated August 2026; its existence does not establish earlier stored coverage. This audit did not obtain an authenticated historical snapshot export and makes no claim about current database row counts.
- Capture is best-effort on league open and only includes rostered positive-valued players. Missing/zero observations and non-rostered candidates can disappear from the historical sample.
- The value capture does not currently supply the input vintage, model version, projected points, horizon, uncertainty bounds, or availability assumptions needed for a forecast replay. Generic context exists but periodic capture does not populate that information.
- A present-day market price cannot be substituted for the market at a historical decision date. Agreement with a market that DHQ already blends in is not independent accuracy evidence.

## Recommended implementation order

1. **Separate availability from healthy ability.** Preserve healthy PPG, but calculate expected active weeks and realized ROS points separately. Represent known absence, uncertain return, unsigned status and role loss distinctly. Never blindly set every IR player to zero ROS or every unsigned dynasty asset to zero value.
2. **Run a baseline challenger in shadow mode.** Compare the existing blend, no-recent-form version and current-season PPG on frozen future predictions. Do not replace the engine merely because an exploratory historical ablation won here.
3. **Build a versioned forecast ledger.** Capture decision timestamp, source as-of timestamps, model/code hash, league scoring/roster hash, player universe including zeros/missing flags, healthy production, availability estimate, horizon, expected points, forecast bounds, separate market price and roster-fit outputs. Capture before outcomes, not on a later reconstruction.
4. **Validate full dynasty independently.** Recover timestamped starting DHQ/market snapshots and age/role/contract inputs; score both subsequent production and market-value retention separately. Include rookies and retired/non-rostered players. Until then, label multi-year DHQ as a scenario estimate, not a calibrated forecast.
5. **Use a real promotion gate.** Predeclare evaluation horizons, baselines and cohort metrics, then evaluate on untouched chronological data. Require improvement in error/bias and useful rank/decision quality, plus coverage checks and interval calibration. Do not use this already-examined 2022–2025 sample as a fresh holdout.

**Highest-confidence next action:** improve the availability contract and capture auditable forecasts. The recent-form adjustment is a strong challenger candidate, not a proven universal defect in every live path.

## Reproduce and inspect

From the War Room root:

```sh
node tests/football-logic-audit.cjs
node tests/redraft-values.js
node scripts/audit-football-logic.cjs
node scripts/audit-football-logic.cjs --offline --ppr=0.5
node scripts/audit-football-logic.cjs --offline --ppr=0
```

First run downloads the public data; subsequent runs reuse it. `--offline` fails if any input is missing. The runner writes data/code SHA-256 hashes and metrics to `output/football-audit/results.json`, plus individual prediction/outcome rows in `redraft-records.json`, `dynasty-production-records.json`, and `rank-boards.json`. Scoring variants append `-ppr-0.5` or `-ppr-0` to output names. Raw data/output are intentionally git-ignored. Verify hashes when comparing reruns; upstream CSVs can be corrected.

Input SHA-256 fingerprints for this report:

| Season | SHA-256 |
| --- | --- |
| 2021 | `41915fb49238902ad1f129ebf0405b11a1e710454ae0fe8f7b3e4f9145875f48` |
| 2022 | `ad426c3fe5bf1cc30c3f137fdfe96d054e19d400879ee4413129da49fa7b54be` |
| 2023 | `f19cb71a5de0dce7fd09376026237c9ee9d5a93fe13815a2ea3ec2d37204cb17` |
| 2024 | `3ddc45a84f759aa348ce465ae001752c530575455717657cdfe1f8abfcdb4759` |
| 2025 | `e5e0615b3d96a3eaebfaee91e55afb4a4e7fe0caf057454177bcd7d6ad4bcfc2` |

Verification: eight audit-integrity checks and fifteen existing redraft-value tests pass. The integrity checks include future-input isolation and retention of disappearing players. Known-gap checks intentionally reproduce existing behavior; they do not endorse it. No scoring/UI/deployment changes were made.
