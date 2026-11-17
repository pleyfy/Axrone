import { existsSync, readFileSync } from "node:fs";
import { hrtime } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WasmPhysicsWorld3D } from "../world";
import { WasmPhysicsWorld3DCompat } from "../compat";
import { REQUIRED_PHYSICS_EXPORTS, decodeBase64, instantiateWasm } from "../loader";
import { WASM_BASE64 } from "../generated/wasm";
import { PHYSICS_ITERATION_POLICY } from "../policy";
import type { PhaseTimers } from "../types";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const timersWasm = path.join(packageRoot, "build", "wasm-timers", "physics.opt.wasm");
const DT = 1 / 60;
const PILE_COUNT = 64;
const WARMUP_STEPS = 24;
const MEASURED_STEPS = 100;
const SUM_TOLERANCE = 0.03;
const hasTimersArtifact = existsSync(timersWasm);
const requireTimersArtifact = process.env.PHYSICS_REQUIRE_PHASE_TIMERS === "1";

type PhaseKey = keyof Pick<
    PhaseTimers,
    "integrateMs" | "broadphaseMs" | "collideMs" | "prepareMs" | "assembleConstraintsMs"
    | "solveVelocitiesMs" | "solvePositionsMs" | "sleepAndCacheSwapMs" | "packMs"
>;

type NestedPhaseKey = keyof Pick<PhaseTimers, "sweepSortMs" | "pairLoopMs">;

const PHASE_KEYS: readonly PhaseKey[] = [
    "integrateMs",
    "broadphaseMs",
    "collideMs",
    "prepareMs",
    "assembleConstraintsMs",
    "solveVelocitiesMs",
    "solvePositionsMs",
    "sleepAndCacheSwapMs",
    "packMs"
];

const NESTED_PHASE_KEYS: readonly NestedPhaseKey[] = ["sweepSortMs", "pairLoopMs"];

const RECORD_PHASE_KEYS: readonly (PhaseKey | NestedPhaseKey)[] = [...PHASE_KEYS, ...NESTED_PHASE_KEYS];

const CLOCK_TILING_EPSILON_MS = 1e-3;

const SWEPT_SLIVER_ALLOWANCE_MS = 5e-3;

function emptyTotals(): Record<PhaseKey | NestedPhaseKey, number> {
    return {
        integrateMs: 0,
        broadphaseMs: 0,
        collideMs: 0,
        prepareMs: 0,
        assembleConstraintsMs: 0,
        solveVelocitiesMs: 0,
        solvePositionsMs: 0,
        sleepAndCacheSwapMs: 0,
        packMs: 0,
        sweepSortMs: 0,
        pairLoopMs: 0
    };
}

function addBoxPile(world: WasmPhysicsWorld3D): void {
    world.createBody({
        type: "static",
        position: [0, -0.5, 0],
        shape: { kind: "box", halfExtents: [40, 0.5, 40] },
        friction: 0.8
    });

    const side = Math.ceil(Math.cbrt(PILE_COUNT));
    const offset = (side - 1) / 2;
    for (let index = 0; index < PILE_COUNT; index += 1) {
        const xIndex = index % side;
        const zIndex = Math.floor(index / side) % side;
        const layer = Math.floor(index / (side * side));
        world.createBody({
            position: [xIndex - offset, 1 + layer, zIndex - offset],
            shape: { kind: "box", halfExtents: [0.4, 0.4, 0.4] },
            density: 1,
            friction: 0.7
        });
    }
}

async function openTimersWorld(): Promise<WasmPhysicsWorld3D> {
    const world = await WasmPhysicsWorld3D.createFromBytes(readFileSync(timersWasm), {
        maxBodies: PILE_COUNT + 1,
        maxContacts: (PILE_COUNT + 1) * 24,
        gravity: [0, -9.81, 0]
    });
    addBoxPile(world);
    return world;
}

async function createTimersWorld(): Promise<WasmPhysicsWorld3D> {
    const world = await openTimersWorld();
    for (let index = 0; index < WARMUP_STEPS; index += 1) {
        world.step(DT);
    }
    return world;
}

function measure(world: WasmPhysicsWorld3D): { timers: Record<PhaseKey | NestedPhaseKey, number>; stepTime: number } {
    const totals = emptyTotals();
    let stepTime = 0;

    for (let index = 0; index < MEASURED_STEPS; index += 1) {
        const started = performance.now();
        world.step(DT);
        stepTime += performance.now() - started;
        const timers = world.getPhaseTimers();
        if (timers === null) {
            throw new Error("the instrumented module must publish phase timers");
        }
        for (const key of RECORD_PHASE_KEYS) {
            totals[key] += timers[key];
        }
    }

    for (const key of RECORD_PHASE_KEYS) {
        totals[key] /= MEASURED_STEPS;
    }

    return { timers: totals, stepTime: stepTime / MEASURED_STEPS };
}

function installHighResolutionClock(): () => void {
    const scope = globalThis as Record<string, unknown>;
    const previous = scope.performance;
    const origin = hrtime.bigint();
    scope.performance = { now: () => Number(hrtime.bigint() - origin) / 1e6 };
    return () => {
        scope.performance = previous;
    };
}

describe("shipped artifact import surface", () => {
    it("keeps every timer export out of the required export list", () => {
        expect(REQUIRED_PHYSICS_EXPORTS).not.toContain("phaseTimersView");
        expect(REQUIRED_PHYSICS_EXPORTS.filter((name) => name.startsWith("phaseTimer"))).toEqual([]);
    });

    it("fails instead of skipping when the timers artifact is required", () => {
        expect(requireTimersArtifact && !hasTimersArtifact).toBe(false);
    });

    it("reports null timers from the production build", async () => {
        const world = await WasmPhysicsWorld3D.create({
            maxBodies: PILE_COUNT + 1,
            maxContacts: (PILE_COUNT + 1) * 24,
            gravity: [0, -9.81, 0]
        });
        addBoxPile(world);
        world.step(DT);
        expect(world.getPhaseTimers()).toBeNull();
        expect(world.getPhaseTimerNesting()).toBeNull();
        world.dispose();
    });

    it("ships the embedded module with zero imports and no timer export", async () => {
        const module = await WebAssembly.compile(decodeBase64(WASM_BASE64));
        expect(WebAssembly.Module.imports(module)).toEqual([]);
        const exported = WebAssembly.Module.exports(module).map((entry) => entry.name);
        expect(exported).not.toContain("phaseTimersView");
        expect(exported.filter((name) => name.startsWith("phaseTimer"))).toEqual([]);
    });
});

describe.runIf(hasTimersArtifact || requireTimersArtifact)("phase timers from the instrumented build", () => {
    let restoreClock: (() => void) | null = null;

    beforeAll(() => {
        restoreClock = installHighResolutionClock();
    });

    afterAll(() => {
        restoreClock?.();
        restoreClock = null;
    });

    it("imports only env.now and instantiates through the shared policy", async () => {
        const bytes = readFileSync(timersWasm);
        const module = await WebAssembly.compile(bytes);
        const imports = WebAssembly.Module.imports(module);
        expect(imports.map((entry) => `${entry.kind} ${entry.module}.${entry.name}`)).toEqual(["function env.now"]);
        const exports = await instantiateWasm(bytes);
        expect(typeof exports.phaseTimersView).toBe("function");
    });

    it("publishes a 96 byte record of milliseconds per recorded step", async () => {
        const world = await createTimersWorld();
        const timers = world.getPhaseTimers() as PhaseTimers;
        expect(timers.recordVersion).toBe(1);
        expect(timers.recordBytes).toBe(96);
        for (const key of RECORD_PHASE_KEYS) {
            expect(Number.isFinite(timers[key])).toBe(true);
            expect(timers[key]).toBeGreaterThanOrEqual(0);
        }
        expect(RECORD_PHASE_KEYS).toHaveLength(PHASE_KEYS.length + 2);
        expect(world.contactCount).toBeGreaterThan(0);
        world.dispose();
    });

    it("sums the disjoint sections inside the host measured step time", async () => {
        const world = await createTimersWorld();
        const profile = measure(world);
        const total = PHASE_KEYS.reduce((sum, key) => sum + profile.timers[key], 0);
        expect(Math.abs(total - profile.stepTime) / profile.stepTime).toBeLessThan(SUM_TOLERANCE);
        const sweptScope = profile.timers.sweepSortMs + profile.timers.pairLoopMs;
        expect(sweptScope).toBeLessThanOrEqual(profile.timers.broadphaseMs + profile.timers.collideMs + CLOCK_TILING_EPSILON_MS);
        expect(sweptScope).toBeGreaterThan(0);
        world.dispose();
    });

    it("splits the swept scope into the sweep build and the pair loop", async () => {
        const world = await createTimersWorld();
        world.step(DT);
        const timers = world.getPhaseTimers() as PhaseTimers;
        const nesting = world.getPhaseTimerNesting();
        if (nesting === null) {
            throw new Error("the instrumented module must publish its raw nested timers");
        }
        expect(timers.sweepSortMs).toBeGreaterThan(0);
        expect(timers.pairLoopMs).toBeGreaterThan(0);
        expect(timers.pairLoopMs).toBeGreaterThanOrEqual(timers.collideMs);
        expect(timers.sweepSortMs + timers.pairLoopMs).toBeLessThanOrEqual(nesting.sweptMs + CLOCK_TILING_EPSILON_MS);
        const reconstructed = timers.sweepSortMs + timers.pairLoopMs - timers.collideMs;
        expect(Math.abs(reconstructed - timers.broadphaseMs))
            .toBeLessThan(Math.max(SWEPT_SLIVER_ALLOWANCE_MS, 0.15 * nesting.sweptMs));
        world.dispose();
    });

    it("publishes the nested sweep beside the subtraction it applied", async () => {
        const world = await createTimersWorld();
        const timers = world.getPhaseTimers() as PhaseTimers;
        const nesting = world.getPhaseTimerNesting();
        if (nesting === null) {
            throw new Error("the instrumented module must publish its raw nested timers");
        }
        expect(nesting.clampFired).toBe(false);
        expect(nesting.sweptMs).toBeGreaterThanOrEqual(nesting.collideMs);
        expect(nesting.collideMs).toBeCloseTo(timers.collideMs, 6);
        expect(timers.broadphaseMs).toBeCloseTo(nesting.sweptMs - nesting.collideMs, 6);
        expect(timers.broadphaseMs).toBeGreaterThan(0);
        world.dispose();
    });

    it("attributes no solver cost to a step with zero iterations", async () => {
        const world = await createTimersWorld();
        world.step(DT, { velocityIterations: 0, positionIterations: 0 });
        const idle = world.getPhaseTimers() as PhaseTimers;
        expect(idle.solveVelocitiesMs).toBe(0);
        expect(idle.solvePositionsMs).toBe(0);
        expect(idle.collideMs).toBeGreaterThan(0);
        expect(idle.integrateMs).toBeGreaterThan(0);

        world.step(DT, {
            velocityIterations: PHYSICS_ITERATION_POLICY.velocityIterations,
            positionIterations: PHYSICS_ITERATION_POLICY.positionIterations
        });
        const solved = world.getPhaseTimers() as PhaseTimers;
        expect(solved.solveVelocitiesMs).toBeGreaterThan(0);
        expect(solved.solvePositionsMs).toBeGreaterThan(0);
        world.dispose();
    });

    it("marks every non solver section on real work", async () => {
        const world = await createTimersWorld();
        const timers = measure(world).timers;
        expect(timers.integrateMs).toBeGreaterThan(0);
        expect(timers.broadphaseMs).toBeGreaterThan(0);
        expect(timers.collideMs).toBeGreaterThan(0);
        expect(timers.prepareMs).toBeGreaterThan(0);
        expect(timers.solveVelocitiesMs).toBeGreaterThan(0);
        expect(timers.solvePositionsMs).toBeGreaterThan(0);
        expect(timers.packMs).toBeGreaterThan(0);
        expect(timers.sleepAndCacheSwapMs).toBeGreaterThanOrEqual(0);
        expect(timers.sweepSortMs).toBeGreaterThan(0);
        expect(timers.pairLoopMs).toBeGreaterThan(0);
        world.dispose();
    });

    it("gives the compat profiler numbers for measured phases and null for the rest", async () => {
        const world = await WasmPhysicsWorld3DCompat.createFromBytes(readFileSync(timersWasm), {
            maxBodies: PILE_COUNT + 1,
            maxContacts: (PILE_COUNT + 1) * 24,
            gravity: { x: 0, y: -9.81, z: 0 }
        });
        const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 } });
        world.createBoxShape(ground, { halfExtents: { x: 4, y: 0.5, z: 4 } });
        for (let index = 0; index < 16; index += 1) {
            const box = world.createBody({
                type: 2,
                position: {
                    x: (index % 4) - 1.5,
                    y: 1 + Math.floor(index / 4),
                    z: (index % 2) - 0.5
                }
            });
            world.createBoxShape(box, { halfExtents: { x: 0.4, y: 0.4, z: 0.4 } });
        }
        for (let index = 0; index < WARMUP_STEPS; index += 1) {
            world.step(DT);
        }

        const profile = world.getProfiler();
        const measuredPhases = [
            profile.collisionTime,
            profile.solveTime,
            profile.broadphaseTime,
            profile.narrowphaseTime,
            profile.sweepSortTime,
            profile.pairLoopTime,
            profile.solveVelocityTime,
            profile.solvePositionTime,
            profile.sleepAndCacheSwapTime
        ];
        for (const value of measuredPhases) {
            expect(typeof value).toBe("number");
            expect(Number.isFinite(value)).toBe(true);
        }

        expect(Number.isFinite(profile.stepTime)).toBe(true);
        expect(profile.collisionTime).toBeCloseTo((profile.broadphaseTime ?? 0) + (profile.narrowphaseTime ?? 0), 9);
        expect(profile.solveTime).toBeCloseTo((profile.solveVelocityTime ?? 0) + (profile.solvePositionTime ?? 0), 9);
        expect(profile.solveVelocityTime ?? 0).toBeGreaterThan(0);
        expect(profile.solvePositionTime ?? 0).toBeGreaterThan(0);
        expect(profile.narrowphaseTime ?? 0).toBeGreaterThan(0);
        expect(profile.collisionTime ?? 0).toBeGreaterThan(0);

        for (const value of [
            profile.sleepTime,
            profile.warmStartTime,
            profile.persistTime,
            profile.integrateVelocityTime,
            profile.integratePositionTime,
            profile.eventsTime
        ]) {
            expect(value).toBeNull();
        }

        world.dispose();
    });

    it("leaves the simulated state identical to the production module", async () => {
        const instrumented = await openTimersWorld();
        const production = await WasmPhysicsWorld3D.create({
            maxBodies: PILE_COUNT + 1,
            maxContacts: (PILE_COUNT + 1) * 24,
            gravity: [0, -9.81, 0]
        });
        addBoxPile(production);

        for (let index = 0; index < WARMUP_STEPS + MEASURED_STEPS; index += 1) {
            instrumented.step(DT);
            production.step(DT);
        }

        expect(instrumented.contactCount).toBe(production.contactCount);
        expect(instrumented.fingerprint()).toBe(production.fingerprint());
        instrumented.dispose();
        production.dispose();
    });
});
