import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const names = ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'];
await mkdir(new URL('public/runtime/',root), {recursive:true});
await copyFile(fileURLToPath(new URL('src-tauri/icons/icon.png',root)),fileURLToPath(new URL('public/icon.png',root)));
for(const name of names) await copyFile(fileURLToPath(new URL('node_modules/onnxruntime-web/dist/'+name,root)),fileURLToPath(new URL('public/runtime/'+name,root)));
