import { describe, expect, it } from "vitest";
import { readStepStatistics as readStepStatisticsFromBundle, WasmPhysicsWorld3D } from "../index";
import { readStepStatistics } from "../world";

const DT = 1 / 60;
const STEP_COUNT = 7;

const createWorld = () => WasmPhysicsWorld3D.create({ maxBodies: 64, maxContacts: 256 });

describe("step statistics v2", () => {
    it("keeps the legacy eight fields readable", async () => {
        const world = await createWorld();
        world.createBody({ position: [0, 1, 0], shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } });
        world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        const stats = world.getStepStatistics();
        expect(typeof stats.contactsGenerated).toBe("number");
        expect(typeof stats.liveBodies).toBe("number");
        expect(stats.statisticsVersion).toBe(2);
        world.dispose();
    });

    it("reports version 2 and a consistent record size", async () => {
        const world = await createWorld();
        world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        const stats = world.getStepStatistics();
        expect(stats.counters).not.toBeNull();
        expect(stats.counters?.recordBytes).toBe(112);
        world.dispose();
    });

    it("reads a v1 record without inventing counters", () => {
        const buffer = new ArrayBuffer(32);
        const view = new DataView(buffer);
        view.setFloat32(8, 1172, true);
        const stats = readStepStatistics(view, 32);
        expect(stats.statisticsVersion).toBe(1);
        expect(stats.counters).toBeNull();
        expect(stats.contactsGenerated).toBe(1172);
    });

    it("reads a v2 record's counter block", () => {
        const buffer = new ArrayBuffer(112);
        const view = new DataView(buffer);
        view.setUint32(32, 2, true);
        view.setUint32(36, 112, true);
        view.setUint32(40, 7, true);
        view.setUint32(88, 90, true);
        view.setUint32(84, 100, true);
        const stats = readStepStatistics(view, 112);
        expect(stats.statisticsVersion).toBe(2);
        expect(stats.counters?.recordBytes).toBe(112);
        expect(stats.counters?.boxPointBuckets[0]).toBe(7);
        expect(stats.counters?.cacheHits).toBe(90);
        expect(stats.counters?.cacheLookups).toBe(100);
    });

    it("maps every field of the counter block to its documented byte offset", () => {
        const view = new DataView(new ArrayBuffer(112));
        const sentinel = (offset: number) => 70000 + offset;
        for (let offset = 0; offset < 32; offset += 4) {
            view.setFloat32(offset, sentinel(offset), true);
        }
        for (let offset = 36; offset <= 104; offset += 4) {
            view.setUint32(offset, sentinel(offset), true);
        }
        view.setUint32(32, 2, true);
        view.setUint32(108, sentinel(108), true);

        const stats = readStepStatistics(view, 112);
        expect(stats.broadphasePairsTested).toBe(sentinel(0));
        expect(stats.shapePairsTested).toBe(sentinel(4));
        expect(stats.contactsGenerated).toBe(sentinel(8));
        expect(stats.sensorContacts).toBe(sentinel(12));
        expect(stats.velocityIterations).toBe(sentinel(16));
        expect(stats.positionIterations).toBe(sentinel(20));
        expect(stats.sleepingBodies).toBe(sentinel(24));
        expect(stats.liveBodies).toBe(sentinel(28));
        expect(stats.counters?.recordVersion).toBe(2);
        expect(stats.counters?.recordBytes).toBe(sentinel(36));
        expect(stats.counters?.boxPointBuckets.length).toBe(8);
        expect(stats.counters?.boxPointBuckets[0]).toBe(sentinel(40));
        expect(stats.counters?.boxPointBuckets[1]).toBe(sentinel(44));
        expect(stats.counters?.boxPointBuckets[2]).toBe(sentinel(48));
        expect(stats.counters?.boxPointBuckets[3]).toBe(sentinel(52));
        expect(stats.counters?.boxPointBuckets[4]).toBe(sentinel(56));
        expect(stats.counters?.boxPointBuckets[5]).toBe(sentinel(60));
        expect(stats.counters?.boxPointBuckets[6]).toBe(sentinel(64));
        expect(stats.counters?.boxPointBuckets[7]).toBe(sentinel(68));
        expect(stats.counters?.boxFacePairs).toBe(sentinel(72));
        expect(stats.counters?.boxEdgePairs).toBe(sentinel(76));
        expect(stats.counters?.boxPairsTotal).toBe(sentinel(80));
        expect(stats.counters?.cacheLookups).toBe(sentinel(84));
        expect(stats.counters?.cacheHits).toBe(sentinel(88));
        expect(stats.counters?.cacheStores).toBe(sentinel(92));
        expect(stats.counters?.pointIdentitiesPrevStep).toBe(sentinel(96));
        expect(stats.counters?.pointIdentitiesRepeatingPrevStep).toBe(sentinel(100));
        expect(stats.counters?.stepsRecorded).toBe(sentinel(104));
        expect(stats.counters?.boxClipCandidateTotal).toBe(sentinel(108));
        expect(stats.counters).not.toHaveProperty("pairIdentities");
        expect(stats.counters).not.toHaveProperty("reservedCounters");
    });

    it("publishes a zeroed unversioned record before the first step", async () => {
        const world = await createWorld();
        world.createBody({ position: [0, 1, 0], shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } });
        const stats = world.getStepStatistics();
        expect(stats.statisticsVersion).toBe(0);
        expect(stats.counters).toBeNull();
        expect(stats.broadphasePairsTested).toBe(0);
        expect(stats.shapePairsTested).toBe(0);
        expect(stats.contactsGenerated).toBe(0);
        expect(stats.sensorContacts).toBe(0);
        expect(stats.velocityIterations).toBe(0);
        expect(stats.positionIterations).toBe(0);
        expect(stats.sleepingBodies).toBe(0);
        expect(stats.liveBodies).toBe(0);
        world.dispose();
    });

    it("records exactly one step counter entry per step call", async () => {
        const world = await createWorld();
        world.createBody({ position: [0, 1, 0], shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } });
        expect(world.getStepStatistics().counters).toBeNull();

        for (let index = 1; index <= STEP_COUNT; index += 1) {
            world.step(DT, { velocityIterations: 10, positionIterations: 4 });
            const stats = world.getStepStatistics();
            expect(stats.statisticsVersion).toBe(2);
            expect(stats.counters?.stepsRecorded).toBe(index);
        }

        expect(world.getStepStatistics().counters?.stepsRecorded).toBe(STEP_COUNT);
        world.dispose();
    });

    it("restarts the step count after a world reset", async () => {
        const world = await createWorld();
        for (let index = 0; index < 3; index += 1) {
            world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        }
        expect(world.getStepStatistics().counters?.stepsRecorded).toBe(3);

        world.reset();
        world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        expect(world.getStepStatistics().counters?.stepsRecorded).toBe(1);
        world.dispose();
    });

    it("exposes the pure reader from the package entry point", () => {
        expect(typeof readStepStatisticsFromBundle).toBe("function");
        expect(readStepStatisticsFromBundle).toBe(readStepStatistics);
        const view = new DataView(new ArrayBuffer(112));
        view.setUint32(32, 2, true);
        view.setUint32(104, 5, true);
        expect(readStepStatisticsFromBundle(view, 112).counters?.stepsRecorded).toBe(5);
    });
});
