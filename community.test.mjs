import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-server.mjs';
import {VoiceManager} from './voice-manager.js';
test('好友权限、邀请、反馈持久化',async t=>{
 const f=await fixture();t.after(()=>f.close());const admin=(await f.request('/auth',{op:'login',username:'test_admin',password:f.secret})).cookie;
 await f.request('/auth',{op:'register',username:'friend1',nickname:'朋友',password:f.secret});
 const users=(await f.request('/admin-api',{op:'status'},admin)).data.users,friend=users.find(u=>u.username==='friend1'),host=users.find(u=>u.role==='admin');
 await f.request('/admin-api',{op:'statusChange',userId:friend.id,status:'active'},admin);
 const cookie=(await f.request('/auth',{op:'login',username:'friend1',password:f.secret})).cookie;
 const call=(op,data={},c=cookie)=>f.request('/community-api',{op,...data},c);
 assert.equal((await call('list',{},'')).status,401);assert.equal((await call('request',{targetId:friend.id})).status,400);
 assert.equal((await call('request',{targetId:host.id,userId:host.id})).status,200);assert.equal((await call('request',{targetId:host.id})).status,409);
 const relation=(await call('list',{},admin)).data.friends[0];assert.equal((await call('respond',{id:relation.relationId,status:'accepted'})).status,404);
 assert.equal((await call('respond',{id:relation.relationId,status:'accepted'},admin)).status,200);
 const room=(await f.request('/api',{op:'create'},admin)).data;
 assert.equal((await call('invite',{targetId:friend.id},admin)).status,200);const i=(await call('list')).data.invitations[0];assert.equal((await call('invitation',{id:i.id},admin)).status,404);
 assert.equal((await f.request('/api',{op:'join',code:(await call('invitation',{id:i.id})).data.roomId},cookie)).status,200);
 assert.equal((await call('feedback',{type:'bug',content:'牌面问题',userId:host.id,gameVersion:'fake'})).status,200);
 assert.equal((await f.request('/admin-api',{op:'feedbackList'},cookie)).status,403);
 const item=(await f.request('/admin-api',{op:'feedbackList'},admin)).data.items[0];assert.equal(item.userId,friend.id);assert.equal(item.roomId,room.code);assert.equal(item.gameVersion,'1.3.2');
 assert.equal((await f.request('/admin-api',{op:'feedbackUpdate',id:item.id,status:'processing',adminNote:'内部备注'},admin)).status,200);
 assert(!JSON.stringify((await call('list')).data).includes('内部备注'));await f.restart();assert.equal((await call('list')).data.friends[0].status,'accepted');
 assert.equal((await f.request('/admin-api',{op:'feedbackList',status:'processing'},admin)).data.items[0].adminNote,'内部备注');
});
test('语音去重、打断与丢弃过期提醒',()=>{
 const audios=[];class Audio extends EventTarget{play(){return Promise.resolve();}pause(){this.stopped=true;}}
 const v=new VoiceManager({audio:()=>{const a=new Audio();audios.push(a);return a;},offset:type=>type==='call' ? .18 : 0,enabled:()=>true,volume:()=>.5});v.update('one');assert(v.play('a','call','one'));assert.equal(audios[0].currentTime,.18);assert(!v.play('a','call','one'));v.turn('t1','one',()=>true);assert.equal(audios.length,1);audios[0].dispatchEvent(new Event('ended'));assert.equal(audios.length,2);v.update('two');assert(audios[1].stopped);assert(!v.play('stale','call','one'));v.play('b','raise','two');v.turn('t2','two',()=>true);v.update('three');audios[2].dispatchEvent(new Event('ended'));assert.equal(audios.length,3);v.stop();
});
