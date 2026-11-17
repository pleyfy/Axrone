#pragma once

#include <stdint.h>

#include "core/world.h"

namespace axrone::physics {

constexpr int32_t kStandardBoxCount = 256;
constexpr int32_t kStandardSteps = 240;
constexpr float kStandardDt = 1.0f / 60.0f;

inline int32_t addStandardGround(World& world) {
    const int32_t id = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id < 0) {
        return id;
    }
    world.setBox(id, 20.0f, 0.5f, 20.0f, 0.0f);
    world.setMaterial(id, 0.8f, 0.0f);
    return id;
}

inline void addStandardBodies(World& world) {
    addStandardGround(world);

    for (int32_t i = 0; i < kStandardBoxCount; ++i) {
        const int32_t layer = i / 64;
        const int32_t within = i % 64;
        const int32_t xIndex = within % 8;
        const int32_t zIndex = within / 8;

        const float x = static_cast<float>(xIndex - 3);
        const float y = 1.0f + static_cast<float>(layer);
        const float z = static_cast<float>(zIndex - 3);

        const int32_t id = world.createBody(kBodyTypeDynamic, x, y, z, 0.0f, 0.0f, 0.0f, 1.0f);
        if (id < 0) {
            return;
        }
        world.setBox(id, 0.4f, 0.4f, 0.4f, 1.0f);
        world.setMaterial(id, 0.7f, 0.0f);
    }
}

inline void runStandardScene(World& world) {
    for (int32_t stepIndex = 0; stepIndex < kStandardSteps; ++stepIndex) {
        world.step(kStandardDt, 10, 4);
    }
}

}
