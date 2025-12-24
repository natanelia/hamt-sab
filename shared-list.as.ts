// Vector Trie implementation - 32-way branching for O(log32 N) access
const BITS: u32 = 5;
const WIDTH: u32 = 32;
const MASK: u32 = 31;

const SCRATCH: u32 = 0;
const BLOB_BUF: u32 = 64;  // Buffer for writing blobs (up to 64KB)
const HEAP_START: u32 = 65600;
let heapEnd: u32 = HEAP_START;
let freeNodes: u32 = 0;  // Free list for nodes
let freeLeaves: u32 = 0; // Free list for leaves

// Node: [refcount:4][children:4*32] = 132 bytes
// Leaf: [refcount:4][values:8*32] = 260 bytes
const NODE_SIZE: u32 = 132;
const LEAF_SIZE: u32 = 260;

function alloc(bytes: u32): u32 {
  const aligned = (bytes + 7) & ~7;
  const ptr = heapEnd;
  heapEnd += aligned;
  const memBytes = <u32>memory.size() << 16;
  if (heapEnd > memBytes) memory.grow(((heapEnd - memBytes) >> 16) + 1);
  return ptr;
}

function allocNode(): u32 {
  let ptr: u32;
  if (freeNodes) {
    ptr = freeNodes;
    freeNodes = load<u32>(ptr + 4); // next pointer stored in first child slot
  } else {
    ptr = alloc(NODE_SIZE);
  }
  memory.fill(ptr, 0, NODE_SIZE);
  store<u32>(ptr, 1); // refcount = 1
  return ptr;
}

function allocLeaf(): u32 {
  let ptr: u32;
  if (freeLeaves) {
    ptr = freeLeaves;
    freeLeaves = load<u32>(ptr + 4);
  } else {
    ptr = alloc(LEAF_SIZE);
  }
  memory.fill(ptr, 0, LEAF_SIZE);
  store<u32>(ptr, 1);
  return ptr;
}

function freeNode(ptr: u32): void {
  store<u32>(ptr + 4, freeNodes);
  freeNodes = ptr;
}

function freeLeaf(ptr: u32): void {
  store<u32>(ptr + 4, freeLeaves);
  freeLeaves = ptr;
}

export function incref(ptr: u32): void {
  if (ptr) store<u32>(ptr, load<u32>(ptr) + 1);
}

export function decref(ptr: u32, isLeaf: bool): void {
  if (!ptr) return;
  const rc = load<u32>(ptr) - 1;
  if (rc == 0) {
    if (isLeaf) {
      freeLeaf(ptr);
    } else {
      // Decref all children first
      for (let i: u32 = 0; i < WIDTH; i++) {
        const child = load<u32>(ptr + 4 + (i << 2));
        if (child) {
          // Check if child is a leaf by looking at its structure
          // For simplicity, we pass depth info through the API
        }
      }
      freeNode(ptr);
    }
  } else {
    store<u32>(ptr, rc);
  }
}

// Recursive decref with depth tracking
function decrefRec(ptr: u32, depth: u32): void {
  if (!ptr) return;
  const rc = load<u32>(ptr) - 1;
  store<u32>(ptr, rc); // Always store decremented refcount
  if (rc == 0) {
    if (depth == 0) {
      freeLeaf(ptr);
    } else {
      for (let i: u32 = 0; i < WIDTH; i++) {
        decrefRec(load<u32>(ptr + 4 + (i << 2)), depth - 1);
      }
      freeNode(ptr);
    }
  }
}

// Get value at index
export function vecGet(root: u32, depth: u32, idx: u32): f64 {
  if (!root) return 0;
  let node = root;
  let shift = depth * BITS;
  while (shift > 0) {
    const childIdx = (idx >> shift) & MASK;
    node = load<u32>(node + 4 + (childIdx << 2));
    if (!node) return 0;
    shift -= BITS;
  }
  return load<f64>(node + 4 + ((idx & MASK) << 3));
}

function vecSetRec(node: u32, shift: u32, idx: u32, val: f64): u32 {
  if (shift == 0) {
    const newLeaf = allocLeaf();
    if (node) memory.copy(newLeaf + 4, node + 4, LEAF_SIZE - 4);
    store<f64>(newLeaf + 4 + ((idx & MASK) << 3), val);
    return newLeaf;
  }
  
  const newNode = allocNode();
  const childIdx = (idx >> shift) & MASK;
  
  if (node) {
    // Copy children and incref them
    for (let i: u32 = 0; i < WIDTH; i++) {
      const c = load<u32>(node + 4 + (i << 2));
      store<u32>(newNode + 4 + (i << 2), c);
      if (c && i != childIdx) incref(c);
    }
  }
  
  const oldChild = node ? load<u32>(node + 4 + (childIdx << 2)) : 0;
  const newChild = vecSetRec(oldChild, shift - BITS, idx, val);
  store<u32>(newNode + 4 + (childIdx << 2), newChild);
  
  return newNode;
}

export function vecSet(root: u32, depth: u32, idx: u32, val: f64): u32 {
  return vecSetRec(root, depth * BITS, idx, val);
}

export function vecPush(root: u32, depth: u32, size: u32, val: f64): void {
  const idx = size;
  let capacity: u32 = WIDTH;
  for (let i: u32 = 0; i < depth; i++) capacity *= WIDTH;
  
  if (idx >= capacity) {
    const newRoot = allocNode();
    if (root) {
      store<u32>(newRoot + 4, root);
      incref(root);
    }
    const result = vecSetRec(newRoot, (depth + 1) * BITS, idx, val);
    store<u32>(SCRATCH, result);
    store<u32>(SCRATCH + 4, depth + 1);
    store<u32>(SCRATCH + 8, size + 1);
    return;
  }
  
  const newRoot = vecSetRec(root, depth * BITS, idx, val);
  store<u32>(SCRATCH, newRoot);
  store<u32>(SCRATCH + 4, depth);
  store<u32>(SCRATCH + 8, size + 1);
}

export function vecPop(root: u32, depth: u32, size: u32): void {
  if (size == 0) {
    store<u32>(SCRATCH, 0);
    store<u32>(SCRATCH + 4, 0);
    store<u32>(SCRATCH + 8, 0);
    return;
  }
  const newSize = size - 1;
  if (depth > 0 && newSize > 0 && newSize <= (1 << (depth * BITS))) {
    const newRoot = load<u32>(root + 4);
    incref(newRoot);
    store<u32>(SCRATCH, newRoot);
    store<u32>(SCRATCH + 4, depth - 1);
    store<u32>(SCRATCH + 8, newSize);
    return;
  }
  store<u32>(SCRATCH, root);
  incref(root);
  store<u32>(SCRATCH + 4, depth);
  store<u32>(SCRATCH + 8, newSize);
}

// Decref a root with known depth
export function vecDecref(root: u32, depth: u32): void {
  decrefRec(root, depth);
}

export function scratch(): u32 { return SCRATCH; }
export function blobBuf(): u32 { return BLOB_BUF; }

// Allocate blob and return ptr (len is known by caller)
export function allocBlob(len: u32): u32 {
  const aligned = (len + 7) & ~7;
  const ptr = heapEnd;
  heapEnd += aligned;
  const memBytes = <u32>memory.size() << 16;
  if (heapEnd > memBytes) memory.grow(((heapEnd - memBytes) >> 16) + 1);
  memory.copy(ptr, BLOB_BUF, len);
  return ptr;
}

export function reset(): void { 
  heapEnd = HEAP_START; 
  freeNodes = 0;
  freeLeaves = 0;
}

export function heapUsed(): u32 { return heapEnd; }

// For worker sync - get/set allocator state
export function getHeapEnd(): u32 { return heapEnd; }
export function setHeapEnd(v: u32): void { heapEnd = v; }
export function getFreeNodes(): u32 { return freeNodes; }
export function setFreeNodes(v: u32): void { freeNodes = v; }
export function getFreeLeaves(): u32 { return freeLeaves; }
export function setFreeLeaves(v: u32): void { freeLeaves = v; }
