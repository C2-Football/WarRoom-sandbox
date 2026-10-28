'use strict';
const fs=require('node:fs'),path=require('node:path'),cheerio=require('cheerio');
const Market=require('../../js/shared/redraft-market.js');
function parseArticle(html,url) {
 const $=cheerio.load(html);let article;
 $('script[type="application/ld+json"]').each((_,el)=>{let data;try{data=JSON.parse($(el).text());}catch{return;}for(const item of Array.isArray(data)?data:data['@graph']||[data])if(item['@type']==='NewsArticle')article=item;});
 if(!article||!/trade (?:value |values )?chart/i.test(article.headline||''))throw Error('Expected a CBS trade chart NewsArticle.');
 const week=Number((article.headline.match(/week\s+(\d+)/i)||[])[1]);
 const titleYear=(article.headline.match(/\b(20\d{2})\b/)||[])[1];
 const publishedAt=article.datePublished||null,updatedAt=article.dateModified||null;
 // Season is article evidence, never inferred from the season requested by the job.
 const publication=publishedAt?new Date(publishedAt):null;
 const season=Number(titleYear||(publication?(publication.getUTCMonth()===0?publication.getUTCFullYear()-1:publication.getUTCFullYear()):NaN));
 const chart={sourceUrl:url,attribution:'CBS Sports — '+(article.author?.name||'Fantasy Football'),season,week,publishedAt,updatedAt,columns:{},rows:[]};
 const labels={'quarterback':'QB','running back':'RB','wide receiver':'WR','tight end':'TE'};
 let position=null;
 $('h2,h3,h4,table').each((_,el)=>{
  if(el.tagName!=='table'){const heading=$(el).text().toLowerCase();position=Object.keys(labels).find(k=>heading.includes(k));position=labels[position]||null;return;}
  const table=$(el),rows=table.find('tr').toArray();
  const headers=$(rows[0]).find('th,td').map((_,c)=>$(c).text().trim()).get();
  if(!headers.some(h=>/^player$/i.test(h)))return;
  if(!position||chart.columns[position])throw Error('Unknown or duplicate player table heading.');
  if(headers.length!==5||!/^tm$/i.test(headers[1]))throw Error('CBS table structure changed.');
  const cols=headers.slice(2);if(JSON.stringify(cols)!==JSON.stringify(Market.COLUMNS[position]))throw Error('CBS column structure changed.');
  chart.columns[position]=cols;
  for(const tr of rows.slice(1)){
   const cells=$(tr).find('td').map((_,c)=>$(c).text().replace(/\s+/g,' ').trim()).get();
   if(cells.length!==5)throw Error('Malformed CBS table row.');
   const values={};for(let i=0;i<cols.length;i++){const raw=cells[i+2];if(/^(?:--|—|–|)$/u.test(raw))values[cols[i]]=null;else if(/^\d+(?:\.\d+)?$/.test(raw))values[cols[i]]=Number(raw);else throw Error('Unexpected CBS numeric cell.');}
   chart.rows.push({name:cells[0],team:cells[1],position,values});
  }
 });
 return chart;
}
function discover(xml,base) {
 const $=cheerio.load(xml,{xmlMode:true}),urls=new Set();
 $('url').each((_,el)=>{const url=$(el).find('loc').first().text(),title=$(el).find('news\\:title,title').text();if(Market.sourceUrl(url)&&/trade.{0,16}(chart|value)/i.test(url+' '+title))urls.add(url);});
 // Also accepts CBS's public football landing page; does not invent article slugs.
 if(!urls.size){const html=cheerio.load(xml);html('a[href]').each((_,el)=>{let url;try{url=new URL(html(el).attr('href'),base).href;}catch{return;}if(Market.sourceUrl(url)&&/trade.{0,16}(chart|value)/i.test(url+' '+html(el).text()))urls.add(url);});}
 return [...urls];
}
function atomicJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');fs.renameSync(tmp,file);}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function publish(chart,{dir,players,season,week,now=Date.now(),aliases={},mode='manual',permissionReference=null,approveChange=null}) {
 const active=read(path.join(dir,'current.json'));
 const candidate=await Market.createSnapshot(chart,players,{season,week,now,aliases,mode,permissionReference,previous:active});
 if(active)await Market.verify(active,{season:active.chart.season,week:18,now});
 const comparison=Market.compare(candidate,active);
 if(!comparison.allowed)throw Error(comparison.warnings.join(' '));
 if(comparison.warnings.length&&approveChange!==candidate.contentHash){atomicJson(path.join(dir,'quarantine',candidate.id+'.json'),{candidate,warnings:comparison.warnings});throw Error('Quarantined unexpected changes. Review content hash '+candidate.contentHash+': '+comparison.warnings.join(' '));}
 if(active&&active.contentHash===candidate.contentHash&&active.mappingHash===candidate.mappingHash&&active.parserVersion===candidate.parserVersion)return {changed:false,snapshot:active};
 if(comparison.warnings.length){candidate.reviewedChanges={contentHash:candidate.contentHash,warnings:comparison.warnings,approvedAt:new Date(now).toISOString()};const {id,...body}=candidate;candidate.id=await Market.hash(body);}
 // Immutable archive first; a single atomic rename exposes a complete version.
 atomicJson(path.join(dir,'snapshots',candidate.id+'.json'),candidate);
 atomicJson(path.join(dir,'current.json'),candidate);
 return {changed:true,snapshot:candidate};
}
async function get(url,fetcher=fetch){const r=await fetcher(url,{redirect:'error',headers:{'User-Agent':'DHQ-CBS-Market/1.0 (authorized chart import)'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Retrieval failed ('+r.status+'): '+url);const text=await r.text();if(text.length>4000000)throw Error('Source exceeds size limit.');return text;}
async function run(options) {
 const {dir,season,week,players,now=Date.now(),fetcher=fetch}=options;
 try {
  let charts=[];
  if(options.chart)charts=[options.chart];
  else {
   // CBS terms prohibit unauthorized automated collection. No retries through
   // alternate hosts, proxies, search snippets, or changed user agents.
   if(!options.permissionReference)throw Error('CBS automatic retrieval blocked: permission or an authorized source agreement is required under CBS Terms of Use section 10. Manual import remains available.');
   const seeds=['https://www.cbssports.com/news-fantasy-sitemap.xml','https://www.cbssports.com/fantasy/football/'];
   const urls=new Set();for(const seed of seeds){for(const u of discover(await get(seed,fetcher),seed))urls.add(u);}
   const active=read(path.join(dir,'current.json'));if(active?.chart?.season===Number(season))urls.add(active.chart.sourceUrl); // corrections after sitemap rollover
   if(!urls.size)throw Error('Discovery found no CBS trade-chart articles.');
   if(urls.size>30)throw Error('Discovery found too many candidates; review pagination before claiming the newest chart.');
   const failures=[];
   for(const url of [...urls].slice(0,30))try{const c=parseArticle(await get(url,fetcher),url);if(c.season===Number(season)&&c.week<=Number(week))charts.push(c);}catch(e){failures.push(e.message);}
   if(failures.length)throw Error('Discovery/retrieval incomplete; active chart retained. '+failures.join(' '));
  }
  charts.sort((a,b)=>b.week-a.week||Date.parse(b.updatedAt||b.publishedAt||0)-Date.parse(a.updatedAt||a.publishedAt||0));
  if(!charts.length)throw Error('No applicable current-season chart discovered; last valid snapshot retained.');
  const result=await publish(charts[0],{...options,players,season,week,now,mode:options.chart?'manual':'automatic'});
  atomicJson(path.join(dir,'status.json'),{checkedAt:new Date(now).toISOString(),status:'ok',version:result.snapshot.id,latestImportedWeek:result.snapshot.chart.week,requestedWeek:Number(week),confirmedCurrentWeek:result.snapshot.chart.week===Number(week),changed:result.changed});
  return result;
 }catch(error){atomicJson(path.join(dir,'status.json'),{checkedAt:new Date(now).toISOString(),status:'blocked',reason:error.message,requestedSeason:Number(season),requestedWeek:Number(week)});throw error;}
}
module.exports={parseArticle,discover,publish,run,atomicJson,read};
