import { SharedList, resetSharedList } from './shared-list';
import { expect, test, describe, beforeEach } from 'vitest';

describe('SharedList', () => {
  beforeEach(() => resetSharedList());

  test('empty list has size 0', () => {
    expect(new SharedList('number').size).toBe(0);
  });

  test('push increases size', () => {
    const v = new SharedList('number').push(1).push(2);
    expect(v.size).toBe(2);
  });

  test('get returns correct index', () => {
    const v = new SharedList('number').push(10).push(20).push(30);
    expect(v.get(0)).toBe(10);
    expect(v.get(1)).toBe(20);
    expect(v.get(2)).toBe(30);
  });

  test('get out of bounds returns undefined', () => {
    const v = new SharedList('number').push(1);
    expect(v.get(-1)).toBeUndefined();
    expect(v.get(1)).toBeUndefined();
  });

  test('set updates value', () => {
    const v = new SharedList('number').push(1).push(2).set(1, 99);
    expect(v.get(0)).toBe(1);
    expect(v.get(1)).toBe(99);
  });

  test('set out of bounds returns same list', () => {
    const v1 = new SharedList('number').push(1);
    const v2 = v1.set(5, 99);
    expect(v1).toBe(v2);
  });

  test('pop removes last', () => {
    const v = new SharedList('number').push(1).push(2).push(3).pop();
    expect(v.size).toBe(2);
    expect(v.get(2)).toBeUndefined();
  });

  test('pop on empty returns same', () => {
    const v1 = new SharedList('number');
    const v2 = v1.pop();
    expect(v1).toBe(v2);
  });

  test('immutability - original unchanged', () => {
    const v1 = new SharedList('number').push(1);
    const v2 = v1.push(2);
    expect(v1.size).toBe(1);
    expect(v2.size).toBe(2);
  });

  test('values iteration', () => {
    const v = new SharedList('number').push(1).push(2).push(3);
    expect([...v.values()]).toEqual([1, 2, 3]);
  });

  test('forEach with index', () => {
    const v = new SharedList('number').push(10).push(20);
    const pairs: [number, number][] = [];
    v.forEach((val, i) => pairs.push([val, i]));
    expect(pairs).toEqual([[10, 0], [20, 1]]);
  });

  test('toArray', () => {
    const v = new SharedList('number').push(1).push(2).push(3);
    expect(v.toArray()).toEqual([1, 2, 3]);
  });

  test('pushMany', () => {
    const v = new SharedList('number').pushMany([1, 2, 3]);
    expect(v.toArray()).toEqual([1, 2, 3]);
  });

  test('crosses 32-element boundary', () => {
    let v = new SharedList('number');
    for (let i = 0; i < 50; i++) v = v.push(i);
    expect(v.size).toBe(50);
    expect(v.get(31)).toBe(31);
    expect(v.get(32)).toBe(32);
    expect(v.get(49)).toBe(49);
  });

  test('crosses 1024-element boundary', () => {
    let v = new SharedList('number');
    for (let i = 0; i < 1100; i++) v = v.push(i);
    expect(v.size).toBe(1100);
    expect(v.get(1023)).toBe(1023);
    expect(v.get(1024)).toBe(1024);
    expect(v.get(1099)).toBe(1099);
  });

  test('many elements', () => {
    let v = new SharedList('number');
    for (let i = 0; i < 10000; i++) v = v.push(i);
    expect(v.size).toBe(10000);
    expect(v.get(0)).toBe(0);
    expect(v.get(5000)).toBe(5000);
    expect(v.get(9999)).toBe(9999);
  });

  test('version isolation', () => {
    const v1 = new SharedList('number').push(1).push(2);
    const v2 = v1.push(3);
    const v3 = v1.set(1, 99);
    expect(v2.toArray()).toEqual([1, 2, 3]);
    expect(v3.toArray()).toEqual([1, 99]);
    expect(v1.toArray()).toEqual([1, 2]);
  });

  test('string type', () => {
    const v = new SharedList('string').push('a').push('b').push('c');
    expect(v.size).toBe(3);
    expect(v.get(0)).toBe('a');
    expect(v.get(1)).toBe('b');
    expect(v.get(2)).toBe('c');
    expect(v.toArray()).toEqual(['a', 'b', 'c']);
  });

  test('string set', () => {
    const v = new SharedList('string').push('a').push('b').set(1, 'x');
    expect(v.toArray()).toEqual(['a', 'x']);
  });

  test('boolean type', () => {
    const v = new SharedList('boolean').push(true).push(false).push(true);
    expect(v.toArray()).toEqual([true, false, true]);
  });

  test('object type', () => {
    const o1 = { x: 1 };
    const o2 = { y: 2 };
    const v = new SharedList('object').push(o1).push(o2);
    expect(v.get(0)).toEqual(o1);
    expect(v.get(1)).toEqual(o2);
  });

  test('string interning', () => {
    const v = new SharedList('string').push('hello').push('world').push('hello');
    expect(v.get(0)).toBe('hello');
    expect(v.get(2)).toBe('hello');
  });

  test('many strings', () => {
    let v = new SharedList('string');
    for (let i = 0; i < 1000; i++) v = v.push(`item${i}`);
    expect(v.size).toBe(1000);
    expect(v.get(0)).toBe('item0');
    expect(v.get(999)).toBe('item999');
  });
});
