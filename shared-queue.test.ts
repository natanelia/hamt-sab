import { describe, test, expect, beforeEach } from 'vitest';
import { SharedQueue, resetQueue } from './shared-queue';

describe('SharedQueue', () => {
  beforeEach(() => resetQueue());

  describe('basic operations', () => {
    test('empty queue', () => {
      const q = new SharedQueue('number');
      expect(q.isEmpty).toBe(true);
      expect(q.size).toBe(0);
      expect(q.peek()).toBeUndefined();
      expect(q.dequeue()).toBe(q);
    });

    test('enqueue and peek', () => {
      const q = new SharedQueue('number').enqueue(1).enqueue(2).enqueue(3);
      expect(q.peek()).toBe(1);
      expect(q.size).toBe(3);
      expect(q.isEmpty).toBe(false);
    });

    test('dequeue returns new queue', () => {
      const q1 = new SharedQueue('number').enqueue(1).enqueue(2);
      const q2 = q1.dequeue();
      expect(q2.peek()).toBe(2);
      expect(q2.size).toBe(1);
    });

    test('dequeue to empty', () => {
      const q = new SharedQueue('number').enqueue(1).dequeue();
      expect(q.isEmpty).toBe(true);
      expect(q.peek()).toBeUndefined();
    });
  });

  describe('immutability', () => {
    test('enqueue does not modify original', () => {
      const q1 = new SharedQueue('number').enqueue(1);
      const q2 = q1.enqueue(2);
      expect(q1.peek()).toBe(1);
      expect(q1.size).toBe(1);
      expect(q2.peek()).toBe(1);
      expect(q2.size).toBe(2);
    });

    test('dequeue does not modify original', () => {
      const q1 = new SharedQueue('number').enqueue(1).enqueue(2);
      const q2 = q1.dequeue();
      expect(q1.peek()).toBe(1);
      expect(q1.size).toBe(2);
      expect(q2.peek()).toBe(2);
      expect(q2.size).toBe(1);
    });

    test('branching versions', () => {
      const base = new SharedQueue('number').enqueue(1);
      const branch1 = base.enqueue(2);
      const branch2 = base.enqueue(3);
      expect(base.peek()).toBe(1);
      expect(branch1.peek()).toBe(1);
      expect(branch2.peek()).toBe(1);
      expect(branch1.size).toBe(2);
      expect(branch2.size).toBe(2);
    });
  });

  describe('type: number', () => {
    test('integers', () => {
      const q = new SharedQueue('number').enqueue(42).enqueue(-100).enqueue(0);
      expect(q.peek()).toBe(42);
      expect(q.dequeue().peek()).toBe(-100);
    });

    test('floats', () => {
      const q = new SharedQueue('number').enqueue(3.14159).enqueue(-2.5);
      expect(q.peek()).toBeCloseTo(3.14159);
      expect(q.dequeue().peek()).toBe(-2.5);
    });
  });

  describe('type: string', () => {
    test('basic strings', () => {
      const q = new SharedQueue('string').enqueue('first').enqueue('second');
      expect(q.peek()).toBe('first');
      expect(q.dequeue().peek()).toBe('second');
    });

    test('empty string', () => {
      const q = new SharedQueue('string').enqueue('').enqueue('a');
      expect(q.peek()).toBe('');
    });

    test('unicode', () => {
      const q = new SharedQueue('string').enqueue('日本語').enqueue('🎉🚀').enqueue('émoji');
      expect(q.peek()).toBe('日本語');
      expect(q.dequeue().peek()).toBe('🎉🚀');
      expect(q.dequeue().dequeue().peek()).toBe('émoji');
    });

    test('long strings', () => {
      const long = 'x'.repeat(10000);
      const q = new SharedQueue('string').enqueue(long);
      expect(q.peek()).toBe(long);
    });
  });

  describe('type: boolean', () => {
    test('true and false', () => {
      const q = new SharedQueue('boolean').enqueue(true).enqueue(false).enqueue(true);
      expect(q.peek()).toBe(true);
      expect(q.dequeue().peek()).toBe(false);
      expect(q.dequeue().dequeue().peek()).toBe(true);
    });
  });

  describe('type: object', () => {
    test('simple objects', () => {
      const q = new SharedQueue('object').enqueue({ a: 1 }).enqueue({ b: 2 });
      expect(q.peek()).toEqual({ a: 1 });
      expect(q.dequeue().peek()).toEqual({ b: 2 });
    });

    test('nested objects', () => {
      const obj = { x: { y: { z: [1, 2, 3] } } };
      const q = new SharedQueue('object').enqueue(obj);
      expect(q.peek()).toEqual(obj);
    });

    test('arrays', () => {
      const q = new SharedQueue('object').enqueue([1, 2, 3]).enqueue(['a', 'b']);
      expect(q.peek()).toEqual([1, 2, 3]);
      expect(q.dequeue().peek()).toEqual(['a', 'b']);
    });
  });

  describe('stress tests', () => {
    test('1000 enqueues', () => {
      let q = new SharedQueue('number');
      for (let i = 0; i < 1000; i++) q = q.enqueue(i);
      expect(q.size).toBe(1000);
      expect(q.peek()).toBe(0);
    });

    test('1000 enqueue/dequeue cycles', () => {
      let q = new SharedQueue('number');
      for (let i = 0; i < 1000; i++) q = q.enqueue(i);
      for (let i = 0; i < 1000; i++) {
        expect(q.peek()).toBe(i);
        q = q.dequeue();
      }
      expect(q.isEmpty).toBe(true);
    });

    test('many string enqueues', () => {
      let q = new SharedQueue('string');
      for (let i = 0; i < 500; i++) q = q.enqueue(`item${i}`);
      expect(q.size).toBe(500);
      expect(q.peek()).toBe('item0');
    });
  });

  describe('FIFO order', () => {
    test('maintains FIFO order', () => {
      let q = new SharedQueue('number').enqueue(1).enqueue(2).enqueue(3).enqueue(4).enqueue(5);
      const dequeued: number[] = [];
      while (!q.isEmpty) {
        dequeued.push(q.peek()!);
        q = q.dequeue();
      }
      expect(dequeued).toEqual([1, 2, 3, 4, 5]);
    });

    test('FIFO with strings', () => {
      let q = new SharedQueue('string').enqueue('a').enqueue('b').enqueue('c');
      const dequeued: string[] = [];
      while (!q.isEmpty) {
        dequeued.push(q.peek()!);
        q = q.dequeue();
      }
      expect(dequeued).toEqual(['a', 'b', 'c']);
    });
  });
});
