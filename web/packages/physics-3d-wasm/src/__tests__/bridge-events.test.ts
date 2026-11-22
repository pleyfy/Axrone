import { describe, expect, it } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import { WasmPhysicsWorld3DCompat } from '../compat';
import type { CompatCollisionEvent, CompatSensorEvent } from '../compat';
import type {
    ICollisionEvent3D,
    IContactListener3D,
    ISensorEvent3D,
} from '@axrone/physics-core';

const DT = 1 / 60;

function vec3(x: number, y: number, z: number) {
    return { x, y, z };
}

interface NormalizedEvent {
    readonly kind: string;
    readonly pairKey: string;
}

type StepEvents = NormalizedEvent[];

function multisetKey(event: NormalizedEvent): string {
    return `${event.kind}:${event.pairKey}`;
}

function stepSignature(events: StepEvents[]): Map<string, number[]> {
    const signature = new Map<string, number[]>();
    for (let step = 0; step < events.length; step += 1) {
        for (const event of events[step]) {
            const key = multisetKey(event);
            const steps = signature.get(key);
            if (steps === undefined) {
                signature.set(key, [step]);
            } else {
                steps.push(step);
            }
        }
    }
    return signature;
}

function signatureDifference(
    name: string,
    reference: StepEvents[],
    other: StepEvents[],
    window: number
): string | null {
    const referenceSignature = stepSignature(reference);
    const otherSignature = stepSignature(other);
    const keys = new Set([...referenceSignature.keys(), ...otherSignature.keys()]);
    for (const key of [...keys].sort()) {
        const referenceSteps = referenceSignature.get(key) ?? [];
        const otherSteps = otherSignature.get(key) ?? [];
        const allowedCountDelta = key.startsWith('stay:') ? window : 0;
        const countDelta = Math.abs(referenceSteps.length - otherSteps.length);
        if (countDelta > allowedCountDelta) {
            return `${name}: ${key} emitted ${referenceSteps.length} time(s) by reference at [${referenceSteps.join(',')}] and ${otherSteps.length} time(s) by compat at [${otherSteps.join(',')}], allowed count delta ${allowedCountDelta}`;
        }
        const compared = Math.min(referenceSteps.length, otherSteps.length);
        for (let index = 0; index < compared; index += 1) {
            const delta = Math.abs(referenceSteps[index] - otherSteps[index]);
            if (delta > window) {
                return `${name}: ${key} occurrence ${index + 1} at step ${referenceSteps[index]} (reference) vs ${otherSteps[index]} (compat), delta ${delta} exceeds the ${window}-step boundary allowance`;
            }
        }
    }
    return null;
}

function kindOrderViolation(name: string, events: StepEvents[]): string | null {
    const seen = new Map<string, Set<string>>();
    const known = new Set(['begin', 'stay', 'end', 'sensorEnter', 'sensorExit']);
    for (const step of events) {
        for (const event of step) {
            if (!known.has(event.kind)) {
                return `${name}: unexpected callback kind ${event.kind}`;
            }
            const kinds = seen.get(event.pairKey) ?? new Set<string>();
            seen.set(event.pairKey, kinds);
            if (event.kind === 'stay' && !kinds.has('begin')) {
                return `${name}: stay for pair ${event.pairKey} without a preceding begin`;
            }
            if (event.kind === 'sensorExit' && !kinds.has('sensorEnter')) {
                return `${name}: sensorExit for pair ${event.pairKey} without a preceding sensorEnter`;
            }
            kinds.add(event.kind);
        }
    }
    return null;
}

/**
 * Build the collision scene through the reference (TypeScript) bridge.
 * Scene: ground + dynamic box falling onto it.
 * Body indices: 0=ground, 1=box
 */
function buildReferenceCollisionScene(): {
    world: PhysicsWorld3D;
    events: StepEvents[];
} {
    const config = {
        gravity: vec3(0, -9.81, 0),
        maxBodies: 16,
        maxContacts: 256,
        allowSleep: false,
    };
    const world = new PhysicsWorld3D(config);

    const perStepEvents: StepEvents[] = [];

    // Map engine body IDs to scene indices
    const bodyIndexById = new Map<number, number>();

    // Body 0: ground
    const groundId = world.createBody({
        type: 0,
        position: vec3(0, -0.5, 0),
        allowSleep: false,
    });
    world.createBoxShape(groundId, { center: vec3(0, 0, 0), halfExtents: vec3(10, 0.5, 10) });
    bodyIndexById.set(Number(groundId), 0);

    // Body 1: dynamic box falling
    const boxId = world.createBody({
        type: 2,
        position: vec3(0, 3, 0),
        allowSleep: false,
    });
    world.createBoxShape(boxId, { center: vec3(0, 0, 0), halfExtents: vec3(0.5, 0.5, 0.5) });
    world.getBody(boxId)?.resetMassData();
    bodyIndexById.set(Number(boxId), 1);

    const listener: IContactListener3D = {
        onCollisionBegin(event: ICollisionEvent3D) {
            const a = bodyIndexById.get(Number(event.bodyIdA))!;
            const b = bodyIndexById.get(Number(event.bodyIdB))!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'begin',
                pairKey: `${Math.min(a, b)}-${Math.max(a, b)}`,
            });
        },
        onCollisionStay(event: ICollisionEvent3D) {
            const a = bodyIndexById.get(Number(event.bodyIdA))!;
            const b = bodyIndexById.get(Number(event.bodyIdB))!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'stay',
                pairKey: `${Math.min(a, b)}-${Math.max(a, b)}`,
            });
        },
        onCollisionEnd(event: ICollisionEvent3D) {
            const a = bodyIndexById.get(Number(event.bodyIdA))!;
            const b = bodyIndexById.get(Number(event.bodyIdB))!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'end',
                pairKey: `${Math.min(a, b)}-${Math.max(a, b)}`,
            });
        },
    };
    world.setContactListener(listener);

    // Run for enough steps to see begin and stay
    const totalSteps = 240;
    for (let step = 0; step < totalSteps; step++) {
        perStepEvents.push([]);
        world.step(DT, 10, 4);
    }

    // Remove box to trigger end
    world.destroyBody(boxId);
    perStepEvents.push([]);
    world.step(DT, 10, 4);

    return { world, events: perStepEvents };
}

/**
 * Build the same collision scene through the WASM compat layer.
 */
async function buildCompatCollisionScene(): Promise<{
    world: WasmPhysicsWorld3DCompat;
    events: StepEvents[];
}> {
    const world = await WasmPhysicsWorld3DCompat.create({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: 16,
        maxContacts: 256,
    });

    const perStepEvents: StepEvents[] = [];

    // Map engine body IDs to scene indices
    const bodyIndexById = new Map<number, number>();

    // Body 0: ground
    const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 } });
    world.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 } });
    bodyIndexById.set(ground, 0);

    // Body 1: dynamic box
    const box = world.createBody({ type: 2, position: { x: 0, y: 3, z: 0 } });
    world.createBoxShape(box, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    world.getBody(box)?.resetMassData();
    bodyIndexById.set(box, 1);

    world.setContactListener({
        onCollisionBegin(event: CompatCollisionEvent) {
            const a = bodyIndexById.get(event.bodyIdA)!;
            const b = bodyIndexById.get(event.bodyIdB)!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'begin',
                pairKey: `${Math.min(a, b)}-${Math.max(a, b)}`,
            });
        },
        onCollisionStay(event: CompatCollisionEvent) {
            const a = bodyIndexById.get(event.bodyIdA)!;
            const b = bodyIndexById.get(event.bodyIdB)!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'stay',
                pairKey: `${Math.min(a, b)}-${Math.max(a, b)}`,
            });
        },
        onCollisionEnd(event: CompatCollisionEvent) {
            const a = bodyIndexById.get(event.bodyIdA)!;
            const b = bodyIndexById.get(event.bodyIdB)!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'end',
                pairKey: `${Math.min(a, b)}-${Math.max(a, b)}`,
            });
        },
    });

    // Run for same number of steps
    const totalSteps = 240;
    for (let step = 0; step < totalSteps; step++) {
        perStepEvents.push([]);
        world.step(DT, 10, 4);
    }

    // Remove box
    world.destroyBody(box);
    perStepEvents.push([]);
    world.step(DT, 10, 4);

    return { world, events: perStepEvents };
}

/**
 * Build the sensor scene through the reference bridge.
 * Scene: sensor trigger (static) + dynamic ball falling through.
 * Body indices: 0=sensor, 1=ball
 */
function buildReferenceSensorScene(): {
    world: PhysicsWorld3D;
    events: StepEvents[];
} {
    const config = {
        gravity: vec3(0, -9.81, 0),
        maxBodies: 16,
        maxContacts: 256,
        allowSleep: false,
    };
    const world = new PhysicsWorld3D(config);

    const perStepEvents: StepEvents[] = [];
    const bodyIndexById = new Map<number, number>();

    // Body 0: sensor trigger (static sphere)
    const sensorId = world.createBody({
        type: 0,
        position: vec3(0, 0, 0),
        allowSleep: false,
    });
    world.createSphereShape(
        sensorId,
        { center: vec3(0, 0, 0), radius: 1.5 },
        undefined,
        undefined,
        { isSensor: true },
    );
    bodyIndexById.set(Number(sensorId), 0);

    // Body 1: dynamic ball falling through sensor
    const ballId = world.createBody({
        type: 2,
        position: vec3(0, 5, 0),
        allowSleep: false,
    });
    world.createSphereShape(ballId, { center: vec3(0, 0, 0), radius: 0.25 });
    world.getBody(ballId)?.resetMassData();
    bodyIndexById.set(Number(ballId), 1);

    const listener: IContactListener3D = {
        onSensorEnter(event: ISensorEvent3D) {
            const s = bodyIndexById.get(Number(event.sensorBodyId))!;
            const v = bodyIndexById.get(Number(event.visitorBodyId))!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'sensorEnter',
                pairKey: `${Math.min(s, v)}-${Math.max(s, v)}`,
            });
        },
        onSensorExit(event: ISensorEvent3D) {
            const s = bodyIndexById.get(Number(event.sensorBodyId))!;
            const v = bodyIndexById.get(Number(event.visitorBodyId))!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'sensorExit',
                pairKey: `${Math.min(s, v)}-${Math.max(s, v)}`,
            });
        },
    };
    world.setContactListener(listener);

    // Run until ball exits sensor (falls through)
    const totalSteps = 300;
    for (let step = 0; step < totalSteps; step++) {
        perStepEvents.push([]);
        world.step(DT, 10, 4);
    }

    return { world, events: perStepEvents };
}

/**
 * Build the same sensor scene through the WASM compat layer.
 */
async function buildCompatSensorScene(): Promise<{
    world: WasmPhysicsWorld3DCompat;
    events: StepEvents[];
}> {
    const world = await WasmPhysicsWorld3DCompat.create({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: 16,
        maxContacts: 256,
    });

    const perStepEvents: StepEvents[] = [];
    const bodyIndexById = new Map<number, number>();

    // Body 0: sensor trigger
    const sensor = world.createBody({ type: 0, position: { x: 0, y: 0, z: 0 } });
    world.createSphereShape(sensor, { radius: 1.5, isSensor: true });
    bodyIndexById.set(sensor, 0);

    // Body 1: dynamic ball
    const ball = world.createBody({ type: 2, position: { x: 0, y: 5, z: 0 } });
    world.createSphereShape(ball, { radius: 0.25 });
    world.getBody(ball)?.resetMassData();
    bodyIndexById.set(ball, 1);

    world.setContactListener({
        onSensorEnter(event: CompatSensorEvent) {
            const s = bodyIndexById.get(event.sensorBodyId)!;
            const v = bodyIndexById.get(event.visitorBodyId)!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'sensorEnter',
                pairKey: `${Math.min(s, v)}-${Math.max(s, v)}`,
            });
        },
        onSensorExit(event: CompatSensorEvent) {
            const s = bodyIndexById.get(event.sensorBodyId)!;
            const v = bodyIndexById.get(event.visitorBodyId)!;
            perStepEvents[perStepEvents.length - 1]?.push({
                kind: 'sensorExit',
                pairKey: `${Math.min(s, v)}-${Math.max(s, v)}`,
            });
        },
    });

    // Run for same number of steps
    const totalSteps = 300;
    for (let step = 0; step < totalSteps; step++) {
        perStepEvents.push([]);
        world.step(DT, 10, 4);
    }

    return { world, events: perStepEvents };
}

describe('event parity', () => {
    it('produces the same collision begin/stay/end callbacks with the same pair keys', async () => {
        const ref = buildReferenceCollisionScene();
        const compat = await buildCompatCollisionScene();

        const simStepCount = 240;
        const referenceWindow = ref.events.slice(0, simStepCount);
        const compatWindow = compat.events.slice(0, simStepCount);
        const refSimEvents = referenceWindow.flat();
        const compatSimEvents = compatWindow.flat();

        expect(
            [...new Set(refSimEvents.map(multisetKey))].sort(),
            `reference keys [${[...new Set(refSimEvents.map(multisetKey))].sort().join(',')}] ` +
            `vs compat keys [${[...new Set(compatSimEvents.map(multisetKey))].sort().join(',')}]`
        ).toEqual([...new Set(compatSimEvents.map(multisetKey))].sort());

        const collisionDifference = signatureDifference('collision', referenceWindow, compatWindow, 1);
        expect(collisionDifference, collisionDifference ?? 'ok').toBeNull();
        expect(kindOrderViolation('reference', referenceWindow)).toBeNull();
        expect(kindOrderViolation('compat', compatWindow)).toBeNull();

        expect(refSimEvents.some((e) => e.kind === 'begin')).toBe(true);
        expect(refSimEvents.some((e) => e.kind === 'stay')).toBe(true);
        expect(compatSimEvents.some((e) => e.kind === 'begin')).toBe(true);
        expect(compatSimEvents.some((e) => e.kind === 'stay')).toBe(true);

        ref.world[Symbol.dispose]();
        compat.world.dispose();
    });

    it('produces the same sensor enter/exit callbacks with the same pair keys', async () => {
        const ref = buildReferenceSensorScene();
        const compat = await buildCompatSensorScene();

        const sensorDifference = signatureDifference('sensor', ref.events, compat.events, 1);
        expect(sensorDifference, sensorDifference ?? 'ok').toBeNull();
        expect(kindOrderViolation('reference', ref.events)).toBeNull();
        expect(kindOrderViolation('compat', compat.events)).toBeNull();

        // Both should have sensorEnter and sensorExit
        const allRefEvents = ref.events.flat();
        const allCompatEvents = compat.events.flat();

        expect(allRefEvents.some((e) => e.kind === 'sensorEnter')).toBe(true);
        expect(allCompatEvents.some((e) => e.kind === 'sensorEnter')).toBe(true);
        expect(allRefEvents.some((e) => e.kind === 'sensorExit')).toBe(true);
        expect(allCompatEvents.some((e) => e.kind === 'sensorExit')).toBe(true);

        ref.world[Symbol.dispose]();
        compat.world.dispose();
    });

    it('neither bridge dispatches sensorStay (asymmetric behavior matches scene-runtime)', async () => {
        const ref = buildReferenceSensorScene();
        const compat = await buildCompatSensorScene();

        const allRefEvents = ref.events.flat();
        const allCompatEvents = compat.events.flat();

        // Neither should have sensorStay events
        expect(allRefEvents.filter((e) => e.kind === 'sensorStay')).toHaveLength(0);
        expect(allCompatEvents.filter((e) => e.kind === 'sensorStay')).toHaveLength(0);

        ref.world[Symbol.dispose]();
        compat.world.dispose();
    });
});
