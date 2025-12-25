import { loadWasm, createSharedMemory, MemoryView } from './wasm-utils';
import { encoder, decoder } from './codec';
import type { ValueType, ValueOf } from './types';

const wasmBytes = loadWasm('sorted-tree.wasm');
const wasmModule = new WebAssembly.Module(wasmBytes);

let wasmMemory: WebAssembly.Memory;
let wasm: any;
let keyBufPtr: number;
let blobBufPtr: number;
let mem: MemoryView;
let lastBuf: ArrayBuffer;

function initWasm(existingMemory?: WebAssembly.Memory) {
  wasmMemory = existingMemory || createSharedMemory();
  wasm = new WebAssembly.Instance(wasmModule, { env: { memory: wasmMemory } }).exports;
  keyBufPtr = wasm.keyBuf();
  blobBufPtr = wasm.blobBuf();
  mem = new MemoryView(wasmMemory);
  lastBuf = wasmMemory.buffer;
}

initWasm();

// Inline refresh - only when buffer detached
function refresh() {
  if (lastBuf !== wasmMemory.buffer) {
    lastBuf = wasmMemory.buffer;
    mem.buf = new Uint8Array(lastBuf);
    mem.dv = new DataView(lastBuf);
  }
}

export const sharedBuffer = wasmMemory!.buffer as SharedArrayBuffer;
export const sharedMemory = wasmMemory!;

export function attachToMemory(memory: WebAssembly.Memory, allocState?: { heapEnd: number; freeList: number }): void {
  initWasm(memory);
  if (allocState) { wasm.setHeapEnd(allocState.heapEnd); wasm.setFreeList(allocState.freeList); }
}

export function getBufferCopy(): Uint8Array { return new Uint8Array(wasmMemory.buffer).slice(); }
export function getAllocState() { return { heapEnd: wasm.getHeapEnd(), freeList: wasm.getFreeList() }; }
export function resetSortedMap(): void { wasm.reset(); }

export type Comparator<K> = (a: K, b: K) => number;

// Fast ASCII key encoding - avoids TextEncoder for simple keys
function encodeKeyFast(key: string): number {
  refresh();
  const len = key.length;
  const buf = mem.buf;
  for (let i = 0; i < len; i++) {
    const c = key.charCodeAt(i);
    if (c > 127) {
      // Fall back to TextEncoder for non-ASCII
      const bytes = encoder.encode(key);
      buf.set(bytes, keyBufPtr);
      return bytes.length;
    }
    buf[keyBufPtr + i] = c;
  }
  return len;
}

// Encode value and return [ptr, len] - avoids double encoding
function encodeValueFast<T extends ValueType>(type: T, value: ValueOf<T>): [number, number] {
  refresh();
  if (type === 'number') {
    mem.dv.setFloat64(blobBufPtr, value as number, true);
    return [wasm.allocBlob(8), 8];
  }
  if (type === 'boolean') {
    mem.buf[blobBufPtr] = (value as boolean) ? 1 : 0;
    return [wasm.allocBlob(1), 1];
  }
  const str = type === 'string' ? value as string : JSON.stringify(value);
  const bytes = encoder.encode(str);
  mem.buf.set(bytes, blobBufPtr);
  return [wasm.allocBlob(bytes.length), bytes.length];
}

function decodeValue<T extends ValueType>(type: T, packed: number): ValueOf<T> {
  refresh();
  const ptr = packed & 0xFFFFF;
  const len = packed >>> 20;
  if (type === 'number') return mem.dv.getFloat64(ptr, true) as ValueOf<T>;
  if (type === 'boolean') return (mem.buf[ptr] !== 0) as ValueOf<T>;
  const str = decoder.decode(mem.buf.subarray(ptr, ptr + len));
  return (type === 'string' ? str : JSON.parse(str)) as ValueOf<T>;
}

// Fast ASCII key decoding
function decodeKeyFast(packed: number): string {
  refresh();
  const ptr = packed & 0xFFFFF;
  const len = packed >>> 20;
  const buf = mem.buf;
  // Try fast ASCII path
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[ptr + i];
    if (c > 127) return decoder.decode(buf.subarray(ptr, ptr + len));
    s += String.fromCharCode(c);
  }
  return s;
}

export class SharedSortedMap<T extends ValueType> {
  readonly root: number;
  readonly size: number;
  readonly valueType: T;
  private comparator?: Comparator<string>;

  constructor(type: T, comparator?: Comparator<string>, root = 0, size = 0) {
    this.valueType = type;
    this.comparator = comparator;
    this.root = root;
    this.size = size;
  }

  set(key: string, value: ValueOf<T>): SharedSortedMap<T> {
    const keyLen = encodeKeyFast(key);
    const [valPtr, valLen] = encodeValueFast(this.valueType, value);
    const valPacked = valPtr | (valLen << 20);
    
    wasm.insertBlob(this.root, keyLen, valPacked);
    refresh();
    const newRoot = mem.dv.getUint32(blobBufPtr, true);
    const existed = mem.dv.getUint32(blobBufPtr + 8, true);
    
    return new SharedSortedMap(this.valueType, this.comparator, newRoot, existed ? this.size : this.size + 1);
  }

  get(key: string): ValueOf<T> | undefined {
    if (!this.root) return undefined;
    const keyLen = encodeKeyFast(key);
    const node = wasm.findBlob(this.root, keyLen);
    if (!node) return undefined;
    return decodeValue(this.valueType, wasm.getValPacked(node));
  }

  has(key: string): boolean {
    if (!this.root) return false;
    return wasm.findBlob(this.root, encodeKeyFast(key)) !== 0;
  }

  delete(key: string): SharedSortedMap<T> {
    if (!this.root) return this;
    const keyLen = encodeKeyFast(key);
    if (!wasm.findBlob(this.root, keyLen)) return this;
    const newRoot = wasm.deleteBlob(this.root, keyLen);
    return new SharedSortedMap(this.valueType, this.comparator, newRoot, this.size - 1);
  }

  private *entriesNatural(): Generator<[string, ValueOf<T>]> {
    if (!this.root) return;
    let node = wasm.iterStart(this.root);
    while (node) {
      const key = decodeKeyFast(wasm.getKeyPacked(node));
      const value = decodeValue(this.valueType, wasm.getValPacked(node));
      yield [key, value];
      node = wasm.iterNext();
    }
  }

  *entries(): Generator<[string, ValueOf<T>]> {
    if (this.comparator) {
      const all = [...this.entriesNatural()];
      all.sort((a, b) => this.comparator!(a[0], b[0]));
      yield* all;
    } else {
      yield* this.entriesNatural();
    }
  }

  *keys(): Generator<string> {
    for (const [k] of this.entries()) yield k;
  }

  *values(): Generator<ValueOf<T>> {
    for (const [, v] of this.entries()) yield v;
  }

  forEach(fn: (value: ValueOf<T>, key: string) => void): void {
    for (const [k, v] of this.entries()) fn(v, k);
  }

  toWorkerData(): { root: number; size: number; valueType: T } {
    return { root: this.root, size: this.size, valueType: this.valueType };
  }

  static fromWorkerData<T extends ValueType>(data: { root: number; size: number; valueType: T }): SharedSortedMap<T> {
    return new SharedSortedMap(data.valueType, undefined, data.root, data.size);
  }
}
