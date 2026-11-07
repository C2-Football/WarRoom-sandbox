'use strict';

// Exercise the real build with no worker script tag: dynamic registration must
// still produce a Pages overlay file and a hash of its served bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dhq-reminder-release-'));
const write = (name, contents) => {
    const target = path.join(fixture, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
};
const run = () => spawnSync(process.execPath, ['scripts/build-deploy.cjs'], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'fixture-release-revision' },
});

try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    write('scripts/build-deploy.cjs', fs.readFileSync(path.join(root, 'scripts/build-deploy.cjs')));
    write('scripts/build-lens-visuals.cjs', fs.readFileSync(path.join(root, 'scripts/build-lens-visuals.cjs')));
    write('index.html', '<!doctype html><title>Worker release fixture</title><link rel="stylesheet" href="lens-composition.css"><script type="text/wr-lens-runtime" data-lens-visuals-runtime src="js/vendor/lens-visuals.js"></script>');
    write('reminder-unsubscribe.html', '<!doctype html><script src="js/shared/reminder-unsubscribe.js"></script>');
    write('js/shared/reminder-unsubscribe.js', 'window.unsubscribeFixture = true;\n');
    write('dashboard-reminder-sw.js', fs.readFileSync(path.join(root, 'dashboard-reminder-sw.js')));
    // The production builder also emits these dynamically loaded history modules.
    for (const file of ['value-history.js', 'supabase-client.js'])
        write('reconai-shared/' + file, fs.readFileSync(path.join(root, 'reconai-shared', file)));
    write('data/duat/lore-catalog.json', '{}');
    const dashboardStyles = ['dashboard-lenses.css', 'dashboard-builder.css', 'dashboard-views.css', 'dashboard-reminders.css', 'lens-composition.css'];
    for (const style of dashboardStyles) write(style, fs.readFileSync(path.join(root, style)));
    fs.mkdirSync(path.join(fixture, 'images/duat'), { recursive: true });

    const built = run();
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const release = JSON.parse(fs.readFileSync(path.join(fixture, 'dist-deploy/release.json'), 'utf8'));
    assert.equal(release.revision, 'fixture-release-revision');
    const runtime = fs.readFileSync(path.join(fixture, 'dist-deploy/js/vendor/lens-visuals.js'));
    const runtimeHash = crypto.createHash('sha256').update(runtime).digest('hex').slice(0, 10);
    assert.equal(release.assets['js/vendor/lens-visuals.js'], runtimeHash, 'Lazy graphics runtime is fingerprinted');
    const html = fs.readFileSync(path.join(fixture, 'dist-deploy/index.html'), 'utf8');
    assert(html.includes('lens-composition.css?v=' + release.assets['lens-composition.css']), 'Responsive lens styles are cache-busted with their actual bytes');
    assert(html.includes('type="text/wr-lens-runtime"'), 'Graphics remain lazy in the production entry');
    assert(html.includes('js/vendor/lens-visuals.js?v=' + runtimeHash), 'Lazy loader discovers the exact shipped runtime');
    for (const style of dashboardStyles) assert.equal(release.assets[style], crypto.createHash('sha256').update(fs.readFileSync(path.join(root, style))).digest('hex').slice(0, 10), 'Dashboard styles must be fingerprinted for release verification');
    assert(!fs.readFileSync(path.join(fixture, 'dist-deploy/index.html'), 'utf8').includes('dashboard-reminder-sw.js'), 'Worker is dynamically loaded, not an HTML dependency');

    // Reproduce Pages' raw-copy then compiled-overlay order, including a stale
    // raw worker, and verify the release hash describes the resulting artifact.
    write('pages-artifact/dashboard-reminder-sw.js', '// stale raw copy\n');
    fs.cpSync(path.join(fixture, 'dist-deploy'), path.join(fixture, 'pages-artifact'), { recursive: true });
    const served = fs.readFileSync(path.join(fixture, 'pages-artifact/dashboard-reminder-sw.js'));
    const servedHash = crypto.createHash('sha256').update(served).digest('hex').slice(0, 10);
    assert.equal(release.assets['dashboard-reminder-sw.js'], servedHash, 'Manifest fingerprints the worker shipped by the Pages overlay');
    assert.match(served.toString(), /addEventListener\(["']push["']/);
    assert.notEqual(served.toString(), fs.readFileSync(path.join(fixture, 'dashboard-reminder-sw.js'), 'utf8'), 'Overlay contains the built worker');
    const unsubscribeScript = fs.readFileSync(path.join(fixture, 'pages-artifact/js/shared/reminder-unsubscribe.js'));
    const unsubscribeHash = crypto.createHash('sha256').update(unsubscribeScript).digest('hex').slice(0, 10);
    assert.equal(release.assets['js/shared/reminder-unsubscribe.js'], unsubscribeHash, 'Opt-out script is fingerprinted');
    assert(fs.readFileSync(path.join(fixture, 'pages-artifact/reminder-unsubscribe.html'), 'utf8').includes('?v=' + unsubscribeHash), 'Opt-out page ships the hashed compiled script');

    fs.rmSync(path.join(fixture, 'dashboard-reminder-sw.js'));
    const missing = run();
    assert.notEqual(missing.status, 0, 'Missing required worker must fail the build');
    assert.match(missing.stderr, /Missing script source: dashboard-reminder-sw\.js/);
    console.log('PASS reminder release: dynamically registered worker is built, copied, fingerprinted, and required');
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}
