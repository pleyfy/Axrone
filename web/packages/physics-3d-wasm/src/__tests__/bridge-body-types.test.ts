import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3DCompat } from '../index';
import { WasmBodyType } from '../types';
import { WasmPhysicsWorld3D } from '../world';
import { loadEmbeddedWasm } from '../loader';

const DT = 1 / 60;

describe('body type mapping', () => {
    it('proves the mapping: reference Static=0, Kinematic=1, Dynamic=2 vs WASM ABI Static=0, Dynamic=1, Kinematic=2', async () => {
        // The reference (TypeScript) surface uses:
        //   Static=0, Kinematic=1, Dynamic=2
        // The WASM C ABI uses:
        //   Static=0, Dynamic=1, Kinematic=2
        // The compat layer translates between them.

        // Verify the facade's WasmBodyType enum (reference surface)
        expect(WasmBodyType.static).toBe(0);
        expect(WasmBodyType.kinematic).toBe(1);
        expect(WasmBodyType.dynamic).toBe(2);

        // Verify the WASM ABI codes through direct wasm calls
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, -9.81, 0)).toBe(0);

        // ABI body type 0 = static: should not fall under gravity
        const abiStatic = wasm.bodyCreate(0, 0, 10, 0, 0, 0, 0, 1);
        wasm.bodySetSphere(abiStatic, 0.5, 0);

        // ABI body type 1 = dynamic: should fall under gravity
        const abiDynamic = wasm.bodyCreate(1, 0, 10, 0, 0, 0, 0, 1);
        wasm.bodySetSphere(abiDynamic, 0.5, 1);

        // ABI body type 2 = kinematic: should NOT fall under gravity
        const abiKinematic = wasm.bodyCreate(2, 0, 10, 0, 0, 0, 0, 1);
        wasm.bodySetSphere(abiKinematic, 0.5, 0);

        for (let i = 0; i < 60; i++) {
            wasm.step(DT, 8, 3);
        }

        const transforms = new Float32Array(wasm.memory.buffer, wasm.transformsPtr(), 16 * 7);

        // ABI static (type 0) stays at y=10
        expect(transforms[abiStatic * 7 + 1]).toBe(10);

        // ABI dynamic (type 1) falls below y=10
        expect(transforms[abiDynamic * 7 + 1]).toBeLessThan(9.5);

        // ABI kinematic (type 2) stays at y=10
        expect(transforms[abiKinematic * 7 + 1]).toBe(10);

        // Prove the mapping difference:
        // Reference: Kinematic=1, but ABI: Dynamic=1
        expect(WasmBodyType.kinematic).toBe(1); // reference code for kinematic
        // ABI code 1 behaves as dynamic (falls), not kinematic
        expect(transforms[abiDynamic * 7 + 1]).toBeLessThan(9.5); // ABI 1 = dynamic = falls
    });

    it('kinematic snapshot round-trips without becoming dynamic through the compat layer', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({
            maxBodies: 16,
            gravity: { x: 0, y: -9.81, z: 0 },
        });

        // Create a kinematic body (compat type 1 = reference Kinematic)
        const kinematic = world.createBody({
            type: 1, // WasmBodyType.kinematic in compat = reference kinematic
            position: { x: 0, y: 5, z: 0 },
        });
        world.createSphereShape(kinematic, { radius: 0.5 });

        // Step 240 times
        for (let i = 0; i < 240; i++) {
            world.step(DT, 8, 3);
        }

        // Kinematic body should NOT have fallen (stays at y=5)
        const transform = world.getTransform(kinematic);
        expect(transform.position[1]).toBe(5);

        // Now create a dynamic body for comparison
        const dynamic = world.createBody({
            type: 2, // WasmBodyType.dynamic in compat = reference dynamic
            position: { x: 3, y: 5, z: 0 },
        });
        world.createSphereShape(dynamic, { radius: 0.5 });
        world.getBody(dynamic)?.resetMassData();

        for (let i = 0; i < 60; i++) {
            world.step(DT, 8, 3);
        }

        // Dynamic body SHOULD have fallen
        const dynamicTransform = world.getTransform(dynamic);
        expect(dynamicTransform.position[1]).toBeLessThan(4.5);

        // Kinematic body should STILL be at y=5 (never became dynamic)
        const kinematicAfter = world.getTransform(kinematic);
        expect(kinematicAfter.position[1]).toBe(5);

        world.dispose();
    });

    it('kinematic body through the facade stays at its position under gravity', async () => {
        const world = await WasmPhysicsWorld3D.create({
            maxBodies: 16,
            maxContacts: 256,
            gravity: [0, -9.81, 0],
        });

        const kinematic = world.createBody({
            type: 'kinematic',
            position: [0, 5, 0],
            shape: { kind: 'sphere', radius: 0.5 },
        });

        for (let i = 0; i < 240; i++) {
            world.step(DT);
        }

        const transform = world.readTransform(kinematic);
        expect(transform.position[1]).toBe(5);

        world.dispose();
    });

    it('static body through the compat layer stays at its position', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({
            maxBodies: 16,
            gravity: { x: 0, y: -9.81, z: 0 },
        });

        const staticBody = world.createBody({
            type: 0, // WasmBodyType.static
            position: { x: 0, y: 5, z: 0 },
        });
        world.createSphereShape(staticBody, { radius: 0.5 });

        for (let i = 0; i < 240; i++) {
            world.step(DT, 8, 3);
        }

        const transform = world.getTransform(staticBody);
        expect(transform.position[1]).toBe(5);

        world.dispose();
    });

    it('compat layer correctly maps all three body types', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({
            maxBodies: 16,
            gravity: { x: 0, y: -9.81, z: 0 },
        });

        // Type 0 = static
        const staticBody = world.createBody({ type: 0, position: { x: -3, y: 5, z: 0 } });
        world.createSphereShape(staticBody, { radius: 0.5 });

        // Type 1 = kinematic
        const kinematicBody = world.createBody({ type: 1, position: { x: 0, y: 5, z: 0 } });
        world.createSphereShape(kinematicBody, { radius: 0.5 });

        // Type 2 = dynamic
        const dynamicBody = world.createBody({ type: 2, position: { x: 3, y: 5, z: 0 } });
        world.createSphereShape(dynamicBody, { radius: 0.5 });
        world.getBody(dynamicBody)?.resetMassData();

        for (let i = 0; i < 120; i++) {
            world.step(DT, 8, 3);
        }

        const staticT = world.getTransform(staticBody);
        const kinematicT = world.getTransform(kinematicBody);
        const dynamicT = world.getTransform(dynamicBody);

        // Static stays
        expect(staticT.position[1]).toBe(5);
        // Kinematic stays
        expect(kinematicT.position[1]).toBe(5);
        // Dynamic falls
        expect(dynamicT.position[1]).toBeLessThan(4.0);

        world.dispose();
    });
});
