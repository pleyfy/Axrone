import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Component, Transform } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';
import {
    forceGcIfAvailable,
    hasMemoryApi,
    linearSlope,
    readHeapBytes,
    runFrames,
} from './perf-test-utils';

let Scene: typeof import('@axrone/scene-3d').Scene;
let Animator: typeof import('@axrone/scene-3d').Animator;

// ---------------------------------------------------------------------------
// Test Components — replicate game script zero-allocation patterns
// ---------------------------------------------------------------------------

/**
 * CameraFollowControlTest — mirrors Assets/Scripts/CameraFollowControl.ts
 * Uses pre-allocated Vec3/Quat fields, exponential smoothing in lateUpdate,
 * zero per-frame allocations.
 */
class CameraFollowControlTest extends Component {
    public target: Transform | null = null;
    public offsetX = 0;
    public offsetY = 5;
    public offsetZ = -10;
    public damping = 5;
    public lookAtTarget = true;

    private _cachedTransform: Transform | null = null;
    private readonly _desiredPosition = new Vec3();
    private readonly _lookDirection = new Vec3();
    private readonly _tempRotation = new Quat();

    onLoad(): void {
        this._cachedTransform = this.transform as Transform | null;
    }

    lateUpdate(deltaTime: number): void {
        const target = this.target;
        if (!target) return;
        const cameraTransform = this._cachedTransform;
        if (!cameraTransform) return;

        const deltaSeconds = deltaTime / 1000;
        const t = 1 - Math.exp(-this.damping * deltaSeconds);
        const targetPos = target.position;

        this._desiredPosition.x = targetPos.x + this.offsetX;
        this._desiredPosition.y = targetPos.y + this.offsetY;
        this._desiredPosition.z = targetPos.z + this.offsetZ;

        Vec3.lerp(cameraTransform.position, this._desiredPosition, t, cameraTransform.position);

        if (this.lookAtTarget) {
            const camPos = cameraTransform.position;
            this._lookDirection.x = camPos.x - targetPos.x;
            this._lookDirection.y = camPos.y - targetPos.y;
            this._lookDirection.z = camPos.z - targetPos.z;
            const lenSq =
                this._lookDirection.x * this._lookDirection.x +
                this._lookDirection.y * this._lookDirection.y +
                this._lookDirection.z * this._lookDirection.z;
            if (lenSq >= 1e-8) {
                cameraTransform.rotation = Quat.lookRotation(
                    this._lookDirection,
                    Vec3.UP,
                    this._tempRotation,
                );
            }
        }
    }
}

/**
 * CharacterMovementTest — mirrors Assets/Scripts/CharacterMovement.ts
 * Uses pre-allocated Vec3/Quat fields, WASD movement in update,
 * animation switching, zero per-frame allocations.
 */
class CharacterMovementTest extends Component {
    public movementSpeed = 5;
    public rotationSpeed = 10;
    public animator: InstanceType<typeof Animator> | null = null;
    public runClip = 'Run';
    public idleClip = 'Idle';

    private readonly _pressedKeys = new Set<string>();
    private _yaw = 0;
    private _cleanupInput: (() => void) | null = null;

    private _cachedTransform: Transform | null = null;
    private readonly _moveDirection = new Vec3();
    private readonly _newPosition = new Vec3();
    private readonly _tempRotation = new Quat();

    onLoad(): void {
        this._cachedTransform = this.transform as Transform | null;

        const onKeyDown = (event: KeyboardEvent) => this._pressedKeys.add(event.code);
        const onKeyUp = (event: KeyboardEvent) => this._pressedKeys.delete(event.code);
        const onBlur = () => this._pressedKeys.clear();
        globalThis.addEventListener('keydown', onKeyDown);
        globalThis.addEventListener('keyup', onKeyUp);
        globalThis.addEventListener('blur', onBlur);
        this._cleanupInput = () => {
            globalThis.removeEventListener('keydown', onKeyDown);
            globalThis.removeEventListener('keyup', onKeyUp);
            globalThis.removeEventListener('blur', onBlur);
        };
    }

    update(deltaTime: number): void {
        const deltaSeconds = deltaTime / 1000;
        const transform = this._cachedTransform;
        if (!transform) return;

        const moveX =
            (this._pressedKeys.has('KeyA') ? 1 : 0) - (this._pressedKeys.has('KeyD') ? 1 : 0);
        const moveZ =
            (this._pressedKeys.has('KeyW') ? 1 : 0) - (this._pressedKeys.has('KeyS') ? 1 : 0);
        const isMoving = moveX !== 0 || moveZ !== 0;

        if (isMoving) {
            this._moveDirection.x = moveX;
            this._moveDirection.y = 0;
            this._moveDirection.z = moveZ;
            Vec3.normalize(this._moveDirection, this._moveDirection);

            const step = this.movementSpeed * deltaSeconds;
            const pos = transform.position;
            this._newPosition.x = pos.x + this._moveDirection.x * step;
            this._newPosition.y = pos.y;
            this._newPosition.z = pos.z + this._moveDirection.z * step;
            transform.position = this._newPosition;

            const targetYaw = Math.atan2(this._moveDirection.x, this._moveDirection.z);
            const deltaYaw = Math.atan2(
                Math.sin(targetYaw - this._yaw),
                Math.cos(targetYaw - this._yaw),
            );
            this._yaw += deltaYaw * Math.min(1, this.rotationSpeed * deltaSeconds);
            Quat.fromEuler(0, this._yaw, 0, this._tempRotation);
            transform.rotation = this._tempRotation;
        }

        this._applyAnimation(isMoving);
    }

    private _applyAnimation(isMoving: boolean): void {
        const animator = this.animator;
        if (!animator) return;

        const desiredClip = isMoving ? this.runClip : this.idleClip;
        if (desiredClip && animator.clipId !== desiredClip) {
            animator.play(desiredClip);
        }
    }

    onDestroy(): void {
        this._cleanupInput?.();
        this._cleanupInput = null;
    }

    /** Expose pressed keys for test injection */
    simulateKeyDown(code: string): void {
        this._pressedKeys.add(code);
    }

    simulateKeyUp(code: string): void {
        this._pressedKeys.delete(code);
    }

    simulateClearKeys(): void {
        this._pressedKeys.clear();
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Script Performance Regression — Game Scripts', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        Animator = sceneModule.Animator;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // --- 1. CharacterMovement zero-allocation ---

    describe('CharacterMovement Zero-Allocation', () => {
        it('heap trend is flat over 500 frames with simulated WASD input', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas, { CharacterMovementTest }));

            const character = scene.createEntity({ name: 'Character' });
            const movement = character.addComponent(CharacterMovementTest, {
                movementSpeed: 5,
                rotationSpeed: 10,
            });

            scene.start(0);

            // Warm-up
            runFrames(scheduler, 200, 0);

            // Simulate WASD input pattern
            const keyPatterns = [
                ['KeyW'],
                ['KeyW', 'KeyD'],
                ['KeyD'],
                ['KeyS', 'KeyD'],
                ['KeyS'],
                ['KeyS', 'KeyA'],
                ['KeyA'],
                ['KeyW', 'KeyA'],
            ];

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 50; f++) {
                    const idx = batch * 50 + f;
                    const pattern = keyPatterns[idx % keyPatterns.length]!;
                    movement.simulateClearKeys();
                    for (const key of pattern) {
                        movement.simulateKeyDown(key);
                    }
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });
    });

    // --- 2. CameraFollowControl zero-allocation ---

    describe('CameraFollowControl Zero-Allocation', () => {
        it('heap trend is flat over 500 frames with moving target', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas, { CameraFollowControlTest }));

            const target = scene.createEntity({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);

            const camera = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(CameraFollowControlTest, {
                offsetX: 0,
                offsetY: 5,
                offsetZ: -10,
                damping: 5,
            });
            controller.target = targetTransform;

            scene.start(0);
            runFrames(scheduler, 200, 0);

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 50; f++) {
                    const idx = batch * 50 + f;
                    targetTransform.position = new Vec3(
                        Math.sin(idx * 0.1) * 10,
                        1,
                        Math.cos(idx * 0.1) * 10,
                    );
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });
    });

    // --- 3. Both scripts combined ---

    describe('Combined Scripts Zero-Allocation', () => {
        it('heap trend is flat when both scripts run on same scene for 500 frames', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(
                createSceneOptions(scheduler, canvas, {
                    CameraFollowControlTest,
                    CharacterMovementTest,
                }),
            );

            // Character with movement
            const character = scene.createEntity({ name: 'Character' });
            const characterTransform = character.requireComponent(Transform);
            const movement = character.addComponent(CharacterMovementTest, {
                movementSpeed: 5,
                rotationSpeed: 10,
            });

            // Camera following character
            const camera = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(CameraFollowControlTest, {
                offsetY: 5,
                offsetZ: -10,
                damping: 5,
            });
            controller.target = characterTransform;

            scene.start(0);
            runFrames(scheduler, 200, 0);

            const keyPatterns = [
                ['KeyW'],
                ['KeyW', 'KeyD'],
                ['KeyD'],
                ['KeyS'],
                ['KeyA'],
            ];

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 50; f++) {
                    const idx = batch * 50 + f;
                    const pattern = keyPatterns[idx % keyPatterns.length]!;
                    movement.simulateClearKeys();
                    for (const key of pattern) {
                        movement.simulateKeyDown(key);
                    }
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });
    });

    // --- 4. Frame spike detection (wall-clock, GC pauses included) ---

    // NOTE: wall-clock frame timing cannot isolate GC pauses from work time;
    // this suite asserts the combined frame budget, which is what players feel.
    describe('Frame Spike Detection', () => {
        it('no frame exceeds the 16.6ms budget over 100 scripted frames', () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(
                createSceneOptions(scheduler, canvas, {
                    CameraFollowControlTest,
                    CharacterMovementTest,
                }),
            );

            const character = scene.createEntity({ name: 'Character' });
            const characterTransform = character.requireComponent(Transform);
            const movement = character.addComponent(CharacterMovementTest);

            const camera = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(CameraFollowControlTest);
            controller.target = characterTransform;

            scene.start(0);
            runFrames(scheduler, 50, 0);
            // Settle setup garbage before the timed region.
            forceGcIfAvailable();

            const frameTimes: number[] = [];
            for (let i = 0; i < 100; i++) {
                movement.simulateClearKeys();
                movement.simulateKeyDown('KeyW');
                const t0 = performance.now();
                scheduler.flush(800 + i * 16);
                const elapsed = performance.now() - t0;
                frameTimes.push(elapsed);
            }

            const maxFrameTime = Math.max(...frameTimes);
            expect(maxFrameTime).toBeLessThan(16.6);

            scene.dispose();
        });
    });

    // --- 5. Memory stability over start/stop cycles ---

    describe('Memory Stability — Start/Stop Cycles', () => {
        it('heap does not grow monotonically across 50 start/stop cycles with scripts', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');

            // Warm-up cycle
            {
                const s = new Scene(
                    createSceneOptions(scheduler, canvas, {
                        CameraFollowControlTest,
                        CharacterMovementTest,
                    }),
                );
                const c = s.createEntity({ name: 'Warmup' });
                c.addComponent(CharacterMovementTest);
                s.start(0);
                runFrames(scheduler, 10, 0);
                s.stop();
                s.dispose();
            }

            const samples: number[] = [];
            for (let cycle = 0; cycle < 50; cycle++) {
                const scene = new Scene(
                    createSceneOptions(scheduler, canvas, {
                        CameraFollowControlTest,
                        CharacterMovementTest,
                    }),
                );

                const character = scene.createEntity({ name: 'Character' });
                const characterTransform = character.requireComponent(Transform);
                character.addComponent(CharacterMovementTest);

                const camera = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
                const controller = camera.addComponent(CameraFollowControlTest);
                controller.target = characterTransform;

                scene.start(0);
                runFrames(scheduler, 10, (cycle + 1) * 160);
                scene.stop();
                scene.dispose();

                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);
        });
    });

    // --- 6. Memory stability over dispose/recreate ---

    describe('Memory Stability — Dispose/Recreate Cycles', () => {
        it('heap does not grow monotonically across 20 create/dispose cycles', () => {
            if (!hasMemoryApi()) return;

            // Warm-up
            {
                const c = document.createElement('canvas');
                const s = new Scene(
                    createSceneOptions(scheduler, c, {
                        CameraFollowControlTest,
                        CharacterMovementTest,
                    }),
                );
                s.start(0);
                runFrames(scheduler, 10, 0);
                s.dispose();
            }

            const samples: number[] = [];
            for (let cycle = 0; cycle < 20; cycle++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(
                    createSceneOptions(scheduler, canvas, {
                        CameraFollowControlTest,
                        CharacterMovementTest,
                    }),
                );

                const character = scene.createEntity({ name: 'Character' });
                const characterTransform = character.requireComponent(Transform);
                character.addComponent(CharacterMovementTest);

                const camera = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
                const controller = camera.addComponent(CameraFollowControlTest);
                controller.target = characterTransform;

                scene.start(0);
                runFrames(scheduler, 10, (cycle + 1) * 160);
                scene.dispose();

                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);
        });
    });

    // --- 7. Per-frame budget compliance ---

    describe('Per-Frame Budget Compliance', () => {
        it('update() completes within 1ms for both scripts combined', () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(
                createSceneOptions(scheduler, canvas, {
                    CameraFollowControlTest,
                    CharacterMovementTest,
                }),
            );

            const character = scene.createEntity({ name: 'Character' });
            const characterTransform = character.requireComponent(Transform);
            const movement = character.addComponent(CharacterMovementTest);

            const camera = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(CameraFollowControlTest);
            controller.target = characterTransform;

            scene.start(0);
            runFrames(scheduler, 50, 0);

            const frameTimes: number[] = [];
            for (let i = 0; i < 100; i++) {
                movement.simulateClearKeys();
                movement.simulateKeyDown('KeyW');
                movement.simulateKeyDown('KeyD');

                const t0 = performance.now();
                scheduler.flush(800 + i * 16);
                const elapsed = performance.now() - t0;
                frameTimes.push(elapsed);
            }

            const avgFrameTime =
                frameTimes.reduce((sum, t) => sum + t, 0) / frameTimes.length;
            expect(avgFrameTime).toBeLessThan(1);

            scene.dispose();
        });
    });

    // --- 8. Animator clip switching allocation ---

    describe('Animator Clip Switching Allocation', () => {
        it('switching between Idle/Run clips over 100 frames shows no heap growth', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(
                createSceneOptions(scheduler, canvas, { CharacterMovementTest }),
            );

            const character = scene.createEntity({ name: 'Character' });
            const animator = character.addComponent(Animator, {
                clips: [
                    {
                        id: 'Idle',
                        duration: 1,
                        tracks: [],
                    },
                    {
                        id: 'Run',
                        duration: 1,
                        tracks: [],
                    },
                    {
                        id: 'Walk',
                        duration: 1,
                        tracks: [],
                    },
                ],
                clipId: 'Idle',
                playOnStart: true,
                playing: true,
                loop: true,
            });

            const movement = character.addComponent(CharacterMovementTest, {
                runClip: 'Run',
                idleClip: 'Idle',
                animator: animator,
            });

            scene.start(0);
            runFrames(scheduler, 200, 0);

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 10; f++) {
                    const idx = batch * 10 + f;
                    // Alternate between moving (Run) and idle (Idle)
                    if (idx % 3 === 0) {
                        movement.simulateClearKeys();
                    } else {
                        movement.simulateClearKeys();
                        movement.simulateKeyDown('KeyW');
                    }
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });
    });
});
