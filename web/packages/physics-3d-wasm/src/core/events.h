#pragma once

#include <stdint.h>

#include "core/world.h"

namespace axrone::physics {

enum ContactEventKind : int32_t {
    kContactEventBegin = 0,
    kContactEventStay = 1,
    kContactEventEnd = 2,
    kSensorEventEnter = 3,
    kSensorEventStay = 4,
    kSensorEventExit = 5
};

struct ContactEvent {
    int32_t kind;
    int32_t bodyA;
    int32_t bodyB;
    int32_t shapeA;
    int32_t shapeB;
    float nx;
    float ny;
    float nz;
    float penetration;
    float reserved;
};

struct ContactEventState {
    uint64_t* keys;
    uint8_t* sensors;
    int32_t capacity;
    int32_t count;
};

static_assert(sizeof(ContactEvent) == 40, "contact event record must stay 40 bytes");

AXRONE_PHYSICS_INLINE constexpr int32_t shapeStorageKey(int32_t bodyId, int32_t slot) {
    return (bodyId << kShapeIdSlotBits) | (slot & kShapeIdSlotMask);
}

AXRONE_PHYSICS_INLINE constexpr int32_t shapeStorageBody(int32_t storage) {
    return storage >> kShapeIdSlotBits;
}

AXRONE_PHYSICS_INLINE constexpr int32_t shapeStorageSlot(int32_t storage) {
    return storage & kShapeIdSlotMask;
}

AXRONE_PHYSICS_INLINE constexpr uint64_t contactPairKey(int32_t a, int32_t b) {
    const int32_t low = a < b ? a : b;
    const int32_t high = a < b ? b : a;
    return (uint64_t(low) << 32) | uint64_t(high);
}

int32_t collectContactEvents(const World& world, ContactEventState& state, ContactEvent* events, int32_t capacity);

}
