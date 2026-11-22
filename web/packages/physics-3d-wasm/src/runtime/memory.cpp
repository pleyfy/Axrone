#include <stddef.h>
#include <stdint.h>

#include "platform/wasm.h"

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif

namespace axrone::physics::memory {

namespace {

constexpr size_t pageSize = 65536;

#if defined(__wasm_simd128__)
constexpr size_t alignBytes = 16;
constexpr size_t alignMask = alignBytes - 1;
#endif

AXRONE_PHYSICS_INLINE uint64_t currentCapacity() noexcept {
    return static_cast<uint64_t>(__builtin_wasm_memory_size(0)) *
        static_cast<uint64_t>(pageSize);
}

AXRONE_PHYSICS_INLINE bool inMemory(uintptr_t origin, size_t extent) noexcept {
    if (extent == 0) {
        return true;
    }
    const uint64_t start = static_cast<uint64_t>(origin);
    const uint64_t size = static_cast<uint64_t>(extent);
    const uint64_t capacity = currentCapacity();
    return start <= capacity && size <= capacity - start;
}

AXRONE_PHYSICS_INLINE constexpr uint64_t splat64(uint8_t byte) noexcept {
    return static_cast<uint64_t>(byte) * 0x0101010101010101ULL;
}

AXRONE_PHYSICS_INLINE constexpr uint32_t splat32(uint8_t byte) noexcept {
    return static_cast<uint32_t>(byte) * 0x01010101U;
}

AXRONE_PHYSICS_INLINE constexpr uint16_t splat16(uint8_t byte) noexcept {
    return static_cast<uint16_t>((static_cast<uint16_t>(byte) << 8) | static_cast<uint16_t>(byte));
}

AXRONE_PHYSICS_INLINE uint8_t read8(const void* source) noexcept {
    return *static_cast<const uint8_t*>(source);
}

AXRONE_PHYSICS_INLINE uint16_t read16(const void* source) noexcept {
    uint16_t value;
    __builtin_memcpy(&value, source, 2);
    return value;
}

AXRONE_PHYSICS_INLINE uint32_t read32(const void* source) noexcept {
    uint32_t value;
    __builtin_memcpy(&value, source, 4);
    return value;
}

AXRONE_PHYSICS_INLINE uint64_t read64(const void* source) noexcept {
    uint64_t value;
    __builtin_memcpy(&value, source, 8);
    return value;
}

AXRONE_PHYSICS_INLINE void write8(void* dest, uint8_t value) noexcept {
    *static_cast<uint8_t*>(dest) = value;
}

AXRONE_PHYSICS_INLINE void write16(void* dest, uint16_t value) noexcept {
    __builtin_memcpy(dest, &value, 2);
}

AXRONE_PHYSICS_INLINE void write32(void* dest, uint32_t value) noexcept {
    __builtin_memcpy(dest, &value, 4);
}

AXRONE_PHYSICS_INLINE void write64(void* dest, uint64_t value) noexcept {
    __builtin_memcpy(dest, &value, 8);
}

#if defined(__wasm_simd128__)
AXRONE_PHYSICS_INLINE v128_t load128(const void* source) noexcept {
    return wasm_v128_load(source);
}

AXRONE_PHYSICS_INLINE void store128(void* dest, v128_t value) noexcept {
    wasm_v128_store(dest, value);
}
#endif

}

__attribute__((always_inline, no_builtin("memset")))
inline void* fill(void* dest, int pattern, size_t count) noexcept {
    if (count == 0) {
        return dest;
    }

    const uintptr_t address = reinterpret_cast<uintptr_t>(dest);
    if (!inMemory(address, count)) {
        return nullptr;
    }

    const uint8_t byte = static_cast<uint8_t>(pattern);
    uint8_t* const out = static_cast<uint8_t*>(dest);

#if defined(__wasm_simd128__)
    if (count < 16) {
        if (count >= 8) {
            const uint64_t word = splat64(byte);
            write64(out, word);
            write64(out + count - 8, word);
            return dest;
        }
        if (count >= 4) {
            const uint32_t word = splat32(byte);
            write32(out, word);
            write32(out + count - 4, word);
            return dest;
        }
        if (count >= 2) {
            const uint16_t word = splat16(byte);
            write16(out, word);
            write16(out + count - 2, word);
            return dest;
        }
        write8(out, byte);
        return dest;
    }

    const v128_t vector = wasm_i8x16_splat(static_cast<int8_t>(byte));

    if (count <= 32) {
        store128(out, vector);
        store128(out + count - 16, vector);
        return dest;
    }

    if (count <= 64) {
        store128(out, vector);
        store128(out + 16, vector);
        store128(out + count - 32, vector);
        store128(out + count - 16, vector);
        return dest;
    }

    store128(out, vector);

    const uint32_t advance = static_cast<uint32_t>((alignBytes - (address & alignMask)) & alignMask);
    uint8_t* stream = out + advance;
    uint8_t* const terminal = out + count;

    while (stream + 64 <= terminal) {
        v128_t* const block = static_cast<v128_t*>(__builtin_assume_aligned(stream, alignBytes));
        block[0] = vector;
        block[1] = vector;
        block[2] = vector;
        block[3] = vector;
        stream += 64;
    }

    while (stream + 16 <= terminal) {
        *static_cast<v128_t*>(__builtin_assume_aligned(stream, alignBytes)) = vector;
        stream += 16;
    }

    if (stream < terminal) {
        store128(terminal - 16, vector);
    }
    return dest;
#else
    if (count < 8) {
        if (count >= 4) {
            const uint32_t word = splat32(byte);
            write32(out, word);
            write32(out + count - 4, word);
            return dest;
        }
        if (count >= 2) {
            const uint16_t word = splat16(byte);
            write16(out, word);
            write16(out + count - 2, word);
            return dest;
        }
        write8(out, byte);
        return dest;
    }

    const uint64_t word = splat64(byte);
    write64(out, word);

    const uint32_t advance = static_cast<uint32_t>((8 - (address & 7)) & 7);
    uint8_t* stream = out + advance;
    uint8_t* const terminal = out + count;

    while (stream + 32 <= terminal) {
        uint64_t* const block = static_cast<uint64_t*>(__builtin_assume_aligned(stream, 8));
        block[0] = word;
        block[1] = word;
        block[2] = word;
        block[3] = word;
        stream += 32;
    }

    while (stream + 8 <= terminal) {
        *static_cast<uint64_t*>(__builtin_assume_aligned(stream, 8)) = word;
        stream += 8;
    }

    if (stream < terminal) {
        write64(terminal - 8, word);
    }
    return dest;
#endif
}

__attribute__((always_inline, no_builtin("memcpy")))
inline void* copy(void* dest, const void* source, size_t count) noexcept {
    if (count == 0 || dest == source) {
        return dest;
    }

    const uintptr_t destAddress = reinterpret_cast<uintptr_t>(dest);
    const uintptr_t sourceAddress = reinterpret_cast<uintptr_t>(source);
    if (!inMemory(sourceAddress, count) || !inMemory(destAddress, count)) {
        return nullptr;
    }

    uint8_t* const out = static_cast<uint8_t*>(dest);
    const uint8_t* const in = static_cast<const uint8_t*>(source);

#if defined(__wasm_simd128__)
    if (count < 16) {
        if (count >= 8) {
            write64(out, read64(in));
            write64(out + count - 8, read64(in + count - 8));
            return dest;
        }
        if (count >= 4) {
            write32(out, read32(in));
            write32(out + count - 4, read32(in + count - 4));
            return dest;
        }
        if (count >= 2) {
            write16(out, read16(in));
            write16(out + count - 2, read16(in + count - 2));
            return dest;
        }
        write8(out, read8(in));
        return dest;
    }

    if (count <= 32) {
        store128(out, load128(in));
        store128(out + count - 16, load128(in + count - 16));
        return dest;
    }

    if (count <= 64) {
        store128(out, load128(in));
        store128(out + 16, load128(in + 16));
        store128(out + count - 32, load128(in + count - 32));
        store128(out + count - 16, load128(in + count - 16));
        return dest;
    }

    store128(out, load128(in));

    const uint32_t advance = static_cast<uint32_t>((alignBytes - (destAddress & alignMask)) & alignMask);
    uint8_t* outStream = out + advance;
    const uint8_t* inStream = in + advance;
    uint8_t* const terminal = out + count;

    while (outStream + 64 <= terminal) {
        v128_t v0 = wasm_v128_load(inStream + 0);
        v128_t v1 = wasm_v128_load(inStream + 16);
        v128_t v2 = wasm_v128_load(inStream + 32);
        v128_t v3 = wasm_v128_load(inStream + 48);

        v128_t* const block = static_cast<v128_t*>(__builtin_assume_aligned(outStream, alignBytes));
        block[0] = v0;
        block[1] = v1;
        block[2] = v2;
        block[3] = v3;

        outStream += 64;
        inStream += 64;
    }

    while (outStream + 16 <= terminal) {
        *static_cast<v128_t*>(__builtin_assume_aligned(outStream, alignBytes)) = wasm_v128_load(inStream);
        outStream += 16;
        inStream += 16;
    }

    if (outStream < terminal) {
        store128(terminal - 16, load128(in + count - 16));
    }
    return dest;
#else
    if (count < 8) {
        if (count >= 4) {
            write32(out, read32(in));
            write32(out + count - 4, read32(in + count - 4));
            return dest;
        }
        if (count >= 2) {
            write16(out, read16(in));
            write16(out + count - 2, read16(in + count - 2));
            return dest;
        }
        write8(out, read8(in));
        return dest;
    }

    write64(out, read64(in));

    const uint32_t advance = static_cast<uint32_t>((8 - (destAddress & 7)) & 7);
    uint8_t* outStream = out + advance;
    const uint8_t* inStream = in + advance;
    uint8_t* const terminal = out + count;

    while (outStream + 32 <= terminal) {
        uint64_t w0 = read64(inStream + 0);
        uint64_t w1 = read64(inStream + 8);
        uint64_t w2 = read64(inStream + 16);
        uint64_t w3 = read64(inStream + 24);

        uint64_t* const block = static_cast<uint64_t*>(__builtin_assume_aligned(outStream, 8));
        block[0] = w0;
        block[1] = w1;
        block[2] = w2;
        block[3] = w3;

        outStream += 32;
        inStream += 32;
    }

    while (outStream + 8 <= terminal) {
        *static_cast<uint64_t*>(__builtin_assume_aligned(outStream, 8)) = read64(inStream);
        outStream += 8;
        inStream += 8;
    }

    if (outStream < terminal) {
        write64(terminal - 8, read64(in + count - 8));
    }
    return dest;
#endif
}

__attribute__((always_inline, no_builtin("memmove")))
inline void* move(void* dest, const void* source, size_t count) noexcept {
    if (count == 0 || dest == source) {
        return dest;
    }

    const uintptr_t destAddress = reinterpret_cast<uintptr_t>(dest);
    const uintptr_t sourceAddress = reinterpret_cast<uintptr_t>(source);

    if (destAddress < sourceAddress) {
        if (static_cast<size_t>(sourceAddress - destAddress) >= count) {
            return copy(dest, source, count);
        }
        if (!inMemory(sourceAddress, count) || !inMemory(destAddress, count)) {
            return nullptr;
        }

        uint8_t* const out = static_cast<uint8_t*>(dest);
        const uint8_t* const in = static_cast<const uint8_t*>(source);
        for (size_t index = 0; index < count; index += 1) {
            out[index] = in[index];
        }
        return dest;
    }

    if (destAddress - sourceAddress >= count) {
        return copy(dest, source, count);
    }

    if (!inMemory(sourceAddress, count) || !inMemory(destAddress, count)) {
        return nullptr;
    }

    uint8_t* const out = static_cast<uint8_t*>(dest);
    const uint8_t* const in = static_cast<const uint8_t*>(source);

#if defined(__wasm_simd128__)
    if (count < 16) {
        if (count >= 8) {
            const uint64_t tail = read64(in + count - 8);
            const uint64_t head = read64(in);
            write64(out + count - 8, tail);
            write64(out, head);
            return dest;
        }
        if (count >= 4) {
            const uint32_t tail = read32(in + count - 4);
            const uint32_t head = read32(in);
            write32(out + count - 4, tail);
            write32(out, head);
            return dest;
        }
        if (count >= 2) {
            const uint16_t tail = read16(in + count - 2);
            const uint16_t head = read16(in);
            write16(out + count - 2, tail);
            write16(out, head);
            return dest;
        }
        write8(out, read8(in));
        return dest;
    }

    size_t remaining = count;
    while (remaining >= 16) {
        store128(out + remaining - 16, load128(in + remaining - 16));
        remaining -= 16;
    }
    while (remaining > 0) {
        --remaining;
        out[remaining] = in[remaining];
    }
    return dest;
#else
    size_t remaining = count;
    while (remaining >= 8) {
        write64(out + remaining - 8, read64(in + remaining - 8));
        remaining -= 8;
    }
    while (remaining > 0) {
        --remaining;
        out[remaining] = in[remaining];
    }
    return dest;
#endif
}

__attribute__((always_inline, no_builtin("memcmp")))
inline int compare(const void* left, const void* right, size_t count) noexcept {
    if (count == 0 || left == right) {
        return 0;
    }

    const uintptr_t leftAddress = reinterpret_cast<uintptr_t>(left);
    const uintptr_t rightAddress = reinterpret_cast<uintptr_t>(right);
    if (!inMemory(leftAddress, count) || !inMemory(rightAddress, count)) {
        return 0;
    }

    const uint8_t* a = static_cast<const uint8_t*>(left);
    const uint8_t* b = static_cast<const uint8_t*>(right);

#if defined(__wasm_simd128__)
    while (count >= 64) {
        uint32_t m0 = static_cast<uint32_t>(wasm_i8x16_bitmask(wasm_i8x16_eq(wasm_v128_load(a + 0), wasm_v128_load(b + 0))));
        uint32_t m1 = static_cast<uint32_t>(wasm_i8x16_bitmask(wasm_i8x16_eq(wasm_v128_load(a + 16), wasm_v128_load(b + 16))));
        uint32_t m2 = static_cast<uint32_t>(wasm_i8x16_bitmask(wasm_i8x16_eq(wasm_v128_load(a + 32), wasm_v128_load(b + 32))));
        uint32_t m3 = static_cast<uint32_t>(wasm_i8x16_bitmask(wasm_i8x16_eq(wasm_v128_load(a + 48), wasm_v128_load(b + 48))));

        if ((m0 & m1 & m2 & m3) != 0xFFFFU) {
            if (m0 != 0xFFFFU) {
                const uint32_t index = static_cast<uint32_t>(__builtin_ctz(~m0 & 0xFFFFU));
                return static_cast<int>(a[index]) - static_cast<int>(b[index]);
            }
            if (m1 != 0xFFFFU) {
                const uint32_t index = static_cast<uint32_t>(__builtin_ctz(~m1 & 0xFFFFU));
                return static_cast<int>(a[index + 16]) - static_cast<int>(b[index + 16]);
            }
            if (m2 != 0xFFFFU) {
                const uint32_t index = static_cast<uint32_t>(__builtin_ctz(~m2 & 0xFFFFU));
                return static_cast<int>(a[index + 32]) - static_cast<int>(b[index + 32]);
            }
            const uint32_t index = static_cast<uint32_t>(__builtin_ctz(~m3 & 0xFFFFU));
            return static_cast<int>(a[index + 48]) - static_cast<int>(b[index + 48]);
        }

        a += 64;
        b += 64;
        count -= 64;
    }

    while (count >= 16) {
        const uint32_t mask = static_cast<uint32_t>(wasm_i8x16_bitmask(wasm_i8x16_eq(wasm_v128_load(a), wasm_v128_load(b))));
        if (mask != 0xFFFFU) {
            const uint32_t index = static_cast<uint32_t>(__builtin_ctz(~mask & 0xFFFFU));
            return static_cast<int>(a[index]) - static_cast<int>(b[index]);
        }
        a += 16;
        b += 16;
        count -= 16;
    }
#endif

    while (count >= 8) {
        const uint64_t leftWord = read64(a);
        const uint64_t rightWord = read64(b);
        if (leftWord != rightWord) {
            const uint64_t difference = leftWord ^ rightWord;
            const uint32_t bitIndex = static_cast<uint32_t>(__builtin_ctzll(difference)) & ~7U;
            const uint8_t leftByte = static_cast<uint8_t>(leftWord >> bitIndex);
            const uint8_t rightByte = static_cast<uint8_t>(rightWord >> bitIndex);
            return static_cast<int>(leftByte) - static_cast<int>(rightByte);
        }
        a += 8;
        b += 8;
        count -= 8;
    }

    while (count != 0) {
        if (*a != *b) {
            return static_cast<int>(*a) - static_cast<int>(*b);
        }
        ++a;
        ++b;
        --count;
    }

    return 0;
}

}

// These are compiler runtime libcalls, not part of the public ABI. They must be
// retained under LTO (used) while staying out of the wasm export table
// (hidden). no_builtin prevents the definitions from recursing into themselves.
#define AXRONE_PHYSICS_LIBCALL(name) \
    __attribute__((used, visibility("hidden"), no_builtin(#name)))

extern "C" AXRONE_PHYSICS_LIBCALL(memset)
void* memset(void* dest, int value, size_t count) noexcept {
    return axrone::physics::memory::fill(dest, value, count);
}

extern "C" AXRONE_PHYSICS_LIBCALL(memcpy)
void* memcpy(void* dest, const void* source, size_t count) noexcept {
    return axrone::physics::memory::copy(dest, source, count);
}

extern "C" AXRONE_PHYSICS_LIBCALL(memmove)
void* memmove(void* dest, const void* source, size_t count) noexcept {
    return axrone::physics::memory::move(dest, source, count);
}

extern "C" AXRONE_PHYSICS_LIBCALL(memcmp)
int memcmp(const void* left, const void* right, size_t count) noexcept {
    return axrone::physics::memory::compare(left, right, count);
}
