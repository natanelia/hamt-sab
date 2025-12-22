import { SharedHAMT, type SerializedHAMT } from './hamt';

declare var self: Worker;

self.onmessage = (e: MessageEvent<{ type: string; data: SerializedHAMT; key?: string; value?: string }>) => {
  const { type, data, key, value } = e.data;
  const hamt = SharedHAMT.deserialize(data);

  if (type === 'get') {
    self.postMessage({ type: 'result', value: hamt.get(key!) });
  } else if (type === 'set') {
    const newHamt = hamt.set(key!, value!);
    self.postMessage({ type: 'result', data: newHamt.serialize() });
  } else if (type === 'verify') {
    // Verify multiple keys
    const results: Record<string, string | undefined> = {};
    for (let i = 0; i < 100; i++) {
      results[`key${i}`] = hamt.get(`key${i}`);
    }
    self.postMessage({ type: 'result', results });
  }
};
