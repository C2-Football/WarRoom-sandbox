#!/usr/bin/env node
// War Room Sentry launch error-capture contract tests.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// dhq-shared, not reconai (retired/archived) — dhq-shared is the canonical
// source app-config.js/bug-capture.js are vendored from; reconai's copies
// were always byte-identical, this just points at the source that still exists.
const SHARED_ROOT = process.env.SHARED_SOURCE || path.join(ROOT, 'reconai-shared');
const rootIndex = read(ROOT, 'index.html');
const core = read(ROOT, 'js/core.js');
const components = read(ROOT, 'js/components.js');
const appConfig = read(SHARED_ROOT, 'app-config.js');
const bugCapture = read(SHARED_ROOT, 'bug-capture.js');

let passed = 0;
let failed = 0;
const failures = [];

function read(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

console.log('\nWar Room bug capture contract tests');

group('shared loading');

test('War Room loads shared bug capture with the warroom app tag', () => {
  ok(rootIndex.includes("window.DYNASTY_HQ_APP = 'warroom'"), 'War Room app tag missing');
  ok(rootIndex.includes("'bug-capture.js'"), 'bug-capture shared file missing from War Room shared registry');
  ok(rootIndex.indexOf("'bug-capture.js'") > rootIndex.indexOf("'app-config.js'"), 'bug-capture should load after app-config');
  ok(rootIndex.indexOf("'bug-capture.js'") < rootIndex.indexOf("'utils.js'"), 'bug-capture should load before utility logging');
});

test('War Room caught failures are forwarded to bug capture', () => {
  ok(core.includes('window.DHQBugCapture?.captureError?.'), 'wrLog should report caught errors');
  ok(components.includes('react_error_boundary'), 'React error boundary should tag render crashes');
  ok(components.includes('window.DHQBugCapture?.captureError?.'), 'React error boundary should report render crashes');
});

test('shared Sentry client includes War Room DSN and scrubbing', () => {
  ok(appConfig.includes('fbe10be66ec013dc267fb092dcf16fff'), 'War Room Sentry DSN missing');
  ok(bugCapture.includes('sendDefaultPii: false'), 'Sentry PII opt-out missing');
  ok(bugCapture.includes('beforeSend: sanitizeEvent'), 'Sentry event sanitizer missing');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
