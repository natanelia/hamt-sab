# shared-immutable

High-performance immutable data structures using WebAssembly with SharedArrayBuffer for multi-threaded JavaScript applications.

## Features

- Immutable persistent data structures (Map, Set, List, Stack, Queue)
- WASM-accelerated operations via AssemblyScript
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
import { SharedMap, SharedSet, SharedList, SharedStack, SharedQueue } from './shared';

// SharedMap - O(log32 n) operations
const map = new SharedMap('string').set('name', 'Alice');
map.get('name'); // 'Alice'

// SharedSet - O(log32 n) operations
const set = new SharedSet<string>().add('a').add('b');
set.has('a'); // true

// SharedList - O(log32 n) random access
const list = new SharedList('number').push(1).push(2).push(3);
list.get(0); // 1

// SharedStack - O(1) LIFO operations
const stack = new SharedStack('number').push(1).push(2);
stack.peek(); // 2

// SharedQueue - O(1) FIFO operations
const queue = new SharedQueue('string').enqueue('first').enqueue('second');
queue.peek(); // 'first'
```

## Worker Sharing

### Seamless API (Recommended)

Use `getWorkerData()` and `initWorker()` for easy cross-worker sharing:

```typescript
// Main thread
import { SharedMap, SharedList, getWorkerData } from './shared';

const map = new SharedMap('string').set('key', 'value');
const list = new SharedList('number').push(1).push(2);

worker.postMessage(getWorkerData({ map, list }));

// Worker
import { initWorker, SharedMap, SharedList } from './shared';

const { map, list } = await initWorker<{
  map: SharedMap<'string'>;
  list: SharedList<'number'>;
}>(workerData);

map.get('key');  // 'value'
list.get(0);     // 1
```

## API

### SharedMap<T>
- `new SharedMap<T>(type)` - Create with value type ('string' | 'number' | 'boolean' | 'object')
- `set(key, value)` / `get(key)` / `has(key)` / `delete(key)`
- `setMany(entries)` / `getMany(keys)` / `deleteMany(keys)` - Batch ops
- `forEach(fn)` / `entries()` / `keys()` / `values()` / `size`

### SharedSet<T>
- `new SharedSet<T>()` - Create set for string | number
- `add(value)` / `has(value)` / `delete(value)`
- `addMany(values)` / `values()` / `forEach(fn)` / `size`

### SharedList<T>
- `new SharedList<T>(type)` - Create with value type
- `push(value)` / `pop()` / `get(index)` / `set(index, value)`
- `forEach(fn)` / `toArray()` / `size`

### SharedStack<T>
- `new SharedStack<T>(type)` - O(1) LIFO stack
- `push(value)` / `pop()` / `peek()` / `size` / `isEmpty`

### SharedQueue<T>
- `new SharedQueue<T>(type)` - O(1) FIFO queue
- `enqueue(value)` / `dequeue()` / `peek()` / `size` / `isEmpty`

## Architecture

```
shared-immutable/
├── shared.ts           # Unified API with worker support
├── shared-map.ts       # HAMT-based Map implementation
├── shared-set.ts       # Set (wraps SharedMap)
├── shared-list.ts      # Vector trie List implementation
├── shared-stack.ts     # Linked list Stack
├── shared-queue.ts     # Linked list Queue
├── types.ts            # Shared type definitions
├── codec.ts            # Value encoding/decoding
├── wasm-utils.ts       # WASM loading utilities
├── shared-map.as.ts    # WASM: HAMT implementation
├── shared-list.as.ts   # WASM: Vector trie implementation
├── linked-list.as.ts   # WASM: Linked list for Stack/Queue
└── *.wasm              # Compiled WASM modules
```

## Scripts

```bash
bun test          # Run tests (118 tests)
bun run bench     # Run benchmarks
bun run build:wasm # Build WASM modules
```

## Performance

Key characteristics:
- **SharedMap/Set**: O(log32 n) for all operations
- **SharedList**: O(log32 n) random access, O(1) amortized push
- **SharedStack**: O(1) push/pop/peek
- **SharedQueue**: O(1) enqueue/dequeue/peek (vs O(n) for Array.shift)

The main advantage is **cross-worker sharing** via SharedArrayBuffer - native structures cannot be safely shared.

### Benchmark Results (N=10000)

**SharedMap vs Immutable.Map vs Native Map**
| Operation | Shared | Immutable | vs Imm | Native | vs Native |
|-----------|--------|-----------|--------|--------|-----------|
| set | 5.5ms | 4.1ms | 1.3x slower | 0.9ms | 6x slower |
| get | 2.2ms | 1.0ms | 2.3x slower | 0.02ms | 147x slower |
| has | 0.8ms | 1.1ms | 1.4x faster | 0.02ms | 46x slower |
| delete | 0.006ms | 0.006ms | ~same | 0.8ms | 130x faster |
| setMany(100) | 0.06ms | 0.05ms | ~same | 0.2ms | 3.6x faster |

**SharedList vs Immutable.List vs Native Array**
| Operation | Shared | Immutable | vs Imm | Native | vs Native |
|-----------|--------|-----------|--------|--------|-----------|
| push | 2.0ms | 3.2ms | 1.6x faster | 0.08ms | 27x slower |
| get | 0.13ms | 0.07ms | 1.9x slower | 0.01ms | 13x slower |
| pop | 0.0007ms | 0.002ms | 3x faster | 0.02ms | 29x faster |
| forEach | 0.2ms | 0.3ms | 1.5x faster | 0.1ms | 2x slower |

**SharedStack vs Immutable.Stack vs Native Array**
| Operation | Shared | Immutable | vs Imm | Native | vs Native |
|-----------|--------|-----------|--------|--------|-----------|
| push | 0.18ms | 0.14ms | 1.3x slower | 0.04ms | 5x slower |
| peek | 0.015ms | 0.028ms | 1.9x faster | 0.009ms | 1.6x slower |
| pop | 0.0003ms | 0.0003ms | ~same | 0.02ms | 73x faster |

**SharedQueue vs Native Array** (no Immutable.Queue)
| Operation | Shared | Native | vs Native |
|-----------|--------|--------|-----------|
| enqueue | 0.19ms | 0.03ms | 7x slower |
| peek | 0.015ms | 0.009ms | 1.6x slower |
| dequeue | 0.0004ms | 0.15ms | 375x faster |
| enq+deq(100) | 0.007ms | 0.24ms | 32x faster |

> Note: Native Array.shift() is O(n), making SharedQueue dramatically faster for dequeue operations.

## License

MIT
