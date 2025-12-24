import { describe, test, expect, beforeEach } from 'vitest';
import { SharedStack, resetStack } from './shared-stack';

describe('SharedStack', () => {
  beforeEach(() => resetStack());

  describe('basic operations', () => {
    test('empty stack', () => {
      const s = new SharedStack('number');
      expect(s.isEmpty).toBe(true);
      expect(s.size).toBe(0);
      expect(s.peek()).toBeUndefined();
      expect(s.pop()).toBe(s);
    });

    test('push and peek', () => {
      const s = new SharedStack('number').push(1).push(2).push(3);
      expect(s.peek()).toBe(3);
      expect(s.size).toBe(3);
      expect(s.isEmpty).toBe(false);
    });

    test('pop returns new stack', () => {
      const s1 = new SharedStack('number').push(1).push(2);
      const s2 = s1.pop();
      expect(s2.peek()).toBe(1);
      expect(s2.size).toBe(1);
    });

    test('pop to empty', () => {
      const s = new SharedStack('number').push(1).pop();
      expect(s.isEmpty).toBe(true);
      expect(s.peek()).toBeUndefined();
    });
  });

  describe('immutability', () => {
    test('push does not modify original', () => {
      const s1 = new SharedStack('number').push(1);
      const s2 = s1.push(2);
      expect(s1.peek()).toBe(1);
      expect(s1.size).toBe(1);
      expect(s2.peek()).toBe(2);
      expect(s2.size).toBe(2);
    });

    test('pop does not modify original', () => {
      const s1 = new SharedStack('number').push(1).push(2);
      const s2 = s1.pop();
      expect(s1.peek()).toBe(2);
      expect(s1.size).toBe(2);
      expect(s2.peek()).toBe(1);
      expect(s2.size).toBe(1);
    });

    test('branching versions', () => {
      const base = new SharedStack('number').push(1);
      const branch1 = base.push(2);
      const branch2 = base.push(3);
      expect(base.peek()).toBe(1);
      expect(branch1.peek()).toBe(2);
      expect(branch2.peek()).toBe(3);
    });
  });

  describe('type: number', () => {
    test('integers', () => {
      const s = new SharedStack('number').push(42).push(-100).push(0);
      expect(s.peek()).toBe(0);
      expect(s.pop().peek()).toBe(-100);
    });

    test('floats', () => {
      const s = new SharedStack('number').push(3.14159).push(-2.5);
      expect(s.peek()).toBe(-2.5);
      expect(s.pop().peek()).toBeCloseTo(3.14159);
    });

    test('special values', () => {
      const s = new SharedStack('number').push(Infinity).push(-Infinity).push(0);
      expect(s.pop().peek()).toBe(-Infinity);
      expect(s.pop().pop().peek()).toBe(Infinity);
    });
  });

  describe('type: string', () => {
    test('basic strings', () => {
      const s = new SharedStack('string').push('hello').push('world');
      expect(s.peek()).toBe('world');
      expect(s.pop().peek()).toBe('hello');
    });

    test('empty string', () => {
      const s = new SharedStack('string').push('').push('a');
      expect(s.pop().peek()).toBe('');
    });

    test('unicode', () => {
      const s = new SharedStack('string').push('日本語').push('🎉🚀').push('émoji');
      expect(s.peek()).toBe('émoji');
      expect(s.pop().peek()).toBe('🎉🚀');
      expect(s.pop().pop().peek()).toBe('日本語');
    });

    test('long strings', () => {
      const long = 'x'.repeat(10000);
      const s = new SharedStack('string').push(long);
      expect(s.peek()).toBe(long);
    });
  });

  describe('type: boolean', () => {
    test('true and false', () => {
      const s = new SharedStack('boolean').push(true).push(false).push(true);
      expect(s.peek()).toBe(true);
      expect(s.pop().peek()).toBe(false);
      expect(s.pop().pop().peek()).toBe(true);
    });
  });

  describe('type: object', () => {
    test('simple objects', () => {
      const s = new SharedStack('object').push({ a: 1 }).push({ b: 2 });
      expect(s.peek()).toEqual({ b: 2 });
      expect(s.pop().peek()).toEqual({ a: 1 });
    });

    test('nested objects', () => {
      const obj = { x: { y: { z: [1, 2, 3] } } };
      const s = new SharedStack('object').push(obj);
      expect(s.peek()).toEqual(obj);
    });

    test('arrays', () => {
      const s = new SharedStack('object').push([1, 2, 3]).push(['a', 'b']);
      expect(s.peek()).toEqual(['a', 'b']);
      expect(s.pop().peek()).toEqual([1, 2, 3]);
    });
  });

  describe('stress tests', () => {
    test('1000 pushes', () => {
      let s = new SharedStack('number');
      for (let i = 0; i < 1000; i++) s = s.push(i);
      expect(s.size).toBe(1000);
      expect(s.peek()).toBe(999);
    });

    test('1000 push/pop cycles', () => {
      let s = new SharedStack('number');
      for (let i = 0; i < 1000; i++) s = s.push(i);
      for (let i = 999; i >= 0; i--) {
        expect(s.peek()).toBe(i);
        s = s.pop();
      }
      expect(s.isEmpty).toBe(true);
    });

    test('many string pushes', () => {
      let s = new SharedStack('string');
      for (let i = 0; i < 500; i++) s = s.push(`item${i}`);
      expect(s.size).toBe(500);
      expect(s.peek()).toBe('item499');
    });
  });

  describe('LIFO order', () => {
    test('maintains LIFO order', () => {
      let s = new SharedStack('number').push(1).push(2).push(3).push(4).push(5);
      const popped: number[] = [];
      while (!s.isEmpty) {
        popped.push(s.peek()!);
        s = s.pop();
      }
      expect(popped).toEqual([5, 4, 3, 2, 1]);
    });
  });
});
