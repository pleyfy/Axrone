import { describe, expect, it } from "vitest";
import { loadEmbeddedWasm, WasmPhysicsWorld3D } from "../index";
import type { StepStatistics } from "../types";

const DT = 1 / 60;
const POLICY = { velocityIterations: 10, positionIterations: 4 };

type CapOption = { readonly boxManifoldPointCap?: 4 | 8 };

const pointTotal = (stats: StepStatistics): number =>
    (stats.counters?.boxPointBuckets ?? []).reduce((sum, bucket, index) => sum + bucket * (index + 1), 0);

const pairsAboveFour = (stats: StepStatistics): number =>
    (stats.counters?.boxPointBuckets ?? []).slice(4).reduce((sum, bucket) => sum + bucket, 0);

const readResult = (world: WasmPhysicsWorld3D) => {
    const stats = world.getStepStatistics();
    return {
        contacts: stats.contactsGenerated,
        pairs: stats.counters?.boxPairsTotal ?? 0,
        clipCandidates: stats.counters?.boxClipCandidateTotal ?? 0,
        emittedPoints: pointTotal(stats),
        pairsAboveFour: pairsAboveFour(stats),
        fingerprint: world.fingerprint(),
        emittedByCap: [...(stats.counters?.boxPointBuckets ?? [])]
    };
};

const buildStack = (world: WasmPhysicsWorld3D) => {
    world.createBody({ type: "static", shape: { kind: "box", halfExtents: [8, 0.5, 8] }, position: [0, -0.5, 0] });
    for (let index = 0; index < 5; index += 1) {
        world.createBody({
            type: "dynamic",
            shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
            position: [0, 0.5 + index, 0]
        });
    }
};

const buildLattice = (world: WasmPhysicsWorld3D) => {
    world.createBody({
        type: "static",
        shape: { kind: "box", halfExtents: [40, 0.5, 40] },
        position: [0, -0.5, 0],
        friction: 0.8,
        restitution: 0
    });
    for (let layer = 0; layer < 3; layer += 1) {
        for (let x = 0; x < 3; x += 1) {
            for (let z = 0; z < 3; z += 1) {
                world.createBody({
                    type: "dynamic",
                    shape: { kind: "box", halfExtents: [0.4, 0.4, 0.4] },
                    position: [x - 1, 1 + layer, z - 1],
                    density: 1,
                    friction: 0.7,
                    restitution: 0
                });
            }
        }
    }
};

const runScene = async (build: (world: WasmPhysicsWorld3D) => void, steps: number, options: CapOption) => {
    const world = await WasmPhysicsWorld3D.create({ maxBodies: 64, maxContacts: 512, ...options });
    build(world);
    for (let index = 0; index < steps; index += 1) {
        world.step(DT, POLICY);
    }
    const result = readResult(world);
    world.dispose();
    return result;
};

const stackContacts = (options: CapOption) => runScene(buildStack, 120, options);

const latticeContacts = (options: CapOption) => runScene(buildLattice, 240, options);

describe("boxManifoldPointCap", () => {
    it("is absent-safe: omitting the option behaves exactly like asking for 8", async () => {
        const omitted = await stackContacts({});
        const explicit = await stackContacts({ boxManifoldPointCap: 8 });
        expect(omitted.contacts).toEqual(explicit.contacts);
        expect(omitted.emittedByCap).toEqual(explicit.emittedByCap);
        expect(omitted.clipCandidates).toEqual(explicit.clipCandidates);
        expect(omitted.pairs).toEqual(explicit.pairs);
        expect(omitted.fingerprint).toEqual(explicit.fingerprint);
        expect(omitted.emittedByCap.slice(4).reduce((sum, bucket) => sum + bucket, 0)).toBeGreaterThan(0);
    });

    it("is absent-safe on the lattice pile too, fingerprint included", async () => {
        const omitted = await latticeContacts({});
        const explicit = await latticeContacts({ boxManifoldPointCap: 8 });
        expect(omitted.contacts).toEqual(explicit.contacts);
        expect(omitted.emittedByCap).toEqual(explicit.emittedByCap);
        expect(omitted.fingerprint).toEqual(explicit.fingerprint);
    });

    it("emits fewer points when capped at 4, without emitting nothing and without changing pairs", async () => {
        const open = await stackContacts({});
        const capped = await stackContacts({ boxManifoldPointCap: 4 });
        expect(capped.contacts).toBeLessThan(open.contacts);
        expect(capped.contacts).toBeGreaterThan(0);
        expect(capped.pairs).toEqual(open.pairs);
        expect(capped.clipCandidates).toEqual(open.clipCandidates);
        expect(capped.emittedByCap.slice(4)).toEqual([0, 0, 0, 0]);
        expect(open.contacts - capped.contacts).toEqual(open.emittedPoints - capped.emittedPoints);
    });

    it("puts the cap to work on a pile whose histogram has mass above four points", async () => {
        const open = await latticeContacts({});
        expect(open.pairsAboveFour).toBeGreaterThan(0);
        expect(open.emittedPoints).toEqual(open.contacts);

        const capped = await latticeContacts({ boxManifoldPointCap: 4 });
        expect(capped.contacts).toBeLessThan(open.contacts);
        expect(capped.contacts).toBeGreaterThan(0);
        expect(capped.emittedPoints).toEqual(capped.contacts);
        expect(capped.emittedByCap.slice(4)).toEqual([0, 0, 0, 0]);
        expect(capped.emittedByCap[3]).toEqual(capped.pairs);
        expect(capped.fingerprint).not.toEqual(open.fingerprint);
    });

    it("refuses a cap outside the supported set", async () => {
        await expect(WasmPhysicsWorld3D.create({
            maxBodies: 8,
            maxContacts: 32,
            boxManifoldPointCap: 3 as 4
        })).rejects.toThrow();
    });

    it("refuses every unsupported cap value, including the neighbours of the supported pair", async () => {
        for (const cap of [0, 1, 2, 3, 5, 6, 7, 9, 12, -4, 4.5]) {
            await expect(WasmPhysicsWorld3D.create({
                maxBodies: 8,
                maxContacts: 32,
                boxManifoldPointCap: cap as 4
            })).rejects.toThrow();
        }
    });

    it("refuses an unsupported cap through the ABI directly, with the package sentinel", async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(8, 32, 0, -9.81, 0)).toBe(0);
        expect(wasm.worldSetBoxManifoldPointCap(4)).toBe(0);
        expect(wasm.worldSetBoxManifoldPointCap(8)).toBe(0);
        for (const cap of [0, 1, 3, 5, 7, 9, -1, 16]) {
            expect(wasm.worldSetBoxManifoldPointCap(cap)).toBe(-1);
        }
    });
});
