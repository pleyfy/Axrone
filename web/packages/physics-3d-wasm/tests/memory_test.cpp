#include <stddef.h>
#include <stdint.h>

extern "C" void* memset(void* dest, int value, size_t count) noexcept;
extern "C" void* memcpy(void* dest, const void* source, size_t count) noexcept;
extern "C" void* memmove(void* dest, const void* source, size_t count) noexcept;
extern "C" int memcmp(const void* left, const void* right, size_t count) noexcept;

namespace {

constexpr size_t bufferBytes = 512;
constexpr uint32_t maxSpan = 160;
constexpr uint32_t maxShift = 24;
constexpr uint32_t maxAlign = 8;
constexpr uint32_t resultMarker = 0xFFFFU;
constexpr uint32_t expectedReturn = 0xF1U;
constexpr uint32_t actualReturn = 0xF2U;

uint8_t g_left[bufferBytes];
uint8_t g_right[bufferBytes];
uint8_t g_snap[bufferBytes];
uint8_t g_a[bufferBytes];
uint8_t g_b[bufferBytes];

#define NO_BUILTIN                                                                                     \
    __attribute__((noinline))                                                                        \
    __attribute__((no_builtin("memset")))                                                            \
    __attribute__((no_builtin("memcpy")))                                                            \
    __attribute__((no_builtin("memmove")))                                                           \
    __attribute__((no_builtin("memcmp")))

uint64_t packFailure(uint32_t suite, uint32_t length, uint32_t align, uint32_t index, uint32_t expected,
                     uint32_t actual) noexcept {
    return (uint64_t(1) << suite) | (uint64_t(length & 0xFFU) << 8) | (uint64_t(align & 0xFFU) << 16) |
           (uint64_t(index & 0xFFFFU) << 24) | (uint64_t(expected & 0xFFU) << 40) | (uint64_t(actual & 0xFFU) << 48);
}

uint8_t contentByte(uint32_t origin, uint32_t index) noexcept {
    uint32_t x = index * 2654435761U + origin * 2246822519U;
    x ^= x >> 15;
    x *= 3266489917U;
    x ^= x >> 12;
    return static_cast<uint8_t>(x >> 24);
}

NO_BUILTIN void seed(uint8_t* base, uint32_t count, uint32_t origin) noexcept {
    for (uint32_t i = 0; i < count; ++i) {
        base[i] = contentByte(origin, i);
    }
}

NO_BUILTIN void snapshot(uint8_t* dest, const uint8_t* source, uint32_t count) noexcept {
    for (uint32_t i = 0; i < count; ++i) {
        dest[i] = source[i];
    }
}

uint32_t signCode(int value) noexcept {
    if (value < 0) {
        return 0U;
    }
    return value > 0 ? 2U : 1U;
}

NO_BUILTIN uint64_t runMemset() noexcept {
    const uint8_t patterns[4] = {0x00U, 0xFFU, 0x3CU, 0xC3U};
    for (uint32_t length = 0; length <= maxSpan; ++length) {
        for (uint32_t align = 0; align < maxAlign; ++align) {
            for (uint32_t p = 0; p < 4; ++p) {
                uint8_t* dest = g_left + 64 + align;
                seed(dest, length + 1, 91U + p * 7U + align);
                const uint8_t pattern = patterns[p];
                const uint8_t guard = static_cast<uint8_t>(pattern ^ 0xA5U);
                dest[length] = guard;
                void* result = memset(dest, pattern, length);
                if (result != dest) {
                    return packFailure(0, length, align, resultMarker, expectedReturn, actualReturn);
                }
                for (uint32_t i = 0; i < length; ++i) {
                    if (dest[i] != pattern) {
                        return packFailure(0, length, align, i, pattern, dest[i]);
                    }
                }
                if (dest[length] != guard) {
                    return packFailure(0, length, align, length, guard, dest[length]);
                }
            }
        }
    }
    return 0;
}

NO_BUILTIN uint64_t runMemcpy() noexcept {
    for (uint32_t length = 0; length <= maxSpan; ++length) {
        for (uint32_t sa = 0; sa < maxAlign; ++sa) {
            for (uint32_t da = 0; da < maxAlign; ++da) {
                const uint32_t origin = 31U + sa * 5U + da * 3U;
                const uint32_t align = (sa << 4) | da;
                uint8_t* dest = g_left + 96 + da;
                uint8_t* source = g_right + 96 + sa;
                seed(source, length + 1, origin);
                seed(dest, length + 1, origin ^ 0x5AU);
                const uint8_t destGuard = static_cast<uint8_t>(contentByte(origin, length) ^ 0xA5U);
                dest[length] = destGuard;
                void* result = memcpy(dest, source, length);
                if (result != dest) {
                    return packFailure(1, length, align, resultMarker, expectedReturn, actualReturn);
                }
                for (uint32_t i = 0; i < length; ++i) {
                    const uint8_t expected = contentByte(origin, i);
                    if (dest[i] != expected) {
                        return packFailure(1, length, align, i, expected, dest[i]);
                    }
                }
                if (dest[length] != destGuard) {
                    return packFailure(1, length, align, length, destGuard, dest[length]);
                }
                const uint8_t sourceGuard = contentByte(origin, length);
                if (source[length] != sourceGuard) {
                    return packFailure(1, length, align, length, sourceGuard, source[length]);
                }
            }
        }
    }
    return 0;
}

NO_BUILTIN uint64_t moveUpCase(uint32_t suite, uint32_t length, uint32_t shift, uint32_t origin) noexcept {
    uint8_t* base = g_left + 64;
    seed(base, length + shift + 1, origin);
    snapshot(g_snap, base, length);
    const uint8_t guard = contentByte(origin, length + shift);
    uint8_t* dest = base + shift;
    void* result = memmove(dest, base, length);
    if (result != dest) {
        return packFailure(suite, length, shift, resultMarker, expectedReturn, actualReturn);
    }
    for (uint32_t i = 0; i < length; ++i) {
        if (dest[i] != g_snap[i]) {
            return packFailure(suite, length, shift, i, g_snap[i], dest[i]);
        }
    }
    if (dest[length] != guard) {
        return packFailure(suite, length, shift, length, guard, dest[length]);
    }
    return 0;
}

NO_BUILTIN uint64_t moveDownCase(uint32_t suite, uint32_t length, uint32_t shift, uint32_t origin) noexcept {
    uint8_t* base = g_left + 64;
    seed(base, length + shift + 1, origin);
    snapshot(g_snap, base + shift, length);
    const uint8_t guard = contentByte(origin, length);
    void* result = memmove(base, base + shift, length);
    if (result != base) {
        return packFailure(suite, length, shift, resultMarker, expectedReturn, actualReturn);
    }
    for (uint32_t i = 0; i < length; ++i) {
        if (base[i] != g_snap[i]) {
            return packFailure(suite, length, shift, i, g_snap[i], base[i]);
        }
    }
    if (base[length] != guard) {
        return packFailure(suite, length, shift, length, guard, base[length]);
    }
    return 0;
}

NO_BUILTIN uint64_t runMemmove(uint32_t suite, uint32_t minLength, uint32_t maxLength, const uint32_t* shifts,
                               uint32_t shiftCount) noexcept {
    for (uint32_t length = minLength; length <= maxLength; ++length) {
        for (uint32_t si = 0; si < shiftCount; ++si) {
            const uint32_t shift = shifts[si];
            const uint32_t origin = 7U + length * 3U + shift;
            uint64_t failure = moveUpCase(suite, length, shift, origin);
            if (failure != 0) {
                return failure;
            }
            failure = moveDownCase(suite, length, shift, origin + 101U);
            if (failure != 0) {
                return failure;
            }
        }
    }
    return 0;
}

NO_BUILTIN uint64_t runMemcmp() noexcept {
    for (uint32_t length = 0; length <= maxSpan; ++length) {
        const uint32_t ao = length % maxAlign;
        const uint32_t bo = (length + 3U) % maxAlign;
        const uint32_t align = (ao << 4) | bo;
        const uint32_t origin = 41U + length;
        uint8_t* a = g_a + 32 + ao;
        uint8_t* b = g_b + 32 + bo;
        seed(a, length, origin);
        seed(b, length, origin);
        int result = memcmp(a, b, length);
        if (signCode(result) != 1U) {
            return packFailure(3, length, align, resultMarker, 1U, signCode(result));
        }
        for (uint32_t p = 0; p < length; ++p) {
            const uint8_t c = contentByte(origin, p);
            const uint8_t lo = static_cast<uint8_t>(c & 0xFEU);
            const uint8_t hi = static_cast<uint8_t>(lo | 0x01U);
            a[p] = hi;
            b[p] = lo;
            result = memcmp(a, b, length);
            if (signCode(result) != 2U) {
                return packFailure(3, length, align, p, 2U, signCode(result));
            }
            a[p] = lo;
            b[p] = hi;
            result = memcmp(a, b, length);
            if (signCode(result) != 0U) {
                return packFailure(3, length, align, p, 0U, signCode(result));
            }
            a[p] = c;
            b[p] = c;
        }
    }
    return 0;
}

NO_BUILTIN uint64_t runZeroFill() noexcept {
    static const uint32_t lengths[24] = {0,  1,  2,  3,  4,  7,  8,  15, 16, 17, 23,  24,
                                         31, 32, 33, 47, 63, 64, 65, 127, 128, 129, 159, 160};
    for (uint32_t li = 0; li < 24; ++li) {
        const uint32_t length = lengths[li];
        for (uint32_t align = 0; align < maxAlign; ++align) {
            uint8_t* dest = g_left + 64 + align;
            seed(dest, length + 1, 173U + li);
            const uint8_t guard = 0x5CU;
            dest[length] = guard;
            memset(dest, 0, length);
            for (uint32_t i = 0; i < length; ++i) {
                if (dest[i] != 0U) {
                    return packFailure(4, length, align, i, 0U, dest[i]);
                }
            }
            if (dest[length] != guard) {
                return packFailure(4, length, align, length, guard, dest[length]);
            }
        }
    }
    return 0;
}

NO_BUILTIN uint64_t runRegression() noexcept {
    static const uint32_t smallCounts[4] = {2, 4, 8, 16};
    static const uint32_t thresholdLengths[16] = {15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 130, 143, 144, 160};
    static const uint32_t thresholdShifts[9] = {1, 2, 7, 8, 15, 16, 17, 23, 24};
    for (uint32_t c = 0; c < 4; ++c) {
        const uint32_t length = smallCounts[c];
        for (uint32_t shift = 1; shift < length; ++shift) {
            const uint32_t origin = 71U + c * 13U + shift;
            uint64_t failure = moveDownCase(5, length, shift, origin);
            if (failure != 0) {
                return failure;
            }
            failure = moveUpCase(5, length, shift, origin + 53U);
            if (failure != 0) {
                return failure;
            }
        }
    }
    for (uint32_t li = 0; li < 16; ++li) {
        const uint32_t length = thresholdLengths[li];
        for (uint32_t si = 0; si < 9; ++si) {
            const uint32_t shift = thresholdShifts[si];
            const uint32_t origin = 131U + li * 11U + si;
            uint64_t failure = moveUpCase(5, length, shift, origin);
            if (failure != 0) {
                return failure;
            }
            failure = moveDownCase(5, length, shift, origin + 29U);
            if (failure != 0) {
                return failure;
            }
        }
    }
    return 0;
}

}

__attribute__((export_name("run_memory_tests"))) extern "C" uint64_t run_memory_tests() noexcept {
    uint64_t failure = runMemset();
    if (failure == 0) {
        failure = runMemcpy();
    }
    if (failure == 0) {
        static const uint32_t sweepShifts[24] = {1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12,
                                                 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24};
        failure = runMemmove(2, 1, maxSpan, sweepShifts, 24);
    }
    if (failure == 0) {
        failure = runMemcmp();
    }
    if (failure == 0) {
        failure = runZeroFill();
    }
    if (failure == 0) {
        failure = runRegression();
    }
    return failure;
}
