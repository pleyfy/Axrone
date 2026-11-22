import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D } from '../index';
import { loadEmbeddedWasm } from '../loader';
import type { ContactEventSnapshot } from '../types';

const DT = 1 / 60;
const EVENT_STRIDE = 10;
const EVENT_CAPACITY = 4096;

async function createWorld(): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies: 32,
        maxContacts: 256,
        gravity: [0, -9.81, 0]
    });
}

function addGround(world: WasmPhysicsWorld3D): number {
    return world.createBody({
        type: 'static',
        position: [0, -0.5, 0],
        shape: { kind: 'box', halfExtents: [10, 0.5, 10] }
    });
}

function addDropBox(world: WasmPhysicsWorld3D): number {
    return world.createBody({
        position: [0, 3, 0],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7
    });
}

function shapeBodyId(shapeId: number): number {
    return (shapeId >> 3) & 0x3ffff;
}

function shapeSlotOf(shapeId: number): number {
    return shapeId & 7;
}

function pairOf(event: ContactEventSnapshot): number[] {
    return [event.bodyA, event.bodyB].sort((left, right) => left - right);
}

function assertShapeSides(event: ContactEventSnapshot): void {
    expect(shapeBodyId(event.shapeA)).toBe(event.bodyA);
    expect(shapeBodyId(event.shapeB)).toBe(event.bodyB);
    expect(shapeSlotOf(event.shapeA)).toBe(0);
    expect(shapeSlotOf(event.shapeB)).toBe(0);
}

describe('contact event ring', () => {
    it('reports begin then stay for a landing box and exposes shape ids', async () => {
        const world = await createWorld();
        const ground = addGround(world);
        const box = addDropBox(world);

        let begin: ContactEventSnapshot | null = null;
        for (let index = 0; index < 240 && begin === null; index += 1) {
            world.step(DT);
            begin = world.drainEvents().find((event) => event.kind === 'begin') ?? null;
        }

        expect(begin).not.toBeNull();
        const first = begin as ContactEventSnapshot;
        expect(pairOf(first)).toEqual([ground, box]);
        expect(first.bodyA).toBe(ground);
        expect(Number.isFinite(first.penetration)).toBe(true);
        expect(first.normal.length).toBe(3);
        assertShapeSides(first);

        let stayed = false;
        for (let index = 0; index < 5 && !stayed; index += 1) {
            world.step(DT);
            stayed = world.drainEvents().some((event) =>
                event.kind === 'stay' && event.bodyA === first.bodyA && event.bodyB === first.bodyB
            );
        }
        expect(stayed).toBe(true);
        world.dispose();
    });

    it('reports end with zero payload when the box is removed', async () => {
        const world = await createWorld();
        const ground = addGround(world);
        const box = addDropBox(world);

        let began = false;
        for (let index = 0; index < 240 && !began; index += 1) {
            world.step(DT);
            began = world.drainEvents().some((event) => event.kind === 'begin');
        }
        expect(began).toBe(true);

        world.destroyBody(box);
        world.step(DT);
        const events = world.drainEvents();
        const end = events.find((event) => event.kind === 'end') ?? null;
        expect(end).not.toBeNull();
        const record = end as ContactEventSnapshot;
        expect(pairOf(record)).toEqual([ground, box]);
        expect(record.normal).toEqual([0, 0, 0]);
        expect(record.penetration).toBe(0);
        assertShapeSides(record);

        expect(world.drainEvents()).toEqual([]);
        world.dispose();
    });

    it('emits sensor enter stay exit kinds without collision kinds', async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, -9.81, 0)).toBe(0);

        const ball = wasm.bodyCreate(1, 0, 3, 0, 0, 0, 0, 1);
        expect(wasm.bodySetSphere(ball, 0.25, 1)).toBe(0);
        const trigger = wasm.bodyCreate(0, 0, 0, 0, 0, 0, 0, 1);
        const triggerShape = wasm.shapeCreateSphere(trigger, 1.0, 0, 0, 0, 0);
        expect(triggerShape).toBeGreaterThanOrEqual(0);
        expect(wasm.shapeSetSensor(triggerShape, 1)).toBe(0);

        const pointer = wasm.eventsPtr();
        expect(pointer % 16).toBe(0);
        const ints = new Int32Array(wasm.memory.buffer, pointer, EVENT_CAPACITY * EVENT_STRIDE);
        const floats = new Float32Array(wasm.memory.buffer, pointer, EVENT_CAPACITY * EVENT_STRIDE);

        const kinds: number[] = [];
        let enterBodyA = -1;
        let exitPayload: number[] = [];
        for (let frame = 0; frame < 300; frame += 1) {
            expect(wasm.step(DT, 8, 3)).toBeGreaterThanOrEqual(0);
            const count = wasm.eventCount();
            for (let index = 0; index < count; index += 1) {
                const base = index * EVENT_STRIDE;
                const kind = ints[base];
                kinds.push(kind);
                expect(floats[base + 9]).toBe(0);
                if (kind === 3 && enterBodyA < 0) {
                    enterBodyA = ints[base + 1];
                }
                if (kind === 5) {
                    exitPayload = [
                        floats[base + 5],
                        floats[base + 6],
                        floats[base + 7],
                        floats[base + 8]
                    ];
                }
            }
            wasm.eventsClear();
            expect(wasm.eventCount()).toBe(0);
        }

        expect(kinds.filter((kind) => kind === 3)).toHaveLength(1);
        expect(kinds.filter((kind) => kind === 4).length).toBeGreaterThanOrEqual(1);
        expect(kinds.filter((kind) => kind === 5)).toHaveLength(1);
        expect(kinds.some((kind) => kind === 0 || kind === 1 || kind === 2)).toBe(false);
        expect(enterBodyA).toBe(trigger);
        expect(exitPayload).toEqual([0, 0, 0, 0]);
    });

    it('clears the reported count after draining', async () => {
        const world = await createWorld();
        addGround(world);
        addDropBox(world);

        let drained = false;
        for (let index = 0; index < 240 && !drained; index += 1) {
            world.step(DT);
            drained = world.drainEvents().length > 0;
        }
        expect(drained).toBe(true);
        expect(world.drainEvents()).toEqual([]);
        world.dispose();
    });

    it('returns no events before any contact exists', async () => {
        const world = await createWorld();
        addGround(world);
        addDropBox(world);

        world.step(DT);
        expect(world.drainEvents()).toEqual([]);
        world.dispose();
    });

    it('keeps the overflow counter at zero for a small scene', async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, -9.81, 0)).toBe(0);

        const ground = wasm.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
        expect(wasm.bodySetBox(ground, 10, 0.5, 10, 0)).toBe(0);
        const box = wasm.bodyCreate(1, 0, 3, 0, 0, 0, 0, 1);
        expect(wasm.bodySetBox(box, 0.5, 0.5, 0.5, 1)).toBe(0);

        let sawEvents = false;
        for (let index = 0; index < 240; index += 1) {
            expect(wasm.step(DT, 8, 3)).toBeGreaterThanOrEqual(0);
            if (wasm.eventCount() > 0) {
                sawEvents = true;
                expect(wasm.eventCount()).toBeLessThanOrEqual(EVENT_CAPACITY);
                wasm.eventsClear();
                expect(wasm.eventCount()).toBe(0);
            }
        }

        expect(sawEvents).toBe(true);
        expect(wasm.eventsOverflow()).toBe(0);

        wasm.worldReset();
        expect(wasm.eventCount()).toBe(0);
        expect(wasm.eventsOverflow()).toBe(0);
        expect(wasm.eventsPtr() % 16).toBe(0);
    });
});
