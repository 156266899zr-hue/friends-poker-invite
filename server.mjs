import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {createHash,randomInt,timingSafeEqual} from 'node:crypto';
import {room,player,start,act,view,legal,botDecision} from './engine.mjs';
const rooms=new Map(),port=Number(process.env.PORT||8787);const root=new URL('./',import.meta.url);const MAX_PLAYERS=8,ROOM_MAX_MS=5*60*60*1000;
const invite=String(process.env.INVITE_CODE||'').trim();
const inviteToken=invite?createHash('sha256').update(invite).digest('hex'):'';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const readBody=async(req,limit=4096)=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>limit)throw Error('请求过大');}return raw;};
const hasAccess=req=>!invite||String(req.headers.cookie||'').split(';').some(v=>v.trim()===`poker_invite=${inviteToken}`);
const accessPage=(res,bad=false)=>{res.writeHead(bad?401:200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"});res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>同桌 · 邀请测试</title><style>body{margin:0;background:#10251d;color:#f7efda;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.box{width:min(360px,84vw);padding:32px;background:#17372b;border:1px solid #50705f;border-radius:18px;box-shadow:0 20px 60px #0008}h1{margin-top:0}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:9px;font:inherit}input{border:1px solid #769080;background:#0d211a;color:white}button{margin-top:12px;border:0;background:#d4aa55;color:#20180b;font-weight:700;cursor:pointer}.bad{color:#ffb4a8}</style><div class="box"><h1>同桌 · 德州扑克</h1><p>这是邀请制测试，请输入邀请码。</p>${bad?'<p class="bad">邀请码不正确，请重试。</p>':''}<form method="post" action="/access"><input name="code" type="password" autocomplete="current-password" required autofocus placeholder="邀请码"><button>进入测试</button></form></div></html>`);};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(invite&&url.pathname==='/access'&&req.method==='POST'){const form=new URLSearchParams(await readBody(req,1024));const code=String(form.get('code')||'');const a=Buffer.from(code),b=Buffer.from(invite);if(a.length===b.length&&timingSafeEqual(a,b)){res.writeHead(303,{'Location':'/','Set-Cookie':`poker_invite=${inviteToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.RENDER?'; Secure':''}`});return res.end();}return accessPage(res,true);}
 if(!hasAccess(req)){if(req.method==='GET'&&url.pathname==='/')return accessPage(res);return send(res,403,{error:'需要邀请码'});}
 if(url.pathname==='/api'){
 if(req.method!=='POST')return send(res,405,{error:'请使用 POST'});
 if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'来源不允许'});
 const raw=await readBody(req);const b=JSON.parse(raw||'{}');let r=rooms.get(String(b.code));
 if(b.op==='create'){if(rooms.size>=100)throw Error('房间已满，请稍后再试');let code;do{code=String(randomInt(100000,1000000));}while(rooms.has(code));const p=player(String(b.name||'朋友').trim().slice(0,12)||'朋友');r=room(code,p);r.expiresAt=Date.now()+ROOM_MAX_MS;rooms.set(code,r);return send(res,200,{code,token:p.id});}
 if(!r)throw Error('房间不存在，或服务器已重启');if(Date.now()>=r.expiresAt){rooms.delete(r.code);throw Error('房间已达到 5 小时上限并自动关闭');}r.updated=Date.now();
 if(b.op==='join'){if(!['waiting','done'].includes(r.phase))throw Error('对局进行中，请等本手结束再加入');if(r.players.length>=MAX_PLAYERS)throw Error('房间已满（最多 8 人）');const p=player(String(b.name||'朋友').trim().slice(0,12)||'朋友');r.players.push(p);return send(res,200,{code:r.code,token:p.id});}
 const p=r.players.find(p=>p.id===b.token&&!p.bot);if(!p)throw Error('身份已失效，请重新加入');p.lastSeen=Date.now();
 if(['start','bot','removeBot','reset','close'].includes(b.op)&&p.id!==r.host)throw Error('只有房主可以操作');
 if(b.op==='start')start(r);
 else if(b.op==='bot'){if(!['waiting','done'].includes(r.phase)||r.players.length>=MAX_PLAYERS)throw Error('当前不能添加陪练');r.players.push(player(`陪练 ${r.players.filter(p=>p.bot).length+1}`,true));}
 else if(b.op==='removeBot'){if(!['waiting','done'].includes(r.phase))throw Error('请在本手结束后移除陪练');const bot=r.players.find(q=>q.id===String(b.playerId)&&q.bot);if(!bot)throw Error('陪练不存在');r.players=r.players.filter(q=>q!==bot);}
 else if(b.op==='close'){rooms.delete(r.code);return send(res,200,{closed:true});}
 else if(b.op==='reset'){if(!['waiting','done'].includes(r.phase))throw Error('请先完成本手牌');r.players.forEach(p=>p.stack=2000);r.phase='waiting';r.board=[];r.result=[];r.settlement=[];r.lastSettlement=null;r.players.forEach(p=>{p.cards=[];p.total=0;p.bet=0;p.action='等待开始';});}
 else if(b.op==='act')act(r,p.id,b.type,b.amount);
 else if(b.op==='leave'){if(!['waiting','done'].includes(r.phase))throw Error('请在本手结束后离开；关闭页面会自动超时行动');r.players=r.players.filter(q=>q!==p);if(p.id===r.host)r.host=r.players.find(q=>!q.bot)?.id;if(!r.host)rooms.delete(r.code);return send(res,200,{left:true});}
 else if(b.op!=='state')throw Error('无效请求');return send(res,200,view(r,p.id));
 }
 const names={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!names[url.pathname]){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-cache'});res.end(await readFile(new URL(names[url.pathname],root)));
 }catch(e){send(res,400,{error:e.message||'请求失败'});}});
setInterval(()=>{for(const [code,r] of rooms){if(Date.now()>=r.expiresAt){rooms.delete(code);continue;}if(['waiting','done'].includes(r.phase))continue;const p=r.players[r.turn];if(!p)continue;if(p.bot&&Date.now()>r.deadline-43500){const move=botDecision(r,p);act(r,p.id,move.type,move.amount);}else if(Date.now()>r.deadline)act(r,p.id,legal(r,p).call?'fold':'call');}},500).unref();
server.listen(port,'0.0.0.0',()=>{console.log(`Local: http://localhost:${port}`);for(const list of Object.values(networkInterfaces()))for(const n of list||[])if(n.family==='IPv4'&&!n.internal)console.log(`LAN: http://${n.address}:${port}`);});
