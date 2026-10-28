'use strict';
function fixture(type='redraft'){
 const players=Object.fromEntries(Array.from({length:60},(_,i)=>{const pos=['QB','RB','WR','TE'][i%4];return ['p'+i,{player_id:'p'+i,full_name:'Player '+i,first_name:'Player',last_name:String(i),position:pos,fantasy_positions:[pos],team:'BUF',status:'Active',active:true,years_exp:3,age:25}];}));
 const league={league_id:'L',season:'2026',status:'in_season',total_rosters:2,settings:{type:type==='dynasty'?2:0,playoff_week_start:15,playoff_teams:2,end_week:17},scoring_settings:{pass_yd:.04,pass_td:4,pass_int:-1,rush_yd:.1,rush_td:6,rec:1,rec_yd:.1,rec_td:6},roster_positions:['QB','RB','WR','TE','FLEX','BN']};
 const rosters=[{roster_id:1,players:['p0','p1','p2','p3','p4'],settings:{}},{roster_id:2,players:['p5','p6','p7'],settings:{}}];
 const stats=Object.fromEntries(Object.keys(players).map((id,i)=>[id,{gp:7,pass_att:210,pass_cmp:140,pass_yd:1000+i*20,pass_td:10,rush_att:80,rush_yd:300+i*10,rush_td:3,rec:30,rec_tgt:50,rec_yd:300+i*20,rec_td:3}]));
 const projections=Object.fromEntries(Object.keys(players).map((id,i)=>[id,{gp:17,pass_att:450,pass_cmp:300,pass_yd:3000+i*20,pass_td:25,rush_att:200,rush_yd:800+i*10,rush_td:9,rec:70,rec_tgt:120,rec_yd:900+i*20,rec_td:8}]));
 const nflState={season:'2026',week:8,display_week:9,season_type:'regular'};
 const market=Object.keys(players).map((pid,i)=>({player:{sleeperId:pid,name:players[pid].full_name,position:players[pid].position,age:25},value:6000-i*50,overallRank:i+1,positionRank:Math.floor(i/4)+1}));
 const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 const fetcher=async(url)=>{const u=new URL(url,'http://fixture'),p=u.pathname;
  if(u.hostname.includes('fantasycalc'))return response(market);
  if(u.hostname.includes('espn')||p.includes('nfl-scoreboard'))return response({events:[]});
  if(p.endsWith('/players/nfl'))return response(players);
  if(p.endsWith('/state/nfl'))return response(nflState);
  if(p.endsWith('/league/L'))return response(league);
  if(p.endsWith('/rosters'))return response(rosters);
  if(p.includes('/stats/'))return response(stats);
  if(p.includes('/projections/'))return response(projections);
  if(p.endsWith('/drafts')||p.includes('/transactions/')||p.endsWith('/users')||p.includes('bracket'))return response([]);
  throw Error('Unmocked URL '+url);
 };
 return {players,league,rosters,stats,projections,nflState,market,fetcher};
}
module.exports={fixture};
