'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster','rules','draft-room','era-rules','types','season','helmet','engine','hidden-years','rivals','ai','actions','ui','gamecast']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeagueEngine: E, TimeLeagueGamecast: G, TimeLeagueSeason: S } = App;
const disk = new Map(); let saveFails = false;
window.localStorage = { getItem: key => disk.get(key) || null, setItem: (key, value) => { if (saveFails) throw new Error('Disk full'); disk.set(key, value); }, removeItem: key => disk.delete(key) };
window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
let current;
const same = (a,b) => a && b && a.length === b.length && a.every((value,i) => Object.is(value,b[i]));
function harness() { return { states: [], refs: [], memos: [], effects: [], pending: [], render(fn, runEffects = false) {
    current = this; this.si = this.ri = this.mi = this.ei = 0; this.pending = [];
    const tree = fn(); if (runEffects) this.pending.forEach(run => run()); return tree;
} }; }
global.React = {
    Fragment:'fragment', createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:value=>{const ctx=current,i=ctx.si++;ctx.states[i]??={value:typeof value==='function'?value():value}; const slot=ctx.states[i];slot.set ||= next=>{slot.value=typeof next==='function'?next(slot.value):next;};return[slot.value,slot.set];},
    useRef:value=>{const ctx=current,i=ctx.ri++;return ctx.refs[i] ||= {current:value};},
    useMemo:(make,deps)=>{const ctx=current,i=ctx.mi++;if(!same(ctx.memos[i]?.deps,deps))ctx.memos[i]={value:make(),deps};return ctx.memos[i].value;},
    useCallback:(fn,deps)=>React.useMemo(()=>fn,deps),
    useEffect:(fn,deps)=>{const ctx=current,i=ctx.ei++;if(!same(ctx.effects[i]?.deps,deps)){const old=ctx.effects[i];ctx.effects[i]={deps};ctx.pending.push(()=>{old?.cleanup?.();ctx.effects[i].cleanup=fn();});}},
};
require('../js/components/time-league-week-gates.js');
require('../js/components/time-league-gamecast-panel.js');
require('../js/components/time-league-rivals-panel.js');
for(const name of ['Home','Team','Draft','Setup']) window['WrTimeLeague'+name+'Panel']=function Panel(){};
require('../js/tabs/time-league.js');
const all = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(all) : [value,...all(value.children)];
const words = node => !node ? '' : Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'object' ? words(node.children) : String(node);
const button = (tree,label) => all(tree).find(node=>node.type==='button' && words(node)===label);
const component = (tree,type) => all(tree).find(node=>node.type===type);
const seed = E.createTimeLeague({ name:'Live matchup', seed:'head-to-head', createdAt:'2026-09-07T00:00:00Z', seats:[{name:'You',manager:'human'},{name:'Opponent',manager:'human'}], settings:{gameDeckVersion:0,waiversEnabled:true,rosterSlots:{QB:1,RB:2,SUPER_FLEX:1,K:1,DEF:1,BN:1}, maxQuarterbacks:2, regularSeasonWeeks:12, playoffTeams:0, scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2}, eraRules:{mode:'any-era',decades:[]}} });
const slots=['QB','RB','RB','SUPER_FLEX','K','DEF','BN'];
const statLines=[{passYd:320,passTd:4},{rushYd:80,rushTd:1},null,{passInt:2},{extra:{xpm:4}},{extra:{sack:3}}, {rushYd:200,rushTd:4}];
const cards=new Map(), logs=new Map();
const teams=seed.teams.map((team,side)=>({...team,roster:slots.map((slot,i)=>{
    const position=slot==='SUPER_FLEX'?'QB':slot==='BN'?'RB':slot;
    const identity=`player:${side}:${i}`, entry={entryId:`e${side}${i}`,identity,name:`${side?'Rival':'Your'} ${slot} ${i}`,position,slot,drawnSeason:2000,acquiredWeek:0,acquiredVia:'draft'};
    cards.set(identity,{identity,name:entry.name,position,seasons:[{season:2000,games:16,points:200}]});
    if(statLines[i])logs.set(S.gameLogKey(identity,2000,1),{identity,season:2000,week:1,stats:{passYd:0,passTd:0,passInt:0,rushYd:0,rushTd:0,rec:0,recYd:0,recTd:0,fumblesLost:0,twoPointConversions:0,...statLines[i]}});
    return entry;
})}));
let league=E.normalizeTimeLeague({...seed,teams,phase:'season',weekStage:'claims',seasonsRevealed:true});
const root=harness(); root.states[1]={value:league};root.states[4]={value:'home'};root.states[6]={value:cards};root.states[7]={value:logs};
const rootTree=()=>root.render(()=>TimeLeague({onClose(){}}));
const dockProps=()=>component(rootTree(),WrTimeLeagueWeekGates).props;
function dock(props){const ctx=harness();return ctx.render(()=>WrTimeLeagueWeekGates(props));}
const gateButton=label=>button(dock(dockProps()),label);
(async()=>{
    let tree=rootTree();
    assert(component(tree,WrTimeLeagueGamecastPanel),'The gamecast stays mounted outside its tab');
    assert.equal(component(tree,WrTimeLeagueGamecastPanel).props.active,false);
    assert(!all(tree).some(node=>node.props.className==='tl-stage-gates tl-card'));
    gateButton('Review bids').props.onClick(); assert.equal(root.states[4].value,'waivers');
    await gateButton('Run waivers').props.onClick(); assert.equal(root.states[1].value.weekStage,'lineup'); assert.equal(root.states[4].value,'roster');
    const legal=root.states[1].value;
    root.states[1].value={...legal,teams:legal.teams.map((team,i)=>i?team:{...team,roster:team.roster.filter(entry=>entry.slot!=='QB')})};
    assert.equal(await gateButton('Lock lineup').props.onClick(),false);
    assert.equal(root.states[4].value,'roster','An invalid lineup stays on the screen that needs attention');
    root.states[1].value=legal; saveFails=true;
    assert.equal(await gateButton('Lock lineup').props.onClick(),false);
    assert.equal(root.states[1].value.weekStage,'lineup'); assert.equal(root.states[4].value,'roster','A failed save cannot advance the UI');
    saveFails=false; await button(rootTree(),'Retry save').props.onClick();
    assert.equal(root.states[4].value,'gameday','A successful retry routes to the next stage too');
    await gateButton('Start game day').props.onClick();
    assert.equal(root.states[1].value.weekStage,'postgame');
    assert.equal(root.states[1].value.finalizedWeeks.length,1);
    assert.equal(gateButton('End week'),undefined,'The saved final cannot expose advance before playback mounts');

    root.states[1].value = { ...root.states[1].value, teams: root.states[1].value.teams.map((team, i) => i ? { ...team, manager: 'ai', aiPersona: 'warlord' } : team) };
    assert.equal(component(rootTree(), WrTimeLeagueGamecastPanel).props.mailNotice, null, 'Saved results cannot announce an owner message before playback starts');
    assert(!all(rootTree()).some(node => node.props.className === 'tl-mail-trigger'), 'Unread badges cannot spoil the saved game either');
    const cast=harness();
    const play=()=>{const props=component(rootTree(),WrTimeLeagueGamecastPanel).props;return cast.render(()=>WrTimeLeagueGamecastPanel(props),true);};
    play(); tree=play();
    assert(gateButton('Pause'));assert(gateButton('Next quarter'));assert(!gateButton('End week'));
    dockProps().onNavigate('home');
    assert(!component(rootTree(), WrTimeLeagueHomePanel), 'The recap stays hidden until first-time playback finishes');
    assert(words(rootTree()).includes('Your week recap opens after the final whistle.'));
    dockProps().onNavigate('gameday');
    assert.equal(await dockProps().onAction({type:'advance-week'}),false,'Stale callbacks cannot skip an unfinished game');
    const getLineups=()=>{const node=all(tree).find(node=>typeof node.type==='function'&&node.type.name==='LiveLineups');return node.type(node.props);};
    const points=()=>all(getLineups()).filter(node=>node.props.className?.includes('tl-live-player-points')).map(node=>words(node));
    const primary=all(tree).find(node=>node.props.className==='tl-gameday-primary');
    assert(primary, 'The primary view groups the score rail beside the full lineup');
    const scoreRail=all(primary).find(node=>node.props.className==='tl-gameday-score-rail');
    assert(all(scoreRail).some(node=>node.props['aria-label']==='Game playback controls'), 'Playback controls remain with the score');
    assert(all(primary).some(node=>node.type?.name==='LiveLineups'), 'Every starter remains in the primary view');
    assert(all(getLineups()).some(node => node.type === 'label' && node.props.className === 'tl-coach-details'
        && all(node).some(input => input.type === 'input' && input.props.type === 'checkbox')), 'The mobile coach board exposes full scorer stats without leaving the matchup');
    assert(words(scoreRail).includes('Playback controls do not change the saved result'), 'Playback provenance remains visible beside the score');
    assert(points().every(value=>value==='0.00'),'Final player totals stay hidden at kickoff');
    assert(!words(getLineups()).includes('320 passing yards'));
    assert(!words(getLineups()).includes('Your BN'),'Bench production does not count toward the matchup');
    const players=()=>all(getLineups()).filter(node=>node.props['data-entry-id']);
    for(let quarter=1;quarter<=4;quarter++){
        gateButton('Next quarter').props.onClick();tree=play();
        const landed=cast.states[0].value.timeline.events.filter(event=>event.t<=quarter*15);
        for(const player of players()){
            const cents=landed.filter(event=>event.entryId===player.props['data-entry-id']).reduce((sum,event)=>sum+Math.round(event.points*100),0);
            const visible=all(player).find(node=>node.props.className?.includes('tl-live-player-points'));
            assert.equal(Number(words(visible)),cents/100,'Each starter follows the same scoring moments as the team score');
        }
        if (quarter < 4) assert.equal(component(rootTree(), WrTimeLeagueGamecastPanel).props.mailNotice, null, 'Postgame correspondence stays hidden during every unfinished quarter');
        if(quarter===1){
            const oldClock=cast.states[1].value;
            dockProps().onNavigate('roster');tree=play();assert.equal(cast.states[2].value,false);
            assert(gateButton('Watch game'));gateButton('Watch game').props.onClick();tree=play();
            assert.equal(cast.states[1].value,oldClock,'Changing tabs cannot rewind the game');
        }
    }
    assert(points().includes('-4.00'),'Negative-scoring starters remain visible');
    assert(words(getLineups()).includes('No game recorded'),'Missing historical games are identified at final');
    assert.equal(root.states[4].value, 'home', 'The final whistle automatically opens the week recap');
    assert(gateButton('End week'));assert(!gateButton('Next quarter'));
    const finals=root.states[1].value.finalizedWeeks[0];
    assert.equal(players().length,12,'Both complete starting lineups include zero-score players and superflex');

    // A recap link opens only an already disclosed saved week, once per intent.
    const receiptProps = { ...component(rootTree(), WrTimeLeagueGamecastPanel).props, active: true, autoPlayWeek: null, throughWeek: 1, onPlaybackChange() {} };
    const request = { leagueId: receiptProps.league.leagueId, week: 1, requestId: 1 };
    function inspectReceipt(extra) {
        const ctx = harness();
        const props = { ...receiptProps, scoreRequest: request, ...extra };
        const render = () => ctx.render(() => WrTimeLeagueGamecastPanel(props), true);
        render(); render();
        return { ctx, render, props };
    }
    assert.equal(inspectReceipt({ scoreRequest: { ...request, leagueId: 'another-room' } }).ctx.states[6].value, null, 'A request for another room cannot open this archive');
    assert.equal(inspectReceipt({ scoreRequest: { ...request, week: 2 } }).ctx.states[6].value, null, 'An unresolved week cannot be opened');
    assert.equal(inspectReceipt({ throughWeek: 0 }).ctx.states[6].value, null, 'A saved but undisclosed result remains concealed');
    assert.equal(inspectReceipt({ active: false }).ctx.states[6].value, null, 'An inactive tab does not consume a scoring intent');
    const pendingReceipt = inspectReceipt({ autoPlayWeek: 1 });
    assert.equal(pendingReceipt.ctx.states[6].value, null, 'Pending and unfinished first playback cannot be bypassed by a recap request');
    pendingReceipt.ctx.states[1].set(60);
    pendingReceipt.render(); pendingReceipt.render();
    assert.equal(pendingReceipt.ctx.states[6].value, 1, 'A finished playback can open its saved receipt');
    assert.equal(pendingReceipt.ctx.states[0].value, null, 'Opening a receipt closes the completed playback');
    const receipt = inspectReceipt();
    assert.equal(receipt.ctx.states[6].value, 1, 'The exact saved week opens');
    receipt.ctx.states[6].set(null); receipt.render();
    assert.equal(receipt.ctx.states[6].value, null, 'Closing a receipt does not reopen it on the next render');
    receipt.props.scoreRequest = { ...request, requestId: 2 }; receipt.render();
    assert.equal(receipt.ctx.states[6].value, 1, 'A new explicit recap click can reopen that same saved week');

    tree = play();
    const notice = component(tree, WrTimeLeagueMailNotice);
    assert(notice, 'The final scoreboard surfaces its opponent message');
    const finalPrimary=all(tree).find(node=>node.props.className==='tl-gameday-primary');
    assert(!component(finalPrimary,WrTimeLeagueMailNotice),'Unread mail stays below the final score and complete lineup');
    assert(all(tree).indexOf(notice)>all(tree).indexOf(finalPrimary));
    assert(all(dock(dockProps())).some(node => node.props['aria-label'] === 'New message from Opponent. Read and reply'), 'The fixed bottom action row announces the sender even when the scoreboard is offscreen');
    const noticeTree = WrTimeLeagueMailNotice(notice.props);
    assert(words(noticeTree).includes('Opponent sent you a message'));
    assert(all(rootTree()).some(node => node.props.className === 'tl-mail-trigger'), 'The header shows unread mail outside the inbox');
    button(tree,'CLOSE GAMECAST').props.onClick();tree=play();tree=play();
    assert(component(tree, WrTimeLeagueMailNotice), 'The saved final also keeps unread correspondence visible');
    all(noticeTree).find(node => node.props['aria-label'] === 'Read message from Opponent').props.onClick();
    assert.equal(root.states[4].value, 'messages');
    const chat = harness();
    const renderChat = () => { const props = component(rootTree(), WrTimeLeagueRivalsPanel).props; return chat.render(() => WrTimeLeagueRivalsPanel(props), true); };
    renderChat(); const conversation = renderChat();
    assert(conversation.props.className.includes('has-thread'), 'A notification opens the sender conversation directly on mobile');
    assert(all(conversation).some(node => node.props['aria-label'] === 'Conversation with Opponent'));
    const read = TimeLeagueMail.readIds(league.leagueId, teams[0].teamId);
    assert(read.includes(`game:1:${teams[0].teamId}`), 'Opening the conversation persists its read receipt');
    component(rootTree(), WrTimeLeagueRivalsPanel).props.onNavigate('gameday');tree=play();
    assert.equal(component(rootTree(), WrTimeLeagueGamecastPanel).props.mailNotice, null, 'Read messages disappear from the final card');
    assert(!all(rootTree()).some(node => node.props.className === 'tl-mail-trigger'), 'Reading updates the global unread badge immediately');
    button(tree,'REPLAY').props.onClick();tree=play();
    root.states[1].value={...root.states[1].value,teams:teams.map(team=>({...team,roster:[]}))};
    tree=play();assert(words(getLineups()).includes('Your QB'),'Replays use saved starters even when current rosters changed');
    assert(points().every(value=>value==='0.00'),'A replay starts all player scores at zero again');
    button(tree,'INSTANT').props.onClick();tree=play();
    assert.equal(root.states[4].value, 'gameday', 'Finishing an explicit replay does not force another recap');
    assert(!gateButton('End week'), 'Rollover requires returning to the recap');
    gateButton('Week recap').props.onClick();
    const beforeEndWeek=root.states[1].value;
    await gateButton('End week').props.onClick();tree=play();tree=play();
    assert.equal(root.states[4].value,'home');assert.equal(root.states[1].value.weekStage,'claims');
    assert.equal(cast.states[0].value,null,'Advancing clears the old replay so the next game shows its own lineup');
    assert.deepEqual(root.states[1].value.finalizedWeeks[0],finals,'Watching, pausing and advancing preserves the saved box score');

    const retryRoot=harness(),retryLeague={...beforeEndWeek,leagueId:beforeEndWeek.leagueId+'-retry'};
    retryRoot.states[1]={value:retryLeague};retryRoot.states[4]={value:'home'};retryRoot.states[6]={value:cards};retryRoot.states[7]={value:logs};
    const retryDraw=()=>retryRoot.render(()=>TimeLeague({onClose(){}}));
    component(retryDraw(),WrTimeLeagueGamecastPanel).props.onPlaybackChange({leagueId:retryLeague.leagueId,week:1,done:true,playing:false});
    const retryDock=()=>dock(component(retryDraw(),WrTimeLeagueWeekGates).props);
    saveFails=true;
    try{
        assert.equal(await button(retryDock(),'End week').props.onClick(),false);
        assert.equal(retryRoot.states[1].value,retryLeague,'A failed End week keeps the committed postgame snapshot');
        assert.equal(retryRoot.states[4].value,'home','A failed End week stays on the recap');
        assert.equal(retryRoot.states[1].value.weekStage,'postgame');
    }finally{saveFails=false;}
    await button(retryDraw(),'Retry save').props.onClick();
    assert.equal(retryRoot.states[1].value.weekStage,'claims','Retry commits the pending next-week transition');
    assert.equal(retryRoot.states[4].value,'home','A successful End week retry routes to Home');
    assert.equal(retryRoot.states[1].value.currentWeek,retryLeague.currentWeek,'Retry cannot advance a second week');
    assert.deepEqual(retryRoot.states[1].value.finalizedWeeks,retryLeague.finalizedWeeks,'Retry preserves all settled results');

    const member={role:'member',seatTeamId:'t1'};
    let props={...dockProps(),league:{...root.states[1].value,weekStage:'claims',settings:{...league.settings,advancementMode:'majority'}},currentTab:'waivers',onlineMeta:member};
    let intent;props.onAction=action=>{intent=action;};
    button(dock(props),'Vote to advance').props.onClick();assert.equal(intent.type,'vote-advance');
    props.league={...props.league,gateVotes:['t1']};assert(button(dock(props),'Vote recorded').props.disabled);
    props.league={...props.league,settings:{...props.league.settings,advancementMode:'commissioner'}};
    assert(button(dock(props),'Waiting for commissioner').props.disabled,'Members cannot gain commissioner actions through the dock');
    const online = harness();
    const publicLeague = { ...league, publicSnapshotVersion: 1, settings: { ...league.settings, gameDeckVersion: 1 }, weekStage: 'ready' };
    delete publicLeague.seed;
    const authoritative = { ...publicLeague, weekStage: 'postgame', currentWeek: 2, finalizedWeeks: [finals] };
    let sent;
    const onlineProps = { league: publicLeague, cards, logIndex: logs, eraFactors: null, onlineMeta: { role: 'commissioner', seatTeamId: 't1' },
        onUpdate: async (unusedSnapshot, action) => { sent = action; return authoritative; } };
    const onlineTree = () => online.render(() => WrTimeLeagueGamecastPanel(onlineProps));
    const localScorer = E.finalizeCurrentWeek;
    E.finalizeCurrentWeek = () => { throw new Error('A public client cannot score a private game deck'); };
    try {
        const start = all(onlineTree()).find(node => node.type === 'button' && words(node).includes('RUN GAME DAY'));
        assert(start, 'Commissioner can request a server-scored game');
        await start.props.onClick();
        assert.equal(sent.type, 'week');
        assert.deepEqual(online.states[0].value.weekData, finals, 'Only the server box score starts online playback');
    } finally { E.finalizeCurrentWeek = localScorer; }

    // A normal nine-starter matchup is complete in the primary panel. This is
    // a source/control assertion; actual viewport fit is checked in the browser.
    const standardSlots=['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'];
    const standardTeams=teams.map((team,side)=>({...team,roster:standardSlots.map((slot,index)=>({
        entryId:`standard-${side}-${index}`,identity:`player:standard-${side}-${index}`,name:`${side?'Rival':'Your'} starter ${index+1}`,
        position:slot==='FLEX'?'WR':slot,slot,drawnSeason:2000,acquiredVia:'draft',acquiredWeek:1,
    }))}));
    const standard={...league,teams:standardTeams,phase:'season',weekStage:'ready',currentWeek:1,finalizedWeeks:[],
        settings:{...league.settings,rosterSlots:{QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DEF:1,BN:3}}};
    const renderStandalone=snapshot=>{const ctx=harness();return ctx.render(()=>WrTimeLeagueGamecastPanel({league:snapshot,cards,logIndex:logs,onUpdate(){},active:true}));};
    const standardTree=renderStandalone(standard);
    const standardLineups=all(standardTree).find(node=>node.type?.name==='LiveLineups');
    const standardRows=all(standardLineups.type(standardLineups.props));
    assert.equal(standardRows.filter(node=>node.props.className==='tl-live-lineup-row').length,9);
    assert.equal(standardRows.filter(node=>node.props['data-entry-id']).length,18, 'Both teams retain all nine starting players');
    const narrowWeek={week:1,headlines:[],matchups:[{home:'t1',away:'t2',homePoints:100.04,awayPoints:100.02,winner:'t1'}],
        results:standardTeams.map((team,index)=>({teamId:team.teamId,total:index?100.02:100.04,starters:team.roster.map((entry,n)=>({...entry,points:n?0:index?100.02:100.04,stats:{passYd:0}}))}))};
    const narrow={...standard,weekStage:'postgame',currentWeek:2,finalizedWeeks:[narrowWeek]},beforeNarrow=JSON.stringify(narrow);
    const narrowTree=renderStandalone(narrow);
    for(const name of ['HeroMatchup','ScoreboardStrip']){
        const node=all(narrowTree).find(item=>item.type?.name===name),rendered=node.type(node.props);
        assert(words(rendered).includes('100.04')&&words(rendered).includes('100.02'), `${name} cannot round a narrow final into an apparent tie`);
    }
    assert.equal(JSON.stringify(narrow),beforeNarrow,'Compact presentation never changes the saved result');

    // Inspecting another game is presentation only: the owning seat, clock,
    // playback mode and already-committed league are not replaced.
    const inspectionSeed=E.createTimeLeague({name:'Inspect every matchup',seed:'inspect-matchups',createdAt:'2026-01-01T00:00:00Z',
        settings:{...league.settings,draftTeamOrder:['t1','t2','t3','t4'],gameDeckVersion:1,hiddenYears:true,rosterSlots:{QB:1},maxQuarterbacks:1},
        seats:['Owner','Own opponent','Other home','Other away'].map(name=>({name,manager:'human'}))});
    const inspectionStats=[{passYd:200},{passYd:225},{passInt:2},{passYd:300,passTd:1,rushYd:24}],inspectionPoints=[8,9,-4,18.4];
    const inspectionTeams=inspectionSeed.teams.map((team,i)=>({...team,roster:[{entryId:`inspect-${i}`,editionId:`inspect-${i}`,identity:`player:inspect-${i}`,name:`Inspected player ${i}`,
        position:'QB',slot:'QB',drawnSeason:2000,hiddenDecade:'2000s',acquiredVia:'draft',acquiredWeek:1}]}));
    const inspectionWeek={week:1,headlines:[],results:inspectionTeams.map((team,i)=>({teamId:team.teamId,total:inspectionPoints[i],starters:[{...team.roster[0],points:inspectionPoints[i],stats:inspectionStats[i]}]})),
        matchups:[{home:'t1',away:'t2',homePoints:8,awayPoints:9,winner:'t2'},{home:'t3',away:'t4',homePoints:-4,awayPoints:18.4,winner:'t4'}]};
    const inspectionTimeline=G.buildGamecast({...inspectionWeek,seed:'inspection',scoring:inspectionSeed.settings.scoring});
    const negativeMoment=inspectionTimeline.events.find(event=>event.teamId==='t3'&&event.points<0);assert(negativeMoment);
    // The display is allowed the public decade, never an assigned year.
    for(const entry of [...inspectionTeams.flatMap(team=>team.roster),...inspectionWeek.results.flatMap(result=>result.starters)]){
        delete entry.drawnSeason;Object.defineProperty(entry,'drawnSeason',{get(){throw Error('Inspection read a concealed assigned season');}});
    }
    const inspectionBase={...inspectionSeed,phase:'season',weekStage:'ready',seasonsRevealed:true,teams:inspectionTeams,
        schedule:[1,2].map(week=>({week,pairs:[['t1','t2'],['t3','t4']]}))};
    const inspectButton=page=>{
        const stripNode=all(page).find(node=>node.type?.name==='ScoreboardStrip');
        return all(stripNode.type(stripNode.props)).find(node=>node.type==='button'&&node.props['aria-label'].startsWith('Inspect Other home vs. Other away'));
    };
    for(const mode of ['pregame','live','replay','final']){
        const ctx=harness();let writes=0;
        const saved=mode==='pregame'?inspectionBase:{...inspectionBase,currentWeek:2,weekStage:'postgame',finalizedWeeks:[inspectionWeek]};
        if(mode==='live'||mode==='replay'){
            ctx.states[0]={value:{timeline:inspectionTimeline,weekData:inspectionWeek,finalized:saved,live:mode==='live'}};
            ctx.states[1]={value:mode==='live'?negativeMoment.t:0};ctx.states[2]={value:mode==='live'};ctx.states[3]={value:60};
        }
        const props={league:saved,cards:new Map(),logIndex:new Map(),onUpdate(){writes++;},active:true,seatTeamId:'t1'};
        const draw=()=>ctx.render(()=>WrTimeLeagueGamecastPanel(props));
        let page=draw();ctx.refs[0].current=ctx.states[1].value;
        const before=JSON.stringify(saved),clockBefore=ctx.states[1].value,playingBefore=ctx.states[2].value;
        inspectButton(page).props.onClick();page=draw();
        const focusEvents=[],primary=all(page).find(node=>node.props.className==='tl-gameday-primary');
        primary.props.ref.current={closest:selector=>selector==='.tl-root'?{scrollIntoView(){focusEvents.push('room');}}:null,
            focus:options=>{assert(options.preventScroll);focusEvents.push('primary');}};
        ctx.pending.forEach(run=>run());
        assert.deepEqual(focusEvents,['room','primary'],'A phone picker below the lineup brings the selected matchup into view');
        const hero=all(page).find(node=>node.type?.name==='HeroMatchup');
        assert.equal(hero.props.row.home,'t3');assert.equal(hero.props.row.away,'t4');
        const lineup=all(page).find(node=>node.type?.name==='LiveLineups'),renderedLineup=lineup.type(lineup.props);
        const visiblePlayers=all(renderedLineup).filter(node=>node.props['data-entry-id']);
        assert.deepEqual(visiblePlayers.map(node=>node.props['data-entry-id']),['inspect-2','inspect-3']);
        const landed=inspectionTimeline.events.filter(event=>event.t<=clockBefore);
        const expected=mode==='final'?-4:mode==='pregame'?0:landed.filter(event=>event.teamId==='t3').reduce((sum,event)=>sum+Math.round(event.points*100),0)/100;
        assert.equal(hero.props.row.homePoints,expected,'The inspected hero score and starter total share the landed clock');
        assert.equal(Number(words(all(visiblePlayers[0]).find(node=>node.props.className?.includes('tl-live-player-points')))),expected);
        if(mode==='pregame'||mode==='replay')assert(visiblePlayers.every(node=>Number(words(all(node).find(item=>item.props.className?.includes('tl-live-player-points'))))===0),'An inspected future/fresh replay lineup cannot expose final points');
        if(mode==='live'){assert(expected<0,'Negative landed production is visible in the inspected matchup');assert(['t3','t4'].includes(lineup.props.currentPlay.teamId));assert(lineup.props.currentPlay.t<=clockBefore);assert(words(hero.props.spotlight).includes(lineup.props.currentPlay.description),'The inspected spotlight follows only a landed moment in that matchup');}
        assert(!/\b2000\b/.test(words(renderedLineup)),'Inspecting another team does not disclose its hidden year');
        assert.equal(inspectButton(page).props['aria-pressed'],true);
        assert(!words(page).includes('Scoring moments & quarter recap'));
        assert.equal(ctx.states[1].value,clockBefore);assert.equal(ctx.states[2].value,playingBefore);
        button(page,'Your matchup →').props.onClick();page=draw();
        assert.equal(all(page).find(node=>node.type?.name==='HeroMatchup').props.row.home,'t1');
        assert.equal(ctx.states[1].value,clockBefore);assert.equal(writes,0);assert.equal(JSON.stringify(saved),before);
        if(mode==='pregame'){
            inspectButton(page).props.onClick();page=draw();props.league={...saved,currentWeek:2};page=draw();
            assert.equal(all(page).find(node=>node.type?.name==='HeroMatchup').props.row.home,'t1','A selection cannot carry into another week');
            props.league={...saved,leagueId:'another-room'};page=draw();
            assert.equal(all(page).find(node=>node.type?.name==='HeroMatchup').props.row.home,'t1','A selection cannot carry into another room');
            props.league=saved;props.onlineMeta={role:'member',seatTeamId:'t1'};page=draw();inspectButton(page).props.onClick();page=draw();
            assert(button(page,'WAITING FOR COMMISSIONER').props.disabled,'Inspecting another game never grants advancement authority');
        }
    }

    // Deliver a frame even after cancellation to model a queued callback or a
    // delayed effect cleanup. Pausing must stop the clock synchronously, and a
    // subsequent resume must not revive the old animation loop.
    const originalFrame=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame;
    const queuedFrames=new Map();let frameId=0;
    window.requestAnimationFrame=fn=>{queuedFrames.set(++frameId,fn);return frameId;};
    window.cancelAnimationFrame=id=>queuedFrames.delete(id);
    try{
        const pausedCast=harness(),timeline=G.buildGamecast({...narrowWeek,seed:'pause-regression',scoring:narrow.settings.scoring});
        pausedCast.states[0]={value:{timeline,weekData:narrowWeek,finalized:narrow,live:false}};
        pausedCast.states[1]={value:0};pausedCast.states[2]={value:true};pausedCast.states[3]={value:60};
        const props={league:narrow,cards,logIndex:logs,onUpdate(){},active:true};
        const renderPaused=(runEffects=true)=>pausedCast.render(()=>WrTimeLeagueGamecastPanel(props),runEffects);
        let pausedTree=renderPaused();
        queuedFrames.get(frameId)(performance.now()+100);pausedTree=renderPaused();
        const staleFrame=queuedFrames.get(frameId);
        button(pausedTree,'PAUSE').props.onClick();pausedTree=renderPaused();
        const stoppedClock=pausedCast.states[1].value;
        staleFrame(performance.now()+1000);
        assert.equal(pausedCast.states[1].value,stoppedClock,'A stale animation callback cannot advance a paused clock');
        button(pausedTree,'RESUME').props.onClick();renderPaused();
        staleFrame(performance.now()+2000);
        assert.equal(pausedCast.states[1].value,stoppedClock,'Resuming cannot revive an earlier animation loop');
        const activeFrame=queuedFrames.get(frameId);
        props.active=false;renderPaused(false);
        activeFrame(performance.now()+3000);
        assert.equal(pausedCast.states[1].value,stoppedClock,'Leaving the tab stops queued frames before effect cleanup runs');
        props.active=true;
        const beforeInstant=renderPaused();let blurred=false;
        button(beforeInstant,'INSTANT').props.onClick({currentTarget:{blur(){blurred=true;}}});
        const afterInstant=renderPaused(),finalView=all(afterInstant).find(node=>node.props.className==='tl-gameday-primary');
        const focusEvents=[],room={scrollIntoView(){focusEvents.push('room');}};
        finalView.props.ref.current={closest:selector=>selector==='.tl-root'?room:null,focus:options=>{assert(options.preventScroll);focusEvents.push('primary');}};
        queuedFrames.get(frameId)(performance.now()+4000);
        assert(blurred,'Instant releases its disappearing control before final layout changes');
        assert.deepEqual(focusEvents,['room','primary'],'A skipped final restores the padded Vault header and focuses the primary matchup');
        assert(button(afterInstant,'REPLAY FROM START')&&button(afterInstant,'CLOSE GAMECAST'));
        assert(!button(afterInstant,'NEXT PLAY')&&!button(afterInstant,'5 MIN'),'Final actions replace playback controls');
        assert.equal(JSON.stringify(narrow),beforeNarrow,'Pause and tab changes never alter saved scoring');
    }finally{window.requestAnimationFrame=originalFrame;window.cancelAnimationFrame=originalCancel;}
    console.log('PASS: live starter scoring, no final leaks, negative/missing games, saved replay lineups, tab continuity, routed gates, invalid/save failure recovery and multiplayer permissions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
