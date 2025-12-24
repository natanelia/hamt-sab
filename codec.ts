// Shared codec utilities for encoding/decoding values
import type { ValueType, ValueOf } from './types';

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export type Codec<T> = {
  size: (v: T) => number;
  encode: (v: T, buf: Uint8Array, ptr: number) => number;
  decode: (buf: Uint8Array, ptr: number, len: number) => T;
};

function strLen(s: string): number {
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) len++;
    else if (c < 2048) len += 2;
    else if (c >= 0xD800 && c < 0xDC00) { len += 4; i++; }
    else len += 3;
  }
  return len;
}

export const codecs: Record<ValueType, Codec<any>> = {
  string: {
    size: (v: string) => strLen(v),
    encode: (v: string, buf: Uint8Array, ptr: number) => encoder.encodeInto(v, buf.subarray(ptr)).written!,
    decode: (buf: Uint8Array, ptr: number, len: number) => decoder.decode(buf.subarray(ptr, ptr + len)),
  },
  number: {
    size: () => 8,
    encode: (v: number, buf: Uint8Array, ptr: number) => { new DataView(buf.buffer).setFloat64(ptr, v, true); return 8; },
    decode: (buf: Uint8Array, ptr: number) => new DataView(buf.buffer).getFloat64(ptr, true),
  },
  boolean: {
    size: () => 1,
    encode: (v: boolean, buf: Uint8Array, ptr: number) => { buf[ptr] = v ? 1 : 0; return 1; },
    decode: (buf: Uint8Array, ptr: number) => buf[ptr] === 1,
  },
  object: {
    size: (v: object) => strLen(JSON.stringify(v)),
    encode: (v: object, buf: Uint8Array, ptr: number) => encoder.encodeInto(JSON.stringify(v), buf.subarray(ptr)).written!,
    decode: (buf: Uint8Array, ptr: number, len: number) => JSON.parse(decoder.decode(buf.subarray(ptr, ptr + len))),
  },
};

export function getCodec<T extends ValueType>(type: T): Codec<ValueOf<T>> {
  return codecs[type];
}
