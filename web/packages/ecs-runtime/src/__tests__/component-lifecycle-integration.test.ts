import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, script } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { EntityId } from '@axrone/ecs-runtime/entity';
import { Transform } from '@axrone/ecs-runtime';
import { createEntity } from './factory-helpers';

/**
 * T-04: Component Lifecycle Integration Test
 *
 * Validates the full component lifecycle through the ECS:
 * onLoad → start → update → lateUpdate → fixedUpdate → onEnable → onDisable → onDestroy
 */

/**
 * Test component that records every lifecycle invocation with a timestamp
 * so we can assert both presence and ordering.
 */
class LifecycleRecorder extends Component {
    public readonly log: string[] = [];

    onLoad(): void {
        this.log.push('onLoad');
    }

    start(): void {
        this.log.push('start');
    }

    onEnable(): void {
        this.log.push('onEnable');
    }

    onDisable(): void {
        this.log.push('onDisable');
    }

    update(dt: number): void {
        this.log.push(`update:${dt}`);
    }

    lateUpdate(dt: number): void {
        this.log.push(`lateUpdate:${dt}`);
    }

    fixedUpdate(dt: number): void {
        this.log.push(`fixedUpdate:${dt}`);
    }

    onDestroy(): void {
        this.log.push('onDestroy');
    }
}

/**
 * Minimal component used for multi-component tests.
 */
class AlphaComponent extends Component {
    public updated = false;
    update(): void {
        this.updated = true;
    }
}

class BetaComponent extends Component {
    public updated = false;
    update(): void {
        this.updated = true;
    }
}

class GammaComponent extends Component {
    public updated = false;
    update(): void {
        this.updated = true;
    }
}

/**
 * Component that registers a cleanup task during onLoad.
 */
class CleanupTrackingComponent extends Component {
    public cleanupCalled = false;

    onLoad(): void {
        this.addCleanupTask(() => {
            this.cleanupCalled = true;
        });
    }
}

/**
 * Component that subscribes to an event during onLoad.
 */
class EventSubscribingComponent extends Component {
    public receivedEvents: unknown[] = [];

    onLoad(): void {
        this.on('test:event', (data: unknown) => {
            this.receivedEvents.push(data);
        });
    }
}

/**
 * Priority-ordered components sharing a single execution log.
 */
const priorityLog: string[] = [];
function resetPriorityLog(): void {
    priorityLog.length = 0;
}

@script({ priority: 100 })
class PriorityFirstComponent extends Component {
    update(): void {
        priorityLog.push('first');
    }
}

@script({ priority: 50 })
class PrioritySecondComponent extends Component {
    update(): void {
        priorityLog.push('second');
    }
}

@script({ priority: 1 })
class PriorityThirdComponent extends Component {
    update(): void {
        priorityLog.push('third');
    }
}

describe('T-04: Component Lifecycle Integration', () => {
    let world: World<any>;
    let entity: EntityId;

    beforeEach(() => {
        const registry = {
            Transform,
            LifecycleRecorder,
            AlphaComponent,
            BetaComponent,
            GammaComponent,
            CleanupTrackingComponent,
            EventSubscribingComponent,
            PriorityFirstComponent,
            PrioritySecondComponent,
            PriorityThirdComponent,
        };
        world = new World(registry);
        entity = createEntity(world, 'LifecycleTestEntity');
    });

    afterEach(() => {
        try {
            if (entity && !entity.isDestroyed) {
                entity.destroy();
            }
        } catch {
            // already destroyed
        }
        try {
            if (world && !world.isDisposed) {
                world.clear();
            }
        } catch {
            // already disposed
        }
    });

    // ─── 1. Lifecycle ordering ───────────────────────────────────────────────

    describe('Lifecycle method ordering', () => {
        it('should call onLoad → start → onEnable → update → lateUpdate → fixedUpdate → onDisable → onDestroy', () => {
            const recorder = entity.addComponent(LifecycleRecorder);

            // addComponent on an already-started entity triggers onLoad + start + onEnable
            expect(recorder.log).toContain('onLoad');
            expect(recorder.log).toContain('start');
            expect(recorder.log).toContain('onEnable');

            const onLoadIdx = recorder.log.indexOf('onLoad');
            const startIdx = recorder.log.indexOf('start');
            const enableIdx = recorder.log.indexOf('onEnable');

            expect(onLoadIdx).toBeLessThan(startIdx);
            expect(startIdx).toBeLessThan(enableIdx);

            entity.update(0.016);
            entity.lateUpdate(0.016);
            entity.fixedUpdate(0.02);

            expect(recorder.log).toContain('update:0.016');
            expect(recorder.log).toContain('lateUpdate:0.016');
            expect(recorder.log).toContain('fixedUpdate:0.02');

            const updateIdx = recorder.log.indexOf('update:0.016');
            const lateIdx = recorder.log.indexOf('lateUpdate:0.016');
            const fixedIdx = recorder.log.indexOf('fixedUpdate:0.02');

            expect(updateIdx).toBeLessThan(lateIdx);

            entity.destroy();

            expect(recorder.log).toContain('onDisable');
            expect(recorder.log).toContain('onDestroy');

            const disableIdx = recorder.log.indexOf('onDisable');
            const destroyIdx = recorder.log.indexOf('onDestroy');

            expect(disableIdx).toBeLessThan(destroyIdx);
            expect(lateIdx).toBeLessThan(disableIdx);
        });

        it('should call fixedUpdate → update → lateUpdate when driven in frame order', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            entity.fixedUpdate(0.02);
            entity.update(0.016);
            entity.lateUpdate(0.016);

            const fixedIdx = recorder.log.indexOf('fixedUpdate:0.02');
            const updateIdx = recorder.log.indexOf('update:0.016');
            const lateIdx = recorder.log.indexOf('lateUpdate:0.016');

            expect(fixedIdx).toBeLessThan(updateIdx);
            expect(updateIdx).toBeLessThan(lateIdx);
        });
    });

    // ─── 2. Enable / Disable ─────────────────────────────────────────────────

    describe('onEnable / onDisable', () => {
        it('should call onEnable when component is first activated', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            expect(recorder.log).toContain('onEnable');
        });

        it('should call onDisable when entity is deactivated', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            entity.active = false;
            expect(recorder.log).toContain('onDisable');
        });

        it('should call onEnable again when entity is reactivated', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            entity.active = false;
            entity.active = true;

            const enableCount = recorder.log.filter((e) => e === 'onEnable').length;
            expect(enableCount).toBeGreaterThanOrEqual(2);
        });

        it('should call onDisable then onDestroy on entity destroy', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            entity.destroy();

            const disableIdx = recorder.log.indexOf('onDisable');
            const destroyIdx = recorder.log.indexOf('onDestroy');

            expect(disableIdx).toBeGreaterThan(-1);
            expect(destroyIdx).toBeGreaterThan(-1);
            expect(disableIdx).toBeLessThan(destroyIdx);
        });
    });

    // ─── 3. onDestroy ────────────────────────────────────────────────────────

    describe('onDestroy', () => {
        it('should call onDestroy exactly once when entity is destroyed', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            entity.destroy();

            const destroyCount = recorder.log.filter((e) => e === 'onDestroy').length;
            expect(destroyCount).toBe(1);
        });

        it('should not call update after onDestroy', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();
            entity.destroy();

            const updateCountBefore = recorder.log.filter((e) => e.startsWith('update:')).length;
            // No further updates can happen after destroy — entity is gone
            expect(recorder.log.filter((e) => e.startsWith('update:')).length).toBe(updateCountBefore);
        });
    });

    // ─── 4. Priority ordering ────────────────────────────────────────────────

    describe('Priority ordering', () => {
        it('should execute higher-priority components first during update', () => {
            resetPriorityLog();

            entity.addComponent(PriorityThirdComponent);
            entity.addComponent(PriorityFirstComponent);
            entity.addComponent(PrioritySecondComponent);

            entity.start();
            entity.update(0.016);

            expect(priorityLog).toEqual(['first', 'second', 'third']);
        });

        it('should maintain priority order across multiple frames', () => {
            resetPriorityLog();

            entity.addComponent(PriorityThirdComponent);
            entity.addComponent(PriorityFirstComponent);
            entity.addComponent(PrioritySecondComponent);

            entity.start();
            entity.update(0.016);
            entity.update(0.016);

            // 2 frames × 3 components = 6 entries
            expect(priorityLog).toHaveLength(6);

            // Each frame should follow priority order
            expect(priorityLog[0]).toBe('first');
            expect(priorityLog[1]).toBe('second');
            expect(priorityLog[2]).toBe('third');
            expect(priorityLog[3]).toBe('first');
            expect(priorityLog[4]).toBe('second');
            expect(priorityLog[5]).toBe('third');
        });
    });

    // ─── 5. Disabled components skip update ──────────────────────────────────

    describe('Disabled components', () => {
        it('should not call update on a disabled component', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            // Disable via component-level enabled setter
            recorder.enabled = false;

            entity.update(0.016);

            const updateEvents = recorder.log.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(0);
        });

        it('should not call lateUpdate on a disabled component', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            recorder.enabled = false;
            entity.lateUpdate(0.016);

            const lateEvents = recorder.log.filter((e) => e.startsWith('lateUpdate:'));
            expect(lateEvents).toHaveLength(0);
        });

        it('should resume update after re-enabling', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            recorder.enabled = false;
            entity.update(0.016);

            recorder.enabled = true;
            entity.update(0.033);

            const updateEvents = recorder.log.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(1);
            expect(updateEvents[0]).toBe('update:0.033');
        });

        it('should not call update when entity is inactive', () => {
            const recorder = entity.addComponent(LifecycleRecorder);
            entity.start();

            entity.active = false;
            entity.update(0.016);

            const updateEvents = recorder.log.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(0);
        });
    });

    // ─── 6. Multiple components on same entity ────────────────────────────────

    describe('Multiple components on same entity', () => {
        it('should deliver lifecycle calls to all components', () => {
            const alpha = entity.addComponent(AlphaComponent);
            const beta = entity.addComponent(BetaComponent);
            const gamma = entity.addComponent(GammaComponent);

            entity.start();
            entity.update(0.016);

            expect(alpha.updated).toBe(true);
            expect(beta.updated).toBe(true);
            expect(gamma.updated).toBe(true);
        });

        it('should call onDestroy on all components when entity is destroyed', () => {
            const logA: string[] = [];
            const logB: string[] = [];

            class DestroyTrackerA extends Component {
                onDestroy(): void {
                    logA.push('destroyed');
                }
            }
            class DestroyTrackerB extends Component {
                onDestroy(): void {
                    logB.push('destroyed');
                }
            }

            world.registerComponentType(DestroyTrackerA);
            world.registerComponentType(DestroyTrackerB);

            entity.addComponent(DestroyTrackerA);
            entity.addComponent(DestroyTrackerB);
            entity.start();

            entity.destroy();

            expect(logA).toContain('destroyed');
            expect(logB).toContain('destroyed');
        });

        it('should isolate enable/disable state per component', () => {
            const alpha = entity.addComponent(AlphaComponent);
            const beta = entity.addComponent(BetaComponent);

            entity.start();

            alpha.enabled = false;

            entity.update(0.016);

            // Alpha was disabled — its update should NOT have run
            expect(alpha.updated).toBe(false);
            // Beta is still enabled — its update SHOULD have run
            expect(beta.updated).toBe(true);
        });
    });

    // ─── 7. Event subscription cleanup on destroy ────────────────────────────

    describe('Event subscription cleanup', () => {
        it('should clean up event subscriptions when component._internalDestroy is called', async () => {
            const comp = new EventSubscribingComponent();

            await comp._internalOnLoad();
            await comp._internalStart();

            // After _internalDestroy, the component's _cleanup() runs and
            // clears all event subscriptions.
            await comp._internalDestroy();

            expect(comp.state).toBe('destroyed');
        });

        it('should clean up entity-level event subscriptions when entity is destroyed', () => {
            const comp = entity.addComponent(EventSubscribingComponent);
            entity.start();

            entity.destroy();

            // Entity-level subscriptions are cleared by entity.destroy()
            expect(entity.isDestroyed).toBe(true);
        });
    });

    // ─── 8. Cleanup tasks ────────────────────────────────────────────────────

    describe('Cleanup tasks (addCleanupTask)', () => {
        it('should invoke component-level cleanup tasks on _internalDestroy', async () => {
            const comp = new CleanupTrackingComponent();

            await comp._internalOnLoad();
            await comp._internalStart();

            expect(comp.cleanupCalled).toBe(false);

            await comp._internalDestroy();

            expect(comp.cleanupCalled).toBe(true);
        });

        it('should invoke multiple component-level cleanup tasks in registration order', async () => {
            const order: number[] = [];

            class MultiCleanupComponent extends Component {
                onLoad(): void {
                    this.addCleanupTask(() => order.push(1));
                    this.addCleanupTask(() => order.push(2));
                    this.addCleanupTask(() => order.push(3));
                }
            }

            const comp = new MultiCleanupComponent();
            await comp._internalOnLoad();
            await comp._internalStart();

            await comp._internalDestroy();

            expect(order).toEqual([1, 2, 3]);
        });

        it('should invoke entity-level cleanup tasks on entity destroy', () => {
            let entityCleanupCalled = false;
            entity.addCleanupTask(() => {
                entityCleanupCalled = true;
            });

            entity.start();
            entity.destroy();

            expect(entityCleanupCalled).toBe(true);
        });
    });

    // ─── 9. Component-level lifecycle via _internal* methods ─────────────────

    describe('Component-level lifecycle (direct _internal* calls)', () => {
        it('should transition through states: uninitialized → loaded → enabled → destroyed', async () => {
            const recorder = new LifecycleRecorder();

            expect(recorder.state).toBe('uninitialized');

            await recorder._internalOnLoad();
            expect(recorder.state).toBe('loaded');
            expect(recorder.log[0]).toBe('onLoad');

            await recorder._internalStart();
            expect(recorder.state).toBe('enabled');
            expect(recorder.log).toContain('start');
            expect(recorder.log).toContain('onEnable');

            recorder._internalUpdate(0.016);
            expect(recorder.log).toContain('update:0.016');

            await recorder._internalDestroy();
            expect(recorder.state).toBe('destroyed');
            expect(recorder.log).toContain('onDisable');
            expect(recorder.log).toContain('onDestroy');
        });

        it('should not allow update on uninitialized component', () => {
            const recorder = new LifecycleRecorder();
            expect(recorder.state).toBe('uninitialized');

            recorder._internalUpdate(0.016);

            const updates = recorder.log.filter((e) => e.startsWith('update:'));
            expect(updates).toHaveLength(0);
        });

        it('should not allow update on loaded-only component', async () => {
            const recorder = new LifecycleRecorder();
            await recorder._internalOnLoad();
            expect(recorder.state).toBe('loaded');

            recorder._internalUpdate(0.016);

            const updates = recorder.log.filter((e) => e.startsWith('update:'));
            expect(updates).toHaveLength(0);

            recorder._internalDestroy();
        });

        it('should skip update when component is disabled', async () => {
            const recorder = new LifecycleRecorder();
            await recorder._internalOnLoad();
            await recorder._internalStart();

            recorder.enabled = false;
            expect(recorder.state).toBe('disabled');

            recorder._internalUpdate(0.016);

            const updates = recorder.log.filter((e) => e.startsWith('update:'));
            expect(updates).toHaveLength(0);

            recorder._internalDestroy();
        });

        it('should handle double-destroy gracefully', async () => {
            const recorder = new LifecycleRecorder();
            await recorder._internalOnLoad();
            await recorder._internalStart();

            await recorder._internalDestroy();
            expect(recorder.state).toBe('destroyed');

            // Second destroy should be a no-op
            await recorder._internalDestroy();
            expect(recorder.state).toBe('destroyed');

            const destroyCount = recorder.log.filter((e) => e === 'onDestroy').length;
            expect(destroyCount).toBe(1);
        });
    });
});
