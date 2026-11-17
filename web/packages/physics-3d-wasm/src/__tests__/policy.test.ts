import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PHYSICS_ITERATION_POLICY } from "../policy";
import { WasmPhysicsBridge3D } from "../bridge";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DT = 1 / 60;

describe("iteration policy", () => {
    it("is 10 velocity and 4 position", () => {
        expect(PHYSICS_ITERATION_POLICY.velocityIterations).toBe(10);
        expect(PHYSICS_ITERATION_POLICY.positionIterations).toBe(4);
    });

    it("matches the plain-script mirror byte for byte", async () => {
        const mirror = await import("../../scripts/policy.mjs");
        const expected = {
            velocityIterations: PHYSICS_ITERATION_POLICY.velocityIterations,
            positionIterations: PHYSICS_ITERATION_POLICY.positionIterations
        };
        expect(mirror.PHYSICS_ITERATION_POLICY).toEqual(expected);
        expect(mirror.default).toEqual(expected);
        expect(mirror.default).toEqual(mirror.PHYSICS_ITERATION_POLICY);
    });

    it("is the default the bridge applies when no iterations are configured", async () => {
        const ecsWorld = { getAllActors: () => [] } as never;
        const bridge = await WasmPhysicsBridge3D.create(ecsWorld, {});
        try {
            bridge.fixedUpdate({ fixedDelta: DT } as never);
            const stats = bridge.physicsWorld.getStepStatistics();
            expect(stats.velocityIterations).toBe(PHYSICS_ITERATION_POLICY.velocityIterations);
            expect(stats.positionIterations).toBe(PHYSICS_ITERATION_POLICY.positionIterations);
        } finally {
            bridge.dispose();
        }
    });

    it("is the default the facade step applies", () => {
        const source = readFileSync(path.join(packageRoot, "src", "world.ts"), "utf8");
        expect(source).toContain("PHYSICS_ITERATION_POLICY.velocityIterations");
        expect(source).not.toContain("DEFAULT_VELOCITY_ITERATIONS = 8");
    });

    it("is the default the bench applies", () => {
        const source = readFileSync(path.join(packageRoot, "bench", "run.mjs"), "utf8");
        expect(source).toContain("policy.velocityIterations");
        expect(source).toContain("policy.positionIterations");
    });
});
