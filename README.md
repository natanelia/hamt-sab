# hamt-shared

High-performance immutable data structures (HAMT, Set, Vector) using WebAssembly with SharedArrayBuffer for multi-threaded JavaScript applications.

## Features

- Immutable persistent data structures
- WASM-accelerated operations
- SharedArrayBuffer for cross-worker sharing
- Typed value support: `string`, `number`, `boolean`, `object`
- Reference counting with automatic cleanup via FinalizationRegistry

## Installation

```bash
bun install
bun run build:wasm
```

## Usage

```typescript
import { HAMT, resetBuffer } from './hamt';
import { HAMTSet } from './hamt-set';
import { Vector, resetVector } from './vector';

// HAMT (Map)
const map = new HAMT('string').set('name', 'Alice');
map.get('name'); // 'Alice'

// HAMTSet
const set = new HAMTSet<string>().add('a').add('b');
set.has('a'); // true

// Vector
const vec = new Vector('number').push(1).push(2).push(3);
vec.get(0); // 1
```

## Worker Sharing

All structures use SharedArrayBuffer for cross-worker data sharing. Workers receive a copy of the WASM memory buffer and can read the same data structures.

```typescript
// Main thread
import { HAMT, sharedBuffer } from './hamt';
const hamt = new HAMT('string').set('key', 'value');
worker.postMessage({ buffer: sharedBuffer, root: hamt.root });

// Worker - copies buffer to local WASM instance
new Uint8Array(localMemory.buffer).set(new Uint8Array(sharedBuffer));
```

**Note:** True zero-copy sharing (via `WebAssembly.Memory`) works in Node.js but has a [known bug in Bun](https://github.com/oven-sh/bun/issues/25677).

## Benchmarks

### HAMT (Map) vs Immutable.js Map

```
--- N=1000 (100 iterations) ---
Operation     │ HAMT (ms) │ Imm (ms) │ Ratio
──────────────┼───────────┼──────────┼────────
set          │    0.73   │   0.34   │ 2.15x slower
get          │    0.14   │   0.06   │ 2.35x slower
has          │    0.09   │   0.06   │ 1.40x slower
delete       │    0.01   │   0.003  │ 3.01x slower
iter         │    0.17   │   0.02   │ 9.26x slower
```

### HAMTSet vs Immutable.Set vs Native Set

```
--- N=1000 (100 iterations) ---
Operation     │ HAMT (ms) │ Imm (ms) │ vs Imm         │ Nat (ms) │ vs Native
──────────────┼───────────┼──────────┼────────────────┼──────────┼──────────
add          │    0.83   │   0.31   │ 2.72x slower   │   0.03   │ 29.68x slower
has          │    0.09   │   0.07   │ 1.44x slower   │   0.001  │ 82.45x slower
delete       │    0.01   │   0.002  │ 5.09x slower   │   0.007  │ 1.84x slower
iter         │    0.11   │   0.02   │ 4.92x slower   │   0.009  │ 12.58x slower
```

### Vector vs Immutable.List vs Native Array

```
--- N=1000 (50 iterations) ---
Operation     │ Vec (ms)  │ Imm (ms) │ vs Imm         │ Nat (ms) │ vs Native
──────────────┼───────────┼──────────┼────────────────┼──────────┼──────────
push         │    0.23   │   0.15   │ 1.55x slower   │   0.007  │ 34.91x slower
get          │    0.04   │   0.01   │ 2.64x slower   │   0.002  │ 26.31x slower
set          │    0.01   │   0.001  │ 11.96x slower  │   0.001  │ 15.47x slower
pop          │    0.002  │   0.001  │ 1.84x slower   │   0.001  │ 2.17x slower
iter         │    0.03   │   0.03   │ 1.15x faster   │   0.008  │ 3.19x slower
```

### Key Advantage

HAMT/Vector/Set use SharedArrayBuffer for worker sharing - native structures are mutable and cannot be safely shared across workers.

## API

### HAMT
- `new HAMT<T>(type)` - Create with value type ('string' | 'number' | 'boolean' | 'object')
- `set(key, value)` / `get(key)` / `has(key)` / `delete(key)`
- `setMany(entries)` / `getMany(keys)` / `deleteMany(keys)` - Batch ops
- `forEach(fn)` / `entries()` / `keys()` / `values()` / `size`

### HAMTSet
- `new HAMTSet<T>()` - Create set for string | number
- `add(value)` / `has(value)` / `delete(value)`
- `addMany(values)` / `values()` / `forEach(fn)` / `size`

### Vector
- `new Vector<T>(type)` - Create with value type
- `push(value)` / `pop()` / `get(index)` / `set(index, value)`
- `forEach(fn)` / `toArray()` / `size`

## Scripts

```bash
bun test          # Run tests
bun run bench     # Run benchmarks
bun run build     # Build WASM and bundle
```

## License

MIT
