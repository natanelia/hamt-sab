# hamt-shared

A high-performance, immutable HAMT (Hash Array Mapped Trie) implementation using WebAssembly with SharedArrayBuffer support for multi-threaded JavaScript applications.

## Features

- Immutable persistent data structure
- WASM-accelerated operations
- SharedArrayBuffer for cross-worker sharing
- Typed value support: `string`, `number`, `boolean`, `object`
- Transient mode for efficient bulk operations (like Immutable.js withMutations)
- Reference counting with automatic cleanup via FinalizationRegistry

## Installation

```bash
bun install
bun run build:wasm
```

## Usage

```typescript
import { HAMT, resetBuffer } from './hamt';

// Create typed HAMTs
const strings = new HAMT('string').set('name', 'Alice');
const numbers = new HAMT('number').set('count', 42);

// Immutable updates
const h1 = new HAMT('string').set('a', '1');
const h2 = h1.set('b', '2');  // h1 unchanged

// Batch operations
const h3 = new HAMT('string').setMany([['x', '1'], ['y', '2']]);
const values = h3.getMany(['x', 'y']);

// Iteration
h3.forEach((v, k) => console.log(k, v));

// Reset buffer between independent operations
resetBuffer();
```

## API

- `new HAMT<T>(type)` - Create HAMT with value type
- `set(key, value)` - Returns new HAMT with key set
- `get(key)` - Get value or undefined
- `has(key)` - Check key existence
- `delete(key)` - Returns new HAMT without key
- `setMany(entries)` / `getMany(keys)` / `deleteMany(keys)` - Batch ops
- `forEach(fn)` / `entries()` / `keys()` / `values()` - Iteration
- `size` - Entry count
- `resetBuffer()` - Clear WASM memory

## Scripts

```bash
bun test          # Run tests
bun run bench     # Run benchmarks
bun run build     # Build WASM and bundle
```

## License

MIT
