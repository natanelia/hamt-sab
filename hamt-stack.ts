import { Vector, VectorType, ValueOf } from './vector';

export class HAMTStack<T extends VectorType> {
  private _vec: Vector<T>;

  constructor(vec?: Vector<T>, type?: T) {
    this._vec = vec ?? new Vector(type ?? 'number' as T);
  }

  push(value: ValueOf<T>): HAMTStack<T> {
    return new HAMTStack(this._vec.push(value));
  }

  pop(): HAMTStack<T> {
    if (this._vec.size === 0) return this;
    return new HAMTStack(this._vec.pop());
  }

  peek(): ValueOf<T> | undefined {
    return this._vec.size > 0 ? this._vec.get(this._vec.size - 1) : undefined;
  }

  get size(): number { return this._vec.size; }
  get isEmpty(): boolean { return this._vec.size === 0; }
}
