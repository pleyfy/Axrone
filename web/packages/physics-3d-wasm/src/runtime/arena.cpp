#include "runtime/arena.h"

#include "platform/wasm.h"

namespace axrone::physics {

void Arena::init(unsigned char* base, size_t capacity) {
    base_ = base;
    capacity_ = capacity;
    offset_ = 0;
}

void Arena::reset() {
    offset_ = 0;
}

void* Arena::alloc(size_t size, size_t alignment) {
    if (base_ == nullptr || size == 0 || alignment == 0) {
        return nullptr;
    }
    if ((alignment & (alignment - 1)) != 0) {
        return nullptr;
    }

    // Use 64-bit arithmetic for the whole computation. wasm32 has a 32-bit
    // size_t/uintptr_t, so base + offset and aligned + size can wrap before
    // they are compared with the arena capacity.
    const uint64_t base = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(base_));
    const uint64_t start = base + static_cast<uint64_t>(offset_);
    const uint64_t mask = static_cast<uint64_t>(alignment) - 1ULL;
    const uint64_t aligned = (start + mask) & ~mask;
    const uint64_t end = aligned + static_cast<uint64_t>(size);
    if (end < aligned) {
        return nullptr;
    }
#if AXRONE_PHYSICS_TARGET_WASM
    if (end > 0xFFFFFFFFULL) {
        return nullptr;
    }
#endif

    const size_t endOffset = static_cast<size_t>(end - base);
    if (endOffset > capacity_ && !growTo(endOffset)) {
        return nullptr;
    }

    offset_ = endOffset;
    return reinterpret_cast<void*>(static_cast<uintptr_t>(aligned));
}

unsigned char* Arena::base() const {
    return base_;
}

size_t Arena::used() const {
    return offset_;
}

size_t Arena::capacity() const {
    return capacity_;
}

void Arena::shrinkTo(size_t offset) {
    if (offset < offset_) {
        offset_ = offset;
    }
}

bool Arena::growTo(size_t requiredBytes) {
#if AXRONE_PHYSICS_TARGET_WASM
    constexpr uint64_t kPageBytes = 65536ULL;
    constexpr uint64_t kMaxLinearBytes = 0xFFFFFFFFULL;

    const uint64_t base = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(base_));
    const uint64_t currentBytes =
        static_cast<uint64_t>(__builtin_wasm_memory_size(0)) * kPageBytes;
    const uint64_t currentCapacity = currentBytes > base ? currentBytes - base : 0ULL;
    if (static_cast<uint64_t>(requiredBytes) <= currentCapacity) {
        capacity_ = currentCapacity > kMaxLinearBytes
            ? static_cast<size_t>(kMaxLinearBytes)
            : static_cast<size_t>(currentCapacity);
        return true;
    }

    const uint64_t neededBytes = static_cast<uint64_t>(requiredBytes) - currentCapacity;
    const uint64_t neededPages = (neededBytes + (kPageBytes - 1ULL)) / kPageBytes;
    if (neededPages == 0ULL || neededPages > 65536ULL) {
        return false;
    }
    if (__builtin_wasm_memory_grow(0, static_cast<size_t>(neededPages)) == static_cast<size_t>(-1)) {
        return false;
    }

    const uint64_t updatedCapacity = currentCapacity + neededPages * kPageBytes;
    capacity_ = updatedCapacity > kMaxLinearBytes
        ? static_cast<size_t>(kMaxLinearBytes)
        : static_cast<size_t>(updatedCapacity);
    return true;
#else
    (void)requiredBytes;
    return false;
#endif
}

}
