import { HAMT } from './hamt';

export class HAMTSet<T extends string | number> {
  private _map: HAMT<'number'>;

  constructor(map?: HAMT<'number'>) {
    this._map = map ?? new HAMT('number');
  }

  add(value: T): HAMTSet<T> {
    const key = String(value);
    if (this._map.has(key)) return this;
    return new HAMTSet(this._map.set(key, 0));
  }

  has(value: T): boolean {
    return this._map.has(String(value));
  }

  delete(value: T): HAMTSet<T> {
    const newMap = this._map.delete(String(value));
    return newMap === this._map ? this : new HAMTSet(newMap);
  }

  get size(): number { return this._map.size; }

  *values(): Generator<T> {
    for (const k of this._map.keys()) yield (typeof k === 'string' && /^\d+$/.test(k) ? Number(k) : k) as T;
  }

  forEach(fn: (value: T) => void): void {
    for (const v of this.values()) fn(v);
  }

  addMany(values: T[]): HAMTSet<T> {
    const entries: [string, number][] = [];
    for (const v of values) {
      const k = String(v);
      if (!this._map.has(k)) entries.push([k, 0]);
    }
    return entries.length ? new HAMTSet(this._map.setMany(entries)) : this;
  }
}
