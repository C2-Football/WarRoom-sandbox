'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const retired=['advice-scorecard.css','content/advice-scorecard.json','js/shared/advice-capture.js','js/components/advice-scorecard.js','reconai-shared/advice-scorecard.js'];
test('internal evaluator is available to the server without browser collection or scorecard UI',()=>{
 assert(fs.existsSync(path.join(root,'server/generated/advice-scorecard.js')),'Canonical evaluator must be synchronized to the private server directory');
 for(const file of retired)assert(!fs.existsSync(path.join(root,file)),file+' must not be a browser asset');
 for(const file of ['index.html','js/tabs/my-team.js','js/components/roster-lenses.js','js/shared/roster-waiver-lens.js','js/shared/roster-trade-lens.js']){
  assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/AdviceCapture|AdviceScorecard|advice-scorecard|advice-capture/,file+' must not wire the internal evaluator into the app');
 }
});
test('the public release excludes internal advice code, configuration and report routes',()=>{
 const arg=process.argv.find(x=>x.startsWith('--artifact='));
 if(!arg)return;
 const publicRoot=path.resolve(root,arg.slice('--artifact='.length));
 assert(fs.existsSync(path.join(publicRoot,'index.html')),'A built public artifact is required');
 for(const file of [...retired,'server','scripts/advice'])assert(!fs.existsSync(path.join(publicRoot,file)),file+' must not be publicly published');
 assert.doesNotMatch(fs.readFileSync(path.join(publicRoot,'index.html'),'utf8'),/AdviceScorecard|AdviceCapture|advice-scorecard|advice-capture/);
 for(const file of ['js/tabs/my-team.js','js/components/roster-lenses.js']){
  assert.doesNotMatch(fs.readFileSync(path.join(publicRoot,file),'utf8'),/AdviceScorecard|AdviceCapture/);
 }
});
