// Reproduction: WASM writes to SharedArrayBuffer not visible to workers in Bun
//
// Run: bun repro-wasm-sab.ts
// Compare: node --experimental-strip-types repro-wasm-sab.ts

import { Worker } from 'worker_threads';
import { Vector, sharedMemory, resetVector, getAllocState } from './vector.ts';

resetVector();
const vec = new Vector('string').push('hello').push('world');
const allocState = getAllocState();
const vecData = vec.toWorkerData();

console.log('Main thread:', vec.get(0), vec.get(1));

// Worker attaches to the same memory
const workerCode = `
const { workerData, parentPort } = require('worker_threads');
const { attachToMemory, Vector } = require('./vector.ts');

attachToMemory(workerData.memory, workerData.allocState);
const vec = Vector.fromWorkerData(workerData.vecData);
parentPort.postMessage([vec.get(0), vec.get(1)]);
`;

const worker = new Worker(workerCode, { 
  eval: true, 
  workerData: { memory: sharedMemory, allocState, vecData } 
});

worker.on('message', (results: string[]) => {
  console.log('Worker thread:', results[0], results[1]);
  if (results[0] !== 'hello' || results[1] !== 'world') {
    console.log('');
    console.log('BUG DETECTED!');
    console.log('Expected: hello world');
    console.log('Got:', results[0], results[1]);
    console.log('');
    console.log('WASM writes to SharedArrayBuffer are not visible to workers in Bun.');
    console.log('This works correctly in Node.js.');
  }
});

worker.on('error', (err) => console.error('Worker error:', err));
