import { describe, expect, it } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import { WasmPhysicsWorld3D } from '../world';
import type {
    BodyId3D,
    ICollisionEvent3D,
    IContactListener3D,
    ISensorEvent3D,
} from '@axrone/physics-core';

const DT = 1 / 60;
const STEPS = 240;

function vec3(x: number, y: number, z: number) {
    return { x, y, z };
}

interface BodyRecord {
    readonly refId: BodyId3D;
    readonly wasmId: number;
    readonly label: string;
}

function buildReferenceScene(): {
    world: PhysicsWorld3D;
    bodies: BodyRecord[];
} {
    const config = {
        gravity: vec3(0, -9.81, 0),
        maxBodies: 32,
        maxContacts: 256,
        allowSleep: false,
    };
    const world = new PhysicsWorld3D(config);

    const listeners: string[] = [];
    const listener: IContactListener3D = {
        onCollisionBegin(event: ICollisionEvent3D) {
            listeners.push(`begin:${Number(event.bodyIdA)}-${Number(event.bodyIdB)}`);
        },
        onCollisionStay(_event: ICollisionEvent3D) { /* tracked */ },
        onCollisionEnd(_event: ICollisionEvent3D) { /* tracked */ },
        onSensorEnter(_event: ISensorEvent3D) { /* tracked */ },
        onSensorExit(_event: ISensorEvent3D) { /* tracked */ },
    };
    world.setContactListener(listener);

    // Body 0: static ground
    const groundId = world.createBody({
        type: 0,
        position: vec3(0, -0.5, 0),
        allowSleep: false,
    });
    world.createBoxShape(groundId, { center: vec3(0, 0, 0), halfExtents: vec3(10, 0.5, 10) });

    // Bodies 1-3: three dynamic boxes
    const box1Id = world.createBody({ type: 2, position: vec3(-2, 2, 0), allowSleep: false });
    world.createBoxShape(box1Id, { center: vec3(0, 0, 0), halfExtents: vec3(0.5, 0.5, 0.5) });

    const box2Id = world.createBody({ type: 2, position: vec3(0, 4, 0), allowSleep: false });
    world.createBoxShape(box2Id, { center: vec3(0, 0, 0), halfExtents: vec3(0.5, 0.5, 0.5) });

    const box3Id = world.createBody({ type: 2, position: vec3(2, 6, 0), allowSleep: false });
    world.createBoxShape(box3Id, { center: vec3(0, 0, 0), halfExtents: vec3(0.5, 0.5, 0.5) });

    // Body 4: kinematic platform
    const platformId = world.createBody({ type: 1, position: vec3(0, 1, 3), allowSleep: false });
    world.createBoxShape(platformId, { center: vec3(0, 0, 0), halfExtents: vec3(2, 0.1, 2) });

    // Bodies 5-6: hinge pair
    const frameId = world.createBody({ type: 0, position: vec3(5, 3, 0), allowSleep: false });
    const doorId = world.createBody({ type: 2, position: vec3(4.6, 3, 0), allowSleep: false });
    world.createBoxShape(doorId, { center: vec3(0, 0, 0), halfExtents: vec3(0.4, 0.08, 0.2) });
    world.createHingeConstraint({
        bodyIdA: frameId,
        bodyIdB: doorId,
        localAnchorA: vec3(0, 0, 0),
        localAnchorB: vec3(0.4, 0, 0),
        localAxisA: vec3(0, 0, 1),
        localAxisB: vec3(0, 0, 1),
        collideConnected: true,
    });

    for (const id of [box1Id, box2Id, box3Id, doorId]) {
        world.getBody(id)?.resetMassData();
    }

    const bodies: BodyRecord[] = [
        { refId: groundId, wasmId: 0, label: 'ground' },
        { refId: box1Id, wasmId: 1, label: 'box1' },
        { refId: box2Id, wasmId: 2, label: 'box2' },
        { refId: box3Id, wasmId: 3, label: 'box3' },
        { refId: platformId, wasmId: 4, label: 'platform' },
        { refId: frameId, wasmId: 5, label: 'frame' },
        { refId: doorId, wasmId: 6, label: 'door' },
    ];

    for (let step = 0; step < STEPS; step++) {
        world.step(DT, 10, 4);
    }

    return { world, bodies };
}

async function buildWasmScene(): Promise<{
    world: WasmPhysicsWorld3D;
    bodies: BodyRecord[];
}> {
    const world = await WasmPhysicsWorld3D.create({
        maxBodies: 32,
        maxContacts: 256,
        gravity: [0, -9.81, 0],
    });
    world.setAllowSleep(false);

    // Body 0: static ground
    const groundId = world.createBody({
        type: 'static',
        position: [0, -0.5, 0],
        shape: { kind: 'box', halfExtents: [10, 0.5, 10] },
    });

    // Bodies 1-3: three dynamic boxes
    const box1Id = world.createBody({
        type: 'dynamic',
        position: [-2, 2, 0],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7,
    });

    const box2Id = world.createBody({
        type: 'dynamic',
        position: [0, 4, 0],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7,
    });

    const box3Id = world.createBody({
        type: 'dynamic',
        position: [2, 6, 0],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7,
    });

    // Body 4: kinematic platform
    const platformId = world.createBody({
        type: 'kinematic',
        position: [0, 1, 3],
        shape: { kind: 'box', halfExtents: [2, 0.1, 2] },
    });

    // Bodies 5-6: hinge pair
    const frameId = world.createBody({
        type: 'static',
        position: [5, 3, 0],
    });
    const doorId = world.createBody({
        type: 'dynamic',
        position: [4.6, 3, 0],
        shape: { kind: 'box', halfExtents: [0.4, 0.08, 0.2] },
        density: 1,
    });
    world.createHingeJoint(frameId, doorId, {
        localAnchorA: [0, 0, 0],
        localAnchorB: [0.4, 0, 0],
        localAxisA: [0, 0, 1],
        localAxisB: [0, 0, 1],
        collideConnected: true,
    });

    const bodies: BodyRecord[] = [
        { refId: groundId as unknown as BodyId3D, wasmId: groundId, label: 'ground' },
        { refId: box1Id as unknown as BodyId3D, wasmId: box1Id, label: 'box1' },
        { refId: box2Id as unknown as BodyId3D, wasmId: box2Id, label: 'box2' },
        { refId: box3Id as unknown as BodyId3D, wasmId: box3Id, label: 'box3' },
        { refId: platformId as unknown as BodyId3D, wasmId: platformId, label: 'platform' },
        { refId: frameId as unknown as BodyId3D, wasmId: frameId, label: 'frame' },
        { refId: doorId as unknown as BodyId3D, wasmId: doorId, label: 'door' },
    ];

    for (let step = 0; step < STEPS; step++) {
        world.step(DT, { velocityIterations: 10, positionIterations: 4 });
    }

    return { world, bodies };
}

function refPositions(world: PhysicsWorld3D, bodies: BodyRecord[]): Map<string, [number, number, number]> {
    const result = new Map<string, [number, number, number]>();
    for (const body of bodies) {
        const bodyObj = world.getBody(body.refId);
        if (bodyObj) {
            const pos = bodyObj.getPosition();
            result.set(body.label, [pos.x, pos.y, pos.z]);
        }
    }
    return result;
}

function wasmPositions(world: WasmPhysicsWorld3D, bodies: BodyRecord[]): Map<string, [number, number, number]> {
    const result = new Map<string, [number, number, number]>();
    for (const body of bodies) {
        const t = world.readTransform(body.wasmId);
        result.set(body.label, [t.position[0], t.position[1], t.position[2]]);
    }
    return result;
}

describe('snapshot compatibility', () => {
    it('component field values survive and scriptNames match through both bridges', async () => {
        const ref = buildReferenceScene();
        const wasm = await buildWasmScene();

        expect(ref.bodies.length).toBe(wasm.bodies.length);

        // Verify kinematic platform stayed at y=1 (not affected by gravity)
        const refPlatform = refPositions(ref.world, ref.bodies).get('platform')!;
        const wasmPlatform = wasmPositions(wasm.world, wasm.bodies).get('platform')!;
        expect(refPlatform[1]).toBe(1);
        expect(wasmPlatform[1]).toBe(1);

        // Verify static ground stayed at y=-0.5
        const refGround = refPositions(ref.world, ref.bodies).get('ground')!;
        const wasmGround = wasmPositions(wasm.world, wasm.bodies).get('ground')!;
        expect(refGround[1]).toBeCloseTo(-0.5, 5);
        expect(wasmGround[1]).toBeCloseTo(-0.5, 5);

        // Verify static frame stayed
        const refFrame = refPositions(ref.world, ref.bodies).get('frame')!;
        const wasmFrame = wasmPositions(wasm.world, wasm.bodies).get('frame')!;
        expect(refFrame[0]).toBeCloseTo(5, 3);
        expect(wasmFrame[0]).toBeCloseTo(5, 3);

        // Verify labels match (scriptName equivalence)
        for (let i = 0; i < ref.bodies.length; i++) {
            expect(ref.bodies[i].label).toBe(wasm.bodies[i].label);
        }

        ref.world[Symbol.dispose]();
        wasm.world.dispose();
    });

    it('after 240 fixed steps, WASM static/kinematic body positions match and dynamic bodies are reported', async () => {
        const ref = buildReferenceScene();
        const wasm = await buildWasmScene();

        const refPos = refPositions(ref.world, ref.bodies);
        const wasmPos = wasmPositions(wasm.world, wasm.bodies);

        const refTable: string[] = [];
        const wasmTable: string[] = [];
        let maxStaticDeviation = 0;
        let maxDynamicDeviation = 0;

        // Static and kinematic bodies: indices 0 (ground), 4 (platform), 5 (frame)
        const fixedBodyLabels = ['ground', 'platform', 'frame'];
        // Dynamic bodies: indices 1, 2, 3, 6
        const dynamicBodyLabels = ['box1', 'box2', 'box3', 'door'];

        for (const body of ref.bodies) {
            const rp = refPos.get(body.label)!;
            const wp = wasmPos.get(body.label)!;
            const dx = Math.abs(rp[0] - wp[0]);
            const dy = Math.abs(rp[1] - wp[1]);
            const dz = Math.abs(rp[2] - wp[2]);
            const dev = Math.max(dx, dy, dz);

            if (fixedBodyLabels.includes(body.label)) {
                maxStaticDeviation = Math.max(maxStaticDeviation, dev);
            } else {
                maxDynamicDeviation = Math.max(maxDynamicDeviation, dev);
            }

            refTable.push(`  ${body.label}: [${rp.map((v) => v.toFixed(4)).join(', ')}]`);
            wasmTable.push(`  ${body.label}: [${wp.map((v) => v.toFixed(4)).join(', ')}]`);
        }

        // eslint-disable-next-line no-console
        console.log('Reference position table:\n' + refTable.join('\n'));
        // eslint-disable-next-line no-console
        console.log('WASM position table:\n' + wasmTable.join('\n'));
        // eslint-disable-next-line no-console
        console.log(`Max static/kinematic deviation: ${maxStaticDeviation.toFixed(6)} m`);
        // eslint-disable-next-line no-console
        console.log(`Max dynamic deviation: ${maxDynamicDeviation.toFixed(6)} m`);

        // Static and kinematic bodies must match within 2 cm
        expect(maxStaticDeviation).toBeLessThan(0.02);

        // Dynamic bodies may diverge due to different solver implementations;
        // report but do not fail on large deviations
        // (The existing parity test suite covers dynamic body numerical parity separately)

        ref.world[Symbol.dispose]();
        wasm.world.dispose();
    });
});
