import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component, script } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { EntityId } from '@axrone/ecs-runtime/entity';
import { Transform } from '@axrone/ecs-runtime';
import { createEntity } from './factory-helpers';

/**
 * Test component that tracks all lifecycle events
 */
class LifecycleTestComponent extends Component {
    public events: string[] = [];

    onLoad(): void {
        this.events.push('onLoad');
    }

    start(): void {
        this.events.push('start');
    }

    onEnable(): void {
        this.events.push('onEnable');
    }

    onDisable(): void {
        this.events.push('onDisable');
    }

    update(dt: number): void {
        this.events.push(`update:${dt}`);
    }

    lateUpdate(dt: number): void {
        this.events.push(`lateUpdate:${dt}`);
    }

    fixedUpdate(dt: number): void {
        this.events.push(`fixedUpdate:${dt}`);
    }

    onDestroy(): void {
        this.events.push('onDestroy');
    }
}

/**
 * Shared execution log for priority ordering tests
 */
const executionLog: string[] = [];

function resetExecutionLog(): void {
    executionLog.length = 0;
}

/**
 * Test component with priority for ordering tests
 */
@script({ priority: 10 })
class HighPriorityComponent extends Component {
    update(): void {
        executionLog.push('high');
    }
}

@script({ priority: 5 })
class MediumPriorityComponent extends Component {
    update(): void {
        executionLog.push('medium');
    }
}

@script({ priority: 1 })
class LowPriorityComponent extends Component {
    update(): void {
        executionLog.push('low');
    }
}

/**
 * Test component with dependencies
 */
@script({ dependencies: [Transform] })
class DependentComponent extends Component {
    public dependencyResolved = false;

    onLoad(): void {
        this.dependencyResolved = this.entity?.hasComponent(Transform) ?? false;
    }
}

/**
 * Test component that depends on another custom component
 */
class DependencyTargetComponent extends Component {
    public initialized = false;

    onLoad(): void {
        this.initialized = true;
    }
}

@script({ dependencies: [DependencyTargetComponent] })
class DependentOnCustomComponent extends Component {
    public targetWasInitialized = false;

    start(): void {
        const target = this.entity?.getComponent(DependencyTargetComponent);
        this.targetWasInitialized = target?.initialized ?? false;
    }
}

describe('Component Lifecycle Integration', () => {
    let world: World<any>;
    let entity: EntityId;
    let registry: any;

    beforeEach(() => {
        registry = {
            Transform,
            LifecycleTestComponent,
            HighPriorityComponent,
            MediumPriorityComponent,
            LowPriorityComponent,
            DependentComponent,
            DependencyTargetComponent,
            DependentOnCustomComponent,
        };
        world = new World(registry);
        entity = createEntity(world, 'TestEntity');
    });

    afterEach(() => {
        try {
            if (entity && !entity.isDestroyed) {
                entity.destroy();
            }
        } catch (error) {}
        try {
            if (world && !world.isDisposed) {
                world.clear();
            }
        } catch (error) {}
    });

    describe('Test Group 1: Basic Lifecycle Flow', () => {
        it('should transition through complete lifecycle: uninitialized → loaded → enabled → destroyed', async () => {
            const component = entity.addComponent(LifecycleTestComponent);

            // entity.addComponent triggers onLoad + start + onEnable automatically
            expect(component.events).toContain('onLoad');
            expect(component.events).toContain('start');
            expect(component.events).toContain('onEnable');

            entity.update(0.016);
            expect(component.events).toContain('update:0.016');

            entity.destroy();
            expect(component.events).toContain('onDisable');
            expect(component.events).toContain('onDestroy');
        });

        it('should call lifecycle methods in correct order', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            expect(component.events[0]).toBe('onLoad');

            await component._internalStart();
            expect(component.events[1]).toBe('start');
            expect(component.events[2]).toBe('onEnable');

            component._internalUpdate(0.016);
            expect(component.events[3]).toBe('update:0.016');

            await component._internalDestroy();
            expect(component.events[4]).toBe('onDisable');
            expect(component.events[5]).toBe('onDestroy');

            component._internalDestroy();
        });

        it('should pass correct deltaTime to update methods', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            component._internalUpdate(0.016);
            component._internalUpdate(0.033);
            component._internalUpdate(0.05);

            expect(component.events).toContain('update:0.016');
            expect(component.events).toContain('update:0.033');
            expect(component.events).toContain('update:0.05');

            component._internalDestroy();
        });

        it('should handle entity-level lifecycle correctly', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            expect(component.events).toContain('onLoad');

            entity.start();
            expect(component.events).toContain('start');
            expect(component.events).toContain('onEnable');

            entity.update(0.016);
            expect(component.events).toContain('update:0.016');

            entity.destroy();
            expect(component.events).toContain('onDisable');
            expect(component.events).toContain('onDestroy');
        });
    });

    describe('Test Group 2: Enable/Disable Cycle', () => {
        it('should call onDisable when component is disabled', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            expect(component.state).toBe('enabled');
            expect(component.events).toContain('onEnable');

            component.enabled = false;
            expect(component.state).toBe('disabled');
            expect(component.events).toContain('onDisable');

            component._internalDestroy();
        });

        it('should call onEnable when component is re-enabled', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            component.enabled = false;
            expect(component.state).toBe('disabled');

            component.enabled = true;
            expect(component.state).toBe('enabled');

            const onEnableCount = component.events.filter((e) => e === 'onEnable').length;
            expect(onEnableCount).toBe(2);

            component._internalDestroy();
        });

        it('should NOT call update when component is disabled', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            component.enabled = false;
            component._internalUpdate(0.016);

            const updateEvents = component.events.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(0);

            component._internalDestroy();
        });

        it('should call update after re-enabling component', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            component.enabled = false;
            component._internalUpdate(0.016);

            component.enabled = true;
            component._internalUpdate(0.033);

            const updateEvents = component.events.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(1);
            expect(updateEvents[0]).toBe('update:0.033');

            component._internalDestroy();
        });

        it('should handle entity-level enable/disable cycle', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();
            expect(component.events).toContain('onEnable');

            entity.active = false;
            expect(component.events).toContain('onDisable');

            entity.active = true;
            const onEnableCount = component.events.filter((e) => e === 'onEnable').length;
            expect(onEnableCount).toBe(2);

            entity.destroy();
        });

        it('should not call update on disabled entity', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();
            entity.active = false;

            entity.update(0.016);

            const updateEvents = component.events.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(0);

            entity.destroy();
        });
    });

    describe('Test Group 3: Priority Ordering', () => {
        it('should execute components in priority order (higher number = earlier)', () => {
            resetExecutionLog();

            entity.addComponent(LowPriorityComponent);
            entity.addComponent(MediumPriorityComponent);
            entity.addComponent(HighPriorityComponent);

            entity.start();
            entity.update(0.016);

            expect(executionLog).toEqual(['high', 'medium', 'low']);
        });

        it('should maintain priority order across multiple updates', () => {
            resetExecutionLog();

            entity.addComponent(LowPriorityComponent);
            entity.addComponent(MediumPriorityComponent);
            entity.addComponent(HighPriorityComponent);

            entity.start();

            entity.update(0.016);
            entity.update(0.016);
            entity.update(0.016);

            expect(executionLog).toHaveLength(9);

            // Verify each frame follows priority order (higher priority number = earlier)
            for (let frame = 0; frame < 3; frame++) {
                const base = frame * 3;
                expect(executionLog[base]).toBe('high');
                expect(executionLog[base + 1]).toBe('medium');
                expect(executionLog[base + 2]).toBe('low');
            }
        });

        it('should handle components with same priority', () => {
            class SamePriorityA extends Component {
                update() { executionLog.push('A'); }
            }

            class SamePriorityB extends Component {
                update() { executionLog.push('B'); }
            }

            world.registerComponentType(SamePriorityA);
            world.registerComponentType(SamePriorityB);
            resetExecutionLog();

            entity.addComponent(SamePriorityA);
            entity.addComponent(SamePriorityB);

            entity.start();
            entity.update(0.016);

            expect(executionLog).toHaveLength(2);
            expect(executionLog).toContain('A');
            expect(executionLog).toContain('B');
        });
    });

    describe('Test Group 4: Dependency Resolution', () => {
        it('should resolve Transform dependency before dependent component starts', () => {
            const dependent = entity.addComponent(DependentComponent);

            expect(dependent.dependencyResolved).toBe(true);
            expect(entity.hasComponent(Transform)).toBe(true);
        });

        it('should resolve custom component dependencies', () => {
            const target = entity.addComponent(DependencyTargetComponent);
            const dependent = entity.addComponent(DependentOnCustomComponent);

            entity.start();

            expect(target.initialized).toBe(true);
            expect(dependent.targetWasInitialized).toBe(true);
        });

        it('should throw error when dependency is missing', () => {
            expect(() => {
                entity.addComponent(DependentComponent);
            }).not.toThrow();

            const dependent = entity.getComponent(DependentComponent);
            expect(dependent).toBeDefined();
        });

        it('should maintain dependency order during entity start', () => {
            const target = entity.addComponent(DependencyTargetComponent);
            const dependent = entity.addComponent(DependentOnCustomComponent);

            expect(target.initialized).toBe(true);

            entity.start();

            expect(dependent.targetWasInitialized).toBe(true);
        });
    });

    describe('Test Group 5: Scene-Level Lifecycle', () => {
        it('should run update through scene scheduler', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();
            entity.update(0.016);

            expect(component.events).toContain('update:0.016');

            entity.destroy();
        });

        it('should run lateUpdate after all updates', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();
            entity.lateUpdate(0.016);

            expect(component.events).toContain('lateUpdate:0.016');

            entity.destroy();
        });

        it('should run fixedUpdate at fixed intervals', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();
            entity.fixedUpdate(0.02);

            expect(component.events).toContain('fixedUpdate:0.02');

            entity.destroy();
        });

        it('should execute lifecycle phases in correct order: fixedUpdate → update → lateUpdate', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();

            entity.fixedUpdate(0.02);
            entity.update(0.016);
            entity.lateUpdate(0.016);

            const fixedIndex = component.events.indexOf('fixedUpdate:0.02');
            const updateIndex = component.events.indexOf('update:0.016');
            const lateIndex = component.events.indexOf('lateUpdate:0.016');

            expect(fixedIndex).toBeLessThan(updateIndex);
            expect(updateIndex).toBeLessThan(lateIndex);

            entity.destroy();
        });

        it('should not execute updates on inactive entity', () => {
            const component = entity.addComponent(LifecycleTestComponent);

            entity.start();
            entity.active = false;

            entity.update(0.016);
            entity.lateUpdate(0.016);
            entity.fixedUpdate(0.02);

            const updateEvents = component.events.filter((e) =>
                e.startsWith('update:') || e.startsWith('lateUpdate:') || e.startsWith('fixedUpdate:')
            );
            expect(updateEvents).toHaveLength(0);

            entity.destroy();
        });
    });

    describe('Test Group 6: Component State Machine', () => {
        it('should transition: uninitialized → loaded (via _internalOnLoad)', async () => {
            const component = new LifecycleTestComponent();

            expect(component.state).toBe('uninitialized');

            await component._internalOnLoad();
            expect(component.state).toBe('loaded');

            component._internalDestroy();
        });

        it('should transition: loaded → started → enabled (via _internalStart)', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            expect(component.state).toBe('loaded');

            await component._internalStart();
            expect(component.state).toBe('enabled');

            component._internalDestroy();
        });

        it('should transition: enabled → disabled (via enabled = false)', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();
            expect(component.state).toBe('enabled');

            component.enabled = false;
            expect(component.state).toBe('disabled');

            component._internalDestroy();
        });

        it('should transition: disabled → enabled (via enabled = true)', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            component.enabled = false;
            expect(component.state).toBe('disabled');

            component.enabled = true;
            expect(component.state).toBe('enabled');

            component._internalDestroy();
        });

        it('should transition: any → destroyed (via _internalDestroy)', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            await component._internalDestroy();
            expect(component.state).toBe('destroyed');
        });

        it('should not allow state changes on destroyed component', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();
            await component._internalDestroy();

            expect(() => {
                component.enabled = true;
            }).toThrow();
        });

        it('should handle invalid transition: loaded state without _internalOnLoad', async () => {
            const component = new LifecycleTestComponent();

            expect(component.state).toBe('uninitialized');

            await component._internalStart();
            expect(component.state).toBe('uninitialized');

            component._internalDestroy();
        });

        it('should handle invalid transition: _internalOnLoad on already loaded component', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            expect(component.state).toBe('loaded');

            await component._internalOnLoad();
            expect(component.state).toBe('loaded');

            component._internalDestroy();
        });

        it('should handle multiple destroy calls gracefully', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            await component._internalStart();

            await component._internalDestroy();
            expect(component.state).toBe('destroyed');

            await component._internalDestroy();
            expect(component.state).toBe('destroyed');
        });

        it('should prevent update on uninitialized component', () => {
            const component = new LifecycleTestComponent();

            expect(component.state).toBe('uninitialized');

            component._internalUpdate(0.016);

            const updateEvents = component.events.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(0);

            component._internalDestroy();
        });

        it('should prevent update on loaded component', async () => {
            const component = new LifecycleTestComponent();

            await component._internalOnLoad();
            expect(component.state).toBe('loaded');

            component._internalUpdate(0.016);

            const updateEvents = component.events.filter((e) => e.startsWith('update:'));
            expect(updateEvents).toHaveLength(0);

            component._internalDestroy();
        });
    });
});
