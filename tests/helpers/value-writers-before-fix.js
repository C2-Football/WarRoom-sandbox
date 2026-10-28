// Archived production functions from dhq-shared a3b99522da9a6086385c26841e6c6dfecdeb1cb5.
// Executed with the production Supabase bootstrap and pinned 2.101.1 client.
window.OD.recordValueSnapshot = function({ leagueId, playerId, season, week, ts, value, valueType, source, context }) {
    if (!isConfigured() || !hasOwnerIdentity()) return;
    const db = getClient();
    if (!db || leagueId == null || playerId == null || value == null) return;
    const owner = getOwnerIdentity();
    ensureUser(owner.username).then(() => {
        db.from('player_value_snapshots').upsert(
            {
                league_id: String(leagueId),
                player_id: String(playerId),
                season: Number(season),
                week: Number(week),
                ts: ts || new Date().toISOString(),
                value: Number(value),
                value_type: valueType,
                source,
                context: context || {},
                ...ownerCols(owner),
            },
            { onConflict: 'league_id,player_id,season,week,source', ignoreDuplicates: true }
        );
    }).catch(console.warn);
};

// Batch variant for periodic per-league capture (one round-trip for a whole roster).
window.OD.recordValueSnapshots = function(rows) {
    if (!isConfigured() || !hasOwnerIdentity() || !Array.isArray(rows) || !rows.length) return;
    const db = getClient();
    if (!db) return;
    const owner = getOwnerIdentity();
    const payload = rows
        .filter(r => r && r.leagueId != null && r.playerId != null && r.value != null)
        .map(r => ({
            league_id: String(r.leagueId),
            player_id: String(r.playerId),
            season: Number(r.season),
            week: Number(r.week),
            ts: r.ts || new Date().toISOString(),
            value: Number(r.value),
            value_type: r.valueType,
            source: r.source,
            context: r.context || {},
            ...ownerCols(owner),
        }));
    if (!payload.length) return;
    ensureUser(owner.username).then(() => {
        db.from('player_value_snapshots').upsert(
            payload,
            { onConflict: 'league_id,player_id,season,week,source', ignoreDuplicates: true }
        );
    }).catch(console.warn);
};

