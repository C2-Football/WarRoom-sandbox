// Read-only monitoring reports. Enrollment is an explicit server/operator action.
(function(){
 'use strict';
 const e=React.createElement;
 const fmt=n=>n==null?'Unknown':Number(n).toLocaleString(undefined,{maximumFractionDigits:1});
 function Report({report:r}){
  const run=r.run,when=t=>t?new Date(t).toLocaleString(undefined,{timeZone:run.timezone}):'None';
  const movement=m=>e('li',{key:m.playerId},`${window.S?.players?.[m.playerId]?.full_name||m.playerId}: ${fmt(m.start)} → ${fmt(m.end)} · ${m.delta>0?'+':''}${fmt(m.delta)} (${m.pct==null?'percentage unavailable':fmt(m.pct)+'%'})${m.jump?' · conspicuous jump':''}${m.comparisonLimited?' · comparison limited by settings/version evidence':''} · Associated changes: ${m.associations.join(', ')}`);
  return e('div',null,
   e('p',null,`${run.value_type} · ${run.player_ids.length} selected players · ${run.scope?.kind||'explicit scope'} · ${r.status}${r.complete?' — eight captures verified':' — seven-day report incomplete'}`),
   e('p',null,`${when(run.starts_at)} → ${when(run.ends_at)} (${run.timezone}). Captures are 24 hours apart; local clock time can shift at daylight saving.`),
   e('p',null,`Last successful capture: ${when(r.lastSuccess)}. Next scheduled: ${when(r.next)}.`),
   e('p',null,`${r.completed}/${r.expected} player observations stored; ${r.valid} with supported values. Missing/failed/partial days: ${r.missingDays.length?r.missingDays.join(', '):'none recorded'}.`),
   e('div',{style:{overflowX:'auto'}},e('table',{style:{width:'100%',fontSize:12}},e('thead',null,e('tr',null,['Day','Scheduled','Status','Coverage','Issue'].map(t=>e('th',{key:t,style:{textAlign:'left'}},t)))),e('tbody',null,r.days.map(d=>e('tr',{key:d.index},e('td',null,d.index===0?'Baseline':d.index),e('td',null,when(d.scheduledAt)),e('td',null,d.status),e('td',null,`${d.valid}/${d.expected} valid; ${d.saved} stored`),e('td',null,[d.error,d.stale?d.stale+' stale':null,d.attempts>1?d.attempts+' attempts':null].filter(Boolean).join(' · ')||'—')))))),
   e('p',null,'Endpoint changes require both baseline and day 7. Unchanged values are distinct from failed collection. Associations describe changed evidence, not proven causes.'),
   e('strong',null,'Largest risers'),e('ul',null,r.risers.length?r.risers.map(movement):e('li',null,'No supported endpoint increase')),
   e('strong',null,'Largest fallers'),e('ul',null,r.fallers.length?r.fallers.map(movement):e('li',null,'No supported endpoint decrease')),
   e('details',null,e('summary',null,'All selected players'),e('ul',null,r.movements.map(movement))),
   e('p',{style:{color:'var(--text-muted)'}},'This report measures recorded value movement and collection reliability. It does not establish predictive accuracy or recommendation quality.')
  );
 }
 function Panel({leagueId}){
  const [runs,setRuns]=React.useState(null),[error,setError]=React.useState(null),[report,setReport]=React.useState(null),[nonce,setNonce]=React.useState(0),[selected,setSelected]=React.useState('');
  React.useEffect(()=>{let alive=true;setRuns(null);setError(null);setReport(null);
   window.OD.loadValueMonitorRuns(leagueId).then(r=>{if(alive){setRuns(r);setSelected(r[0]?.id||'');}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};
  },[leagueId,nonce]);
  React.useEffect(()=>{let alive=true;setReport(null);const run=runs?.find(r=>r.id===selected);if(run)window.OD.loadValueMonitorReport(run).then(r=>{if(alive)setReport(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[selected,runs]);
  const save=window.WrSnapshots?.saveState?.(leagueId);
  return e('details',{className:'value-monitor-panel',style:{margin:'12px 0',padding:12,border:'1px solid var(--border-subtle, #454545)',borderRadius:8}},
   e('summary',null,'Seven-day value monitor · '+(error?'status unavailable':runs===null?'loading':runs.length?runs[0].status:'not enrolled')),
   e('button',{type:'button',onClick:()=>setNonce(n=>n+1),style:{margin:'8px 0'}},'Refresh persisted monitor status'),
   error?e('p',{role:'alert'},error):null,
   runs?.length?e('select',{'aria-label':'Monitoring run',value:selected,onChange:ev=>setSelected(ev.target.value)},runs.map(r=>e('option',{key:r.id,value:r.id},`${r.value_type} · ${r.starts_at.slice(0,10)} · ${r.status}`))):runs?e('p',null,'No run is enrolled for this account and league. An operator must explicitly select the league, format and player scope. Opening this page does not start a monitor.'):null,
   report?e(Report,{report}):null,
   e('p',null,save?.status==='failed'?'Browser snapshot save failed: '+save.error:save?.status==='verified'?'Browser observation readback verified at '+save.verifiedAt:'Browser observations are separate from scheduled captures. Local team totals are not proof of persisted player history.'),
   window.App.valueHistorySaveError?e('p',{role:'alert'},'Event history save failed: '+window.App.valueHistorySaveError):null
  );
 }
 window.App.ValueMonitorPanel=Panel;window.App.ValueMonitorReport=Report;
})();
