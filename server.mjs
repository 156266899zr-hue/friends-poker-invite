import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {randomInt} from 'node:crypto';
import {room,player,start,act,view,legal,botDecision,log} from './engine.mjs';
const rooms=new Map(),limits=new Map(),port=Number(process.env.PORT||8787);const root=new URL('./',import.meta.url);const MAX_PLAYERS=8,ROOM_MAX_MS=5*60*60*1000;
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const readBody=async(req,limit=4096)=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>limit)throw Error('请求过大');}return raw;};
const cleanName=value=>String(value||'朋友').trim().replace(/\s+/g,' ').slice(0,12)||'朋友';
const nameKey=value=>cleanName(value).toLocaleLowerCase('zh-CN');
const cleanDevice=value=>String(value||'').trim().slice(0,80);
const clientKey=req=>String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
function allowed(key,max,windowMs){const now=Date.now(),recent=(limits.get(key)||[]).filter(t=>now-t<windowMs);recent.push(now);limits.set(key,recent);return recent.length<=max;}
function removePlayer(r,target){const dealer=r.players[r.dealer],oldIndex=r.players.indexOf(target);r.players=r.players.filter(p=>p!==target);if(dealer&&dealer!==target)r.dealer=r.players.indexOf(dealer);else r.dealer=r.players.length?((oldIndex-1+r.players.length)%r.players.length):-1;}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api'){
 if(req.method!=='POST')return send(res,405,{error:'请使用 POST'});
 if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'来源不允许'});
 const raw=await readBody(req);const b=JSON.parse(raw||'{}');let r=rooms.get(String(b.code));
 if(b.op==='create'){if(!allowed(`create:${clientKey(req)}`,5,10*60*1000))throw Error('创建房间过于频繁，请稍后再试');if(rooms.size>=100)throw Error('房间已满，请稍后再试');let code;do{code=String(randomInt(100000,1000000));}while(rooms.has(code));const p=player(cleanName(b.name),false,cleanDevice(b.deviceId));r=room(code,p);r.expiresAt=Date.now()+ROOM_MAX_MS;rooms.set(code,r);return send(res,200,{code,token:p.id,name:p.name,recovered:false});}
 if(!r){if(b.op==='join'&&!allowed(`badjoin:${clientKey(req)}`,20,10*60*1000))throw Error('尝试次数过多，请稍后再试');throw Error('房间不存在，或服务器已重启');}if(Date.now()>=r.expiresAt){rooms.delete(r.code);throw Error('房间已达到 5 小时上限并自动关闭');}r.updated=Date.now();
 if(b.op==='join'){const deviceId=cleanDevice(b.deviceId),existing=deviceId&&r.players.find(p=>!p.bot&&p.deviceId===deviceId);if(existing){existing.lastSeen=Date.now();return send(res,200,{code:r.code,token:existing.id,name:existing.name,recovered:true});}if(!['waiting','done'].includes(r.phase))throw Error('对局进行中，请等本手结束再加入');if(r.players.length>=MAX_PLAYERS)throw Error('房间已满（最多 8 人）');const name=cleanName(b.name);if(r.players.some(p=>nameKey(p.name)===nameKey(name)))throw Error('该昵称已在本房间使用，请换一个称呼');const p=player(name,false,deviceId);r.players.push(p);return send(res,200,{code:r.code,token:p.id,name:p.name,recovered:false});}
 const p=r.players.find(p=>p.id===b.token&&!p.bot);if(!p)throw Error('身份已失效，请重新加入');p.lastSeen=Date.now();
 if(['start','bot','removeBot','kick','reset','close'].includes(b.op)&&p.id!==r.host)throw Error('只有房主可以操作');
 if(b.op==='start')start(r);
 else if(b.op==='bot'){if(!['waiting','done'].includes(r.phase)||r.players.length>=MAX_PLAYERS)throw Error('当前不能添加陪练');r.players.push(player(`陪练 ${r.players.filter(p=>p.bot).length+1}`,true));}
 else if(b.op==='removeBot'){if(!['waiting','done'].includes(r.phase))throw Error('请在本手结束后移除陪练');const bot=r.players.find(q=>q.id===String(b.playerId)&&q.bot);if(!bot)throw Error('陪练不存在');removePlayer(r,bot);}
 else if(b.op==='kick'){const target=r.players.find(q=>q.id===String(b.playerId));if(!target)throw Error('玩家不存在');if(target.id===r.host)throw Error('房主不能移出自己');if(['waiting','done'].includes(r.phase)){removePlayer(r,target);log(r,`${target.name} 已被房主移出房间`);}else target.pendingKick=true;}
 else if(b.op==='close'){rooms.delete(r.code);return send(res,200,{closed:true});}
 else if(b.op==='reset'){if(!['waiting','done'].includes(r.phase))throw Error('请先完成本手牌');r.players.forEach(p=>p.stack=2000);r.phase='waiting';r.board=[];r.result=[];r.settlement=[];r.lastSettlement=null;r.players.forEach(p=>{p.cards=[];p.total=0;p.bet=0;p.action='等待开始';});}
 else if(b.op==='act')act(r,p.id,b.type,b.amount);
 else if(b.op==='leave'){if(!['waiting','done'].includes(r.phase))throw Error('请在本手结束后离开；关闭页面会自动超时行动');removePlayer(r,p);if(p.id===r.host)r.host=r.players.find(q=>!q.bot)?.id;if(!r.host)rooms.delete(r.code);return send(res,200,{left:true});}
 else if(b.op!=='state')throw Error('无效请求');return send(res,200,view(r,p.id));
 }
 const names={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!names[url.pathname]){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-cache'});res.end(await readFile(new URL(names[url.pathname],root)));
 }catch(e){send(res,400,{error:e.message||'请求失败'});}});
setInterval(()=>{if(limits.size>5000)limits.clear();for(const [code,r] of rooms){if(Date.now()>=r.expiresAt){rooms.delete(code);continue;}if(['waiting','done'].includes(r.phase))continue;const p=r.players[r.turn];if(!p)continue;if(p.bot&&Date.now()>r.deadline-43500){const move=botDecision(r,p);act(r,p.id,move.type,move.amount);}else if(Date.now()>r.deadline)act(r,p.id,legal(r,p).call?'fold':'call');}},500).unref();
server.listen(port,'0.0.0.0',()=>{console.log(`Local: http://localhost:${port}`);for(const list of Object.values(networkInterfaces()))for(const n of list||[])if(n.family==='IPv4'&&!n.internal)console.log(`LAN: http://${n.address}:${port}`);});
