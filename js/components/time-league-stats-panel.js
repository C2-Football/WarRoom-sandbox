(function () {
    'use strict';
    const h = React.createElement;
    const fmt = value => value == null ? '—' : value.toFixed(1);
    function WrTimeLeagueStatsPanel({ league, cards, logIndex, eraFactors, throughWeek, onNavigate }) {
        cards = window.App.TimeLeagueEngine.cardsFor(league, cards);
        const Stats = window.App.TimeLeaguePlayerStats;
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const yearLabel = entry => concealed ? window.WrTimeLeagueYearLabel?.(league, entry, cards, logIndex, eraFactors, throughWeek) ?? window.App.TimeLeagueHiddenYears?.label(league, entry, cards) ?? 'Hidden year' : entry.drawnSeason;
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        const pageSize = phone ? 20 : 50;
        const [profileId, setProfileId] = React.useState('');
        const profileDialog = React.useRef(null);
        const profileTrigger = React.useRef(null);
        const profileTeam = league.teams.find(item => item.teamId === profileId);
        React.useEffect(() => {
            const dialog = profileDialog.current;
            if (profileId && dialog && !dialog.open) dialog.showModal?.();
            if (!profileId && dialog?.open) dialog.close?.();
            if (!profileId || !document.body) return;
            const overflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = overflow; };
        }, [profileId]);
        const openProfile = (id, event) => { profileTrigger.current = event.currentTarget; setProfileId(id); };
        const closeProfile = () => { setProfileId(''); profileTrigger.current?.focus?.({ preventScroll: true }); };
        const teamLink = row => row.teamId === 'fa' ? h('small', null, 'Free agent') : h('button', { type: 'button', className: 'tl-stats-team-link', onClick: event => openProfile(row.teamId, event), 'aria-label': 'View ' + row.teamName + ' team profile' }, row.teamName + ' ↗');
        const [search, setSearch] = React.useState('');
        const [position, setPosition] = React.useState('ALL');
        const [team, setTeam] = React.useState('ALL');
        const [period, setPeriod] = React.useState('ytd');
        const [sort, setSort] = React.useState('points');
        const [ascending, setAscending] = React.useState(false);
        const [limit, setLimit] = React.useState(pageSize);
        const weeks = Stats.completedWeeks(league, throughWeek);
        const effectivePeriod = period === 'ytd' || weeks.includes(Number(period)) ? period : 'ytd';
        const rows = React.useMemo(() => Stats.players(league, cards, logIndex, eraFactors, throughWeek, effectivePeriod), [league, cards, logIndex, eraFactors, throughWeek, effectivePeriod]);
        const filtered = Stats.filterAndSort(rows, { search, position, team, sort, ascending });
        const change = setter => event => { setter(event.target.value); setLimit(pageSize); };
        const sortBy = key => { setAscending(sort === key ? !ascending : ['name', 'position', 'teamName'].includes(key)); setSort(key); };
        const columns = [['name', 'Player'], ['points', 'FPTS'], ['games', 'Vault GP'], ['average', 'PPG'], ['teamName', 'Owned by'], ['position', 'Pos'], ...(!concealed ? [['seasonPoints', 'SZN']] : [])];
        const columnHelp = {
            points: 'Fantasy points from completed Vault weeks in your league scoring, including bench production and games before acquisition.',
            games: 'Recorded games in the selected completed Vault weeks. A week with no recorded game does not count.',
            average: 'Fantasy points per recorded completed Vault game in your league scoring.',
            teamName: 'Current owner. Opening a team profile does not change player ownership.',
            seasonPoints: `${league.settings.gameDeckVersion === 1 ? 'Recorded NFL regular-season total' : 'Weeks 1–14 archive total'} with reference scoring; it may differ from your league scoring.`,
        };
        const periodScope = `${effectivePeriod === 'ytd' ? `Through ${weeks.length ? `Week ${weeks.at(-1)}` : 'preseason'}` : `Week ${effectivePeriod}`} · completed Vault weeks · league scoring`;
        const statFields = playerPosition => playerPosition === 'K' ? [['fgm', 'FG'], ['xpm', 'XP']] : playerPosition === 'DEF' ? [['sack', 'Sacks'], ['int', 'INT']]
            : playerPosition === 'QB' ? [['passYd', 'Pass yd'], ['passTd', 'Pass TD'], ['passInt', 'INT'], ['rushYd', 'Rush yd']]
                : [['rushYd', 'Rush yd'], ['rushTd', 'Rush TD'], ['rec', 'Rec'], ['recYd', 'Rec yd'], ['recTd', 'Rec TD']];
        return h('section', { className: 'tl-card tl-player-stats', 'aria-label': 'Player statistics' },
            h('div', { className: 'tl-stats-heading' }, h('div', null, h('span', { className: 'tl-label' }, 'THE LEAGUE LEADERS'), h('h2', null, 'Player stats'), h('small', { className: 'tl-stats-scope' }, periodScope)),
                h('label', null, 'Period', h('select', { className: 'tl-select', value: effectivePeriod, onChange: change(setPeriod), 'aria-label': 'Stats period' }, h('option', { value: 'ytd' }, 'Year to date'), weeks.map(week => h('option', { key: week, value: week }, `Week ${week}`))))),
            h('div', { className: 'tl-stats-controls' },
                h('input', { className: 'tl-input', type: 'search', placeholder: 'Search players…', value: search, onChange: change(setSearch), 'aria-label': 'Search player stats' }),
                h('select', { className: 'tl-select', value: team, onChange: change(setTeam), 'aria-label': 'Filter stats by team' }, h('option', { value: 'ALL' }, 'All teams'), h('option', { value: 'fa' }, 'Free agents'), league.teams.map(item => h('option', { key: item.teamId, value: item.teamId }, item.name)))),
            h('div', { className: 'tl-stats-positions', 'aria-label': 'Filter stats by position' }, ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', ...(league.settings.rosterSlots.FLEX ? ['FLEX'] : []), ...(league.settings.rosterSlots.SUPER_FLEX ? ['SUPER_FLEX'] : [])].map(value => h('button', { key: value, type: 'button', className: `tl-btn${position === value ? ' primary' : ''}`, 'aria-pressed': position === value, onClick: () => { setPosition(value); setLimit(pageSize); } }, value === 'DEF' ? 'D/ST' : value === 'SUPER_FLEX' ? 'Super flex' : value === 'ALL' ? 'All' : value))),
            !logIndex || (league.settings.eraAdjusted && !eraFactors?.size) ? h('p', { role: 'status', className: 'tl-hint' }, 'Some historical data is still loading. Unavailable totals show —.') : null,
            phone ? h('div', { className: 'tl-stats-mobile' },
                h('div', { className: 'tl-stats-mobile-sort' },
                    h('label', null, 'Sort players', h('select', { className: 'tl-select', value: sort, onChange: event => sortBy(event.target.value) }, columns.map(([key, label]) => h('option', { key, value: key }, label)))),
                    h('button', { className: 'tl-btn', type: 'button', onClick: () => setAscending(value => !value), 'aria-label': 'Reverse player sort order' }, ascending ? 'Low to high ↑' : 'High to low ↓')),
                filtered.slice(0, limit).map(row => h('details', { className: 'tl-stats-mobile-row', key: `${row.teamId}:${row.identity}:${row.drawnSeason}` },
                    h('summary', null, h('span', null, h('strong', null, row.name), h('small', { title: row.teamId === 'fa' ? 'Free agent' : `Owned by ${row.teamName}` }, `${row.position === 'DEF' ? 'D/ST' : row.position} · ${yearLabel(row)} · ${row.teamName}`)), h('span', { className: 'tabular', title: columnHelp.points }, h('strong', null, fmt(row.points)), h('small', null, 'FPTS'))),
                    h('div', { className: 'tl-stats-mobile-detail' }, h('div', { className: 'tl-stats-mobile-owner' }, h('small', null, 'Owned by'), teamLink(row)), h('dl', null,
                        [['Vault games', row.games ?? '—'], ['Points per game', fmt(row.average)], ...(!concealed ? [['Recorded season · reference scoring', fmt(row.seasonPoints)]] : []), ...statFields(row.position).filter(([key]) => row.stats[key] != null).map(([key, label]) => [label, row.stats[key]])].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value)))))))) :
            h('div', { className: 'tl-stats-scroll', tabIndex: 0, 'aria-label': 'Player statistics table. Scroll for additional columns.' }, h('table', { className: 'tl-stats-table' },
                h('thead', null, h('tr', null, columns.map(([key, label]) => h('th', { key, scope: 'col', 'aria-sort': sort === key ? ascending ? 'ascending' : 'descending' : 'none' }, h('button', { type: 'button', title: columnHelp[key], onClick: () => sortBy(key) }, label, sort === key ? ascending ? ' ↑' : ' ↓' : ''))))),
                h('tbody', null, filtered.slice(0, limit).map((row, index) => h('tr', { key: `${row.teamId}:${row.identity}:${row.drawnSeason}` },
                    h('td', null, h('div', { className: 'tl-stats-player' }, h('small', null, index + 1), h('span', { className: 'tl-stats-player-identity' }, h('strong', null, row.name), h('small', null, `${row.position === 'DEF' ? 'D/ST' : row.position} · ${yearLabel(row)}`)),
                        statFields(row.position).some(([key]) => row.stats[key] != null) && h('details', { className: 'tl-stats-player-breakdown' }, h('summary', { 'aria-label': `Recorded stats for ${row.name}` }, 'Stats'), h('span', { className: 'tl-stats-details' }, statFields(row.position).filter(([key]) => row.stats[key] != null).map(([key, label]) => h('span', { key }, `${label} ${row.stats[key]}`)))))),
                    h('td', { className: 'tl-stats-points tabular' }, fmt(row.points)), h('td', null, row.games ?? '—'), h('td', { className: 'tabular' }, fmt(row.average)), h('td', { className: 'tl-stats-owner' }, teamLink(row)), h('td', null, row.position === 'DEF' ? 'D/ST' : row.position), !concealed && h('td', { className: 'tabular' }, fmt(row.seasonPoints))))))),
            !filtered.length ? h('p', { className: 'tl-empty' }, league.seasonsRevealed ? 'No players match these filters.' : 'Player stats open after the draft reveal.') : null,
            h('dialog', { ref: profileDialog, className: 'tl-action-dialog tl-team-profile-dialog', 'aria-label': profileTeam ? profileTeam.name + ' team profile' : 'Team profile', onCancel: event => { event.preventDefault(); closeProfile(); }, onClose: closeProfile },
                profileTeam && h(React.Fragment, null,
                    h('header', { className: 'tl-action-dialog-head' }, h('h2', null, profileTeam.name), h('button', { type: 'button', className: 'tl-btn', onClick: closeProfile }, 'Close')),
                    window.WrTimeLeagueStandingsPanel && h(window.WrTimeLeagueStandingsPanel, { key: profileId, league: { ...league, finalizedWeeks: league.finalizedWeeks.filter(row => weeks.includes(row.week)) }, profileTeamId: profileId, profileOnly: true, onCloseProfile: closeProfile },
                    h('section', { className: 'tl-card' }, h('h3', null, 'Roster'),
                        profileTeam.roster.map(entry => h('div', { key: entry.entryId, className: 'tl-profile-roster-row' }, h('strong', null, entry.name), h('span', null, entry.position + ' · ' + yearLabel(entry) + ' · ' + entry.slot))))))),
            h('div', { className: 'tl-stats-footer' }, h('small', null, `${Math.min(limit, filtered.length)} of ${filtered.length} players`), filtered.length > limit ? h('button', { className: 'tl-btn', onClick: () => setLimit(value => value + pageSize) }, 'Show more') : null,
                onNavigate ? h('button', { className: 'tl-btn', onClick: () => onNavigate('waivers') }, 'Open free agents →') : null));
    }
    window.WrTimeLeagueStatsPanel = WrTimeLeagueStatsPanel;
})();
