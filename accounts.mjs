import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as crypto from 'node:crypto';
import {scrypt,randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const deriveScrypt=promisify(scrypt),deriveArgon2=crypto.argon2?promisify(crypto.argon2):null;
export const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const cardBacks=['classic','ivory','midnight','ink'];
const publicUser=u=>u?Object.fromEntries(['id','username','nickname','card_back','role','status','created_at','last_login_at','last_active_at'].map(k=>[k,u[k]])):null;
function password(value){if(typeof value!=='string'||!/^\d{6}$/.test(value))fail(400,'密码须为六位数字');return value;}
function loginPassword(value){if(typeof value!=='string'||!value.length||value.length>128)fail(400,'请输入密码');return value;}
function nickname(value){if(typeof value!=='string'||!value.trim()||value.trim().length>12||/[\x00-\x1f\x7f]/.test(value))fail(400,'昵称须为 1–12 个字符');return value.trim();}
function cardBack(value){if(!cardBacks.includes(value))fail(400,'卡背皮肤不存在');return value;}
function username(value){if(typeof value!=='string'||! /^[a-zA-Z0-9_]{3,32}$/.test(value))fail(400,'账号须为 3–32 位字母、数字或下划线');return value.toLowerCase();}
async function hash(value,salt=randomBytes(16).toString('hex')){
 const result=await deriveScrypt(value,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt:${salt}:${result.toString('hex')}`;
}
async function verify(value,stored){const [algorithm,salt,key]=stored.split(':');let actual;if(algorithm==='scrypt')actual=(await hash(value,salt)).split(':')[2];else if(algorithm==='argon2id'&&deriveArgon2)actual=(await deriveArgon2('argon2id',{message:value,nonce:Buffer.from(salt,'hex'),parallelism:1,tagLength:32,memory:65536,passes:3})).toString('hex');else return false;const actualBuffer=Buffer.from(actual,'hex'),keyBuffer=Buffer.from(key||'','hex');return actualBuffer.length===keyBuffer.length&&timingSafeEqual(actualBuffer,keyBuffer);}

export async function accounts(){
 const path=resolve(process.env.DATA_DIR||fileURLToPath(new URL('./data/',import.meta.url)),'accounts.sqlite');
 mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,nickname TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),status TEXT NOT NULL CHECK(status IN ('pending','active','banned')),created_at INTEGER NOT NULL,last_login_at INTEGER,last_active_at INTEGER,card_back TEXT NOT NULL DEFAULT 'classic');
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
 INSERT OR IGNORE INTO settings VALUES('registration_limit',100);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,target TEXT,created_at INTEGER NOT NULL);
 `);
 if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='card_back'))db.exec("ALTER TABLE users ADD COLUMN card_back TEXT NOT NULL DEFAULT 'classic'");
 const audit=(actor,action,target='')=>db.prepare('INSERT INTO audit(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(actor,action,target,Date.now());
 if(!db.prepare("SELECT id FROM users WHERE role='admin'").get()){
  const name=username(process.env.ADMIN_USERNAME||'admin');
  const secret=password(process.env.ADMIN_PASSWORD||'888888');
  db.prepare('INSERT INTO users(id,username,nickname,password_hash,role,status,created_at,last_login_at,last_active_at,card_back) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),name,(process.env.ADMIN_NICKNAME||'房主').slice(0,12),await hash(secret),'admin','active',Date.now(),null,null,'classic');
 }
 const dummy=await hash(randomBytes(24).toString('hex'));
 const limits=new Map();let hashing=0;
 function rate(key,max,ms){const now=Date.now();let item=limits.get(key);if(!item||item.until<=now){item={count:0,until:now+ms};limits.set(key,item);}if(++item.count>max)fail(429,'操作过于频繁，请稍后再试');}
 const cleanup=setInterval(()=>{for(const [key,value] of limits)if(value.until<Date.now())limits.delete(key);db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());},60000);cleanup.unref();
 async function costly(fn){if(hashing>=4)fail(429,'当前登录人数较多，请稍后重试');hashing++;try{return await fn();}finally{hashing--;}}
 function sessionToken(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('poker_session='));return raw?raw.slice(14):'';}
 function current(req){const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now())||null;}
 function requireUser(req,active=true){const u=current(req);if(!u)fail(401,'请先登录');if(u.status==='banned')fail(403,'账号已被封禁，请联系房主');if(active&&u.status!=='active')fail(403,'账号待审核，请等待房主批准');db.prepare('UPDATE users SET last_active_at=? WHERE id=?').run(Date.now(),u.id);return u;}
 function requireAdmin(req){const u=requireUser(req);if(u.role!=='admin')fail(403,'仅管理员可访问');return u;}
 function cookie(res,token,maxAge=43200){res.setHeader('Set-Cookie',`poker_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);}
 function loginSession(res,u){db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),u.id,Date.now()+43200000);cookie(res,token);}
 async function auth(req,res,b){
  const ip=req.socket.remoteAddress||'unknown';
  if(['login','register','password'].includes(b.op)){rate('auth:'+ip,30,60000);rate('auth-global',120,60000);}
  if(b.op==='me'){const u=requireUser(req,false);return {user:publicUser(u)};}
  if(b.op==='register'){
   rate('register:'+ip,10,3600000);
   const name=username(b.username),secret=password(b.password),displayName=nickname(b.nickname);
   const encoded=await costly(()=>hash(secret));
   // No asynchronous work between capacity check and insert.
   const cap=db.prepare("SELECT value FROM settings WHERE key='registration_limit'").get().value;
   if(db.prepare('SELECT count(*) AS n FROM users').get().n>=cap)fail(400,'封闭测试名额已满');
   if(db.prepare('SELECT id FROM users WHERE username=?').get(name))fail(400,'账号已存在');
   const id=randomUUID();db.prepare('INSERT INTO users(id,username,nickname,password_hash,role,status,created_at,last_login_at,last_active_at,card_back) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,name,displayName,encoded,'user','pending',Date.now(),null,null,'classic');
   audit(id,'register');return {message:'注册成功，请等待房主确认身份并审批后登录'};
  }
  if(b.op==='login'){
   const name=username(b.username),secret=loginPassword(b.password);rate('login:'+name,12,900000);
   const u=db.prepare('SELECT * FROM users WHERE username=?').get(name);
   const valid=await costly(()=>verify(secret,u?.password_hash||dummy));
   if(!u||!valid)fail(401,'账号或密码不正确');
   // Re-read after hashing: a simultaneous administrator ban must take effect.
   const fresh=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
   if(fresh.password_hash!==u.password_hash)fail(401,'密码已变更，请重试');
   if(fresh.status==='banned')fail(403,'账号已被封禁，请联系房主');
   loginSession(res,fresh);db.prepare('UPDATE users SET last_login_at=?,last_active_at=? WHERE id=?').run(Date.now(),Date.now(),u.id);
   return {user:publicUser(fresh)};
  }
  if(b.op==='logout'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(sessionToken(req)));cookie(res,'',0);return {ok:true};}
  if(b.op==='profile'){
   const u=requireUser(req,false);rate('profile:'+u.id,20,60000);const name=nickname(b.nickname);
   db.prepare('UPDATE users SET nickname=? WHERE id=?').run(name,u.id);audit(u.id,'profile');return {user:publicUser({...u,nickname:name})};
  }
  if(b.op==='skin'){
   const u=requireUser(req,false),skin=cardBack(b.cardBack);rate('profile:'+u.id,20,60000);
   db.prepare('UPDATE users SET card_back=? WHERE id=?').run(skin,u.id);audit(u.id,'skin',skin);return {user:publicUser({...u,card_back:skin})};
  }
  if(b.op==='password'){
   const u=requireUser(req,false);password(b.password);loginPassword(b.oldPassword);
   const encoded=await costly(async()=>{if(!await verify(b.oldPassword,u.password_hash))fail(400,'原密码不正确');return hash(b.password);});
   const fresh=requireUser(req,false);if(fresh.password_hash!==u.password_hash)fail(409,'密码已变更，请重新登录');
   db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(encoded,u.id);loginSession(res,u);audit(u.id,'password');return {ok:true};
  }
  fail(400,'无效账号操作');
 }
 function admin(req,b,rooms){
  const actor=requireAdmin(req);rate('admin:'+actor.id,120,60000);
  if(b.op==='status'){
   const users=db.prepare('SELECT id,username,nickname,card_back,role,status,created_at,last_login_at,last_active_at FROM users ORDER BY created_at DESC').all();
   const online=new Set(db.prepare('SELECT DISTINCT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.expires_at>? AND u.last_active_at>? AND u.status=?').all(Date.now(),Date.now()-45000,'active').map(u=>u.id));
   const tables=[...rooms.values()].map(r=>({code:r.code,phase:r.phase,hand:r.hand,expiresAt:r.expiresAt,players:r.players.map(p=>({id:p.userId||null,name:p.name,username:users.find(u=>u.id===p.userId)?.username||null,bot:p.bot,online:online.has(p.userId)}))}));
   return {limit:db.prepare("SELECT value FROM settings WHERE key='registration_limit'").get().value,users:users.map(u=>({...u,online:online.has(u.id)})),rooms:tables,audit:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 50').all()};
  }
  if(b.op==='limit'){if(!Number.isInteger(b.limit)||b.limit<1||b.limit>10000)fail(400,'注册上限须为 1–10000');db.prepare("UPDATE settings SET value=? WHERE key='registration_limit'").run(b.limit);audit(actor.id,'limit',String(b.limit));return {ok:true};}
  if(b.op==='closeRoom'){if(!rooms.delete(String(b.code)))fail(404,'房间不存在');audit(actor.id,'closeRoom',String(b.code));return {ok:true};}
  const target=db.prepare('SELECT * FROM users WHERE id=?').get(String(b.userId));if(!target)fail(404,'用户不存在');
  if(target.role==='admin')fail(400,'不能通过此入口操作管理员');
  if(b.op==='revoke'){db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);audit(actor.id,'revoke',target.id);return {ok:true};}
  if(b.op==='statusChange'){
   if(!['active','pending','banned'].includes(b.status))fail(400,'状态不正确');
   db.prepare('UPDATE users SET status=? WHERE id=?').run(b.status,target.id);
   if(b.status!=='active')db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
   // Close affected tables so a banned player cannot continue through a bot or timeout action.
   if(b.status!=='active')for(const [code,r] of rooms)if(r.players.some(p=>p.userId===target.id))rooms.delete(code);
   audit(actor.id,b.status,target.id);return {ok:true};
  }
  fail(400,'无效管理操作');
 }
 return {auth,admin,requireUser,rate,audit};
}
