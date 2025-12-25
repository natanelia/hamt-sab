// Persistent Red-Black Tree WASM for sorted map/set
// Uses path copying for immutability - no parent pointers
const KEY_BUF: u32 = 0;
const BLOB_BUF: u32 = 1024;
const HEAP_START: u32 = 65600;
let heapEnd: u32 = HEAP_START;

// Node: [color:1][left:4][right:4][keyPacked:4][valPacked:4] = 17 bytes, aligned to 20
const NODE_SIZE: u32 = 20;
const RED: u8 = 0;
const BLACK: u8 = 1;

export function keyBuf(): u32 { return KEY_BUF; }
export function blobBuf(): u32 { return BLOB_BUF; }
export function getHeapEnd(): u32 { return heapEnd; }
export function setHeapEnd(v: u32): void { heapEnd = v; }
export function getFreeList(): u32 { return 0; }
export function setFreeList(v: u32): void { }
export function reset(): void { heapEnd = HEAP_START; }

function alloc(size: u32): u32 {
  const ptr = heapEnd;
  heapEnd += size;
  const memBytes = <u32>memory.size() << 16;
  if (heapEnd > memBytes) memory.grow(((heapEnd - memBytes) >> 16) + 1);
  return ptr;
}

export function allocBlob(len: u32): u32 {
  const ptr = alloc(len);
  memory.copy(ptr, BLOB_BUF, len);
  return ptr;
}

function allocKeyBlob(len: u32): u32 {
  const ptr = alloc(len);
  memory.copy(ptr, KEY_BUF, len);
  return ptr;
}

// Node accessors - no parent pointer needed for persistent tree
@inline function isRed(n: u32): bool { return n != 0 && load<u8>(n) == RED; }
@inline function getLeft(n: u32): u32 { return n ? load<u32>(n + 1) : 0; }
@inline function getRight(n: u32): u32 { return n ? load<u32>(n + 5) : 0; }
export function getKeyPacked(n: u32): u32 { return n ? load<u32>(n + 9) : 0; }
export function getValPacked(n: u32): u32 { return n ? load<u32>(n + 13) : 0; }

// Create new node (always RED initially for insert)
function newNode(color: u8, left: u32, right: u32, keyPacked: u32, valPacked: u32): u32 {
  const n = alloc(NODE_SIZE);
  store<u8>(n, color);
  store<u32>(n + 1, left);
  store<u32>(n + 5, right);
  store<u32>(n + 9, keyPacked);
  store<u32>(n + 13, valPacked);
  return n;
}

// Copy node with new children/color
@inline function copyWith(n: u32, color: u8, left: u32, right: u32): u32 {
  return newNode(color, left, right, load<u32>(n + 9), load<u32>(n + 13));
}

@inline function setRed(n: u32, left: u32, right: u32): u32 {
  return copyWith(n, RED, left, right);
}

@inline function setBlack(n: u32, left: u32, right: u32): u32 {
  return copyWith(n, BLACK, left, right);
}

// Compare keys
function compareKeyBlob(len1: u32, ptr2: u32, len2: u32): i32 {
  const minLen = len1 < len2 ? len1 : len2;
  const cmp = memory.compare(KEY_BUF, ptr2, minLen);
  if (cmp != 0) return cmp;
  return len1 < len2 ? -1 : (len1 > len2 ? 1 : 0);
}

// Balance after insert - Okasaki's balance function
function balance(color: u8, left: u32, n: u32, right: u32): u32 {
  const kp = load<u32>(n + 9), vp = load<u32>(n + 13);
  
  if (color == BLACK) {
    // Case 1: left is red with red left child
    if (isRed(left) && isRed(getLeft(left))) {
      const ll = getLeft(left);
      return newNode(RED,
        setBlack(ll, getLeft(ll), getRight(ll)),
        newNode(BLACK, getRight(left), right, kp, vp),
        load<u32>(left + 9), load<u32>(left + 13));
    }
    // Case 2: left is red with red right child
    if (isRed(left) && isRed(getRight(left))) {
      const lr = getRight(left);
      return newNode(RED,
        setBlack(left, getLeft(left), getLeft(lr)),
        newNode(BLACK, getRight(lr), right, kp, vp),
        load<u32>(lr + 9), load<u32>(lr + 13));
    }
    // Case 3: right is red with red left child
    if (isRed(right) && isRed(getLeft(right))) {
      const rl = getLeft(right);
      return newNode(RED,
        newNode(BLACK, left, getLeft(rl), kp, vp),
        setBlack(right, getRight(rl), getRight(right)),
        load<u32>(rl + 9), load<u32>(rl + 13));
    }
    // Case 4: right is red with red right child
    if (isRed(right) && isRed(getRight(right))) {
      const rr = getRight(right);
      return newNode(RED,
        newNode(BLACK, left, getLeft(right), kp, vp),
        setBlack(rr, getLeft(rr), getRight(rr)),
        load<u32>(right + 9), load<u32>(right + 13));
    }
  }
  return newNode(color, left, right, kp, vp);
}

// Insert helper - returns new subtree root
function insertHelp(n: u32, keyLen: u32, keyPacked: u32, valPacked: u32): u32 {
  if (!n) {
    store<u32>(BLOB_BUF + 8, 0); // new node
    return newNode(RED, 0, 0, keyPacked, valPacked);
  }
  
  const kp = getKeyPacked(n);
  const cmp = compareKeyBlob(keyLen, kp & 0xFFFFF, kp >>> 20);
  
  if (cmp == 0) {
    store<u32>(BLOB_BUF + 8, 1); // existed
    return newNode(load<u8>(n), getLeft(n), getRight(n), kp, valPacked);
  }
  
  const color = load<u8>(n);
  if (cmp < 0) {
    return balance(color, insertHelp(getLeft(n), keyLen, keyPacked, valPacked), n, getRight(n));
  } else {
    return balance(color, getLeft(n), n, insertHelp(getRight(n), keyLen, keyPacked, valPacked));
  }
}

// Insert - key in KEY_BUF, returns new root
export function insertBlob(root: u32, keyLen: u32, valPacked: u32): u32 {
  const keyPacked = allocKeyBlob(keyLen) | (keyLen << 20);
  const newRoot = insertHelp(root, keyLen, keyPacked, valPacked);
  // Make root black
  const result = isRed(newRoot) ? setBlack(newRoot, getLeft(newRoot), getRight(newRoot)) : newRoot;
  store<u32>(BLOB_BUF, result);
  return result;
}

// Find blob key - returns node or 0
export function findBlob(root: u32, keyLen: u32): u32 {
  let curr = root;
  while (curr) {
    const kp = getKeyPacked(curr);
    const cmp = compareKeyBlob(keyLen, kp & 0xFFFFF, kp >>> 20);
    if (cmp == 0) return curr;
    curr = cmp < 0 ? getLeft(curr) : getRight(curr);
  }
  return 0;
}

// Get min/max for iteration
export function getMin(n: u32): u32 {
  if (!n) return 0;
  while (getLeft(n)) n = getLeft(n);
  return n;
}

export function getMax(n: u32): u32 {
  if (!n) return 0;
  while (getRight(n)) n = getRight(n);
  return n;
}

// Stack-based successor (no parent pointers)
// Stores path in BLOB_BUF area, returns next node
let iterStack: u32 = 0;
let iterTop: i32 = -1;

export function iterStart(root: u32): u32 {
  iterStack = BLOB_BUF + 64;
  iterTop = -1;
  let n = root;
  while (n) {
    iterTop++;
    store<u32>(iterStack + (iterTop << 2), n);
    n = getLeft(n);
  }
  return iterTop >= 0 ? load<u32>(iterStack + (iterTop << 2)) : 0;
}

export function iterNext(): u32 {
  if (iterTop < 0) return 0;
  let n = load<u32>(iterStack + (iterTop << 2));
  iterTop--;
  n = getRight(n);
  while (n) {
    iterTop++;
    store<u32>(iterStack + (iterTop << 2), n);
    n = getLeft(n);
  }
  return iterTop >= 0 ? load<u32>(iterStack + (iterTop << 2)) : 0;
}

// Delete helpers for persistent RB tree
function balanceLeft(n: u32, left: u32, right: u32): u32 {
  const kp = load<u32>(n + 9), vp = load<u32>(n + 13);
  if (isRed(left)) {
    return newNode(RED, setBlack(left, getLeft(left), getRight(left)), right, kp, vp);
  }
  if (!right) return newNode(BLACK, left, 0, kp, vp);
  if (isRed(right)) {
    const rl = getLeft(right);
    return newNode(BLACK,
      balanceLeft(n, left, getLeft(rl)),
      balance(BLACK, getRight(rl), right, setRed(getRight(right), getLeft(getRight(right)), getRight(getRight(right)))),
      load<u32>(rl + 9), load<u32>(rl + 13));
  }
  return balance(BLACK, left, n, setRed(right, getLeft(right), getRight(right)));
}

function balanceRight(n: u32, left: u32, right: u32): u32 {
  const kp = load<u32>(n + 9), vp = load<u32>(n + 13);
  if (isRed(right)) {
    return newNode(RED, left, setBlack(right, getLeft(right), getRight(right)), kp, vp);
  }
  if (!left) return newNode(BLACK, 0, right, kp, vp);
  if (isRed(left)) {
    const lr = getRight(left);
    return newNode(BLACK,
      balance(BLACK, setRed(getLeft(left), getLeft(getLeft(left)), getRight(getLeft(left))), left, getLeft(lr)),
      balanceRight(n, getRight(lr), right),
      load<u32>(lr + 9), load<u32>(lr + 13));
  }
  return balance(BLACK, setRed(left, getLeft(left), getRight(left)), n, right);
}

function delMin(n: u32): u32 {
  if (!getLeft(n)) return getRight(n);
  if (!isRed(getLeft(n)) && !isRed(getLeft(getLeft(n)))) {
    return balanceLeft(n, delMin(getLeft(n)), getRight(n));
  }
  return newNode(load<u8>(n), delMin(getLeft(n)), getRight(n), load<u32>(n + 9), load<u32>(n + 13));
}

function deleteHelp(n: u32, keyLen: u32): u32 {
  if (!n) return 0;
  
  const kp = getKeyPacked(n);
  const cmp = compareKeyBlob(keyLen, kp & 0xFFFFF, kp >>> 20);
  
  if (cmp < 0) {
    if (!getLeft(n)) return n;
    if (!isRed(getLeft(n)) && !isRed(getLeft(getLeft(n)))) {
      return balanceLeft(n, deleteHelp(getLeft(n), keyLen), getRight(n));
    }
    return newNode(load<u8>(n), deleteHelp(getLeft(n), keyLen), getRight(n), kp, load<u32>(n + 13));
  }
  
  if (cmp > 0) {
    if (!getRight(n)) return n;
    if (!isRed(getRight(n)) && !isRed(getLeft(getRight(n)))) {
      return balanceRight(n, getLeft(n), deleteHelp(getRight(n), keyLen));
    }
    return newNode(load<u8>(n), getLeft(n), deleteHelp(getRight(n), keyLen), kp, load<u32>(n + 13));
  }
  
  // Found - delete this node
  if (!getLeft(n)) return getRight(n);
  if (!getRight(n)) return getLeft(n);
  
  // Replace with min of right subtree
  const minRight = getMin(getRight(n));
  const newRight = delMin(getRight(n));
  return balance(load<u8>(n), getLeft(n), 
    newNode(load<u8>(n), getLeft(n), newRight, load<u32>(minRight + 9), load<u32>(minRight + 13)),
    newRight);
}

export function deleteBlob(root: u32, keyLen: u32): u32 {
  if (!root) return 0;
  const result = deleteHelp(root, keyLen);
  if (!result) return 0;
  return isRed(result) ? setBlack(result, getLeft(result), getRight(result)) : result;
}

// Legacy exports for compatibility
export function getNext(n: u32): u32 { return iterNext(); }
export function countNodes(n: u32): u32 {
  if (!n) return 0;
  return 1 + countNodes(getLeft(n)) + countNodes(getRight(n));
}
