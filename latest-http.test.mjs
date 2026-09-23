import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-server.mjs';

const voiceFiles=['check.mp3','call.mp3','raise.mp3','all_in.mp3','fold.mp3','your_turn.mp3','showdown.mp3'];

async function approvedUser(f,adminCookie,username,nickname){
 await f.request('/auth',{op:'register',username,password:f.secret,nickname});
 const users=(await f.request('/admin-api',{op:'status'},adminCookie)).data.users;
 const id=users.find(user=>user.username===username).id;
 await f.request('/admin-api',{op:'statusChange',userId:id,status:'active'},adminCookie);
 const cookie=(await f.request('/auth',{op:'login',username,password:f.secret})).cookie;
 return {id,cookie};
}

test('最新版 HTTP 功能与账号审核并存：卡背、恢复、踢人和令牌隔离',async t=>{
 const f=await fixture();t.after(()=>f.close());
 const adminLogin=await f.request('/auth',{op:'login',username:'test_admin',password:f.secret}),admin=adminLogin.cookie;
 const friend=await approvedUser(f,admin,'skin_friend','皮肤朋友');
 const duplicate=await approvedUser(f,admin,'same_name','皮肤朋友');
 assert.equal((await f.request('/auth',{op:'skin',cardBack:'midnight'},admin)).data.user.card_back,'midnight');
 assert.equal((await f.request('/auth',{op:'skin',cardBack:'ivory'},friend.cookie)).data.user.card_back,'ivory');
 assert.equal((await f.request('/auth',{op:'skin',cardBack:'unknown'},friend.cookie)).status,400);
 const host=(await f.request('/api',{op:'create',deviceId:'host-device',cardBack:'classic'},admin)).data;
 let hostView=(await f.request('/api',{...host,op:'state'},admin)).data;
 const hostPlayer=hostView.players.find(p=>p.id===hostView.me);
 assert.equal(hostPlayer.name,'房主');assert.equal(hostPlayer.cardBack,'midnight');
 assert(hostView.expiresAt-Date.now()>4.9*3600000&&hostView.expiresAt-Date.now()<=5*3600000);
 const member=(await f.request('/api',{op:'join',code:host.code,deviceId:'friend-device',cardBack:'classic'},friend.cookie)).data;
 assert.equal((await f.request('/auth',{op:'skin',cardBack:'ink'},friend.cookie)).data.user.card_back,'ink');
 let memberView=(await f.request('/api',{...member,op:'state'},friend.cookie)).data;
 assert.equal(memberView.players.find(p=>p.id===memberView.me).cardBack,'ink');
 const recovered=(await f.request('/api',{op:'join',code:host.code,deviceId:'changed-device',cardBack:'ivory'},friend.cookie)).data;
 assert.equal(recovered.token,member.token);assert.equal(recovered.recovered,true);
 memberView=(await f.request('/api',{...member,op:'state'},friend.cookie)).data;
 assert.equal(memberView.players.find(p=>p.id===memberView.me).cardBack,'ink');
 assert.equal((await f.request('/api',{op:'join',code:host.code,cardBack:'classic'},duplicate.cookie)).status,400);
 for(let i=0;i<6;i++)assert.equal((await f.request('/api',{...host,op:'bot'},admin)).status,200);
 assert.equal((await f.request('/api',{...host,op:'bot'},admin)).status,400);
 hostView=(await f.request('/api',{...host,op:'state'},admin)).data;
 const bot=hostView.players.find(p=>p.bot),memberId=hostView.players.find(p=>p.id!==hostView.me&&!p.bot).id;
 assert.equal((await f.request('/api',{...member,op:'kick',playerId:bot.id},friend.cookie)).status,403);
 assert.equal((await f.request('/api',{...host,op:'kick',playerId:bot.id},admin)).status,200);
 assert.equal((await f.request('/api',{...member,op:'start'},friend.cookie)).status,403);
 assert.equal((await f.request('/api',{...host,op:'start'},admin)).status,200);
 assert.equal((await f.request('/api',{...host,op:'kick',playerId:memberId},admin)).status,200);
 hostView=(await f.request('/api',{...host,op:'state'},admin)).data;
 assert.equal(hostView.players.find(p=>p.id===memberId).pendingKick,true);
 assert.deepEqual(hostView.players.find(p=>p.id===memberId).cards,[-1,-1]);
 assert.deepEqual((await f.request('/api',{...member,op:'state'},friend.cookie)).data.players.find(p=>p.id===hostView.me).cards,[-1,-1]);
 assert(!JSON.stringify(hostView).includes(host.token));assert(!JSON.stringify(hostView).includes(member.token));
 assert.equal((await f.request('/api',{...host,op:'state'},friend.cookie)).status,400);
 assert.equal((await f.request('/api',{...member,op:'close'},friend.cookie)).status,403);
 assert.equal((await f.request('/api',{...host,op:'close'},admin)).status,200);
});

test('七个录制音效均可由浏览器加载',async t=>{
 const f=await fixture();t.after(()=>f.close());
 for(const file of voiceFiles){
  const response=await fetch(`${f.base}/audio/voice/${file}`),bytes=await response.arrayBuffer();
  assert.equal(response.status,200,file);assert.equal(response.headers.get('content-type'),'audio/mpeg',file);assert(bytes.byteLength>9000,file);
 }
 assert.equal((await fetch(`${f.base}/audio/voice/not-found.mp3`)).status,404);
});
