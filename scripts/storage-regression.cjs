const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'installer/app.cjs'), 'utf8');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const pdf = Buffer.from('%PDF-1.7\nfixture for byte routing tests\n%%EOF');
function environment({denied = false, storageRoot, oldServer = false} = {}) {
  let handler, failWrites = denied;
  const disk = new Map(), db = new Map(), calls = [];
  const appDir = path.join(root, 'release', 'isolated-fixture');
  const error = code => Object.assign(new Error(code), {code});
  const io = {
    mkdir: async () => {}, access: async () => {}, readdir: async () => [],
    stat: async p => { if (!disk.has(p)) throw error('ENOENT'); return {size: disk.get(p).length, isFile: () => true}; },
    writeFile: async (p,b,options) => {
      if (failWrites) throw error('EACCES');
      if (options?.flag === 'wx' && disk.has(p)) throw error('EEXIST');
      disk.set(p,Buffer.from(b));
    },
    readFile: async p => {
      if (p === path.join(appDir,'dist/index.html')) return Buffer.from('<!DOCTYPE html>fixture');
      if (!disk.has(p)) throw error('ENOENT'); return disk.get(p);
    },
  };
  // Learning-data persistence is covered by learning-data-regression.cjs, not this virtual filesystem.
  const context = {require: id => id === './data-storage.cjs' ? { createDataStorage: () => async () => false, migrateRoot: async (_a, _b, commit) => commit() } : id === 'node:http' ? {createServer: fn => {handler=fn; return {}}} :
    id === 'node:fs/promises' ? io : id === 'node:fs' ? {
      constants: fs.constants, existsSync: p => p.endsWith('config.json') ? !!storageRoot : disk.has(p),
      readFileSync: () => JSON.stringify({courseStorageRoot: storageRoot}),
    } : id === 'node:path' ? {...path,resolve:(...parts)=>path.resolve(appDir,...parts)} : require(id),
    __dirname: appDir, console: {log(){},error(){}}, process: {...process, env:{...process.env,CHILLPASS_APP_DIR:undefined}},
    Buffer, URL, setTimeout, clearTimeout};
  vm.runInNewContext(source.slice(0,source.indexOf('// ── Start')),context);
  const fetch = async (url,init={}) => {
    calls.push(url.split('?')[0]);
    if (oldServer) return new Response('<!DOCTYPE html>old server',{headers:{'content-type':'text/html'}});
    let status, headers, body;
    const req=Readable.from(init.body?[Buffer.from(init.body)]:[]); req.url=url;req.method=init.method||'GET';
    await handler(req,{writeHead:(s,h)=>{status=s;headers=h},end:b=>{body=b}});
    return new Response(body,{status,headers});
  };
  const request = action => { const r={};queueMicrotask(()=>{r.result=action();r.onsuccess?.()});return r; };
  const database = { transaction: () => {
    const tx={objectStore:()=>({
      put:record=>request(()=>{db.set(record.id,record);queueMicrotask(()=>tx.oncomplete?.());return record.id}),
      get:id=>request(()=>db.get(id)),count:id=>request(()=>db.has(id)?1:0),
    })};return tx;
  }};
  const common={fetch,URLSearchParams,ArrayBuffer,Uint8Array,TextDecoder,Promise,crypto:webcrypto,File,btoa,atob,
    indexedDB:{open:()=>request(()=>database)}};
  const front={...common,exports:{},require:()=>({changeLearningDataRoot:change=>change(),translate:(_,key)=>key,useLanguageStore:{getState:()=>({language:'zh'})}})};
  vm.runInNewContext(compile('src/services/browserFileStore.ts'),front);
  const archive={...common,exports:{},require:()=>front.exports};
  vm.runInNewContext(compile('src/services/courseArchive.ts'),archive);
  return {api:front.exports,archive:archive.exports,disk,db,calls,fetch,setDenied:value=>{failWrites=value}};
}
const file=()=>new File([pdf],'fixture.pdf');
const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS '+name)}
(async()=>{
  await test('disk upload/read, verified bytes, same-name uploads preserve originals',async()=>{
    const e=environment();const a=await e.api.storeFile('file_a',file(),{courseName:'操作系统'});
    const b=await e.api.storeFile('file_b',file(),{courseName:'操作系统'});
    assert.notEqual(a.path,b.path);assert.ok(Buffer.from(await e.api.readFileBuffer(a.path)).equals(pdf));
    assert.equal(await e.api.fileExists(a.path),true);assert.equal(await e.api.getFileSize(a.path),pdf.length);
  });
  await test('browser ID never reaches filesystem API; exists/size are correct',async()=>{
    const e=environment();const m=await e.api.storeFile('file_a',file());
    assert.ok(Buffer.from(await e.api.readFileBuffer(m.path)).equals(pdf));
    assert.equal(await e.api.fileExists(m.path),true);assert.equal(await e.api.getFileSize(m.path),pdf.length);assert.equal(e.calls.length,0);
  });
  await test('write denied under broad root falls back to intact browser file',async()=>{
    const e=environment({denied:true,storageRoot:root});const m=await e.api.storeFile('file_a',file(),{courseName:'课程'});
    assert.equal(m.path,'file_a');assert.ok(Buffer.from(await e.api.readFileBuffer(m.path)).equals(pdf));
    e.setDenied(false);const copied=await e.api.storeBufferInCourseFolder('课程','fixture.pdf',await e.api.readFileBuffer(m.path));
    assert.equal(copied.size,pdf.length);assert.ok(e.disk.get(copied.path).equals(pdf));
  });
  await test('missing disk file is JSON 404, never an HTML success',async()=>{
    const e=environment();const m=await e.api.storeFile('file_a',file(),{courseName:'课程'});e.disk.delete(m.path);
    await assert.rejects(()=>e.api.readFileBuffer(m.path),/ENOENT/);
    const r=await e.fetch('/api/readFile?'+new URLSearchParams({path:m.path}));assert.equal(r.status,404);assert.match(r.headers.get('content-type'),/json/);
  });
  await test('old HTML-returning servers and malformed PDFs are rejected',async()=>{
    const e=environment({oldServer:true});await assert.rejects(()=>e.api.readFileBuffer('C:/test.pdf'),/非文件/);
    await assert.rejects(()=>e.api.storeFile('file_a',new File(['<!DOCTYPE html>'],'bad.pdf')),/不是 PDF/);
    await assert.rejects(()=>e.api.storeBufferInCourseFolder('课程','bad.pdf',new TextEncoder().encode('<html>').buffer),/不是 PDF/);
  });
  await test('custom root switch keeps previous file readable and persists roots',async()=>{
    const e=environment({storageRoot:'C:/StorageA'});const m=await e.api.storeFile('file_a',file(),{courseName:'课程'});
    await e.api.setCourseStorageRoot('C:/StorageB');assert.ok(Buffer.from(await e.api.readFileBuffer(m.path)).equals(pdf));
    const config=[...e.disk].find(([p])=>p.endsWith('config.json'));assert.ok(JSON.parse(config[1]).previousStorageRoots.some(p=>p.includes('StorageA')));
  });
  await test('failed root change rejects and leaves previous root in effect',async()=>{
    const e=environment({storageRoot:'C:/StorageA'});e.setDenied(true);
    await assert.rejects(()=>e.api.setCourseStorageRoot('C:/StorageB'),/EACCES/);
    assert.match(await e.api.getCourseStorageRoot(),/StorageA/);
  });
  await test('server refuses browser IDs and invalid PDF upload',async()=>{
    const e=environment();assert.equal((await e.fetch('/api/readFile?path=file_a')).status,403);
    assert.equal((await e.fetch('/api/storeCourseFile?courseName=test&fileName=bad.pdf',{method:'POST',body:Buffer.from('<html>')})).status,422);
  });
  await test('portable course archive restores bytes to a fresh environment',async()=>{
    const a=environment();const m=await a.api.storeFile('file_a',file(),{courseName:'课程'});
    const bundle={course:{id:'c',name:'课程',files:[{id:'f',...m}]},lessons:[],examPoints:[],rawText:'text'};
    const archive=await a.archive.buildCourseArchive(bundle);assert.equal(archive.embeddedFiles.length,1);
    const b=environment({storageRoot:'C:/OtherUser'});const restored=await b.archive.restoreCourseFiles(JSON.parse(JSON.stringify(archive)));
    const dest=restored.course.files[0].path;assert.notEqual(dest,m.path);assert.ok(Buffer.from(await b.api.readFileBuffer(dest)).equals(pdf));
    archive.embeddedFiles[0].sha256='invalid';await assert.rejects(()=>b.archive.restoreCourseFiles(archive),/校验失败/);
    const legacy=await b.archive.restoreCourseFiles(bundle);assert.match(legacy.course.files[0].path,/^missing:/);
  });
  console.log(`Completed ${results.length} storage regression scenarios.`);
})().catch(error=>{console.error(error);process.exitCode=1});
