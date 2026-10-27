# The Vault — beta readiness review

## October 27, 2026 profile and matchup feedback pass

Status: VERIFIED locally. Baseline checkpoint: `8f6ece0`. This finite pass
completes the 11 new trade, stats, profile, live-matchup, recap and End week
comments. Scoring, historical data, saves and authoritative actions remain
unchanged. No deployment was performed.

| Requirement | Status | Completion criterion |
|---|---|---|
| Trade assessment sidebar (1) | VERIFIED | One 250px assessment above Owner DNA after selection, absent when empty; phone/tablet portrait places it before packages; all six sizes verified |
| Compact player stats and ownership (2–4) | VERIFIED | Representative desktop rows are 55px; one Owned by column/link; marked glossary removed; real team dialog/details/filter/sort and phone owner labels work |
| My Profile and Customize (5–7) | VERIFIED | Achievements removed from main navigation and available inside My Profile; old Trophy Case routes work; closed editor, retained unsaved draft and existing 2/11 earned state verified; marked note removed |
| Inspect other live matchups (8–9) | VERIFIED | Scoreboard buttons select both lineups and spotlight at the same clock; switching while playing continues; phone return/focus works; marked scoring-moments section absent |
| Compact postgame Home (10) | VERIFIED | Six-team recap ends at 766.05px, above the 819px dock at 1339×892; exact final, explanation, three league results and next opponent all retained |
| End week handoff (11) | VERIFIED | Actual confirmed advances land Home at Week 3 and Week 5; failed-save test stays postgame and Retry commits once then opens Home |
| Integration and verification | VERIFIED | Final 80-command Vault suite, core 97/97, first-class 7/7, shared draft checks, seven-script lint and build pass; 36 real responsive view checks; saved reload verified |

The trade builder reuses its existing assessment and acceptance rule. The right
rail holds the assessment above Owner DNA after either side starts a package;
there is no empty grade card or duplicate assessment. Narrow layouts retain the
assessment before the selected packages. Stats keeps recorded detail behind a
small native disclosure, removes repeated ownership from the player identity,
and exposes one explicit Owned by column. Phone summaries retain the owner,
with a working team-profile link in the detail. Metric definitions remain on
the controls, and the selected period fits at 390px.

My Profile now has Profile & career and Achievements sections. Existing Trophy
Case links and saved achievement-view preferences still reach the same earned
state. Customize is closed by default; the form stays mounted so collapse does
not discard an unsaved draft. Loading, errors, recovery and save feedback remain
visible outside it. No profile save or publication was submitted during browser
QA. First-time game playback withholds updated career/achievement aggregates
until the final whistle; explicit replays retain access to earned history.

Game-day selection is local presentation state, scoped to the room and week.
It never changes the owner's lineup, authority, clock, pace, saved score or next
action. An actual paused foreign matchup retained END Q1 and 58/224 moments
across Profile and Stats; Stats still showed only completed Week 3 during Week
4 playback. Switching another matchup while playing kept Q2 running. Phone
All matchups returned focus to the selected view. The complete scoring-moments
disclosure is removed; matchup analysis, source explanation and saved scoring
archive remain available.

Browser QA found a pre-existing component-key collision: Stats and the persistent
gamecast shared a sibling key. Visiting Stats could leave the paused view hidden
beside a new visible final. Distinct gamecast/stats keys now preserve one
workspace and the exact selected playback. A regression test covers key identity
and the replay horizon, and the actual navigation sequence passes. The existing
draft key contract is retained.

The disposable six-team save on `3038` progressed from one completed week to
four through actual controls. Its final foreign matchup, Warlord Kade
121.78–99.24 Frankie Deals, matched both nine-player sums. Finishing foreign playback still
opened the owner's Home recap, Archive Owls 122.54–89.86 Riverboat Sol.
End week opened Home, and reload/named Resume retained Week 5 planning with
exactly 4/14 weeks saved. User gameplay on `3037` was not used as a fixture.

Trades, Stats, Profile, Achievements, recap and a selected live matchup were
captured at 390×844, 430×932, 1024×1366, 1366×1024, 1339×892 and 1440×900.
All 36 checks had no document horizontal overflow. The three desktop sizes fit
the standard recap and all 18 live starters/essential controls above the dock.
Phone, portrait tablet, expanded details and custom/longer content scroll
naturally. This is local Chromium emulation; hosted multiplayer, WebKit,
physical devices and browser text enlargement remain unverified. Rapid automated
resizing briefly required reopening More after the viewport settled; device
rotation timing remains a follow-up check, not a claim of physical-device proof.

No data/rules or save-schema migration is required. Engine, season, AI, hidden
years, player-stat, profile and career data modules match `8f6ece0` byte-for-byte.
Existing future-work priorities below remain unchanged.

Evidence: [source hashes, checks and interactive results](public-readiness/evidence/vault-profile-matchups-20261027.json).
Logs/captures: `output/playwright/vault-profile-matchups-20261027/`.
Representative [recap](../output/playwright/vault-profile-matchups-20261027/recap-final-1339x892.png),
[live matchup](../output/playwright/vault-profile-matchups-20261027/other-live-matchup-1339x892.png),
[trade rail](../output/playwright/vault-profile-matchups-20261027/trades-1339x892.png),
[compact stats](../output/playwright/vault-profile-matchups-20261027/stats-1339x892.png),
[phone profile](../output/playwright/vault-profile-matchups-20261027/profile-390x844.png).
The `attempt-duplicate-gamecast` files record the repaired finding, not final UI.

Run `node scripts/serve-static.cjs --port=3037 --compile` and inspect
`http://127.0.0.1:3037/?vault=1`. Node 20.20.2 checks:
`npm run test:timeleague`, `npm run test:core`, `npm run test:first-class`,
`npm run test:game-draft-table`, ESLint on seven changed runtime scripts and
`node scripts/build-deploy.cjs`. All pass; build compiles 161 JSX scripts and
minifies 300 modules. Final captured browser errors/warnings were empty.

## October 27, 2026 gameplay desks feedback pass

Status: VERIFIED locally. Baseline checkpoint: `279131f`. Finite scope: the 15
new Home, game-day, roster, waiver, trade and Messages comments. This pass makes
no historical-data, scoring, save-schema or hosted publication changes.

| Requirement | Status | Completion criterion |
|---|---|---|
| Home league Wire (1) | VERIFIED | Three event-driven headlines from actual visible results, trades, waivers or draft records; working destinations; actual Week 2 update verified |
| Game-day columns (2) | VERIFIED | Score/controls beside all nine starter matchups; scored live and final lineup bottom 806.88px above the 827/819px docks at 1339×892 |
| Roster cleanup/density (3–6) | VERIFIED | Marked prose/help removed; concise no-record status and Compare action retained; desktop rows measured 69.30px; actual Move/swap/lock worked |
| Waiver repairs (7–8) | VERIFIED | Labels/numbers remain grouped without overlap; completed-Vault PTS column and phone totals; numeric zero, missing values and visible-week horizon covered |
| Trade layout/value/acceptance (9–14) | VERIFIED | Owner DNA in a 250px right sidebar on desktop; marked filler removed; signed delta, value grade and shared current-rule AI acceptance read |
| Trade proposals in Messages (15) | VERIFIED | Own-seat packages/status by counterpart; actual pending → Inbox and rejected → Trade Log links focused the exact saved offer |
| Compatibility and interactive verification | VERIFIED | Final 79-command Vault suite, core 97/97, first-class 7/7, shared draft checks, lint/build; 48 responsive view/state checks and actual saved-week journey |

The Wire derives its headlines from saved league events. It does not invent
activity, expose another owner's pending offer or reveal an unwatched result.
Exact finals/leaders remain expandable. The six-team Home Wire ends at 752.86px,
above the action dock at the marked desktop size.

Game day keeps scores, essential controls and both starting lineups together.
Matchup analysis and scoring moments remain available through disclosures; the
historical-statistics versus simulated-quarter explanation stays visible. Final
scores retain two decimals, including narrow results such as 100.04–100.02.
Final playback offers Replay/Close, returns focus to the matchup and restores
the padded league header. Mail stays below the primary matchup, with existing
header/dock unread actions still available.

Interactive QA exposed a stale animation callback that advanced the clock after
Pause. The playback loop now invalidates queued frames on pause, resume, pace
changes and leaving the view. The regression fails before the repair and passes
after it; actual browser playback held the same paused clock. Presentation never
changes the already saved result.

Trade value uses the existing comparison rules. Acceptance reuses the actual
AI decision and public values; 108 persona/difficulty/package fixtures preserve
the complete saved responses from `279131f`. This AI is deterministic, so the
display honestly reports 0% or 100% under the current rule, not an invented
midrange probability. Human, deferred, unavailable and blocked packages get no
percentage. Comparison details explain the archive/observed basis. Messages
derive proposal cards from saved trades and route to existing controls; they do
not fabricate chat messages or create a second trade store.

CUA/IAB testing used disposable `3038` data. A proposal survived reload as one
offer, then its actual AI rejection matched the 0% preview and appeared in the
correct conversation/history. A legal QB swap, lineup lock, game-day playback,
scoring receipt, End week and named Resume all worked. The 86.60–89.86 result
matched both nine-player sums and all six box scores remained unchanged after
reload/replay. Week 2 Home showed real results and completed trades. User
progress on `3037` was not used as a fixture.

Home, Game day, Roster, Waivers, Trades and Messages were inspected at 390×844,
430×932, 1024×1366, 1366×1024, 1339×892 and 1440×900, plus scored-live/final
game-day states at each size. All 48 checks had no document horizontal overflow.
The single-view game-day claim covers the standard nine-slot desktop matchup;
phone, tablet portrait, expanded details and larger custom rosters scroll
naturally. This is local Chromium viewport emulation. Hosted multiplayer,
WebKit, physical devices and browser enlarged-text zoom are unverified in this
pass. Existing online authorization/privacy contracts pass automated checks.

No migration or recovery reset is required. Historical records, scoring and
settled outcomes stay unchanged. Existing future-work priorities below remain;
no new release blockers were found in this finite feedback pass.

Evidence: [source hashes, checks and interactive results](public-readiness/evidence/vault-desks-20261027.json).
Logs/captures: `output/playwright/vault-desks-20261027/`.
Representative [final matchup](../output/playwright/vault-desks-20261027/gameday-final-1339x892.png),
[Week 2 Wire](../output/playwright/vault-desks-20261027/home-wire-week2-1339x892.png),
[trade grade/acceptance](../output/playwright/vault-desks-20261027/trade-positive-1339x892.png),
[proposal in Messages](../output/playwright/vault-desks-20261027/messages-proposal-1339x892.png),
[phone waivers](../output/playwright/vault-desks-20261027/waivers-390x844.png).
Earlier `attempt-*` and `before-density-fix` images record repaired findings,
not final visual evidence.

Run with `node scripts/serve-static.cjs --port=3037 --compile`; inspect
`http://127.0.0.1:3037/?vault=1`. Verification used Node 20.20.2:
`npm run test:timeleague`, `npm run test:core`, `npm run test:first-class`,
`npm run test:game-draft-table`, ESLint on the six changed runtime scripts and
`node scripts/build-deploy.cjs`. All pass. Build compiles 161 JSX scripts and
minifies 300 modules. Captured browser errors/warnings were empty. No push,
backend update or deployment was performed.

## October 27, 2026 desktop feedback pass

Status: VERIFIED locally. Baseline: `9f7e5d5`. Scope: the nine new annotated
draft/Home comments. No rules, historical data, save format or hosted publication
changes were made. The previous published release below remains unchanged.

| Requirement | Status | Completion criterion |
|---|---|---|
| Compact draft rows/actions (1–2) | VERIFIED | Desktop rows measured 59.84px versus 103.98px baseline; four aligned 44px actions; no horizontal table overflow at the six checked sizes |
| Concise quick scout (3–5) | VERIFIED | No Evidence paragraph; correct singular/equal/missing/range/ownership copy; public information preserved |
| Desktop Home composition (6) | VERIFIED | Six-team planning dashboard ends at 816.63px, above the 827px action dock at 1339×892; next actions and full standings retained |
| League eras and mail (7–8) | VERIFIED | Rostered public decades in league header; no bottom Home mail card; actual Messages route and unread actions retained |
| Navigation order (9) | VERIFIED | Actual desktop and phone More place Trades before Player stats; eight new regression groups cover phase/privacy/navigation cases |
| Integration and responsive verification | VERIFIED | 77-command Vault suite, shared draft checks, core 97/97, first-class 7/7, source lint/build; real isolated draft completion, final-pick handoff and named Resume |

Desktop Home now puts standings beside League update and uses a smaller matchup
and action row. The opener update reports saved draft, roster, lineup, claim and
offer state plus actual recent activity. Replays, activity and Trophy case remain
reachable. Larger leagues, expanded details, recap/completion and phone/tablet
portrait content retain natural scrolling; the one-view fit claim applies to the
marked six-team planning dashboard, not every possible game state.

Draft density is scoped to the Vault adapter. Shared Dynasty HQ draft controls
are unchanged. Reference-scoring context remains in the metric labels/help and
the board note. Quick scout no longer renders the requested Evidence paragraph;
a single eligible edition reports one total, equal editions do not invent a
range, and missing totals remain unavailable. Header era summaries use only
`hiddenDecade` while years are sealed; getter-trap tests verify zero reads of
private assigned years. Save compatibility requires no migration.

Interactive QA found and repaired two connected defects: a ref-only pending-pick
lock could leave the next turn disabled after a successful save, and automatic
final-pick navigation could retain the draft's scroll position. Pending state now
repaints when the request settles, retaining duplicate-action protection. Both
manual navigation and automatic tab handoffs enter at the top. The draft test
reproduces the parent-confirmation/request-completion race; the actual browser
completed later consecutive human picks without a reload.

CUA/IAB testing used only disposable `3038` data: an existing six-team save at
four picks continued through all 72 picks into Home, then reloaded and resumed
the same 12-player roster. A separate two-team/one-QB league was created through
the real wizard; its final human pick opened Home with the header at 22px and a
working Review lineup action. Phone More → Messages opened real conversations
without sending a message. No user gameplay actions on `3037` were used as tests.

Draft and Home screenshots/geometry cover 390×844, 430×932, 1024×1366,
1366×1024, 1339×892 and 1440×900. Tablet QA caught and repaired a 42px internal
draft-table overflow; the final capture measures 778px content in 778px space.
The desktop inspector also retains a full-width table beside its compact 240px
panel. The QA tab's captured error log was empty. This is local Chromium viewport
emulation, not physical-device, WebKit, hosted multiplayer or deployment proof.

Evidence: [source hashes and interactive results](public-readiness/evidence/vault-desktop-20261027.json).
Logs and captures: `output/playwright/vault-desktop-20261027/`.
Representative [Home](../output/playwright/vault-desktop-20261027/home-1339x892.png),
[draft and scout](../output/playwright/vault-desktop-20261027/draft-inspector-1339x892.png),
[tablet draft](../output/playwright/vault-desktop-20261027/draft-1024x1366.png),
[phone More](../output/playwright/vault-desktop-20261027/more-390x844.png).
The `attempt-*` captures document earlier scroll/overflow findings and are
excluded from final visual evidence. Build compiles 161 JSX / minifies 300 modules;
the three changed runtime scripts pass ESLint without warnings. The full Vault
suite passes on Node 20.20.2; focused checks pass again after the final Home
handoff/copy corrections. Existing future-work priorities below are unchanged.

The updated preview runs with `node scripts/serve-static.cjs --port=3037 --compile`
at `http://127.0.0.1:3037/?vault=1`. No push, backend update or deployment was
performed in this feedback pass.

## October 26, 2026 browser feedback pass

Status: VERIFIED locally. Baseline checkpoint: `b3a3ca7`. This finite pass
implements the 14 marked browser comments in the existing preview. The October
22 published revision below remains unchanged.

| Requirement | Status | Completion criterion |
|---|---|---|
| Entry menu and creation steps (1–2) | VERIFIED | Four working destinations; Play → Era → Draft → Team → Review; Back retains choices; only final Review creates; guest restoration inside Join |
| Draft density and ticker (3–4, 11–12) | VERIFIED | Compact era rail, filters and metric rows; clock, manager, pick and position run share the primary draft ticker; 44px actions retained |
| Scout cleanup (5–10) | VERIFIED | Requested prose/placeholders removed; Available years disappears after the committed pick; GP retains its archive meaning through the header title |
| Draft history and sidebar (13–14) | VERIFIED | Actual recent picks show their public decade; private assigned years are never read for the feed; Opponent intel source/render removed |
| Integrated verification | VERIFIED | 76-command Vault suite, nine new menu groups, core 97/97, entry 7/7, build and source lint; real isolated creation/pick/scout/reload/Resume and six viewport matrices |

The entry menu will preserve saved progress and open it through Resume. Settings
reuses the existing team profile/design controls. No new game rules, data source,
account system, sound settings, or save migration is required.

### Player behavior and compatibility

The Vault now opens at a menu rather than automatically running the most recent
room. Resume uses the existing saved-league shelf and restores the selected
league's saved tab/team when applicable. Opening a menu does not start a timer,
advance a room, clear navigation preferences, or recreate a league. A guest's
Resume action remains scoped to that guest's room. Pending invitations open
Join and retain the existing account/guest claim and retry pipeline. Manual
Join extracts a seat code from an invitation URL and opens it on the current
trusted app origin; it never follows a pasted destination.

Creation keeps one mounted builder through all five steps and menu returns.
Only Review offers the create action, with the existing in-flight guard and
save-error recovery. An interrupted create keeps the edited inputs. The active
step's inner scroll and document position reset on navigation; screenshot QA
caught and fixed browser scroll anchoring that could hide a step heading behind
the sticky header. Settings reuses the existing device/account team profile;
saved designs continue to apply to new teams, not overwrite existing rosters.

There are no engine, scoring, historical-data, schema or save-format changes.
Hidden years remain sealed. Recent picks derive era labels from existing public
decade/eligibility data, with getter-trap tests preventing reads of private
assigned seasons. The scout file keeps factual biography when present and the
usable season table; the marked filler and repeated explanations are removed.

### Evidence and reproduction

The updated local preview runs at `http://127.0.0.1:3037/?vault=1`:

```sh
node scripts/serve-static.cjs --port=3037 --compile
npm run test:timeleague
node scripts/build-deploy.cjs
```

Disposable CUA browser testing used a separate `3038` origin. A real six-team
Roulette/Hidden Years snake league passed all five setup steps, edited identity,
Back retention, public era reveal, search, a human draft pick and three normal
AI picks, then pause, full scouting, reload to Menu, and named Resume. All four
pick-feed rows, the human roster and the paused turn persisted. The temporary
New pick highlight clears on reload, as intended. A second trip through all
five setup steps did not create another save. Join's invalid-input recovery and
Settings' actual profile controls were also exercised without joining a hosted
room or saving a profile.

Final IAB Chromium matrices cover 390×844, 430×932, 563×915, 1024×1366,
1366×1024 and 1440×900 for Menu, Review and Draft. All four menu actions fit;
there is no horizontal overflow, headings remain below the header, and the
final create action stays visible with a 48px target. Five separate 563px
step captures verify exactly one visible setup section and reachable navigation.
The existing user tabs and progress on `3037` were not used as test fixtures.

[Interactive proof and source hashes](public-readiness/evidence/vault-menu-20261026.json)
pin the seven changed runtime files and record the matrices and test boundary.
Full logs and screenshots are in `output/playwright/vault-menu-20261026/`.
Representative captures:
[menu](../output/playwright/vault-menu-20261026/menu-final-390x844.png),
[Review](../output/playwright/vault-menu-20261026/wizard-review-390x844.png),
[compact draft board](../output/playwright/vault-menu-20261026/draft-board-563.png),
[drafted scout file](../output/playwright/vault-menu-20261026/scout-drafted-563.png).

The full 76-command Vault suite passes on official Node 20.20.2, including the
unchanged full-season/data fixtures. The new independent menu test passes nine
groups. Core 97/97 and first-class entry 7/7 pass. The build compiles 161 JSX scripts
and minifies 300 modules. Full-source ESLint reports zero errors and 46 warnings
in unchanged files; the three modified runtime scripts pass without warnings.
After the final scroll correction, menu/setup tests, runtime lint and all five
actual step transitions were checked again. The existing minified acceptance
harness now uses the menu/five steps/named Resume and passes syntax checking;
it was not browser-executed in this pass.

This is local compiled-preview and responsive-emulation evidence. It does not
add hosted multiplayer, physical-device, WebKit, profile-sync or production
deployment proof. Native CUA's invalid DevTools dimensions and the first
scroll-offset captures remain separately labelled `attempt-*` and are excluded
from the final matrices. The existing prioritized future-work list is unchanged.

## October 21, 2026 implementation release

Local branch: `codex/vault-experience-20261021`, reversible baseline `47bb5dd`.
Workspace: `/Users/jacobc/Projects/work/warroom-vault-experience-20261021`.
The main checkout and its unrelated changes are untouched. The user authorized
deployment on October 22, 2026; the release scope is both Pages hosts and the
matching Vault (`time-league`) authoritative runtime.

### October 22 deployment

Status: IMPLEMENTED — release preparation and verification in progress.
Production and sandbox were refreshed and both remain at `47bb5dd`; the eight
completed Vault commits fast-forward that base. Both workflow dependency pins
remain `74d6369224db5b814a9f3fdeff8fb7d60735aa81`.

The backend uses the existing manual C2 release guard with a fresh
`.github/c2-releases/vault-experience-20261022.json`, official Node 20.20.2 /
zlib 1.3.1-e00f703, read-only schema/source preflight and post-deploy byte checks.
Only `time-league` is selected; no SQL migrations or other functions are part of
this release. Pages runs for this release will be held until backend verification
completes, then production and sandbox must serve the same exact release SHA.

Evidence is recorded in `output/playwright/vault-release-deployment/` and the
standard `reports/public-readiness/evidence/release-<sha>.json`. Final proof must
include green relevant workflows, exact frontend revisions/content hashes,
verified deployed Vault function sources/version and actual hosted guest smoke.

Rollback must preserve `planningRecoveryWeek`, `bestDecadeSpread`,
`preNinetyRostered` and `waiverClaimsLanded`; old normalizers discard these fields.
Use a compatible hotfix rather than restoring an old serializer. Existing local
Vault tabs should be reloaded after release before making further save changes.

Finite release: make the existing solo journey easier to resume, guide the real
weekly decisions, explain saved results, and prevent a stale local tab from
silently overwriting newer progress. Preserve all draft formats, era rules,
historical data, scoring, characters, earned progress and online contracts.
No new modes, economy, AI service, or data source.

| Requirement / phase | Status | Completion evidence |
|---|---|---|
| A: inspect architecture, rules, baseline and disposable browser journey | VERIFIED | Baseline 47bb5dd; original Vault suite passed; real lobby/setup/draft captures in output/playwright/vault-experience/before-* |
| B: entry/resume and point-of-use draft premise | VERIFIED | Real hub/direct setup, 12-pick local draft, reload, saved shelf/team/stage/week context; fixed hub URL now retains vault=1 |
| C: legal next decisions and saved-result explanation | VERIFIED | Real planning, legal Move swap, lineup lock, game day/instant/recap, exact saved score, box-score route, reload and End week; known tie fixtures |
| D: existing rival/progression connections | VERIFIED | Actual friendly composer reply and authored reply each survive reload once; fixture-assisted 14-week champion, career/team links and completed shelf resume |
| E: save compatibility and conflict recovery | VERIFIED | Storage-conflict and recovery tests: stale views/tabs, held locks, switching rooms, quota recovery, old JSON/compression, no overwritten newer progress |
| E: integrated build, lifecycle/regression and rendered matrix | VERIFIED | First slice: 65-command Vault suite,160-script build, core97/97, first-class7/7, five-size Chromium journey and WebKit phone controls; follow-on evidence below |
| Final release acceptance | VERIFIED | Runtime checkpoint `4f29dfd`; independent reviews clear; 75-command Vault suite and minified 300-module build pass; 11-group connected default journey plus nine tracked boundary checks pass with exact saved-state and served-byte evidence |
| Authenticated hosted multiplayer / physical devices | BLOCKED | No live accounts or production mutations used; outside this local verification pass |

Statuses: NOT STARTED, DESIGNED, IMPLEMENTED, VERIFIED, BLOCKED. Verification
means evidence from this branch, with fixture/browser/hosted boundaries stated.
Other discoveries enter future work unless needed for this finite core journey.

### Final acceptance gate

The closing independent product/rules reviews found three bounded correctness
repairs within the original completion and earned-progress requirements:

- Runner-Up must identify the opponent in the saved championship, rather than
  the second regular-season seed. Missing postseason evidence must stay unknown.
- Existing roster and waiver achievements must retain proven accomplishments
  after legal trades/drops, including a move before the next saved game and an
  older save without waiver receipts. Three optional per-team peak counters
  (`bestDecadeSpread`, `preNinetyRostered`, `waiverClaimsLanded`) use the existing
  game save/transaction. No threshold, currency or reward grant is added.
- Saved decisive scores must retain two decimals. A `100.04–100.00` final must
  read as a narrow win; an exact playoff tie must retain its saved winner and
  explain the existing higher-seed rule.

All closing gates passed. Other feature ideas remain future work. The final
journey covers the default six-team rules through a real draft/game, save/resume,
fixture-assisted season boundary, ceremony, trophy case, career/history, archived
replay and a fresh season that preserves the completed save.

The completed local implementation is committed at runtime checkpoint
`4f29dfdf56f413aa2374acdf02bc348f97a41411`. The subsequent acceptance/handoff
commit adds the repeatable harness and this report without changing runtime
sources. Nothing was pushed, merged or published.

#### Final evidence and reproduction

`output/playwright/vault-release-acceptance/verification.json` records 11 passing
groups, 34 viewport captures, 117 intercepted requests to mutation endpoints,
232 served minified-overlay assets, and zero page/route errors or in-browser
Babel requests. It pins the exact runtime checkpoint above. The fresh default
game used six teams, 72 real draft picks, Hidden Years, Position Roulette,
standard roster, snake, half-PPR, 12 regular weeks and four-team playoffs.
Only manual draft order, no pick timer and fast AI pacing were selected for QA.
Week 1 and the championship used actual game-day controls. Intervening Weeks
2–13 used shared authoritative fixture actions on that same UI-created save;
this is not a manual full-season pacing or enjoyment claim.

`boundaries-verification.json` records the promoted tracked harness passing all
nine cases: true finalist versus regular-season second seed, retained modern
and receipt-less legacy waiver badges, duplicate-award denial, pregame roster
milestones after a legal trade, a `0.04` final margin, an exact saved-away-winner
playoff tie, and precise Home margins. Its 18 captures overlap the full run;
they are not 18 additional distinct screens. It records 202 minified overlay
and 97 fallback assets, including all four archive GETs at HTTP 200 with
SHA-256 values matching repository bytes. Both runs use disposable saves and
block all outbound mutations.

The full journey also verifies ceremony minimize/replay, explicit final-year
reveal, Trophy Case, career Open league, Week 1 replay, reload, new-save creation
and reopening the old completed save. Replays preserve the entire committed
game, including results, roster, messages, editions and progress. New-game
creation preserves the old completed save exactly.

Checks after the closeout fixes: `npm run test:timeleague` (75 commands),
`npm run test:core` (97/97), `npm run test:first-class` (7/7),
`npm run test:login-auth` (32 session scenarios plus request recovery), source
ESLint and `git diff --check` all pass. The minified build compiles 161 JSX
scripts and minifies 300 modules; `dist-deploy/release.json` has the exact
runtime revision and `local-preview` environment. Archive counts and legacy
data hashes remain unchanged. The independent milestone reviewer reproduced
badge permanence through a legal pregame trade, repeated reloads and public
projection, and confirmed sealed draft counters stay absent.

To reproduce, start the isolated QA server in one terminal, then build and run
the self-contained acceptance harness in another:

```sh
node scripts/serve-static.cjs --port=3038 --compile --allowed-hosts=vault-qa.test
# Second terminal, in this worktree:
node scripts/build-deploy.cjs
node tests/vault-release-acceptance.cjs
# Focused rerun of the nine self-generated boundary cases:
node tests/vault-release-acceptance.cjs --boundaries-only
```

The first full run used the same harness from the evidence directory; the
tracked form was then checked with `node --check` and reran all nine boundary
cases. Its loopback response adapter serves exact local bytes without disabling
browser security. The first synthetic-document private-network restriction and
a voluntarily stopped redundant full rerun are retained and explained in
`attempt-notes.json`; neither is counted as a passing run or an application fix.
`final-suite.log`, `core.log`, `entry.log`, `login.log`, `lint.log`,
`minified-build.log` and `verification-summary.json` bind the checks and hashes.

Representative captures:
[default draft](../output/playwright/vault-release-acceptance/default-draft-390.png),
[championship](../output/playwright/vault-release-acceptance/championship-ceremony-390.png),
[precise narrow final](../output/playwright/vault-release-acceptance/boundary-ceremony-narrow-win-390.png),
[retained roster trophies](../output/playwright/vault-release-acceptance/boundary-roster-trophies-retained-before-game-390.png),
[old season after a fresh start](../output/playwright/vault-release-acceptance/old-season-after-new-start-390.png).
Final minified acceptance is local Chromium at 390×844 and 1440×900; the prior
five-size, short-landscape and WebKit/touch matrices remain separately recorded.
Physical devices, hosted authentication/multiplayer, production performance and
deployment remain outside this verified local release. The prioritized future
work below is unchanged.

### Verified architecture, rules and inventory

The Vault is `js/tabs/time-league.js` plus existing `time-league-*` components,
shared engine/actions/scoring/storage, historical assets and Supabase actions.
Dynasty HQ owns the hub, module loader, navigation, account/guest identities,
shared runtime and infrastructure. No parallel account or inventory was added.

| Existing surface/system | Observed release state |
|---|---|
| Hub/direct entry and setup | Working local routes; solo is browser-local; friends has account/guest waiting-room contracts |
| Player acquisition | Player identity, not a specific season; snake, linear and auction; Position Roulette, All-Era and selected decades; legal capacity/QB/position rules shared with AI |
| Season discovery | One eligible assigned season; Hidden Years reveals through public candidate evidence and final reveal; Classic reveals after draft. Local storage contains private state and is not secure secrecy |
| Team, claims, trades | Shared legality; four stages: claims/planning, lineup, ready, postgame. Disabled mechanics now have honest navigation; no new management subsystem |
| Competition and results | Recorded game statistics produce fantasy points; version1 shuffles source performances without repetition. Simulated quarter timing presents an already saved result |
| Rivals and progression | Steward Vance and existing owners, context templates, saved message IDs, expressive/relationship replies, achievements, ceremony and career are retained; no paid AI or new rewards |
| Friends multiplayer | Authoritative server permissions/versioning and sealed public-state tests pass locally. Real hosted multi-account acceptance is unverified |
| Incomplete/duplicate options | Full squad and Standard use the same roster shape; retained as existing setup options, not advertised as distinct strategic modes |

Default setup is six teams, Hidden Years, Position Roulette, snake, half-PPR and
12 regular games plus a four-team playoff (14 total). Supported setup variants
retain their existing season calculations. Legacy `gameDeckVersion:0` calendar
saves keep original assets; version1 keeps full regular-season game decks.

Data is unchanged: the archive validator reports 3,586 identities, 22,906
player-seasons and 272,461 unique scoring lines. See
[data provenance and limits](../data/time-league/REGULAR-SEASON-DATA.md) and the
manifest: 1970–1998 corpus has missing fumbles/two-point statistics; nflverse
1999–2025 is REG-filtered; K/DEF start in1999; documented exclusions remain.
Counts prove internal archive consistency, not independent certification of
every historical fact.

Scoring remains `TimeLeagueSeason.scoreStatLine` / `gamePoints`, including
custom weights, bonuses and optional era factors. Starter and team totals use
two-decimal precision. Regular ties stand; playoff ties go to the higher seed.
New recap presentation uses saved totals and starters, never future game draws.

### Save compatibility and recovery

The existing save version, scoring version, historical assets and settled outcomes
are unchanged. New shelf metadata, the recovery-week field described below and
the three per-team milestone counters are optional; old saves and indexes still
open. Both plain JSON and
checksummed compressed saves remain readable. Unknown/unreadable saves are
kept and receive recovery feedback; they are never reset automatically.

Milestone normalization takes the largest valid stored/current value and each
own saved starter cohort separately. It never combines different weeks or
ownerless player-production snapshots into an imagined roster. Distinct saved
waiver awards and current legacy waiver entries provide conservative evidence;
each new successful award increments the retained count once. Pre-action proof
is captured before a trade/drop, including before the first saved game. No
view-only achievement write or database migration is required. Missing historical
bench/between-game evidence from before this release cannot be reconstructed and
is not invented. Friends play requires the matching shared authoritative runtime
when this branch is eventually published; no hosted rollout is part of this work.
Sealed draft public snapshots omit all three counters. Active Hidden Years uses
public decades, with exact-year fallback only after the existing year reveal.

Each local view now carries its own durable snapshot token. A changed/deleted
save is rejected before either shelf or game writes. **Load latest save** reads
the committed state and discards the rejected action; **Return to saved seasons**
allows leaving a missing/unreadable conflict without overwriting anything.
Recovery hides disabled gameplay overlays, releases native top-layer dialogs,
and focuses the recovery alert. Ordinary storage failures retain **Retry save** / **Keep previous save** and the
existing clock-preserving quota recovery. Browser Web Locks serialize cooperating
local saves; browsers/older clients without these locks retain optimistic checks,
not a cross-device transaction guarantee. Held-lock and room-switch fixtures
prove a delayed action cannot reopen a room that was left.

### Run and inspect

The local preview is running at `http://127.0.0.1:3037/?vault=1`. Its localhost
banner/identity is the repository's existing development behavior. To restart:

```sh
cd /Users/jacobc/Projects/work/warroom-vault-experience-20261021
node scripts/serve-static.cjs --port=3037 --compile
```

Dependencies and the exact workflow-pinned shared runtime (`74d6369`) were
prepared locally. A clean copy of that Git revision is at
`/tmp/vault-shared-20261021`; no dirty shared checkout was consumed.

```sh
SHARED_SOURCE=/tmp/vault-shared-20261021 npm run build:preview
npm run test:timeleague
npm run test:core
npm run test:first-class
```

True signed-out browser acceptance uses the separate local server below.
The Chromium harness maps only `vault-qa.test` to127.0.0.1; it does not use a
live hostname, account or save. Its route guard intercepts backend mutations;
analytics may receive a synthetic local response without transmitting data.

```sh
node scripts/serve-static.cjs --port=3038 --compile --allowed-hosts=vault-qa.test
# In a second terminal:
node tests/vault-experience-journey.cjs
node tests/vault-experience-journey.cjs --acceptance-only
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-experience-journey.cjs --webkit-smoke
```

The WebKit executable override matches this host's installed runtime; another
machine should use its own installed compatible runtime. Both browsers are
emulation, not physical devices. The actual controls cover a two-team compact
All-Era snake league; shared-engine/endpoint tests additionally cover other
formats, Position Roulette, custom scoring, larger leagues and permissions.
No new mode or multiplayer-support claim follows from these fixtures.

### Verification evidence and limitations

Evidence is under `output/playwright/vault-experience/` in this worktree:

- `verification.json`: PASS,7 journey groups and41 screenshots,38 intercepted
  backend mutation requests, zero page exceptions; actual hub/direct entry, setup and draft, legal roster,
  two-tab conflict, focus/hit-tested recovery, game day, stable final, advancement,
  fixture-assisted 14-week completion, career and saved-record resume.
- `acceptance-verification.json`: PASS,2 groups,12 intercepted requests, zero
  page exceptions; actual rival reply persistence and stale
  native-waiver-dialog recovery. No duplicate message or overwritten newer save.
- `webkit-verification.json`: PASS,1 group,2 screenshots,7 intercepted requests;
  390×844/430×932 phone controls, reduced motion,
  More-dialog Escape/focus return, legal roster swap, lock/game day/instant,
  enlarged text and reload. One explicitly recorded blocked-analytics CORS error
  comes from the isolation guard; no other application exception was accepted.
- `home-layout-verification.json`: long names separated at all five sizes,
  text-only125% font enlargement and no horizontal overflow. Default theme was
  inspected. Light mode is disabled upstream and is not claimed as verified.
- `baseline-suite.log`, `final-suite.log`, `final-build.log`, `core.log` and
  `entry.log`: original/final automated checks. Changed runtime JS passed ESLint;
  `git diff --check` passed.

Representative screen pairs: `before-lobby-390.png` / `after-lobby-390.png`,
`before-draft-1440.png` / `after-draft-1440.png`; final
`after-recap-390.png`, `after-complete-1440.png`,
`home-name-fix-enlarged-390.png`. The Chromium matrix uses390×844,430×932,
1024×1366,1366×1024 and1440×900 for lobby, draft, Home, roster, ready game day,
recap and completion. Setup additionally has390/1440 captures. Baseline captures
used local development identity; supporting Home/roster/game-day baselines were
reconstructed from exact baseline sources and their provenance is recorded; the final core journey verifies the actual
signed-out path without that bypass. No user's live progress was used.

The full historical fixtures run92 saved/reloaded actions per12-team,
156-pick season in legacy, full-game-deck and Hidden Years scenarios; scoring,
source-game uniqueness, AI legal rosters and playoff advancement reconcile.
Storage compatibility separately covers88 durable actions,14-week completion,
quota compaction, corrupt records and unrelated-data preservation. No new AI or
simulation strategy was introduced and no enjoyment/performance claim is made
from those checks.

Known pre-existing check failure: `node tests/design-tokens-contract.js` is3/4,
with two hardcoded8px radius literals in unchanged `js/free-agency.js` at the
baseline revision. `design-tokens-known-failure.log` records it; unrelated
Free Agency was not modified. Existing compiler size notes/Node localStorage
warnings are recorded in the logs. No source-data certification, offline test,
physical-device test, production performance test or hosted multiplayer session
was performed. Nothing was pushed, merged or deployed.

### Prioritized future work

1. Run a real hosted multi-account invitation/draft/reconnect/conflict session
   before widening friends-play claims; preserve server-owned disclosure.
2. Physically test Safari/Android touch, text scaling and screen-reader flow;
   observe human default-season pacing and whether newcomers return.
3. Plan save export/backup and unattended room advancement as separately scoped
   features; do not promise cross-device solo restoration or offline progression.
4. Address the existing unrelated design-token failure and duplicate roster
   preset label separately. Historical gaps stay documented; corrections require
   evidence and an explicit active-save compatibility decision.

### Follow-on slice: decision evidence

Continued from clean checkpoint `1750851` at the user's request. This finite
slice completes explanations within existing play; no new mode, scoring rule,
save schema, backup system or deployment is included.

| Requirement | Status | Acceptance |
|---|---|---|
| Saved-player scoring receipt and direct recap link | VERIFIED | Actual Home link opens/focuses the exact saved archive, own team first; keyboard-expandable recorded stats × league weights, bonuses, rounding and saved era factor reconcile to committed points; no-record, missing statistics and older mismatches remain explicit |
| Gap-only lineup action | VERIFIED | Fill empty slots explains its existing limits, disables full/no-compatible/locked states, preserves occupied starters and confirms named moves; actual Move→Fill→reload plus repeated-tap/save-failure fixtures |
| Hidden Years AI availability | VERIFIED | Rivals demote an explicitly known current no-game choice using the same coarse clue as the human roster; unknown/stale clues retain existing persona estimates; 36 deterministic legal lineups and private-data getter traps |
| Default Roulette and alternate draft controls | VERIFIED | Actual reveal/reload and 24-pick two-team standard Hidden Years Roulette draft; 12-pick linear and 12-lot auction, including paused-lot reload, legal human bid and budgets; nomination copy now matches Hidden Years |
| Integrated regressions and rendered receipt | VERIFIED | 67-command Vault suite, 160-script build, exact 272,473 scorer comparisons, prior saved-result regression, five-size Chromium receipts and WebKit phone controls; expected isolated telemetry errors recorded separately |

The prior finished release remains intact. Regular-season bye scoring/readiness
semantics are retained; a broader readiness redesign stays future work.

#### What changed for the player

The recap's **Scoring & box scores** action opens its saved week directly and
focuses the archive. Your matchup and team appear first. Each saved starter
expands in place to show recorded production, applicable rates, reached bonuses,
rounding and the saved era adjustment. Saved points remain authoritative even
when an older result lacks statistics or its original scoring context no longer
reconciles. A no-record game is distinct from unavailable statistics and from a
recorded zero. Historical coverage warnings remain visible. The link cannot
bypass pending/unfinished first playback or disclose a later result, and closing
the archive stays closed until another explicit request.

**Fill empty slots** now says what it does, disables an impossible/no-op action,
preserves existing starters, rejects repeated in-flight taps and reports saved
names or a recoverable failure. Existing scouting warnings offer **Compare
replacements** through the real legal Move sheet. This is not a new projection
or persistent automation. Hidden Years rivals now avoid an explicitly known
current no-record player when a legal replacement is available; their established
persona estimates still rank other options. Human decisions and settled results
are unchanged.

#### Rules, saves and evidence

No historical records, scoring weights, randomness, save schema, unlocks or
settled outcomes changed. The scorer's weights/bonus predicate are shared with
the receipt rather than maintaining a screen-specific formula. Exact output
parity against checkpoint `1750851` passed for all 272,461 source scoring lines
and 12 custom cases (bonuses, negative points, overrides and group rounding).
Opening a receipt performs no save. Existing plain/compressed save and complete
season tests still pass. The AI correction affects future lineup preparation
only; no resolved game is repriced or replayed.

Follow-on evidence is in `output/playwright/vault-next/`:

- `verification-core-variants.json`: PASS, 7 groups, 29 screenshots, 75 intercepted
  writes, zero page exceptions. Actual two-team standard Roulette draft and
  compact linear/auction drafts; first game/instant/reload; fixture-assisted
  scoring and Move/Fill checks. The six-team default was not fully drafted in
  this browser run. `verification-auction.json` separately records a real human
  bid after AI consideration and paused-lot reload.
- `verification-scoring-score-link.json`: PASS, 3 groups, 13 screenshots, 17
  intercepted writes, zero page exceptions. Final recap link, correct saved
  week, scroll/focus, own team first, no automatic reopening and stable results.
- `verification-webkit.json`: PASS, 4 groups, 14 screenshots, 25 intercepted
  writes; receipt, disclosure, enlarged text, gap-fill, reload and recap-link
  phone acceptance. Both browsers use disposable local saves and intercepted
  writes. WebKit's two expected blocked analytics CORS errors are listed
  separately; zero unexpected application exceptions were accepted.
- `scorer-parity-result.json`, `scorer-parity.cjs`, `scorer-parity.log`: exact
  baseline/current source and archive hashes, comparison counts and reproducible
  scorer check. This is calculation parity, not certification of every source
  fact or proof of gameplay enjoyment.
- `final-suite.log`, `final-build.log`, `regression-browser.log`: integrated
  checks and the first slice's complete signed-out journey regression. Focused
  receipt/AI/roster tests are now part of `npm run test:timeleague`; live-matchup
  tests also cover wrong-room, future/undisclosed-week and first-playback guards.
- `../vault-next-slice/fill-slots-verification.json`: independent roster review,
  full/partial/no-candidate states and reload at 390/1440.

Representative comparisons: `scoring-archive-before-390.png` versus
`scoring-receipt-detail-390.png`; desktop `scoring-receipt-detail-1440.png`;
direct-link `score-link-390.png`; `lineup-gap-390.png` versus
`lineup-filled-390.png`. Receipt layout was inspected at 390×844, 430×932,
1024×1366, 1366×1024 and 1440×900. WebKit is phone emulation at 390/430,
including 125% text, native details and real Move/Fill controls. No physical
device, hosted multiplayer, offline or performance-improvement claim is made.
The documented pre-existing unrelated design-token failure remains.

With the 3038 isolated server above running:

```sh
node tests/vault-next-journey.cjs --roulette --linear --auction --scoring --fill
node tests/vault-next-journey.cjs --scoring --score-link
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-next-journey.cjs --webkit --scoring --fill --score-link
node output/playwright/vault-next/scorer-parity.cjs
```

The first command creates disposable fixtures for the targeted follow-ups.
Browser artifacts stay in the existing ignored output directory; no account,
invitation, live room or user's progress was used. The preview remains at
`http://127.0.0.1:3037/?vault=1`. No push, merge or deployment occurred.

### Continued slice: kickoff readiness and unpaired results

Continued from clean checkpoint `fc10c31` at the user's request. The finite
scope is existing lineup readiness and accurate regular-bye/playoff-observer
presentation. A regular bye still scores PF/all-play and requires a legal
lineup. A team outside a playoff round does not block it. No rule, save schema,
historical data, replay persistence system or multiplayer permission changes.

| Requirement | Status | Completion criteria |
|---|---|---|
| One shared participation/readiness contract | VERIFIED | 10 known fixtures; Actions and UI share required-human-team and slot legality calculation, including regular byes and playoff observers; malformed schedules remain unknown |
| Actionable kickoff readiness | VERIFIED | Named blockers, direct local hotseat repair, authorized reopen after successful save, nonblocking current no-game advisories; 9 focused gate/profile cases retain role, early-vote, timed, save and auth behavior |
| Accurate Home and saved unpaired results | VERIFIED | Actual three-team bye PF/all-play/H2H calculations, live solo lineup and saved receipt; no false playoff Bye or invented observer score; first pending playback frame contains no final |
| Compatibility and interactive verification | VERIFIED | 70-command suite, 160-script build, Chromium and WebKit flows, final keyboard focus and measured-navigation full-target checks pass; hosted/physical boundaries unchanged |

First-playback interruption preserves the same committed outcome. Animation
position is not restored; a saved final remains available for replay.

#### Integrated behavior and compatibility

`weekParticipation` and `lineupReadiness` are derived engine reads, with no new
saved fields. Regular byes require legal human starters because those points
count toward points for and all-play. An observer outside the current playoff
pairings does not block that round. Missing/partial schedules remain unknown,
without weakening regular-week validation. Saved past matchups take precedence
over reconstructed schedules. No-record starters remain legal: the roster names
confirmed current zero-game choices and opens the existing Move comparison,
without treating unknown or stale reports as zeros.

The fixed week controls name real blocking teams before lock/kickoff. Local
hotseat repair selects that exact manager; online managers can only review their
own seat. A locked invalid lineup has a direct authorized **Reopen lineups**
action, and failed saves do not pretend to reopen it. Majority voting can still
record an early vote; it does not bypass authoritative lineup validation.
Readiness details close by button or Escape and return focus to their summary.
The existing server force behavior is preserved, not exposed as a new bypass.
Mobile navigation reserves its actual measured height, including wrapped
enlarged labels and safe-area padding, so it cannot clip the week-action touch
targets. This presentation measurement has no saved game-state fields.

Home, live playback, saved box scores and team history now distinguish a real
regular-season bye from a playoff observer or unknown schedule. Every saved
unpaired team result has reachable starter receipts, shown first for its owner.
No opposing lineup, win marker or observer score is invented. During first
playback, bye points follow landed scoring moments. The initial render before
the playback effect now shows only a preparation status, preventing a brief
saved-final/archive disclosure. Identified-year tests cover this initial frame,
unfinished playback and normal/replay/final disclosure.

No migration, historical-data edit, scoring change or outcome correction is
needed. Existing plain/compressed save, stale-tab recovery, complete-season and
authoritative endpoint checks pass. An interrupted first playback reloads the
same committed final, with Replay available; animation position is not restored.
Repeated End week input advances once and does not grant another result.

#### Verification and inspection

Follow-on checks and before/after evidence are under
`output/playwright/vault-readiness/`:

- `baseline.json`: 4 behavior/integrity checks and 14 captures, using exact
  `fc10c31` source overrides with disposable fixtures. It records the incorrect
  playoff-bye copy and confirms pre-existing settled-result integrity.
- `verification.json`: PASS, 6 scenarios, 11 checks, 60 viewport captures,
  36 intercepted writes and zero page exceptions; real controls for interruption,
  scoring bye, playoff observer, another missing human manager, legal no-record
  starter and locked legacy repair. Final after images use viewport captures;
  full-page baseline stitching can repeat fixed headers and is not evidence of
  duplicate application roots.
- `webkit.json`: PASS, the same 6 scenarios and 11 checks, 28 phone captures,
  30 intercepted writes and zero unexpected exceptions. Two expected denied
  analytics CORS errors are recorded separately. This is browser emulation,
  not a physical Safari session.
- `verification-safe-area.json` / `webkit-safe-area.json`: PASS, 9 viewport/text
  states and 9 captures each, 5 intercepted writes, zero page exceptions. Full
  44px action targets stay above navigation at 390/430 normal and 125% text,
  667×375 short landscape, 740×390 tablet navigation and phone return. Desktop
  restoration removes the mobile reserve and keeps its existing controls fully
  visible (the existing desktop More control is 40px wide). Actual navigation heights include 75px normally
  and 90px at enlarged phone text. These emulated geometry checks do not test
  physical device cutouts; separate `final-*-safe-area.log` files record them.
- `final-suite.log`, `final-build.log`, `lint.log`: 70-command Vault suite,
  160 compiled scripts and changed-runtime ESLint. `gate-focus.log` records the
  final 9-case keyboard/role/profile check after the last focus-handler edit.
  `nav-lint.log` and targeted integration/playback/recovery/guest checks cover
  the final navigation-measurement edit; it adds no game-state transition.
- `core-browser.log` and `core-browser-verification.json`: PASS, 7 journey groups
  and 41 captures; regression through
  actual signed-out hub/direct entry, draft, roster, conflict recovery, game day,
  saved recap, next-week advancement and fixture-assisted 14-week completion.

Representative images: `before-bye-recap-390.png` /
`after-bye-scoring-receipt-390.png`, `after-missing-other-manager-390.png`,
`after-legal-no-record-starter-390.png` and
`after-observer-ready-home-1440.png`. The Chromium matrix uses all five requested
sizes (390×844, 430×932, 1024×1366, 1366×1024, 1440×900). Browser sessions use
loopback fixtures and intercept writes; they establish neither hosted
multiplayer nor physical-device behavior. The prior unrelated design-token
failure remains outside this scope. No push, merge or deployment occurred.

With the same isolated preview servers above running:

```sh
node tests/vault-readiness-journey.cjs
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-readiness-journey.cjs --webkit
node tests/vault-readiness-journey.cjs --safe-area
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-readiness-journey.cjs --webkit --safe-area
```

The shared engine fixtures, unpaired presentation and gate/profile checks are
included in `npm run test:timeleague`. Remaining priorities are the hosted
multi-account and physical-device acceptance already listed above, human pacing
observations, and separately scoped backup/export work.

### Continued slice: acquisition decisions and settlement

Continued from clean checkpoint `b9dbf36` at the user's request. This finite
slice completes existing waiver/trade transactions and their explanations.
Baseline reproduction found reused canceled claim IDs, a human trade that
could strand the final lineup gate, misleading quarterback-cap save errors,
conflicting archive/Vault points labels and silent trade-response outcomes.
No new acquisition system, economy, reorder mechanic or historical data.

| Requirement | Status | Completion criteria |
|---|---|---|
| Durable transaction identities and stale offers | VERIFIED | 14 integrity cases and actual endpoint: cancel/refile/reload/new-week IDs cannot alias; ownership-invalid pending offers withdraw once; settled history remains intact |
| Shared public preflight and roster feasibility | VERIFIED | Exact waiver QB/drop/budget reasons; both post-trade rosters can fill configured starter/reserve slots before acceptance; hidden-field traps; independent 2,000-case matching oracle |
| Choose, commit and see the outcome | VERIFIED | Actual ordered/reserved claims, shared-drop resolution, duplicate actions, stale-tab cancel/reload, one-time charges; immediate roster receipt, recorded outcomes and working lineup actions in both browsers |
| Honest comparison and disclosure | VERIFIED | Archive pool versus estimated Vault remainder labeled; unknown values remain unknown; reference/league scoring and observed/candidate averages disclosed; private-year comparison oracle and UI fixtures pass |
| Integrated compatibility and browser acceptance | VERIFIED | 72-command Vault suite, final 12-case UI suite, core97/97, shared-mode7/7, source lint and 160-script build pass; 7 scenarios in Chromium and WebKit, five-size Chromium matrix and WebKit phones |

Priority, FAAB ordering, sealed-year rules and scoring remain established rules.
The acceptance repair prevents a verified unrecoverable lineup state; it does
not auto-select human starters or change proposal/negotiation rules. Substantial
backup, multiplayer replacement and new progression systems stay future work.

Claim IDs still use numeric `wN` order. New submissions retain their sequence in
the existing durable activity IDs, including a legacy high pending-ID watermark;
cancellation/settlement cannot recycle the intent. No save field or migration
was added. Pending offers whose assets move or leave their original roster use
the existing `withdrawn` status after settlement or another accepted trade.
Already accepted/rejected history is preserved. A legal human exchange still
places incoming players on the bench and leaves the lineup decision to its owner.
IR/TAXI moves remain available; only an otherwise-invalid AI assignment uses a
shared public slot plan to repair those seats. Normal AI values and difficulty
are unchanged. Scoring, data, rewards, budgets and priority rules are unchanged.

Known pre-existing defect: a save containing an **already accepted** trade that
removed the team's only required position can still be stuck at the lineup gate.
This pass prevents new impossible acceptances and validates old pending offers;
it does not silently reverse settled trades or reopen acquisition gates. A
deliberate recovery flow was still missing at this checkpoint; the continued
recovery slice below now addresses it through the existing acquisition rules.

Focused checks are `tests/time-league-acquisition-integrity.js` (14 cases),
`tests/time-league-acquisitions-ui.js` (12 cases), and the actual mocked
authoritative handler in `tests/time-league-public-endpoint.cjs` (latest-version
stale cancellation, impossible acceptance, recipient authorization, reconnect and
repeat processing). The two new suites are part of `npm run test:timeleague`.
The existing full-season checks each completed 92 serialized/reloaded actions
through a 12-team, 156-pick Roulette championship, including Hidden Years.

Evidence is under `output/playwright/vault-acquisitions/`. Baseline
`verification-waivers-trade-hidden.json` records 3 actual-control groups,
35 screenshots and 37 intercepted mutations on exact `b9dbf36`. The independent
matching oracle and seed/sample bounds are in `independent-review/`; it is
reproducible with `node output/playwright/vault-acquisitions/independent-review/feasibility-oracle.cjs`.
Logs: `full-suite.log`, `core.log`, `entry.log`, `lint.log`, `build.log`, and
`acquisitions-ui-final.log`. After the final dialog/copy changes, the affected
12-case UI suite, source lint, build and browser controls were checked again.
These are local code/fixture/browser evidence;
authenticated hosted rooms, physical devices and deployment remain unverified.

The rendered pass also corrected a native-dialog focus race on **Review pending
claims** and kept its named legality reason beside the sticky File claim action.
The own queue does not infer rival activity from a private online snapshot.
Trade receipts name their saved week and managers, preserve real player names
from existing draft/result records after a release, and label an unrecorded
player honestly. A new pending offer cannot appear to inherit an old acceptance.
Locked or completed stages offer **View lineup** rather than a repair prompt.

The current native-dialog regression also passes: `native-dialog-acceptance.json`
records two actual-control groups and 18 intercepted mutations, with no page or
route errors. The old recovery fixture now selects a legal same-position drop
before advancing the other tab, so it exercises a stale **valid** claim rather
than the newly disabled quarterback-cap case. Save recovery still closes the
native dialog, preserves the newer save and returns to Home to review progress.

Final browser evidence:

- `verification-preflight-waivers-shared.json` and
  `verification-trade-impossible-stale-hidden.json`: seven Chromium scenarios,
  nine recorded checks, 59 viewport screenshots and 69 intercepted writes;
  zero page/route errors.
- `webkit-preflight-waivers-shared.json` and
  `webkit-trade-impossible-stale-hidden.json`: the same seven scenarios,
  nine checks, 32 viewport screenshots and 57 intercepted writes; zero unexpected
  page/route errors. Five explicitly classified blocked-telemetry CORS messages
  remain in the evidence; they are not counted as clean raw browser output.
- Chromium sizes: 390×844, 430×932, 1024×1366, 1366×1024 and 1440×900.
  WebKit uses the two phone sizes. Both cover 125% text, native Escape/focus,
  reachable 44px primary actions and saved-state reloads. Tablet/desktop receipts
  were visually inspected. This is browser emulation, not a physical-device test.
- Hidden Years comparisons hold public candidate estimates, research and
  comparison basis constant when only private assignments change. Existing public
  current-week rating/availability clues may legitimately change and are recorded
  separately; the oracle does not pretend those clues are secret.
- One WebKit diagnostic hung while closing the recovered extra test tab, after
  its save assertions passed. The final run retained that disposable tab until
  successful context/browser cleanup; `cleanupNotes` and the API log record this.
  No gameplay action was omitted. Exploratory failed harness attempts and scroll
  diagnostics remain under `attempt-*` / `scroll-diagnostic-*`.

Representative screens in this evidence folder: `after-quarterback-cap-reason-390.png`,
`after-pending-order-reservation-390.png`, `after-immediate-waiver-roster-390.png`,
`after-waiver-outbid-receipt-1024.png`, `after-trade-accepted-receipt-1440.png`,
and `after-hidden-trade-fairness-430.png`. The before captures above are retained.

Run against the same isolated 3038 preview described earlier:

```sh
node tests/vault-acquisitions-journey.cjs --preflight --waivers --shared
node tests/vault-acquisitions-journey.cjs --trade --impossible --stale --hidden
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-acquisitions-journey.cjs --webkit --preflight --waivers --shared
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-acquisitions-journey.cjs --webkit --trade --impossible --stale --hidden
node tests/vault-experience-journey.cjs --acceptance-only
```

---

### Continued slice: recover an unfillable roster

Continued from clean local checkpoint `082a06f`. A historical accepted trade, or
a current waiver batch that replaces the sole required position, can leave a
human roster unable to reach kickoff. Reopening lineup assignments cannot acquire
the missing player. The release adds a deliberate return to the existing planning
gate for that condition, rather than reversing a settled transaction.

| Requirement | Status | Completion criteria |
|---|---|---|
| Detect the actual recovery condition | VERIFIED | Public slot feasibility distinguishes an unfillable required human roster from a movable bench gap; regular byes qualify, playoff observers and scored weeks do not; 11 focused engine/action cases |
| Authoritative bounded transition | VERIFIED | Actual endpoint commissioner/human-seat checks, unscored lineup/ready gates, stale/repeated actions, reconnect and existing gate clock/vote reset |
| Preserve progress and fair settlement | VERIFIED | Local/public marker round trips; exact prior results/trades/awards/budgets/editions; no repeated automatic AI acquisition or refresh, normal behavior next week |
| Explain and complete the repair | VERIFIED | Actual Chrome confirmation/cancel/keyboard/failure/retry, correct enabled acquisition route and local manager, real RB replacement, legal lock, saved Week2 and advance to Week3 |
| Integrated verification | VERIFIED | 74-command Vault suite, final12-case UI/9-case readiness checks, real mocked endpoint, Chromium five-size matrix, WebKit phones, core97/entry7, ESLint and160-script preview build |

The remedy reuses priority/FAAB and trade rules. It does not guarantee a particular
free agent, refill funds, roll another edition, or bypass bidding. A legitimate
multi-claim plan may temporarily lack a position and remains legal. Leagues with
both acquisitions disabled receive an honest explanation; recovery does not
silently enable a disabled mechanic. Hosted accounts and physical devices remain
outside the local evidence boundary.

#### Player journey and compatibility

Home, the roster and week actions distinguish an unfillable roster from an
eligible player sitting on the bench. **Reopen planning** explains what stays
final before the commissioner confirms. Local hotseat play selects the affected
human manager; online rooms retain the viewer's own seat. Waiver-enabled rooms
open Players; trades-only rooms open the existing trade builder. Failed saves
keep the prior stage and expose the existing retry/recovery controls.

The reopened window follows the existing priority, bidding, eligibility and
trade-acceptance rules. Computer managers do not submit a second automatic
waiver batch or generate extra offers; pending claims and manually negotiated
offers still resolve normally. Same-week awards are labeled **Week N waiver
results**, including the recorded recap, because the existing ledger aggregates
by week. No fictitious batch history is introduced.

`planningRecoveryWeek` is optional in the existing version1 local/public save
contract. No destructive migration, historical-data correction, scoring change,
budget reset or replacement edition is involved. Reload and Retry retain the
same committed window. The marker becomes inactive when the current week
advances, restoring normal computer acquisitions. Unknown saves still use the
existing non-destructive recovery path. An older client that rewrites a local
save does not understand this new marker; use this build when continuing an
opened recovery window.

#### Verification and remaining limits

The tracked `tests/time-league-planning-recovery.js` covers 11 focused cases:
legacy accepted-trade recovery, a current legal waiver that removes the sole
required position, valid multi-claim plans with a temporary gap, authority,
stage/scored-week guards, regular byes, playoff observers, hidden-data getter
traps, optional field round trips, pending claims, no repeated automatic
acquisitions, and real AI trade responses. The 12-case UI suite additionally
checks confirmation, duplicate taps, failed saves, member/disabled explanations,
Escape/focus return, mutually exclusive footer disclosures, enabled acquisition
routes and exact same-week receipts. The final focused UI/readiness checks ran
after correcting an observed overlap that had covered the roster review action.

The actual mocked public endpoint test exercises version conflicts, unauthorized
and repeated reopening, reconnect, a real replacement claim, preserved budgets,
awards/trades and Week1 result, legal lineup lock and a saved Week2 result. This
is the real endpoint implementation with an isolated backend, not live hosted
multi-account proof. An independent read-only review also checked direct,
majority and timed settlement paths; all reuse the recovery marker correctly.

Evidence is under `output/playwright/vault-recovery/`. The baseline reconstructs
an accepted position-breaking trade with the older `b9dbf36` engine, then loads
it through current normalization; it does not use user progress. The acceptance
fixture first spends7 FAAB and scores Week1 normally. Actual browser controls
then reopen Week2, acquire an RB for7 from the remaining93, lock a legal lineup,
save Week2, reload, and advance once to Week3. The previous award, result and
accepted trade remain exact. Separate controls cover trades-only routing,
both-acquisitions-disabled explanations, movable bench gaps and a genuine local
quota failure followed by **Retry save**.

Final browser evidence:

- `verification.json`: Chromium PASS,9 journey groups,47 viewport screenshots,
  43 intercepted backend writes, zero page/route errors. Recovery, its reopened
  window, repaired lineup and saved result were inspected at390×844,430×932,
  1024×1366,1366×1024 and1440×900.
- `webkit-verification.json`: WebKit PASS,9 groups,26 screenshots,37 intercepted
  writes, zero unexpected page/route errors;390×844/430×932 phones,125% text,
  reduced motion, keyboard/focus and actual touch-sized controls. Four narrowly
  classified blocked-telemetry CORS messages are retained separately.
- `baseline-verification.json`: exact `082a06f` sources reproduced the blocked
  lineup/ready states with8 baseline captures; provenance is recorded alongside
  the disposable fixtures. No user's saved season was used.
- `final-suite.log`: all74 Vault commands passed, including the real endpoint,
  historical archive and full-season reload fixtures. `final-ui.log` and
  `final-readiness-ui.log` pass after the final disclosure repair. `core.log`
  is97/97; `entry.log` is7/7. Source ESLint and `git diff --check` pass.
- `final-build.log`: clean workflow-pinned shared input,160 Babel scripts
  compiled successfully. Existing large-source compiler notes and Node
  localStorage warnings remain; no runtime dependency or asset was added.

Representative actual captures are
`before-legacy-lineup-blocked-390.png`,
`after-recovery-lineup-confirmation-390.png`,
`after-recovery-ready-enlarged-confirm-390.png`,
`after-recovery-lineup-open-window-1440.png`,
`after-recovery-repaired-roster-430.png` and
`after-recovery-week2-saved-result-1440.png` in the evidence directory. These
are local browser emulation; physical devices and hosted accounts remain
unverified. `overlay-probe.json` retains the concrete issue found before its
fix; both final browser summaries verify the corrected controls.

Run the browser acceptance with the isolated preview described above:

```sh
node tests/vault-planning-recovery-journey.cjs
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-planning-recovery-journey.cjs --webkit
```

Recovery is available only before kickoff when an enabled acquisition system
can be used. A custom pool without an eligible replacement, an insufficient
budget or an unwilling trade partner can still prevent repair. Existing rules
are not silently changed to guarantee a result. Hosted multiplayer acceptance,
physical-device testing, backup/export and unattended advancement remain the
prioritized future work listed above.

---

### Continued slice: mobile decisions and replacement continuity

Continued from clean checkpoint `71c273f`, applying the user's approved lessons
from the recent Dynasty HQ mobile work. The finite slice places the existing
trade brief and selected package before long player lists, carries an explicit
replacement intent from roster browsing into a legal claim, and compacts mobile
player rows without concealing decision evidence or reducing action targets.
The existing archive identity, hidden-season rules and four-stage loop remain.

| Requirement | Status | Completion criteria |
|---|---|---|
| Reversible baseline | VERIFIED | Exact `71c273f` disposable browser: 12 captures, 35 intercepted requests to mutation endpoints, zero errors; roster/wire row heights and trade brief position measured at 390/430/1440; prior passing checkpoint retained |
| Trade decision visible before browsing | VERIFIED | Actual multi-player selection/removal, upfront public totals/basis, current roster checks and bench consequence at all five sizes plus short landscape; Send→reload→normal gate→human acceptance→legal saved rosters |
| Preserve replacement context | VERIFIED | 22 focused UI cases and controller boundaries; actual named handoff, incompatible target, manual/clear/pending precedence, 7 FAAB settlement, scored game/reload and team/week/room navigation; independent mounted-form stale callbacks produce zero writes |
| Compact usable player rows | VERIFIED | Exact-fixture 390px roster 136.44→117.73px median, 5 full rows vs 4; phone wire 250.73→181.27px, 3 choices vs 2; all five requested sizes plus 667×375 have reachable 44px actions and no horizontal overflow |
| Integrated acceptance | VERIFIED | 75-command Vault suite, final focused 22-case UI follow-up, core 97/entry 7, source lint and independent stale-form retest pass; Chromium and WebKit connected journeys pass; pinned preview build compiles 160 scripts |

Replacement context is temporary navigation state, separate from saved game
progress. It does not introduce claim editing/reordering, forecasts, new scoring,
new data, or any automatic acquisition. All consequential actions still use the
existing validator and persistence path. Publication remains outside this pass.

#### Behavior and compatibility

The trade builder now leads with its public comparison, current roster checks,
both selected package totals and names, removable selections, and the existing
received-player bench consequence. Both player lists remain available below;
the longer explanation expands separately. This changes presentation, not
proposal/acceptance rules or the existing comparison calculation. Missing or
incompatible evidence cannot generate a grade. No NFL projection model or
acceptance probability is imported from the Dynasty HQ platform.

**Find eligible players** carries the source slot and optional owned player into
the wire. The next new target can preselect that drop only when the shared
landing validator permits it. The wire names the replacement and keeps the
final Add/Drop/Bid confirmation explicit. A manually selected drop/bid or an
already-filed claim takes precedence. **Clear replacement context** removes an
untouched automatic suggestion and preserves deliberate edits and the current
position filter. Clearing returns keyboard focus to free-agent search. Browse,
clear and comparison controls make no game write.

Room, manager and week boundaries apply to both the source context and its
filter. A mounted automatic preset expires across those boundaries, even
without closing the modal; its old or disabled callbacks cannot file it.
Filing rechecks current free-agent ownership, shared claim validation and
landing legality. The independent review reproduced a stale-week automatic
drop before the fix and confirmed zero writes from both old and current
callbacks afterward. Existing save conflict/quota/retry handling remains in
use. No save schema, rules/data version, historical asset or settled result
changed; navigation context is intentionally absent after a full reload.

The compact roster shows decade and candidate count for an unresolved edition;
the full hidden-year description remains connected to its history control for
accessible text. An identified year still displays exactly. A waiver row removes
only a duplicate hidden-year remaining estimate when its displayed value agrees;
an unused-archive total and a different Vault estimate remain distinct. Actual
sample/basis/uncertainty information stays available through the existing public
readers and details. Names and numbers are not made smaller to claim density.

#### Measured layout evidence

`output/playwright/vault-mobile-decisions/baseline-verification.json` pins the
before sources to `71c273f`. Final captures use the same disposable fixtures,
fresh viewport mounts and measured sticky-header/footer boundaries. Median row
heights and completely visible rows in the standardized useful viewport:

| Surface / size | Before → after median | Full rows before → after |
|---|---|---|
| Roster 390×844 | 136.44→117.73px | 4→5 |
| Roster 430×932 | 122.97→117.73px | 5→5 |
| Roster 1440×900 | 77.30→77.80px | 9→9 |
| Wire 390×844 / 430×932 | 250.73→181.27px | 2→3 |
| Wire 1440×900 | 135.69→135.69px | 5→5 |

The phone roster median is about 14% shorter at 390px; wire rows are about 28%
shorter. Desktop density is essentially unchanged while the scoring basis is
explicit. This measures layout, not task-completion speed or enjoyment. The
trade brief's improvement is its placement before both lists; the complete trade
page is not claimed to be shorter. The first measured pass made roster rows
slightly taller; repeated copy and duplicate displayed estimates were corrected
before these final measurements.

#### Verification and inspection

Run the source preview from this isolated worktree with
`node scripts/serve-static.cjs --port=3037 --compile`, then open
`http://127.0.0.1:3037/?vault=1`. Local saves stay in that browser and origin.

The repeatable browser harness uses a separate, signed-out fixture origin:

```sh
node scripts/serve-static.cjs --port=3038 --compile --allowed-hosts=vault-qa.test
node tests/vault-mobile-decisions-journey.cjs
node tests/vault-mobile-decisions-journey.cjs --webkit
```

The harness maps that origin locally, installs disposable fixture saves, and
intercepts every request to a mutation endpoint. It does not use an existing
user's progress. Chromium checks all five requested viewport sizes and
667×375; WebKit checks the two phone sizes. Browser emulation is separate from
physical-device, real-account, production and concurrent multiplayer evidence.
Those remain unverified. No deployment was performed.

Evidence is retained under `output/playwright/vault-mobile-decisions/`:

- `baseline-verification.json`: exact before sources and 12 captures.
- `density-verification.json`: final six-size matrix and 12 captures.
- `verification.json`: two connected Chromium journeys, 27 captures, no page or
  route errors; claim settlement, saved game, human trade response and reloads.
- `trade-verification.json`: focused multi-player trade matrix and seven captures.
- `clear-focus-probe.json`: actual Space activation returns focus to the fully
  visible, unobstructed search field; RB filter retained and no pending claim.
- `webkit-verification.json`: three passing groups, 18 captures and 21 actual
  taps with mobile/touch emulation at both phone sizes; claim settlement,
  game/reload, trade acceptance and keyboard clear. No page or route errors;
  three expected blocked-telemetry CORS messages are retained separately.
- `final-suite.log`: passing 75-command Vault suite, including full-season and
  hidden-year 12-team fixtures with 156 picks and 92 saved/reloaded actions each.
- `final-ui.log`: final 22-case follow-up after the keyboard focus repair.
- `core.log`, `entry.log`, `final-lint.log`: 97 core checks, seven shared entry
  contracts and source ESLint.
- `final-build.log`: `SHARED_SOURCE=/tmp/vault-shared-20261021 npm run build:preview`
  passed with 160 compiled Babel scripts. The shared input is pinned to
  `74d6369224db5b814a9f3fdeff8fb7d60735aa81`; all 46 extracted files match its Git
  objects (`shared-input-verification.json`). Existing large-script Babel notes and
  the Node local-storage warning remain; neither failed compilation.
- `verification-summary.json`: final local commit, source SHA-256 hashes,
  report counts, commands and evidence boundaries.

The first WebKit touch run completed the gameplay assertions but failed its
strict report on 22 late GET connection resets. Its raw report/log remain as
`attempt-webkit-route-reset-*`. The harness now records context-closing timing
without ignoring active-session errors. A fresh complete rerun passed with zero
route errors and zero cleanup resets; this did not require an application edit.

Representative before/after artifacts are `before-roster-density-390.png`,
`after-roster-density-390.png`, `before-waivers-density-390.png`,
`after-waivers-density-390.png`, `after-trade-upfront-packages-390.png` and
`after-replacement-preselected-drop-390.png`. These are actual browser captures.
The archive audit still reports 3,586 identities, 22,906 seasons and 272,461
unique scoring lines, with legacy hashes unchanged. Existing unrelated design
token failures in `js/free-agency.js` remain outside this slice. No new product
system or discretionary rules change was added to future work; the existing
prioritized beta-access and portability work remains applicable.

---

September 8, 2026 · Product, browser, rules, and architecture review

**Recommendation: run a small invited beta with 5–10 trusted testers. Do not launch public, ranked multiplayer yet.** The game has a distinctive premise, a complete season loop, and enough personality to invite repeat play. Keep the current architecture. The next investment should be reliability, clearer decisions, and observing real players—not another large feature expansion.

This review used a new local league, not an existing user save. Local gameplay ran with development authentication. Guest entry and login presentation were separately checked without that bypass. No real accounts were created, invitations sent, or human messages submitted. Actual two-account internet play and production load remain unverified.

## Experience scorecard

Grades describe the reviewed implementation after targeted corrections, not a claim that every device or multiplayer condition has passed.

| Dimension | Grade | Assessment |
|---|---|---|
| Core concept and identity | A− | Position Roulette, sealed editions, historical careers, and rival owners make this feel like its own game. Keep Roulette as the default. |
| Setup and first use | B+ | Reveals hide the board correctly; the new direct Vault entry avoids unrelated Dynasty onboarding. Settings still need observation with first-time testers. |
| Draft clarity and strategy | B+ | Recent picks, position runs, timers, filters, scouting, and the colorful recap work. Era-eligible ranking needed correction. A drawn-season grade is retrospective, not a fair measure of drafting skill. |
| Roster and player statistics | B+ | Legal swap choices, stars, remaining games, SZN/YTD, and position/team/week filters make decisions understandable. Mobile density is improved. No-game warnings deserve more prominence before lineup lock. |
| Game day | B+ | Both lineups and quarter totals are readable; pause, quarter skip, and instant completion work. The quarter reconstruction is engaging but is not authentic NFL play-by-play. Descriptive grammar and five-minute pacing could improve. |
| Waivers and trades | B | A displayed waiver edition was awarded exactly as shown; a clearly lopsided offer was rejected. Four gates give the user control. Trade response timing needed clearer copy. |
| Rival owners and messages | B+ | Win/loss and playoff-specific messages appear after games; reply presets, relationship movement, and typing delay work. Templates remain recognizable over a full season. |
| Season and playoffs | A− | Twelve regular games, seeded semifinals, championship, ceremony, and persistent results completed successfully. Playoff presentation could distinguish eliminated teams more clearly. |
| Mobile layout and accessibility | B | Tested at 320–390px, plus a short 390×520 viewport. No page-wide horizontal overflow in reviewed screens; tables intentionally scroll. This is not a complete assistive-technology audit. |
| Scoring and save continuity | A− | Browser totals reconciled with the followed player; independent real-data tests exercised custom scoring, save/reload, quarters, transactions, and playoffs. Source totals are internally consistent, not independently certified against every historical NFL game. |
| Friends-league onboarding | B−, provisional | Guest and email-entry screens work; invitations and authority have automated coverage. Fresh live signup and two distinct human accounts still need a real session. |
| Competitive integrity | B−, provisional after follow-up | Server snapshots now omit sealed editions and private draw inputs; explicit per-manager reveals and database access tests close the identified blocker. Real concurrent-account acceptance remains pending. |
| Operations and scale | C+ | Regression gates, pinned shared code, serialized backend releases, and release metadata improve repeatability. Staging isolation, unattended advancement, save portability, and real load evidence remain missing. |

**Overall product experience: B+ for a closed beta. Public-platform readiness: C.**

## Actual player journey

I created **Beta Review · Full Season**, a six-team solo league, using Position Roulette and the default twelve regular weeks plus a four-team playoff. All 72 draft picks and all 14 games were advanced through the browser controls. AI picks used the app's own pacing; repeated week gates used the same visible buttons. No league state or result was injected to complete this season.

1. Opened the QB archive, scouted Patrick Mahomes, and confirmed eligible 2018–2019 seasons, descending years, and leftmost fantasy points. The board and draft actions stayed locked until the reveal was complete.
2. Picked Mahomes first. His edition remained sealed until the draft finished, then revealed **2018 / 353.5 archive points**. The completed draft gave my class a **D**, despite its eventual championship appearance—useful evidence that draft grades should be treated as flavor.
3. Swapped Mahomes to the bench for Robert Griffin III through the replacement sheet, then reversed the swap. The sheet offered a compatible QB; both moves occurred together.
4. Claimed **2008 Marion Barber**, dropping Darren Waller. The displayed **197.1 remaining points** matched the edition received. Moved Barber into FLEX for Deuce McAllister.
5. Watched portions of Week 1 at the five-minute and one-minute settings, paused in Q2, skipped to halftime, resumed, then used Instant. Subsequent games used Instant to inspect the full season in one review. This does not prove a five-minute game is enjoyable for all 14 weeks.
6. Both lineups updated; kicker extra points were distributed through quarters. Frankie Deals sent a visible postgame message. A friendly reply showed the typing indicator and changed the relationship toward friendly.
7. Offered Deuce McAllister for LaDainian Tomlinson. Kade rejected it after the waiver batch: the trade did not change ownership. The review caught unclear disabled response controls and corrected their stage-specific explanation.
8. Checked the Home playoff hunt at midseason, YTD against Player Stats, and filters by QB, Beta Pilots, and Week 1. At Week 6 Mahomes showed **158.1 YTD** in both roster and stats.
9. Finished **7–5**, qualified as seed 2, won the semifinal, then lost the championship to Kade **110.5–105.8**. The championship-specific message and ceremony named the correct winner and MVP.
10. Reloaded the completed league. The champion, bracket, roster, and scores persisted. Mahomes ended with **353.5 YTD, 13 games, 4,300 passing yards, 43 passing TD, 11 INT, and 235 rushing yards**. Replayed Week 1, paused it, and returned to the roster: his current YTD correctly stayed **353.5**.

| Week | Beta Pilots | Opponent | Opponent score | Mahomes FPTS |
|---|---:|---|---:|---:|
| 1 | 176.2 | Frankie Deals | 99.7 | 28.34 |
| 2 | 130.6 | Warlord Kade | 84.9 | 38.84 |
| 3 | 128.3 | The Archivist | 95.6 | 25.26 |
| 4 | 104.8 | Riverboat Sol | 94.3 | 22.86 |
| 5 | 67.4 | Steward Vance | 125.9 | 15.82 |
| 6 | 90.1 | Frankie Deals | 84.3 | 26.98 |
| 7 | 75.7 | Warlord Kade | 104.1 | 32.82 |
| 8 | 93.9 | The Archivist | 70.2 | 26.02 |
| 9 | 109.7 | Riverboat Sol | 113.8 | 26.80 |
| 10 | 82.0 | Steward Vance | 144.7 | 20.06 |
| 11 | 166.9 | Frankie Deals | 104.4 | 35.92 |
| 12 | 100.2 | Warlord Kade | 114.1 | 0.00, no archived game |
| 13, semifinal | 158.8 | Steward Vance | 124.8 | 33.00 |
| 14, championship | 105.8 | Warlord Kade | 110.5 | 20.78 |

Team scores are rounded to one decimal for display. I intentionally did not optimize every lineup during the repeated-gate portion. Leaving unavailable players in exposed a real strategy cost; it is not a scoring error. Mahomes' final-game rating was one star after his stronger games were exhausted.

## Changes made in this review

- Ranked and displayed draft players using only seasons eligible for their revealed era, including the default selection and game counts.
- Explained that scout/SZN numbers are the **Weeks 1–14 archive using reference scoring**. League-scored YTD is separately labeled.
- Made each player-stat row use that player's position, so quarterbacks show passing production even in the All filter.
- Made AI managers replace an unavailable starter with an eligible available bench player. It checks whether a game exists, never its future score.
- Prevented legacy leagues from appending playoffs after the fourteen-week data limit; existing results remain intact.
- Preserved current YTD and messages while replaying an old game.
- Corrected new postgame conversation week labels, with compatible database normalization for older online clients.
- Reduced mobile roster row height from roughly 163px to 114px while retaining a 44px Move target; labeled Community in More.
- Explained when queued AI trade responses arrive instead of showing a disabled, unexplained action.
- Corrected saved-final labels after reload and centered the championship helmet.
- Added direct `?vault=1` entry, scoped email sign-in/return, and visible Report a bug actions.
- Added release regression gates, pinned the shared-engine revision, serialized backend releases, avoided duplicate Pages artifacts on workflow reruns, and generated release metadata.

## Architecture decisions

Keep the static frontend, shared deterministic game engine, and Supabase authoritative actions. The current server validates seat ownership, computes supported changes, and uses version checks to prevent conflicting writes. Those are good foundations. A rewrite is not justified by the observed experience.

The sealed-draft follow-up implements a private/public server snapshot contract, server-only cryptographic edition allocation, per-manager era reveals, and database access tests. See `reports/vault-beta-access-review-2026-09-08.md` for its scope and limitations. Real invite/reconnect/concurrent-account acceptance remains required before widening multiplayer access.

Before increasing the beta cohort:

- Separate staging from production. Main and sandbox currently share both Supabase and the GitHub Pages origin/storage; sandbox is a frontend preview, not disposable test data.
- Run two real multi-account sessions: join private seats, draft simultaneously, refresh/reconnect, attempt conflicting actions, and finish a week. The automated tests do not replace this.
- Add unattended server-driven timed advancement before promising that rooms progress while everyone is offline. For the first beta, use commissioner or majority advancement.
- Add save export/import or cloud backup before promising device portability. Solo saves currently stay in one browser/device.
- Measure polling, server latency/errors, and historical-data loading with actual users before expanding. Full snapshots/message polling every three seconds is not yet demonstrated at scale.

Do not present the community leaderboard as a standardized competitive ranking while league rules/scoring differ. Do not market broad Google/Apple multiplayer support until the app-account identity bridge is implemented. The scoped Vault sign-in uses the supported email path.

## Beta rollout

Use the verified release URL, with `index.html?vault=1`. If main is stale and sandbox is the only verified frontend, explicitly call the sandbox link a temporary preview. The final delivery message records actual release status.

1. Invite 5–10 people you trust; controlled link distribution is not a platform registration allowlist.
2. Ask each to create one solo Roulette league and play through three weeks on the same browser/device.
3. Then run two friends leagues with distinct email accounts. The host selects human seats plus AI fillers and shares one private invitation per person.
4. Use commissioner or majority advancement. Have one host lead the first draft and explain the four stages.
5. Collect bugs using Report a bug, including device, screenshot, expected result, and the last action. Keep fixes small during this cohort.
6. Expand only after both rooms complete without lost progress, stuck turns, incorrect ownership, or ambiguous advancement. Measure whether testers return for another session and can explain their lineup choices.

Detailed access steps and security findings: [Beta access review](vault-beta-access-review-2026-09-08.md).

## Verification and limits

- Core regression: 114/114 tests; login contract and full Vault suite passed during integration.
- Two independent real-data twelve-team seasons, each 156 picks and 92 serialized/reloaded actions, exercised default and custom scoring through championships. All 150 team-week totals per run reconciled with quarter/stats output.
- Archive audit: 215,734 logs, 4,420 player cards, 18,150 editions; all within Weeks 1–14; no missing-edition or internal aggregate mismatch. External historical source certification remains outside this review.
- Actual PostgreSQL/PGlite message tests covered migration replay, old-client compatibility, deduplication, privacy, access controls, concurrent writes, rate limits, and rollback.
- Mobile review used an engine-completed draft fixture, then real Week 1 controls; it is separate from the desktop season completed entirely through UI actions.
- Guest browser entry/login and the bug dialog were opened without submitting an account or report. Fresh live authentication remains a beta-host smoke test.
- No new app runtime exceptions were observed in the playthrough. The local preview still emits the existing meta-CSP warning; this is not proof of a full production security-header audit.

Screenshots are retained locally under `output/playwright/`: `beta-desktop-reveal.png`, `beta-desktop-draft-recap.png`, `beta-desktop-gamecast-live.png`, `beta-desktop-chat-typing.png`, `beta-desktop-home-midseason.png`, `beta-desktop-championship.png`, `vault-beta-mobile-roster-compact.png`, `vault-beta-mobile-roster-320-ytd.png`, and the access-review screenshots. The initial championship screenshot catches its entrance fade; text/result verification was performed after it settled.
