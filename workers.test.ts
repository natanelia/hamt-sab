import { describe, test, expect } from 'bun:test';
import { Worker } from 'worker_threads';
import { HAMT, sharedBuffer, resetBuffer } from './hamt';

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
