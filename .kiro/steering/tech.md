# Tech Stack

## Languages
- TypeScript - Main API and bindings
- AssemblyScript - WASM implementation (hamt.as.ts)

## Runtime
- Bun - Package manager, test runner, bundler

## Build
- AssemblyScript compiler (asc) - Compiles to WASM with shared memory and threads

## Key Dependencies
- WebAssembly with SharedArrayBuffer
- FinalizationRegistry for automatic memory management
