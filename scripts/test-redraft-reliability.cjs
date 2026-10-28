// Focused local reliability verification. Browser and production checks run separately.
const fs=require('fs'),cp=require('child_process');
fs.mkdirSync('output/reliability',{recursive:true});
const files=fs.readdirSync('tests').filter(f=>/^(redraft-|roster-(waiver|trade|lenses)|waiver-|weekly-waivers|free-agency-roster|fa-market-data|trade-|mobile-trade|mission-trades|alex-format-context|ai-routing|forecast-|lineup-forecast|lineup-live-scoring|weekly-form|nfl-byes)/.test(f)&&!/browser|^redraft-reliability-build\./.test(f)&&/\.(cjs|js)$/.test(f));
files.push('sleeper-portfolio.cjs','league-linked-season.cjs','nfl-scoreboard-cache.cjs','mission-market.cjs','roster-lens-basis.cjs','dashboard-league-widgets.cjs','draft-live-sync.js','draft-live-decision.js','player-card-fantasy.cjs');
const results=[];
for(const file of files){const r=cp.spawnSync(process.execPath,['tests/'+file],{encoding:'utf8',timeout:120000});fs.writeFileSync('output/reliability/'+file+'.log',(r.stdout||'')+(r.stderr||''));results.push({file,status:r.status,error:r.error?.message});console.log((r.status===0?'PASS':'FAIL')+' '+file);}
fs.writeFileSync('output/reliability/test-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.filter(r=>r.status===0).length,total:results.length}));

if(results.some(r=>r.status!==0))process.exitCode=1;
