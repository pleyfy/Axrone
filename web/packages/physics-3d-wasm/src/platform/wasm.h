#pragma once

#if defined(__wasm__)
#define AXRONE_PHYSICS_TARGET_WASM 1
#else
#define AXRONE_PHYSICS_TARGET_WASM 0
#endif

#define AXRONE_PHYSICS_INLINE inline __attribute__((always_inline))
#define AXRONE_PHYSICS_NOINLINE __attribute__((noinline))

#if AXRONE_PHYSICS_TARGET_WASM
#define AXRONE_PHYSICS_EXPORT(name) extern "C" __attribute__((visibility("default"), export_name(#name)))
#else
#define AXRONE_PHYSICS_EXPORT(name) extern "C"
#endif
