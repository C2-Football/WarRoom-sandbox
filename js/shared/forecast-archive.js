/* global module */
// Explicit, authenticated archive operations; never uploads on page load.
(function(root) {
    'use strict';
    function createArchive({client = () => root.OD?.getClient?.(), token = () => root.OD?.getSessionToken?.()} = {}) {
        async function rpc(name, args) {
            if (!token()) throw new Error('Sign in before accessing the forecast archive');
            const db = client();
            if (!db) throw new Error('Forecast archive connection unavailable');
            const {data, error} = await db.rpc(name, args);
            if (error) throw new Error(error.message || 'Forecast archive request failed');
            return data;
        }
        async function save(record) {
            const receipt = await rpc('archive_forecast', {p_record: record});
            if (receipt?.id !== record.id || !Number.isFinite(Date.parse(receipt.receivedAt))) throw new Error('Invalid forecast archive receipt');
            return receipt;
        }
        async function read(leagueId) {
            if (!leagueId) throw new Error('A league is required');
            const entries = [];
            let after = '';
            // Fail rather than mix accounts if the session changes during paging.
            const session = token();
            for (;;) {
                if (token() !== session) throw new Error('Account changed during archive read');
                const page = await rpc('read_forecast_archive', {p_league_id: String(leagueId), p_after: after});
                if (token() !== session) throw new Error('Account changed during archive read');
                if (!Array.isArray(page)) throw new Error('Invalid forecast archive page');
                for (const entry of page) {
                    if (entry?.record?.leagueId !== String(leagueId) || entry?.receipt?.id !== entry.record.id || entry.record.id <= after || !Number.isFinite(Date.parse(entry.receipt.receivedAt))) throw new Error('Invalid forecast archive entry');
                    after = entry.record.id;
                    entries.push(entry);
                }
                if (page.length < 25) return entries;
            }
        }
        return {save, read};
    }
    const api = {...createArchive(), createArchive};
    root.App = root.App || {}; root.App.ForecastArchive = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
