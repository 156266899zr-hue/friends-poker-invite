import {randomInt,randomUUID} from 'node:crypto';
import {levelForXp,tierForLevel,progressionConfig} from './progression.js';
export const labels=['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'];
export function score(cards){
 let best=[]; const cmp=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]??0)!==(b[i]??0))return (a[i]??0)-(b[i]??0);}return 0;};
 for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
 const hand=[a,b,c,d,e].map(i=>cards[i]),r=hand.map(c=>c%13+2).sort((a,b)=>b-a),counts={};r.forEach(v=>counts[v]=(counts[v]||0)+1);
 const g=Object.entries(counts).map(([v,n])=>[n,+v]).sort((a,b)=>b[0]-a[0]||b[1]-a[1]);
 const flush=hand.every(c=>Math.floor(c/13)===Math.floor(hand[0]/13));const u=[...new Set(r)];const straight=u.length===5?(u[0]-u[4]===4?u[0]:u.join(',')==='14,5,4,3,2'?5:0):0;
 const s=flush&&straight?[8,straight]:g[0][0]===4?[7,g[0][1],g[1][1]]:g[0][0]===3&&g[1][0]===2?[6,g[0][1],g[1][1]]:flush?[5,...r]:straight?[4,straight]:g[0][0]===3?[3,...g.map(x=>x[1])]:g[0][0]===2&&g[1][0]===2?[2,...g.map(x=>x[1])]:g[0][0]===2?[1,...g.map(x=>x[1])]:[0,...r];if(cmp(s,best)>0)best=s;
 }return best;
}
export function compare(a,b){for(let i=0;i<5+1;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)-(b[i]||0);return 0;}
export const cardBacks=['classic','ivory','midnight','ink'];
export function cleanCardBack(value){return cardBacks.includes(value)?value:'classic';}
export function player(name,bot=false,deviceId='',cardBack='classic'){return {id:randomUUID(),name,bot,deviceId,cardBack:cleanCardBack(cardBack),xp:0,stack:2000,issued:2000,rebirthCount:0,rebirthAt:0,cards:[],bet:0,total:0,folded:false,inHand:false,lastSeen:Date.now(),pendingKick:false};}
export function room(code,host){return {code,host:host.id,players:[host],phase:'waiting',board:[],hand:0,dealer:-1,turn:-1,high:0,minRaise:20,pending:[],logs:[],result:[],updated:Date.now()};}
export function log(r,t){r.logs.unshift(t);r.logs=r.logs.slice(0,200);r.history??=[];r.eventSequence=(r.eventSequence||0)+1;r.history.push({eventId:randomUUID(),sequence:r.eventSequence,hand:r.hand,phase:r.phase,text:t,time:Date.now()});r.history=r.history.filter(e=>e.hand>=r.hand-29);}
const next=(r,from,fn)=>{for(let n=1;n<=r.players.length;n++){let i=(from+n)%r.players.length;if(fn(r.players[i]))return i;}return -1;};
const active=p=>p.inHand&&!p.folded;
const can=p=>active(p)&&p.stack>0;
function pay(p,n){n=Math.min(n,p.stack);p.stack-=n;p.bet+=n;p.total+=n;return n;}
export function start(r){
 if(!['waiting','done'].includes(r.phase))throw Error('本手牌尚未结束');if(r.players.filter(p=>p.stack>=progressionConfig.rebirthMinimumStack).length<2)throw Error('至少需要两位积分达到继续游戏门槛的玩家');
 r.hand++;r.board=[];r.result=[];r.deck=Array.from({length:52},(_,i)=>i);for(let i=51;i>0;i--){const j=randomInt(i+1);[r.deck[i],r.deck[j]]=[r.deck[j],r.deck[i]];}
 for(const p of r.players){p.inHand=p.stack>=progressionConfig.rebirthMinimumStack;p.folded=false;p.bet=0;p.total=0;p.lastHigh=null;p.cards=p.inHand?[r.deck.pop(),r.deck.pop()]:[];p.action=p.inHand?'等待行动':'可补分重生';}
 r.dealer=next(r,r.dealer,p=>p.inHand);const heads=r.players.filter(p=>p.inHand).length===2;const sb=heads?r.dealer:next(r,r.dealer,p=>p.inHand),bb=next(r,sb,p=>p.inHand);
 const small=pay(r.players[sb],10),big=pay(r.players[bb],20);r.players[sb].action=`小盲 ${small}`;r.players[bb].action=`大盲 ${big}`;r.high=20;r.minRaise=20;r.phase='preflop';r.pending=r.players.filter(can).map(p=>p.id);log(r,`第 ${r.hand} 手开始 · 庄家 ${r.players[r.dealer].name}`);log(r,`${r.players[sb].name}：小盲 ${small}`);log(r,`${r.players[bb].name}：大盲 ${big}`);advance(r,bb);
}
function settle(r){
 const live=r.players.filter(active);const scores=new Map(live.map(p=>[p.id,score([...p.cards,...r.board])]));const levels=[...new Set(r.players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);let previous=0;const awards=new Map();
 for(const level of levels){const contributors=r.players.filter(p=>p.total>=level);const amount=(level-previous)*contributors.length;previous=level;let eligible=contributors.filter(active);if(!eligible.length)eligible=live;
 let winners=eligible.filter(p=>eligible.every(q=>compare(scores.get(p.id),scores.get(q.id))>=0));winners.sort((a,b)=>((r.players.indexOf(a)-r.dealer-1+r.players.length)%r.players.length)-((r.players.indexOf(b)-r.dealer-1+r.players.length)%r.players.length));
 winners.forEach((p,i)=>awards.set(p.id,(awards.get(p.id)||0)+Math.floor(amount/winners.length)+(i<amount%winners.length?1:0)));
 }
 r.result=[...awards].map(([id,amount])=>{const p=r.players.find(p=>p.id===id);p.stack+=amount;return {id:p.id,name:p.name,amount,label:live.length===1?'其他玩家弃牌':labels[scores.get(id)[0]]};});
 const showdown=live.length>1;
 r.settlement=r.players.filter(p=>p.inHand).map(p=>({id:p.id,name:p.name,invested:p.total,received:awards.get(p.id)||0,net:(awards.get(p.id)||0)-p.total,label:p.folded?'已弃牌':live.length===1?'其他玩家弃牌':labels[scores.get(p.id)[0]],cards:showdown&&!p.folded?[...p.cards]:[],winner:(awards.get(p.id)||0)>0}));r.lastSettlement={hand:r.hand,board:[...r.board],showdown,rows:r.settlement};r.phase='done';for(const x of r.settlement)log(r,`${x.name}：投入 ${x.invested} / 收回 ${x.received} / 净${x.net>0?'赢':x.net<0?'输':'变动'} ${Math.abs(x.net)}`);log(r,r.result.map(x=>`${x.name} 获得 ${x.amount}（${x.label}）`).join(' · '));r.phase='done';r.turn=-1;r.reveal=showdown;r.pending=[];
 const kicked=r.players.filter(p=>p.pendingKick),dealer=r.players[r.dealer],oldDealer=r.dealer;for(const p of kicked)log(r,`${p.name} 已被房主移出房间`);if(kicked.length){r.players=r.players.filter(p=>!p.pendingKick);r.dealer=dealer&&r.players.includes(dealer)?r.players.indexOf(dealer):r.players.length?((oldDealer-1+r.players.length)%r.players.length):-1;}
}
function street(r){
 if(r.phase==='river'){settle(r);return;}
 r.deck.pop();if(r.phase==='preflop'){r.phase='flop';r.board.push(r.deck.pop(),r.deck.pop(),r.deck.pop());}else{r.phase=r.phase==='flop'?'turn':'river';r.board.push(r.deck.pop());}
 log(r,`公共牌：${r.board.map(c=>['♠','♥','♦','♣'][Math.floor(c/13)]+({11:'J',12:'Q',13:'K',14:'A'}[c%13+2]||c%13+2)).join(' ')}`);for(const p of r.players){p.bet=0;p.lastHigh=null;p.action=p.folded?'已弃牌':p.inHand?(p.stack===0?'已全下':'等待行动'):'观战中，下手入座';}r.high=0;r.minRaise=20;r.pending=r.players.filter(can).map(p=>p.id);advance(r,r.dealer);
}
function advance(r,from){
 if(r.players.filter(active).length===1){settle(r);return;}
 r.pending=r.pending.filter(id=>r.players.some(p=>p.id===id&&can(p)));
 const able=r.players.filter(can);if(able.length<=1&&able.every(p=>p.bet>=r.high))r.pending=[];
 if(!r.pending.length){const unmatched=r.players.filter(p=>can(p)&&p.bet<r.high);if(unmatched.length)r.pending=unmatched.map(p=>p.id);else {street(r);return;}}
 r.turn=next(r,from,p=>r.pending.includes(p.id));r.deadline=Date.now()+45000;
}
export function legal(r,p){const call=Math.min(p.stack,Math.max(0,r.high-p.bet));return {call,min:Math.min(p.bet+p.stack,r.high+r.minRaise),max:p.bet+p.stack,raise:(p.lastHigh===null||r.high-p.lastHigh>=r.minRaise)&&p.bet+p.stack>r.high&&r.players.some(q=>q!==p&&can(q))};}
export function botStrength(r,p){
 const cards=p.cards||[];if(cards.length<2)return 0;
 if(!r.board.length){const ranks=cards.map(c=>c%13+2).sort((a,b)=>b-a),[high,low]=ranks,suited=Math.floor(cards[0]/13)===Math.floor(cards[1]/13),gap=high-low;let value;
  if(high===low)value=.52+(high-2)/12*.43;else{value=(high+low-4)/24*.45;if(high>=11)value+=.18;if(low>=10)value+=.1;if(suited)value+=.07;if(gap<=1)value+=.06;else if(gap>=5)value-=.06;}return Math.max(.05,Math.min(.98,value));}
 const hand=score([...cards,...r.board]),base=[.18,.42,.62,.7,.78,.82,.9,.97,1][hand[0]]??.18;return Math.min(1,base+(hand[1]||0)/300);
}
export function botDecision(r,p,roll=randomInt(100)){
 const l=legal(r,p),strength=botStrength(r,p),pot=Math.max(1,r.players.reduce((n,q)=>n+q.total,0)),potPrice=l.call/pot;
 if(l.call&&strength<.28&&(l.call>20||potPrice>.18))return {type:'fold'};
 if(l.call&&strength<.43&&(l.call>p.stack*.15||potPrice>.45))return {type:'fold'};
 const wantsRaise=l.raise&&((strength>.78&&roll<70)||(strength>.62&&roll<25)||(l.call===0&&strength>.52&&roll<18));
 if(wantsRaise){const shove=strength>.94&&(p.stack<=pot*2||roll<8),size=Math.max(r.minRaise,Math.round(Math.max(40,pot*.5)/10)*10),amount=shove?l.max:Math.min(l.max,Math.max(l.min,r.high+size));return {type:'raise',amount};}
 return {type:'call'};
}
export function act(r,id,type,amount){
 const p=r.players[r.turn];if(!p||p.id!==id||['done','waiting'].includes(r.phase))throw Error('还没有轮到你');const l=legal(r,p);
 if(type==='fold'){p.folded=true;p.action='弃牌';}
 else if(type==='call'){pay(p,l.call);p.action=l.call?`${p.stack===0?'全下跟注':'补入'} ${l.call}（本轮共 ${p.bet}）`:'过牌';p.lastHigh=r.high;}
 else if(type==='raise'){
 if(!l.raise||!Number.isInteger(amount)||amount<l.min||amount>l.max)throw Error('加注额度不合法');const delta=amount-r.high;pay(p,amount-p.bet);if(delta>=r.minRaise)r.minRaise=delta;r.high=amount;p.lastHigh=r.high;p.action=p.stack===0?`全下 ${amount}`:`加注至 ${amount}`;
 r.pending=[...new Set([...r.pending,...r.players.filter(q=>q!==p&&can(q)&&q.bet<r.high).map(q=>q.id)])];
 }else throw Error('无效操作');
 log(r,`${p.name}：${p.action}`);r.pending=r.pending.filter(x=>x!==id);advance(r,r.turn);
}
export function rebirth(r,id,now=Date.now()){if(!['waiting','done'].includes(r.phase))throw Error('请在本手结束后补分重生');const p=r.players.find(p=>p.id===id&&!p.bot);if(!p)throw Error('玩家不存在');if(p.stack>=progressionConfig.rebirthMinimumStack)throw Error('当前积分仍可继续游戏');const amount=progressionConfig.rebirthTargetStack-p.stack;p.stack=progressionConfig.rebirthTargetStack;p.issued=(p.issued||2000)+amount;p.rebirthCount=(p.rebirthCount||0)+1;p.rebirthAt=now;p.action='补分重生成功，等待开始';log(r,`${p.name} 主动补分重生至 ${progressionConfig.rebirthTargetStack.toLocaleString('zh-CN')} 积分 · 累计战绩 ${(p.stack-p.issued).toLocaleString('zh-CN')}`);return p;}
export function view(r,id){const p=r.players.find(p=>p.id===id),now=Date.now(),playing=!['waiting','done'].includes(r.phase);return {code:r.code,host:r.host,phase:r.phase,hand:r.hand,board:r.board,dealer:r.dealer,turn:r.turn,deadline:r.deadline,expiresAt:r.expiresAt||0,high:r.high,pot:r.players.reduce((s,p)=>s+p.total,0),result:r.result,settlement:r.phase==='done'?r.settlement||[]:[],lastSettlement:r.lastSettlement||null,history:r.history||[],me:id,legal:p?legal(r,p):null,players:r.players.map(p=>{const level=levelForXp(p.xp||0),tier=tierForLevel(level);return {id:p.id,name:p.name,bot:p.bot,cardBack:cleanCardBack(p.cardBack),xp:p.xp||0,level,levelTier:tier.key,levelTierName:tier.name,online:p.bot||now-p.lastSeen<5000,pendingKick:!!p.pendingKick,rebirthCount:p.rebirthCount||0,rebirthAt:p.rebirthAt||0,canRebirth:!p.bot&&p.stack<progressionConfig.rebirthMinimumStack&&['waiting','done'].includes(r.phase),record:p.stack-(p.issued||2000),spectating:playing&&!p.inHand,stack:p.stack,bet:p.bet,total:p.total,inHand:p.inHand,folded:p.folded,action:p.action,cards:p.id===id||(r.phase==='done'&&r.reveal&&active(p))?p.cards:p.cards.map(()=>-1)};} )};}
