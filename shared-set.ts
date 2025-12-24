import { SharedMap } from './shared-map';

export class SharedSet<T extends string | number> {
  private _map: SharedMap<'number'>;

  constructor(map?: SharedMap<'number'>) {
    this._map = map ?? new SharedMap('number');
  }

  add(value: T): SharedSet<T> {
    const key = String(value);
    if (this._map.has(key)) return this;
    return new SharedSet(this._map.set(key, 0));
  }

  has(value: T): boolean {
    return this._map.has(String(value));
  }

  delete(value: T): SharedSet<T> {
    const newMap = this._map.delete(String(value));
    return newMap === this._map ? this : new SharedSet(newMap);
  }

  get size(): number { return this._map.size; }

  *values(): Generator<T> {
    for (const k of this._map.keys()) yield (typeof k === 'string' && /^\d+$/.test(k) ? Number(k) : k) as T;
  }

  forEach(fn: (value: T) => void): void {
    for (const v of this.values()) fn(v);
  }

  addMany(values: T[]): SharedSet<T> {
    const entries: [string, number][] = [];
    for (const v of values) {
      const k = String(v);
      if (!this._map.has(k)) entries.push([k, 0]);
    }
    return entries.length ? new SharedSet(this._map.setMany(entries)) : this;
  }

  static fromWorkerData<T extends string | number>(root: number): SharedSet<T> {
    return new SharedSet(SharedMap.fromWorkerData(root, 'number'));
  }

  toWorkerData(): { root: number } {
    return { root: (this._map as any).root };
  }
}
