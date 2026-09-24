import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './test-server.mjs';

const {chromium}=createRequire(import.meta.url)('C:/Users/Ziran/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const f=await fixture();let browser;
async function approved(admin,username,nickname){
 await f.request('/auth',{op:'register',username,nickname,password:f.secret});
 const users=(await f.request('/admin-api',{op:'status'},admin)).data.users,id=users.find(user=>user.username===username).id;
 await f.request('/admin-api',{op:'statusChange',userId:id,status:'active'},admin);
 return (await f.request('/auth',{op:'login',username,password:f.secret})).cookie;
}
try{
 const admin=(await f.request('/auth',{op:'login',username:'test_admin',password:f.secret})).cookie;
 const memberCookie=await approved(admin,'browser_member','在局玩家');
 await approved(admin,'browser_spectator','观战玩家');
 const host=(await f.request('/api',{op:'create',deviceId:'host'},admin)).data;
 const member=(await f.request('/api',{op:'join',code:host.code,deviceId:'member'},memberCookie)).data;
 await f.request('/api',{...host,op:'start'},admin);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(f.base);
 await page.locator('#username').fill('browser_spectator');await page.locator('#password').fill(f.secret);await page.locator('#authSubmit').click();
 await page.locator('#roomcode').fill(host.code);await page.locator('#join').click();await page.locator('#game').waitFor({state:'visible'});
 await page.getByText('正在观战 · 下一手自动入座',{exact:true}).waitFor();assert.equal(await page.locator('.seat.me .card').count(),0);assert((await page.locator('.seat.me .status').innerText()).includes('观战中'));
 await mkdir(new URL('./test-output/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('./test-output/spectator.png',import.meta.url)),fullPage:true});
 const state=(await f.request('/api',{...host,op:'state'},admin)).data,actor=state.players[state.turn].id===state.me?{session:host,cookie:admin}:{session:member,cookie:memberCookie};
 await f.request('/api',{...actor.session,op:'act',type:'fold'},actor.cookie);await f.request('/api',{...host,op:'start'},admin);
 await page.waitForFunction(()=>document.querySelector('.seat.me .cards')?.children.length===2);assert(!await page.getByText('正在观战 · 下一手自动入座',{exact:true}).isVisible());assert.deepEqual(errors,[]);
 console.log('PASS active-game spectator joins and automatically seats next hand');
}finally{await browser?.close();await f.close();}
