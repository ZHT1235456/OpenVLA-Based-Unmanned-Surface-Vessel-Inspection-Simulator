import {copyFile,access} from 'node:fs/promises';
const title='基于OpenVLA的无人艇巡检模拟.exe';
const root=new URL('../',import.meta.url);
const compiled=new URL('src-tauri/target/release/'+title,root);
await access(compiled);await copyFile(compiled,new URL(title,root));
console.log(title);
