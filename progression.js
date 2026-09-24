export const progressionConfig={
 pointsPerXp:10,
 maxXpPerHand:100,
 rebirthMinimumStack:1,
 rebirthTargetStack:2000,
 rebirthBadgeMs:15000,
 levelXp:[0,100,250,450,700,1000,1350,1750,2200,2700,3350,4050,4800,5600,6500,7500,8600,9800,10900,12000,13400,14900,16500,18200,20000,21900,23900,26000,28000,30000],
 tiers:[
  {min:1,max:4,key:'default',name:'新手'},
  {min:5,max:9,key:'bronze',name:'青铜'},
  {min:10,max:14,key:'silver',name:'白银'},
  {min:15,max:19,key:'gold',name:'黄金'},
  {min:20,max:24,key:'platinum',name:'铂金'},
  {min:25,max:29,key:'diamond',name:'钻石'},
  {min:30,max:30,key:'master',name:'大师'}
 ]
};
export function levelForXp(value){const xp=Math.max(0,Number(value)||0);let level=1;for(let i=1;i<progressionConfig.levelXp.length;i++){if(xp<progressionConfig.levelXp[i])break;level=i+1;}return level;}
export function tierForLevel(level){return progressionConfig.tiers.find(t=>level>=t.min&&level<=t.max)||progressionConfig.tiers[0];}
export function xpForNet(net){return Math.min(progressionConfig.maxXpPerHand,Math.max(0,Math.floor((Number(net)||0)/progressionConfig.pointsPerXp)));}
