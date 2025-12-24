import { describe, test, expect } from 'bun:test';
import { HAMTStack } from './hamt-stack';
import { HAMTQueue } from './hamt-queue';
import { resetVector } from './vector';

describe('HAMTStack', () => {
  test('push and peek', () => {
    resetVector();
    const s = new HAMTStack<'number'>(undefined, 'number').push(1).push(2).push(3);
    expect(s.peek()).toBe(3);
    expect(s.size).toBe(3);
  });

  test('pop', () => {
    resetVector();
    const s = new HAMTStack<'number'>(undefined, 'number').push(1).push(2);
    const s2 = s.pop();
    expect(s2.peek()).toBe(1);
    expect(s.peek()).toBe(2); // immutable
  });

  test('empty stack', () => {
    resetVector();
    const s = new HAMTStack<'string'>(undefined, 'string');
    expect(s.isEmpty).toBe(true);
    expect(s.peek()).toBeUndefined();
    expect(s.pop()).toBe(s);
  });

  test('strings', () => {
    resetVector();
    const s = new HAMTStack<'string'>(undefined, 'string').push('a').push('b');
    expect(s.peek()).toBe('b');
  });
});

describe('HAMTQueue', () => {
  test('enqueue and peek', () => {
    resetVector();
    const q = new HAMTQueue<'number'>(undefined, undefined, 'number').enqueue(1).enqueue(2).enqueue(3);
    expect(q.peek()).toBe(1);
    expect(q.size).toBe(3);
  });

  test('dequeue', () => {
    resetVector();
    const q = new HAMTQueue<'number'>(undefined, undefined, 'number').enqueue(1).enqueue(2);
    const q2 = q.dequeue();
    expect(q2.peek()).toBe(2);
    expect(q.peek()).toBe(1); // immutable
  });

  test('empty queue', () => {
    resetVector();
    const q = new HAMTQueue<'string'>(undefined, undefined, 'string');
    expect(q.isEmpty).toBe(true);
    expect(q.peek()).toBeUndefined();
    expect(q.dequeue()).toBe(q);
  });

  test('FIFO order', () => {
    resetVector();
    let q = new HAMTQueue<'string'>(undefined, undefined, 'string').enqueue('a').enqueue('b').enqueue('c');
    expect(q.peek()).toBe('a');
    q = q.dequeue();
    expect(q.peek()).toBe('b');
    q = q.dequeue();
    expect(q.peek()).toBe('c');
  });
});
