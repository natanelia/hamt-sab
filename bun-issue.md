# WASM writes to SharedArrayBuffer not visible to workers when sharing WebAssembly.Memory

## What version of Bun is running?

1.3.5

## What platform is your computer?

Linux x64

## What steps can reproduce the bug?

When sharing a `WebAssembly.Memory` (backed by SharedArrayBuffer) between the main thread and a worker, data written by WASM in the main thread is not visible to the worker. Direct JavaScript writes to the same SharedArrayBuffer ARE visible.

**Minimal reproduction:**

```typescript
// repro.ts - Run with: bun repro.ts
import { Worker } from 'worker_threads';
import { readFileSync } from 'fs';

// Create shared WASM memory
const wasmBytes = readFileSync('./your-wasm-module.wasm');
const memory = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true });
const module = new WebAssembly.Module(wasmBytes);
const instance = new WebAssembly.Instance(module, { env: { memory } });
const wasm = instance.exports as any;

// WASM writes data to shared memory
wasm.reset();
const blobBuf = wasm.blobBuf();
const u8 = new Uint8Array(memory.buffer);
new TextEncoder().encodeInto('hello', u8.subarray(blobBuf));
const ptr = wasm.allocBlob(5); // WASM allocates and stores data

// Direct JS write for comparison
u8[0] = 42;

console.log('Main:', new TextDecoder().decode(u8.slice(ptr, ptr + 5))); // "hello"

const worker = new Worker(`
const { workerData, parentPort } = require('worker_threads');
const u8 = new Uint8Array(workerData.memory.buffer);

// JS write IS visible
console.log('JS write visible:', u8[0] === 42); // true

// WASM write is NOT visible
console.log('WASM data:', new TextDecoder().decode(u8.slice(workerData.ptr, workerData.ptr + 5)));
// Expected: "hello"
// Actual: garbage/zeros
`, { eval: true, workerData: { memory, ptr } });
```

## What is the expected behavior?

Worker should see the same data that WASM wrote to the SharedArrayBuffer:
```
Main: hello
JS write visible: true
WASM data: hello
```

## What do you see instead?

Worker sees garbage/uninitialized data for WASM writes, but JS writes are visible:
```
Main: hello
JS write visible: true
WASM data: [garbage characters]
```

## Additional information

- **Node.js works correctly** - the same code produces expected results in Node.js v24.11.1
- Direct JavaScript writes to SharedArrayBuffer ARE visible to workers
- Only WASM writes are not synchronized
- Adding a delay (e.g., `await new Promise(r => setTimeout(r, 100))`) before spawning the worker makes it work, suggesting a memory synchronization/barrier issue
- Using `Atomics.store`/`Atomics.load` as a memory fence does NOT fix the issue

**Workaround:** Copy the buffer data before passing to worker:
```typescript
const bufferCopy = new Uint8Array(memory.buffer).slice();
// Pass bufferCopy instead of memory
```

This defeats the purpose of SharedArrayBuffer for zero-copy sharing between threads.

**Environment:**
- Bun 1.3.5
- Linux x64
- WebAssembly module compiled with AssemblyScript using `--sharedMemory --enable threads`
