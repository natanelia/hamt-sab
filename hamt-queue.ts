import { Vector, VectorType, ValueOf } from './vector';

export class HAMTQueue<T extends VectorType> {
  private _vec: Vector<T>;
  private _head: number;

  constructor(vec?: Vector<T>, head?: number, type?: T) {
    this._vec = vec ?? new Vector(type ?? 'number' as T);
    this._head = head ?? 0;
  }

  enqueue(value: ValueOf<T>): HAMTQueue<T> {
    return new HAMTQueue(this._vec.push(value), this._head);
  }

  dequeue(): HAMTQueue<T> {
    if (this.size === 0) return this;
    return new HAMTQueue(this._vec, this._head + 1);
  }

  peek(): ValueOf<T> | undefined {
    return this.size > 0 ? this._vec.get(this._head) : undefined;
  }

  get size(): number { return this._vec.size - this._head; }
  get isEmpty(): boolean { return this.size === 0; }
}
