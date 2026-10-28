const M=require('../../js/shared/redraft-market.js');
const now=Date.parse('2026-10-27T18:00:00Z');
function fixture(){
 const rows=[],players={},stats={};
 for(const [pos,count] of Object.entries({QB:18,RB:35,WR:40,TE:17}))for(let i=0;i<count;i++){
  const id=pos+i,name='Fixture '+pos+' Player '+i,value=Math.max(0,50-i);
  players[id]={player_id:id,position:pos,full_name:name,team:'BUF',active:true,status:'Active'};
  rows.push({name,position:pos,team:'BUF',values:Object.fromEntries(M.COLUMNS[pos].map((c,j)=>[c,value+j]))});
  stats[id]={gp:7,pass_att:210,pass_cmp:140,pass_yd:(250-i)*7,pass_td:14,rush_att:70,rush_yd:(90-i)*7,rec:35,rec_tgt:49,rec_yd:(100-i)*7};
 }
 const chart={sourceUrl:'https://www.cbssports.com/fantasy/football/news/fixture-trade-chart/',attribution:'CBS Sports (synthetic test data)',season:2026,week:8,publishedAt:'2026-10-27T12:00:00Z',updatedAt:'2026-10-27T13:00:00Z',columns:M.COLUMNS,rows};
 const league={league_id:'L',season:'2026',total_rosters:12,status:'in_season',settings:{type:0,playoff_week_start:15,playoff_end_week:17},roster_positions:['QB','RB','WR','TE','FLEX','BN','BN'],scoring_settings:{pass_td:4,pass_yd:.04,pass_int:-2,rush_yd:.1,rush_td:6,rec:1,rec_yd:.1,rec_td:6,fum_lost:-2}};
 return {chart,players,stats,league,season:2026,week:8,now};
}
function html(chart){const headings={QB:'Quarterback',RB:'Running back',WR:'Wide receiver',TE:'Tight end'};return '<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',headline:`${chart.season} Week ${chart.week} Trade Chart`,datePublished:chart.publishedAt,dateModified:chart.updatedAt,author:{name:'Synthetic Fixture'}})+'</script>'+Object.entries(chart.columns).map(([p,cols])=>'<h2>'+headings[p]+' trade values</h2><table><tr>'+['Player','tm',...cols].map(c=>'<th>'+c+'</th>').join('')+'</tr>'+chart.rows.filter(r=>r.position===p).map(r=>'<tr>'+[r.name,r.team,...cols.map(c=>r.values[c]??'--')].map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>').join('');}
module.exports={fixture,html,now};
