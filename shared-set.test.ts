import { SharedSet } from './shared-set';
import { expect, test, describe } from 'vitest';

describe('SharedSet', () => {
  test('empty set has size 0', () => {
    expect(new SharedSet().size).toBe(0);
  });

  test('add increases size', () => {
    const s = new SharedSet().add('a').add('b');
    expect(s.size).toBe(2);
  });

  test('add duplicate does not increase size', () => {
    const s = new SharedSet().add('a').add('a');
    expect(s.size).toBe(1);
  });

  test('has returns true for existing', () => {
    const s = new SharedSet().add('x');
    expect(s.has('x')).toBe(true);
    expect(s.has('y')).toBe(false);
  });

  test('delete removes element', () => {
    const s = new SharedSet().add('a').add('b').delete('a');
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
    expect(s.size).toBe(1);
  });

  test('delete non-existent returns same set', () => {
    const s1 = new SharedSet().add('a');
    const s2 = s1.delete('b');
    expect(s1).toBe(s2);
  });

  test('immutability - original unchanged', () => {
    const s1 = new SharedSet().add('a');
    const s2 = s1.add('b');
    expect(s1.size).toBe(1);
    expect(s2.size).toBe(2);
  });

  test('values iteration', () => {
    const s = new SharedSet().add('a').add('b').add('c');
    const vals = [...s.values()].sort();
    expect(vals).toEqual(['a', 'b', 'c']);
  });

  test('forEach', () => {
    const s = new SharedSet().add('x').add('y');
    const seen: string[] = [];
    s.forEach(v => seen.push(v));
    expect(seen.sort()).toEqual(['x', 'y']);
  });

  test('addMany', () => {
    const s = new SharedSet().addMany(['a', 'b', 'c', 'a']);
    expect(s.size).toBe(3);
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
    expect(s.has('c')).toBe(true);
  });

  test('addMany with existing returns same if no new', () => {
    const s1 = new SharedSet().add('a').add('b');
    const s2 = s1.addMany(['a', 'b']);
    expect(s1).toBe(s2);
  });

  test('numeric values', () => {
    const s = new SharedSet<number>().add(1).add(2).add(3);
    expect(s.has(1)).toBe(true);
    expect(s.has(4)).toBe(false);
    expect(s.size).toBe(3);
  });

  test('many elements', () => {
    let s = new SharedSet<string>();
    for (let i = 0; i < 1000; i++) s = s.add(`item${i}`);
    expect(s.size).toBe(1000);
    for (let i = 0; i < 1000; i++) expect(s.has(`item${i}`)).toBe(true);
  });
});
