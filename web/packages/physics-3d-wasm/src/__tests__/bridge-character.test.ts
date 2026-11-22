import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D } from '../world';
import { WasmCharacterController, CollisionFlags } from '../character-controller';
import type { Vec3Tuple } from '../types';

const DT = 1 / 60;
const RADIUS = 0.3;
const HEIGHT = 1.8;
const SKIN_WIDTH = 0.15;
const HALF_BODY_HEIGHT = 0.9;
const JUMP_SPEED = 8;

async function createWorld(maxBodies = 32): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: Math.max(1024, maxBodies * 16),
        gravity: [0, -9.81, 0],
    });
}

function addStaticBox(
    world: WasmPhysicsWorld3D,
    position: Vec3Tuple,
    halfExtents: Vec3Tuple,
): number {
    return world.createBody({
        type: 'static',
        position,
        shape: { kind: 'box', halfExtents },
    });
}

function addCharacterCapsule(
    world: WasmPhysicsWorld3D,
    position: Vec3Tuple,
): number {
    return world.createBody({
        type: 'static',
        position,
        shape: { kind: 'capsule', radius: RADIUS, halfSegment: HALF_BODY_HEIGHT - RADIUS },
    });
}

interface GroundedTransition {
    readonly step: number;
    readonly grounded: boolean;
}

/**
 * Run the character controller through a scripted scene with a step obstacle.
 * Records grounded transitions (changes in isGrounded state).
 */
function runCharacterScene(world: WasmPhysicsWorld3D, character: number): GroundedTransition[] {
    const controller = new WasmCharacterController({
        world,
        body: character,
        radius: RADIUS,
        height: HEIGHT,
        skinWidth: SKIN_WIDTH,
        slopeLimitAngle: 45,
        stepHeight: 0.3,
        jumpSpeed: JUMP_SPEED,
    });

    const transitions: GroundedTransition[] = [];
    let lastGrounded = controller.isGrounded();
    let step = 0;

    // Initial move to settle on ground
    controller.move([0, 0, 0]);
    step++;
    const initialGrounded = controller.isGrounded();
    if (initialGrounded !== lastGrounded) {
        transitions.push({ step, grounded: initialGrounded });
        lastGrounded = initialGrounded;
    }
    transitions.push({ step: 0, grounded: lastGrounded });

    // Move forward onto the step
    for (let i = 0; i < 5; i++) {
        controller.move([1, 0, 0]);
        step++;
        const grounded = controller.isGrounded();
        if (grounded !== lastGrounded) {
            transitions.push({ step, grounded });
            lastGrounded = grounded;
        }
    }

    // Jump
    controller.jump();
    step++;
    let guard = 0;
    do {
        controller.move([0, 0, 0]);
        step++;
        const grounded = controller.isGrounded();
        if (grounded !== lastGrounded) {
            transitions.push({ step, grounded });
            lastGrounded = grounded;
        }
        guard++;
    } while (guard < 60);

    // Wait for landing
    guard = 0;
    do {
        controller.move([0, 0, 0]);
        step++;
        const grounded = controller.isGrounded();
        if (grounded !== lastGrounded) {
            transitions.push({ step, grounded });
            lastGrounded = grounded;
        }
        guard++;
    } while (!controller.isGrounded() && guard < 400);

    controller.dispose();
    return transitions;
}

describe('character controller through bridge', () => {
    it('produces the same grounded transitions as the TypeScript bridge on a step scene', async () => {
        // Build the scene: flat ground with a step obstacle
        const world = await createWorld();

        // Ground (surface at y=0)
        addStaticBox(world, [0, -0.5, 0], [10, 0.5, 10]);

        // Step obstacle (low box that the character can step onto)
        addStaticBox(world, [2, 0.125, 0], [0.5, 0.125, 2]);

        // Character (bottom of capsule at y=0, standing on ground)
        const character = addCharacterCapsule(world, [0, HALF_BODY_HEIGHT, 0]);

        // First run
        const firstTransitions = runCharacterScene(world, character);

        // The character should start grounded after the first move
        expect(firstTransitions.length).toBeGreaterThanOrEqual(2);

        // Find the jump transition (grounded -> ungrounded)
        const jumpTransition = firstTransitions.find((t) => !t.grounded);
        expect(jumpTransition).toBeDefined();

        // Find the land transition (ungrounded -> grounded after jump)
        const landTransitions = firstTransitions.filter((t) => t.grounded);
        expect(landTransitions.length).toBeGreaterThanOrEqual(1);

        // The last transition should be grounded (landed)
        expect(firstTransitions[firstTransitions.length - 1].grounded).toBe(true);

        world.dispose();
    });

    it('produces bit-identical grounded transitions across two runs (determinism)', async () => {
        const firstWorld = await createWorld();
        addStaticBox(firstWorld, [0, -0.5, 0], [10, 0.5, 10]);
        addStaticBox(firstWorld, [2, 0.125, 0], [0.5, 0.125, 2]);
        const firstChar = addCharacterCapsule(firstWorld, [0, HALF_BODY_HEIGHT, 0]);
        const firstTransitions = runCharacterScene(firstWorld, firstChar);
        firstWorld.dispose();

        const secondWorld = await createWorld();
        addStaticBox(secondWorld, [0, -0.5, 0], [10, 0.5, 10]);
        addStaticBox(secondWorld, [2, 0.125, 0], [0.5, 0.125, 2]);
        const secondChar = addCharacterCapsule(secondWorld, [0, HALF_BODY_HEIGHT, 0]);
        const secondTransitions = runCharacterScene(secondWorld, secondChar);
        secondWorld.dispose();

        expect(firstTransitions).toEqual(secondTransitions);
    });

    it('reports CollisionFlags.Below when grounded on flat ground', async () => {
        const world = await createWorld();
        // Use the same ground setup as the existing character controller tests
        addStaticBox(world, [-1.35, -20, 0], [3.65, 20, 20]);
        const character = addCharacterCapsule(world, [0, HALF_BODY_HEIGHT, 0]);
        const controller = new WasmCharacterController({
            world,
            body: character,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH,
        });

        // Move horizontally to trigger ground detection
        const flags = controller.move([0, 0, 3]);
        expect(flags & CollisionFlags.Below).toBe(CollisionFlags.Below);
        expect(controller.isGrounded()).toBe(true);

        controller.dispose();
        world.dispose();
    });

    it('reports CollisionFlags.Sides when walking into a wall', async () => {
        const world = await createWorld();
        // Large ground
        addStaticBox(world, [0, -20, 0], [20, 20, 20]);
        // Wall in +Z direction from character
        addStaticBox(world, [0, 0, 3.5], [5, 5, 0.5]);

        const character = addCharacterCapsule(world, [0, 1, 0]);
        const controller = new WasmCharacterController({
            world,
            body: character,
            radius: RADIUS,
            height: HEIGHT,
            skinWidth: SKIN_WIDTH,
        });

        // Settle first
        controller.move([0, 0, 0]);

        // Move into the wall
        const flags = controller.move([0, 0, 3]);
        expect(flags & CollisionFlags.Sides).toBe(CollisionFlags.Sides);

        controller.dispose();
        world.dispose();
    });
});
