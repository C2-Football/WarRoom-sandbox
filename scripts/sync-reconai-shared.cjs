#!/usr/bin/env node
// Copy the shared browser-engine modules into War Room for local dev + deploy.
// Canonical source is the neutral C2-Football/dhq-shared repo — checked out as a
// sibling ../dhq-shared locally, or pointed at via $SHARED_SOURCE in CI. War Room
// no longer reads the ReconAI repo for shared code (both apps vendor dhq-shared).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'reconai-shared');

const FILES = [
  'app-config.js',
  'bug-capture.js',
  'constants.js',
  'utils.js',
  'storage.js',
  'event-bus.js',
  'platform-provider.js',
  'sleeper-api.js',
  'espn-api.js',
  'mfl-api.js',
  'yahoo-api.js',
  'value-monitor-runtime.cjs',
  'value-history.js',
  'supabase-client.js',
  'tier.js',
  'pick-value-model.js',
  'dhq-providers.js',
  'dhq-core.js',
  'intelligence-context.js',
  'dhq-engine.js',
  'nfl-fit.js',
  'team-assess.js',
  'analytics-engine.js',
  'dhq-ai.js',
  'assistant-tutorial.js',
  'ai-dispatch.js',
  'strategy.js',
  'trade-engine.js',
  'mock-engine.js',
  'gm-engine.js',
  'player-modal.js',
  'rookie-data.js',
];

function findSourceDir() {
  const candidates = [
    process.env.SHARED_SOURCE,
    process.env.RECONAI_SHARED_SOURCE, // back-compat alias
    path.resolve(ROOT, '..', 'dhq-shared'),
    // No ../reconai/shared fallback. ReconAI was archived 2026-07-08 and a local
    // checkout of it is frozen at that date — silently syncing from it would
    // vendor months-stale engine code instead of failing loudly. dhq-shared is
    // the only canonical source.
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function hasBundledSnapshot() {
  return FILES.every(file => fs.existsSync(path.join(TARGET, file)));
}

const SOURCE = findSourceDir();

if (!SOURCE) {
  if (hasBundledSnapshot()) {
    console.log('[sync-reconai-shared] Source checkout unavailable; using bundled reconai-shared snapshot');
    process.exit(0);
  }
  console.error('[sync-reconai-shared] Missing ReconAI shared source and bundled snapshot');
  process.exit(1);
}

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

for (const file of FILES) {
  const src = path.join(SOURCE, file);
  if (!fs.existsSync(src)) {
    console.error(`[sync-reconai-shared] Missing shared file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(TARGET, file));
}

console.log(`[sync-reconai-shared] Copied ${FILES.length} files to ${path.relative(ROOT, TARGET)}/`);

// ── Un-vendored twin: player-value.js ───────────────────────────────────────
// player-value.js is deliberately NOT in FILES. index.html loads War Room's own
// js/utils/player-value.js directly, and dhq-shared/player-value.js is a
// hand-maintained twin kept byte-identical by convention only — this sync will
// never propagate a change to it in either direction. That convention has no
// enforcement, so a one-sided edit silently forks the value engine (DHQ, ROS,
// keeper blend) between the two repos. Fail loudly instead.
for (const file of ['startsit-engine.js', 'weekly-proj.js', 'nfl-context.js', 'redraft-market.js']) fs.copyFileSync(path.join(SOURCE, file), path.join(ROOT, 'js/shared', file));
const TWIN = 'player-value.js';
const twinLocal = path.join(ROOT, 'js', 'utils', TWIN);
const twinShared = path.join(SOURCE, TWIN);

if (fs.existsSync(twinLocal) && fs.existsSync(twinShared)) {
  const localSrc = fs.readFileSync(twinLocal, 'utf8');
  const sharedSrc = fs.readFileSync(twinShared, 'utf8');
  if (localSrc !== sharedSrc) {
    console.error(
      `[sync-reconai-shared] DRIFT: ${TWIN} differs between the two repos.\n` +
      `  warroom:    js/utils/${TWIN}\n` +
      `  dhq-shared: ${path.relative(ROOT, twinShared)}\n` +
      `  This file is not vendored — edit BOTH copies by hand, then re-run.\n` +
      `  Diff them with: diff js/utils/${TWIN} ${path.relative(ROOT, twinShared)}`
    );
    process.exit(1);
  }
  console.log(`[sync-reconai-shared] ${TWIN} twin in sync (not vendored — hand-maintained)`);
}

// ── Rookie/prospect CSVs (shared data) ──────────────────────────────────────
// Vendored from dhq-shared/draft-war-room into War Room's own draft-war-room/ so
// the app loads them SAME-ORIGIN (no cross-repo jsDelivr fetch). Copy-in-place —
// do NOT wipe draft-war-room/ (it also holds War-Room-only tool files + data).
const DATA_FILES = ['player.csv', 'player-enrichment.csv', 'data/mock_draft_db.csv'];
const DATA_SOURCE = path.join(SOURCE, 'draft-war-room');
const DATA_TARGET = path.join(ROOT, 'draft-war-room');

if (fs.existsSync(DATA_SOURCE)) {
  for (const file of DATA_FILES) {
    const src = path.join(DATA_SOURCE, file);
    if (!fs.existsSync(src)) {
      console.error(`[sync-reconai-shared] Missing shared data file: ${src}`);
      process.exit(1);
    }
    const dest = path.join(DATA_TARGET, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  console.log(`[sync-reconai-shared] Vendored ${DATA_FILES.length} rookie CSVs into draft-war-room/`);
} else if (DATA_FILES.every(f => fs.existsSync(path.join(DATA_TARGET, f)))) {
  console.log('[sync-reconai-shared] No draft-war-room/ in source; keeping existing vendored CSVs');
} else {
  console.error('[sync-reconai-shared] Missing rookie CSVs in source and locally');
  process.exit(1);
}

// Identical source fingerprint in browser history and the headless canonical host.
const {createHash}=require('node:crypto');
const {MODULES}=require(path.join(SOURCE,'value-monitor-runtime.cjs'));
const engineSource=MODULES.map(name=>name+fs.readFileSync(path.join(SOURCE,name),'utf8')).join('')+fs.readFileSync(path.join(ROOT,'js/shared/availability-forecast.js'),'utf8');
fs.writeFileSync(path.join(ROOT,'js/shared/value-engine-version.js'),'window.App=window.App||{};window.App.ValueEngineVersion='+JSON.stringify(createHash('sha256').update(engineSource).digest('hex'))+';\n');
