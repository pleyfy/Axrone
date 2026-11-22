#pragma once

#include <stdint.h>

#include "platform/wasm.h"

namespace axrone::physics {

struct PhaseTimers {
    uint32_t recordVersion;
    uint32_t recordBytes;
    double integrate;
    double broadphase;
    double collide;
    double prepare;
    double assembleConstraints;
    double solveVelocities;
    double solvePositions;
    double sleepAndCacheSwap;
    double pack;
    double sweepSort;
    double pairLoop;
};

static_assert(sizeof(PhaseTimers) == 96, "phase timer record must stay 96 bytes");

#if defined(AXRONE_PHYSICS_PHASE_TIMERS) && AXRONE_PHYSICS_TARGET_WASM
#define AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE 1
#else
#define AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE 0
#endif

#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE

struct PhaseNanoseconds {
    uint64_t integrate;
    uint64_t broadphase;
    uint64_t collide;
    uint64_t prepare;
    uint64_t assembleConstraints;
    uint64_t solveVelocities;
    uint64_t solvePositions;
    uint64_t sleepAndCacheSwap;
    uint64_t pack;
    uint64_t sweepSort;
    uint64_t pairLoop;
};

extern "C" {
double now() __attribute__((import_module("env"), import_name("now")));
}

struct PhaseTimerScope {
    uint64_t* slot;
    double start;

    PhaseTimerScope(uint64_t& target, bool enabled = true)
        : slot(enabled ? &target : nullptr), start(enabled ? now() * 1e9 : 0.0) {}

    ~PhaseTimerScope() { close(); }

    PhaseTimerScope(const PhaseTimerScope&) = delete;
    PhaseTimerScope& operator=(const PhaseTimerScope&) = delete;

    void close() {
        if (slot == nullptr) {
            return;
        }
        uint64_t* target = slot;
        slot = nullptr;
        *target += static_cast<uint64_t>(now() * 1e9 - start);
    }
};

inline double phaseSecondsFromNanoseconds(uint64_t nanoseconds) {
    return static_cast<double>(nanoseconds) * 1e-9;
}

#define AXRONE_PHASE(scopeName, target) PhaseTimerScope scopeName{target}
#define AXRONE_PHASE_COND(scopeName, target, condition) PhaseTimerScope scopeName{target, condition}
#define AXRONE_PHASE_CLOSE(scopeName) scopeName.close()

#else

struct PhaseTimerSink {
    void close() {}
};

#define AXRONE_PHASE(scopeName, target) [[maybe_unused]] PhaseTimerSink scopeName
#define AXRONE_PHASE_COND(scopeName, target, condition) [[maybe_unused]] PhaseTimerSink scopeName
#define AXRONE_PHASE_CLOSE(scopeName) (void)0

#endif

}
