import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Component, script } from '@axrone/ecs-runtime';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';

let Scene: typeof import('@axrone/scene-3d').Scene;

// ---------------------------------------------------------------------------
// Test components
// ---------------------------------------------------------------------------

/**
 * Records every lifecycle callback invocation in order so tests can assert
 * both presence and ordering of lifecycle phases.
 */
class LifecycleTracker extends Component {
    readonly calls: string[] = [];

    onLoad(): void {
        this.calls.push('onLoad');
    }

    start(): void {
        this.calls.push('start');
    }

    update(dt: number): void {
        this.calls.push(`update:${dt}`);
    }

    lateUpdate(dt: number): void {
        this.calls.push(`lateUpdate:${dt}`);
    }

    fixedUpdate(dt: number): void {
        this.calls.push(`fixedUpdate:${dt}`);
    }

    onEnable(): void {
        this.calls.push('onEnable');
    }

    onDisable(): void {
        this.calls.push('onDisable');
    }

    onDestroy(): void {
        this.calls.push('onDestroy');
    }
}

/**
 * A second tracker variant so we can attach two independent trackers to the
 * same actor and verify per-component ordering.
 */
class SecondaryTracker extends Component {
    readonly calls: string[] = [];

    onLoad(): void {
        this.calls.push('onLoad');
    }

    start(): void {
        this.calls.push('start');
    }

    update(dt: number): void {
        this.calls.push(`update:${dt}`);
    }

    lateUpdate(dt: number): void {
        this.calls.push(`lateUpdate:${dt}`);
    }

    onEnable(): void {
        this.calls.push('onEnable');
    }

    onDisable(): void {
        this.calls.push('onDisable');
    }

    onDestroy(): void {
        this.calls.push('onDestroy');
    }
}

@script({ scriptName: 'HighPriorityTracker', priority: 10 })
class HighPriorityTracker extends Component {
    readonly calls: string[] = [];

    update(dt: number): void {
        this.calls.push(`update:${dt}`);
    }

    lateUpdate(dt: number): void {
        this.calls.push(`lateUpdate:${dt}`);
    }
}

@script({ scriptName: 'LowPriorityTracker', priority: -10 })
class LowPriorityTracker extends Component {
    readonly calls: string[] = [];

    update(dt: number): void {
        this.calls.push(`update:${dt}`);
    }

    lateUpdate(dt: number): void {
        this.calls.push(`lateUpdate:${dt}`);
    }
}

// ---------------------------------------------------------------------------
// Shared order log — multiple components push to the same array so we can
// assert cross-component ordering (e.g. priority).
// ---------------------------------------------------------------------------

@script({ scriptName: 'OrderHigh', priority: 10 })
class OrderHigh extends Component {
    constructor(private readonly _log: string[]) {
        super();
    }

    update(dt: number): void {
        this._log.push(`OrderHigh:update:${dt}`);
    }
}

@script({ scriptName: 'OrderLow', priority: -10 })
class OrderLow extends Component {
    constructor(private readonly _log: string[]) {
        super();
    }

    update(dt: number): void {
        this._log.push(`OrderLow:update:${dt}`);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Component lifecycle integration', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Helper to create a scene + canvas pair wired to the manual scheduler.
    const createTestScene = () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        return { scene, canvas };
    };

    // -----------------------------------------------------------------------
    // 1. onLoad() is called when a component is added to an actor
    // -----------------------------------------------------------------------
    it('calls onLoad() when a component is added to an actor', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'OnLoadActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        expect(tracker.calls).toContain('onLoad');

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 2. start() is called after onLoad() completes
    // -----------------------------------------------------------------------
    it('calls start() after onLoad()', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'StartActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        expect(tracker.calls).toContain('onLoad');
        expect(tracker.calls).toContain('start');

        const onLoadIdx = tracker.calls.indexOf('onLoad');
        const startIdx = tracker.calls.indexOf('start');
        expect(onLoadIdx).toBeLessThan(startIdx);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 3. onEnable() is called when a component is enabled on an active actor
    // -----------------------------------------------------------------------
    it('calls onEnable() when component is added to an active actor', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'EnableActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        expect(tracker.calls).toContain('onEnable');

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 4. update(dt) is called during scheduler.flush() with correct dt
    // -----------------------------------------------------------------------
    it('calls update(dt) with the correct delta time during scheduler.flush()', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'UpdateActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        scene.start(0);
        scheduler.flush(16);

        expect(tracker.calls).toContain('update:16');

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 5. lateUpdate(dt) is called after all update() calls in the same frame
    // -----------------------------------------------------------------------
    it('calls lateUpdate(dt) after update(dt) in the same frame', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'LateUpdateActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        scene.start(0);
        scheduler.flush(16);

        expect(tracker.calls).toContain('update:16');
        expect(tracker.calls).toContain('lateUpdate:16');

        const updateIdx = tracker.calls.indexOf('update:16');
        const lateIdx = tracker.calls.indexOf('lateUpdate:16');
        expect(updateIdx).toBeLessThan(lateIdx);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 6. onDisable() is called when the actor is deactivated
    // -----------------------------------------------------------------------
    it('calls onDisable() when the actor is deactivated', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'DisableActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        // onEnable was called during addComponent
        expect(tracker.calls).toContain('onEnable');

        // Deactivate the actor — Actor.active setter calls onDisable on all components
        actor.active = false;

        expect(tracker.calls).toContain('onDisable');

        const enableIdx = tracker.calls.indexOf('onEnable');
        const disableIdx = tracker.calls.indexOf('onDisable');
        expect(enableIdx).toBeLessThan(disableIdx);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 7. onDestroy() is called when the actor is destroyed
    // -----------------------------------------------------------------------
    it('calls onDestroy() when the actor is destroyed', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'DestroyActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        actor.destroy();

        expect(tracker.calls).toContain('onDestroy');

        // onDestroy should come after onLoad and start
        const onLoadIdx = tracker.calls.indexOf('onLoad');
        const destroyIdx = tracker.calls.indexOf('onDestroy');
        expect(onLoadIdx).toBeLessThan(destroyIdx);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 8. Priority ordering — higher priority components update first
    // -----------------------------------------------------------------------
    it('updates higher-priority components before lower-priority ones', () => {
        const { scene } = createTestScene();
        const log: string[] = [];

        scene.registerComponent(OrderHigh);
        scene.registerComponent(OrderLow);

        const actor = scene.createActor({ name: 'PriorityActor' });
        // Add low priority first to prove sorting is by priority, not insertion order
        actor.addComponent(OrderLow, log);
        actor.addComponent(OrderHigh, log);

        scene.start(0);
        scheduler.flush(16);

        const highIdx = log.findIndex((e) => e.startsWith('OrderHigh:update'));
        const lowIdx = log.findIndex((e) => e.startsWith('OrderLow:update'));

        expect(highIdx).toBeGreaterThanOrEqual(0);
        expect(lowIdx).toBeGreaterThanOrEqual(0);
        expect(highIdx).toBeLessThan(lowIdx);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 9. Multiple components on the same actor — lifecycle ordering correct
    // -----------------------------------------------------------------------
    it('runs lifecycle in correct order with multiple components on the same actor', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);
        scene.registerComponent(SecondaryTracker);

        const actor = scene.createActor({ name: 'MultiActor' });
        const primary = actor.addComponent(LifecycleTracker);
        const secondary = actor.addComponent(SecondaryTracker);

        // Both should have onLoad, start, onEnable
        for (const tracker of [primary, secondary]) {
            expect(tracker.calls).toContain('onLoad');
            expect(tracker.calls).toContain('start');
            expect(tracker.calls).toContain('onEnable');

            const onLoadIdx = tracker.calls.indexOf('onLoad');
            const startIdx = tracker.calls.indexOf('start');
            const enableIdx = tracker.calls.indexOf('onEnable');
            expect(onLoadIdx).toBeLessThan(startIdx);
            expect(startIdx).toBeLessThan(enableIdx);
        }

        scene.start(0);
        scheduler.flush(16);

        // Both should have received update and lateUpdate
        expect(primary.calls).toContain('update:16');
        expect(primary.calls).toContain('lateUpdate:16');
        expect(secondary.calls).toContain('update:16');
        expect(secondary.calls).toContain('lateUpdate:16');

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 10. Enable/disable cycling — onEnable/onDisable called each cycle
    // -----------------------------------------------------------------------
    it('calls onEnable/onDisable on each actor active/inactive cycle', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'CycleActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        // Initial onEnable from addComponent
        expect(tracker.calls.filter((c) => c === 'onEnable').length).toBe(1);
        expect(tracker.calls.filter((c) => c === 'onDisable').length).toBe(0);

        // First disable
        actor.active = false;
        expect(tracker.calls.filter((c) => c === 'onDisable').length).toBe(1);

        // First re-enable
        actor.active = true;
        expect(tracker.calls.filter((c) => c === 'onEnable').length).toBe(2);

        // Second disable
        actor.active = false;
        expect(tracker.calls.filter((c) => c === 'onDisable').length).toBe(2);

        // Second re-enable
        actor.active = true;
        expect(tracker.calls.filter((c) => c === 'onEnable').length).toBe(3);

        // Verify ordering: each onEnable precedes its corresponding onDisable
        const enables = tracker.calls
            .map((c, i) => ({ c, i }))
            .filter((x) => x.c === 'onEnable')
            .map((x) => x.i);
        const disables = tracker.calls
            .map((c, i) => ({ c, i }))
            .filter((x) => x.c === 'onDisable')
            .map((x) => x.i);

        // enable[0] < disable[0] < enable[1] < disable[1] < enable[2]
        expect(enables[0]).toBeLessThan(disables[0]);
        expect(disables[0]).toBeLessThan(enables[1]);
        expect(enables[1]).toBeLessThan(disables[1]);
        expect(disables[1]).toBeLessThan(enables[2]);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 11. Deactivated actor's components do not receive update/lateUpdate
    // -----------------------------------------------------------------------
    it('does not call update() on components of a deactivated actor', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'DisabledUpdateActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        scene.start(0);

        // Deactivate the actor before the frame runs
        actor.active = false;
        scheduler.flush(16);

        // update should NOT have been called because actor is inactive
        expect(tracker.calls.filter((c) => c.startsWith('update:')).length).toBe(0);
        expect(tracker.calls.filter((c) => c.startsWith('lateUpdate:')).length).toBe(0);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 12. Full lifecycle ordering: onLoad → start → onEnable → update → lateUpdate → onDisable → onDestroy
    // -----------------------------------------------------------------------
    it('runs the full lifecycle in the correct order from creation to destruction', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'FullLifecycleActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        scene.start(0);
        scheduler.flush(16);

        actor.destroy();

        const expected = [
            'onLoad',
            'start',
            'onEnable',
            'update:16',
            'lateUpdate:16',
            'onDisable',
            'onDestroy',
        ];

        for (const phase of expected) {
            expect(tracker.calls).toContain(phase);
        }

        // Verify strict ordering
        for (let i = 0; i < expected.length - 1; i++) {
            const currentIdx = tracker.calls.indexOf(expected[i]);
            const nextIdx = tracker.calls.indexOf(expected[i + 1]);
            expect(currentIdx).toBeLessThan(nextIdx);
        }

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 13. Multiple frames accumulate update calls correctly
    // -----------------------------------------------------------------------
    it('accumulates update calls across multiple frames', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'MultiFrameActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        scene.start(0);
        scheduler.flush(16);
        scheduler.flush(32);
        scheduler.flush(48);

        const updates = tracker.calls.filter((c) => c.startsWith('update:'));
        expect(updates.length).toBe(3);
        expect(updates).toEqual(['update:16', 'update:16', 'update:16']);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 14. Component added before scene.start() receives start() via actor auto-start
    // -----------------------------------------------------------------------
    it('delays start() until actor starts when autoStart is false', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        // Create actor without auto-start so component.start() is deferred
        const actor = scene.createActor({ name: 'DeferredStartActor', autoStart: false });
        const tracker = actor.addComponent(LifecycleTracker);

        // onLoad should have been called, but not start (actor hasn't started yet)
        expect(tracker.calls).toContain('onLoad');
        expect(tracker.calls).not.toContain('start');

        // Manually start the actor
        actor.start();

        expect(tracker.calls).toContain('start');

        const onLoadIdx = tracker.calls.indexOf('onLoad');
        const startIdx = tracker.calls.indexOf('start');
        expect(onLoadIdx).toBeLessThan(startIdx);

        scene.dispose();
    });

    // -----------------------------------------------------------------------
    // 15. fixedUpdate receives the fixed delta time
    // -----------------------------------------------------------------------
    it('calls fixedUpdate with the fixed delta time', () => {
        const { scene } = createTestScene();
        scene.registerComponent(LifecycleTracker);

        const actor = scene.createActor({ name: 'FixedUpdateActor' });
        const tracker = actor.addComponent(LifecycleTracker);

        scene.start(0);
        scheduler.flush(16);

        // fixedDelta is 16 (from createSceneOptions)
        expect(tracker.calls).toContain('fixedUpdate:16');

        scene.dispose();
    });
});
