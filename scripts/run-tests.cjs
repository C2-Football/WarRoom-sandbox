#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// scripts/run-tests.cjs — the test runner behind `npm test`.
//
// Replaces a 31-step `a && b && c && …` chain. That chain had a failure
// mode worth naming: a single stale contract at step 3 (landing-content,
// stale since the f17ce8a/2610142 landing rebrand) short-circuited the
// `&&` and meant the remaining 28 suites — draft, AI, billing, security,
// redraft, chopped, empire, commish, timeleague — never executed at all.
// `npm test` looked "red for a known reason" while silently verifying
// nothing past step 3, for months.
//
// This runner instead:
//   - runs EVERY suite, always, regardless of earlier failures
//   - prints one summary at the end: passed / failed / quarantined
//   - exits non-zero only if a non-quarantined suite failed
//
// QUARANTINE is for a suite whose SUBJECT is mid-rework, where the whole
// file's expectations are provisional. It still runs and still reports, it
// just cannot block the build. Every entry needs a reason and should be
// removed when the work lands — an empty QUARANTINE is the goal state.
// For a single stale assertion inside an otherwise-healthy suite, prefer
// that suite's own wip() marker (see tests/analytics-report.js) so the rest
// of the file keeps its teeth.
//
// Usage:
//   node scripts/run-tests.cjs            (all suites)
//   node scripts/run-tests.cjs --bail     (stop at first real failure)
//   node scripts/run-tests.cjs --only=ai,billing
// ════════════════════════════════════════════════════════════════════

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

// Suite ORDER lives here (this replaced the old && chain, which was the
// previous ordering source). Each suite's COMMAND still comes from
// package.json, so `npm run test:security` and this runner can never disagree
// about what that suite actually executes. Add a new suite by adding its
// script name here; a typo fails loudly below rather than silently skipping.
const SUITE_ORDER = [
  'test:design-tokens', 'test:landing-content', 'test:login-auth', 'test:regression',
  'test:click-paths', 'test:intelligence-surfaces', 'test:draft-context',
  'test:draft-analyst-mock', 'test:draft-trade-simulator', 'test:draft-live-sync',
  'test:draft-live-decision', 'test:draft-recap', 'test:post-draft-craze',
  'test:draft-strategy-studio', 'test:ai', 'test:ai-scale', 'test:billing',
  'test:security', 'test:bug-capture', 'test:analytics', 'test:tutorial',
  'test:rookies', 'test:rookie-capital', 'test:rookie-fields', 'test:redraft', 'test:forecast-ledger',
  'test:chopped', 'test:first-class', 'test:empire', 'test:commish', 'test:timeleague',
];

const missing = SUITE_ORDER.filter(s => !pkg.scripts[s]);
if (missing.length) {
  console.error(`\nrun-tests: no package.json script for: ${missing.join(', ')}\n`);
  process.exit(2);
}

const SUITES = [
  { name: 'core', cmd: 'node tests/run.js' },
  ...SUITE_ORDER.map(script => ({ name: script.replace(/^test:/, ''), cmd: pkg.scripts[script], script })),
];

// suite name -> why it cannot block the build yet.
const QUARANTINE = {
  'landing-content': 'Landing page is mid-redesign (f17ce8a single-tier rebrand, '
    + '2610142 "WIP snapshot"). The contract asserts the pre-rebrand shape — '
    + 'hero.title, productSummary(3), features.cards(6), pricing.plans(4) — none of '
    + 'which the current content has. OWNER RULING 2026-08-23: the landing page is '
    + 'FINE as-is; do not "fix" it. That includes the contract\'s last assertion, '
    + 'which is technically accurate — landing.html has not loaded '
    + 'js/landing-content.js since f17ce8a, so content/landing-pages.json and the '
    + 'npm run landing:edit editor drive nothing on the live page. That is known '
    + 'and accepted. Leave this quarantined; do not re-audit or re-report it.',
};

const args = process.argv.slice(2);
const BAIL = args.includes('--bail');
const onlyArg = args.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.replace('--only=', '').split(',').map(s => s.trim()) : null;

const suites = ONLY ? SUITES.filter(s => ONLY.includes(s.name)) : SUITES;

const results = { passed: [], failed: [], quarantined: [] };
const started = Date.now();

console.log(`\nRunning ${suites.length} test suite${suites.length === 1 ? '' : 's'}…\n`);

for (const suite of suites) {
  const quarantined = Object.prototype.hasOwnProperty.call(QUARANTINE, suite.name);
  const run = spawnSync(suite.cmd, { cwd: ROOT, shell: true, encoding: 'utf8' });
  const okRun = run.status === 0;

  if (okRun) {
    results.passed.push(suite.name);
    console.log(`  ✓ ${suite.name}`);
  } else if (quarantined) {
    results.quarantined.push(suite.name);
    console.log(`  ~ ${suite.name}  [quarantined — not blocking]`);
  } else {
    results.failed.push({ name: suite.name, output: (run.stdout || '') + (run.stderr || '') });
    console.log(`  ✗ ${suite.name}`);
    if (BAIL) break;
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log('');

// Full output only for real failures — that is what someone needs to act on.
results.failed.forEach(f => {
  console.log('─'.repeat(64));
  console.log(`FAILED: ${f.name}`);
  console.log('─'.repeat(64));
  console.log(f.output.trim().split('\n').slice(-25).join('\n'));
  console.log('');
});

if (results.quarantined.length) {
  console.log('Quarantined (running, reporting, not blocking):');
  results.quarantined.forEach(n => {
    console.log(`  ~ ${n}`);
    console.log(`      ${QUARANTINE[n].replace(/\s+/g, ' ')}`);
  });
  console.log('');
}

const total = suites.length;
console.log(
  `${results.failed.length ? 'FAIL' : 'PASS'}  ${total} suites in ${secs}s — `
  + `${results.passed.length} passed, ${results.failed.length} failed, `
  + `${results.quarantined.length} quarantined`
);
process.exit(results.failed.length ? 1 : 0);
