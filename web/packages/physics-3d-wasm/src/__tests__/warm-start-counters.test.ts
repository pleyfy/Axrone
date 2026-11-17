import { describe, expect, it } from "vitest";
import { WasmPhysicsWorld3D } from "../index";

const DT = 1 / 60;
const POLICY = { velocityIterations: 10, positionIterations: 4 };

const createWorld = () => WasmPhysicsWorld3D.create({
    maxBodies: 64,
    maxContacts: 4096,
    gravity: [0, -9.81, 0]
});

function addSettledPile(world: WasmPhysicsWorld3D): void {
    world.createBody({
        type: "static",
        position: [0, -0.5, 0],
        shape: { kind: "box", halfExtents: [20, 0.5, 20] },
        friction: 0.8
    });
    for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
            world.createBody({
                position: [row * 1.1, 0.55 + column * 1.05, column * 1.1],
                shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
                density: 1,
                friction: 0.7
            });
        }
    }
}

describe("warm start counters", () => {
    it("reports reuse and previous-step point-identity continuity through the facade", async () => {
        const world = await createWorld();
        addSettledPile(world);
        for (let index = 0; index < 60; index += 1) {
            world.step(DT, POLICY);
        }

        const stats = world.getStepStatistics();
        const counters = stats.counters;
        expect(counters).not.toBeNull();
        expect(counters?.cacheLookups).toBeGreaterThan(0);
        expect(counters?.cacheStores).toBeGreaterThan(0);
        expect(counters?.cacheHits).toBeGreaterThan(0);
        expect(counters?.cacheHits).toBeLessThanOrEqual(counters?.cacheLookups ?? 0);
        expect(counters?.cacheLookups).toBe(stats.contactsGenerated);
        expect((counters?.cacheHits ?? 0) / (counters?.cacheLookups ?? 1)).toBeGreaterThan(0.5);
        expect(counters?.pointIdentitiesPrevStep).toBeGreaterThan(0);
        expect(counters?.pointIdentitiesRepeatingPrevStep).toBeLessThanOrEqual(counters?.pointIdentitiesPrevStep ?? 0);
        expect((counters?.pointIdentitiesRepeatingPrevStep ?? 0) / (counters?.pointIdentitiesPrevStep ?? 1)).toBeGreaterThan(0.5);
        expect(counters?.stepsRecorded).toBe(60);

        world.step(DT, POLICY);
        const next = world.getStepStatistics().counters;
        expect(next?.stepsRecorded).toBe(61);
        expect(next?.cacheLookups).toBe(counters?.cacheLookups);
        expect(next?.pointIdentitiesPrevStep).toBe(counters?.pointIdentitiesPrevStep);

        world.dispose();
    });

    it("counts no lookups for a world without contacts", async () => {
        const world = await createWorld();
        world.createBody({
            position: [0, 0, 0],
            shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
            density: 1
        });
        world.createBody({
            position: [40, 0, 0],
            shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
            density: 1
        });
        world.step(DT, POLICY);

        const stats = world.getStepStatistics();
        expect(stats.contactsGenerated).toBe(0);
        expect(stats.counters?.cacheLookups).toBe(0);
        expect(stats.counters?.cacheHits).toBe(0);
        expect(stats.counters?.cacheStores).toBe(0);
        expect(stats.counters?.pointIdentitiesPrevStep).toBe(0);
        expect(stats.counters?.pointIdentitiesRepeatingPrevStep).toBe(0);
        expect(stats.counters?.boxClipCandidateTotal).toBe(0);

        world.dispose();
    });
});
