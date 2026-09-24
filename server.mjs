import {community} from './community.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {randomInt,randomUUID} from 'node:crypto';
import {accounts,fail} from './accounts.mjs';
import {room,player,start,act,view,legal,botDecision,log,cleanCardBack,cardBacks} from './engine.mjs';

const rooms=new Map(),limits=new Map(),identity=await accounts();
const social=community(identity.db,identity);
const port=Number(process.env.PORT||8787),root=new URL('./',import.meta.url),MAX_PLAYERS=8,ROOM_MAX_MS=5*60*60*1000;
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const readBody=async(req,limit=4096)=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>limit)fail(413,'请求过大');}return raw;};
const cleanDevice=value=>String(value||'').trim().slice(0,80);
const clientKey=req=>String(req.socket.remoteAddress||'unknown');
function allowed(key,max,windowMs){const now=Date.now(),recent=(limits.get(key)||[]).filter(t=>now-t<windowMs);recent.push(now);limits.set(key,recent);return recent.length<=max;}
function removePlayer(r,target){const dealer=r.players[r.dealer],oldIndex=r.players.indexOf(target);r.players=r.players.filter(p=>p!==target);if(dealer&&dealer!==target)r.dealer=r.players.indexOf(dealer);else r.dealer=r.players.length?((oldIndex-1+r.players.length)%r.players.length):-1;}
function roomSession(user){for(const table of rooms.values()){const seated=table.players.find(p=>p.userId===user.id);if(seated){seated.name=user.nickname;seated.cardBack=cleanCardBack(user.card_back);return {code:table.code,token:seated.token};}}return null;}

const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(['/api','/auth','/admin-api','/community-api'].includes(url.pathname)){
  if(req.method!=='POST')return send(res,405,{error:'请使用 POST'});
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(res,415,{error:'请使用 JSON'});
  const expected=process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
  if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==expected))return send(res,403,{error:'来源不允许'});
  identity.rate('api:'+clientKey(req),600,60000);
  const b=JSON.parse(await readBody(req)||'{}');if(!b||Array.isArray(b)||typeof b!=='object')fail(400,'请求格式不正确');
  if(url.pathname==='/auth'){
   if(b.op==='profile'){
    const account=identity.requireUser(req,false),name=String(b.nickname||'').trim();
    const table=[...rooms.values()].find(r=>r.players.some(p=>p.userId===account.id));
    if(table?.players.some(p=>p.userId!==account.id&&p.name.toLocaleLowerCase('zh-CN')===name.toLocaleLowerCase('zh-CN')))fail(400,'该昵称已在当前房间使用');
   }
   const result=await identity.auth(req,res,b);
   if(result.user?.status==='active'){result.roomSession=roomSession(result.user);}
   return send(res,200,result);
  }
  if(url.pathname==='/community-api')return send(res,200,social.handle(req,b,rooms));
  if(url.pathname==='/admin-api'&&['feedbackList','feedbackUpdate'].includes(b.op))return send(res,200,social.admin(req,b));
  if(url.pathname==='/admin-api')return send(res,200,identity.admin(req,b,rooms));

  const account=identity.requireUser(req);let r=rooms.get(String(b.code));
  if(b.op==='create'){
   if([...rooms.values()].some(table=>table.players.some(p=>p.userId===account.id)))fail(400,'你已在房间中，请先恢复或离开原房间');
   if(!allowed(`create:${account.id}`,5,10*60*1000))fail(429,'创建房间过于频繁，请稍后再试');if(rooms.size>=100)fail(400,'房间已满，请稍后再试');
   let code;do{code=String(randomInt(100000,1000000));}while(rooms.has(code));
   const p=player(account.nickname,false,cleanDevice(b.deviceId),account.card_back);p.token=randomUUID();p.userId=account.id;
   r=room(code,p);r.expiresAt=Date.now()+ROOM_MAX_MS;rooms.set(code,r);identity.audit(account.id,'createRoom',code);
   return send(res,200,{code,token:p.token,name:p.name,recovered:false});
  }
  if(!r){if(b.op==='join'&&!allowed(`badjoin:${account.id}`,20,10*60*1000))fail(429,'尝试次数过多，请稍后再试');fail(400,'房间不存在，或服务器已重启');}
  if(Date.now()>=r.expiresAt){rooms.delete(r.code);fail(400,'房间已达到 5 小时上限并自动关闭');}r.updated=Date.now();
  if(b.op==='join'){
   const existing=r.players.find(p=>!p.bot&&p.userId===account.id);
   if(existing){existing.lastSeen=Date.now();existing.name=account.nickname;existing.cardBack=cleanCardBack(account.card_back);return send(res,200,{code:r.code,token:existing.token,name:existing.name,recovered:true});}
   if([...rooms.values()].some(table=>table.players.some(p=>p.userId===account.id)))fail(400,'你已在其他房间中，请先离开');
   if(r.players.length>=MAX_PLAYERS)fail(400,'房间已满，无法加入房间');
   if(r.players.some(p=>p.name.toLocaleLowerCase('zh-CN')===account.nickname.toLocaleLowerCase('zh-CN')))fail(400,'该昵称已在本房间使用，请在账号设置中修改');
   const spectating=!['waiting','done'].includes(r.phase),p=player(account.nickname,false,cleanDevice(b.deviceId),account.card_back);p.token=randomUUID();p.userId=account.id;if(spectating)p.action='观战中，下手入座';r.players.push(p);identity.audit(account.id,'joinRoom',r.code);
   return send(res,200,{code:r.code,token:p.token,name:p.name,recovered:false,spectating});
  }
  const p=r.players.find(p=>p.token===b.token&&p.userId===account.id&&!p.bot);if(!p)fail(400,'身份已失效，请重新加入');p.lastSeen=Date.now();p.name=account.nickname;p.cardBack=cleanCardBack(account.card_back);
  if(['start','bot','removeBot','kick','reset','close'].includes(b.op)&&p.id!==r.host)fail(403,'只有房主可以操作');
  if(b.op==='start'){start(r);identity.audit(account.id,'startHand',r.code+':'+r.hand);}
  else if(b.op==='bot'){if(!['waiting','done'].includes(r.phase)||r.players.length>=MAX_PLAYERS)fail(400,'当前不能添加陪练');const botCount=r.players.filter(p=>p.bot).length;r.players.push(player(`陪练 ${botCount+1}`,true,'',cardBacks[(botCount+1)%cardBacks.length]));}
  else if(b.op==='removeBot'){if(!['waiting','done'].includes(r.phase))fail(400,'请在本手结束后移除陪练');const bot=r.players.find(q=>q.id===String(b.playerId)&&q.bot);if(!bot)fail(404,'陪练不存在');removePlayer(r,bot);}
  else if(b.op==='kick'){const target=r.players.find(q=>q.id===String(b.playerId));if(!target)fail(404,'玩家不存在');if(target.id===r.host)fail(400,'房主不能移出自己');if(['waiting','done'].includes(r.phase)){removePlayer(r,target);log(r,`${target.name} 已被房主移出房间`);}else target.pendingKick=true;}
  else if(b.op==='close'){rooms.delete(r.code);identity.audit(account.id,'closeRoom',r.code);return send(res,200,{closed:true});}
  else if(b.op==='reset'){if(!['waiting','done'].includes(r.phase))fail(400,'请先完成本手牌');r.players.forEach(p=>p.stack=2000);r.phase='waiting';r.board=[];r.result=[];r.settlement=[];r.lastSettlement=null;r.players.forEach(p=>{p.cards=[];p.total=0;p.bet=0;p.action='等待开始';});}
  else if(b.op==='act')act(r,p.id,b.type,b.amount);
  else if(b.op==='leave'){if(!['waiting','done'].includes(r.phase)&&p.inHand)fail(400,'请在本手结束后离开；关闭页面会自动超时行动');removePlayer(r,p);if(p.id===r.host)r.host=r.players.find(q=>!q.bot)?.id;if(!r.host)rooms.delete(r.code);identity.audit(account.id,'leaveRoom',r.code);return send(res,200,{left:true});}
  else if(b.op!=='state')fail(400,'无效请求');return send(res,200,view(r,p.id));
 }
 const names={'/':'index.html','/voice-manager.js':'voice-manager.js','/community-ui.js':'community-ui.js','/app.js':'app.js','/account-ui.js':'account-ui.js','/style.css':'style.css','/audio/voice/check.mp3':'assets/audio/voice/check.mp3','/audio/voice/call.mp3':'assets/audio/voice/call.mp3','/audio/voice/raise.mp3':'assets/audio/voice/raise.mp3','/audio/voice/all_in.mp3':'assets/audio/voice/all_in.mp3','/audio/voice/fold.mp3':'assets/audio/voice/fold.mp3','/audio/voice/your_turn.mp3':'assets/audio/voice/your_turn.mp3','/audio/voice/showdown.mp3':'assets/audio/voice/showdown.mp3'};if(!names[url.pathname]){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.mp3')?'audio/mpeg':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':url.pathname.endsWith('.mp3')?'public, max-age=86400':'no-cache'});res.end(await readFile(new URL(names[url.pathname],root)));
 }catch(e){send(res,e.status||400,{error:e.message||'请求失败'});}});

setInterval(()=>{if(limits.size>5000)limits.clear();for(const [code,r] of rooms){if(Date.now()>=r.expiresAt){rooms.delete(code);continue;}if(['waiting','done'].includes(r.phase))continue;const p=r.players[r.turn];if(!p)continue;if(p.bot&&Date.now()>r.deadline-43500){const move=botDecision(r,p);act(r,p.id,move.type,move.amount);}else if(Date.now()>r.deadline)act(r,p.id,legal(r,p).call?'fold':'call');}},500).unref();
server.listen(port,process.env.HOST||'127.0.0.1',()=>{console.log(`Local: http://localhost:${server.address().port}`);if(process.env.HOST==='0.0.0.0')for(const list of Object.values(networkInterfaces()))for(const n of list||[])if(n.family==='IPv4'&&!n.internal)console.log(`LAN: http://${n.address}:${server.address().port}`);});
