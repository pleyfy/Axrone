#include <cstdio>
#include <cstdint>

#include "core/world.h"
#include "runtime/arena.h"
#include "scenario.h"

using namespace axrone::physics;

namespace {

alignas(64) unsigned char g_memory[64 * 1024 * 1024];

}

int main() {
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));

    World world;
    if (!world.init(arena, 512, 16384, Vec3(0.0f, -9.81f, 0.0f))) {
        std::printf("init-failed\n");
        return 1;
    }

    addStandardBodies(world);
    runStandardScene(world);

    std::printf(
        "bodies=%d contacts=%d fingerprint=%016llx\n",
        static_cast<int>(world.bodyCount()),
        static_cast<int>(world.getContactCount()),
        static_cast<unsigned long long>(world.fingerprint())
    );
    return 0;
}
