#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#include "core/contact.h"

using namespace axrone::physics;

namespace {

int g_checks = 0;
int g_failures = 0;

#define CHECK_LABEL(condition, label)                                             \
    do {                                                                          \
        ++g_checks;                                                               \
        if (!(condition)) {                                                       \
            printf("FAIL %s:%d %s\n", __FILE__, __LINE__, label);                 \
            ++g_failures;                                                         \
        } else {                                                                  \
            printf("ok   %s\n", label);                                           \
        }                                                                         \
    } while (0)

constexpr size_t kCacheLine = 64;

struct Entry {
    const char* name;
    size_t offset;
    size_t bytes;
};

Entry hotFields[] {
    { "normal", offsetof(Contact, normal), sizeof(Contact::normal) },
    { "t1", offsetof(Contact, t1), sizeof(Contact::t1) },
    { "t2", offsetof(Contact, t2), sizeof(Contact::t2) },
    { "ra", offsetof(Contact, ra), sizeof(Contact::ra) },
    { "rb", offsetof(Contact, rb), sizeof(Contact::rb) },
    { "a", offsetof(Contact, a), sizeof(Contact::a) },
    { "b", offsetof(Contact, b), sizeof(Contact::b) },
    { "massN", offsetof(Contact, massN), sizeof(Contact::massN) },
    { "massT1", offsetof(Contact, massT1), sizeof(Contact::massT1) },
    { "massT2", offsetof(Contact, massT2), sizeof(Contact::massT2) },
    { "impN", offsetof(Contact, impN), sizeof(Contact::impN) },
    { "impT1", offsetof(Contact, impT1), sizeof(Contact::impT1) },
    { "impT2", offsetof(Contact, impT2), sizeof(Contact::impT2) },
    { "velocityBias", offsetof(Contact, velocityBias), sizeof(Contact::velocityBias) },
    { "friction", offsetof(Contact, friction), sizeof(Contact::friction) },
    { "normalMode", offsetof(Contact, normalMode), sizeof(Contact::normalMode) },
    { "sensor", offsetof(Contact, sensor), sizeof(Contact::sensor) }
};

Entry coldFields[] {
    { "localNormal", offsetof(Contact, localNormal), sizeof(Contact::localNormal) },
    { "localA", offsetof(Contact, localA), sizeof(Contact::localA) },
    { "localB", offsetof(Contact, localB), sizeof(Contact::localB) },
    { "pen", offsetof(Contact, pen), sizeof(Contact::pen) },
    { "restitution", offsetof(Contact, restitution), sizeof(Contact::restitution) },
    { "cacheSlot", offsetof(Contact, cacheSlot), sizeof(Contact::cacheSlot) },
    { "shapeA", offsetof(Contact, shapeA), sizeof(Contact::shapeA) },
    { "shapeB", offsetof(Contact, shapeB), sizeof(Contact::shapeB) }
};

void printTable(const char* title, Entry* entries, size_t count) {
    printf("%s\n", title);
    for (size_t index = 0; index < count; ++index) {
        const Entry& entry = entries[index];
        printf("  %-14s offset %3zu  bytes %2zu  cache line %zu\n", entry.name, entry.offset, entry.bytes,
            entry.offset / kCacheLine);
    }
}

size_t highestHotEnd() {
    size_t end = 0;
    for (Entry& entry : hotFields) {
        if (entry.offset + entry.bytes > end) {
            end = entry.offset + entry.bytes;
        }
    }
    return end;
}

void shippedLayoutIsPrintedForTheExhibitAndOnlyTheSchemaIsAsserted() {
    printTable("shipped contact layout (compiler measured, emission order):", hotFields,
        sizeof(hotFields) / sizeof(Entry));
    printTable("cold fields:", coldFields, sizeof(coldFields) / sizeof(Entry));
    printf("sizeof(Contact)=%zu alignof=%zu cache lines touched by the hot cluster=%zu\n", sizeof(Contact),
        alignof(Contact), (highestHotEnd() + kCacheLine - 1) / kCacheLine);

    CHECK_LABEL(sizeof(Contact) == 224,
        "sizeof(Contact) is 224: this is the schema pin in contact.h and it is an ABI claim, not a preference");
    CHECK_LABEL(alignof(Contact) == 16,
        "alignof(Contact) is 16: the record stays vector aligned, which the arena allocator depends on");

    printf("offsets above are printed, not asserted: the layout record is tracked at "
        "bench/results/exhibits/contact-layout.json and is refreshed by scripts/contact-layout-exhibit.mjs\n");
    printf("rationale: spec 12.15 and 12.16; the four-cache-line smear measured here was tested by Lever A-lite "
        "and found worth nothing at box 1000, so it is recorded rather than guarded\n");
}

}

int main() {
    shippedLayoutIsPrintedForTheExhibitAndOnlyTheSchemaIsAsserted();
    printf("contact_layout_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
