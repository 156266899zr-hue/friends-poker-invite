import {writeFile} from 'node:fs/promises';
// Never replace an existing configuration or print credentials to logs.
const config=`HOST=127.0.0.1\nPORT=8787\nADMIN_USERNAME=156266899\nADMIN_NICKNAME=神原秋田\nADMIN_PASSWORD=888888\nCOOKIE_SECURE=false\nPUBLIC_ORIGIN=http://localhost:8787\n`;
await writeFile(new URL('./.env',import.meta.url),config,{flag:'wx',mode:0o600});
console.log('本地配置已保存到 .env。管理员默认密码为 888888；首次登录后可在页面修改。');
