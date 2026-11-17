import { describe, expect, it } from "vitest";
import { WasmPhysicsWorld3D } from "../index";
import type { StepStatistics } from "../types";

const DT = 1 / 60;
const POLICY = { velocityIterations: 10, positionIterations: 4 };
const BUCKET_COUNT = 8;

const pairTotal = (stats: StepStatistics): number =>
    (stats.counters?.boxPointBuckets ?? []).reduce((sum, bucket) => sum + bucket, 0);

const pointTotal = (stats: StepStatistics): number =>
    (stats.counters?.boxPointBuckets ?? []).reduce((sum, bucket, index) => sum + bucket * (index + 1), 0);

const facePointTotal = (stats: StepStatistics): number => pointTotal(stats) - (stats.counters?.boxEdgePairs ?? 0);

const createWorld = (maxBodies: number, maxContacts: number, gravity: [number, number, number]) =>
    WasmPhysicsWorld3D.create({ maxBodies, maxContacts, gravity });

describe("box contact-point histogram", () => {
    it("keeps the per-step histogram weighted to the contacts of that step", async () => {
        const world = await createWorld(64, 4096, [0, -9.81, 0]);
        world.createBody({
            type: "static",
            position: [0, -0.5, 0],
            shape: { kind: "box", halfExtents: [20, 0.5, 20] },
            friction: 0.8
        });
        for (let index = 0; index < 18; index += 1) {
            const layer = Math.floor(index / 9);
            const within = index % 9;
            world.createBody({
                position: [(within % 3) - 1, 0.55 + layer, Math.floor(within / 3) - 1],
                shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
                density: 1,
                friction: 0.7
            });
        }

        for (let index = 0; index < 40; index += 1) {
            world.step(DT, POLICY);
        }

        const stats = world.getStepStatistics();
        expect(stats.statisticsVersion).toBe(2);
        expect(stats.counters).not.toBeNull();
        expect(stats.counters?.boxPointBuckets.length).toBe(BUCKET_COUNT);
        expect(stats.counters?.boxPairsTotal).toBeGreaterThan(0);
        expect(stats.contactsGenerated).toBeGreaterThan(0);
        expect(pairTotal(stats)).toBe(stats.counters?.boxPairsTotal);
        expect(pointTotal(stats)).toBe(stats.contactsGenerated);
        expect((stats.counters?.boxFacePairs ?? 0) + (stats.counters?.boxEdgePairs ?? 0)).toBe(
            stats.counters?.boxPairsTotal
        );
        expect(stats.counters?.boxClipCandidateTotal).toBeGreaterThan(facePointTotal(stats));
        expect(stats.counters?.boxClipCandidateTotal).toBeLessThanOrEqual(
            8 * (stats.counters?.boxFacePairs ?? 0)
        );
        expect(stats.counters?.stepsRecorded).toBe(40);

        world.step(DT, POLICY);
        const next = world.getStepStatistics();
        expect(next.counters?.stepsRecorded).toBe(41);
        expect(pairTotal(next)).toBe(next.counters?.boxPairsTotal);
        expect(pointTotal(next)).toBe(next.contactsGenerated);
        expect(pairTotal(next)).toBeLessThanOrEqual(next.contactsGenerated);
        expect(next.counters?.boxClipCandidateTotal).toBeGreaterThanOrEqual(facePointTotal(next));
        expect(next.counters?.boxClipCandidateTotal).toBeLessThanOrEqual(8 * (next.counters?.boxFacePairs ?? 0));

        world.dispose();
    });

    it("leaves the histogram empty when no box pair generates contact points", async () => {
        const world = await createWorld(8, 1024, [0, 0, 0]);
        world.createBody({
            position: [0, 0, 0],
            shape: { kind: "sphere", radius: 0.5 },
            density: 1
        });
        world.createBody({
            position: [0.6, 0, 0],
            shape: { kind: "sphere", radius: 0.5 },
            density: 1
        });
        world.step(DT, POLICY);

        const stats = world.getStepStatistics();
        expect(stats.contactsGenerated).toBeGreaterThan(0);
        expect(stats.counters?.boxPairsTotal).toBe(0);
        expect(stats.counters?.boxFacePairs).toBe(0);
        expect(stats.counters?.boxEdgePairs).toBe(0);
        expect(stats.counters?.boxClipCandidateTotal).toBe(0);
        expect(pairTotal(stats)).toBe(0);

        world.dispose();
    });
});
