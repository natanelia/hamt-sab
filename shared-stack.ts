import { loadWasm, createSharedMemory, MemoryView } from './wasm-utils';
import { encoder, decoder } from './codec';
import type { ValueType, ValueOf } from './types';

const wasmBytes = loadWasm('linked-list.wasm');
const wasmModule = new WebAssembly.Module(wasmBytes);

let wasmMemory: WebAssembly.Memory;
let wasm: any;
let blobBufPtr: number;
let mem: MemoryView;

function initWasm(existingMemory?: WebAssembly.Memory) {
  wasmMemory = existingMemory || createSharedMemory();
  wasm = new WebAssembly.Instance(wasmModule, { env: { memory: wasmMemory } }).exports;
  blobBufPtr = wasm.blobBuf();
  mem = new MemoryView(wasmMemory);
}

initWasm();

export const sharedBuffer = wasmMemory!.buffer as SharedArrayBuffer;
export const sharedMemory = wasmMemory!;

export function attachToMemory(memory: WebAssembly.Memory, allocState?: { heapEnd: number; freeList: number }): void {
  initWasm(memory);
  if (allocState) { wasm.setHeapEnd(allocState.heapEnd); wasm.setFreeList(allocState.freeList); }
}

export function attachToBufferCopy(bufferCopy: Uint8Array, allocState: { heapEnd: number; freeList: number }): void {
  wasmMemory = createSharedMemory();
  new Uint8Array(wasmMemory.buffer).set(bufferCopy);
  wasm = new WebAssembly.Instance(wasmModule, { env: { memory: wasmMemory } }).exports;
  blobBufPtr = wasm.blobBuf();
  wasm.setHeapEnd(allocState.heapEnd);
  wasm.setFreeList(allocState.freeList);
  mem = new MemoryView(wasmMemory);
}

export function getBufferCopy(): Uint8Array { return new Uint8Array(wasmMemory.buffer).slice(); }
export function getAllocState() { return { heapEnd: wasm.getHeapEnd(), freeList: wasm.getFreeList() }; }
export function resetStack(): void { wasm.reset(); }

export type SharedStackType = ValueType;

export class SharedStack<T extends SharedStackType> {
  readonly head: number;
  readonly size: number;
  readonly valueType: T;
  private _top: ValueOf<T> | undefined;

  constructor(type: T, head = 0, size = 0, top?: ValueOf<T>) {
    this.valueType = type;
    this.head = head;
    this.size = size;
    this._top = top;
  }

  push(value: ValueOf<T>): SharedStack<T> {
    mem.refresh();
    let newHead: number;
    if (this.valueType === 'number') {
      newHead = wasm.push(this.head, value as number);
    } else if (this.valueType === 'boolean') {
      newHead = wasm.push(this.head, (value as boolean) ? 1 : 0);
    } else {
      const str = this.valueType === 'string' ? value as string : JSON.stringify(value);
      const bytes = encoder.encode(str);
      mem.buf.set(bytes, blobBufPtr);
      const blobPtr = wasm.allocBlob(bytes.length);
      newHead = wasm.pushBlob(this.head, blobPtr | (bytes.length << 20));
    }
    return new SharedStack(this.valueType, newHead, this.size + 1, value);
  }

  pop(): SharedStack<T> {
    if (this.size === 0) return this;
    const newHead = wasm.pop(this.head);
    let newTop: ValueOf<T> | undefined;
    if (this.size > 1 && newHead) {
      mem.refresh();
      if (this.valueType === 'number') {
        newTop = wasm.peek(newHead) as ValueOf<T>;
      } else if (this.valueType === 'boolean') {
        newTop = (wasm.peek(newHead) !== 0) as ValueOf<T>;
      } else {
        const packed = wasm.peekBlob(newHead);
        const ptr = packed & 0xFFFFF, len = packed >>> 20;
        const str = decoder.decode(mem.buf.subarray(ptr, ptr + len));
        newTop = (this.valueType === 'string' ? str : JSON.parse(str)) as ValueOf<T>;
      }
    }
    return new SharedStack(this.valueType, newHead, this.size - 1, newTop);
  }

  peek(): ValueOf<T> | undefined { return this._top; }
  get isEmpty(): boolean { return this.size === 0; }

  static fromWorkerData<T extends SharedStackType>(data: { head: number; size: number; type: T }): SharedStack<T> {
    if (data.size === 0) return new SharedStack(data.type, 0, 0);
    mem.refresh();
    let top: any;
    if (data.type === 'number') top = wasm.peek(data.head);
    else if (data.type === 'boolean') top = wasm.peek(data.head) !== 0;
    else {
      const packed = wasm.peekBlob(data.head);
      const ptr = packed & 0xFFFFF, len = packed >>> 20;
      const str = decoder.decode(mem.buf.subarray(ptr, ptr + len));
      top = data.type === 'string' ? str : JSON.parse(str);
    }
    return new SharedStack(data.type, data.head, data.size, top);
  }

  toWorkerData() { return { head: this.head, size: this.size, type: this.valueType }; }
}
