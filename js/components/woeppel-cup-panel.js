function LegacyWoeppelCupPanel({ league, getOwnerName, myRoster }) {
    const key='wr_woeppel_v1_'+(league.league_id||league.id)+'_'+league.season;
    const blank=()=>({groups:{A:[],B:[],C:[]},drawMargin:4,weeks:{},locked:false});
    const [state,setState]=React.useState(()=>{try{const saved=JSON.parse(localStorage.getItem(key));if(!saved)return blank();if(!saved.groups||!saved.weeks||!['A','B','C'].every(g=>Array.isArray(saved.groups[g])))return blank();if(saved.locked){window.WoeppelCup.validate(saved);window.WoeppelCup.tables(saved);}return saved;}catch{return blank();}});
    const [honourNotice,setHonourNotice]=React.useState('');
    const [manage,setManage]=React.useState(false);
    const [rulingIds,setRulingIds]=React.useState(Array(8).fill(''));
    const [rulingReason,setRulingReason]=React.useState('');
    const [week,setWeek]=React.useState(()=>{const w=window.App?.LeagueLiveScores?.currentWeek?.(league);return [6,7,8,9,10,11,15,16,17].includes(w)?w:6;}),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
    const engine=window.WoeppelCup;
    const liveBoard=window.App?.LeagueLiveScores?.useScores?.({league,week,enabled:state.locked&&!state.weeks[week]?.final&&week<=window.App?.LeagueLiveScores?.currentWeek?.(league)})||null;
    const livePreview=engine.scorePreview(state,week,liveBoard);
    const displayState=livePreview.state||state;
    const displayWeek=displayState.weeks[week];
    const [access,setAccess]=React.useState({ready:false,canManage:false,revision:0,updatedAt:null});
    const [saving,setSaving]=React.useState(false);
    // An explicit save supersedes any older background refresh.
    const request=React.useRef({kind:null,generation:0});
    const [localDraft]=React.useState(state);
    const call=async body=>{const db=window.App?.OD?.getClient?.()||window.OD?.getClient?.();if(!db)throw Error('Sign in to connect the shared Cup.');const {data,error:err}=await db.functions.invoke('league-cup',{body:{leagueId:String(league.league_id||league.id),season:String(league.season),...body}});if(err){let message=err.message;try{message=(await err.context.json()).error||message;}catch{}throw Error(message);}if(data.error)throw Error(data.error);return data;};
    const refresh=async()=>{if(request.current.kind)return;const generation=++request.current.generation;request.current.kind='load';try{const data=await call({action:'load'});if(generation!==request.current.generation)return;setState(data.cup?.state||blank());setAccess({ready:true,canManage:data.canManage,revision:data.cup?.revision||0,updatedAt:data.cup?.updated_at});setError('');}catch(e){if(generation===request.current.generation)setError(e.message);}finally{if(generation===request.current.generation)request.current.kind=null;}};
    React.useEffect(()=>{refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);return()=>{clearInterval(timer);request.current.generation++;request.current.kind=null;};},[]);
    const save=async next=>{if(!access.canManage||request.current.kind==='save')return;const generation=++request.current.generation;request.current.kind='save';setSaving(true);try{const data=await call({action:'save',state:next,revision:access.revision});if(generation!==request.current.generation)return;setState(data.cup.state);setAccess({...access,revision:data.cup.revision,updatedAt:data.cup.updated_at});try{localStorage.setItem(key,JSON.stringify(data.cup.state));}catch{}setError('');}catch(e){if(generation===request.current.generation)setError(e.message);}finally{if(generation===request.current.generation){request.current.kind=null;setSaving(false);}}};
    const name=id=>getOwnerName(Number(id))||('Team '+id);
    const rosters=league.rosters||[];
    const assign=(id,g)=>{const next={...state,groups:Object.fromEntries(['A','B','C'].map(k=>[k,state.groups[k].filter(x=>x!==id)]))};if(g)next.groups[g].push(id);save(next);};
    let tables=null,rounds=[],bracketNote='';
    if(state.locked){try{tables=engine.tables(state);rounds=engine.knockout(state);}catch(e){bracketNote=e.message;}}
    const pull=async()=>{setBusy(true);setError('');try{const rows=await window.fetchMatchups(league.league_id||league.id,week);if(!Array.isArray(rows))throw Error('Scores unavailable.');const scores={};rows.forEach(r=>{if(typeof r.points==='number'&&Number.isFinite(r.points))scores[String(r.roster_id)]=r.points;});if(Object.values(state.groups).flat().some(id=>!Number.isFinite(scores[id])))throw Error('Not all twelve teams have scores yet.');save({...state,weeks:{...state.weeks,[week]:{scores,final:false,fetchedAt:new Date().toISOString()}}});}catch(e){setError(e.message);}finally{setBusy(false);}};
    const exportFile=()=>{const blob=new Blob([JSON.stringify({leagueId:String(league.league_id||league.id),season:String(league.season),state},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='woeppel-cup-'+league.season+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const myId=String(myRoster?.roster_id||'');
    const myGroup=tables&&Object.keys(tables).find(g=>tables[g].some(r=>r.id===myId));
    const myRow=myGroup?tables[myGroup].find(r=>r.id===myId):null;
    const matches=state.locked?(week<12?engine.fixtures(state).filter(f=>f.week===week):rounds.flat().filter(f=>f.week===week)):[];
    const mine=matches.find(f=>f.a===myId||f.b===myId);
    const champion=rounds[2]?.[0]?.winner;
    const score=id=>Number.isFinite(displayWeek?.scores[id])?displayWeek.scores[id].toFixed(2):'—';
    const archiveChampion=async()=>{if(!champion||!access.canManage)return;setSaving(true);try{const history=await call({action:'history'});const previous=history.records?.find(r=>r.season===String(league.season));if(!window.confirm((previous?'Update':'Record')+' the '+league.season+' Hall of Fame Cup result with '+name(champion)+' as champion?'))return;const final=rounds[2][0];const runner=final.a===champion?final.b:final.a;await call({action:'save-history',revision:previous?.revision||0,state:{winner:name(champion),runnerUp:name(runner),winnerScore:state.weeks[17].scores[champion],runnerScore:state.weeks[17].scores[runner],notes:'Confirmed from the finalized Woeppel Cup tracker.'}});setHonourNotice('Saved to Hall of Fame → Woeppel Cup.');}catch(e){setError(e.message);}finally{setSaving(false);}};
    const trophy=<svg className="cup-trophy" viewBox="0 0 80 96" aria-hidden="true"><path d="M22 10h36v25c0 16-8 25-18 25S22 51 22 35V10Z" fill="currentColor"/><path d="M22 17H9v13c0 13 8 20 19 20M58 17h13v13c0 13-8 20-19 20" fill="none" stroke="currentColor" strokeWidth="5"/><path d="M40 59v18M25 81h30M20 88h40" stroke="currentColor" strokeWidth="7"/><path d="m40 21 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#101b21"/></svg>;
    return <section className="cup-panel">
        <header className="cup-hero">{trophy}<div><span className="cup-eyebrow">CTB THE ONE · {league.season}</span><h2>WOEPPEL <em>CUP</em></h2><p>{champion?'The crown has a home.':state.locked?'Twelve teams. One name on the trophy.':'The road to the Cup starts with the draw.'}</p></div><div className="cup-hero-actions">{access.canManage&&<button aria-pressed={manage} onClick={()=>setManage(v=>!v)}>{manage?'Back to the Cup':'Manage Cup'}</button>}<button onClick={refresh} disabled={saving}>Refresh</button></div></header>
        {manage&&<div className="cup-admin-tools"><button onClick={exportFile}>Export backup</button><label hidden={!access.canManage}>Import backup<input type="file" accept="application/json" onChange={async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(data.leagueId!==String(league.league_id||league.id)||data.season!==String(league.season))throw Error('This backup belongs to another league or season.');engine.validate(data.state);if(!data.state.weeks || typeof data.state.weeks!=='object')throw Error('Invalid week data.');engine.tables(data.state);if(Object.values(data.state.groups).flat().some(id=>!rosters.some(r=>String(r.roster_id)===id)))throw Error('Unknown roster in backup.');if(!window.confirm('Replace the shared league Cup with this backup?'))return;save(data.state);}catch(err){setError(err.message);}}}/></label></div>}
        <div className="cup-stage-rail" aria-label="Tournament stages">{[['GROUPS','W6–11'],['QUARTERFINALS','W15'],['SEMIFINALS','W16'],['FINAL','W17']].map(([label,time],i)=><div key={label} className={(week<12?0:week-14)===i?'is-current':''}><span>{label}</span><b>{time}</b></div>)}</div>
        {champion&&<section className="cup-champion">{trophy}<div><span className="cup-eyebrow">WOEPPEL CUP CHAMPION</span><h3>{name(champion)}</h3><p>{league.season} · The last team standing.</p>{access.canManage&&<button disabled={saving} onClick={archiveChampion}>Record in Hall of Fame</button>}{honourNotice&&<p role="status">{honourNotice}</p>}</div></section>}
        {myRow&&<section className="cup-your-team"><div><span className="cup-eyebrow">YOUR CUP · GROUP {myGroup}</span><strong>{name(myId)}</strong></div><div><b>{myRow.points} PTS</b><span>{myRow.played?`Position ${tables[myGroup].indexOf(myRow)+1} · ${6-myRow.played} group games left`:'Group games have not started'}</span></div><div><strong>{mine?'vs '+name(mine.a===myId?mine.b:mine.a):'No fixture in this round'}</strong><span>{mine?score(myId)+' — '+score(mine.a===myId?mine.b:mine.a):'Follow the road to the Cup below'}</span></div></section>}
        <p>Group play W6–11 · Quarterfinals W15 · Semifinals W16 · Final W17</p>
        <p className="cup-note">Shared league Cup · {access.ready?(access.canManage?'Commissioner controls':'View only'):'Connecting…'}{saving?' · Saving…':''}{access.updatedAt?' · Updated '+new Date(access.updatedAt).toLocaleString():''}. Refreshes every 30 seconds.</p>
        {manage&&access.ready&&access.canManage&&access.revision===0&&Object.values(localDraft.groups).flat().length>0&&<button disabled={saving} onClick={()=>{if(window.confirm('Publish this device’s existing Cup as the shared league Cup?'))save(localDraft);}}>Publish existing local Cup</button>}
        {error&&<p role="alert">{error}</p>}
        {!state.locked&&!manage&&<div className="cup-awaiting"><span className="cup-eyebrow">DRAW NIGHT AWAITS</span><h3>Three groups. Four contenders each.</h3><p>The commissioner will reveal the groups here. Top two in each group and two wildcards advance.</p></div>}
        {!state.locked?<fieldset hidden={!manage} disabled={!access.canManage||saving||!access.ready} style={{border:0,padding:0,margin:0,minWidth:0}}><h3>Record the group draw</h3><p>Assign two Tier A and two Tier B teams to each group after Week 5. Tier calculation and the draw remain commissioner decisions.</p><div className="cup-setup">{rosters.map(r=><label key={r.roster_id}>{name(r.roster_id)}<select aria-label={'Group for '+name(r.roster_id)} value={Object.keys(state.groups).find(g=>state.groups[g].includes(String(r.roster_id)))||''} onChange={e=>assign(String(r.roster_id),e.target.value)}><option value="">Unassigned</option>{['A','B','C'].map(g=><option key={g}>{g}</option>)}</select></label>)}</div><label>Group draw threshold <select value={state.drawMargin} onChange={e=>save({...state,drawMargin:Number(e.target.value)})}><option value={4}>Within 4 points, inclusive</option><option value={0}>Exact-score ties only</option></select></label><button onClick={()=>{try{engine.validate(state);save({...state,locked:true});}catch(e){setError(e.message);}}}>Lock groups &amp; create fixtures</button></fieldset>:<>
        <div className="cup-tools"><select aria-label="Cup week" value={week} onChange={e=>setWeek(Number(e.target.value))}>{[6,7,8,9,10,11,15,16,17].map(w=><option key={w} value={w}>Week {w}{state.weeks[w]?.final?' · Final':''}</option>)}</select><fieldset hidden={!manage} disabled={!access.canManage||saving} style={{border:0,padding:0,display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={busy||state.weeks[week]?.final} onClick={pull}>{busy?'Loading…':'Fetch Sleeper scores'}</button><button disabled={!state.weeks[week]||state.weeks[week]?.final} onClick={()=>{if(window.confirm('Confirm Week '+week+' is complete and scores are final?'))save({...state,weeks:{...state.weeks,[week]:{...state.weeks[week],final:true}}});}}>Finalize week</button>{state.weeks[week]?.final&&<button onClick={()=>{if(window.confirm('Reopen this week? Standings and downstream bracket results will recalculate.'))save({...state,weeks:{...state.weeks,[week]:{...state.weeks[week],final:false}}});}}>Reopen week</button>}</fieldset></div>
        <p>{livePreview.live?'Live scores · auto refresh every 30s · not finalized':state.weeks[week]?.final?'Finalized':state.weeks[week]?'Preview only — not counted in standings':'No scores loaded'}{displayWeek?.fetchedAt?' · Updated '+new Date(displayWeek.fetchedAt).toLocaleTimeString():''}</p>
        <div className="cup-groups">{tables&&Object.entries(tables).map(([g,rows])=><section key={g}><div className="cup-group-head"><span className="cup-group-letter">{g}</span><div><h3>GROUP {g}</h3><span>Top 2 + wildcard race</span></div></div><table><thead><tr>{['Team','P','W-D-L','Pts','PF'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id} className={[r.id===myId?'is-mine':'',r.played?(i<2?'cup-top-two':i===2?'cup-wildcard':''):''].join(' ')}><td><span className="cup-rank">{r.played?i+1:'—'}</span>{name(r.id)}</td><td>{r.played}</td><td>{r.w}-{r.d}-{r.l}</td><td><b>{r.points}</b></td><td>{r.pf.toFixed(1)}</td></tr>)}</tbody></table><p data-mobile-caption className="cup-note">{rows.every(r=>r.played===6)?'Group play complete; qualification subject to tiebreaks.':'Positions are provisional, not clinched places.'}</p></section>)}</div>
        <div className="cup-section-heading"><h3>MATCHDAY {week<12?week-5:week-14}</h3><span>Week {week} · {state.weeks[week]?.final?'FINAL SCORES':'SCORE PREVIEW'}</span></div>
        <div className="cup-fixtures">{matches.map(f=>{const x=displayWeek?.scores[f.a],y=displayWeek?.scores[f.b];const close=Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=state.drawMargin;return <article key={f.a+'-'+f.b} className="cup-match"><span className="cup-eyebrow">{f.group?'GROUP '+f.group:'KNOCKOUT'}{close&&week<12?' · '+(state.weeks[week]?.final?'DRAW':'WITHIN DRAW RANGE'):''}</span><div><strong>{name(f.a)}</strong><b>{score(f.a)}</b></div><div><strong>{name(f.b)}</strong><b>{score(f.b)}</b></div>{f.winner&&<small>{name(f.winner)} advances</small>}</article>;})}</div>{!matches.length&&<p className="cup-note">Matchups appear when the previous stage is settled.</p>}
        <div className="cup-section-heading"><h3>ROAD TO THE CUP</h3><span>8 contenders → 1 champion</span></div>
        {bracketNote&&<p className="cup-note">{bracketNote}</p>}
        <div className="cup-bracket">{['Quarterfinals','Semifinals','Final'].map((title,i)=><section className="cup-round" key={title}><h4>{title} <span>W{15+i}</span></h4><div className="cup-round-matches">{Array.from({length:4/Math.pow(2,i)},(_,j)=>{const r=rounds[i]?.[j];return <article className="cup-bracket-match" key={j}>{[0,1].map(k=>{const id=r?.[k?'b':'a'];return <div className={id&&r.winner===id?'is-winner':''} key={k}><span>{id?name(id):i===0?'Qualifier TBD':`Winner ${i===1?'QF':'SF'} ${j*2+k+1}`}</span><b>{id&&Number.isFinite(displayState.weeks[15+i]?.scores[id])?displayState.weeks[15+i].scores[id].toFixed(2):'—'}</b></div>;})}</article>;})}</div></section>)}</div>
        </>}
        {manage && state.locked && access.canManage && <details><summary>Commissioner rulings</summary><p>Only use a seeding override to apply an unresolved tiebreak or a league-approved correction. Record the evidence (Cup Max PF, PA, or the agreed fallback). This overrides automatic qualification and seeding.</p><div className="cup-setup">{rulingIds.map((id,i)=><label key={i}>Seed {i+1}<select value={id} onChange={e=>setRulingIds(prev=>prev.map((x,k)=>k===i?e.target.value:x))}><option value="">Choose team</option>{rosters.map(r=><option key={r.roster_id} value={String(r.roster_id)}>{name(r.roster_id)}</option>)}</select></label>)}</div><input aria-label="Reason and evidence for seeding ruling" value={rulingReason} onChange={e=>setRulingReason(e.target.value)} placeholder="Reason and supporting tiebreak evidence"/><button disabled={!rulingReason.trim()||rulingIds.some(x=>!x)||new Set(rulingIds).size!==8} onClick={()=>{try{const next={...state,seedRuling:{ids:rulingIds,reason:rulingReason,at:new Date().toISOString()}};engine.bracket(next);if(window.confirm('Apply this commissioner seeding override?'))save(next);}catch(e){setError(e.message);}}}>Apply seeding ruling</button>{state.seedRuling&&<p>Seeding ruling: {state.seedRuling.reason} <button onClick={()=>save({...state,seedRuling:null})}>Restore automatic seeding</button></p>}{rounds.flat().filter(r=>state.weeks[r.week]?.final&&r.x===r.y).map(r=><div key={r.a}><p>Week {r.week}: {name(r.a)} / {name(r.b)} exact tie</p>{[r.a,r.b].map(id=><button key={id} onClick={()=>{const reason=window.prompt('Record the agreed tiebreak and evidence for advancing '+name(id));if(reason?.trim())save({...state,tieRulings:{...state.tieRulings,[r.week+':'+r.a+':'+r.b]:{winner:id,reason,at:new Date().toISOString()}}});}}>Advance {name(id)}</button>)}{state.tieRulings?.[r.week+':'+r.a+':'+r.b]&&<p>{state.tieRulings[r.week+':'+r.a+':'+r.b].reason}</p>}</div>)}</details>}
        <details><summary>Rules &amp; limits</summary><p>Group wins earn 3 points, draws 1. Standings use Cup points then Cup PF. Missing Max PF is never estimated: ties on those criteria block automatic seeding for commissioner review. Exact-score knockout ties also block advancement. No prize amount or payout is recorded until the conflicting bylaws are resolved.</p></details>
    </section>;
}


// Editing changes the tournament plan, never the underlying fantasy scores.
// Keep unaffected results final and require review from the first changed stage.
function prepareCupEdit(original, draft, engine) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fieldChanged = !same(original.teams, draft.teams);
    const roundRobinStage = format => ['round-robin', 'round-robin-double'].includes(format);
    const groupsChanged = (original.format === 'groups' || draft.format === 'groups') && !same(original.groups, draft.groups);
    const bracketChanged = original.format !== draft.format && roundRobinStage(original.format) && roundRobinStage(draft.format) || original.format === 'groups' && draft.format === 'groups' && original.knockoutStyle !== draft.knockoutStyle;
    const qualifyingChanged = fieldChanged || groupsChanged || original.format !== draft.format && !bracketChanged || original.startWeek !== draft.startWeek || original.drawMargin !== draft.drawMargin;
    let reviewFrom = qualifyingChanged ? Math.min(original.startWeek, draft.startWeek) : Infinity;
    if (original.groupWeeks !== draft.groupWeeks) reviewFrom = Math.min(reviewFrom, original.format === 'survivor' || draft.format === 'survivor' ? Math.min(original.startWeek, draft.startWeek) : Math.min(original.startWeek + original.groupWeeks, draft.startWeek + draft.groupWeeks));
    if (bracketChanged || original.qualifierCount !== draft.qualifierCount || original.knockoutStart !== draft.knockoutStart) reviewFrom = Math.min(reviewFrom, original.knockoutStart, draft.knockoutStart);
    const scheduled = new Set(engine.schedule(draft));
    const state = { ...draft, locked: true, enabled: original.enabled, weeks: {} };
    let omittedWeeks = 0, reviewWeeks = 0;
    for (const [week, record] of Object.entries(original.weeks || {})) {
        if (!scheduled.has(Number(week))) { omittedWeeks++; continue; }
        const scores = Object.fromEntries(Object.entries(record.scores || {}).filter(([id]) => draft.teams.includes(id)));
        const final = record.final && Number(week) < reviewFrom;
        if (record.final && !final) reviewWeeks++;
        state.weeks[week] = { ...record, scores, final };
    }
    const keepRuling = key => Number(key.split(':')[0]) < reviewFrom && scheduled.has(Number(key.split(':')[0]));
    state.tieRulings = Object.fromEntries(Object.entries(original.tieRulings || {}).filter(([key]) => keepRuling(key)));
    state.survivorRulings = Object.fromEntries(Object.entries(original.survivorRulings || {}).filter(([key]) => keepRuling(key)));
    state.seedRuling = qualifyingChanged || original.groupWeeks !== draft.groupWeeks || original.qualifierCount !== draft.qualifierCount ? null : original.seedRuling || null;
    engine.validate(state);
    return { state, reviewWeeks, omittedWeeks, changed: original.name !== draft.name || Number.isFinite(reviewFrom), structural: Number.isFinite(reviewFrom) };
}

function WoeppelCupPanel(props) {
    const { league, getOwnerName, myRoster } = props;
    const engine = window.WoeppelCup.tournament;
    const formats = engine.formats;
    const [saved, setSaved] = React.useState(null);
    const [draft, setDraft] = React.useState(() => engine.defaults(league));
    const [access, setAccess] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [connection, setConnection] = React.useState('');
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [explore, setExplore] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [showRules, setShowRules] = React.useState(false);
    const [sample, setSample] = React.useState(null);
    const [week, setWeek] = React.useState(null);
    const [scores, setScores] = React.useState({});
    const [seedIds, setSeedIds] = React.useState([]);
    const [survivorIds, setSurvivorIds] = React.useState([]);
    const [reason, setReason] = React.useState('');
    const touched = React.useRef(false);
    const inFlight = React.useRef(false);
    const name = id => id == null ? 'Bye' : getOwnerName?.(Number(id)) || 'Team ' + id;
    const myId = String(myRoster?.roster_id || '');
    const icons = { points: '◎', groups: '▦', 'round-robin': '↔', 'round-robin-double': '⇄', 'all-play': '✦', median: '↑', knockout: '⚡', survivor: '♜' };
    const isRoundRobin = s => ['round-robin', 'round-robin-double', 'groups'].includes(s.format);
    const isDouble = s => engine.isDoubleElimination(s);
    const isQualifier = s => !['knockout', 'survivor'].includes(s.format);
    const formatOf = s => formats.find(f => f.id === s.format) || formats[0];
    const call = async body => {
        const db = window.App?.OD?.getClient?.() || window.OD?.getClient?.();
        if (!db) throw Error('Sign in to connect your league tournament.');
        const { data, error: failure } = await db.functions.invoke('league-cup', { body: { leagueId: String(league.league_id || league.id), season: String(league.season), ...body } });
        if (failure) { let message = failure.message; try { message = (await failure.context.json()).error || message; } catch {} throw Error(message); }
        if (data?.error) throw Error(data.error);
        return data;
    };
    const load = async () => {
        if (inFlight.current || editing) return;
        inFlight.current = true;
        setBusy(true);
        try {
            const data = await call({ action: 'load' });
            setSaved(data.cup?.state || null);
            if (!touched.current) setDraft(data.cup?.state || engine.defaults(league));
            setAccess({ canManage: data.canManage, revision: data.cup?.revision || 0 });
            setConnection('');
        } catch (e) { setConnection(e.message); }
        finally { inFlight.current = false; setBusy(false); }
    };
    React.useEffect(() => { load(); }, []);
    const save = async next => {
        if (!access?.canManage || connection || busy || sample || inFlight.current) return;
        try { engine.validate(next); } catch (e) { setError(e.message); return; }
        inFlight.current = true;
        setBusy(true);
        setSaving(true);
        setError(''); setNotice('');
        try {
            const data = await call({ action: 'save', revision: access.revision, state: next });
            setSaved(data.cup.state); setDraft(data.cup.state); touched.current = false;
            setAccess({ ...access, revision: data.cup.revision }); setError('');
            setNotice(next.locked ? 'Saved & locked for your league.' : 'Draft saved for your league. Save & lock when you’re ready.');
            if (editing) setNotice('Cup changes saved.' + (editPreview?.reviewWeeks ? ' ' + editPreview.reviewWeeks + ' affected score week' + (editPreview.reviewWeeks === 1 ? ' needs' : 's need') + ' review.' : editPreview?.structural ? '' : ' Existing results kept.'));
            setEditing(false);
            if (next.locked) setExplore(false);
        } catch (e) { setError(e.message); }
        finally { inFlight.current = false; setBusy(false); setSaving(false); }
    };
    const editDraft = value => { if (inFlight.current) return; touched.current = true; setDraft(value); setError(''); setNotice(''); };
    const update = (key, value) => editDraft(d => ({ ...d, [key]: value }));
    const changePlan = transform => { try { editDraft(transform(draft)); } catch (e) { setError(e.message); } };
    const planChampionship = (value, week) => ({ ...engine.withChampionshipWeek({ ...value, weeks: {}, seedRuling: null, tieRulings: {}, survivorRulings: {} }, week), weeks: value.weeks, seedRuling: value.seedRuling, tieRulings: value.tieRulings, survivorRulings: value.survivorRulings });
    const keepChampionship = transform => changePlan(d => planChampionship(transform(d), engine.championshipWeek(d)));
    const chooseFormat = id => {
        if (id === draft.format) return;
        try {
            const next = engine.configure(league, id, draft);
            if (editing && ['round-robin', 'round-robin-double'].includes(draft.format) && ['round-robin', 'round-robin-double'].includes(id)) {
                Object.assign(next, { startWeek: draft.startWeek, groupWeeks: draft.groupWeeks, knockoutStart: draft.knockoutStart, qualifierCount: draft.qualifierCount });
            }
            if (draft.name === 'League Cup' || formats.some(f => f.name === draft.name)) next.name = formats.find(f => f.id === id).name;
            // Keep the user's chosen final when switching formats whenever it fits.
            const target = engine.championshipWeek(draft);
            let planned = next;
            try { planned = engine.withChampionshipWeek(next, target); } catch {}
            editDraft(planned);
            if (engine.championshipWeek(planned) !== target) setNotice('This format needs a different schedule. The suggested championship is Week ' + engine.championshipWeek(planned) + '; choose your preferred final below.');
        } catch (e) { setError(e.message); }
    };
    const active = sample || (saved?.locked && !explore && !editing ? saved : null);
    const state = active || draft;
    let schedule = [], setupError = '', rows = [], groupRows = {}, rounds = [], survival = [], result = null, bracketNote = '';
    let editPreview = null;
    try { if (editing) editPreview = prepareCupEdit(saved, draft, engine); else engine.validate(draft); } catch (e) { setupError = e.message; }
    try { schedule = engine.schedule(state); } catch {}
    const currentWeek = window.App?.LeagueLiveScores?.currentWeek?.(league);
    const selectedWeek = schedule.includes(week) ? week : schedule.includes(currentWeek) ? currentWeek : schedule[0];
    const liveBoard = window.App?.LeagueLiveScores?.useScores?.({ league, week: selectedWeek,
        enabled: !!active && active.version === 2 && !sample && active.enabled && !active.weeks[selectedWeek]?.final && selectedWeek <= currentWeek }) || null;
    const livePreview = window.WoeppelCup.scorePreview(active, selectedWeek, liveBoard);
    const displayState = livePreview.state || active;
    let displayRounds = [];
    try { if (displayState && displayState.format !== 'survivor') displayRounds = engine.knockout(displayState); } catch (_) { /* prior rounds remain unresolved */ }
    const displayScore = id => displayState?.weeks[selectedWeek]?.scores[id];
    React.useEffect(() => { setScores(active?.weeks?.[selectedWeek]?.scores || {}); setSurvivorIds([]); }, [active, selectedWeek]);
    if (saved && saved.version !== 2) return <LegacyWoeppelCupPanel {...props}/>;
    if (active) {
        try {
            rows = engine.tables(active);
            if (active.format === 'groups') groupRows = engine.groupTables(active);
            if (active.format === 'survivor') survival = engine.survivor(active);
            else rounds = engine.knockout(active);
            result = engine.result(active);
        } catch (e) { bracketNote = e.message; }
    }
    const viewFormat = formatOf(state), chosen = formatOf(draft);
    let groupPlan = null;
    if (draft.format === 'groups') { try { groupPlan = engine.groupConfig(draft); } catch {} }
    const championship = engine.championshipWeek(draft);
    const currentSurvival = survival.find(r => r.week === selectedWeek);
    let requiredTeams = [], scoresBlocked = '';
    if (active) { try { requiredTeams = engine.requiredScoreIds(active, selectedWeek); } catch (e) { scoresBlocked = e.message; } }
    const formatWeeks = s => { try { const weeks = engine.schedule(s); return weeks.length ? 'W' + weeks[0] + '–' + weeks[weeks.length - 1] : 'Choose dates'; } catch { return 'Choose dates'; } };
    const clearAfter = (s, from, include = true) => ({
        ...s,
        weeks: Object.fromEntries(Object.entries(s.weeks).map(([w, data]) => [w, Number(w) >= from + (include ? 0 : 1) ? { ...data, final: false } : data])),
        tieRulings: Object.fromEntries(Object.entries(s.tieRulings || {}).filter(([key]) => Number(key.split(':')[0]) < from + (include ? 0 : 1))),
        survivorRulings: Object.fromEntries(Object.entries(s.survivorRulings || {}).filter(([key]) => Number(key) < from + (include ? 0 : 1))),
        ...(isQualifier(s) && from < s.knockoutStart ? { seedRuling: null } : {})
    });
    const startSample = () => {
        if (setupError) return;
        setSample({ ...draft, enabled: true, locked: true, weeks: {}, seedRuling: null, tieRulings: {}, survivorRulings: {} });
        setExplore(false); setWeek(null); setNotice(''); setError('');
    };
    const sampleWeek = () => {
        const nextWeek = engine.schedule(sample).find(w => !sample.weeks[w]?.final);
        if (!nextWeek) return;
        // Illustrative, unique scores: separate from every live league score.
        const values = Object.fromEntries(sample.teams.map((id, i) => [id, Math.round((80 + ((i * 37 + nextWeek * 23) % 79) + i / 100) * 100) / 100]));
        let next = { ...sample, weeks: { ...sample.weeks, [nextWeek]: { final: true, scores: values } } };
        // All-play/median sample ties use a declared sample-only points tiebreak.
        if (isQualifier(next) && nextWeek === next.startWeek + next.groupWeeks - 1) {
            try { engine.qualifiers(next); } catch {
                const order = next.format === 'groups' ? Object.values(engine.groupTables(next)).flatMap(group => group.slice(0, next.qualifiersPerGroup).map(r => r.id)) : engine.tables(next).map(r => r.id).slice(0, next.qualifierCount);
                next.seedRuling = { ids: order, reason: 'Sample only: tied seeds use the displayed order.' };
            }
        }
        setSample(next); setWeek(nextWeek);
    };
    const persistScores = finalize => {
        let required;
        try { required = engine.requiredScoreIds(active, selectedWeek); } catch (e) { setError(e.message); return; }
        const parsed = {};
        for (const id of required) {
            if (scores[id] === '' || scores[id] === undefined || !Number.isFinite(Number(scores[id]))) { setError('Enter a score for every team competing this week, including zero where appropriate.'); return; }
            parsed[id] = Number(scores[id]);
        }
        const next = clearAfter(active, selectedWeek);
        save({ ...next, weeks: { ...next.weeks, [selectedWeek]: { scores: parsed, final: finalize } } });
    };
    const pull = async () => {
        setBusy(true);
        try {
            const data = await window.fetchMatchups(league.league_id || league.id, selectedWeek);
            if (!Array.isArray(data)) throw Error('Scores are unavailable. Enter them manually.');
            const values = data.map(r => [String(r.roster_id), Number.isFinite(r.custom_points) ? r.custom_points : r.points]);
            setScores(Object.fromEntries(values.filter(([, value]) => Number.isFinite(value))));
            setNotice('Scores loaded for review. Finalize after the week and stat corrections are complete.'); setError('');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const archive = async () => {
        if (!result || sample) return;
        setBusy(true);
        try {
            const history = await call({ action: 'history' }), previous = history.records?.find(r => r.season === String(league.season));
            if (previous && !window.confirm('Replace this season’s existing Cup honour?')) return;
            await call({ action: 'save-history', revision: previous?.revision || 0, state: { cupName: active.name, winner: name(result.champion), runnerUp: result.runnerUp ? name(result.runnerUp) : '', winnerScore: result.winnerScore, runnerScore: result.runnerScore, notes: 'Confirmed from the finalized ' + active.name + ' tournament (' + viewFormat.name + ').' } });
            setNotice('Champion recorded in Hall of Fame → Cup history.');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const roundLabel = (index, count) => count - index === 1 ? 'Final' : count - index === 2 ? 'Semifinals' : count - index === 3 ? 'Quarterfinals' : 'Round ' + (index + 1);
    const canManage = access?.canManage && !sample;
    const signInUrl = (window.location?.pathname?.includes('/dist-preview/') ? '../login.html' : 'login.html') + '?reauth=1';
    const saveBlocked = !canManage || !!connection || busy || !!setupError;
    const saveStatus = saving ? 'Saving your Cup…' : busy || !access && !connection ? 'Checking your Cup connection…'
        : connection ? 'Couldn’t connect. Retry or sign in to save your Cup.'
        : !canManage ? 'Sign in as this league’s commissioner to save your Cup.'
        : error || setupError || (editing ? (touched.current ? 'Unsaved Cup changes.' + (editPreview?.reviewWeeks ? ' ' + editPreview.reviewWeeks + ' score week' + (editPreview.reviewWeeks === 1 ? ' needs' : 's need') + ' review.' : '') + (editPreview?.omittedWeeks ? ' ' + editPreview.omittedWeeks + ' outside the new schedule will be removed.' : '') : 'Your saved Cup is ready to edit.') : saved ? (touched.current ? 'Unsaved changes · save & lock when ready.' : 'Draft saved · ready to lock in.') : 'Ready to save for your league.');
    const beginEditing = () => {
        if (!access?.canManage || !saved?.locked || busy || inFlight.current || connection || sample) return;
        setDraft(saved); touched.current = false; setEditing(true); setExplore(false); setShowRules(false); setNotice(''); setError('');
    };
    const cancelEditing = () => {
        if (inFlight.current) return;
        setDraft(saved || engine.defaults(league)); touched.current = false; setEditing(false); setExplore(false); setSample(null); setError(''); setNotice('');
    };
    const saveEdits = () => { if (editing && editPreview?.changed && !saveBlocked) save(editPreview.state); };
    const points = value => Number.isFinite(value) ? value.toFixed(2) : '—';
    const fixtures = active && isQualifier(active) && selectedWeek < active.knockoutStart ? engine.fixtures(active).filter(f => f.week === selectedWeek) : displayRounds.flat().filter(f => f.week === selectedWeek);
    const fixtureGroups = [...fixtures.reduce((groups, fixture) => {
        const label = fixture.group ? 'Group ' + fixture.group : fixture.stageLabel || 'Matchups';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(fixture);
        return groups;
    }, new Map())];
    const rulesPanel = active && showRules && <section className="cup-rules" aria-label="Cup rules"><div className="cup-section-heading"><h3>{viewFormat.name} rules</h3><button type="button" onClick={() => setShowRules(false)}>Close rules</button></div><p>{viewFormat.description} {active.format === 'all-play' ? 'Earn 1 Cup point for every opponent beaten and half a point for each tied opponent.' : active.format === 'median' ? 'Earn 1 Cup point above the field’s median score, half a point on the median, and 0 below it.' : isRoundRobin(active) ? 'Wins earn 3 Cup points and draws earn 1; PF breaks standings ties.' : active.format === 'points' ? 'Total qualifying fantasy points set the seeds.' : active.format === 'survivor' ? 'Each round removes enough low scorers to leave one champion in the final week. Only that week’s score determines survival.' : 'Seed order sets the opening bracket. Highest seeds receive byes when needed.'} {isQualifier(active) && (isDouble(active) ? 'Qualifiers enter upper and lower brackets. A second loss eliminates a team. If the unbeaten finalist loses the championship, both finalists play a reset the following week.' : 'The selected qualifiers enter a seeded knockout bracket; PF breaks Cup-points ties.')} Finalized scores count; unresolved exact ties require a commissioner ruling. {sample ? 'This is a sample with illustrative scores.' : 'One shared Cup is stored per league season.'}</p></section>;
    return <section className={'cup-panel cup-studio' + (active ? ' cup-follow' : '')} aria-label="League Cup">
        <header className="cup-hero">
            <span className="cup-studio-emblem" aria-hidden="true">🏆</span>
            <div><span className="cup-eyebrow">{league.name} · {league.season}</span><h2>{editing ? 'Edit ' + saved.name : active ? active.name : 'Make it a Cup season.'}</h2><p>{active ? viewFormat.tagline : 'Choose your competition. Make every week count.'}</p></div>
            <div className="cup-hero-actions">
                {active && canManage && <button type="button" className="cup-primary" disabled={busy || !!connection} onClick={beginEditing}>Edit Cup</button>}
                {active && <details className="cup-options"><summary>Cup options</summary><div>
                    <button type="button" onClick={event => { setShowRules(value => !value); event?.currentTarget?.closest('details')?.removeAttribute('open'); }}>{showRules ? 'Hide rules' : 'Rules'}</button>
                    <button type="button" disabled={busy} onClick={() => { setSample(null); setExplore(true); setShowRules(false); setError(''); }}>Explore formats</button>
                    <button type="button" disabled={busy} onClick={load}>{busy ? 'Connecting…' : 'Refresh Cup'}</button>
                </div></details>}
                {saved?.locked && !active && <button type="button" disabled={busy} onClick={cancelEditing}>{editing ? 'Cancel editing' : 'Back to your Cup'}</button>}
                {!active && !editing && <button type="button" disabled={busy} onClick={load}>{busy ? 'Connecting…' : 'Refresh Cup'}</button>}
            </div>
        </header>
        {error && <p className="cup-message" role="alert">{error}</p>}{notice && <p className="cup-message" role="status">{notice}</p>}
        {editing && /changed.*session|refresh before/i.test(error) && <p className="cup-note">Your edits are kept here. Cancel editing and refresh to review the newer saved Cup.</p>}
        {rulesPanel}
        {!sample && (connection || (!active && access && !access.canManage)) && <div className="cup-connection"><strong>{connection ? 'Explore now. Connect to save.' : 'Commissioner access is needed to save & lock.'}</strong><span>{connection ? 'Format previews work here. Shared setup needs a verified commissioner account.' : 'This sign-in can view the Cup. To save, use your commissioner’s Sleeper username and Dynasty HQ password, or a site administrator account.'}</span>{connection && <details><summary>Connection details</summary><p>{connection}</p></details>}<a href={(window.location?.pathname?.includes('/dist-preview/') ? '../login.html' : 'login.html') + '?reauth=1'}>Open sign-in</a></div>}
        {!active && <>
            {editing && <section className="cup-edit-notice" aria-label="Cup changes"><strong>Your saved Cup stays active until you save.</strong><p>{editPreview?.reviewWeeks ? editPreview.reviewWeeks + ' finalized score week' + (editPreview.reviewWeeks === 1 ? ' will need' : 's will need') + ' review. Earlier results and compatible scores are kept.' : 'Existing scores are kept. Changes to the field, format or dates may require results to be reviewed.'}</p>{!!editPreview?.omittedWeeks && <p>{editPreview.omittedWeeks} score week{editPreview.omittedWeeks === 1 ? ' falls' : 's fall'} outside the new schedule and will be removed from this Cup.</p>}</section>}
            <div className="cup-format-chooser">
                <div className="cup-section-heading"><h3>CHOOSE YOUR COMPETITION</h3><span>Uses your league’s weekly fantasy scores</span></div>
                <div className="cup-format-grid" role="radiogroup" aria-label="Cup format">
                    {formats.map(f => <button type="button" role="radio" data-format={f.id} disabled={busy} aria-checked={draft.format === f.id} className={'cup-format-card' + (draft.format === f.id ? ' is-selected' : '')} key={f.id} onClick={() => chooseFormat(f.id)}>
                        <span className="cup-format-icon" aria-hidden="true">{icons[f.id]}</span><span className="cup-format-copy"><strong>{f.name}</strong><span>{f.tagline}</span><small>{f.description}</small></span><span className="cup-format-check" aria-hidden="true">{draft.format === f.id ? '✓' : '○'}</span>
                    </button>)}
                </div>
                <div className="cup-format-detail" aria-live="polite"><span className="cup-eyebrow">Selected · {chosen.name}</span><span>{formatWeeks(draft)} · {draft.teams.length} teams</span><p>{chosen.description}</p></div>
            </div>
            <div className="cup-plan-layout">
                <form className="cup-plan-form" onSubmit={e => { e.preventDefault(); if (editing) saveEdits(); else if (!saved?.locked) save({ ...draft, enabled: true, locked: true }); }}>
                    <fieldset className="cup-plan-controls" disabled={busy}>
                    <h3>Make it yours</h3><label className="cup-field">Cup name<input maxLength={80} required value={draft.name} onChange={e => update('name', e.target.value)} placeholder="Your league’s next tradition"/></label>
                    <div className="cup-finish-choice"><label className="cup-field">Which week should the championship game be?<select aria-label="Championship week" value={championship} onChange={e => changePlan(d => planChampionship(d, Number(e.target.value)))}>{Array.from({ length: 18 }, (_, i) => i + 1).map(w => <option key={w} value={w}>Week {w}</option>)}</select></label><p className="cup-note">{isDouble(draft) ? 'Championship in Week ' + championship + ' · Week ' + (championship + 1) + ' reserved for a reset if the unbeaten finalist loses.' : 'The schedule works back from your final in Week ' + championship + '.'}</p></div>
                    {draft.format === 'groups' && groupPlan && <div className="cup-plan-fields cup-group-options">
                        <label className="cup-field">Groups<select aria-label="Number of groups" value={groupPlan.groupCount} onChange={e => changePlan(d => engine.withGroupConfig(d, { groupCount: Number(e.target.value) }))}>{[2, 4, 8, 16, 32].filter(n => n <= Math.floor(draft.teams.length / 2)).map(n => <option key={n} value={n}>{n} groups</option>)}</select></label>
                        <label className="cup-field">Advance from each<select aria-label="Qualifiers per group" value={groupPlan.qualifiersPerGroup} onChange={e => changePlan(d => engine.withGroupConfig(d, { qualifiersPerGroup: Number(e.target.value) }))}>{[1, 2, 4, 8, 16, 32].filter(n => n <= groupPlan.minGroupSize).map(n => <option key={n} value={n}>Top {n}</option>)}</select></label>
                        <label className="cup-field">Knockout rounds<select aria-label="Knockout style" value={draft.knockoutStyle} onChange={e => changePlan(d => engine.withGroupConfig(d, { knockoutStyle: e.target.value }))}><option value="single">Single elimination</option><option value="double">Double elimination</option></select></label>
                    </div>}
                    <div className="cup-plan-fields">
                    {draft.format !== 'knockout' && <label className="cup-field">{draft.format === 'survivor' ? 'Survival weeks' : draft.format === 'groups' ? 'Group-stage weeks' : 'Qualifying weeks'}<input aria-label={draft.format === 'groups' ? 'Group-stage weeks' : draft.format === 'survivor' ? 'Survival weeks' : 'Qualifying weeks'} type="number" min="1" max="18" value={draft.groupWeeks} onChange={e => { const count = Number(e.target.value); keepChampionship(d => ({ ...d, groupWeeks: count, ...(isQualifier(d) ? { knockoutStart: d.startWeek + count } : {}) })); }}/></label>}
                    {isQualifier(draft) && draft.format !== 'groups' && <label className="cup-field">Teams advancing<select aria-label="Teams advancing" value={draft.qualifierCount} onChange={e => keepChampionship(d => ({ ...d, qualifierCount: Number(e.target.value) }))}>{[2, 4, 8, 16, 32, 64].filter(n => n <= draft.teams.length).map(n => <option key={n} value={n}>{n} teams</option>)}</select></label>}
                    <div className="cup-schedule-readout"><span>Starts</span><strong>Week {draft.startWeek}</strong>{isQualifier(draft) && <small>{draft.format === 'groups' ? 'Groups' : 'Qualifying'} → {draft.qualifierCount}-team bracket</small>}</div></div>
                    {draft.format === 'groups' && <section className="cup-draw-preview" aria-label="Group draw"><div className="cup-section-heading"><h3>Group draw</h3><span>Top {draft.qualifiersPerGroup} from each advance</span></div><div className="cup-draw-grid">{Object.entries(draft.groups || {}).map(([group, ids]) => <div key={group}><strong>Group {group}</strong><span>{ids.map(id => name(id)).join(' · ')}</span></div>)}</div><p className="cup-note">Play everyone in your group. Adjust assignments in the advanced settings.</p></section>}
                    <details><summary>Teams, seeding &amp; advanced rules · {draft.teams.length} entered</summary>
                        <div className="cup-participants">{(league.rosters || []).map(r => { const id = String(r.roster_id); return <label key={id}><input type="checkbox" checked={draft.teams.includes(id)} onChange={e => { const teams = e.target.checked ? [...draft.teams, id] : draft.teams.filter(x => x !== id); keepChampionship(d => engine.configure(league, d.format, { ...d, teams })); }}/>{name(id)}</label>; })}</div>
                        {draft.format === 'groups' && <div className="cup-group-assignments"><p className="cup-note">Keep groups balanced, with each team assigned once.</p>{draft.teams.map(id => <label className="cup-field" key={id}>{name(id)}<select aria-label={'Group for ' + name(id)} value={Object.keys(draft.groups || {}).find(g => draft.groups[g].includes(id)) || ''} onChange={e => { const target = e.target.value; update('groups', Object.fromEntries(Object.entries(draft.groups).map(([g, ids]) => [g, [...ids.filter(value => value !== id), ...(g === target ? [id] : [])]]))); }}>{Object.keys(draft.groups || {}).map(g => <option key={g} value={g}>Group {g}</option>)}</select></label>)}</div>}
                        {draft.format === 'knockout' && <div className="cup-seeding"><p>Seed order sets the bracket. The highest seeds receive any first-round byes.</p>{draft.teams.map((id, i) => <div key={id}><span><b>{i + 1}</b> {name(id)}</span><button type="button" disabled={i === 0} aria-label={'Move ' + name(id) + ' up one seed'} onClick={() => { const teams = [...draft.teams]; [teams[i - 1], teams[i]] = [teams[i], teams[i - 1]]; update('teams', teams); }}>↑</button></div>)}</div>}
                        <label className="cup-field">First week<input aria-label="First Cup week" type="number" min="1" max="18" value={draft.startWeek} onChange={e => { const start = Number(e.target.value); editDraft(d => ({ ...d, startWeek: start, knockoutStart: d.knockoutStart + start - d.startWeek })); }}/></label>
                        {isQualifier(draft) && <label className="cup-field">First knockout week<input type="number" min="2" max="18" value={draft.knockoutStart} onChange={e => update('knockoutStart', Number(e.target.value))}/></label>}
                        {isRoundRobin(draft) && <label className="cup-field">Draw margin · fantasy points<input type="number" min="0" max="100" step="0.01" value={draft.drawMargin} onChange={e => update('drawMargin', Number(e.target.value))}/></label>}
                        <button type="button" onClick={() => editDraft(d => engine.configure(league, d.format, d))}>Suggest dates for this field</button>
                    </details>
                    {setupError && <p className="cup-validation" role="status">{setupError}</p>}
                    {!editing && <div className="cup-plan-actions"><button type="button" disabled={!!setupError || busy} onClick={startSample}>Try a sample Cup <span aria-hidden="true">→</span></button></div>}
                    {(!saved?.locked || editing) && <div className="cup-save-actions" aria-label={editing ? 'Save Cup changes' : 'Save league Cup'} aria-busy={busy}>
                        <p className="cup-note" role="status">{saveStatus}</p>
                        {!busy && (connection || access && !canManage) && <div className="cup-save-recovery">{connection && <button type="button" onClick={load}>Retry connection</button>}<a href={signInUrl}>Sign in to save</a></div>}
                        <div className="cup-plan-actions">{editing ? <><button type="button" className="cup-primary" disabled={saveBlocked || !editPreview?.changed} onClick={saveEdits}>{saving ? 'Saving…' : 'Save Cup changes'}</button><button type="button" disabled={busy} onClick={cancelEditing}>Cancel</button></> : <><button type="button" className="cup-primary" disabled={saveBlocked} onClick={() => save({ ...draft, enabled: true, locked: true })}>{saving ? 'Saving…' : 'Save & lock Cup'}</button><button type="button" disabled={saveBlocked} onClick={() => save({ ...draft, enabled: true, locked: false })}>Save draft</button></>}</div>
                    </div>}
                    <p className="cup-note">{editing ? 'Saving keeps the Cup locked for your league. Review affected results before finalizing them again.' : 'Save & lock confirms the teams, format and dates for everyone. Commissioners can return to Edit Cup to adjust the setup.'}</p>
                    </fieldset>
                </form>
                <aside className="cup-plan-preview" aria-label="Tournament preview"><span className="cup-eyebrow">YOUR CUP AT A GLANCE</span><h3>{draft.name || chosen.name}</h3><p>{chosen.description}</p><div className="cup-plan-numbers"><div><strong>{draft.teams.length}</strong><span>teams</span></div><div><strong>{setupError ? '—' : engine.schedule(draft).length}</strong><span>game weeks</span></div><div><strong>1</strong><span>champion</span></div></div><div className="cup-plan-road"><span>{formatWeeks(draft)} · Championship W{championship}</span><strong>{draft.format === 'survivor' ? 'Survive each cut → Last team standing' : draft.format === 'knockout' ? 'Win and advance → Championship' : (draft.format === 'groups' ? draft.groupCount + ' groups → Top ' + draft.qualifiersPerGroup + ' each → ' : 'Qualify → ') + draft.qualifierCount + '-team ' + (isDouble(draft) ? 'double-elimination ' : '') + 'bracket → Championship'}</strong></div><p className="cup-note">{draft.format === 'groups' ? 'Wins earn 3 Cup points; draws earn 1. Qualify within your group, then ' + (isDouble(draft) ? 'stay alive until a second bracket loss. The final can reset.' : 'win each knockout to lift the trophy.') : isDouble(draft) ? 'A full round robin sets the seeds. Two bracket losses eliminate a team; the final can reset.' : isRoundRobin(draft) ? 'Every team plays a full cycle. Odd fields get rotating byes.' : draft.format === 'survivor' ? 'Only this week’s score decides the cut. Earlier points cannot save you.' : draft.format === 'knockout' ? 'One loss ends the run. Set seeds before starting.' : 'Your normal lineup counts. No extra roster to manage.'}</p></aside>
            </div>
        </>}
        {active && <>
            {!sample && <div className="cup-locked-status" role="status"><strong>✓ Saved &amp; locked</strong><span>{active.name} · {active.teams.length} teams · {formatWeeks(active)}</span></div>}
            {sample && <div className="cup-sample-banner"><div><strong>SAMPLE CUP · MADE-UP SCORES</strong><span>Play through the format. Your league Cup is unchanged.</span></div><button className="cup-primary" disabled={!!result || engine.schedule(sample).every(w => sample.weeks[w]?.final)} onClick={sampleWeek}>{result ? 'Sample complete' : 'Play next sample week'}</button><button onClick={() => { setSample({ ...sample, weeks: {}, seedRuling: null, tieRulings: {}, survivorRulings: {} }); setWeek(null); }}>Restart sample</button></div>}
            <div className="cup-live-summary"><span>{viewFormat.name}</span>{active.format === 'groups' && <span>{isDouble(active) ? 'Double elimination' : 'Single elimination'}</span>}<span>{active.teams.length} teams</span><span>{formatWeeks(active)} · Final W{engine.championshipWeek(active)}</span><span>{sample ? 'Preview' : active.enabled ? 'Active' : 'Paused'}</span>{!sample && !canManage && <span>View only</span>}</div>
            {result && <div className="cup-champion"><span className="cup-studio-emblem" aria-hidden="true">🏆</span><div><span className="cup-eyebrow">{sample ? 'SAMPLE CHAMPION' : active.name + ' CHAMPION'}</span><h3>{name(result.champion)}</h3>{result.runnerUp && <p>Runner-up: {name(result.runnerUp)} · {points(result.winnerScore)}–{points(result.runnerScore)}</p>}{canManage && <button disabled={busy} onClick={archive}>Record in Hall of Fame</button>}</div></div>}
            {active.teams.includes(myId) && <div className="cup-your-team"><div><span className="cup-eyebrow">YOUR CUP</span><strong>{name(myId)}</strong></div><div><strong>{result?.champion === myId ? 'Champion' : active.format === 'survivor' ? survival.some(r => r.eliminated?.includes(myId)) ? 'Eliminated' : 'Still in the hunt' : rounds.flat().filter(r => r.winner && [r.a, r.b].includes(myId) && r.winner !== myId).length >= (isDouble(active) ? 2 : 1) ? 'Knocked out' : isDouble(active) ? 'Still in the hunt' : 'Follow your road to the trophy'}</strong><span>{sample ? 'Sample results' : 'Finalized results only'}</span></div></div>}
            <div className="cup-tools"><label>Week<select aria-label="Tournament week" value={selectedWeek} onChange={e => setWeek(Number(e.target.value))}>{schedule.map(w => <option key={w} value={w}>Week {w}{isDouble(active) && w >= active.knockoutStart ? ' · ' + (w === active.knockoutStart + engine.roundCount(active) - 1 ? 'Reset' : w === active.knockoutStart + engine.roundCount(active) - 2 ? 'Final' : 'Bracket') : ''}{active.weeks[w]?.final ? ' · Final' : ''}</option>)}</select></label><span className="cup-note">{livePreview.live ? 'Live scores · auto refresh every 30s · not finalized' : active.weeks[selectedWeek]?.final ? 'Finalized' : active.weeks[selectedWeek] ? 'Score preview · not counted yet' : 'Awaiting scores'}</span></div>
            {isQualifier(active) && <div className={'cup-groups cup-qualification' + (active.format === 'groups' ? ' cup-group-tables' : '')}>{(active.format === 'groups' ? Object.entries(groupRows) : [['', rows]]).map(([group, standings]) => <section key={group}>
                <div className="cup-section-heading"><h3>{group ? 'Group ' + group : 'Qualification race'}</h3><span>Top {group ? active.qualifiersPerGroup : active.qualifierCount} advance</span></div>
                <table className="cup-standings" aria-label={group ? 'Group ' + group + ' standings' : 'Cup qualification standings'}>
                    <thead><tr><th scope="col">Team</th><th scope="col" className="cup-standings-played">Weeks / games</th><th scope="col" className="cup-standings-points">{active.format === 'points' ? 'Fantasy points' : 'Cup points'}</th><th scope="col" className="cup-standings-pf"><abbr title="Fantasy points for">PF</abbr></th></tr></thead>
                    <tbody>{standings.map((r, i) => <tr key={r.id} className={[r.id === myId ? 'is-mine' : '', group && i === active.qualifiersPerGroup - 1 ? 'cup-advance-line' : ''].join(' ')}>
                        <th scope="row" className="cup-standings-team"><div className="cup-standing-identity"><span className="cup-rank" aria-label={'Rank ' + (i + 1)}>{i + 1}</span><span className="cup-standing-owner"><span className="cup-standing-name">{name(r.id)}</span><span className="cup-standing-played">{r.played} {isRoundRobin(active) ? (r.played === 1 ? 'game' : 'games') : (r.played === 1 ? 'week' : 'weeks')}</span></span></div></th>
                        <td className="cup-standings-played">{r.played}</td><td className="cup-standings-points"><b>{points(r.points)}</b></td><td className="cup-standings-pf">{points(r.pf)}</td>
                    </tr>)}</tbody>
                </table>
            </section>)}</div>}
            {isQualifier(active) && <p data-mobile-caption className="cup-note cup-qualification-note">Finalized weeks only · standings provisional until qualifying ends.</p>}
            {active.format === 'survivor' && <section className="cup-survival"><div className="cup-section-heading"><h3>THE SURVIVAL LINE</h3><span>Week {selectedWeek}{currentSurvival ? ' · ' + currentSurvival.active.length + ' entered · ' + currentSurvival.cutCount + ' to leave' : ''}</span></div>{currentSurvival ? <><div className="cup-survival-rows">{(currentSurvival.ranked.length ? currentSurvival.ranked.map(r => r.id) : currentSurvival.active).map(id => <div key={id} className={currentSurvival.eliminated.includes(id) ? 'is-eliminated' : ''}><strong>{name(id)}</strong><b>{points(displayScore(id))}</b><span>{currentSurvival.eliminated.includes(id) ? 'OUT' : currentSurvival.survivors.includes(id) ? 'THROUGH' : currentSurvival.pendingTie?.ids.includes(id) ? 'TIE AT CUT' : 'PENDING'}</span></div>)}</div>{currentSurvival.pendingTie && <p className="cup-validation">A tie at the cut needs a commissioner ruling before anyone advances.</p>}</> : <p>Finalize the previous cut to reveal this round’s field.</p>}</section>}
            {!!fixtures.length && <div className="cup-follow-fixtures" aria-label={'Week ' + selectedWeek + ' Cup matchups'}>{fixtureGroups.map(([label, matches]) => <section className="cup-fixture-group" aria-label={label + ' matchups'} key={label}><h3>{label}<span>Week {selectedWeek}</span></h3><div className="cup-fixtures">{matches.map(f => <article className={'cup-match' + ([f.a, f.b].includes(myId) ? ' is-mine' : '')} key={f.a + ':' + f.b}>{[f.a, f.b].map((id, i) => <div className={id && f.winner === id ? 'is-winner' : ''} key={i}><strong>{name(id)}{id === myId && <small className="cup-match-you">You</small>}</strong><b>{id == null ? 'BYE' : points(displayScore(id))}</b></div>)}{f.winner && <small className="cup-match-outcome">{f.b == null ? 'Bye · ' : ''}{name(f.winner)} advances</small>}</article>)}</div></section>)}</div>}
            {livePreview.live && isQualifier(active) && !fixtures.length && <section aria-label="Live Cup scores"><div className="cup-section-heading"><h3>This week’s scores</h3><span>Week {selectedWeek} · not finalized</span></div><div className="cup-fixtures">{requiredTeams.map(id=><article className={'cup-match'+(id===myId?' is-mine':'')} key={id}><div><strong>{name(id)}</strong><b>{points(displayScore(id))}</b></div></article>)}</div></section>}
            {bracketNote && <p className="cup-message">{bracketNote}</p>}
            {active.format !== 'survivor' && <><div className="cup-section-heading"><h3>ROAD TO THE TROPHY</h3><span>{isDouble(active) ? 'Up to ' : ''}{engine.roundCount(active)} {isDouble(active) ? 'bracket weeks' : 'rounds'}</span></div><div className="cup-bracket cup-studio-bracket">{Array.from({ length: engine.roundCount(active) }, (_, i) => <section className="cup-round" key={i}><h4>{isDouble(active) ? engine.stageLabel(active, active.knockoutStart + i) : roundLabel(i, engine.roundCount(active))} · W{active.knockoutStart + i}</h4>{displayRounds[i]?.map(r => <article className={'cup-bracket-match' + (r.bracket ? ' cup-bracket-' + r.bracket : '')} key={r.a + ':' + r.b}>{r.stageLabel && <span className="cup-match-stage">{r.stageLabel}</span>}{[r.a, r.b].map((id, j) => <div key={j} className={id && r.winner === id ? 'is-winner' : ''}><span>{name(id)}</span><b>{id == null ? 'BYE' : points(j ? r.y : r.x)}</b></div>)}</article>) || <p className="cup-note">{isDouble(active) && i === engine.roundCount(active) - 1 ? result ? 'Not needed · champion decided' : 'Only needed if the unbeaten finalist loses the championship.' : 'Awaiting previous results'}</p>}</section>)}</div></>}
            {canManage && <>
                <details><summary>Manage Week {selectedWeek} scores</summary>{scoresBlocked && <p className="cup-note">{scoresBlocked}</p>}<fieldset disabled={busy || !active.enabled || !!scoresBlocked || active.weeks[selectedWeek]?.final} className="cup-settings"><button onClick={pull}>Fetch Sleeper scores</button><p>Review actual fantasy points for the teams competing this week. The Cup uses your existing lineups; eliminated teams and knockout byes need no score.</p><div className="cup-setup">{requiredTeams.map(id => <label key={id}>{name(id)}<input type="number" step="0.01" value={scores[id] ?? ''} onChange={e => setScores({ ...scores, [id]: e.target.value })}/></label>)}</div><div className="cup-plan-actions"><button onClick={() => persistScores(false)}>Save score preview</button><button onClick={() => { if (window.confirm('Confirm all Week ' + selectedWeek + ' scores are final?')) persistScores(true); }}>Finalize week</button></div></fieldset>{active.weeks[selectedWeek]?.final && <button disabled={busy || !active.enabled} onClick={() => { if (window.confirm('Reopen this week? Later weeks and rulings will need review again.')) save(clearAfter(active, selectedWeek)); }}>Reopen week</button>}</details>
                <details><summary>Commissioner tiebreak rulings</summary><fieldset disabled={busy || !active.enabled} className="cup-settings"><p>Ties never advance a team automatically. Apply your league’s agreed tiebreak and record the evidence.</p>
                    {isQualifier(active) && <><div className="cup-setup">{Array.from({ length: active.qualifierCount }, (_, i) => <label key={i}>Seed {i + 1}<select value={seedIds[i] || ''} onChange={e => setSeedIds(ids => Array.from({ length: active.qualifierCount }, (_, j) => j === i ? e.target.value : ids[j] || ''))}><option value="">Choose team</option>{active.teams.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>)}</div><label>Reason and evidence<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button onClick={() => { try { if (!reason.trim()) throw Error('Record the reason for this ruling.'); const next = { ...clearAfter(active, active.knockoutStart), seedRuling: { ids: seedIds, reason } }; engine.qualifiers(next); save(next); } catch (e) { setError(e.message); } }}>Apply seeding ruling</button>{active.seedRuling && <p>Recorded ruling: {active.seedRuling.reason}</p>}</>}
                    {currentSurvival?.pendingTie && <><p>Select {currentSurvival.requiredSurvivors} survivors. Teams above the tied cutoff must advance.</p><div className="cup-participants">{currentSurvival.active.map(id => <label key={id}><input type="checkbox" checked={survivorIds.includes(id)} onChange={e => setSurvivorIds(ids => e.target.checked ? [...ids, id] : ids.filter(x => x !== id))}/>{name(id)} · {points(displayScore(id))}</label>)}</div><label>Survival tiebreak evidence<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button onClick={() => { try { if (!reason.trim()) throw Error('Record the tiebreak evidence.'); const base = clearAfter(active, selectedWeek, false); const next = { ...base, survivorRulings: { ...base.survivorRulings, [selectedWeek]: { ids: survivorIds, reason } } }; engine.survivor(next); save(next); } catch (e) { setError(e.message); } }}>Apply survival ruling</button></>}
                    {rounds.flat().filter(r => r.a && r.b && active.weeks[r.week]?.final && r.x === r.y && !r.winner).map(r => <div key={r.a}><p>Week {r.week}: {name(r.a)} / {name(r.b)} tied</p>{[r.a, r.b].map(id => <button key={id} onClick={() => { const explanation = window.prompt('Record the tiebreak evidence for advancing ' + name(id)); if (explanation?.trim()) { const next = clearAfter(active, r.week, false); save({ ...next, tieRulings: { ...next.tieRulings, [r.week + ':' + r.a + ':' + r.b]: { winner: id, reason: explanation } } }); } }}>Advance {name(id)}</button>)}</div>)}
                </fieldset></details>
                <details><summary>Cup controls</summary><fieldset disabled={busy} className="cup-settings"><button onClick={() => save({ ...active, enabled: !active.enabled })}>{active.enabled ? 'Pause tournament' : 'Resume tournament'}</button></fieldset></details>
            </>}
        </>}
    </section>;
}
window.WoeppelCupPanel = WoeppelCupPanel;
