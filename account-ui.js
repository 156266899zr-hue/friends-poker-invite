const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user=null,ready=false,working=false,adminPending=false,authVersion=0;
const tableSkins=['classic','ivory','midnight','ink'];
let tableSkin=tableSkins.includes(localStorage.getItem('poker-table-skin'))?localStorage.getItem('poker-table-skin'):'classic';
function applyTableSkin(){document.documentElement.dataset.tableSkin=tableSkin;for(const button of document.querySelectorAll('.table-skin-option')){const selected=button.dataset.tableSkin===tableSkin;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}}
applyTableSkin();
async function request(path,body){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error),{status:res.status});return data;}
function message(text){$('accountMessage').textContent=text;}
function renderAccountSkin(){for(const button of document.querySelectorAll('#passwordDialog .skin-option')){const selected=button.dataset.skin===(user?.card_back||'classic');button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}}
function apply(next,roomSession){
 const wasActive=user?.status==='active';const previousId=user?.id||localStorage.getItem('poker-account-id');const changed=previousId!==next?.id;user=next;authVersion++;if(next)localStorage.setItem('poker-account-id',next.id);else localStorage.removeItem('poker-account-id');
 if(changed){localStorage.removeItem('poker-session');window.dispatchEvent(new Event('poker-account-cleared'));}
 if(roomSession)localStorage.setItem('poker-session',JSON.stringify(roomSession));
 const active=user?.status==='active';
 $('accountGate').hidden=active;$('authForm').hidden=!!user;$('pendingPanel').hidden=!user;
 $('accountBar').hidden=!user;$('accountName').textContent=user?`${user.nickname} · ${user.username}`:'';
 $('adminButton').hidden=!(active&&user?.role==='admin');
 $('logout').hidden=!active||!!roomSession;
 $('friendsButton').hidden=!active;$('settingsButton').hidden=!active;$('rulesButton').hidden=!active;
 if(!active){$('game').hidden=true;$('lobby').hidden=true;if(!user)for(const d of document.querySelectorAll('dialog[open]'))d.close();}
 else if(!ready){ready=true;import('/app.js').catch(()=>message('游戏加载失败，请刷新页面'));}
 else if(changed||!wasActive)window.dispatchEvent(new Event('poker-account-ready'));
 if(active){$('nickname').value=user.nickname;$('nickname').readOnly=true;}
}
async function refresh(){const version=authVersion;try{const result=await request('/auth',{op:'me'});if(version!==authVersion)return;apply(result.user,result.roomSession);}catch(e){if(version!==authVersion)return;if(e.status===401||e.status===403){apply(null);message(e.status===403?e.message:'请登录已获批准的账号，或注册后等待房主审核。');}else message('无法连接服务器，请稍后重试');}}
let authMode='login';
function setAuthMode(mode){
 authMode=mode;const registration=mode==='register';
 $('registerFields').hidden=!registration;$('accountNickname').disabled=!registration;$('accountNickname').required=registration;
 $('authSubmit').value=mode;$('authSubmit').textContent=registration?'注册并申请加入':'登录';$('authToggle').textContent=registration?'返回登录':'注册账号';
 $('password').value='';$('password').autocomplete=registration?'new-password':'current-password';
 $('password').maxLength=registration?6:128;$('password').minLength=registration?6:1;
 if(registration){$('password').pattern='[0-9]{6}';$('password').inputMode='numeric';}else{$('password').removeAttribute('pattern');$('password').removeAttribute('inputmode');}
 $('password').placeholder=registration?'设置六位数字密码':'输入密码';message('');
}
$('authToggle').onclick=()=>{if(!working)setAuthMode(authMode==='login'?'register':'login');};
$('authForm').onsubmit=async e=>{e.preventDefault();if(working)return;working=true;const button=$('authSubmit'),op=authMode;button.disabled=true;$('authToggle').disabled=true;message('正在处理…');try{
 const body={op,username:$('username').value.trim(),password:$('password').value};if(op==='register')body.nickname=$('accountNickname').value.trim();
 const data=await request('/auth',body);
 if(op==='register'){setAuthMode('login');message(data.message);}else{apply(data.user,data.roomSession);message('');$('password').value='';}
}catch(err){message(err.message);}finally{working=false;button.disabled=false;$('authToggle').disabled=false;}};
$('refreshApproval').onclick=refresh;
$('logout').onclick=async()=>{authVersion++;try{await request('/auth',{op:'logout'});apply(null);message('已退出登录');}catch(e){message(e.message);}};
window.addEventListener('poker-auth-expired',()=>refresh());
setInterval(()=>{if(user&&!document.hidden)refresh();},15000);
$('passwordButton').onclick=()=>{$('passwordMessage').textContent='';$('nicknameMessage').textContent='';$('skinMessage').textContent='';$('tableSkinMessage').textContent='';$('settingsNickname').value=user?.nickname||'';$('passwordForm').reset();for(const section of document.querySelectorAll('#passwordDialog details'))section.open=false;renderAccountSkin();applyTableSkin();$('passwordDialog').showModal();};
$('passwordDialog').addEventListener('click',async e=>{const button=e.target.closest('.skin-option');if(!button||button.disabled)return;button.disabled=true;try{const data=await request('/auth',{op:'skin',cardBack:button.dataset.skin});apply(data.user,data.roomSession);renderAccountSkin();$('skinMessage').textContent=`已使用${button.dataset.name}卡背，账号已同步`;}catch(err){$('skinMessage').textContent=err.message;}finally{button.disabled=false;}});
$('passwordDialog').addEventListener('click',e=>{const button=e.target.closest('.table-skin-option');if(!button)return;tableSkin=button.dataset.tableSkin;localStorage.setItem('poker-table-skin',tableSkin);applyTableSkin();$('tableSkinMessage').textContent=`已使用${button.dataset.name}牌桌，仅当前设备可见`;});
$('nicknameForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const data=await request('/auth',{op:'profile',nickname:$('settingsNickname').value});apply(data.user,data.roomSession);$('settingsNickname').value=data.user.nickname;$('nicknameMessage').textContent='昵称已保存';}catch(err){$('nicknameMessage').textContent=err.message;}finally{button.disabled=false;}};
$('closePassword').onclick=()=>$('passwordDialog').close();
$('passwordForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await request('/auth',{op:'password',oldPassword:$('oldPassword').value,password:$('newPassword').value});$('passwordForm').reset();$('passwordMessage').textContent='密码已修改，其他登录已撤销。';}catch(err){$('passwordMessage').textContent=err.message;}finally{button.disabled=false;}};
const statuses={pending:'待审核',active:'已批准',banned:'已封禁'};
const phases={waiting:'等待发牌',preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',done:'本手结束'};
const time=value=>value?new Date(value).toLocaleString('zh-CN'):'尚未登录';
async function loadAdmin(){
 if(adminPending)return;adminPending=true;
 try{const data=await request('/admin-api',{op:'status'});
 $('adminMetrics').textContent=`注册 ${data.users.length} / ${data.limit} · 待审核 ${data.users.filter(u=>u.status==='pending').length} · 在线 ${data.users.filter(u=>u.online).length} · 房间 ${data.rooms.length}`;
 if(document.activeElement!==$('registrationLimit'))$('registrationLimit').value=data.limit;
 $('adminUsers').innerHTML=data.users.map(u=>`<article class="admin-user"><div><strong>${esc(u.nickname)}</strong> <span>${esc(u.username)}</span><p>${statuses[u.status]} · ${u.online?'在线':'离线'}${u.role==='admin'?' · 管理员':''}</p><small>注册 ${time(u.created_at)}<br>最近登录 ${time(u.last_login_at)}</small></div>${u.role!=='admin'?`<div class="admin-buttons">${u.status!=='active'?`<button data-op="statusChange" data-id="${u.id}" data-status="active">${u.status==='banned'?'解除封禁':'批准'}</button>`:''}${u.status!=='banned'?`<button class="danger" data-op="statusChange" data-id="${u.id}" data-status="banned">封禁</button>`:''}<button data-op="revoke" data-id="${u.id}">撤销登录</button></div>`:''}</article>`).join('');
 $('adminRooms').innerHTML=data.rooms.length?data.rooms.map(r=>`<article class="admin-user"><div><strong>房间 ${r.code}</strong> · ${phases[r.phase]} · 第 ${r.hand} 手<p>${r.players.map(p=>`${esc(p.name)}${p.username?' / '+esc(p.username):''}${p.bot?'（陪练）':p.online?'（在线）':'（离线）'}`).join('、')}</p></div><button class="danger" data-op="closeRoom" data-code="${r.code}">关闭房间</button></article>`).join(''):'<p>当前没有房间</p>';
 const actions={createRoom:'创建房间',joinRoom:'加入房间',leaveRoom:'离开房间',register:'注册申请',active:'批准 / 解封',banned:'封禁',pending:'撤回审批',revoke:'撤销登录',closeRoom:'关闭房间',limit:'修改名额',profile:'修改昵称',skin:'修改卡背',password:'修改密码',startHand:'开始牌局'};
 $('adminAudit').innerHTML=data.audit.map(x=>`<p>${time(x.created_at)} · ${esc(data.users.find(u=>u.id===x.actor_id)?.username||'系统')} · ${esc(actions[x.action]||x.action)} · ${esc(data.users.find(u=>u.id===x.target)?.username||x.target)}</p>`).join('');
 $('adminMessage').textContent='已更新 '+new Date().toLocaleTimeString();
 }catch(e){$('adminMessage').textContent=e.message;}finally{adminPending=false;}
}
$('adminButton').onclick=()=>{for(const section of $('adminDialog').querySelectorAll('.admin-settings-menu details'))section.open=false;$('adminDialog').showModal();loadAdmin();};
$('closeAdmin').onclick=()=>$('adminDialog').close();$('refreshAdmin').onclick=loadAdmin;
$('adminDialog').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-op]');if(!button||button.disabled)return;
 const {op,id,status,code}=button.dataset;
 const prompt=op==='closeRoom'?'关闭这个房间？所有玩家将退出。':status==='banned'?'封禁这个账号？其登录会失效，所在房间也会关闭。':status==='active'?'确认已核实这是你的朋友，并允许其进入游戏？':'撤销该账号的所有登录？账号仍可凭密码重新登录，阻止游玩请使用封禁。';
 if(!confirm(prompt))return;button.disabled=true;
 try{await request('/admin-api',{op,userId:id,status,code});await loadAdmin();}catch(err){$('adminMessage').textContent=err.message;}finally{button.disabled=false;}
});
$('limitForm').onsubmit=async e=>{e.preventDefault();try{await request('/admin-api',{op:'limit',limit:Number($('registrationLimit').value)});await loadAdmin();}catch(err){$('adminMessage').textContent=err.message;}};
setInterval(()=>{if($('adminDialog').open&&!document.hidden)loadAdmin();},10000);
refresh();
