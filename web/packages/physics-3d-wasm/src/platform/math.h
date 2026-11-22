#pragma once

#include "platform/wasm.h"

namespace axrone::physics {

constexpr float kFloatMax = 3.402823466e38f;

AXRONE_PHYSICS_INLINE float sqrtf(float value) {
    return __builtin_sqrtf(value);
}

AXRONE_PHYSICS_INLINE float fabsf(float value) {
    return __builtin_fabsf(value);
}

AXRONE_PHYSICS_INLINE bool isFinite(float value) {
    return value == value && value <= kFloatMax && value >= -kFloatMax;
}

AXRONE_PHYSICS_INLINE float clampf(float value, float low, float high) {
    return value < low ? low : (value > high ? high : value);
}

}
