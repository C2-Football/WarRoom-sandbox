'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; global.App = {};
for (const name of ['roster','rules','draft-room','era-rules','season','helmet','engine','ai','ui']) require('../js/shared/time-league-'+name+'.js');
let states=[],refs=[],effects=[],stateIndex=0,refIndex=0;
global.React={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:value=>{const i=stateIndex++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},
    useRef:value=>{const i=refIndex++;refs[i]??={current:value};return refs[i];},
    useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:fn=>effects.push(fn),Fragment:'fragment',
};
App.TimeLeaguePlayerCards={};
let identity=null,resolveProfile;
App.OD={getCurrentUserId:()=> 'alice'};
App.TimeLeagueProfile={teamDefaults:()=>identity,hasSaved:()=>Boolean(identity),get:()=>new Promise(resolve=>{resolveProfile=resolve;})};
require('../js/tabs/time-league.js');
require('../js/components/time-league-setup-panel.js');
assert.equal(TimeLeagueUtils.defaultSeats()[0].name,'Commander');
identity={name:'Northern Lights',helmet:App.TimeLeagueHelmet.presetHelmet('ice-speed'),primaryColor:'#113355',secondaryColor:'#AADDFF',backdrop:'aurora'};
assert.equal(TimeLeagueUtils.defaultSeats()[0].name,identity.name);
const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.children)];
let wrapper=WrTimeLeagueSetupPanel({index:[],onlineIndex:[]});
walk(wrapper).find(node=>node.type==='button'&&JSON.stringify(node.children).includes('Start new')).props.onClick();
stateIndex=0;refIndex=0;
wrapper=WrTimeLeagueSetupPanel({index:[],onlineIndex:[]});
const Builder=walk(wrapper).find(node=>typeof node.type==='function'&&node.type.name==='LeagueBuilder').type;
states=[];refs=[];
const button=(tree,label)=>walk(tree).find(node=>node.type==='button'&&JSON.stringify(node.children).includes(label));
let solo,online;
const props={onCreate:input=>{solo=input;},onCreateOnline:async input=>{online=input;return{ok:true,rowId:'shared'};},onOpenOnline:()=>{},onlineIndexState:'ready'};
const render=()=>{stateIndex=0;refIndex=0;effects=[];return Builder(props);};
(async()=>{
    let tree=render();
    while(tree.props['data-setup-step']<4){button(tree,'Next →').props.onClick();tree=render();}
    await button(tree,'START SOLO DRAFT').props.onClick();
    assert.equal(solo.seats[0].name,'Northern Lights');
    assert.equal(solo.seats[0].backdrop,'aurora');
    assert.deepEqual(solo.seats[0].helmet,identity.helmet);
    const created=App.TimeLeagueEngine.createTimeLeague({...solo,seed:'identity',createdAt:'2026-09-07'});
    assert.equal(created.teams[0].primaryColor,'#113355');
    assert.equal(App.TimeLeagueEngine.normalizeTimeLeague(JSON.parse(JSON.stringify(created))).teams[0].backdrop,'aurora');
    for (let i = 6; i < 12; i++) {
        tree = render(); walk(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'Add team').props.onClick();
    }
    tree = render(); await button(tree, 'START SOLO DRAFT').props.onClick();
    assert.equal(solo.seats.length, 12);
    assert.equal(new Set(solo.seats.map(seat => seat.name)).size, 12);
    assert.equal(new Set(solo.seats.slice(1).map(seat => seat.aiPersona)).size, 11);
    assert(solo.seats.slice(1).every(seat => App.TimeLeagueAI.AI_PERSONAS[seat.aiPersona] && !/^Rival \d+$/.test(seat.name)));
    effects[0]();
    const nameField=walk(tree).find(node=>node.type==='input'&&node.props.placeholder==='Name your team');
    nameField.props.onChange({target:{value:'In-progress team'}});
    identity={...identity,name:'Late cloud profile'};
    resolveProfile({ok:true});await Promise.resolve();
    tree=render();
    assert.equal(walk(tree).find(node=>node.type==='input'&&node.props.placeholder==='Name your team').props.value,'In-progress team','An asynchronous cloud load must preserve edits');
    const restoring=button(tree,'Use saved team design').props.onClick();
    resolveProfile({ok:true});await restoring;
    tree=render();
    walk(tree).find(node=>typeof node.type==='function'&&node.type.name==='PlayModeCard'&&node.props.id==='friends').props.onClick();
    tree=render();
    await button(tree,'CREATE & INVITE').props.onClick();
    assert.equal(online.seats[0].name,'Late cloud profile');
    assert.equal(online.seats[0].primaryColor,'#113355');
    assert.equal(online.seats[0].backdrop,'aurora');
    assert(online.seats.every(seat=>seat.manager==='human'));
    console.log('PASS: saved team identity defaults solo and friends creation, survives normalization, protects edits from late cloud loads and restores explicitly');
})().catch(err=>{console.error(err);process.exitCode=1;});
