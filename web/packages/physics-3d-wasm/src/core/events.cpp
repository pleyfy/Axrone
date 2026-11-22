#include "core/events.h"

#include "platform/memory.h"

namespace axrone::physics {

namespace {

struct EventItemData {
    int32_t sensorBits;
    float nx;
    float ny;
    float nz;
    float pen;
};

struct EventScratch {
    uint64_t keys[kEventCapacity];
    EventItemData data[kEventCapacity];
    int16_t buckets[kEventHashCapacity];
};

static_assert((kEventHashCapacity & (kEventHashCapacity - 1)) == 0,
              "event hash capacity must be a power of two");
static_assert(kEventCapacity <= 32767, "event index must fit in int16_t");

// The collector is called from the single-threaded wasm ABI after a step.
// Keeping the scratch in .bss avoids a large stack frame and makes collection
// O(C + U log U) instead of re-scanning the contact list in five passes.
EventScratch g_eventScratch;

uint32_t eventHash64(uint64_t key) {
    key ^= key >> 33;
    key *= 0xff51afd7ed558ccdULL;
    key ^= key >> 33;
    return static_cast<uint32_t>(key);
}

int32_t findSortedKey(const uint64_t* keys, int32_t count, uint64_t key) {
    int32_t low = 0;
    int32_t high = count;
    while (low < high) {
        const int32_t middle = low + ((high - low) >> 1);
        if (keys[middle] < key) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return (low < count && keys[low] == key) ? low : -1;
}

void sortEvents(uint64_t* keys, EventItemData* data, int32_t count) {
    for (int32_t gap = count >> 1; gap > 0; gap >>= 1) {
        for (int32_t i = gap; i < count; ++i) {
            const uint64_t key = keys[i];
            const EventItemData item = data[i];
            int32_t j = i;
            while (j >= gap && keys[j - gap] > key) {
                keys[j] = keys[j - gap];
                data[j] = data[j - gap];
                j -= gap;
            }
            keys[j] = key;
            data[j] = item;
        }
    }
}

int32_t eventShapeId(const World& world, int32_t bodyId, int32_t slot) {
    int32_t generation = 0;
    if (world.slotGen != nullptr && bodyId >= 0 && bodyId < world.highWater) {
        const uintptr_t index =
            static_cast<uintptr_t>(bodyId) * kMaxShapesPerBody + static_cast<uintptr_t>(slot);
        generation = static_cast<int32_t>(world.slotGen[index] & kShapeIdGenMask);
    }
    return shapeEncodeId(generation, bodyId, slot);
}

void writePairEvent(
    const World& world,
    ContactEvent* events,
    int32_t index,
    int32_t kind,
    uint64_t key,
    const EventItemData* item,
    int32_t sensorBits
) {
    events[index].kind = kind;
    events[index].reserved = 0.0f;
    int32_t storageA = static_cast<int32_t>(key >> 32);
    int32_t storageB = static_cast<int32_t>(static_cast<uint32_t>(key));
    if (sensorBits == 2) {
        const int32_t swap = storageA;
        storageA = storageB;
        storageB = swap;
    }
    events[index].bodyA = shapeStorageBody(storageA);
    events[index].bodyB = shapeStorageBody(storageB);
    events[index].shapeA = eventShapeId(world, events[index].bodyA, shapeStorageSlot(storageA));
    events[index].shapeB = eventShapeId(world, events[index].bodyB, shapeStorageSlot(storageB));
    if (item != nullptr) {
        events[index].nx = item->nx;
        events[index].ny = item->ny;
        events[index].nz = item->nz;
        events[index].penetration = item->pen;
        return;
    }
    events[index].nx = 0.0f;
    events[index].ny = 0.0f;
    events[index].nz = 0.0f;
    events[index].penetration = 0.0f;
}

int32_t eventKind(int32_t baseKind, int32_t sensorBits) {
    return sensorBits != 0 ? baseKind + 3 : baseKind;
}

} // namespace

int32_t collectContactEvents(
    const World& world,
    ContactEventState& state,
    ContactEvent* events,
    int32_t capacity
) {
    if (events == nullptr || capacity < 0 || state.keys == nullptr || state.sensors == nullptr ||
        state.capacity < 1 || state.count < 0 || state.count > state.capacity ||
        world.contactCount < 0 || world.bodies == nullptr ||
        (world.contacts == nullptr && world.contactCount > 0)) {
        return -1;
    }

    EventScratch& scratch = g_eventScratch;
    int32_t nextCount = 0;

    if (world.contactCount > 0) {
        memset(scratch.buckets, 0xFF, sizeof(scratch.buckets));
        constexpr uint32_t kMask = static_cast<uint32_t>(kEventHashCapacity - 1);

        for (int32_t i = 0; i < world.contactCount; ++i) {
            const Contact& contact = world.contacts[i];
            const int32_t storageA = shapeStorageKey(contact.a, contact.shapeA);
            const int32_t storageB = shapeStorageKey(contact.b, contact.shapeB);
            const uint64_t key = contactPairKey(storageA, storageB);

            uint32_t slot = eventHash64(key) & kMask;
            bool exists = false;
            while (scratch.buckets[slot] >= 0) {
                if (scratch.keys[scratch.buckets[slot]] == key) {
                    exists = true;
                    break;
                }
                slot = (slot + 1) & kMask;
            }
            if (exists) {
                continue;
            }
            if (nextCount >= state.capacity || nextCount >= kEventCapacity) {
                return -1;
            }

            const bool swapped = storageB < storageA;
            const int32_t lowStorage = swapped ? storageB : storageA;
            const int32_t highStorage = swapped ? storageA : storageB;
            const int32_t lowBody = shapeStorageBody(lowStorage);
            const int32_t lowSlot = shapeStorageSlot(lowStorage);
            const int32_t highBody = shapeStorageBody(highStorage);
            const int32_t highSlot = shapeStorageSlot(highStorage);
            const bool sensorLow = world.bodies[lowBody].shapes[lowSlot].sensor != 0;
            const bool sensorHigh = world.bodies[highBody].shapes[highSlot].sensor != 0;
            const int32_t sensorBits = (sensorLow ? 1 : 0) | (sensorHigh ? 2 : 0);
            const bool normalSwap = swapped != (sensorBits == 2);
            const float sign = normalSwap ? -1.0f : 1.0f;

            scratch.keys[nextCount] = key;
            EventItemData& item = scratch.data[nextCount];
            item.sensorBits = sensorBits;
            item.nx = contact.normal.x * sign;
            item.ny = contact.normal.y * sign;
            item.nz = contact.normal.z * sign;
            item.pen = contact.pen;
            scratch.buckets[slot] = static_cast<int16_t>(nextCount);
            ++nextCount;
        }
    }

    sortEvents(scratch.keys, scratch.data, nextCount);

    const uint64_t* previous = state.keys;
    const uint8_t* previousSensors = state.sensors;
    const int32_t previousCount = state.count;

    int32_t stayCount = 0;
    {
        int32_t previousIndex = 0;
        int32_t nextIndex = 0;
        while (previousIndex < previousCount && nextIndex < nextCount) {
            if (previous[previousIndex] == scratch.keys[nextIndex]) {
                ++stayCount;
                ++previousIndex;
                ++nextIndex;
            } else if (previous[previousIndex] < scratch.keys[nextIndex]) {
                ++previousIndex;
            } else {
                ++nextIndex;
            }
        }
    }

    const int32_t endCount = previousCount - stayCount;
    if (nextCount + endCount > capacity) {
        return -1;
    }

    int32_t written = 0;
    for (int32_t i = 0; i < nextCount; ++i) {
        if (findSortedKey(previous, previousCount, scratch.keys[i]) < 0) {
            writePairEvent(
                world, events, written++,
                eventKind(kContactEventBegin, scratch.data[i].sensorBits),
                scratch.keys[i], &scratch.data[i], scratch.data[i].sensorBits);
        }
    }
    for (int32_t i = 0; i < nextCount; ++i) {
        if (findSortedKey(previous, previousCount, scratch.keys[i]) >= 0) {
            writePairEvent(
                world, events, written++,
                eventKind(kContactEventStay, scratch.data[i].sensorBits),
                scratch.keys[i], &scratch.data[i], scratch.data[i].sensorBits);
        }
    }
    for (int32_t i = 0; i < previousCount; ++i) {
        if (findSortedKey(scratch.keys, nextCount, previous[i]) < 0) {
            writePairEvent(
                world, events, written++,
                eventKind(kContactEventEnd, previousSensors[i]),
                previous[i], nullptr, previousSensors[i]);
        }
    }

    for (int32_t i = 0; i < nextCount; ++i) {
        state.keys[i] = scratch.keys[i];
        state.sensors[i] = static_cast<uint8_t>(scratch.data[i].sensorBits);
    }
    state.count = nextCount;
    return written;
}

} // namespace axrone::physics
