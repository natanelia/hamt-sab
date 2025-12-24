import { describe, test, expect } from 'bun:test';
import { Worker } from 'worker_threads';
import { HAMT, sharedBuffer, resetBuffer } from './hamt';
import { Vector, sharedBuffer as vectorBuffer, sharedMemory, resetVector, getAllocState, getBufferCopy } from './vector';

const isBun = typeof Bun !== 'undefined';

const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { readFileSync } = require('fs');

const { sharedBuf, root, keys, workerId } = workerData;
const wasmBytes = readFileSync('./hamt-wasm.wasm');
const wasmModule = new WebAssembly.Module(wasmBytes);
const memory = new WebAssembly.Memory({ initial: 16, maximum: 65536, shared: true });

// Copy shared buffer content to our memory
new Uint8Array(memory.buffer).set(new Uint8Array(sharedBuf));

const wasm = new WebAssembly.Instance(wasmModule, { env: { memory, abort: () => {} } }).exports;
const keyBufPtr = wasm.keyBuf();
const batchBufPtr = wasm.batchBuf();
const memBuf = new Uint8Array(memory.buffer);
const memDv = new DataView(memory.buffer);

function encodeKey(key) {
  for (let i = 0; i < key.length; i++) memBuf[keyBufPtr + i] = key.charCodeAt(i);
  return key.length;
}

function get(root, key) {
  const keyLen = encodeKey(key);
  if (!wasm.getInfo(root, keyLen)) return undefined;
  const kLen = memDv.getUint32(batchBufPtr, true);
  const vLen = memDv.getUint32(batchBufPtr + 4, true);
  const keyPtr = memDv.getUint32(batchBufPtr + 8, true);
  return new TextDecoder().decode(memBuf.subarray(keyPtr + kLen, keyPtr + kLen + vLen));
}

const results = keys.map(key => ({ key, value: get(root, key) }));
parentPort.postMessage({ workerId, results });
`;

describe('HAMT Multi-Worker Tests', () => {
  test('concurrent reads from multiple workers', async () => {
    resetBuffer();
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const values = ['v1', 'v2', 'v3', 'v4', 'v5'];
    
    let hamt = new HAMT('string');
    for (let i = 0; i < keys.length; i++) {
      hamt = hamt.set(keys[i], values[i]);
    }
    
    const root = (hamt as any).root;
    const NUM_WORKERS = 4;
    
    const workers = Array.from({ length: NUM_WORKERS }, (_, i) => 
      new Worker(workerCode, {
        eval: true,
        workerData: { sharedBuf: sharedBuffer, root, keys, workerId: i }
      })
    );
    
    const results = await Promise.all(workers.map(w => new Promise<any>((resolve, reject) => {
      w.on('message', resolve);
      w.on('error', reject);
    })));
    
    for (const { results: workerResults } of results) {
      expect(workerResults.length).toBe(keys.length);
      for (let i = 0; i < keys.length; i++) {
        expect(workerResults[i].value).toBe(values[i]);
      }
    }
  });

  test('workers handle missing keys', async () => {
    resetBuffer();
    const hamt = new HAMT('string').set('a', 'exists');
    const root = (hamt as any).root;
    
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { sharedBuf: sharedBuffer, root, keys: ['a', 'missing'], workerId: 0 }
    });
    
    const { results } = await new Promise<any>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results[0].value).toBe('exists');
    expect(results[1].value).toBeUndefined();
  });

  test('stress test - 8 workers, 100 keys', async () => {
    resetBuffer();
    const N = 100;
    const keys = Array.from({ length: N }, (_, i) => `key${i}`);
    const values = Array.from({ length: N }, (_, i) => `value${i}`);
    
    let hamt = new HAMT('string');
    for (let i = 0; i < N; i++) hamt = hamt.set(keys[i], values[i]);
    
    const root = (hamt as any).root;
    const NUM_WORKERS = 8;
    
    const workers = Array.from({ length: NUM_WORKERS }, (_, i) => 
      new Worker(workerCode, {
        eval: true,
        workerData: { sharedBuf: sharedBuffer, root, keys, workerId: i }
      })
    );
    
    const results = await Promise.all(workers.map(w => new Promise<any>((resolve, reject) => {
      w.on('message', resolve);
      w.on('error', reject);
    })));
    
    for (const { results: workerResults } of results) {
      for (let i = 0; i < N; i++) {
        expect(workerResults[i].value).toBe(values[i]);
      }
    }
  });

  test('empty HAMT', async () => {
    resetBuffer();
    const hamt = new HAMT('string');
    const root = (hamt as any).root;
    
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { sharedBuf: sharedBuffer, root, keys: ['a', 'b'], workerId: 0 }
    });
    
    const { results } = await new Promise<any>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results.every((r: any) => r.value === undefined)).toBe(true);
  });

  test('10 workers same key simultaneously', async () => {
    resetBuffer();
    const hamt = new HAMT('string').set('shared', 'value');
    const root = (hamt as any).root;
    
    const workers = Array.from({ length: 10 }, (_, i) => 
      new Worker(workerCode, {
        eval: true,
        workerData: { sharedBuf: sharedBuffer, root, keys: ['shared'], workerId: i }
      })
    );
    
    const results = await Promise.all(workers.map(w => new Promise<any>((resolve, reject) => {
      w.on('message', resolve);
      w.on('error', reject);
    })));
    
    for (const { results: workerResults } of results) {
      expect(workerResults[0].value).toBe('value');
    }
  });

  test('unicode keys and values', async () => {
    resetBuffer();
    let hamt = new HAMT('string')
      .set('日本語', '値')
      .set('émoji', '🎉🚀')
      .set('Ключ', 'Значение');
    
    const root = (hamt as any).root;
    
    const unicodeWorkerCode = `
const { parentPort, workerData } = require('worker_threads');
const { readFileSync } = require('fs');

const { sharedBuf, root, keys } = workerData;
const wasmBytes = readFileSync('./hamt-wasm.wasm');
const wasmModule = new WebAssembly.Module(wasmBytes);
const memory = new WebAssembly.Memory({ initial: 16, maximum: 65536, shared: true });
new Uint8Array(memory.buffer).set(new Uint8Array(sharedBuf));

const wasm = new WebAssembly.Instance(wasmModule, { env: { memory, abort: () => {} } }).exports;
const keyBufPtr = wasm.keyBuf();
const batchBufPtr = wasm.batchBuf();
const memBuf = new Uint8Array(memory.buffer);
const memDv = new DataView(memory.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function get(root, key) {
  const keyEnc = encoder.encode(key);
  memBuf.set(keyEnc, keyBufPtr);
  if (!wasm.getInfo(root, keyEnc.length)) return undefined;
  const kLen = memDv.getUint32(batchBufPtr, true);
  const vLen = memDv.getUint32(batchBufPtr + 4, true);
  const keyPtr = memDv.getUint32(batchBufPtr + 8, true);
  return decoder.decode(memBuf.subarray(keyPtr + kLen, keyPtr + kLen + vLen));
}

parentPort.postMessage(keys.map(k => get(root, k)));
`;
    
    const worker = new Worker(unicodeWorkerCode, {
      eval: true,
      workerData: { sharedBuf: sharedBuffer, root, keys: ['日本語', 'émoji', 'Ключ'] }
    });
    
    const results = await new Promise<string[]>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results[0]).toBe('値');
    expect(results[1]).toBe('🎉🚀');
    expect(results[2]).toBe('Значение');
  });
});


describe('Vector Multi-Worker Tests', () => {
  // Worker code for buffer copy approach (Bun)
  const vectorWorkerCodeCopy = `
const { parentPort, workerData } = require('worker_threads');
const { attachToBufferCopy, Vector } = require('./vector.ts');

attachToBufferCopy(workerData.bufferCopy, workerData.allocState);
const vec = Vector.fromWorkerData(workerData.vecData);
const results = workerData.indices.map(i => vec.get(i));
parentPort.postMessage(results);
`;

  // Worker code for zero-copy approach (Node.js)
  const vectorWorkerCodeZeroCopy = `
const { parentPort, workerData } = require('worker_threads');
const { attachToMemory, Vector } = require('./vector.ts');

attachToMemory(workerData.memory, workerData.allocState);
const vec = Vector.fromWorkerData(workerData.vecData);
const results = workerData.indices.map(i => vec.get(i));
parentPort.postMessage(results);
`;

  function createVectorWorker(vec: Vector<any>, indices: number[]) {
    const allocState = getAllocState();
    const vecData = vec.toWorkerData();
    
    if (isBun) {
      return new Worker(vectorWorkerCodeCopy, {
        eval: true,
        workerData: { bufferCopy: getBufferCopy(), allocState, vecData, indices }
      });
    } else {
      return new Worker(vectorWorkerCodeZeroCopy, {
        eval: true,
        workerData: { memory: sharedMemory, allocState, vecData, indices }
      });
    }
  }

  test('Vector<number> shared across workers', async () => {
    resetBuffer();
    resetVector();
    
    let v = new Vector('number');
    for (let i = 0; i < 100; i++) v = v.push(i * 10);
    
    const worker = createVectorWorker(v, [0, 50, 99]);
    
    const results = await new Promise<number[]>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results).toEqual([0, 500, 990]);
  });

  test('Vector<string> shared across workers', async () => {
    resetBuffer();
    resetVector();
    
    let v = new Vector('string');
    v = v.push('hello').push('world').push('test');
    
    const worker = createVectorWorker(v, [0, 1, 2]);
    
    const results = await new Promise<string[]>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results).toEqual(['hello', 'world', 'test']);
  });

  test('Vector<object> shared across workers', async () => {
    resetBuffer();
    resetVector();
    
    let v = new Vector('object');
    v = v.push({ x: 1 }).push({ y: 2, z: [1, 2, 3] });
    
    const worker = createVectorWorker(v, [0, 1]);
    
    const results = await new Promise<object[]>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results).toEqual([{ x: 1 }, { y: 2, z: [1, 2, 3] }]);
  });
});

describe('HAMTSet Multi-Worker Tests', () => {
  test('HAMTSet shared across workers', async () => {
    resetBuffer();
    const { HAMTSet } = await import('./hamt-set');
    
    let s = new HAMTSet<string>();
    s = s.addMany(['apple', 'banana', 'cherry']);
    
    // HAMTSet wraps HAMT, so we can use the same worker code as HAMT
    const setWorkerCode = `
const { parentPort, workerData } = require('worker_threads');
const { readFileSync } = require('fs');

const { sharedBuf, root, keys } = workerData;
const wasmBytes = readFileSync('./hamt-wasm.wasm');
const wasmModule = new WebAssembly.Module(wasmBytes);
const memory = new WebAssembly.Memory({ initial: 16, maximum: 65536, shared: true });
new Uint8Array(memory.buffer).set(new Uint8Array(sharedBuf));

const wasm = new WebAssembly.Instance(wasmModule, { env: { memory, abort: () => {} } }).exports;
const keyBufPtr = wasm.keyBuf();
const batchBufPtr = wasm.batchBuf();
const memBuf = new Uint8Array(memory.buffer);
const encoder = new TextEncoder();

function has(root, key) {
  const keyEnc = encoder.encode(key);
  memBuf.set(keyEnc, keyBufPtr);
  return wasm.getInfo(root, keyEnc.length) !== 0;
}

parentPort.postMessage(keys.map(k => has(root, k)));
`;
    
    const worker = new Worker(setWorkerCode, {
      eval: true,
      workerData: { 
        sharedBuf: sharedBuffer, 
        root: (s as any)._map['root'],
        keys: ['apple', 'banana', 'missing', 'cherry']
      }
    });
    
    const results = await new Promise<boolean[]>((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    
    expect(results).toEqual([true, true, false, true]);
  });
});
