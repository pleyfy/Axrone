#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "core/body.h"
#include "core/events.h"

using axrone::physics::collectContactEvents;
using axrone::physics::Contact;
using axrone::physics::contactPairKey;
using axrone::physics::ContactEvent;
using axrone::physics::ContactEventState;
using axrone::physics::kContactEventBegin;
using axrone::physics::kContactEventEnd;
using axrone::physics::kContactEventStay;
using axrone::physics::kMaxShapesPerBody;
using axrone::physics::kSensorEventEnter;
using axrone::physics::kSensorEventExit;
using axrone::physics::kSensorEventStay;
using axrone::physics::kShapeIdGenMask;
using axrone::physics::shapeEncodeId;
using axrone::physics::shapeStorageKey;
using axrone::physics::shapeStorageSlot;
using axrone::physics::shapeStorageBody;
using axrone::physics::Vec3;
using axrone::physics::World;

namespace {

int gChecks = 0;
int gFailures = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        ++gChecks;                                                               \
        if (!(cond)) {                                                           \
            ++gFailures;                                                         \
            printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);              \
        }                                                                        \
    } while (0)

constexpr int32_t kMaxContacts = 1024;
constexpr int32_t kMaxEvents = 2048;
constexpr int32_t kMaxKeys = 1024;
constexpr int32_t kMaxFakeBodies = 1200;

World gWorld;
Contact gContacts[kMaxContacts];
ContactEvent gEvents[kMaxEvents];
uint64_t gKeyStore[kMaxKeys];
uint8_t gSensorStore[kMaxKeys];
uint64_t gPrevKeys[kMaxKeys];
uint8_t gPrevSensors[kMaxKeys];
axrone::physics::Body gBodies[kMaxFakeBodies];
uint16_t gSlotGen[kMaxFakeBodies * kMaxShapesPerBody];

ContactEventState newState() {
    ContactEventState state;
    state.keys = gKeyStore;
    state.sensors = gSensorStore;
    state.capacity = kMaxKeys;
    state.count = 0;
    return state;
}

void resetWorld() {
    memset(&gWorld, 0, sizeof(gWorld));
    memset(gContacts, 0, sizeof(gContacts));
    memset(gBodies, 0, sizeof(gBodies));
    memset(gSlotGen, 0, sizeof(gSlotGen));
    gWorld.contacts = gContacts;
    gWorld.contactCount = 0;
    gWorld.bodies = gBodies;
    gWorld.slotGen = gSlotGen;
    gWorld.highWater = kMaxFakeBodies;
}

void addContact(int32_t a, int32_t b, int32_t slotA, int32_t slotB, float nx, float ny, float nz, float pen) {
    Contact& c = gContacts[gWorld.contactCount++];
    c.a = a;
    c.b = b;
    c.shapeA = slotA;
    c.shapeB = slotB;
    c.normal = Vec3(nx, ny, nz);
    c.pen = pen;
}

void setSensor(int32_t bodyId, int32_t slot, int32_t on) {
    gBodies[bodyId].shapes[slot].sensor = on;
}

void setGeneration(int32_t bodyId, int32_t slot, uint16_t generation) {
    gSlotGen[bodyId * kMaxShapesPerBody + slot] = generation;
}

bool near(float left, float right) {
    float delta = left - right;
    if (delta < 0.0f) {
        delta = -delta;
    }
    return delta < 1e-6f;
}

uint64_t pairKey(int32_t a, int32_t slotA, int32_t b, int32_t slotB) {
    return contactPairKey(shapeStorageKey(a, slotA), shapeStorageKey(b, slotB));
}

bool sameSides(const ContactEvent& event, int32_t bodyA, int32_t bodyB) {
    return event.bodyA == bodyA && event.bodyB == bodyB;
}

bool sameShapes(const ContactEvent& event, int32_t bodyA, int32_t slotA, int32_t bodyB, int32_t slotB) {
    return event.shapeA == shapeStorageKey(bodyA, slotA) &&
           event.shapeB == shapeStorageKey(bodyB, slotB);
}

void testKeyContract() {
    static_assert(contactPairKey(3, 7) == contactPairKey(7, 3), "key must be symmetric");
    static_assert(contactPairKey(0, 1) == 1, "key formula");
    static_assert(shapeStorageKey(5, 3) == 43, "storage packs body and slot");
    static_assert(shapeStorageBody(shapeStorageKey(5, 3)) == 5, "storage decodes body");
    static_assert(shapeStorageSlot(shapeStorageKey(5, 3)) == 3, "storage decodes slot");
    CHECK(contactPairKey(shapeStorageKey(2, 1), shapeStorageKey(5, 0)) ==
          contactPairKey(shapeStorageKey(5, 0), shapeStorageKey(2, 1)));
    CHECK(pairKey(2, 1, 5, 0) == ((uint64_t(shapeStorageKey(2, 1)) << 32) | uint64_t(shapeStorageKey(5, 0))));
    CHECK(shapeStorageKey(2, 0) < shapeStorageKey(2, 1));
    CHECK(shapeStorageKey(2, 7) < shapeStorageKey(3, 0));
}

void testRecordLayout() {
    static_assert(sizeof(ContactEvent) == 40, "event record must stay 40 bytes");
    CHECK(sizeof(ContactEvent) == 40);
    CHECK(offsetof(ContactEvent, kind) == 0);
    CHECK(offsetof(ContactEvent, bodyA) == 4);
    CHECK(offsetof(ContactEvent, bodyB) == 8);
    CHECK(offsetof(ContactEvent, shapeA) == 12);
    CHECK(offsetof(ContactEvent, shapeB) == 16);
    CHECK(offsetof(ContactEvent, nx) == 20);
    CHECK(offsetof(ContactEvent, ny) == 24);
    CHECK(offsetof(ContactEvent, nz) == 28);
    CHECK(offsetof(ContactEvent, penetration) == 32);
    CHECK(offsetof(ContactEvent, reserved) == 36);
}

void testBeginFromEmpty() {
    resetWorld();
    addContact(2, 5, 1, 0, 0.0f, 1.0f, 0.0f, 0.25f);
    ContactEventState state = newState();
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 1);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(sameSides(gEvents[0], 2, 5));
    CHECK(sameShapes(gEvents[0], 2, 1, 5, 0));
    CHECK(near(gEvents[0].nx, 0.0f));
    CHECK(near(gEvents[0].ny, 1.0f));
    CHECK(near(gEvents[0].nz, 0.0f));
    CHECK(near(gEvents[0].penetration, 0.25f));
    CHECK(near(gEvents[0].reserved, 0.0f));
    CHECK(state.count == 1);
    CHECK(state.keys[0] == pairKey(2, 1, 5, 0));
    CHECK(state.sensors[0] == 0);
}

void testStay() {
    resetWorld();
    addContact(2, 5, 1, 0, 0.0f, 1.0f, 0.0f, 0.25f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);

    gWorld.contactCount = 0;
    addContact(2, 5, 1, 0, 0.1f, 0.2f, 0.9f, 0.4f);
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kContactEventStay);
    CHECK(sameShapes(gEvents[0], 2, 1, 5, 0));
    CHECK(near(gEvents[0].nx, 0.1f));
    CHECK(near(gEvents[0].penetration, 0.4f));
    CHECK(state.count == 1);
}

void testEnd() {
    resetWorld();
    addContact(2, 5, 1, 0, 0.0f, 1.0f, 0.0f, 0.25f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);

    gWorld.contactCount = 0;
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 1);
    CHECK(gEvents[0].kind == kContactEventEnd);
    CHECK(sameSides(gEvents[0], 2, 5));
    CHECK(sameShapes(gEvents[0], 2, 1, 5, 0));
    CHECK(near(gEvents[0].nx, 0.0f));
    CHECK(near(gEvents[0].ny, 0.0f));
    CHECK(near(gEvents[0].nz, 0.0f));
    CHECK(near(gEvents[0].penetration, 0.0f));
    CHECK(near(gEvents[0].reserved, 0.0f));
    CHECK(state.count == 0);
}

void testTwoShapePairsProduceTwoEvents() {
    resetWorld();
    addContact(2, 5, 0, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    addContact(2, 5, 1, 0, 0.0f, 1.0f, 0.0f, 0.3f);
    ContactEventState state = newState();
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 2);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(gEvents[1].kind == kContactEventBegin);
    CHECK(sameShapes(gEvents[0], 2, 0, 5, 0));
    CHECK(sameShapes(gEvents[1], 2, 1, 5, 0));
    CHECK(state.keys[0] < state.keys[1]);
    CHECK(state.count == 2);
}

void testManifoldCollapsePerShapePair() {
    resetWorld();
    addContact(4, 9, 0, 0, 1.0f, 2.0f, 3.0f, 0.11f);
    addContact(4, 9, 0, 0, 4.0f, 5.0f, 6.0f, 0.99f);
    addContact(4, 9, 0, 0, 7.0f, 8.0f, 9.0f, 0.55f);
    ContactEventState state = newState();
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 1);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(near(gEvents[0].nx, 1.0f));
    CHECK(near(gEvents[0].penetration, 0.11f));
    CHECK(state.count == 1);

    gWorld.contactCount = 0;
    addContact(4, 9, 0, 0, 4.0f, 5.0f, 6.0f, 0.99f);
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kContactEventStay);
    CHECK(near(gEvents[0].nx, 4.0f));
    CHECK(near(gEvents[0].penetration, 0.99f));
}

void testSensorEnterStayExit() {
    resetWorld();
    setSensor(2, 0, 1);
    addContact(2, 5, 0, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kSensorEventEnter);
    CHECK(sameSides(gEvents[0], 2, 5));
    CHECK(state.sensors[0] == 1);

    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kSensorEventStay);

    gWorld.contactCount = 0;
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kSensorEventExit);
    CHECK(sameSides(gEvents[0], 2, 5));
    CHECK(near(gEvents[0].nx, 0.0f));
    CHECK(near(gEvents[0].ny, 0.0f));
    CHECK(near(gEvents[0].penetration, 0.0f));
    CHECK(state.count == 0);
}

void testSensorSideNormalization() {
    resetWorld();
    setSensor(5, 0, 1);
    addContact(2, 5, 0, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kSensorEventEnter);
    CHECK(sameSides(gEvents[0], 5, 2));
    CHECK(sameShapes(gEvents[0], 5, 0, 2, 0));
    CHECK(near(gEvents[0].ny, -1.0f));
    CHECK(state.sensors[0] == 2);

    gWorld.contactCount = 0;
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kSensorEventExit);
    CHECK(sameSides(gEvents[0], 5, 2));
    CHECK(sameShapes(gEvents[0], 5, 0, 2, 0));
    CHECK(near(gEvents[0].penetration, 0.0f));
}

void testBothSidesSensorKeepsStorageOrder() {
    resetWorld();
    setSensor(2, 3, 1);
    setSensor(5, 1, 1);
    addContact(2, 5, 3, 1, 1.0f, 0.0f, 0.0f, 0.4f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].kind == kSensorEventEnter);
    CHECK(sameSides(gEvents[0], 2, 5));
    CHECK(sameShapes(gEvents[0], 2, 3, 5, 1));
    CHECK(near(gEvents[0].nx, 1.0f));
    CHECK(state.sensors[0] == 3);
}

void testSensorAndCollisionSeparated() {
    resetWorld();
    setSensor(5, 1, 1);
    addContact(2, 5, 0, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    addContact(2, 5, 0, 1, 0.0f, 1.0f, 0.0f, 0.3f);
    ContactEventState state = newState();
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 2);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(sameShapes(gEvents[0], 2, 0, 5, 0));
    CHECK(gEvents[1].kind == kSensorEventEnter);
    CHECK(sameShapes(gEvents[1], 5, 1, 2, 0));

    gWorld.contactCount = 0;
    addContact(2, 5, 0, 0, 0.0f, 1.0f, 0.0f, 0.25f);
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 2);
    CHECK(gEvents[0].kind == kContactEventStay);
    CHECK(gEvents[1].kind == kSensorEventExit);
    CHECK(sameShapes(gEvents[0], 2, 0, 5, 0));
    CHECK(sameShapes(gEvents[1], 5, 1, 2, 0));
    CHECK(state.count == 1);
    CHECK(state.sensors[0] == 0);
}

void testGenerationEncodedInShapeIds() {
    resetWorld();
    setGeneration(2, 1, 7);
    setGeneration(5, 0, kShapeIdGenMask);
    addContact(2, 5, 1, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 1);
    CHECK(gEvents[0].shapeA == shapeEncodeId(7, 2, 1));
    CHECK(gEvents[0].shapeB == shapeEncodeId(int32_t(kShapeIdGenMask), 5, 0));
}

void testReverseInsertionOrderAscends() {
    resetWorld();
    addContact(10, 20, 3, 2, 1.0f, 0.0f, 0.0f, 0.5f);
    addContact(1, 3, 0, 0, 0.0f, 1.0f, 0.0f, 0.7f);
    ContactEventState state = newState();
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 2);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(sameShapes(gEvents[0], 1, 0, 3, 0));
    CHECK(gEvents[1].kind == kContactEventBegin);
    CHECK(sameShapes(gEvents[1], 10, 3, 20, 2));
    CHECK(state.keys[0] < state.keys[1]);
    CHECK(state.keys[0] == pairKey(1, 0, 3, 0));
    CHECK(state.keys[1] == pairKey(10, 3, 20, 2));
}

void testOrderedGroups() {
    resetWorld();
    addContact(1, 2, 0, 0, 0.0f, 1.0f, 0.0f, 0.1f);
    addContact(3, 4, 0, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 2);

    gWorld.contactCount = 0;
    addContact(3, 4, 0, 0, 0.5f, 0.0f, 0.0f, 0.3f);
    addContact(5, 6, 0, 0, 0.5f, 0.0f, 0.0f, 0.4f);
    addContact(7, 8, 0, 0, 0.5f, 0.0f, 0.0f, 0.6f);
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 4);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(gEvents[1].kind == kContactEventBegin);
    CHECK(gEvents[2].kind == kContactEventStay);
    CHECK(gEvents[3].kind == kContactEventEnd);
    CHECK(sameShapes(gEvents[0], 5, 0, 6, 0));
    CHECK(sameShapes(gEvents[1], 7, 0, 8, 0));
    CHECK(contactPairKey(gEvents[0].shapeA, gEvents[0].shapeB) <
          contactPairKey(gEvents[1].shapeA, gEvents[1].shapeB));
    CHECK(sameShapes(gEvents[2], 3, 0, 4, 0));
    CHECK(near(gEvents[2].penetration, 0.3f));
    CHECK(sameShapes(gEvents[3], 1, 0, 2, 0));

    gWorld.contactCount = 0;
    addContact(5, 6, 0, 0, 0.5f, 0.0f, 0.0f, 0.4f);
    const int32_t stayCount = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(stayCount == 3);
    CHECK(gEvents[0].kind == kContactEventStay);
    CHECK(gEvents[1].kind == kContactEventEnd);
    CHECK(gEvents[2].kind == kContactEventEnd);
    CHECK(sameShapes(gEvents[0], 5, 0, 6, 0));
    CHECK(sameShapes(gEvents[1], 3, 0, 4, 0));
    CHECK(sameShapes(gEvents[2], 7, 0, 8, 0));
    CHECK(contactPairKey(gEvents[1].shapeA, gEvents[1].shapeB) <
          contactPairKey(gEvents[2].shapeA, gEvents[2].shapeB));
}

void testThreeFramesStateUpdate() {
    resetWorld();
    ContactEventState state = newState();

    addContact(1, 4, 0, 0, 1.0f, 0.0f, 0.0f, 0.5f);
    addContact(2, 7, 1, 0, 1.0f, 0.0f, 0.0f, 0.5f);
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 2);
    CHECK(state.count == 2);
    CHECK(state.keys[0] == pairKey(1, 0, 4, 0));
    CHECK(state.keys[1] == pairKey(2, 1, 7, 0));

    gWorld.contactCount = 0;
    addContact(2, 7, 1, 0, 1.0f, 0.0f, 0.0f, 0.5f);
    addContact(9, 3, 0, 2, 1.0f, 0.0f, 0.0f, 0.5f);
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 3);
    CHECK(state.count == 2);
    CHECK(state.keys[0] == pairKey(2, 1, 7, 0));
    CHECK(state.keys[1] == pairKey(3, 2, 9, 0));

    gWorld.contactCount = 0;
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 2);
    CHECK(state.count == 0);
}

void testCapacityOneShortRejected() {
    resetWorld();
    addContact(1, 2, 0, 0, 0.0f, 1.0f, 0.0f, 0.1f);
    addContact(3, 4, 0, 0, 0.0f, 1.0f, 0.0f, 0.2f);
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 2);

    gWorld.contactCount = 0;
    addContact(5, 6, 0, 0, 0.0f, 1.0f, 0.0f, 0.1f);
    memcpy(gPrevKeys, state.keys, sizeof(uint64_t) * state.count);
    memcpy(gPrevSensors, state.sensors, sizeof(uint8_t) * state.count);
    const int32_t savedCount = state.count;
    const int32_t result = collectContactEvents(gWorld, state, gEvents, savedCount);
    CHECK(result == -1);
    CHECK(state.count == savedCount);
    CHECK(memcmp(gPrevKeys, state.keys, sizeof(uint64_t) * savedCount) == 0);
    CHECK(memcmp(gPrevSensors, state.sensors, sizeof(uint8_t) * savedCount) == 0);

    const int32_t exact = collectContactEvents(gWorld, state, gEvents, savedCount + 1);
    CHECK(exact == 3);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(gEvents[1].kind == kContactEventEnd);
    CHECK(gEvents[2].kind == kContactEventEnd);
    CHECK(sameShapes(gEvents[0], 5, 0, 6, 0));
    CHECK(sameShapes(gEvents[1], 1, 0, 2, 0));
    CHECK(sameShapes(gEvents[2], 3, 0, 4, 0));
}

void testChunkedFrameOverStackLimit() {
    resetWorld();
    for (int32_t i = 599; i >= 0; --i) {
        addContact(i, 600 + i, 0, 0, 0.0f, float(i), 1.0f, float(i) * 0.01f);
    }
    ContactEventState state = newState();
    const int32_t count = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(count == 600);
    CHECK(state.count == 600);
    bool ascending = true;
    for (int32_t i = 1; i < 600; ++i) {
        if (gEvents[i - 1].kind != kContactEventBegin || gEvents[i].kind != kContactEventBegin) {
            ascending = false;
        }
        if (gEvents[i - 1].shapeA >= gEvents[i].shapeA) {
            ascending = false;
        }
    }
    CHECK(ascending);
    CHECK(gEvents[0].bodyA == 0);
    CHECK(gEvents[0].bodyB == 600);
    CHECK(gEvents[599].bodyA == 599);
    CHECK(gEvents[599].bodyB == 1199);
    CHECK(state.keys[0] == pairKey(0, 0, 600, 0));
    CHECK(state.keys[599] == pairKey(599, 0, 1199, 0));

    gWorld.contactCount = 0;
    const int32_t endCount = collectContactEvents(gWorld, state, gEvents, kMaxEvents);
    CHECK(endCount == 600);
    CHECK(gEvents[0].kind == kContactEventEnd);
    CHECK(gEvents[0].bodyA == 0);
    CHECK(state.count == 0);
}

void testDeterministicRepeat() {
    resetWorld();
    addContact(7, 3, 1, 2, 1.0f, 0.0f, 0.0f, 0.3f);
    addContact(8, 2, 0, 0, 0.0f, 1.0f, 0.0f, 0.4f);
    addContact(7, 3, 1, 2, 0.0f, 0.0f, 1.0f, 0.9f);
    setSensor(3, 2, 1);
    ContactEventState first = newState();
    first.keys = gPrevKeys;
    first.sensors = gPrevSensors;
    const int32_t firstCount = collectContactEvents(gWorld, first, gEvents, 64);
    CHECK(firstCount == 2);
    if (firstCount < 0) {
        return;
    }
    ContactEvent copy[64];
    memcpy(copy, gEvents, sizeof(ContactEvent) * firstCount);
    CHECK(gEvents[0].kind == kContactEventBegin);
    CHECK(sameShapes(gEvents[0], 2, 0, 8, 0));
    CHECK(near(gEvents[0].ny, -1.0f));
    CHECK(gEvents[1].kind == kSensorEventEnter);
    CHECK(sameShapes(gEvents[1], 3, 2, 7, 1));
    CHECK(near(gEvents[1].nx, -1.0f));

    ContactEventState second = newState();
    const int32_t secondCount = collectContactEvents(gWorld, second, gEvents, 64);
    CHECK(firstCount == secondCount);
    CHECK(first.count == second.count);
    bool same = true;
    for (int32_t i = 0; i < firstCount; ++i) {
        if (memcmp(&copy[i], &gEvents[i], sizeof(ContactEvent)) != 0) {
            same = false;
        }
    }
    for (int32_t i = 0; i < first.count; ++i) {
        if (first.keys[i] != second.keys[i] || first.sensors[i] != second.sensors[i]) {
            same = false;
        }
    }
    CHECK(same);
}

void testInvalidInputsRejected() {
    resetWorld();
    addContact(1, 2, 0, 0, 0.0f, 1.0f, 0.0f, 0.1f);

    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, nullptr, 16) == -1);
    CHECK(collectContactEvents(gWorld, state, gEvents, -1) == -1);

    ContactEventState nullKeys = newState();
    nullKeys.keys = nullptr;
    CHECK(collectContactEvents(gWorld, nullKeys, gEvents, 16) == -1);

    ContactEventState nullSensors = newState();
    nullSensors.sensors = nullptr;
    CHECK(collectContactEvents(gWorld, nullSensors, gEvents, 16) == -1);

    ContactEventState zeroCapacity = newState();
    zeroCapacity.capacity = 0;
    CHECK(collectContactEvents(gWorld, zeroCapacity, gEvents, 16) == -1);

    ContactEventState negativeCount = newState();
    negativeCount.count = -1;
    CHECK(collectContactEvents(gWorld, negativeCount, gEvents, 16) == -1);

    ContactEventState overCount = newState();
    overCount.count = overCount.capacity + 1;
    CHECK(collectContactEvents(gWorld, overCount, gEvents, 16) == -1);

    const int32_t savedContacts = gWorld.contactCount;
    gWorld.contactCount = -1;
    CHECK(collectContactEvents(gWorld, state, gEvents, 16) == -1);
    gWorld.contactCount = savedContacts;

    axrone::physics::Body* savedBodies = gWorld.bodies;
    gWorld.bodies = nullptr;
    CHECK(collectContactEvents(gWorld, state, gEvents, 16) == -1);
    gWorld.bodies = savedBodies;

    CHECK(state.count == 0);
}

void testEmptyFrameEmptyState() {
    resetWorld();
    ContactEventState state = newState();
    CHECK(collectContactEvents(gWorld, state, gEvents, 0) == 0);
    CHECK(collectContactEvents(gWorld, state, gEvents, kMaxEvents) == 0);
    CHECK(state.count == 0);
}

}

int main() {
    testKeyContract();
    testRecordLayout();
    testBeginFromEmpty();
    testStay();
    testEnd();
    testTwoShapePairsProduceTwoEvents();
    testManifoldCollapsePerShapePair();
    testSensorEnterStayExit();
    testSensorSideNormalization();
    testBothSidesSensorKeepsStorageOrder();
    testSensorAndCollisionSeparated();
    testGenerationEncodedInShapeIds();
    testReverseInsertionOrderAscends();
    testOrderedGroups();
    testThreeFramesStateUpdate();
    testCapacityOneShortRejected();
    testChunkedFrameOverStackLimit();
    testDeterministicRepeat();
    testInvalidInputsRejected();
    testEmptyFrameEmptyState();

    printf("events_test: %d checks, %d failures\n", gChecks, gFailures);
    return gFailures == 0 ? 0 : 1;
}
