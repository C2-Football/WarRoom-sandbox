(function(root){
 'use strict';const e=React.createElement,fmt=n=>n==null?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:2}),pct=n=>n==null?'—':Math.round(n*100)+'%';
 async function hash(x){const data=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(root.App.AdviceScorecard.stable(x)));return Array.from(new Uint8Array(data),b=>b.toString(16).padStart(2,'0')).join('');}
 // The core is synchronous. Precompute hashes from saved content only; never fetch
 // current rosters, projections, or scores to reconstruct old recommendations.
 async function build(data){const A=root.App.AdviceScorecard,map=new Map(),entries=data.records.map(r=>({record:r.payload,receivedAt:r.received_at}));
  async function remember(x){map.set(A.stable(x),await hash(x));}
  for(const {record:r}of entries){const {contentHash,...body}=r;await remember(body);await remember(r.context);await remember(r.context.league.scoring_settings);}
  const evaluations=entries.map(entry=>{const rows=data.packets.filter(p=>p.decision_id===entry.record.decisionId).sort((a,b)=>a.id-b.id),weeks=new Map();for(const r of rows){if(!weeks.has(r.week))weeks.set(r.week,{week:r.week});const w=weeks.get(r.week);if(r.kind==='lineup'){w.lineup=r.payload;w.lineupReceivedAt=r.received_at;}if(r.kind==='outcome')w.outcome=r.payload;if(r.kind==='transactions')w.transactions=r.payload;}
   return {...A.evaluate(entry,[...weeks.values()],{hash:x=>map.get(A.stable(x))||'unrecognized-hash-input'}),observations:[...weeks.values()].map(w=>w.transactions).filter(Boolean)};});
  return {...A.summarize(entries,evaluations,data.cases),evaluations,data};
 }
 function View({report:r}){
  const groups=r.groups,failures=r.data.jobs.filter(j=>j.error||['failed','missing'].includes(j.status)),illegal=r.evaluations.filter(x=>!x.legality.current?.ok),stale=r.evaluations.filter(x=>x.exclusions.includes('stale_input'));
  return e('div',{className:'advice-scorecard'},
   e('p',{className:'advice-verdict'},r.verdict),
   e('p',null,`${r.coverage.captured} captured / ${r.coverage.expected} registered decisions · ${r.coverage.missing} missing or failed captures · ${illegal.length} illegal or unavailable current recommendations · ${stale.length} stale-input cases · ${r.coverage.unsupportedExplanations} unsupported calculation explanations`),
   e('p',null,'Points below are conditional starting-lineup benefit. Offers, acceptance and completed transactions are tracked separately. Repeated views do not increase the evidence count.'),
   !groups.length?e('p',null,'No graded advice yet. An operator must register future decisions and activate the collector.'):null,
   groups.map(g=>e('section',{key:g.key,className:'advice-group'},e('h3',null,`${g.kind==='waiver'?'Waivers':'Trades'} · ${g.horizon==='next'?'Next eligible week':g.horizon==='four'?'Four weeks':'Remaining fantasy season'} · ${g.format} · ${g.cohort}`),
    e('div',{className:'advice-metrics'},[['Extra points vs hold',fmt(g.averageVsHold)],['Extra points vs simple',fmt(g.averageVsSimple)],['Helped / tied / hurt',`${pct(g.helped)} / ${pct(g.tied)} / ${pct(g.hurt)}`],['Largest gain / loss',`${fmt(g.largestGain)} / ${fmt(g.largestLoss)}`]].map(([label,value])=>e('div',{key:label},e('strong',null,value),e('span',null,label)))),
    e('p',null,`${g.evaluated} completed · ${g.pending} partial/pending · ${g.excluded} excluded · ${g.missingCandidate} missing candidate results. FAAB assumed: ${fmt(g.faabAssumed)}. Dropped-player points that would have started: ${fmt(g.costlyDropPoints)}.`),
    e('p',null,`${g.distinct.decisions} decisions · ${g.distinct.weeks} weeks · ${g.distinct.players} players · ${g.distinct.leagues} leagues · ${g.uncertainty.clusters} player/week exposure groups.`),
    e('p',null,`Candidate minus current: ${fmt(g.paired.mean)} points across ${g.paired.n} completed pairs. ${g.paired.uncertainty.interval?'95% clustered interval '+g.paired.uncertainty.interval.map(fmt).join(' to '):'Insufficient independent evidence for an interval.'}`),
    e('details',null,e('summary',null,'Versions and costly mistakes'),e('p',null,'Current: '+g.versions.current),e('p',null,'Candidate: '+g.versions.candidate),e('ul',null,g.worst.map(w=>e('li',{key:w.decisionId},`${w.decisionId}: ${fmt(w.points)} points vs hold`))))
   )),
   e('details',null,e('summary',null,`Collection health · ${failures.length} issues`),e('ul',null,failures.map(j=>e('li',{key:j.id},`${j.kind} week ${j.week}: ${j.status} — ${j.error||'Missed interval'}`))),e('p',null,'Last successful ingestion: '+(r.data.jobs.filter(j=>j.last_success_at).map(j=>j.last_success_at).sort().at(-1)||'none'))),
   e('details',null,e('summary',null,'Registered advice and evidence'),...r.data.records.map(row=>{const c=row.payload.context,m=row.payload.choices.current,grade=r.evaluations.find(g=>g.decisionId===row.decision_id);return e('article',{key:row.decision_id},e('strong',null,`${c.kind} · ${m?.reason||c.issued.reason||'Unavailable'}`),e('p',null,`Add/receive: ${(m?.incoming||[]).join(', ')||'none'} · Send: ${(m?.outgoing||[]).join(', ')||'none'} · Required drops: ${(m?.drops||[]).join(', ')||'none'}`),e('p',null,`Received ${row.received_at}. Effective ${c.effectiveAt}. ${grade?.exclusions.join(', ')||'Receipt and timing checks passed'}.`),e('p',null,`Observed completed acquisition: ${grade?.observations.some(o=>o.completedAcquisition)?'yes':'not observed'}. Acceptance: ${grade?.observations.some(o=>o.accepted===true)?'observed accepted':'unknown'}.`),e('p',null,'Explanation checks: '+(row.payload.explanationAudit.unsupportedClaims.join('; ')||'No calculation mismatch detected. Manager-direction and acceptance claims remain unverified.')),e('pre',null,JSON.stringify({advice:c.issued,calculations:m?.support,horizons:grade?.horizons},null,2)));})),
   e('details',null,e('summary',null,`Displayed advice history · ${r.data.observations.length} observations`),e('p',null,'Actual screen output is archived separately, including holds. These browser observations lack verified source/deadline evidence and are excluded from prospective grades.'),e('ul',null,r.data.observations.map(x=>e('li',{key:x.observation_id},`${x.received_at} · ${x.payload.kind} · ${x.payload.issued?.reason||x.payload.issued?.candidates?.[0]?.reason||'No clear upgrade'}`)))),
   e('p',null,'Lineup policy: maximize frozen pregame projections once per week; honor byes and known inactive players at that checkpoint; no later swaps or additional roster moves. Acquisitions take effect at the first weekly checkpoint after their assumed effective time.'),
   e('p',null,'The simple baseline selects the greatest projected lineup gain from legal single-player alternatives and issued packages. Acceptance heuristics are not probability forecasts. No completed probability predictions are available.'),
   e('button',{type:'button',onClick:()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='dhq-advice-scorecard.json';a.click();URL.revokeObjectURL(url);}},'Export recorded evidence')
  );
 }
 function Panel({leagueId}){const [open,setOpen]=React.useState(false),[r,setReport]=React.useState(null),[error,setError]=React.useState(null),[nonce,refresh]=React.useState(0);
  React.useEffect(()=>{const changed=()=>refresh(n=>n+1);root.addEventListener('wr:advice-status',changed);return()=>root.removeEventListener('wr:advice-status',changed);},[]);
  React.useEffect(()=>{if(!open||!leagueId)return;let alive=true;setReport(null);setError(null);root.App.AdviceCapture.read(leagueId).then(build).then(x=>{if(alive)setReport(x);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[open,leagueId,nonce]);
  const status=root.App.AdviceCapture?.status;
  return e('details',{className:'advice-panel',onToggle:ev=>setOpen(ev.currentTarget.open)},e('summary',null,'DHQ Advice Scorecard'),
   e('p',null,status?.enabled?'Displayed advice capture enabled':'Displayed advice capture is not activated.'),
   status?.error?e('p',{role:'alert'},'Capture failed: '+status.error+' · Pending retry: '+status.pending):null,
   e('button',{type:'button',onClick:()=>{root.App.AdviceCapture.flush().catch(e=>setError(e.message));refresh(n=>n+1);}},'Refresh scorecard / retry captures'),
   error?e('p',{role:'alert'},error):r?e(View,{report:r}):open?e('p',null,'Reading saved evidence…'):null);
 }
 root.App.AdviceScorecardPanel=Panel;root.App.AdviceScorecardView=View;root.App.buildAdviceScorecard=build;
})(window);
