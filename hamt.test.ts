import { SharedHAMT } from './hamt';
import { expect, test, describe } from 'bun:test';

describe('SharedHAMT', () => {
  test('empty get returns undefined', () => {
    const h = new SharedHAMT();
    expect(h.get('foo')).toBeUndefined();
  });

  test('set and get single value', () => {
    const h1 = new SharedHAMT();
    const h2 = h1.set('foo', 'bar');
    expect(h2.get('foo')).toBe('bar');
  });

  test('immutability - original unchanged', () => {
    const h1 = new SharedHAMT();
    const h2 = h1.set('foo', 'bar');
    expect(h1.get('foo')).toBeUndefined();
    expect(h2.get('foo')).toBe('bar');
  });

  test('multiple keys', () => {
    let h = new SharedHAMT();
    h = h.set('a', '1').set('b', '2').set('c', '3');
    expect(h.get('a')).toBe('1');
    expect(h.get('b')).toBe('2');
    expect(h.get('c')).toBe('3');
  });

  test('overwrite key', () => {
    const h = new SharedHAMT().set('key', 'old').set('key', 'new');
    expect(h.get('key')).toBe('new');
  });

  test('many keys', () => {
    let h = new SharedHAMT();
    for (let i = 0; i < 100; i++) h = h.set(`key${i}`, `val${i}`);
    for (let i = 0; i < 100; i++) expect(h.get(`key${i}`)).toBe(`val${i}`);
  });

  test('hash collision handling', () => {
    let h = new SharedHAMT();
    const keys = ['aa', 'aA', 'bB', 'Bb', 'BB'];
    keys.forEach((k, i) => h = h.set(k, `v${i}`));
    keys.forEach((k, i) => expect(h.get(k)).toBe(`v${i}`));
  });

  test('structural sharing - buffer reused', () => {
    const h1 = new SharedHAMT();
    const h2 = h1.set('a', '1');
    const h3 = h2.set('b', '2');
    expect(h1.getBuffer()).toBe(h2.getBuffer());
    expect(h2.getBuffer()).toBe(h3.getBuffer());
  });

  test('missing key returns undefined', () => {
    const h = new SharedHAMT().set('exists', 'yes');
    expect(h.get('missing')).toBeUndefined();
  });

  test('empty string key and value', () => {
    const h = new SharedHAMT().set('', 'empty').set('key', '');
    expect(h.get('')).toBe('empty');
    expect(h.get('key')).toBe('');
  });

  test('unicode keys and values', () => {
    const h = new SharedHAMT().set('日本語', '🎉').set('émoji', '中文');
    expect(h.get('日本語')).toBe('🎉');
    expect(h.get('émoji')).toBe('中文');
  });

  test('long keys', () => {
    const longKey = 'x'.repeat(1000);
    const h = new SharedHAMT().set(longKey, 'long');
    expect(h.get(longKey)).toBe('long');
  });

  test('branching at multiple levels', () => {
    let h = new SharedHAMT();
    for (let i = 0; i < 500; i++) h = h.set(`k${i}`, `v${i}`);
    for (let i = 0; i < 500; i++) expect(h.get(`k${i}`)).toBe(`v${i}`);
  });

  test('version isolation', () => {
    const h1 = new SharedHAMT();
    const h2 = h1.set('a', '1');
    const h3 = h2.set('b', '2');
    const h4 = h2.set('c', '3');

    expect(h3.get('a')).toBe('1');
    expect(h3.get('b')).toBe('2');
    expect(h3.get('c')).toBeUndefined();

    expect(h4.get('a')).toBe('1');
    expect(h4.get('b')).toBeUndefined();
    expect(h4.get('c')).toBe('3');
  });

  test('serialization roundtrip', () => {
    let h = new SharedHAMT();
    for (let i = 0; i < 50; i++) h = h.set(`key${i}`, `val${i}`);
    
    const serialized = h.serialize();
    const restored = SharedHAMT.deserialize(serialized);
    
    for (let i = 0; i < 50; i++) expect(restored.get(`key${i}`)).toBe(`val${i}`);
  });
});

describe('Worker sharing', () => {
  test('main thread writes, worker reads', async () => {
    let h = new SharedHAMT();
    for (let i = 0; i < 100; i++) h = h.set(`key${i}`, `val${i}`);

    const worker = new Worker(new URL('./worker.ts', import.meta.url));
    
    const result = await new Promise<Record<string, string | undefined>>((resolve) => {
      worker.onmessage = (e) => resolve(e.data.results);
      worker.postMessage({ type: 'verify', data: h.serialize() });
    });

    for (let i = 0; i < 100; i++) {
      expect(result[`key${i}`]).toBe(`val${i}`);
    }
    worker.terminate();
  });

  test('worker reads single key', async () => {
    const h = new SharedHAMT().set('shared', 'data');
    const worker = new Worker(new URL('./worker.ts', import.meta.url));

    const result = await new Promise<string | undefined>((resolve) => {
      worker.onmessage = (e) => resolve(e.data.value);
      worker.postMessage({ type: 'get', data: h.serialize(), key: 'shared' });
    });

    expect(result).toBe('data');
    worker.terminate();
  });

  test('worker writes, main thread reads', async () => {
    const h = new SharedHAMT().set('initial', 'value');
    const worker = new Worker(new URL('./worker.ts', import.meta.url));

    const serialized = await new Promise<any>((resolve) => {
      worker.onmessage = (e) => resolve(e.data.data);
      worker.postMessage({ type: 'set', data: h.serialize(), key: 'worker', value: 'wrote' });
    });

    const updated = SharedHAMT.deserialize(serialized);
    expect(updated.get('initial')).toBe('value');
    expect(updated.get('worker')).toBe('wrote');
    worker.terminate();
  });
});
