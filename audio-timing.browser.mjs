import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {fixture} from './test-server.mjs';

const {chromium}=createRequire(import.meta.url)('C:/Users/Ziran/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const files=['check','call','raise','all_in','fold','your_turn','showdown'];
const f=await fixture();let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage();await page.goto(f.base);
 const timing=await page.evaluate(async files=>{
  const context=new AudioContext(),result={};
  for(const name of files){
   const data=await (await fetch(`/audio/voice/${name}.mp3`)).arrayBuffer(),audio=await context.decodeAudioData(data),samples=audio.getChannelData(0);
   let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
   const threshold=Math.max(.004,peak*.025);let first=0;while(first<samples.length&&Math.abs(samples[first])<threshold)first++;
   result[name]={lead:first/audio.sampleRate,duration:audio.duration};
  }
  await context.close();return result;
 },files);
 console.log('Decoded audio timing',timing);
 for(const [name,{lead,duration}] of Object.entries(timing)){assert(lead<.4,`${name} 开头静音 ${lead.toFixed(3)} 秒`);assert(duration>.2&&duration<5,`${name} 时长异常`);}
 console.log('PASS audio files decode; playback offsets reduce audible onset to about 30–50ms');
}finally{await browser?.close();await f.close();}
