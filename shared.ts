/**
 * Worker-friendly API for shared data structures
 */
import { SharedMap, sharedBuffer, resetMap, type ValueType } from './shared-map';
import { SharedList, sharedMemory, getAllocState, getBufferCopy, attachToMemory, attachToBufferCopy, resetSharedList, type SharedListType } from './shared-list';
import { SharedSet } from './shared-set';
import { SharedStack, sharedMemory as linkedListMemory, getAllocState as getLinkedListAllocState, getBufferCopy as getLinkedListBufferCopy, attachToMemory as attachLinkedListToMemory, attachToBufferCopy as attachLinkedListToBufferCopy, resetStack } from './shared-stack';
import { SharedQueue, resetQueue } from './shared-queue';

export { SharedMap, SharedList, SharedSet, SharedStack, SharedQueue, resetMap, resetSharedList, resetStack, resetQueue };
export type { ValueType, SharedListType };

type SharedStructure = SharedMap<any> | SharedList<any> | SharedSet<any> | SharedStack<any> | SharedQueue<any>;

interface WorkerData {
  __shared: true;
  mapBuffer: SharedArrayBuffer;
  listMemory?: WebAssembly.Memory;
  listBufferCopy?: Uint8Array;
  listAllocState?: { heapEnd: number; freeNodes: number; freeLeaves: number };
  linkedListMemory?: WebAssembly.Memory;
  linkedListBufferCopy?: Uint8Array;
  linkedListAllocState?: { heapEnd: number; freeList: number };
  structures: Record<string, { type: string; data: any }>;
}

const isBun = typeof Bun !== 'undefined';

export function getWorkerData(structures: Record<string, SharedStructure>): WorkerData {
  const serialized: Record<string, { type: string; data: any }> = {};
  let hasList = false, hasLinkedList = false;
  
  for (const [name, struct] of Object.entries(structures)) {
    if (struct instanceof SharedMap) {
      serialized[name] = { type: 'SharedMap', data: { root: (struct as any).root, valueType: (struct as any).valueType } };
    } else if (struct instanceof SharedList) {
      serialized[name] = { type: 'SharedList', data: struct.toWorkerData() };
      hasList = true;
    } else if (struct instanceof SharedSet) {
      serialized[name] = { type: 'SharedSet', data: { root: (struct as any)._map.root } };
    } else if (struct instanceof SharedStack) {
      serialized[name] = { type: 'SharedStack', data: struct.toWorkerData() };
      hasLinkedList = true;
    } else if (struct instanceof SharedQueue) {
      serialized[name] = { type: 'SharedQueue', data: struct.toWorkerData() };
      hasLinkedList = true;
    }
  }
  
  const result: WorkerData = { __shared: true, mapBuffer: sharedBuffer, structures: serialized };
  
  if (hasList) {
    result.listAllocState = getAllocState();
    if (isBun) result.listBufferCopy = getBufferCopy();
    else result.listMemory = sharedMemory;
  }
  
  if (hasLinkedList) {
    result.linkedListAllocState = getLinkedListAllocState();
    if (isBun) result.linkedListBufferCopy = getLinkedListBufferCopy();
    else result.linkedListMemory = linkedListMemory;
  }
  
  return result;
}

let workerInitialized = false;

export async function initWorker<T extends Record<string, SharedStructure>>(data: WorkerData): Promise<T> {
  if (!data.__shared) throw new Error('Invalid worker data - use getWorkerData() on main thread');
  
  if (!workerInitialized) {
    if (data.listAllocState) {
      if (data.listMemory) attachToMemory(data.listMemory, data.listAllocState);
      else if (data.listBufferCopy) attachToBufferCopy(data.listBufferCopy, data.listAllocState);
    }
    if (data.linkedListAllocState) {
      if (data.linkedListMemory) attachLinkedListToMemory(data.linkedListMemory, data.linkedListAllocState);
      else if (data.linkedListBufferCopy) attachLinkedListToBufferCopy(data.linkedListBufferCopy, data.linkedListAllocState);
    }
    workerInitialized = true;
  }
  
  const result: Record<string, SharedStructure> = {};
  for (const [name, { type, data: structData }] of Object.entries(data.structures)) {
    switch (type) {
      case 'SharedMap': result[name] = SharedMap.fromWorkerData(structData.root, structData.valueType); break;
      case 'SharedList': result[name] = SharedList.fromWorkerData(structData); break;
      case 'SharedSet': result[name] = SharedSet.fromWorkerData(structData.root); break;
      case 'SharedStack': result[name] = SharedStack.fromWorkerData(structData); break;
      case 'SharedQueue': result[name] = SharedQueue.fromWorkerData(structData); break;
    }
  }
  return result as T;
}
