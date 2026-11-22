import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D } from '../index';
import { CollisionFlags, WasmCharacterController } from '../character-controller';
import type { Vec3Tuple } from '../types';

const RADIUS = 0.3;
const HEIGHT = 1.8;
const SKIN_WIDTH = 0.15;
const HALF_BODY_HEIGHT = 0.9;
const JUMP_SPEED = 8;
const STEP_SURFACE_Y = -0.2361162;
const STEP_TARGET_Y = STEP_SURFACE_Y + HALF_BODY_HEIGHT;

async function createWorld(maxBodies = 32): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: Math.max(1024, maxBodies * 16),
        gravity: [0, -9.81, 0]
    });
}

function addStaticBox(
    world: WasmPhysicsWorld3D,
    position: Vec3Tuple,
    halfExtents: Vec3Tuple,
    rotation: readonly [number, number, number, number] = [0, 0, 0, 1]
): number {
    return world.createBody({ type: 'static', position, shape: { kind: 'box', halfExtents }, rotation });
}

function addCharacterCapsule(
    world: WasmPhysicsWorld3D,
    position: Vec3Tuple,
    radius = RADIUS,
    halfSegment = HALF_BODY_HEIGHT - RADIUS,
    rotation: readonly [number, number, number, number] = [0, 0, 0, 1]
): number {
    return world.createBody({
        type: 'static',
        position,
        shape: { kind: 'capsule', radius, halfSegment },
        rotation
    });
}

interface SceneRig {
    world: WasmPhysicsWorld3D;
    character: number;
    block: number;
    slope: number;
    controller: WasmCharacterController;
}

function buildScene(world: WasmPhysicsWorld3D, character: number): SceneRig {
    addStaticBox(world, [-1.35, -20, 0], [3.65, 20, 20]);
    const block = addStaticBox(world, [1.4, 0.125, 0], [0.8, 0.125, 2]);
    addStaticBox(world, [0, 1.3, 3.05], [5, 1.3, 0.075]);
    const slope = addStaticBox(world, [3.17, -0.541, 2.5], [0.44, 0.06, 1], [0, 0, -0.3420201433256687, 0.9396926207859084]);
    const controller = new WasmCharacterController({
        world,
        body: character,
        radius: RADIUS,
        height: HEIGHT,
        skinWidth: SKIN_WIDTH,
        slopeLimitAngle: 45,
        stepHeight: 0.3,
        jumpSpeed: JUMP_SPEED
    });
    return { world, character, block, slope, controller };
}

async function createSceneRig(): Promise<SceneRig> {
    const world = await createWorld();
    const character = addCharacterCapsule(world, [0, 0.9, 0]);
    return buildScene(world, character);
}

function positionOf(rig: SceneRig): Vec3Tuple {
    return rig.world.readTransform(rig.character).position;
}

function expectPositionWithin(actual: Vec3Tuple, expected: Vec3Tuple): void {
    for (let axis = 0; axis < 3; axis += 1) {
        expect(Math.abs(actual[axis] - expected[axis])).toBeLessThan(0.002);
    }
}

function capsuleTouchIds(rig: SceneRig): number[] {
    const p = positionOf(rig);
    const ids = rig.world.overlapBoxAll(
        [p[0] - RADIUS, p[1] - HALF_BODY_HEIGHT, p[2] - RADIUS],
        [p[0] + RADIUS, p[1] + HALF_BODY_HEIGHT, p[2] + RADIUS]
    );
    return ids.filter((id) => id !== rig.character);
}

interface ScriptResult {
    flags: number[];
    positions: Vec3Tuple[];
    groundedAfterRise: boolean;
}

function runScriptedScene(rig: SceneRig): ScriptResult {
    const flags: number[] = [];
    const positions: Vec3Tuple[] = [];
    const { controller } = rig;

    flags.push(controller.move([0, 0, 3]));
    positions.push(positionOf(rig));
    flags.push(controller.move([1, 0, 0]));
    positions.push(positionOf(rig));
    flags.push(controller.move([1.9, 0, 0]));
    positions.push(positionOf(rig));
    flags.push(controller.move([0, 0, 1.6]));
    positions.push(positionOf(rig));

    controller.jump();
    let guard = 0;
    do {
        flags.push(controller.move([0, 0, 0]));
        guard += 1;
    } while (controller.isGrounded() && guard < 20);
    const groundedAfterRise = controller.isGrounded();

    guard = 0;
    do {
        flags.push(controller.move([0, 0, 0]));
        guard += 1;
    } while (!controller.isGrounded() && guard < 400);
    positions.push(positionOf(rig));

    return { flags, positions, groundedAfterRise };
}

describe('wasm character controller', () => {
    it('replays the scripted scene with reference collision flags and derived positions', async () => {
        const rig = await createSceneRig();
        const { controller } = rig;

        const wallFlags = controller.move([0, 0, 3]);
        expect(wallFlags).toBe(CollisionFlags.Sides | CollisionFlags.Below);
        expectPositionWithin(positionOf(rig), [0, 0.9, 0]);
        expect(controller.isGrounded()).toBe(true);

        const stepFlags = controller.move([1, 0, 0]);
        expect(stepFlags).toBe(CollisionFlags.Below);
        expectPositionWithin(positionOf(rig), [1, 1.15, 0]);
        expect(controller.isGrounded()).toBe(true);

        const ledgeFlags = controller.move([1.9, 0, 0]);
        expect(ledgeFlags).toBe(CollisionFlags.None);
        expectPositionWithin(positionOf(rig), [2.9, 1.15, 0]);
        expect(controller.isGrounded()).toBe(false);

        const slopeFlags = controller.move([0, 0, 1.6]);
        expect(slopeFlags).toBe(CollisionFlags.Below);
        expectPositionWithin(positionOf(rig), [2.9, STEP_TARGET_Y, 1.6]);
        expect(controller.isGrounded()).toBe(true);

        controller.jump();
        let riseFrames = 0;
        do {
            controller.move([0, 0, 0]);
            riseFrames += 1;
        } while (controller.isGrounded() && riseFrames < 20);
        expect(controller.isGrounded()).toBe(false);
        expect(riseFrames).toBeLessThanOrEqual(20);

        let fallFrames = 0;
        let landFlags: number = CollisionFlags.None;
        do {
            landFlags = controller.move([0, 0, 0]);
            fallFrames += 1;
        } while (!controller.isGrounded() && fallFrames < 400);
        expect(controller.isGrounded()).toBe(true);
        expect(landFlags).toBe(CollisionFlags.Below);
        expectPositionWithin(positionOf(rig), [2.9, STEP_TARGET_Y, 1.6]);
        rig.world.dispose();
    });

    it('keeps the capsule AABB outside every collider it did not legally touch', async () => {
        const rig = await createSceneRig();
        const { controller } = rig;

        controller.move([0, 0, 3]);
        expect(capsuleTouchIds(rig)).toEqual([]);

        controller.move([1, 0, 0]);
        expect(capsuleTouchIds(rig)).toEqual([rig.block]);

        controller.move([1.9, 0, 0]);
        expect(capsuleTouchIds(rig)).toEqual([]);

        controller.move([0, 0, 1.6]);
        expect(capsuleTouchIds(rig)).toEqual([rig.slope]);

        controller.jump();
        let guard = 0;
        do {
            controller.move([0, 0, 0]);
            guard += 1;
        } while (controller.isGrounded() && guard < 20);
        guard = 0;
        do {
            controller.move([0, 0, 0]);
            guard += 1;
        } while (!controller.isGrounded() && guard < 400);
        expect(capsuleTouchIds(rig)).toEqual([rig.slope]);
        rig.world.dispose();
    });

    it('stays grounded on a 30 degree slope and falls off a 60 degree slope', async () => {
        const shallowWorld = await createWorld();
        const shallowCharacter = addCharacterCapsule(shallowWorld, [2.9, 0.5842, 1.6]);
        addStaticBox(
            shallowWorld,
            [3.17, -0.541, 2.5],
            [1.2, 0.06, 1],
            [0, 0, -0.25881904510252074, 0.9659258262890683]
        );
        const shallow = new WasmCharacterController({
            world: shallowWorld,
            body: shallowCharacter,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH,
            jumpSpeed: JUMP_SPEED
        });
        shallow.move([0, 0, 0]);
        expect(shallow.isGrounded()).toBe(true);
        expect(Math.abs(shallowWorld.readTransform(shallowCharacter).position[1] - 0.584167)).toBeLessThan(0.002);
        shallowWorld.dispose();

        const steepWorld = await createWorld();
        const steepCharacter = addCharacterCapsule(steepWorld, [2.9, 0.9467, 1.6]);
        addStaticBox(
            steepWorld,
            [3.17, -0.541, 2.5],
            [1.2, 0.06, 1],
            [0, 0, -0.5, 0.8660254037844387]
        );
        const steep = new WasmCharacterController({
            world: steepWorld,
            body: steepCharacter,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH,
            jumpSpeed: JUMP_SPEED
        });
        for (let frame = 0; frame < 10; frame += 1) {
            expect(steep.move([0, 0, 0])).toBe(CollisionFlags.None);
        }
        expect(steep.isGrounded()).toBe(false);
        const steepY = steepWorld.readTransform(steepCharacter).position[1];
        expect(steepY).toBeLessThan(0.9467 - 0.1);
        expect(steepY).toBeGreaterThan(0.528);
        steepWorld.dispose();
    });

    it('blocks horizontal motion against a step taller than stepHeight and reports Sides', async () => {
        const world = await createWorld();
        addStaticBox(world, [0, -20, 0], [20, 20, 20]);
        addStaticBox(world, [1.8, 0.3, 0], [0.4, 0.3, 2]);
        const character = addCharacterCapsule(world, [0, 1, 0], 0.5, 0.5);
        const controller = new WasmCharacterController({ world, body: character });

        const flags = controller.move([1.2, 0, 0]);
        expect(flags & CollisionFlags.Sides).toBe(CollisionFlags.Sides);
        const p = world.readTransform(character).position;
        expect(Math.abs(p[0])).toBeLessThan(0.002);
        expect(flags).toBe(CollisionFlags.Sides | CollisionFlags.Below);
        world.dispose();
    });

    it('replays the scripted scene with bit-identical positions across two runs', async () => {
        const firstWorld = await createWorld();
        const firstCharacter = addCharacterCapsule(firstWorld, [0, 0.9, 0]);
        const firstRig = buildScene(firstWorld, firstCharacter);
        const firstRun = runScriptedScene(firstRig);
        firstWorld.dispose();

        const secondWorld = await createWorld();
        const secondCharacter = addCharacterCapsule(secondWorld, [0, 0.9, 0]);
        const secondRig = buildScene(secondWorld, secondCharacter);
        const secondRun = runScriptedScene(secondRig);
        secondWorld.dispose();

        expect(firstRun.flags).toEqual(secondRun.flags);
        expect(firstRun.positions).toStrictEqual(secondRun.positions);
        expect(firstRun.groundedAfterRise).toBe(secondRun.groundedAfterRise);
    });

    it('validates numeric construction inputs', async () => {
        const world = await createWorld();
        const character = addCharacterCapsule(world, [0, 0.9, 0]);
        const base = { world, body: character, radius: RADIUS, height: HEIGHT };

        expect(() => new WasmCharacterController({ ...base, radius: Number.NaN })).toThrow(/radius/);
        expect(() => new WasmCharacterController({ ...base, radius: -0.5 })).toThrow(/radius/);
        expect(() => new WasmCharacterController({ ...base, height: 0 })).toThrow(/height/);
        expect(() => new WasmCharacterController({ ...base, height: Number.NaN })).toThrow(/height/);
        expect(() => new WasmCharacterController({ ...base, skinWidth: Number.NaN })).toThrow(/skinWidth/);
        expect(() => new WasmCharacterController({ ...base, slopeLimitAngle: Number.NaN })).toThrow(/slopeLimitAngle/);
        expect(() => new WasmCharacterController({ ...base, stepHeight: -0.1 })).toThrow(/stepHeight/);
        expect(() => new WasmCharacterController({ ...base, minMoveDistance: Number.NaN })).toThrow(/minMoveDistance/);
        expect(() => new WasmCharacterController({ ...base, jumpSpeed: Number.POSITIVE_INFINITY })).toThrow(/jumpSpeed/);
        expect(() => new WasmCharacterController({ ...base, gravityScale: Number.NaN })).toThrow(/gravityScale/);
        expect(() => new WasmCharacterController({ world, body: -3 })).toThrow(/body/);
        expect(() => new WasmCharacterController({ world, body: 1.5 })).toThrow(/body/);
        expect(() => new WasmCharacterController({ world, body: 9999 })).toThrow(/not active/);

        const controller = new WasmCharacterController(base);
        expect(() => controller.move([Number.NaN, 0, 0])).toThrow(/motion/);
        controller.dispose();

        const defaultsBody = addCharacterCapsule(world, [0, 1, -120], 0.5, 0.5);
        const defaults = new WasmCharacterController({ world, body: defaultsBody });
        expect(defaults.radius).toBe(0.5);
        expect(defaults.height).toBe(2);
        expect(defaults.skinWidth).toBe(0.08);
        expect(defaults.slopeLimitAngle).toBe(45);
        expect(defaults.stepHeight).toBe(0.3);
        expect(defaults.minMoveDistance).toBe(0.001);
        defaults.dispose();
        world.dispose();
    });

    it('rejects bodies that do not expose an upright capsule', async () => {
        const world = await createWorld();
        const boxBody = addStaticBox(world, [0, 1, -20], [0.5, 1, 0.5]);
        const sphereBody = world.createBody({ type: 'static', position: [0, 1, -40], shape: { kind: 'sphere', radius: 0.5 } });
        const cylinderBody = world.createBody({ type: 'static', position: [0, 1, -60], shape: { kind: 'cylinder', radius: 0.5, halfHeight: 1 } });
        const emptyBody = world.createBody({ type: 'static', position: [0, 1, -80] });
        const tiltedBody = addCharacterCapsule(world, [0, 1, -100], 0.5, 0.5, [0, 0, 0.25881904510252074, 0.9659258262890683]);

        expect(() => new WasmCharacterController({ world, body: boxBody })).toThrow(/capsule/);
        expect(() => new WasmCharacterController({ world, body: sphereBody })).toThrow(/capsule/);
        expect(() => new WasmCharacterController({ world, body: cylinderBody })).toThrow(/capsule/);
        expect(() => new WasmCharacterController({ world, body: emptyBody })).toThrow(/capsule/);
        expect(() => new WasmCharacterController({ world, body: tiltedBody })).toThrow(/upright/);
        world.dispose();
    });

    it('honors enabled state, minMoveDistance suppression, pending simple moves and velocity tracking', async () => {
        const world = await createWorld();
        addStaticBox(world, [0, -20, 0], [20, 20, 20]);
        const character = addCharacterCapsule(world, [0, 0.9, 0]);
        const controller = new WasmCharacterController({
            world,
            body: character,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH
        });

        expect(controller.move([0, 0, 0])).toBe(CollisionFlags.Below);
        expect(controller.isGrounded()).toBe(true);

        expect(controller.move([0.0005, 0, 0])).toBe(CollisionFlags.None);
        expect(Math.abs(world.readTransform(character).position[0])).toBeLessThan(1e-9);

        controller.setEnabled(false);
        expect(controller.enabled).toBe(false);
        expect(controller.move([1, 0, 0])).toBe(CollisionFlags.None);
        expect(Math.abs(world.readTransform(character).position[0])).toBeLessThan(1e-9);
        controller.setEnabled(true);

        expect(controller.simpleMove([2, 0, 0])).toBe(true);
        expect(controller.move([0, 0, 0])).toBe(CollisionFlags.Below);
        expect(Math.abs(world.readTransform(character).position[0] - 2 / 60)).toBeLessThan(0.002);
        expect(controller.velocity[0]).toBeCloseTo(2, 3);
        expect(controller.collisionFlags).toBe(CollisionFlags.Below);
        world.dispose();
    });

    it('jumps and lands on flat ground returning to the standing height', async () => {
        const world = await createWorld();
        addStaticBox(world, [0, -20, 0], [20, 20, 20]);
        const character = addCharacterCapsule(world, [0, 0.9, 0]);
        const controller = new WasmCharacterController({
            world,
            body: character,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH,
            jumpSpeed: JUMP_SPEED
        });

        expect(controller.move([0, 0, 0])).toBe(CollisionFlags.Below);
        expect(controller.isGrounded()).toBe(true);

        controller.jump();
        let riseFrames = 0;
        do {
            controller.move([0, 0, 0]);
            riseFrames += 1;
        } while (controller.isGrounded() && riseFrames < 20);
        expect(controller.isGrounded()).toBe(false);

        let peakY = world.readTransform(character).position[1];
        let landFlags: number = CollisionFlags.None;
        let fallFrames = 0;
        do {
            landFlags = controller.move([0, 0, 0]);
            const y = world.readTransform(character).position[1];
            if (y > peakY) {
                peakY = y;
            }
            fallFrames += 1;
        } while (!controller.isGrounded() && fallFrames < 400);

        expect(landFlags).toBe(CollisionFlags.Below);
        expect(controller.isGrounded()).toBe(true);
        expect(peakY).toBeGreaterThan(0.9 + 1.4);
        expectPositionWithin(world.readTransform(character).position, [0, 0.9, 0]);
        world.dispose();
    });

    it('throws after dispose and treats repeated dispose as a no-op', async () => {
        const world = await createWorld();
        addStaticBox(world, [0, -20, 0], [20, 20, 20]);
        const character = addCharacterCapsule(world, [0, 0.9, 0]);
        const controller = new WasmCharacterController({
            world,
            body: character,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH
        });

        controller.dispose();
        expect(() => controller.move([0, 0, 1])).toThrow(/disposed/);
        expect(() => controller.isGrounded()).toThrow(/disposed/);
        expect(() => controller.jump()).toThrow(/disposed/);
        controller.dispose();
        world.dispose();
    });
});
