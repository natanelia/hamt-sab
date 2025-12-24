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
export function resetQueue(): void { wasm.reset(); }

export type SharedQueueType = ValueType;

export class SharedQueue<T extends SharedQueueType> {
  readonly head: number;
  readonly tail: number;
  readonly size: number;
  readonly valueType: T;
  private _front: ValueOf<T> | undefined;

  constructor(type: T, head = 0, tail = 0, size = 0, front?: ValueOf<T>) {
    this.valueType = type;
    this.head = head;
    this.tail = tail;
    this.size = size;
    this._front = front;
  }

  enqueue(value: ValueOf<T>): SharedQueue<T> {
    mem.refresh();
    let newTail: number;
    if (this.valueType === 'number') {
      newTail = wasm.enqueue(this.tail, value as number);
    } else if (this.valueType === 'boolean') {
      newTail = wasm.enqueue(this.tail, (value as boolean) ? 1 : 0);
    } else {
      const str = this.valueType === 'string' ? value as string : JSON.stringify(value);
      const bytes = encoder.encode(str);
      mem.buf.set(bytes, blobBufPtr);
      const blobPtr = wasm.allocBlob(bytes.length);
      newTail = wasm.enqueueBlob(this.tail, blobPtr | (bytes.length << 20));
    }
    const newHead = this.head || newTail;
    const newFront = this.size === 0 ? value : this._front;
    return new SharedQueue(this.valueType, newHead, newTail, this.size + 1, newFront);
  }

  dequeue(): SharedQueue<T> {
    if (this.size === 0) return this;
    const newHead = wasm.dequeue(this.head);
    const newTail = newHead ? this.tail : 0;
    let newFront: ValueOf<T> | undefined;
    if (this.size > 1 && newHead) {
      mem.refresh();
      if (this.valueType === 'number') {
        newFront = wasm.peek(newHead) as ValueOf<T>;
      } else if (this.valueType === 'boolean') {
        newFront = (wasm.peek(newHead) !== 0) as ValueOf<T>;
      } else {
        const packed = wasm.peekBlob(newHead);
        const ptr = packed & 0xFFFFF, len = packed >>> 20;
        const str = decoder.decode(mem.buf.subarray(ptr, ptr + len));
        newFront = (this.valueType === 'string' ? str : JSON.parse(str)) as ValueOf<T>;
      }
    }
    return new SharedQueue(this.valueType, newHead, newTail, this.size - 1, newFront);
  }

  peek(): ValueOf<T> | undefined { return this._front; }
  get isEmpty(): boolean { return this.size === 0; }

  static fromWorkerData<T extends SharedQueueType>(data: { head: number; tail: number; size: number; type: T }): SharedQueue<T> {
    if (data.size === 0) return new SharedQueue(data.type, 0, 0, 0);
    mem.refresh();
    let front: any;
    if (data.type === 'number') front = wasm.peek(data.head);
    else if (data.type === 'boolean') front = wasm.peek(data.head) !== 0;
    else {
      const packed = wasm.peekBlob(data.head);
      const ptr = packed & 0xFFFFF, len = packed >>> 20;
      const str = decoder.decode(mem.buf.subarray(ptr, ptr + len));
      front = data.type === 'string' ? str : JSON.parse(str);
    }
    return new SharedQueue(data.type, data.head, data.tail, data.size, front);
  }

  toWorkerData() { return { head: this.head, tail: this.tail, size: this.size, type: this.valueType }; }
}
