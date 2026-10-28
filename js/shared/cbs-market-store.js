/* Browser consumes one verified immutable snapshot. It never scrapes CBS. */
(function () {
    'use strict';
    const App=window.App=window.App||{}, M=App.RedraftMarket, TTL=15*60*1000, RETRY=30000;
    let snapshot=null,config=null,job=null,inflight=null,checkedAt=0,retryAt=0,generation=0,error=null,local=false,revision=0;
    const key='dhq_cbs_snapshot_v1',base=new URL('../../content/markets/cbs/',document.currentScript?.src || new URL('js/shared/cbs-market-store.js',document.baseURI));
    const context=()=>({season:Number(window.S?.nflState?.season || window.S?.league?.season),week:Number(window.App?.WeeklyProj?.currentWeek?.() || window.S?.currentWeek),now:Date.now()});
    function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
    function announce(){revision++;App.PlayerValue?.marketChanged?.();try{window.dispatchEvent(new CustomEvent('wr:ros-market-loaded',{detail:{source:'cbs',version:snapshot?.id||null}}));}catch(_){/* headless */}}
    async function json(url){const r=await fetch(url,{cache:'no-store',signal:window.AbortSignal.timeout(15000)});if(!r.ok)throw Error('CBS snapshot service unavailable (HTTP '+r.status+').');return r.json();}
    async function accept(next,ctx=context(),current=()=>true) {
        await M.verify(next,ctx);
        if(!current())throw Error('CBS refresh was superseded; retry.');
        const comparison=M.compare(next,snapshot);
        if(!comparison.allowed||(comparison.warnings.length&&next.reviewedChanges?.contentHash!==next.contentHash))throw Error(comparison.warnings.join(' '));
        if(snapshot?.id===next.id)return false;
        snapshot=freeze(next);announce();return true;
    }
    async function ensure({force=false}={}) {
        if(inflight)return inflight;
        if(!force&&(Date.now()<retryAt||checkedAt&&Date.now()-checkedAt<TTL))return snapshot;
        const gen=generation,ctx=context();
        if(!ctx.season||!ctx.week)return snapshot;
        inflight=(async()=>{
            try{
                if(!snapshot){try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved){await M.verify(saved,{...ctx,season:saved.chart.season,week:18});if(gen===generation){snapshot=freeze(saved);local=saved.mode==='manual-browser';}}}catch(_){/* corrupt local cache is ignored */}}
                if(!config){const loaded=await json(new URL('config.json',base));if(gen!==generation)return snapshot;config=loaded;}
                const next=await json(config.snapshotUrl);
                if(gen!==generation||ctx.season!==context().season)return snapshot;
                await accept(next,ctx,()=>gen===generation&&ctx.season===context().season&&ctx.week===context().week);local=false;checkedAt=Date.now();retryAt=0;error=null;
                try{localStorage.setItem(key,JSON.stringify(snapshot));}catch(_){/* quota */}
                // Job health is independent of the successful import timestamp.
                try{const status=await json(config.statusUrl);if(gen===generation)job=status;}catch(_){if(gen===generation)job=null;}
                announce();
            }catch(e){if(gen===generation){error=e.message;retryAt=Date.now()+RETRY;announce();}}
            finally{if(gen===generation)inflight=null;}
            return snapshot;
        })();
        return inflight;
    }
    async function importChart(chart,players) {
        const ctx=context(),gen=generation;
        let aliases={};try{aliases=await json(new URL('aliases.json',base));}catch(_){/* exact-name matching remains available */}
        const next=await M.createSnapshot(chart.chart||chart,players,{...ctx,aliases,mode:'manual-browser',previous:snapshot});
        if(gen!==generation||ctx.season!==context().season)throw Error('Season changed during import; retry.');
        await accept(next,ctx,()=>gen===generation&&ctx.season===context().season&&ctx.week===context().week);local=true;error=null;
        try{localStorage.setItem(key,JSON.stringify(snapshot));}catch(_){/* quota */}
        announce();return snapshot;
    }
    function read(league,week){return M.input(snapshot,league,week);}
    function identity(league,week){const input=read(league,week);return JSON.stringify([input.version,input.status,input.format,config?.weights||M.DEFAULT_WEIGHTS]);}
    function invalidate(){generation++;inflight=null;config=null;checkedAt=0;retryAt=0;announce();}
    App.CbsMarket={ensure,refresh:()=>ensure({force:true}),importChart,read,identity,invalidate,get revision(){return revision;},get snapshot(){return snapshot;},get weights(){return config?.weights||M.DEFAULT_WEIGHTS;},state:()=>({error,job,local,checkedAt,automationStatus:config?.automationStatus||'CBS automation is not activated; permission and scheduler setup are required.'})};
    // An open tab checks periodically; the separate daily server job works without it.
    window.setInterval(()=>{if(App.LeagueSkin?.getCurrent?.()?.type==='redraft'){announce();ensure();}},TTL);
})();
