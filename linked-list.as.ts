// Shared linked list WASM - supports both Stack (LIFO) and Queue (FIFO)
const SCRATCH: u32 = 0;
const BLOB_BUF: u32 = 64;
const HEAP_START: u32 = 65600;
let heapEnd: u32 = HEAP_START;
let freeList: u32 = 0;

// Node: [next:4][value:8] = 12 bytes (aligned to 16)
const NODE_SIZE: u32 = 16;

function allocNode(): u32 {
  if (freeList) {
    const ptr = freeList;
    freeList = load<u32>(ptr);
    return ptr;
  }
  const ptr = heapEnd;
  heapEnd += NODE_SIZE;
  const memBytes = <u32>memory.size() << 16;
  if (heapEnd > memBytes) memory.grow(((heapEnd - memBytes) >> 16) + 1);
  return ptr;
}

// Stack: push to head, pop from head (LIFO)
export function push(head: u32, val: f64): u32 {
  const node = allocNode();
  store<u32>(node, head);
  store<f64>(node + 4, val);
  return node;
}

export function pop(head: u32): u32 {
  return head ? load<u32>(head) : 0;
}

// Queue: enqueue to tail, dequeue from head (FIFO)
export function enqueue(tail: u32, val: f64): u32 {
  const node = allocNode();
  store<u32>(node, 0);
  store<f64>(node + 4, val);
  if (tail) store<u32>(tail, node);
  return node;
}

export function dequeue(head: u32): u32 {
  return head ? load<u32>(head) : 0;
}

// Shared peek (works for both stack head and queue head)
export function peek(head: u32): f64 {
  return head ? load<f64>(head + 4) : 0;
}

// Blob variants for strings/objects
export function pushBlob(head: u32, blobPtr: u32): u32 {
  const node = allocNode();
  store<u32>(node, head);
  store<u32>(node + 4, blobPtr);
  return node;
}

export function enqueueBlob(tail: u32, blobPtr: u32): u32 {
  const node = allocNode();
  store<u32>(node, 0);
  store<u32>(node + 4, blobPtr);
  if (tail) store<u32>(tail, node);
  return node;
}

export function peekBlob(head: u32): u32 {
  return head ? load<u32>(head + 4) : 0;
}

export function allocBlob(len: u32): u32 {
  const aligned = (len + 7) & ~7;
  const ptr = heapEnd;
  heapEnd += aligned;
  const memBytes = <u32>memory.size() << 16;
  if (heapEnd > memBytes) memory.grow(((heapEnd - memBytes) >> 16) + 1);
  memory.copy(ptr, BLOB_BUF, len);
  return ptr;
}

export function scratch(): u32 { return SCRATCH; }
export function blobBuf(): u32 { return BLOB_BUF; }
export function reset(): void { heapEnd = HEAP_START; freeList = 0; }
export function getHeapEnd(): u32 { return heapEnd; }
export function setHeapEnd(v: u32): void { heapEnd = v; }
export function getFreeList(): u32 { return freeList; }
export function setFreeList(v: u32): void { freeList = v; }
