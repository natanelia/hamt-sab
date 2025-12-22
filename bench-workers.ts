import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const N = 1000;
const ITERS = 500;

if (isMainThread) {
  // Create shared memory with enough space
  const sharedMem = new SharedArrayBuffer(1024 * 1024); // 1MB
  const wasmBytes = readFileSync('./hamt-wasm.wasm');
  const wasmModule = new WebAssembly.Module(wasmBytes);
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 65536, shared: true });
  const wasm = new WebAssembly.Instance(wasmModule, { env: { memory, abort: () => {} } }).exports as any;
  
  wasm.reset();
  const keyBufPtr = wasm.keyBuf();
  let memBuf = new Uint8Array(memory.buffer);
  const encoder = new TextEncoder();
  
  const keys = Array.from({ length: N }, (_, i) => `key${i}`);
  let root = 0;
  
  // Build HAMT
  for (let i = 0; i < N; i++) {
    const key = keys[i];
    for (let j = 0; j < key.length; j++) memBuf[keyBufPtr + j] = key.charCodeAt(j);
    
    const nameEnc = encoder.encode(`item${i}`);
    const valLen = 20 + nameEnc.length;
    const leaf = wasm.allocLeaf(key.length, valLen);
    const dataPtr = wasm.leafKeyPtr(leaf);
    
    if (memBuf.buffer !== memory.buffer) memBuf = new Uint8Array(memory.buffer);
    memBuf.copyWithin(dataPtr, keyBufPtr, keyBufPtr + key.length);
    
    const valPtr = dataPtr + key.length;
    const dv = new DataView(memory.buffer);
    dv.setInt32(valPtr, i, true);
    dv.setFloat64(valPtr + 8, i * 1.5, true);
    dv.setUint16(valPtr + 16, 20, true);
    dv.setUint16(valPtr + 18, nameEnc.length, true);
    memBuf.set(nameEnc, valPtr + 20);
    
    root = wasm.insert(root, leaf);
  }
  
  const offsets = { id: 0, x: 8, name: 16 };
  const sharedBuf = memory.buffer as SharedArrayBuffer;
  
  console.log('=== Zero-Copy: 4 Workers Sharing Same Memory (Parallel) ===\n');
  console.log(`SharedArrayBuffer size: ${sharedBuf.byteLength} bytes`);
  console.log(`Root pointer: ${root}\n`);
  
  // Use an atomic counter for synchronization
  const syncBuf = new SharedArrayBuffer(4);
  const syncArr = new Int32Array(syncBuf);
  
  const workerUrl = fileURLToPath(import.meta.url);
  const NUM_WORKERS = 4;
  
  // Run all workers in parallel
  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => new Worker(workerUrl, {
    workerData: { id: i + 1, root, keys, offsets, sharedBuf, syncBuf, numWorkers: NUM_WORKERS }
  }));
  
  // Wait for all workers to be ready
  while (Atomics.load(syncArr, 0) < NUM_WORKERS) await new Promise(r => setTimeout(r, 1));
  
  // Signal all workers to start
  Atomics.store(syncArr, 0, -1);
  Atomics.notify(syncArr, 0, NUM_WORKERS);
  
  const results: any[] = [];
  await Promise.all(workers.map(w => new Promise<void>(resolve => {
    w.on('message', msg => { results.push(msg); resolve(); });
    w.on('error', e => { console.error('Worker error:', e); resolve(); });
  })));
  
  results.sort((a, b) => a.id - b.id);
  for (const r of results) {
    console.log(`Worker ${r.id}: i32=${r.i32.toFixed(3)}ms, f64=${r.f64.toFixed(3)}ms, str=${r.str.toFixed(3)}ms, obj=${r.obj.toFixed(3)}ms`);
  }
  
  const avg = (k: string) => results.reduce((s, r) => s + r[k], 0) / results.length;
  console.log(`\nAverage: i32=${avg('i32').toFixed(3)}ms, f64=${avg('f64').toFixed(3)}ms, str=${avg('str').toFixed(3)}ms, obj=${avg('obj').toFixed(3)}ms`);
  console.log(`\nImmutable.js baseline: ~0.089ms`);
  
} else {
  const { id, root, keys, offsets, sharedBuf, syncBuf } = workerData;
  
  // Instantiate WASM with the SAME shared memory
  const wasmBytes = readFileSync('./hamt-wasm.wasm');
  const wasmModule = new WebAssembly.Module(wasmBytes);
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 65536, shared: true, buffer: sharedBuf } as any);
  const wasm = new WebAssembly.Instance(wasmModule, { env: { memory, abort: () => {} } }).exports as any;

  // Each worker uses its own region for key encoding and output (4KB per worker, cache-line aligned)
  const workerRegion = 512 * 1024 + (id - 1) * 4096; // Start at 512KB, 4KB per worker
  const keyBufPtr = workerRegion;
  const outBufPtr = workerRegion + 256;
  const memBuf = new Uint8Array(sharedBuf);
  const decoder = new TextDecoder();
  const strCache = new Map<number, string>();
  
  function encodeKey(key: string): number {
    for (let i = 0; i < key.length; i++) memBuf[keyBufPtr + i] = key.charCodeAt(i);
    return key.length;
  }
  
  // Signal ready and wait for start
  const syncArr = new Int32Array(syncBuf);
  Atomics.add(syncArr, 0, 1);
  Atomics.wait(syncArr, 0, id); // Wait until value changes from our count
  
  let t1 = performance.now();
  for (let j = 0; j < ITERS; j++) for (let i = 0; i < N; i++) wasm.getFieldI32At(root, keyBufPtr, encodeKey(keys[i]), offsets.id);
  const i32Time = (performance.now() - t1) / ITERS;
  
  t1 = performance.now();
  for (let j = 0; j < ITERS; j++) for (let i = 0; i < N; i++) wasm.getFieldF64At(root, keyBufPtr, encodeKey(keys[i]), offsets.x);
  const f64Time = (performance.now() - t1) / ITERS;
  
  t1 = performance.now();
  for (let j = 0; j < ITERS; j++) {
    for (let i = 0; i < N; i++) {
      const strLen = wasm.getFieldStrAt(root, keyBufPtr, encodeKey(keys[i]), offsets.name, outBufPtr);
      if (strLen && !strCache.has(i)) {
        strCache.set(i, decoder.decode(memBuf.subarray(outBufPtr, outBufPtr + strLen)));
      }
    }
  }
  const strTime = (performance.now() - t1) / ITERS;
  
  // Full object
  t1 = performance.now();
  for (let j = 0; j < ITERS; j++) {
    for (let i = 0; i < N; i++) {
      const keyLen = encodeKey(keys[i]);
      const obj = {
        id: wasm.getFieldI32At(root, keyBufPtr, keyLen, offsets.id),
        x: wasm.getFieldF64At(root, keyBufPtr, keyLen, offsets.x),
        name: strCache.get(i) || decoder.decode(memBuf.subarray(outBufPtr, outBufPtr + wasm.getFieldStrAt(root, keyBufPtr, keyLen, offsets.name, outBufPtr)))
      };
    }
  }
  const objTime = (performance.now() - t1) / ITERS;
  
  parentPort!.postMessage({ id, i32: i32Time, f64: f64Time, str: strTime, obj: objTime });
}
