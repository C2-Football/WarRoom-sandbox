'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
(async()=>{
    let now=100000,requests=0,fail=true;
    const events=[];
    const fetcher=async()=>{requests++;if(fail)throw Error('offline');return {ok:true,json:async()=>({p:{pass_att:30,pass_yd:250}})};};
    const window={App:{},S:{nflState:{season:2026,week:9},currentWeek:9,currentLeagueId:'league'},fetch:fetcher,dispatchEvent:event=>events.push(event)};
    const context=vm.createContext({window,fetch:fetcher,console,Date:class extends Date{static now(){return now;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
    vm.runInContext(fs.readFileSync('js/shared/weekly-proj.js','utf8'),context);
    const wp=window.App.WeeklyProj;
    assert.equal(await wp.ensureWeekProjections(9),null);assert.equal(requests,1);
    await wp.ensureWeekProjections(9);assert.equal(requests,1,'A failed fetch backs off instead of hammering the provider');
    fail=false;now+=31000;await wp.ensureWeekProjections(9);
    assert.equal(requests,2,'Projection loading recovers automatically after a transient failure');
    assert.equal(wp.providerLine('p',9).pass_yd,250);
    assert.equal(events.length,1,'Successful recovery tells mounted scoreboards to recompute');
    await wp.ensureWeekProjections(9);assert.equal(requests,2,'A fresh success stays cached');
    console.log('PASS projection load recovery: retry backoff, successful retry, redraw event and fresh-cache reuse');
})().catch(error=>{console.error(error);process.exitCode=1;});
