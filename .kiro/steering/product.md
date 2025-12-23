# Product Context

## Overview
hamt-sab is a high-performance immutable HAMT (Hash Array Mapped Trie) implementation using WebAssembly with SharedArrayBuffer support for multi-threaded JavaScript applications.

## Key Features
- Immutable persistent data structure
- WASM-accelerated operations via AssemblyScript
- SharedArrayBuffer for zero-copy cross-worker sharing
- Typed value support: string, number, boolean, object
- Reference counting with automatic cleanup via FinalizationRegistry

## Target Users
JavaScript/TypeScript developers building multi-threaded applications that need efficient immutable data structures with worker sharing capabilities.
