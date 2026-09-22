// Launch only the supplied test executable, on an isolated port/config/storage.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const exe = path.resolve(process.argv[2]);
const expectedBuildId = process.argv[3] || '20260922-local-learning-data';
const hash = b => createHash('sha256').update(b).digest('hex');
(async()=>{
  const fixtureParent = path.resolve('output/storage-release-smoke');await fs.mkdir(fixtureParent,{recursive:true});
  const dir = await fs.mkdtemp(path.join(fixtureParent,'run-'));
  await fs.mkdir(path.join(dir,'config'));
  await fs.writeFile(path.join(dir,'config','config.json'),JSON.stringify({courseStorageRoot:path.join(dir,'initial-storage'),previousStorageRoots:[]}));
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  let child;
  const start=async()=>{
    child=spawn(exe,[],{cwd:path.dirname(exe),windowsHide:true,stdio:'ignore',env:{...process.env,CHILLPASS_APP_DIR:path.dirname(exe),CHILLPASS_PORT:String(port),CHILLPASS_NO_UI:'1',CHILLPASS_CONFIG_DIR:path.join(dir,'config')}});
    let spawnError;child.on('error',e=>{spawnError=e});
    for(let i=0;i<100;i++){
      if(spawnError)throw spawnError;
      try{const r=await fetch(base+'/api/getAppVersion',{signal:AbortSignal.timeout(500)});const v=await r.json();if(v.buildId===expectedBuildId)return;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }throw Error('Test executable did not become ready');
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}};
  const post=async(route,value)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(r.status,200);return r.json()};
  try {
    await start();
    const html=await(await fetch(base+'/')).text();assert.ok(html.includes('ChillPass'));assert.ok(!html.includes('/@vite/client'));
    const assets=[...html.matchAll(/(?:src|href)="(\.?\/assets\/[^" ]+)"/g)].map(m=>m[1]);assert.ok(assets.length>0);
    for(const asset of assets){const r=await fetch(new URL(asset,base+'/'));assert.equal(r.status,200);assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(await fs.readFile(path.join(path.dirname(exe),'dist',asset))));}
    const rootA=path.join(dir,'storage-a'),rootB=path.join(dir,'storage-b');await post('/api/setCourseStorageRoot',{path:rootA});
    const pdfPath=process.argv[4] || process.env.CHILLPASS_TEST_PDF;
    if(!pdfPath)throw Error('Provide a test PDF as argument 4 or CHILLPASS_TEST_PDF. No personal courseware is included.');
    const pdf=await fs.readFile(pdfPath);
    const upload=await fetch(base+'/api/storeCourseFile?'+new URLSearchParams({courseName:'操作系统',fileName:'01-导论.pdf'}),{method:'POST',body:pdf});assert.equal(upload.status,200);const saved=await upload.json();
    const read=async()=>{const r=await fetch(base+'/api/readFile?'+new URLSearchParams({path:saved.path}));assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/octet-stream/);const b=Buffer.from(await r.arrayBuffer());assert.equal(hash(b),hash(pdf));return b};
    const bytes=await read();await post('/api/setCourseStorageRoot',{path:rootB});await read();
    await stop();await start();await read();
    const missing=await fetch(base+'/api/readFile?'+new URLSearchParams({path:path.join(rootA,'missing.pdf')}));assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/json/);
    assert.equal((await fetch(base+'/api/readFile?path=file_browser')).status,403);
    const bad=await fetch(base+'/api/storeCourseFile?courseName=test&fileName=bad.pdf',{method:'POST',body:'<!DOCTYPE html>'});assert.equal(bad.status,422);
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const assetNames=await fs.readdir(path.join(path.dirname(exe),'dist/assets'));
    const worker=assetNames.find(n=>n.startsWith('pdf.worker')&&n.endsWith('.mjs'));assert.ok(worker);
    pdfjs.GlobalWorkerOptions.workerSrc=require('node:url').pathToFileURL(path.join(path.dirname(exe),'dist/assets',worker)).href;
    const document=await pdfjs.getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;
    for(let i=1;i<=document.numPages;i++)await(await document.getPage(i)).getTextContent();
    const pages=document.numPages;await document.destroy();
    console.log(JSON.stringify({passed:true,exe,buildId:expectedBuildId,assetCount:assets.length,bytes:pdf.length,pages,hash:hash(pdf),restartKeepsOldRootReadable:true,missingStatus:404,browserIdStatus:403,invalidPdfStatus:422,fixture:dir}));
  } finally {await stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
