import { Set as ImmutableSet, List as ImmutableList, Map as ImmutableMap, Stack as ImmutableStack } from 'immutable';
import { HAMTSet } from './hamt-set';
import { HAMTStack } from './hamt-stack';
import { HAMTQueue } from './hamt-queue';
import { Vector, resetVector } from './vector';
import { HAMT, resetBuffer, configureAutoGC } from './hamt';

function bench(fn: () => void, iterations: number): number {
  for (let i = 0; i < Math.min(50, iterations); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return (performance.now() - start) / iterations;
}

function printRow(op: string, hamtMs: number, immMs: number, nativeMs?: number) {
  const ratio = hamtMs < immMs ? `${(immMs/hamtMs).toFixed(2)}x faster` : `${(hamtMs/immMs).toFixed(2)}x slower`;
  let row = `${op.padEnd(12)} │ ${hamtMs.toFixed(4).padStart(9)} │ ${immMs.toFixed(4).padStart(8)} │ ${ratio.padEnd(14)}`;
  if (nativeMs !== undefined) {
    const nRatio = hamtMs < nativeMs ? `${(nativeMs/hamtMs).toFixed(2)}x faster` : `${(hamtMs/nativeMs).toFixed(2)}x slower`;
    row += ` │ ${nativeMs.toFixed(4).padStart(8)} │ ${nRatio}`;
  }
  console.log(row);
}

function header3() {
  console.log('Operation     │ HAMT (ms) │ Imm (ms) │ vs Imm         │ Nat (ms) │ vs Native');
  console.log('──────────────┼───────────┼──────────┼────────────────┼──────────┼──────────');
}

async function benchHAMT() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`HAMT (Map) vs Immutable.Map`);
  console.log(`${'='.repeat(60)}`);
  configureAutoGC({ enabled: false });

  for (const N of [100, 1000, 10000]) {
    const iterations = Math.max(100, Math.floor(50000 / N));
    const keys = Array.from({ length: N }, (_, i) => `key${i}`);
    const vals = Array.from({ length: N }, (_, i) => `val${i}`);

    console.log(`\n--- N=${N} (${iterations} iterations) ---`);
    header3();

    printRow('set',
      bench(() => { resetBuffer(); let m = new HAMT('string'); for (let i = 0; i < N; i++) m = m.set(keys[i], vals[i]); }, iterations),
      bench(() => { let m = ImmutableMap<string,string>(); for (let i = 0; i < N; i++) m = m.set(keys[i], vals[i]); }, iterations),
      bench(() => { const m = new Map(); for (let i = 0; i < N; i++) m.set(keys[i], vals[i]); }, iterations));

    resetBuffer();
    let h = new HAMT('string'); for (let i = 0; i < N; i++) h = h.set(keys[i], vals[i]);
    let im = ImmutableMap<string,string>(); for (let i = 0; i < N; i++) im = im.set(keys[i], vals[i]);
    const nm = new Map(keys.map((k,i) => [k, vals[i]]));

    printRow('get',
      bench(() => { for (const k of keys) h.get(k); }, iterations),
      bench(() => { for (const k of keys) im.get(k); }, iterations),
      bench(() => { for (const k of keys) nm.get(k); }, iterations));

    printRow('has',
      bench(() => { for (const k of keys) h.has(k); }, iterations),
      bench(() => { for (const k of keys) im.has(k); }, iterations),
      bench(() => { for (const k of keys) nm.has(k); }, iterations));

    printRow('delete',
      bench(() => { let x = h; for (let i = 0; i < 10; i++) x = x.delete(keys[i]); }, iterations),
      bench(() => { let x = im; for (let i = 0; i < 10; i++) x = x.delete(keys[i]); }, iterations),
      bench(() => { const x = new Map(nm); for (let i = 0; i < 10; i++) x.delete(keys[i]); }, iterations));

    printRow('iter',
      bench(() => { let c = 0; h.forEach(() => c++); }, iterations),
      bench(() => { let c = 0; im.forEach(() => c++); }, iterations),
      bench(() => { let c = 0; nm.forEach(() => c++); }, iterations));
  }
}

async function benchSet() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`HAMTSet vs Immutable.Set vs Native Set`);
  console.log(`${'='.repeat(60)}`);

  for (const N of [100, 1000, 10000]) {
    const iterations = Math.max(100, Math.floor(50000 / N));
    const values = Array.from({ length: N }, (_, i) => `item${i}`);

    console.log(`\n--- N=${N} (${iterations} iterations) ---`);
    header3();

    printRow('add',
      bench(() => { resetBuffer(); let s = new HAMTSet(); for (const v of values) s = s.add(v); }, iterations),
      bench(() => { let s = ImmutableSet<string>(); for (const v of values) s = s.add(v); }, iterations),
      bench(() => { const s = new Set(); for (const v of values) s.add(v); }, iterations));

    resetBuffer();
    let hs = new HAMTSet<string>(); for (const v of values) hs = hs.add(v);
    let is = ImmutableSet<string>(); for (const v of values) is = is.add(v);
    const ns = new Set(values);

    printRow('has',
      bench(() => { for (const v of values) hs.has(v); }, iterations),
      bench(() => { for (const v of values) is.has(v); }, iterations),
      bench(() => { for (const v of values) ns.has(v); }, iterations));

    printRow('delete',
      bench(() => { let s = hs; for (let i = 0; i < 10; i++) s = s.delete(values[i]); }, iterations),
      bench(() => { let s = is; for (let i = 0; i < 10; i++) s = s.delete(values[i]); }, iterations),
      bench(() => { const s = new Set(ns); for (let i = 0; i < 10; i++) s.delete(values[i]); }, iterations));

    printRow('iter',
      bench(() => { let c = 0; hs.forEach(() => c++); }, iterations),
      bench(() => { let c = 0; is.forEach(() => c++); }, iterations),
      bench(() => { let c = 0; ns.forEach(() => c++); }, iterations));
  }
}

async function benchVector() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Vector vs Immutable.List vs Native Array`);
  console.log(`${'='.repeat(60)}`);

  for (const N of [100, 1000, 10000]) {
    resetVector();
    const iterations = Math.max(50, Math.floor(10000 / N));

    console.log(`\n--- N=${N} (${iterations} iterations) ---`);
    header3();

    printRow('push',
      bench(() => { resetVector(); let v = new Vector('number'); for (let i = 0; i < N; i++) v = v.push(i); }, iterations),
      bench(() => { let l = ImmutableList<number>(); for (let i = 0; i < N; i++) l = l.push(i); }, iterations),
      bench(() => { const a: number[] = []; for (let i = 0; i < N; i++) a.push(i); }, iterations));

    resetVector();
    let vec = new Vector('number'); for (let i = 0; i < N; i++) vec = vec.push(i);
    let il = ImmutableList<number>(); for (let i = 0; i < N; i++) il = il.push(i);
    const na = Array.from({ length: N }, (_, i) => i);

    printRow('get',
      bench(() => { for (let i = 0; i < N; i++) vec.get(i); }, iterations),
      bench(() => { for (let i = 0; i < N; i++) il.get(i); }, iterations),
      bench(() => { for (let i = 0; i < N; i++) na[i]; }, iterations));

    printRow('set',
      bench(() => { let v = vec; for (let i = 0; i < 10; i++) v = v.set(i, 99); }, iterations),
      bench(() => { let l = il; for (let i = 0; i < 10; i++) l = l.set(i, 99); }, iterations),
      bench(() => { const a = [...na]; for (let i = 0; i < 10; i++) a[i] = 99; }, iterations));

    printRow('pop',
      bench(() => { let v = vec; for (let i = 0; i < 10; i++) v = v.pop(); }, iterations),
      bench(() => { let l = il; for (let i = 0; i < 10; i++) l = l.pop(); }, iterations),
      bench(() => { const a = [...na]; for (let i = 0; i < 10; i++) a.pop(); }, iterations));

    printRow('iter',
      bench(() => { let s = 0; vec.forEach(v => s += v); }, iterations),
      bench(() => { let s = 0; il.forEach(v => s += v); }, iterations),
      bench(() => { let s = 0; na.forEach(v => s += v); }, iterations));
  }
}

async function benchStack() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`HAMTStack vs Immutable.Stack vs Native Array`);
  console.log(`${'='.repeat(60)}`);

  for (const N of [100, 1000, 10000]) {
    resetVector();
    const iterations = Math.max(50, Math.floor(10000 / N));

    console.log(`\n--- N=${N} (${iterations} iterations) ---`);
    header3();

    printRow('push',
      bench(() => { resetVector(); let s = new HAMTStack<'number'>(undefined, 'number'); for (let i = 0; i < N; i++) s = s.push(i); }, iterations),
      bench(() => { let s = ImmutableStack<number>(); for (let i = 0; i < N; i++) s = s.push(i); }, iterations),
      bench(() => { const a: number[] = []; for (let i = 0; i < N; i++) a.push(i); }, iterations));

    resetVector();
    let hs = new HAMTStack<'number'>(undefined, 'number'); for (let i = 0; i < N; i++) hs = hs.push(i);
    let is = ImmutableStack<number>(); for (let i = 0; i < N; i++) is = is.push(i);
    const na = Array.from({ length: N }, (_, i) => i);

    printRow('peek',
      bench(() => { for (let i = 0; i < N; i++) hs.peek(); }, iterations),
      bench(() => { for (let i = 0; i < N; i++) is.peek(); }, iterations),
      bench(() => { for (let i = 0; i < N; i++) na[na.length - 1]; }, iterations));

    printRow('pop',
      bench(() => { let s = hs; for (let i = 0; i < 10; i++) s = s.pop(); }, iterations),
      bench(() => { let s = is; for (let i = 0; i < 10; i++) s = s.pop(); }, iterations),
      bench(() => { const a = [...na]; for (let i = 0; i < 10; i++) a.pop(); }, iterations));
  }
}

async function benchQueue() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`HAMTQueue vs Native Array (no Immutable.Queue)`);
  console.log(`${'='.repeat(60)}`);

  for (const N of [100, 1000, 10000]) {
    resetVector();
    const iterations = Math.max(50, Math.floor(10000 / N));

    console.log(`\n--- N=${N} (${iterations} iterations) ---`);
    console.log('Operation     │ HAMT (ms) │ Nat (ms) │ vs Native');
    console.log('──────────────┼───────────┼──────────┼──────────');

    const hqEnq = bench(() => { resetVector(); let q = new HAMTQueue<'number'>(undefined, undefined, 'number'); for (let i = 0; i < N; i++) q = q.enqueue(i); }, iterations);
    const naEnq = bench(() => { const a: number[] = []; for (let i = 0; i < N; i++) a.push(i); }, iterations);
    console.log(`${'enqueue'.padEnd(12)} │ ${hqEnq.toFixed(4).padStart(9)} │ ${naEnq.toFixed(4).padStart(8)} │ ${hqEnq < naEnq ? `${(naEnq/hqEnq).toFixed(2)}x faster` : `${(hqEnq/naEnq).toFixed(2)}x slower`}`);

    resetVector();
    let hq = new HAMTQueue<'number'>(undefined, undefined, 'number'); for (let i = 0; i < N; i++) hq = hq.enqueue(i);
    const na = Array.from({ length: N }, (_, i) => i);

    const hqPeek = bench(() => { for (let i = 0; i < N; i++) hq.peek(); }, iterations);
    const naPeek = bench(() => { for (let i = 0; i < N; i++) na[0]; }, iterations);
    console.log(`${'peek'.padEnd(12)} │ ${hqPeek.toFixed(4).padStart(9)} │ ${naPeek.toFixed(4).padStart(8)} │ ${hqPeek < naPeek ? `${(naPeek/hqPeek).toFixed(2)}x faster` : `${(hqPeek/naPeek).toFixed(2)}x slower`}`);

    const hqDeq = bench(() => { let q = hq; for (let i = 0; i < 10; i++) q = q.dequeue(); }, iterations);
    const naDeq = bench(() => { const a = [...na]; for (let i = 0; i < 10; i++) a.shift(); }, iterations);
    console.log(`${'dequeue'.padEnd(12)} │ ${hqDeq.toFixed(4).padStart(9)} │ ${naDeq.toFixed(4).padStart(8)} │ ${hqDeq < naDeq ? `${(naDeq/hqDeq).toFixed(2)}x faster` : `${(hqDeq/naDeq).toFixed(2)}x slower`}`);
  }
}

async function run() {
  await benchHAMT();
  await benchSet();
  await benchVector();
  await benchStack();
  await benchQueue();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Key Advantage: SharedArrayBuffer for cross-worker sharing`);
  console.log(`Native structures are mutable and cannot be safely shared.`);
  console.log(`${'='.repeat(60)}`);
}

run();
