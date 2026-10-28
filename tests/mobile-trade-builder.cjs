'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const source=fs.readFileSync('js/trade-calc.js','utf8');
const ast=Babel.packages.parser.parse(source,{plugins:['jsx']});let node;
const analysisComponents=new Map();
Babel.packages.traverse.default(ast,{FunctionDeclaration(p){if(p.node.id?.name==='TcTradeSide')node=p.node;if(['TcSeasonImpact','TcBuilderSummary','TcMobileTradeAnalysis','TcVerdictPanel'].includes(p.node.id?.name))analysisComponents.set(p.node.id.name,p.node);}});
const h=(type,props,...children)=>({type,props:props||{},children});
const context={React:{createElement:h},window:{}};
vm.createContext(context);vm.runInContext(Babel.transform(source.slice(node.start,node.end),{presets:['react']}).code,context);
const walk=n=>n==null||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.children)];
const actions=[];
const props={side:'A',color:'gold',label:'YOU SEND',tradeIds:{A:[],B:[]},tradePickIds:{A:[],B:[]},tradeFaab:{A:0,B:0},getPlayerValue:()=>({value:1000}),pickValueForParts:()=>500,FAAB_RATE:1,rosterPlayersFor:()=>[{id:'p',name:'Complete Long Player Name',pos:'QB',team:'KC',value:1000}],tradeOwner:{A:'owner',B:null},picksByOwner:{owner:[{year:2027,round:1,fromRosterId:1,slot:1}]},comparePicksByDraftOrder:()=>0,setTradeOwner:fn=>{props.tradeOwner=fn(props.tradeOwner)},setSearchText:fn=>{props.searchText=fn(props.searchText)},ownerOptions:[{id:null,label:'None'},{id:'owner',label:'Complete Team Name'}],playersData:{p:{full_name:'Complete Long Player Name',first_name:'Complete Long',last_name:'Player Name',position:'QB'}},MAX_VALUE:10000,removePlayer:(...args)=>actions.push(['remove',...args]),posColor:()=> 'gold',normPos:x=>x,PICK_COLORS:{1:'gold'},ownerNameForRosterId:()=> 'Complete Team Name',allRosters:[{owner_id:'owner',roster_id:1}],removePick:(...args)=>actions.push(['removePick',...args]),pickLabel:()=> '2027 first round · Complete Team Name',searchText:{A:'',B:''},TC_POS_ORDER:{QB:0},addPlayer:(...args)=>actions.push(['player',...args]),makePickId:()=> 'pick-2027-1-1',addPick:(...args)=>actions.push(['pick',...args]),setTradeFaab:fn=>{props.tradeFaab=fn(props.tradeFaab)}};
let tree=context.TcTradeSide(props);
const find=label=>walk(tree).find(n=>n.props['aria-label']===label);
assert.ok(find('YOU SEND team'));assert.ok(find('Filter you send players and picks'));
find('Add Complete Long Player Name to you send').props.onKeyDown({key:'Enter',preventDefault(){}});
find('Add 2027 first round · Complete Team Name to you send').props.onKeyDown({key:' ',preventDefault(){}});
assert.deepEqual(actions,[['player','A','p'],['pick','A','pick-2027-1-1-s1']]);
props.tradeIds.A=['p'];tree=context.TcTradeSide(props);
assert.equal(find('Add Complete Long Player Name to you send').props['aria-disabled'],true);
find('Add Complete Long Player Name to you send').props.onKeyDown({key:'Enter',preventDefault(){}});
assert.equal(actions.length,2,'a selected player cannot be added twice');
find('Remove Complete Long Player Name').props.onClick();assert.deepEqual(actions.at(-1),['remove','A','p']);
find('YOU SEND FAAB amount').props.onChange({target:{value:'-10'}});assert.equal(props.tradeFaab.A,0);
const partner=context.TcTradeSide({...props,side:'B',label:'YOU GET'});
assert.ok(walk(partner).find(n=>n.props['aria-label']==='YOU GET team'));
assert.deepEqual(props.tradeIds.A,['p'],'showing the other side does not reset selected assets');
// Exercise the actual phone Builder composition with both live asset pickers.
let builderNode;
Babel.packages.traverse.default(ast,{VariableDeclarator(p){if(p.node.id.name==='builderSheetEl')builderNode=p.node.init;}});
assert.ok(builderNode);
props.tradeOwner.B='partner';props.tradeFaab.B=5;
props.rosterPlayersFor=side=>side==='A'?[{id:'p',name:'Complete Long Player Name',pos:'QB',team:'KC',value:1000}]:[{id:'q',name:'Partner Running Back',pos:'RB',team:'DET',value:2000}];
props.ownerOptions.push({id:'partner',label:'Partner Team'});
const sideDeps={...props};delete sideDeps.side;delete sideDeps.label;delete sideDeps.color;
for(const name of ['TcSeasonImpact','TcBuilderSummary','TcMobileTradeAnalysis','TcVerdictPanel']){
    const component=analysisComponents.get(name);assert.ok(component,'Use the real '+name+' component in the populated builder test');
    vm.runInContext(Babel.transform(source.slice(component.start,component.end),{presets:['react']}).code,context);
}
Object.assign(context,{builderPlayerContext:null,tradeIds:props.tradeIds,tradePickIds:props.tradePickIds,tradeFaab:props.tradeFaab,playersData:props.playersData,_tsDeps:sideDeps,_verdict:{totalA:1000,totalB:5,hasTrade:false},skinVocabulary:{valueShortLabel:'DHQ'},valueSourceLabel:'format-adjusted values',metricPreference:{},FAAB_RATE:1,renderAlexVerdict:()=>h('p',{},'Alex second opinion fixture'),saveManualTrade(){},Tip:()=>null});
vm.runInContext(Babel.transform('var simultaneousBuilder = '+source.slice(builderNode.start,builderNode.end),{presets:['react']}).code,context);
tree=context.simultaneousBuilder;
assert.ok(find('Assets you send'));assert.ok(find('Assets you receive'));
assert.equal(walk(tree).filter(n=>n.type==='select').length,2,'Both owner controls are rendered together');
assert.ok(find('YOU SEND team'));assert.ok(find('YOU GET team'));
assert.ok(find('Filter you send players and picks'));assert.ok(find('Filter you get players and picks'));
find('Add Partner Running Back to you get').props.onKeyDown({key:'Enter',preventDefault(){}});
assert.deepEqual(actions.at(-1),['player','B','q'],'Partner assets go into the receive package');
find('Filter you send players and picks').props.onChange({target:{value:'Quarterback'}});
find('Filter you get players and picks').props.onChange({target:{value:'Running back'}});
assert.equal(props.searchText.A,'Quarterback');assert.equal(props.searchText.B,'Running back','Each visible roster keeps its own filter');
find('YOU SEND FAAB amount').props.onChange({target:{value:'10'}});
find('YOU GET FAAB amount').props.onChange({target:{value:'20'}});
assert.equal(props.tradeFaab.A,10);assert.equal(props.tradeFaab.B,20);
find('Remove FAAB from you get').props.onClick();assert.equal(props.tradeFaab.B,0);assert.equal(props.tradeFaab.A,10,'Clearing received FAAB keeps sent FAAB');
assert.deepEqual(props.tradeIds.A,['p'],'Working in the receive column retains sent assets');
console.log('PASS mobile trade builder: simultaneous sides, independent roster filters and FAAB, complete names, keyboard selection, duplicate guard and retained packages');

// Execute the populated phone composition and its real analysis components.
// Each component instance has independent hooks so summary/detail composition
// cannot accidentally borrow state when loading resolves or a deal changes.
const copy=n=>(n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):(Array.isArray(n)?n:n.children||[]).map(copy).join(' ')).replace(/\s+/g,' ');
// Native mobile disclosures keep detail in the DOM without making the default
// reading path as tall as the fully expanded report.
const visibleCopy=node=>{
    if(node==null||typeof node==='boolean')return '';
    if(typeof node!=='object')return String(node);
    if(Array.isArray(node))return node.map(visibleCopy).join(' ').replace(/\s+/g,' ');
    if(node.type==='details'&&!node.props.open)return visibleCopy((node.children||[]).flat(Infinity).find(child=>child?.type==='summary'));
    return(node.children||[]).map(visibleCopy).join(' ').replace(/\s+/g,' ');
};
const turn=()=>new Promise(resolve=>setTimeout(resolve,12));
function analysisHarness({pro=true}={}){
    const instances=new Map();let current,effects=[],visited;
    const hooks={
        Fragment:'fragment',createElement:h,
        useState(initial){const i=current.index++;if(!(i in current.values))current.values[i]=typeof initial==='function'?initial():initial;const instance=current;return[instance.values[i],value=>{instance.values[i]=typeof value==='function'?value(instance.values[i]):value;}];},
        useRef(initial){const i=current.index++;return current.values[i]||(current.values[i]={current:initial});},
        useMemo(callback,deps){const i=current.index++;const previous=current.values[i];if(!previous||deps.some((value,index)=>value!==previous.deps[index]))current.values[i]={value:callback(),deps};return current.values[i].value;},
        useEffect(callback,deps){const i=current.index++,instance=current,previous=instance.dependencies[i];if(!previous||!deps||deps.some((value,index)=>value!==previous[index])){instance.dependencies[i]=deps;effects.push(()=>{instance.cleanups[i]?.();instance.cleanups[i]=callback();});}},
    };
    Object.assign(context.React,hooks);
    Object.assign(context.window,{setTimeout,clearTimeout,wrIsPro:()=>pro});
    function expand(value,path='root'){
        if(value==null||typeof value!=='object')return value;
        if(Array.isArray(value))return value.map((child,index)=>expand(child,path+'.'+index));
        if(typeof value.type==='function'){
            const key=path+':'+value.type.name;visited.add(key);
            const instance=instances.get(key)||{values:[],dependencies:[],cleanups:[],index:0};instances.set(key,instance);instance.index=0;
            const parent=current;current=instance;
            const result=value.type({...value.props,children:value.children.length===1?value.children[0]:value.children});
            current=parent;return expand(result,key);
        }
        return{...value,children:(value.children||[]).map((child,index)=>expand(child,path+'.'+index))};
    }
    vm.runInContext(Babel.transform('function renderBuilderFixture(){ return '+source.slice(builderNode.start,builderNode.end)+'; }',{presets:['react']}).code,context);
    return{
        render(verdict){context._verdict=verdict;effects=[];visited=new Set();const result=expand(context.renderBuilderFixture());for(const[key,instance]of instances)if(!visited.has(key)){instance.cleanups.forEach(cleanup=>cleanup?.());instances.delete(key);}effects.forEach(run=>run());return result;},
        dispose(){instances.forEach(instance=>instance.cleanups.forEach(cleanup=>cleanup?.()));},
    };
}
const seasonResult={status:'ready',effectiveWeek:7,remainingWeeks:2,coverage:{projected:2,total:2},powerRank:{before:4,after:2,total:6,beforePoints:99,afterPoints:106},wins:{beforeRemaining:.9,afterRemaining:1.3,delta:.4},playoffs:{available:true,beforePct:40,afterPct:55,simCount:3000},weeks:[{week:7,opponentName:'Future rival',beforePoints:99,afterPoints:106,beforeWinPct:48,afterWinPct:66,pointsDelta:7,beforeStarters:[{pid:'p'}],afterStarters:[{pid:'q'}]}],assumptions:['Current injury status held fixed.'],warnings:[]};
const fixtureDeal={myRosterId:1,partnerRosterId:2,givePlayerIds:['p'],receivePlayerIds:['q']};
const baseVerdict={hasTrade:true,totalA:1000,totalB:1100,grade:{grade:'B',label:'Fair'},diffDisplay:'+100',verdictColor:'gold',likelihood:67,likelihoodColor:'green',rosterImpactLabel:'+RB / -QB',starterValueDelta:100,pickCapitalDelta:0,pickQuantityDelta:0,faabDelta:0,netTaxTotal:0,otherOwnerId:null,otherDnaKey:'NONE',otherDna:{},psychTaxes:[],grudgeTax:{total:0,entries:[]},gmWarnings:[],seasonImpactDeal:fixtureDeal};
const readyController=(analyze,key='league-2026')=>({enabled:true,status:'ready',key,fromWeek:7,analyze,playerName:pid=>pid==='p'?'Outgoing starter':'Incoming starter'});
const byClass=(root,name)=>walk(root).find(n=>(n.props.className||'').split(' ').includes(name));
function assertBuilderOrder(rendered){
    const all=walk(rendered),summary=byClass(rendered,'mc-trade-builder-summary'),packages=byClass(rendered,'mc-trade-packages'),sides=byClass(rendered,'mc-trade-builder-sides'),analysis=walk(rendered).find(n=>n.props.id==='wr-export-trade');
    assert(summary&&packages&&sides&&analysis,'Populated builder keeps summary, packages, simultaneous pickers and detailed analysis');
    assert(all.indexOf(summary)<all.indexOf(packages),'Trade grade, acceptance and season help appear before the selected packages');
    assert(all.indexOf(packages)<all.indexOf(sides),'Selected packages stay above the two live asset pickers');
    assert(all.indexOf(sides)<all.indexOf(analysis),'The deeper analysis stays below the asset pickers');
    assert.equal(all.filter(n=>n.props.id==='wr-export-trade').length,1,'Only the detailed analysis owns the snapshot export id');
    return summary;
}
(async()=>{
    let analyzes=0,ui=analysisHarness(),verdict={...baseVerdict,seasonImpactController:readyController(()=>{analyzes++;return seasonResult;})};
    let rendered=ui.render(verdict),summary=assertBuilderOrder(rendered);
    assert.match(copy(summary),/B/);assert.match(copy(summary),/67\s*\/100/);assert.match(copy(summary),/Calculating|Season impact/i,'Pending season data does not hide price or acceptance');
    await turn();rendered=ui.render(verdict);summary=assertBuilderOrder(rendered);
    assert.match(copy(summary),/Helps your season/);assert.match(copy(summary),/\+?0\.4/);
    assert.equal(analyzes,1,'Summary and deeper analysis share one season comparison');
    assert.equal(walk(rendered).filter(n=>n.type==='table'&&n.props.className==='tc-season-weeks').length,1,'The remaining-games analysis is rendered once below the pickers');
    assert(!walk(summary).some(n=>n.type==='table'),'The summary does not duplicate the remaining-games table');
    assert.match(copy(walk(rendered).find(n=>n.props.id==='wr-export-trade')),/Future rival|Remaining games/);
    ui.render(verdict);assert.equal(analyzes,1,'A render with unchanged deal facts does not restart the season comparison');ui.dispose();

    ui=analysisHarness();verdict={...baseVerdict,seasonImpactController:{enabled:true,status:'loading',key:'loading',analyze(){throw new Error('Unprepared season data must not be analyzed');}}};
    rendered=ui.render(verdict);summary=assertBuilderOrder(rendered);await turn();
    assert.match(copy(summary),/Calculating/);assert.match(copy(summary),/B/);assert.match(copy(summary),/67\s*\/100/);assert(!copy(summary).includes('Helps your season'));ui.dispose();

    for(const pro of [false,true]){
        ui=analysisHarness({pro});verdict={...baseVerdict,seasonImpactController:{enabled:true,status:'unavailable',key:'missing',reason:'Season data unavailable.'}};
        rendered=ui.render(verdict);summary=assertBuilderOrder(rendered);
        assert.match(copy(summary),/B/);assert.equal(/67\s*\/100/.test(copy(summary)),pro,'Top acceptance estimate preserves the free/Pro gate');
        assert.match(copy(rendered),/Season data unavailable/);assert(!copy(summary).includes('Helps your season'));assert(!copy(summary).includes('0.0 expected wins'));
        assert.equal(walk(rendered).filter(n=>n.type==='table'&&n.props.className==='tc-season-weeks').length,0);ui.dispose();
    }
    ui=analysisHarness({pro:false});verdict={...baseVerdict,seasonImpactController:readyController(()=>seasonResult)};ui.render(verdict);await turn();rendered=ui.render(verdict);summary=assertBuilderOrder(rendered);
    assert.match(copy(summary),/Helps your season/);assert.match(copy(summary),/\+?0\.4/);assert(!/67\s*\/100/.test(copy(summary)),'Projected season help remains free while acceptance stays Pro');ui.dispose();
    ui=analysisHarness();rendered=ui.render({...baseVerdict,seasonImpactController:{enabled:false}});summary=assertBuilderOrder(rendered);
    assert.match(copy(summary),/B/);assert.match(copy(summary),/67\s*\/100/);assert(!/Helps your season|Costs projected wins|expected wins|Playoff chance/.test(copy(summary)),'Dynasty or disabled season model does not invent a projected season gain');ui.dispose();
    ui=analysisHarness();rendered=ui.render({...baseVerdict,hasTrade:false,seasonImpactController:{enabled:false}});assert(!byClass(rendered,'mc-trade-builder-summary'),'Empty builder does not show a fabricated verdict');assert(byClass(rendered,'mc-trade-builder-sides'),'Empty builder keeps both asset pickers');ui.dispose();

    // The mobile dynasty analysis stays compact while preserving the complete
    // negotiation read and the user's own strategy warnings at both tiers.
    const factorNames=['Endowment effect','Panic premium','Status tax','Loss aversion','Rebuilding discount','Need fulfillment','Window alignment','Posture'];
    const richVerdict={...baseVerdict,seasonImpactController:{enabled:false},otherOwnerId:'partner',theirPosture:{color:'#eeaa66',label:'Active Buyer'},otherDnaKey:'FLEECER',otherDna:{label:'The Fleecer',color:'#ff9988',strategy:'Lead with visible surplus.'},psychTaxes:factorNames.map((name,index)=>({name,desc:'Factor description '+index,impact:index%2?-2:3,type:index%2?'TAX':'BONUS'})),grudgeTax:{total:-5,entries:[{}]},manualBehaviorFit:{acceptanceDelta:3,framing:'Recorded trade behavior.'},manualBehaviorProfile:{inferences:['frequent-counteroffers']},gmFloor:60,gmModeLabel:'Contend',gmViability:'Playable',gmWarnings:[{text:'Untouchable in deal: Outgoing starter'}]};
    for(const pro of [false,true]){
        ui=analysisHarness({pro});rendered=ui.render(richVerdict);assertBuilderOrder(rendered);
        const analysis=byClass(rendered,'mc-trade-analysis-card'),values=byClass(rendered,'tc-trade-value-rows');
        assert(analysis,'The phone uses the compact analysis presentation');
        assert(!(analysis.props.className||'').includes('tc-ta-sticky-summary'),'The lower mobile report does not inherit the sticky desktop summary');
        assert(values);assert.match(visibleCopy(values),/Player value/);assert.match(visibleCopy(values),/100/);
        assert(!/Pick capital|FAAB/.test(visibleCopy(values)),'Zero pick and FAAB changes do not add empty rows');
        assert.match(visibleCopy(analysis),/Untouchable in deal: Outgoing starter/,'The user’s strategy warning stays visible outside closed detail, including Free');
        const ownerDetails=byClass(rendered,'tc-season-owner-details');assert.equal(ownerDetails.type,'details');assert(!ownerDetails.props.open,'Owner fit starts collapsed');
        assert.match(visibleCopy(ownerDetails),/Owner fit.*negotiation/i);
        assert(!/Endowment effect|Factor description|Likelihood of Acceptance/.test(visibleCopy(ownerDetails)),'The collapsed owner summary does not repeat the long acceptance report');
        assert.equal(copy(ownerDetails).includes('Endowment effect'),pro,'Psychology detail remains behind Pro');
        assert.equal(copy(ownerDetails).includes('The Fleecer'),pro,'The inferred owner read remains behind Pro');
        if(pro){for(const name of factorNames)assert(copy(ownerDetails).includes(name),'Expanded disclosure retains '+name);assert.match(copy(ownerDetails),/Grudge Tax/);assert.match(copy(ownerDetails),/Observed Behavior/);}
        assert.equal(/67\s*\/100/.test(copy(rendered)),pro,'No acceptance value leaks into the free phone analysis');
        assert(!walk(ownerDetails).some(item=>item.type==='button'&&/Why\?/.test(copy(item))),'Mobile negotiation needs only one native disclosure');
        const opinion=byClass(rendered,'tc-trade-second-opinion');assert.equal(opinion.type,'details');assert(!opinion.props.open,'Alex opinion starts collapsed');assert.match(copy(opinion),/Alex second opinion fixture/);assert(!visibleCopy(opinion).includes('Alex second opinion fixture'));
        ui.dispose();
    }
    ui=analysisHarness();rendered=ui.render({...richVerdict,starterValueDelta:0,pickCapitalDelta:-50,pickQuantityDelta:-1,faabDelta:-10});
    const changedValues=byClass(rendered,'tc-trade-value-rows');assert.match(copy(changedValues),/Player value.*0/);assert.match(copy(changedValues),/Pick capital.*-50/);
    const faabRow=walk(changedValues).find(item=>item.type==='div'&&(item.children||[]).flat(Infinity).some(child=>child?.type==='dt'&&copy(child)==='FAAB'));
    assert.match(copy(walk(faabRow).find(item=>item.type==='strong')),/[−-]\s*\$\s*10/,'The cash amount keeps its negative sign');assert.match(copy(faabRow),/-10 DHQ value/,'The separate DHQ equivalent uses the active FAAB rate');ui.dispose();

    let resolveOld;analyzes=0;ui=analysisHarness();const delayed=readyController(deal=>{analyzes++;return deal.partnerRosterId===2?new Promise(resolve=>{resolveOld=resolve;}):{...seasonResult,wins:{...seasonResult.wins,delta:deal.receivePlayerIds.includes('replacement') ? .7 : -.4}};});
    verdict={...baseVerdict,seasonImpactController:delayed};ui.render(verdict);await turn();
    verdict={...verdict,seasonImpactDeal:{...fixtureDeal,partnerRosterId:3},grade:{grade:'D',label:'Overpay'},diffDisplay:'-500',likelihood:32};
    rendered=ui.render(verdict);summary=assertBuilderOrder(rendered);assert.match(copy(summary),/D/);assert.match(copy(summary),/32\s*\/100/);assert(!copy(summary).includes('Helps your season'));
    await turn();rendered=ui.render(verdict);assert.match(copy(assertBuilderOrder(rendered)),/Costs projected wins/);assert.equal(analyzes,2,'Changing only the partner requests the new deal comparison');
    resolveOld(seasonResult);await turn();rendered=ui.render(verdict);assert.match(copy(assertBuilderOrder(rendered)),/Costs projected wins/);assert(!copy(assertBuilderOrder(rendered)).includes('Helps your season'),'Late old-deal results cannot replace the edited builder summary');
    verdict={...verdict,seasonImpactDeal:{...verdict.seasonImpactDeal,receivePlayerIds:['replacement']}};rendered=ui.render(verdict);assert(!copy(assertBuilderOrder(rendered)).includes('Costs projected wins'),'An edited asset does not retain the previous deal forecast');
    await turn();rendered=ui.render(verdict);summary=assertBuilderOrder(rendered);assert.match(copy(summary),/Helps your season/);assert.match(copy(summary),/\+?0\.7/);assert.equal(analyzes,3,'Changing only the received asset refreshes the comparison');ui.dispose();
    console.log('PASS populated mobile trade builder: summary-before-assets, deeper analysis below, one comparison/export/table, free/Pro gates, unavailable state and edited-deal stale isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
