import {randomUUID} from 'node:crypto';
import {fail} from './accounts.mjs';
export const gameVersion='1.3.2';
export function community(db,{requireUser,requireAdmin,rate}){
 db.exec(`CREATE TABLE IF NOT EXISTS friendships(id TEXT PRIMARY KEY, requester TEXT NOT NULL REFERENCES users(id), receiver TEXT NOT NULL REFERENCES users(id), pair TEXT UNIQUE NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),username TEXT NOT NULL,type TEXT NOT NULL,content TEXT NOT NULL,roomId TEXT,handId INTEGER,gameVersion TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',adminNote TEXT NOT NULL DEFAULT '',createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);`);
 const invitations=new Map(),types=['bug','experience','feature','other'],statuses=['new','viewed','processing','done'];
 const tableFor=(id,rooms)=>[...rooms.values()].find(r=>r.expiresAt>Date.now()&&r.players.some(p=>p.userId===id));
 const online=id=>!!db.prepare("SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.status='active' AND u.last_active_at>? AND s.expires_at>?").get(id,Date.now()-45000,Date.now());
 const pair=(a,b)=>[a,b].sort().join(':');
 function handle(req,b,rooms){
  const u=requireUser(req),now=Date.now();
  for(const [id,i] of invitations)if(i.expiresAt<now||!rooms.has(i.roomId))invitations.delete(id);
  if(b.op==='list'){
   const relations=db.prepare('SELECT * FROM friendships WHERE requester=? OR receiver=? ORDER BY updatedAt DESC').all(u.id,u.id);
   return {friends:relations.filter(r=>r.status!=='rejected').flatMap(r=>{const other=db.prepare("SELECT id,username,nickname FROM users WHERE id=? AND status='active'").get(r.requester===u.id?r.receiver:r.requester);return other?[{...other,relationId:r.id,status:r.status,incoming:r.receiver===u.id,presence:!online(other.id)?'offline':tableFor(other.id,rooms)?'playing':'online'}]:[];}),invitations:[...invitations.values()].filter(i=>i.toUserId===u.id)};
  }
  if(b.op==='search'){rate('search:'+u.id,30,60000);return {user:db.prepare("SELECT id,username,nickname FROM users WHERE username=? AND status='active'").get(String(b.username||'').trim().toLowerCase())||null};}
  if(b.op==='request'){
   rate('friend:'+u.id,10,60000);const target=db.prepare("SELECT id FROM users WHERE id=? AND status='active'").get(String(b.targetId));if(!target)fail(404,'用户不存在');if(target.id===u.id)fail(400,'不能添加自己');
   const key=pair(u.id,target.id),old=db.prepare('SELECT * FROM friendships WHERE pair=?').get(key);if(old&&old.status!=='rejected')fail(409,old.status==='accepted'?'已经是好友':'已有待处理申请');
   if(old&&now-old.updatedAt<60000)fail(429,'请稍后再申请');
   db.prepare('INSERT INTO friendships VALUES(?,?,?,?,?,?,?) ON CONFLICT(pair) DO UPDATE SET requester=excluded.requester,receiver=excluded.receiver,status=excluded.status,updatedAt=excluded.updatedAt').run(randomUUID(),u.id,target.id,key,'pending',now,now);return {ok:true};
  }
  if(b.op==='respond'){
   if(!['accepted','rejected'].includes(b.status))fail(400,'无效处理状态');
   const result=db.prepare("UPDATE friendships SET status=?,updatedAt=? WHERE id=? AND receiver=? AND status='pending'").run(b.status,now,String(b.id),u.id);if(!result.changes)fail(404,'申请不存在或已处理');return {ok:true};
  }
  if(b.op==='invite'){
   rate('invite:'+u.id,10,60000);const r=tableFor(u.id,rooms);if(!r)fail(400,'请先加入房间');const target=String(b.targetId);
   if(!db.prepare("SELECT 1 FROM friendships WHERE pair=? AND status='accepted'").get(pair(u.id,target)))fail(403,'只能邀请好友');if(!online(target))fail(400,'好友当前离线');
   if([...invitations.values()].some(i=>i.fromUserId===u.id&&i.toUserId===target&&i.roomId===r.code))fail(409,'邀请已发送');
   const id=randomUUID();invitations.set(id,{id,fromUserId:u.id,fromName:u.nickname,toUserId:target,roomId:r.code,timestamp:now,expiresAt:now+120000});return {ok:true};
  }
  if(b.op==='invitation'){
   const i=invitations.get(String(b.id));if(!i||i.toUserId!==u.id)fail(404,'邀请已失效');if(b.dismiss)invitations.delete(i.id);return {roomId:i.roomId};
  }
  if(b.op==='feedback'){
   rate('feedback:'+u.id,5,60000);const content=typeof b.content==='string'?b.content.trim():'';if(!types.includes(b.type)||!content||content.length>2000)fail(400,'请选择类型并填写 1–2000 字反馈');
   const r=tableFor(u.id,rooms);db.prepare('INSERT INTO feedback(id,userId,username,type,content,roomId,handId,gameVersion,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),u.id,u.username,b.type,content,r?.code||null,r?.hand||null,gameVersion,now,now);return {ok:true};
  }
  fail(400,'无效操作');
 }
 function admin(req,b){
  const u=requireAdmin(req);rate('feedback-admin:'+u.id,120,60000);
  if(b.op==='feedbackList'){
   if(b.status&&!statuses.includes(b.status)||b.type&&!types.includes(b.type))fail(400,'无效筛选');
   return {pending:db.prepare("SELECT count(*) n FROM feedback WHERE status!='done'").get().n,items:db.prepare(`SELECT * FROM feedback WHERE (?='' OR status=?) AND (?='' OR type=?) ORDER BY createdAt ${b.order==='asc'?'ASC':'DESC'}`).all(b.status||'',b.status||'',b.type||'',b.type||'')};
  }
  if(!statuses.includes(b.status)||typeof b.adminNote!=='string'||b.adminNote.length>2000)fail(400,'状态或备注无效');
  if(!db.prepare('UPDATE feedback SET status=?,adminNote=?,updatedAt=? WHERE id=?').run(b.status,b.adminNote,Date.now(),String(b.id)).changes)fail(404,'反馈不存在');return {ok:true};
 }
 return {handle,admin};
}
