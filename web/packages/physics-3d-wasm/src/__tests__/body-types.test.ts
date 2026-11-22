import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    WasmBodyTypeCode,
    WasmPhysicsWorld3D,
    WasmPhysicsWorld3DCompat,
    loadEmbeddedWasm
} from '../index';
import { WasmBodyType } from '../types';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DT = 1 / 60;

const abiCodeFromHeader = (name: string): number => {
    const header = readFileSync(path.join(packageRoot, 'src', 'core', 'constants.h'), 'utf8');
    const declaration = new RegExp(`constexpr int32_t ${name} = (\\d+);`).exec(header);
    if (!declaration) {
        throw new Error(`${name} is not declared in src/core/constants.h`);
    }
    return Number(declaration[1]);
};

describe('body type codes', () => {
    it('pins the raw ABI dictionary to the codes declared by the native header', () => {
        expect(WasmBodyTypeCode).toEqual({ static: 0, dynamic: 1, kinematic: 2 });
        expect(Object.isFrozen(WasmBodyTypeCode)).toBe(true);
        expect(WasmBodyTypeCode.static).toBe(abiCodeFromHeader('kBodyTypeStatic'));
        expect(WasmBodyTypeCode.dynamic).toBe(abiCodeFromHeader('kBodyTypeDynamic'));
        expect(WasmBodyTypeCode.kinematic).toBe(abiCodeFromHeader('kBodyTypeKinematic'));
    });

    it('binds every raw ABI code to its gravity behavior in the shipped module', async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, -9.81, 0)).toBe(0);

        const codes = [WasmBodyTypeCode.static, WasmBodyTypeCode.dynamic, WasmBodyTypeCode.kinematic];
        const handles = codes.map((code, slot) => {
            const id = wasm.bodyCreate(code, slot * 2, 10, 0, 0, 0, 0, 1);
            expect(id).toBeGreaterThanOrEqual(0);
            expect(wasm.bodySetSphere(id, 0.5, code === WasmBodyTypeCode.dynamic ? 1 : 0)).toBe(0);
            return id;
        });

        for (let index = 0; index < 60; index += 1) {
            expect(wasm.step(DT, 8, 3)).toBeGreaterThanOrEqual(0);
        }

        const transforms = new Float32Array(wasm.memory.buffer, wasm.transformsPtr(), 16 * 7);
        expect(handles.map((id) => transforms[id * 7 + 1] < 9.5)).toEqual([false, true, false]);
    });

    it('keeps the reference table out of the package entry and the raw codes in it', async () => {
        const entry = await import('../index');
        expect(entry).not.toHaveProperty('WasmBodyType');
        expect(entry).toHaveProperty('WasmBodyTypeCode', WasmBodyTypeCode);
        expect(WasmBodyTypeCode).not.toBe(WasmBodyType);
        expect(WasmBodyTypeCode.dynamic).toBe(WasmBodyType.kinematic);
        expect(WasmBodyTypeCode.kinematic).toBe(WasmBodyType.dynamic);
        expect(WasmBodyTypeCode.static).toBe(WasmBodyType.static);
    });

    it('pins the reference order used by the TypeScript surface', () => {
        expect(WasmBodyType.static).toBe(0);
        expect(WasmBodyType.kinematic).toBe(1);
        expect(WasmBodyType.dynamic).toBe(2);
        expect(Object.isFrozen(WasmBodyType)).toBe(true);
        expect({ ...WasmBodyType }).toEqual({ static: 0, kinematic: 1, dynamic: 2 });
    });

    it('pins the current C ABI numbering through observed behavior', async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, -9.81, 0)).toBe(0);

        const staticBody = wasm.bodyCreate(0, 0, 5, 0, 0, 0, 0, 1);
        expect(wasm.bodySetSphere(staticBody, 0.5, 0)).toBe(0);
        const abiDynamic = wasm.bodyCreate(1, 0, 5, 0, 0, 0, 0, 1);
        expect(wasm.bodySetSphere(abiDynamic, 0.5, 1)).toBe(0);
        const abiKinematic = wasm.bodyCreate(2, 0, 5, 0, 0, 0, 0, 1);
        expect(wasm.bodySetSphere(abiKinematic, 0.5, 0)).toBe(0);

        for (let index = 0; index < 60; index += 1) {
            expect(wasm.step(DT, 8, 3)).toBeGreaterThanOrEqual(0);
        }

        const transforms = new Float32Array(wasm.memory.buffer, wasm.transformsPtr(), 16 * 7);
        expect(transforms[abiDynamic * 7 + 1]).toBeLessThan(4.5);
        expect(transforms[abiKinematic * 7 + 1]).toBe(5);
        expect(transforms[staticBody * 7 + 1]).toBe(5);

        expect(abiDynamic).not.toBe(WasmBodyType.dynamic);
        expect(WasmBodyType.dynamic).toBe(2);
    });

    it('translates reference codes through the facade and compat layers', async () => {
        const world = await WasmPhysicsWorld3D.create({
            maxBodies: 16,
            maxContacts: 256,
            gravity: [0, -9.81, 0]
        });
        const facadeDynamic = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
        world.attachSphere(facadeDynamic, 0.5, 1);
        const facadeKinematic = world.createBody({ type: 'kinematic', position: [0, 5, 0] });
        world.attachSphere(facadeKinematic, 0.5, 0);
        for (let index = 0; index < 60; index += 1) {
            world.step(DT);
        }
        expect(world.readTransform(facadeDynamic).position[1]).toBeLessThan(4.5);
        expect(world.readTransform(facadeKinematic).position[1]).toBe(5);
        world.dispose();

        const compat = await WasmPhysicsWorld3DCompat.create({ maxBodies: 16 });
        const compatKinematic = compat.createBody({
            type: WasmBodyType.kinematic,
            position: { x: 0, y: 5, z: 0 }
        });
        compat.createSphereShape(compatKinematic, { radius: 0.5 });
        const compatDynamic = compat.createBody({
            type: WasmBodyType.dynamic,
            position: { x: 2, y: 5, z: 0 }
        });
        compat.createSphereShape(compatDynamic, { radius: 0.5 });
        const compatStatic = compat.createBody({
            type: WasmBodyType.static,
            position: { x: 4, y: 5, z: 0 }
        });
        compat.createSphereShape(compatStatic, { radius: 0.5 });

        for (let index = 0; index < 60; index += 1) {
            compat.step(DT, 8, 3);
        }

        expect(compat.getTransform(compatKinematic).position[1]).toBe(5);
        expect(compat.getTransform(compatDynamic).position[1]).toBeLessThan(4.5);
        expect(compat.getTransform(compatStatic).position[1]).toBe(5);
        compat.dispose();
    });
});
