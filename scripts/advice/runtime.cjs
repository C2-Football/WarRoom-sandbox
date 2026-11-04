'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),shared=path.join(ROOT,'reconai-shared');
const valueRuntime=require('../../reconai-shared/value-monitor-runtime.cjs');
const A=require('../../reconai-shared/advice-scorecard.js');
const {engineFiles}=require('../value-monitor/worker.cjs');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:A.stable(x)).digest('hex');
const APP_FILES=['js/shared/availability-forecast.js','js/utils/nfl-byes.js','js/shared/waiver-roster-read.js','js/shared/roster-lens-basis.js','js/shared/roster-waiver-lens.js','js/shared/roster-trade-lens.js'];
const engineHash=()=>hash([...valueRuntime.MODULES.map(n=>engineFiles()[n]||path.join(shared,n)),...['trade-engine.js','advice-scorecard.js','value-monitor-runtime.cjs'].map(n=>path.join(shared,n)),...APP_FILES.map(n=>path.join(ROOT,n)),__filename].map(f=>fs.readFileSync(f,'utf8')).join('\n'));
function tracker(fetcher=fetch,now=()=>new Date().toISOString()) {
 const sources=[],cache=new Map();return {sources,fetch:async(url,opts={})=>{
  const key=String(url);if(cache.has(key))return (await cache.get(key)).clone();
  const request=(async()=>{const r=await fetcher(url,{...opts,cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Input HTTP '+r.status+' at '+new URL(key).hostname);
   const raw=await r.clone().text();sources.push({source:key,observedAt:now(),asOf:r.headers.get('last-modified')||null,cacheAgeSeconds:Number(r.headers.get('age')||0),hash:hash(raw),providerTimestampVerified:false});return r;})().catch(e=>{sources.push({source:key,observedAt:null,error:e.message});throw e;});cache.set(key,request);return (await request).clone();
 }};
}
const TEAM_ALIAS={WSH:'WAS',JAC:'JAX',LA:'LAR'};
async function schedule(season,week,fetcher=fetch) {
 const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&week=${week}&seasontype=2&limit=1000`;
 const r=await fetcher(url);if(!r.ok)throw Error('Schedule unavailable');const data=await r.json();
 if(Number(data.season?.year)!==Number(season)||Number(data.week?.number)!==Number(week)||!Array.isArray(data.events)||!data.events.length)throw Error('Schedule season/week coverage unavailable');
 const teams={},events=[];
 for(const event of data.events){const kickoff=event.date;if(!Number.isFinite(Date.parse(kickoff)))throw Error('Missing kickoff');const comp=event.competitions?.[0];if(comp?.competitors?.length!==2)throw Error('Incomplete game schedule');
  const status=event.status?.type?.completed===true?'final':event.status?.type?.state==='pre'?'scheduled':'pending';
  for(const side of comp.competitors){const team=TEAM_ALIAS[side.team.abbreviation]||side.team.abbreviation;if(teams[team])throw Error('Duplicate team schedule');teams[team]={kickoff,status,eventId:event.id};}events.push({kickoff,status});}
 return {source:url,season:Number(season),week:Number(week),firstKickoffAt:new Date(Math.min(...events.map(e=>Date.parse(e.kickoff)))).toISOString(),teams};
}
function verifySchedule(plan,actual,byes,season) {
 if(Date.parse(plan.firstKickoffAt)!==Date.parse(actual.firstKickoffAt))throw Error('Schedule changed: registered first kickoff no longer matches provider; exclude and preregister a new case');
 for(const [team,kickoff]of Object.entries(plan.teamKickoffs||{})) {
  if(kickoff===null){if(byes.weekForPlayer({team},season)!==plan.week||actual.teams[team])throw Error('Bye not certified: '+team);}
  else if(Date.parse(actual.teams[team]?.kickoff)!==Date.parse(kickoff))throw Error('Incomplete or changed schedule: '+team);
 }
 if(Object.keys(plan.teamKickoffs||{}).length!==32||Object.keys(actual.teams).some(t=>!Object.hasOwn(plan.teamKickoffs,t)))throw Error('Complete 32-team schedule and byes required');
}
async function host(config,{fetcher=fetch,now=Date.now()}={}) {
 const tracked=tracker(fetcher),leagueResponse=await tracked.fetch('https://api.sleeper.app/v1/league/'+config.leagueId),league=await leagueResponse.json();
 const type=({0:'redraft',1:'keeper',2:'dynasty'})[league.settings?.type];
 if(!['redraft','dynasty'].includes(type))throw Error('Autonomous capture currently supports Sleeper redraft and dynasty; other formats remain unsupported');
 const value=await valueRuntime.calculate({run:{league_id:config.leagueId,season:config.season,value_type:type,player_ids:[],id:'advice'},fetcher:tracked.fetch,files:engineFiles(),dataDir:ROOT,now});
 const b=value.host.b;
 const roster=b.S.rosters.find(r=>String(r.roster_id)===String(config.rosterId));if(!roster)throw Error('Registered roster unavailable');
 b.S.user={user_id:roster.owner_id};b.OD={getCurrentUserId:()=>config.ownerKey.replace(/^account:/,'')};
 b.App.OD=b.OD;b.App.LeagueSkin={getCurrent:()=>({type,phase:'in_season'})};
 for(const name of ['trade-engine.js'])vm.runInContext(fs.readFileSync(path.join(shared,name),'utf8'),b);
 for(const name of APP_FILES.slice(1))vm.runInContext(fs.readFileSync(path.join(ROOT,name),'utf8'),b);
 vm.runInContext(fs.readFileSync(path.join(shared,'advice-scorecard.js'),'utf8'),b);
 // Unavailable provider failures must not be disguised as usable, fallback inputs.
 if(value.host.messages.some(m=>/failed|error/i.test(m)))value.host.messages.forEach(m=>tracked.sources.push({source:'canonical engine: '+m,observedAt:null}));
 return {b,roster,league,type,tracked};
}
async function projections(h,week,ids) {
 const {b}=h,provider=await b.App.WeeklyProj.ensureWeekProjections(week,{season:h.league.season});
 const map={};for(const pid of ids)map[pid]=b.App.WeeklyProj.projectPlayer(pid,{playersData:b.S.players,statsData:b.S.statsData||{},priorData:b.S.priorData||{},projectionsData:b.S.projectionsData||{},providerProjections:provider||{},scoring:h.league.scoring_settings,week});
 return map;
}
function weeklyPlayers(h,map,plan) {
 const result={};for(const [pid,p]of Object.entries(map)) {
  const player=h.b.S.players[pid]||{},team=TEAM_ALIAS[player.team]||player.team,injury=String(player.injury_status||'').toUpperCase();
  const bye=Object.hasOwn(plan.teamKickoffs,team)&&plan.teamKickoffs[team]===null;
  const status=bye?'bye':['OUT','IR','PUP','SUS','SUSPENDED','DOUBTFUL','NA','COV'].includes(injury)?'out':!team||player.active===false?'inactive':p?.available===true&&Number.isFinite(p.points?.median)?'available':'unknown';
  result[pid]={status,projection:Number.isFinite(p?.points?.median)?p.points.median:null,team:team||null,kickoff:plan.teamKickoffs[team]||null,observedStatus:player.injury_status||player.status||null};
 }return result;
}
async function capture(job,options={}) {
 const config=job.run.config,spec=job.case.spec,h=await host(config,options),{b,roster,league,type,tracked}=h;
 if(config.engineHash!==engineHash())throw Error('Pinned engine revision mismatch; enroll a separate run for new versions');
 const weeks=config.weeks.filter(w=>w.week>=spec.firstWeek&&w.week<=config.endWeek&&(spec.kind==='trade'||w.week<spec.firstWeek+4));
 if(!weeks.length)throw Error('No registered scoring weeks');
 const actual=await schedule(config.season,weeks[0].week,tracked.fetch);verifySchedule(weeks[0],actual,b.App.NFLByes,config.season);
 const relevant=Object.keys(b.S.players).filter(pid=>b.S.rosters.some(r=>(r.players||[]).includes(pid))||b.S.players[pid].team&&(b.S.statsData?.[pid]?.gp>0||b.S.priorData?.[pid]?.gp>0||b.S.projectionsData?.[pid]?.gp>0));
 const map=await projections(h,spec.firstWeek,relevant);
 let prepared; b.App.AdviceCapture={prepared:(kind,args,answer)=>{prepared={kind,args,answer};}};
 const args={league,roster,rosters:b.S.rosters,players:b.S.players,statsData:b.S.statsData,priorData:b.S.priorData,projectionsData:b.S.projectionsData,
  projectionsByPid:map,week:spec.firstWeek,currentWeek:Number(b.S.nflState.week),currentSeason:config.season,userId:roster.owner_id,accountId:config.ownerKey,accountKey:config.ownerKey,skin:{type,phase:'in_season'},gm:config.gm||{},basis:'projected',horizon:'week'};
 const answer=await b.App[spec.kind==='waiver'?'RosterWaiverLens':'RosterTradeLens'].load(args);
 const frozenArgs=prepared?.args||args;
 const initialPlayers=weeklyPlayers(h,map,weeks[0]),allOwned=new Set(b.S.rosters.flatMap(r=>[...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])]).map(String));
 const copies=Math.max(1,Number(league.settings?.player_copies)||1);
 const eligible=Object.keys(initialPlayers).filter(pid=>initialPlayers[pid].status==='available'&&(spec.kind==='waiver'?!A.active(roster).includes(pid)&&b.S.rosters.filter(r=>(r.players||[]).includes(pid)).length<copies:allOwned.has(pid)&&!A.active(roster).includes(pid)));
 const necessary=[...new Set([...b.S.rosters.flatMap(r=>r.players||[]),...eligible,...answer.candidates.flatMap(c=>(c.incoming||[]).map(x=>x.pid))])];
 const players=Object.fromEntries(necessary.filter(pid=>b.S.players[pid]).map(pid=>[pid,b.S.players[pid]]));
 const capturedAt=new Date().toISOString(),locks=Object.fromEntries(necessary.map(pid=>{const p=initialPlayers[pid],kickoff=p?.kickoff;return [pid,kickoff?Date.parse(kickoff)<=Date.parse(capturedAt):p?.status==='bye'?false:null];}));
 const budget=Number(league.settings.waiver_budget)||0,remaining=budget?Math.max(0,budget-Number(roster.settings?.waiver_budget_used)):0,minimum=budget?Number(league.settings.waiver_budget_min??1):0;
 const format=[type,league.total_rosters+' teams',(Number(league.scoring_settings.rec)||0)+' PPR',league.roster_positions.some(s=>['SUPER_FLEX','QB_FLEX','SFLEX','OP'].includes(s))?'Superflex':league.roster_positions.filter(s=>s==='QB').length+' QB',Number(league.scoring_settings.bonus_rec_te)?'TE premium '+league.scoring_settings.bonus_rec_te:null,league.roster_positions.some(s=>['IDP_FLEX','DL','LB','DB'].includes(s))?'IDP':null].filter(Boolean).join(' / ');
 const c={schemaVersion:1,decisionId:job.case.decision_id,kind:spec.kind,decisionWeek:Number(b.S.nflState.week),season:Number(config.season),format,cohort:config.cohort,capturedAt,deadline:spec.deadline,effectiveAt:spec.effectiveAt,
  league,roster,rosters:b.S.rosters,players,eligiblePlayerIds:eligible,locks,budget:{remaining,minimum,assumedBid:spec.faab??minimum},protectedPids:config.gm?.untouchable||[],
  initialWeek:{week:spec.firstWeek,players:initialPlayers},weeks,policy:A.POLICY,scheduleSource:actual.source,versions:{current:'current:'+config.engineHash,candidate:A.CANDIDATE},
  issued:answer,calculations:{statsData:Object.fromEntries(necessary.filter(pid=>b.S.statsData?.[pid]).map(pid=>[pid,b.S.statsData[pid]])),priorData:Object.fromEntries(necessary.filter(pid=>b.S.priorData?.[pid]).map(pid=>[pid,b.S.priorData[pid]])),seasonProjections:Object.fromEntries(necessary.filter(pid=>b.S.projectionsData?.[pid]).map(pid=>[pid,b.S.projectionsData[pid]])),projectionsByPid:map,valuesByPid:frozenArgs.valuesByPid||b.App.PlayerValue.rosState?.()?.values||b.App.LI?.playerScores||{},rosState:frozenArgs.rosState||b.App.PlayerValue.rosState?.()||null,gm:config.gm||{}},sources:tracked.sources,maxInputAgeSeconds:config.maxInputAgeSeconds||3600,
  delivery:'scheduled advice issued; viewing and acting are separate observations',explanationAudit:{status:'calculation claims retained; roster-direction/acceptance heuristics are not verified facts',unsupportedClaims:[]}};
 return b.App.AdviceScorecard.makeRecord(c,hash);
}
async function freezeWeek(entry,plan,config,options={}) {
 const h=await host(config,options),c=entry.record.context,actual=await schedule(c.season,plan.week,h.tracked.fetch);verifySchedule(plan,actual,h.b.App.NFLByes,c.season);
 // Keep captured scoring, position eligibility and hypothetical roster membership.
 h.league={...h.league,scoring_settings:c.league.scoring_settings};
 const needed=[...new Set([...c.roster.players,...['current','candidate','simple'].flatMap(k=>entry.record.choices[k]?.incoming||[])])];
 const map=await projections(h,plan.week,needed);
 return {week:plan.week,season:c.season,policy:c.policy,configHash:entry.record.configHash,observedAt:new Date().toISOString(),players:weeklyPlayers(h,map,plan),sources:h.tracked.sources};
}
async function outcomes(entry,plan,lineup,{fetcher=fetch}={}) {
 const c=entry.record.context,tracked=tracker(fetcher),actual=await schedule(c.season,plan.week,tracked.fetch);
 const raw=await(await tracked.fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${c.season}/${plan.week}`)).json();
 if(!raw||Array.isArray(raw)||typeof raw!=='object')throw Error('Raw stats feed unavailable or invalid');
 const b=valueRuntime.createHost({state:{},fetcher,files:engineFiles()}).b,players={};
 for(const [pid,p]of Object.entries(lineup?.players||{})) {
  const stats=raw[pid],game=actual.teams[p.team];
  if(plan.teamKickoffs[p.team]===null){players[pid]={status:'bye',points:0};continue;}
  if(!game){players[pid]={status:'missing',points:null,reason:'Game metadata unavailable'};continue;}
  if(game.status!=='final'){players[pid]={status:'pending',points:null};continue;}
  // A player key with a participation field is evidence. An absent row is never zero.
  if(!stats||typeof stats!=='object'||!Number.isFinite(Number(stats.gp))||stats.gp==null){players[pid]={status:'missing',points:null,reason:'No explicit player participation/stat row'};continue;}
  const scored=b.calcFantasyPts.detailed(stats,c.league.scoring_settings,c.players[pid]?.position);
  players[pid]=scored.supported?{status:scored.points===0?'zero':'final',points:scored.points,stats}:{status:'missing',points:null,reason:'Unsupported scoring: '+scored.unsupported.join(', ')};
 }
 return {week:plan.week,season:c.season,configHash:entry.record.configHash,scoringHash:hash(c.league.scoring_settings),players,
  observedAt:new Date().toISOString(),sources:tracked.sources,contentVersion:hash({players,scoring:c.league.scoring_settings}),feedLimitation:'Sleeper raw-stat endpoint lacks a documented complete-player guarantee; absent rows remain missing.'};
}
async function transactions(entry,week,{fetcher=fetch}={}) {
 const c=entry.record.context,m=entry.record.choices.current,url=`https://api.sleeper.app/v1/league/${c.league.league_id}/transactions/${week}`,r=await fetcher(url);if(!r.ok)throw Error('Transaction observations unavailable');const rows=await r.json();if(!Array.isArray(rows))throw Error('Invalid transaction feed');
 const exact=(a,b)=>A.stable([...a].sort())===A.stable([...b].sort()),matches=rows.filter(t=>m&&m.kind!=='hold'&&Number(t.created)>=Date.parse(c.capturedAt)&&exact(Object.entries(t.adds||{}).filter(([,id])=>String(id)===String(c.roster.roster_id)).map(([p])=>p),m.incoming)&&exact(Object.entries(t.drops||{}).filter(([,id])=>String(id)===String(c.roster.roster_id)).map(([p])=>p),[...m.outgoing,...m.drops]));
 return {observedAt:new Date().toISOString(),source:url,rows:matches,offerSent:matches.length?'observed':'unknown',accepted:matches.some(t=>t.type==='trade'&&t.status==='complete')?true:'unknown',completedAcquisition:matches.some(t=>t.status==='complete'),faabActual:matches.filter(t=>t.status==='complete').map(t=>t.settings?.waiver_bid??null),causalWins:null};
}
module.exports={A,hash,engineHash,tracker,schedule,verifySchedule,host,capture,freezeWeek,outcomes,transactions};
