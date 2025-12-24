// HAMT implementation in AssemblyScript
const BITS: u32 = 5;
const MASK: u32 = 31;
const BLOCK_HDR: u32 = 8;
const MIN_BLOCK: u32 = 16;

// Memory layout: 0-1023 keyBuf, 1024-65535 batchBuf, 65536-69631 stack, 69632-73727 roots, 73728+ heap
const KEY_BUF: u32 = 0;
const BATCH_BUF: u32 = 1024;
const STACK_BASE: u32 = 65536;
const HEAP_START: u32 = 73728;

let heapEnd: u32 = HEAP_START;
let freeList: u32 = 0;
let usedBytes: u32 = 0;
let stackPtr: u32 = 0;
let transientId: u32 = 0; // Non-zero during transient operations

// Live roots tracking for GC
const MAX_ROOTS: u32 = 1024;
const ROOTS_BASE: u32 = 69632;
let numRoots: u32 = 0;

// Register a root, returns slot index (takes ownership, no incref)
export function registerRoot(ptr: u32): u32 {
  if (numRoots >= MAX_ROOTS) return 0xFFFFFFFF;
  const slot = numRoots++;
  store<u32>(ROOTS_BASE + (slot << 2), ptr);
  return slot;
}

// Update root at slot (decrefs old, takes ownership of new)
export function updateRoot(slot: u32, ptr: u32): void {
  if (slot >= numRoots) return;
  const old = load<u32>(ROOTS_BASE + (slot << 2));
  if (old) decref(old);
  store<u32>(ROOTS_BASE + (slot << 2), ptr);
}

// Unregister root (decrefs and clears)
export function unregisterRoot(slot: u32): void {
  if (slot >= numRoots) return;
  const ptr = load<u32>(ROOTS_BASE + (slot << 2));
  if (ptr) decref(ptr);
  store<u32>(ROOTS_BASE + (slot << 2), 0);
}

// Popcount - native WASM instruction
function pc(n: u32): u32 {
  return <u32>popcnt(n);
}

// Get/set node owner (stored in high byte of refcount - limits rc to 16M)
function getOwner(ptr: u32): u32 { return load<u32>(ptr) >> 24; }
function setOwner(ptr: u32, owner: u32): void {
  const rc = load<u32>(ptr) & 0xFFFFFF;
  store<u32>(ptr, rc | (owner << 24));
}

// FNV-1a hash
function hash(len: u32): u32 {
  let h: u32 = 2166136261;
  for (let i: u32 = 0; i < len; i++) h = (h ^ load<u8>(KEY_BUF + i)) * 16777619;
  return h;
}

// Compare key in keyBuf with memory at ptr
function keycmp(ptr: u32, len: u32): bool {
  return memory.compare(KEY_BUF, ptr, len) == 0;
}

// Compare two memory regions
function keycmp2(p1: u32, p2: u32, len: u32): bool {
  return memory.compare(p1, p2, len) == 0;
}

// First-fit allocator with coalescing (faster than best-fit for this workload)
function alloc(bytes: u32): u32 {
  let need = ((bytes + BLOCK_HDR + 7) & ~7);
  if (need < MIN_BLOCK) need = MIN_BLOCK;
  
  let prev: u32 = 0, curr = freeList;
  
  while (curr) {
    const csize = load<u32>(curr);
    if (csize >= need) {
      // First fit - take it immediately
      if (prev) store<u32>(prev + 4, load<u32>(curr + 4));
      else freeList = load<u32>(curr + 4);
      
      if (csize - need >= MIN_BLOCK) {
        const split = curr + need;
        store<u32>(split, csize - need);
        store<u32>(split + 4, freeList);
        freeList = split;
        store<u32>(curr, need);
      } else {
        need = csize;
      }
      usedBytes += need;
      return curr + BLOCK_HDR;
    }
    prev = curr;
    curr = load<u32>(curr + 4);
  }
  
  const ptr = heapEnd;
  const newEnd = ptr + need;
  const memBytes = <u32>memory.size() << 16;
  if (newEnd > memBytes) {
    memory.grow(((newEnd - memBytes) >> 16) + 1);
  }
  heapEnd = newEnd;
  store<u32>(ptr, need);
  usedBytes += need;
  return ptr + BLOCK_HDR;
}

function free(ptr: u32): void {
  if (!ptr) return;
  const block = ptr - BLOCK_HDR;
  const bsize = load<u32>(block);
  usedBytes -= bsize;
  
  let prev: u32 = 0, curr = freeList;
  while (curr && curr < block) {
    prev = curr;
    curr = load<u32>(curr + 4);
  }
  
  // Coalesce with previous
  if (prev && prev + load<u32>(prev) == block) {
    store<u32>(prev, load<u32>(prev) + bsize);
    // Coalesce with next
    if (curr && prev + load<u32>(prev) == curr) {
      store<u32>(prev, load<u32>(prev) + load<u32>(curr));
      store<u32>(prev + 4, load<u32>(curr + 4));
    }
    return;
  }
  
  // Coalesce with next only
  if (curr && block + bsize == curr) {
    store<u32>(block, bsize + load<u32>(curr));
    store<u32>(block + 4, load<u32>(curr + 4));
  } else {
    store<u32>(block + 4, curr);
  }
  
  if (prev) store<u32>(prev + 4, block);
  else freeList = block;
}

// Refcounting (low 24 bits = refcount, high 8 bits = owner)
export function incref(ptr: u32): void {
  if (ptr) {
    const v = load<u32>(ptr);
    store<u32>(ptr, (v & 0xFF000000) | ((v & 0xFFFFFF) + 1));
  }
}

export function decref(ptr: u32): void {
  if (!ptr) return;
  const v = load<u32>(ptr);
  const rc = (v & 0xFFFFFF) - 1;
  store<u32>(ptr, (v & 0xFF000000) | rc);
  if (rc == 0) {
    const bm = load<u32>(ptr + 4);
    if (bm) {
      const cnt = pc(bm);
      for (let i: u32 = 0; i < cnt; i++) {
        decref(load<u32>(ptr + 8 + (i << 2)));
      }
    }
    free(ptr);
  }
}

// Leaf: [rc:4][0:4][hash:4][keyLen:4][valLen:4][key...][val...]
function allocLeafInternal(keyHash: u32, keyLen: u32, valLen: u32): u32 {
  const ptr = alloc(20 + keyLen + valLen);
  store<u32>(ptr, 1);      // refcount
  store<u32>(ptr + 4, 0);  // bitmap=0 means leaf
  store<u32>(ptr + 8, keyHash);
  store<u32>(ptr + 12, keyLen);
  store<u32>(ptr + 16, valLen);
  return ptr;
}

// Node: [rc:4][bm:4][children...]
function allocNode(bm: u32, cnt: u32): u32 {
  const ptr = alloc(8 + (cnt << 2));
  store<u32>(ptr, 1);
  store<u32>(ptr + 4, bm);
  return ptr;
}

export function leafKeyPtr(ptr: u32): u32 { return ptr + 20; }
export function leafKeyLen(ptr: u32): u32 { return load<u32>(ptr + 12); }
export function leafValLen(ptr: u32): u32 { return load<u32>(ptr + 16); }

// Get leaf info in one call: writes [keyLen, valLen, keyPtr] to BATCH_BUF, returns ptr (0 if not found)
export function getInfo(root: u32, keyLen: u32): u32 {
  const ptr = getInternal(root, hash(keyLen), keyLen, 0);
  if (ptr) {
    store<u32>(BATCH_BUF, load<u32>(ptr + 12));     // keyLen
    store<u32>(BATCH_BUF + 4, load<u32>(ptr + 16)); // valLen
    store<u32>(BATCH_BUF + 8, ptr + 20);            // keyPtr
  }
  return ptr;
}

function merge(l1: u32, h1: u32, l2: u32, h2: u32, shift: u32): u32 {
  if (shift >= 32) {
    const ptr = allocNode(0, 2);
    store<u32>(ptr + 8, l1);
    store<u32>(ptr + 12, l2);
    incref(l1); incref(l2);
    return ptr;
  }
  const i1 = (h1 >> shift) & MASK;
  const i2 = (h2 >> shift) & MASK;
  if (i1 == i2) {
    const child = merge(l1, h1, l2, h2, shift + BITS);
    const ptr = allocNode(1 << i1, 1);
    store<u32>(ptr + 8, child);
    return ptr;
  }
  const ptr = allocNode((1 << i1) | (1 << i2), 2);
  incref(l1); incref(l2);
  if (i1 < i2) {
    store<u32>(ptr + 8, l1);
    store<u32>(ptr + 12, l2);
  } else {
    store<u32>(ptr + 8, l2);
    store<u32>(ptr + 12, l1);
  }
  return ptr;
}

function insertInternal(node: u32, leaf: u32, shift: u32): u32 {
  const keyHash = load<u32>(leaf + 8);
  const keyLen = load<u32>(leaf + 12);
  
  if (!node) return leaf;
  
  const bm = load<u32>(node + 4);
  if (!bm) {
    // Leaf node
    if (load<u32>(node + 8) == keyHash && leafKeyLen(node) == keyLen) {
      if (keycmp2(leafKeyPtr(node), leafKeyPtr(leaf), keyLen)) {
        return leaf; // Replace
      }
    }
    return merge(node, load<u32>(node + 8), leaf, keyHash, shift);
  }
  
  const bit: u32 = 1 << ((keyHash >> shift) & MASK);
  const pos = pc(bm & (bit - 1));
  const cnt = pc(bm);
  
  if (bm & bit) {
    const oldChild = load<u32>(node + 8 + (pos << 2));
    const newChild = insertInternal(oldChild, leaf, shift + BITS);
    const ptr = allocNode(bm, cnt);
    for (let j: u32 = 0; j < cnt; j++) {
      const c = load<u32>(node + 8 + (j << 2));
      if (j == pos) {
        store<u32>(ptr + 8 + (j << 2), newChild);
      } else {
        store<u32>(ptr + 8 + (j << 2), c);
        incref(c);
      }
    }
    return ptr;
  }
  
  const ptr = allocNode(bm | bit, cnt + 1);
  for (let j: u32 = 0; j < pos; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    store<u32>(ptr + 8 + (j << 2), c);
    incref(c);
  }
  store<u32>(ptr + 8 + (pos << 2), leaf);
  for (let j = pos; j < cnt; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    store<u32>(ptr + 8 + ((j + 1) << 2), c);
    incref(c);
  }
  return ptr;
}

function removeInternal(node: u32, keyHash: u32, keyLen: u32, shift: u32): u32 {
  if (!node) return 0;
  
  const bm = load<u32>(node + 4);
  if (!bm) {
    if (keycmp(leafKeyPtr(node), keyLen)) return 0;
    incref(node);
    return node;
  }
  
  const bit: u32 = 1 << ((keyHash >> shift) & MASK);
  if (!(bm & bit)) {
    incref(node);
    return node;
  }
  
  const pos = pc(bm & (bit - 1));
  const cnt = pc(bm);
  const child = load<u32>(node + 8 + (pos << 2));
  const newChild = removeInternal(child, keyHash, keyLen, shift + BITS);
  
  if (newChild == child) {
    incref(node);
    return node;
  }
  
  if (!newChild) {
    if (cnt == 1) return 0;
    const ptr = allocNode(bm & ~bit, cnt - 1);
    for (let j: u32 = 0; j < pos; j++) {
      const c = load<u32>(node + 8 + (j << 2));
      store<u32>(ptr + 8 + (j << 2), c);
      incref(c);
    }
    for (let j = pos + 1; j < cnt; j++) {
      const c = load<u32>(node + 8 + (j << 2));
      store<u32>(ptr + 8 + ((j - 1) << 2), c);
      incref(c);
    }
    return ptr;
  }
  
  const ptr = allocNode(bm, cnt);
  for (let j: u32 = 0; j < cnt; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    if (j == pos) {
      store<u32>(ptr + 8 + (j << 2), newChild);
    } else {
      store<u32>(ptr + 8 + (j << 2), c);
      incref(c);
    }
  }
  return ptr;
}

function getInternal(node: u32, keyHash: u32, keyLen: u32, shift: u32): u32 {
  while (node) {
    const bm = load<u32>(node + 4);
    if (!bm) {
      if (load<u32>(node + 8) == keyHash && leafKeyLen(node) == keyLen && keycmp(leafKeyPtr(node), keyLen)) return node;
      return 0;
    }
    const bit: u32 = 1 << ((keyHash >> shift) & MASK);
    if (!(bm & bit)) return 0;
    node = load<u32>(node + 8 + (pc(bm & (bit - 1)) << 2));
    shift += BITS;
  }
  return 0;
}

// Exports
export function allocLeaf(keyLen: u32, valLen: u32): u32 {
  return allocLeafInternal(hash(keyLen), keyLen, valLen);
}

export function insert(root: u32, leaf: u32): u32 {
  return insertInternal(root, leaf, 0);
}

// Combined allocLeaf + check exists + insert - reduces JS↔WASM calls
// Stores [newRoot, existed, valPtr] at BATCH_BUF
export function insertKey(root: u32, keyLen: u32, valLen: u32): void {
  const keyHash = hash(keyLen);
  const existed: u32 = getInternal(root, keyHash, keyLen, 0) ? 1 : 0;
  const leaf = allocLeafInternal(keyHash, keyLen, valLen);
  memory.copy(leaf + 20, KEY_BUF, keyLen);
  const newRoot = insertInternal(root, leaf, 0);
  store<u32>(BATCH_BUF, newRoot);
  store<u32>(BATCH_BUF + 4, existed);
  store<u32>(BATCH_BUF + 8, leaf + 20 + keyLen); // valPtr
}

// Returns pointer to value area in leaf (after key)
export function leafValPtr(leaf: u32): u32 {
  return leaf + 20 + load<u32>(leaf + 12);
}

// Remove and return new root, or 0xFFFFFFFF if key not found
// removeInternal already returns the original node (with incref) if key not found at leaf
export function tryRemove(root: u32, keyLen: u32): u32 {
  if (!root) return 0xFFFFFFFF;
  const keyHash = hash(keyLen);
  const newRoot = removeInternal(root, keyHash, keyLen, 0);
  // If newRoot == root with same refcount, key wasn't found
  if (newRoot == root) {
    decref(root); // undo the incref from removeInternal
    return 0xFFFFFFFF;
  }
  return newRoot;
}

export function get(root: u32, keyLen: u32): u32 {
  return getInternal(root, hash(keyLen), keyLen, 0);
}

export function has(root: u32, keyLen: u32): u32 {
  return get(root, keyLen) ? 1 : 0;
}

export function keyBuf(): u32 { return KEY_BUF; }
export function getUsedBytes(): u32 { return usedBytes; }
export function getHeapEnd(): u32 { return heapEnd; }

export function reset(): void {
  heapEnd = HEAP_START;
  freeList = 0;
  usedBytes = 0;
}

// Iteration
export function initIter(root: u32): void {
  stackPtr = 0;
  if (root) {
    store<u32>(STACK_BASE, root);
    stackPtr = 4;
  }
}

export function nextLeaf(): u32 {
  while (stackPtr) {
    stackPtr -= 4;
    const ptr = load<u32>(STACK_BASE + stackPtr);
    const bm = load<u32>(ptr + 4);
    if (!bm) return ptr;
    const cnt = pc(bm);
    for (let j = cnt; j > 0; j--) {
      store<u32>(STACK_BASE + stackPtr, load<u32>(ptr + 8 + ((j - 1) << 2)));
      stackPtr += 4;
    }
  }
  return 0;
}

// Batch iteration: writes [ptr, keyLen, valLen]... to BATCH_BUF, returns count
export function nextLeaves(maxCount: u32): u32 {
  let count: u32 = 0;
  let off: u32 = 0;
  while (stackPtr && count < maxCount) {
    stackPtr -= 4;
    const ptr = load<u32>(STACK_BASE + stackPtr);
    const bm = load<u32>(ptr + 4);
    if (!bm) {
      store<u32>(BATCH_BUF + off, ptr);
      store<u32>(BATCH_BUF + off + 4, load<u32>(ptr + 12));
      store<u32>(BATCH_BUF + off + 8, load<u32>(ptr + 16));
      off += 12;
      count++;
    } else {
      const cnt = pc(bm);
      for (let j = cnt; j > 0; j--) {
        store<u32>(STACK_BASE + stackPtr, load<u32>(ptr + 8 + ((j - 1) << 2)));
        stackPtr += 4;
      }
    }
  }
  return count;
}

// Hash at arbitrary pointer
function hashAt(ptr: u32, len: u32): u32 {
  let h: u32 = 2166136261;
  for (let i: u32 = 0; i < len; i++) h = (h ^ load<u8>(ptr + i)) * 16777619;
  return h;
}

// Compare key at ptr with memory at leafPtr
function keycmpAt(keyPtr: u32, leafPtr: u32, len: u32): bool {
  return memory.compare(keyPtr, leafPtr, len) == 0;
}

// Get using key at arbitrary pointer
function getAt(node: u32, keyPtr: u32, keyHash: u32, keyLen: u32, shift: u32): u32 {
  while (node) {
    const bm = load<u32>(node + 4);
    if (!bm) {
      if (load<u32>(node + 8) == keyHash && leafKeyLen(node) == keyLen && keycmpAt(keyPtr, leafKeyPtr(node), keyLen)) return node;
      return 0;
    }
    const bit: u32 = 1 << ((keyHash >> shift) & MASK);
    if (!(bm & bit)) return 0;
    node = load<u32>(node + 8 + (pc(bm & (bit - 1)) << 2));
    shift += BITS;
  }
  return 0;
}

// Batch insert: batchBuf contains [keyLen:4][valLen:4][key][val]... repeated
// Returns new root, stores inserted count at BATCH_BUF-4
export function batchInsert(root: u32, count: u32): u32 {
  let offset: u32 = 0;
  let inserted: u32 = 0;
  for (let i: u32 = 0; i < count; i++) {
    const keyLen = load<u32>(BATCH_BUF + offset);
    const valLen = load<u32>(BATCH_BUF + offset + 4);
    const keyPtr = BATCH_BUF + offset + 8;
    const keyHash = hashAt(keyPtr, keyLen);
    
    // Check if key exists
    const existed = getAt(root, keyPtr, keyHash, keyLen, 0);
    if (!existed) inserted++;
    
    const leaf = allocLeafInternal(keyHash, keyLen, valLen);
    memory.copy(leaf + 20, keyPtr, keyLen + valLen);
    root = insertInternal(root, leaf, 0);
    offset += 8 + keyLen + valLen;
  }
  store<u32>(BATCH_BUF - 4, inserted);
  return root;
}

// Batch get: batchBuf contains [keyLen:4][key]... repeated
// Results written to batchBuf as [ptr:4]... (0 if not found)
export function batchGet(root: u32, count: u32): void {
  let readOff: u32 = 0;
  for (let i: u32 = 0; i < count; i++) {
    const keyLen = load<u32>(BATCH_BUF + readOff);
    const keyPtr = BATCH_BUF + readOff + 4;
    const keyHash = hashAt(keyPtr, keyLen);
    const result = getAt(root, keyPtr, keyHash, keyLen, 0);
    store<u32>(BATCH_BUF + (i << 2), result);
    readOff += 4 + keyLen;
  }
}

// Batch delete: batchBuf contains [keyLen:4][key]... repeated  
// Returns new root, stores deleted count at BATCH_BUF-4
// Remove using key at arbitrary pointer, returns 0xFFFFFFFF if not found
function tryRemoveAt(node: u32, keyPtr: u32, keyHash: u32, keyLen: u32, shift: u32): u32 {
  if (!node) return 0xFFFFFFFF;
  const bm = load<u32>(node + 4);
  if (!bm) {
    if (keycmpAt(keyPtr, leafKeyPtr(node), keyLen)) return 0;
    return 0xFFFFFFFF;
  }
  const bit: u32 = 1 << ((keyHash >> shift) & MASK);
  if (!(bm & bit)) return 0xFFFFFFFF;
  const pos = pc(bm & (bit - 1));
  const cnt = pc(bm);
  const child = load<u32>(node + 8 + (pos << 2));
  const newChild = tryRemoveAt(child, keyPtr, keyHash, keyLen, shift + BITS);
  if (newChild == 0xFFFFFFFF) return 0xFFFFFFFF;
  if (newChild == child) { incref(node); return node; }
  if (!newChild) {
    if (cnt == 1) return 0;
    const ptr = allocNode(bm & ~bit, cnt - 1);
    for (let j: u32 = 0; j < pos; j++) { const c = load<u32>(node + 8 + (j << 2)); store<u32>(ptr + 8 + (j << 2), c); incref(c); }
    for (let j = pos + 1; j < cnt; j++) { const c = load<u32>(node + 8 + (j << 2)); store<u32>(ptr + 8 + ((j - 1) << 2), c); incref(c); }
    return ptr;
  }
  const ptr = allocNode(bm, cnt);
  for (let j: u32 = 0; j < cnt; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    if (j == pos) store<u32>(ptr + 8 + (j << 2), newChild);
    else { store<u32>(ptr + 8 + (j << 2), c); incref(c); }
  }
  return ptr;
}

export function batchDelete(root: u32, count: u32): u32 {
  let offset: u32 = 0;
  let deleted: u32 = 0;
  for (let i: u32 = 0; i < count; i++) {
    const keyLen = load<u32>(BATCH_BUF + offset);
    const keyPtr = BATCH_BUF + offset + 4;
    const newRoot = tryRemoveAt(root, keyPtr, hashAt(keyPtr, keyLen), keyLen, 0);
    if (newRoot != 0xFFFFFFFF) { root = newRoot; deleted++; }
    offset += 4 + keyLen;
  }
  store<u32>(BATCH_BUF - 4, deleted);
  return root;
}

export function batchBuf(): u32 { return BATCH_BUF; }


// === TRANSIENT OPERATIONS ===
// Mutate nodes in-place when owned by current transient operation

function canMutate(ptr: u32): bool {
  return ptr != 0 && transientId != 0 && getOwner(ptr) == transientId;
}

// Mark node as owned by current transient operation
function own(ptr: u32): void {
  if (ptr && transientId) setOwner(ptr, transientId);
}

// Transient insert - mutates in place when possible
function insertTransient(node: u32, leaf: u32, shift: u32): u32 {
  const keyHash = load<u32>(leaf + 8);
  const keyLen = load<u32>(leaf + 12);
  
  if (!node) { own(leaf); return leaf; }
  
  const bm = load<u32>(node + 4);
  if (!bm) {
    if (load<u32>(node + 8) == keyHash && leafKeyLen(node) == keyLen) {
      if (keycmp2(leafKeyPtr(node), leafKeyPtr(leaf), keyLen)) {
        own(leaf);
        return leaf;
      }
    }
    return merge(node, load<u32>(node + 8), leaf, keyHash, shift);
  }
  
  const bit: u32 = 1 << ((keyHash >> shift) & MASK);
  const pos = pc(bm & (bit - 1));
  const cnt = pc(bm);
  
  if (bm & bit) {
    const oldChild = load<u32>(node + 8 + (pos << 2));
    const newChild = insertTransient(oldChild, leaf, shift + BITS);
    if (canMutate(node)) {
      store<u32>(node + 8 + (pos << 2), newChild);
      return node;
    }
    const ptr = allocNode(bm, cnt);
    own(ptr);
    for (let j: u32 = 0; j < cnt; j++) {
      const c = load<u32>(node + 8 + (j << 2));
      if (j == pos) store<u32>(ptr + 8 + (j << 2), newChild);
      else { store<u32>(ptr + 8 + (j << 2), c); incref(c); }
    }
    return ptr;
  }
  
  // Need to expand - can't mutate in place (size changes)
  const ptr = allocNode(bm | bit, cnt + 1);
  own(ptr);
  for (let j: u32 = 0; j < pos; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    store<u32>(ptr + 8 + (j << 2), c);
    incref(c);
  }
  store<u32>(ptr + 8 + (pos << 2), leaf);
  own(leaf);
  for (let j = pos; j < cnt; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    store<u32>(ptr + 8 + ((j + 1) << 2), c);
    incref(c);
  }
  return ptr;
}

// Transient remove - mutates in place when possible
function removeTransient(node: u32, keyPtr: u32, keyHash: u32, keyLen: u32, shift: u32): u32 {
  if (!node) return 0xFFFFFFFF;
  const bm = load<u32>(node + 4);
  if (!bm) {
    if (keycmpAt(keyPtr, leafKeyPtr(node), keyLen)) return 0;
    return 0xFFFFFFFF;
  }
  const bit: u32 = 1 << ((keyHash >> shift) & MASK);
  if (!(bm & bit)) return 0xFFFFFFFF;
  const pos = pc(bm & (bit - 1));
  const cnt = pc(bm);
  const child = load<u32>(node + 8 + (pos << 2));
  const newChild = removeTransient(child, keyPtr, keyHash, keyLen, shift + BITS);
  if (newChild == 0xFFFFFFFF) return 0xFFFFFFFF;
  
  if (!newChild) {
    if (cnt == 1) return 0;
    // Shrinking - can't mutate in place
    const ptr = allocNode(bm & ~bit, cnt - 1);
    own(ptr);
    for (let j: u32 = 0; j < pos; j++) { const c = load<u32>(node + 8 + (j << 2)); store<u32>(ptr + 8 + (j << 2), c); incref(c); }
    for (let j = pos + 1; j < cnt; j++) { const c = load<u32>(node + 8 + (j << 2)); store<u32>(ptr + 8 + ((j - 1) << 2), c); incref(c); }
    return ptr;
  }
  
  if (newChild == child) return node;
  
  if (canMutate(node)) {
    store<u32>(node + 8 + (pos << 2), newChild);
    return node;
  }
  
  const ptr = allocNode(bm, cnt);
  own(ptr);
  for (let j: u32 = 0; j < cnt; j++) {
    const c = load<u32>(node + 8 + (j << 2));
    if (j == pos) store<u32>(ptr + 8 + (j << 2), newChild);
    else { store<u32>(ptr + 8 + (j << 2), c); incref(c); }
  }
  return ptr;
}

// Transient batch insert
export function batchInsertTransient(root: u32, count: u32): u32 {
  transientId = (transientId & 0xFF) + 1; // Cycle 1-255
  if (!transientId) transientId = 1;
  let offset: u32 = 0;
  let inserted: u32 = 0;
  for (let i: u32 = 0; i < count; i++) {
    const keyLen = load<u32>(BATCH_BUF + offset);
    const valLen = load<u32>(BATCH_BUF + offset + 4);
    const keyPtr = BATCH_BUF + offset + 8;
    const keyHash = hashAt(keyPtr, keyLen);
    const existed = getAt(root, keyPtr, keyHash, keyLen, 0);
    if (!existed) inserted++;
    const leaf = allocLeafInternal(keyHash, keyLen, valLen);
    memory.copy(leaf + 20, keyPtr, keyLen + valLen);
    root = insertTransient(root, leaf, 0);
    offset += 8 + keyLen + valLen;
  }
  transientId = 0;
  store<u32>(BATCH_BUF - 4, inserted);
  return root;
}

// Transient batch delete
export function batchDeleteTransient(root: u32, count: u32): u32 {
  transientId = (transientId & 0xFF) + 1;
  if (!transientId) transientId = 1;
  let offset: u32 = 0;
  let deleted: u32 = 0;
  for (let i: u32 = 0; i < count; i++) {
    const keyLen = load<u32>(BATCH_BUF + offset);
    const keyPtr = BATCH_BUF + offset + 4;
    const newRoot = removeTransient(root, keyPtr, hashAt(keyPtr, keyLen), keyLen, 0);
    if (newRoot != 0xFFFFFFFF) { root = newRoot; deleted++; }
    offset += 4 + keyLen;
  }
  transientId = 0;
  store<u32>(BATCH_BUF - 4, deleted);
  return root;
}


// === FIELD ACCESS ===
// Read fields directly from leaf value without crossing JS boundary

// Hash at arbitrary pointer
function hashPtr(ptr: u32, len: u32): u32 {
  let h: u32 = 2166136261;
  for (let i: u32 = 0; i < len; i++) h = (h ^ load<u8>(ptr + i)) * 16777619;
  return h;
}

// Compare key at ptr with leaf key
function keycmpPtr(keyPtr: u32, leafPtr: u32, len: u32): bool {
  return memory.compare(keyPtr, leafPtr, len) == 0;
}

// Get using key at arbitrary pointer
function getPtr(node: u32, keyPtr: u32, keyHash: u32, keyLen: u32, shift: u32): u32 {
  while (node) {
    const bm = load<u32>(node + 4);
    if (!bm) {
      if (load<u32>(node + 8) == keyHash && leafKeyLen(node) == keyLen && keycmpPtr(keyPtr, leafKeyPtr(node), keyLen)) return node;
      return 0;
    }
    const bit: u32 = 1 << ((keyHash >> shift) & MASK);
    if (!(bm & bit)) return 0;
    node = load<u32>(node + 8 + (pc(bm & (bit - 1)) << 2));
    shift += BITS;
  }
  return 0;
}

// Get i32 at offset - key at arbitrary pointer
export function getFieldI32At(root: u32, keyPtr: u32, keyLen: u32, offset: u32): i32 {
  const leaf = getPtr(root, keyPtr, hashPtr(keyPtr, keyLen), keyLen, 0);
  if (!leaf) return 0;
  return load<i32>(leaf + 20 + load<u32>(leaf + 12) + offset);
}

// Get f64 at offset - key at arbitrary pointer
export function getFieldF64At(root: u32, keyPtr: u32, keyLen: u32, offset: u32): f64 {
  const leaf = getPtr(root, keyPtr, hashPtr(keyPtr, keyLen), keyLen, 0);
  if (!leaf) return 0;
  return load<f64>(leaf + 20 + load<u32>(leaf + 12) + offset);
}

// Get string field - key at arbitrary pointer, output to outPtr
export function getFieldStrAt(root: u32, keyPtr: u32, keyLen: u32, fieldOffset: u32, outPtr: u32): u32 {
  const leaf = getPtr(root, keyPtr, hashPtr(keyPtr, keyLen), keyLen, 0);
  if (!leaf) return 0;
  const valPtr = leaf + 20 + load<u32>(leaf + 12);
  const packed = load<u32>(valPtr + fieldOffset);
  const strOff = packed & 0xFFFF;
  const strLen = packed >> 16;
  memory.copy(outPtr, valPtr + strOff, strLen);
  return strLen;
}

// Versions using KEY_BUF
export function getFieldI32(root: u32, keyLen: u32, offset: u32): i32 {
  return getFieldI32At(root, KEY_BUF, keyLen, offset);
}

export function getFieldF64(root: u32, keyLen: u32, offset: u32): f64 {
  return getFieldF64At(root, KEY_BUF, keyLen, offset);
}

export function getFieldStr(root: u32, keyLen: u32, fieldOffset: u32): u32 {
  return getFieldStrAt(root, KEY_BUF, keyLen, fieldOffset, BATCH_BUF);
}


// === NUMERIC KEY OPERATIONS ===
// Use index directly as hash, store as 4-byte key

function hashNum(n: u32): u32 {
  // Mix bits for better distribution
  let h = n;
  h ^= h >> 16;
  h *= 0x85ebca6b;
  h ^= h >> 13;
  h *= 0xc2b2ae35;
  h ^= h >> 16;
  return h;
}

function getNumInternal(node: u32, idx: u32, keyHash: u32, shift: u32): u32 {
  while (node) {
    const bm = load<u32>(node + 4);
    if (!bm) {
      if (load<u32>(node + 8) == keyHash && load<u32>(node + 12) == 4 && load<u32>(node + 20) == idx) return node;
      return 0;
    }
    const bit: u32 = 1 << ((keyHash >> shift) & MASK);
    if (!(bm & bit)) return 0;
    node = load<u32>(node + 8 + (pc(bm & (bit - 1)) << 2));
    shift += BITS;
  }
  return 0;
}

// Get by numeric index - returns leaf ptr or 0
export function getNum(root: u32, idx: u32): u32 {
  return getNumInternal(root, idx, hashNum(idx), 0);
}

// Get info by numeric index - writes [keyLen, valLen, keyPtr] to BATCH_BUF
export function getNumInfo(root: u32, idx: u32): u32 {
  const ptr = getNumInternal(root, idx, hashNum(idx), 0);
  if (ptr) {
    store<u32>(BATCH_BUF, 4);
    store<u32>(BATCH_BUF + 4, load<u32>(ptr + 16));
    store<u32>(BATCH_BUF + 8, ptr + 20);
  }
  return ptr;
}

// Insert with numeric key - stores [newRoot, existed, valPtr] at BATCH_BUF
export function insertNum(root: u32, idx: u32, valLen: u32): void {
  const keyHash = hashNum(idx);
  const existed: u32 = getNumInternal(root, idx, keyHash, 0) ? 1 : 0;
  const leaf = allocLeafInternal(keyHash, 4, valLen);
  store<u32>(leaf + 20, idx); // store index as 4-byte key
  const newRoot = insertInternal(root, leaf, 0);
  store<u32>(BATCH_BUF, newRoot);
  store<u32>(BATCH_BUF + 4, existed);
  store<u32>(BATCH_BUF + 8, leaf + 24); // valPtr (after 4-byte key)
}

// Remove by numeric key - returns new root or 0xFFFFFFFF if not found
export function removeNum(root: u32, idx: u32): u32 {
  if (!root) return 0xFFFFFFFF;
  const keyHash = hashNum(idx);
  // Store idx in KEY_BUF for removeInternal
  store<u32>(KEY_BUF, idx);
  const newRoot = removeInternal(root, keyHash, 4, 0);
  if (newRoot == root) {
    decref(root);
    return 0xFFFFFFFF;
  }
  return newRoot;
}

// Has numeric key
export function hasNum(root: u32, idx: u32): u32 {
  return getNumInternal(root, idx, hashNum(idx), 0) ? 1 : 0;
}
