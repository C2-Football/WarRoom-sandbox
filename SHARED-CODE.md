# Shared Code Contract

**The neutral `C2-Football/dhq-shared` repo is the canonical owner of all shared
engine logic.** Both War Room (`warroom/`) and ReconAI/Scout (`reconai/`) vendor
these 30 modules into their own build at deploy time — neither app depends on the
other's repo, and there is no runtime CDN dependency between them.

---

## Source of truth

```
C2-Football/dhq-shared   (30 modules + manifest.json)
```

Each app copies these in at build time and on local `npm run dev`/`start` via its
own sync script:

- War Room — `scripts/sync-reconai-shared.cjs` → `reconai-shared/` (dir name kept
  for historical reasons; the source is now dhq-shared, not ReconAI).
- ReconAI — `scripts/sync-shared.cjs` → `shared/` (the 30 are gitignored; the
  Scout-only modules in `shared/` stay tracked).

A change is live in each app after that app's own next deploy.

---

## Shared Files (owned by dhq-shared, vendored by both apps)

| File | Purpose | Key exports |
|------|---------|-------------|
| `constants.js` | Core constants — must load first | `App.POS_COLORS`, `App.ageCurveWindows`, `App.peakWindows`, `App.decayRates`, `App.BASE_PICK_VALUES`, `App.tradeValueTier`, `App.posMap`, `App.posClass`, `App.NFL_TEAMS` |
| `utils.js` | Utility functions | `App.normPos`, `App.posColor` (delegates to `POS_COLORS`), `App.calcRawPts`, `App.isElitePlayer`, `App.dhqLog` |
| `pick-value-model.js` | Dynamic dynasty pick valuation (3-phase exponential decay, KTC-calibrated) | `App.LI.dhqPickValueFn` |
| `dhq-engine.js` | League Intel engine — scores every player using real league data | `App.LI`, `App.loadLeagueIntel()`, `App.calcOptimalPPG()` |
| `dhq-providers.js` | Provider scoring logic | `dynastyValue()`, `getPlayerAction()` |
| `dhq-ai.js` | AI integration (Claude/Gemini) | `App.askAlex()` |
| `ai-dispatch.js` | AI message queue and routing | `App.AI.*` |
| `intelligence-context.js` | App-wide context and recommendation contracts | `App.Intelligence.*` |
| `analytics-engine.js` | League-wide analytics | `App.Analytics.*` |
| `assistant-tutorial.js` | Shared first-launch GM briefing tutorial | `App.AssistantTutorial.*` |
| `team-assess.js` | Roster/team strength assessment | `assessTeamFromGlobal()`, `assessAllTeamsFromGlobal()` |
| `player-modal.js` | Reusable player detail modal | `App.showPlayerModal()` |
| `sleeper-api.js` | Sleeper Fantasy API wrapper | `window.Sleeper.*` |
| `espn-api.js` | ESPN Fantasy API wrapper | `window.ESPN.*` |
| `supabase-client.js` | Auth + Owner DNA cloud sync | `window.OD.*` |
| `storage.js` | localStorage/sessionStorage abstraction | `window.Store.*` |
| `event-bus.js` | Cross-module pub/sub events | `window.Bus.*` |
| `tier.js` | Feature-flag / subscription gate (ReconAI app) | `getTier()`, `canAccess()` |

### Load Order (required)

`constants.js` → `utils.js` → `dhq-core.js` and `intelligence-context.js` before `dhq-engine.js` → everything else

`constants.js` must come first because `posColor()` in `utils.js` reads
`App.POS_COLORS`, which `constants.js` defines.

---

## Canonical Values (single source of truth in `constants.js`)

### Position colors — `App.POS_COLORS`
```js
{ QB:'#E74C3C', RB:'#2ECC71', WR:'#3498DB', TE:'#F0A500',
  K:'#9B59B6',  DL:'#E67E22', LB:'#1ABC9C', DB:'#E91E63' }
```
`posColor(pos)` in `utils.js` delegates to this object. Do not define
position colors anywhere else.

### Age curves — `App.ageCurveWindows`
```js
{
  QB:{build:[23,27],peak:[28,34],decline:[35,38]},
  RB:{build:[21,22],peak:[23,25],decline:[26,28]},
  WR:{build:[22,24],peak:[25,28],decline:[29,31]},
  TE:{build:[23,25],peak:[26,29],decline:[30,32]},
  DL:{build:[22,24],peak:[25,29],decline:[30,32]},
  LB:{build:[22,23],peak:[24,28],decline:[29,31]},
  DB:{build:[21,23],peak:[24,27],decline:[28,30]},
  K:{build:[23,27],peak:[28,35],decline:[36,40]}
}
```

`App.peakWindows` is derived from the elite peak portion of these curves.

### Decay rates — `App.decayRates`
```js
{ QB:0.12, RB:0.22, WR:0.18, TE:0.16, K:0.08, DL:0.15, EDGE:0.15, LB:0.16, DB:0.18 }
```
Annual value decline rate after the valuable decline band. Higher = steeper cliff.

### Player value tiers — `App.tradeValueTier(val)`
```
DHQ >= 7000  → Elite
DHQ >= 4000  → Starter
DHQ >= 2000  → Depth
DHQ >  0     → Stash
```
Use `window.App.tradeValueTier(dhq)` everywhere. Do not hardcode these
thresholds inline.

---

## How War Room Consumes Shared Code

War Room loads shared scripts via `<script src="https://jcc100218.github.io/ReconAI/shared/...">` tags in each HTML page. Scripts run in the browser before War Room's own JS.

**Pattern for constants that could fail to load:**

War Room's `js/core.js` sets fallbacks with `||` guards so the app
degrades gracefully if the CDN is unavailable:

```js
// Good — CDN wins if present, fallback if not
window.App.ageCurveWindows = window.App.ageCurveWindows || AGE_CURVE_WINDOWS_DEFAULT;
window.App.peakWindows   = window.App.peakWindows   || PEAK_WINDOWS_DEFAULT;
window.App.decayRates    = window.App.decayRates    || { QB:0.12, ... };
window.App.tradeValueTier = window.App.tradeValueTier || function(val) { ... };
```

**Pattern for functions that might not exist:**

```js
// Good — optional-chain before calling
const color = window.App?.POS_COLORS?.[pos] || '#999';
const tier  = window.App?.tradeValueTier?.(dhq) || { tier: '—', col: 'var(--text3)' };
```

---

## Tier System Note

The two apps use different tier models intentionally:

| | ReconAI (Scout app) | War Room |
|---|---|---|
| Model | 30-day trial → paid | Subscription tiers |
| Tiers | free / trial / paid | free / scout / warroom |
| Gate fn | `canAccess(feature)` in `tier.js` | `canAccess(feature)` in `core.js` |
| Storage key | `STORAGE_KEYS.TRIAL_START` | `od_profile_v1.tier` |

Both read from the same Supabase profile (`od_profile_v1`) for the
authoritative tier string. The mapping is handled in each app's gate
function.

---

## Making Changes

- **Changing a shared constant** — edit `constants.js` in the `dhq-shared` repo only. Verify the fallback value in `warroom/js/core.js` matches, then update it if needed.
- **Changing `posColor()`** — update `POS_COLORS` in `dhq-shared/constants.js`. `posColor()` delegates automatically.
- **Adding a new shared function** — add to the appropriate `dhq-shared` module, then add a fallback in `warroom/js/core.js` with the `|| fallback` pattern.
- **Adding a new constant** — add to `dhq-shared/constants.js` and add a matching fallback in `warroom/js/core.js`.

After editing any shared module: `git push origin main` in `dhq-shared/`. Each app vendors the change on its next build (`npm run sync:shared`, which runs automatically on dev/build/deploy).

## Advice scorecard modules (November 2026)

`advice-scorecard.js`, `roster-waiver-lens.js`, `roster-trade-lens.js`, `waiver-roster-read.js`, and `roster-lens-basis.js` are canonical in dhq-shared. The sync script copies the advice evaluator into `reconai-shared/` and the existing lens paths into `js/shared/`. Edit the canonical copies first. Current recommendation algorithms remain unchanged apart from the guarded capture hook. Displayed capture and the server scheduler are disabled until separately activated. See `reports/advice-scorecard.md`.
