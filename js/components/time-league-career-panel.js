(function () {
    'use strict';
    const h = React.createElement;
    function WrTimeLeagueCareerPanel({ records = [], onOpen, loading, error }) {
        const profile = window.App.TimeLeagueCareer.summarize(records);
        const [mode, setMode] = React.useState('overall');
        const stats = profile[mode];
        const leagues = profile.leagues.filter(item => mode === 'overall' || item.mode === mode);
        const filtered = window.App.TimeLeagueCareer.summarize(leagues);
        const record = item => `${item.wins}–${item.losses}–${item.ties}`;
        const metric = (label, value, detail) => h('div', { className: 'tl-career-metric' }, h('small', null, label), h('strong', null, value), h('span', null, detail));
        return h('section', { className: 'tl-career' },
            h('header', { className: 'tl-career-hero' }, h('small', null, 'THE VAULT · YOUR LEGACY'), h('h1', null, 'Every season leaves a mark.'), h('p', null, 'Your teams. Your rivalries. Your championship runs.'),
                h('nav', { 'aria-label': 'Career record mode' }, [['overall', 'All play'], ['solo', 'Solo'], ['multiplayer', 'With friends']].map(([id, label]) => h('button', { key: id, className: 'tl-btn' + (mode === id ? ' primary' : ''), 'aria-pressed': mode === id, onClick: () => setMode(id) }, label)))),
            loading && h('p', { role: 'status' }, 'Updating your league history…'),
            error && h('p', { role: 'status' }, error),
            h('div', { className: 'tl-career-metrics' }, metric('Career record', record(stats), 'Wins · losses · ties'), metric('Championships', stats.trophies, `${stats.completed} completed seasons`), metric('Points scored', stats.points.toLocaleString(undefined, { maximumFractionDigits: 1 }), `${stats.games} games played`), metric('Best game', stats.high ? stats.high.points.toFixed(1) : '—', stats.high ? `${stats.high.teamName} · Week ${stats.high.week}` : 'Your first result awaits')),
            h('div', { className: 'tl-career-columns' },
                h('section', { className: 'tl-card' }, h('div', { className: 'tl-card-title' }, 'Trophy room'), filtered.trophies.length ? h('div', { className: 'tl-career-trophies' }, filtered.trophies.map(item => h('article', { key: `${item.mode}:${item.leagueId}:${item.seatTeamId}` }, h('span', { 'aria-hidden': true }, '🏆'), h('strong', null, item.name), h('small', null, `${item.teamName} · ${item.mode === 'solo' ? 'Solo' : 'With friends'}`)))) : h('p', null, 'The first pedestal is waiting. Finish a championship run to claim it.')),
                h('section', { className: 'tl-card' }, h('div', { className: 'tl-card-title' }, 'Your draft favorites'), filtered.mostDrafted.length ? filtered.mostDrafted.slice(0, 8).map((item, i) => h('div', { className: 'tl-career-favorite', key: item.identity }, h('small', null, String(i + 1).padStart(2, '0')), h('strong', null, item.name), h('span', null, item.position), h('b', null, `${item.count}×`))) : h('p', null, 'Your draft picks will build this list.'))),
            h('section', { className: 'tl-card' }, h('div', { className: 'tl-card-title' }, h('span', null, 'League history'), h('small', null, `${leagues.length} leagues`)),
                !leagues.length && h('p', null, 'Start a season to begin your career. Your saved history will stay here when a local league is archived.'),
                leagues.map(item => h('article', { className: 'tl-career-league', key: `${item.mode}:${item.leagueId}:${item.seatTeamId}` },
                    h('div', null, h('small', null, `${item.mode === 'solo' ? 'SOLO' : 'WITH FRIENDS'} · ${item.archived ? 'ARCHIVED' : item.phase === 'complete' ? 'COMPLETE' : item.phase === 'draft' ? 'DRAFTING' : 'IN SEASON'}`), h('h3', null, `${item.stats.trophies ? '🏆 ' : ''}${item.name}`), h('span', null, item.teamName)),
                    h('div', null, h('strong', null, record(item.stats)), h('small', null, `${item.stats.points.toFixed(1)} points`), h('small', null, `Regular ${record(item.regular)} · Playoffs ${record(item.playoffs)}`)),
                    onOpen && !item.archived && h('button', { className: 'tl-btn', onClick: () => onOpen(item) }, 'Open league →')))));
    }
    window.WrTimeLeagueCareerPanel = WrTimeLeagueCareerPanel;
})();
