import { Actor, ActorError, ComponentError } from '../../component-system/core/actor';
import { Component } from '../../component-system/core/component';
import { World } from '../../component-system/core/world';
import { Transform } from '../../component-system/components/transform';
import { createActor } from '../../component-system/utils/factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestComponent extends Component {
    value: number = 0;
    name: string = '';

    constructor(value: number = 0, name: string = '') {
        super();
        this.value = value;
        this.name = name;
    }

    awake(): void {
        this.value = 1;
    }

    start(): void {
        this.value = 2;
    }

    update(deltaTime: number): void {
        this.value += deltaTime;
    }
}

class DependentComponent extends Component {
    dependency?: TestComponent;

    awake(): void {
        this.dependency = this.requireComponent(TestComponent);
    }
}

class AsyncComponent extends Component {
    initialized = false;
    started = false;

    async awake(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.initialized = true;
    }

    async start(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.started = true;
    }
}

class ErrorComponent extends Component {
    shouldThrowInAwake = false;
    shouldThrowInStart = false;

    awake(): void {
        if (this.shouldThrowInAwake) {
            throw new Error('Awake error');
        }
    }

    start(): void {
        if (this.shouldThrowInStart) {
            throw new Error('Start error');
        }
    }
}

describe('Actor', () => {
    let world: World<any>;
    let actor: Actor;
    let registry: any;

    beforeEach(() => {
        registry = {
            TestComponent,
            DependentComponent,
            AsyncComponent,
            ErrorComponent,
            Transform,
        };
        world = new World(registry);
        actor = createActor(world);
    });

    afterEach(() => {
        try {
            if (actor && !actor.isDestroyed) {
                actor.destroy();
            }
        } catch (error) {}
        try {
            if (world && !world.isDisposed) {
                world.clear();
            }
        } catch (error) {}
    });

    describe('initialization', () => {
        it('should initialize with correct default values', () => {
            expect(actor.id).toBeDefined();
            expect(actor.entity).toBeDefined();
            expect(actor.world).toBe(world);
            expect(actor.state).toBe('active');
            expect(actor.active).toBe(true);
            expect(actor.name).toBe('Actor');
            expect(actor.layer).toBe(0);
            expect(actor.tag).toBe('Default');
            expect(actor.isDestroyed).toBe(false);
            expect(actor.componentCount).toBe(1);
        });

        it('should initialize with custom configuration', () => {
            const customActor = new Actor(world, {
                name: 'CustomActor',
                layer: 5 as any,
                tag: 'custom' as any,
                active: false,
                persistent: true,
                autoStart: false,
            });

            expect(customActor.name).toBe('CustomActor');
            expect(customActor.layer).toBe(5);
            expect(customActor.tag).toBe('custom');
            expect(customActor.active).toBe(false);
            expect(customActor.state).toBe('active');

            customActor.destroy();
        });

        it('should generate unique IDs', () => {
            const actor1 = createActor(world);
            const actor2 = createActor(world);

            expect(actor1.id).not.toBe(actor2.id);

            actor1.destroy();
            actor2.destroy();
        });

        it('should throw error with invalid world', () => {
            expect(() => {
                new Actor(null as any);
            }).toThrow(ActorError);
        });
    });

    describe('component management', () => {
        it('should add components correctly', () => {
            const component = actor.addComponent(TestComponent, 10, 'test');

            expect(component).toBeInstanceOf(TestComponent);
            expect(component.value).toBe(2);
            expect(component.name).toBe('test');
            expect(actor.hasComponent(TestComponent)).toBe(true);
            expect(actor.componentCount).toBe(2);
        });

        it('should get components correctly', () => {
            const addedComponent = actor.addComponent(TestComponent, 5, 'test');
            const retrievedComponent = actor.getComponent(TestComponent);

            expect(retrievedComponent).toBe(addedComponent);
            expect(retrievedComponent?.value).toBe(2);
            expect(retrievedComponent?.name).toBe('test');
        });

        it('should return undefined for non-existent components', () => {
            expect(actor.getComponent(TestComponent)).toBeUndefined();
            expect(actor.hasComponent(TestComponent)).toBe(false);
        });

        it('should require components correctly', () => {
            actor.addComponent(TestComponent, 15, 'required');
            const component = actor.requireComponent(TestComponent);

            expect(component).toBeInstanceOf(TestComponent);
            expect(component.value).toBe(2);
        });

        it('should throw error when requiring non-existent component', () => {
            expect(() => {
                actor.requireComponent(TestComponent);
            }).toThrow(ComponentError);
        });

        it('should remove components correctly', () => {
            actor.addComponent(TestComponent, 20, 'remove');
            expect(actor.hasComponent(TestComponent)).toBe(true);

            const removed = actor.removeComponent(TestComponent);
            expect(removed).toBe(true);
            expect(actor.hasComponent(TestComponent)).toBe(false);
            expect(actor.componentCount).toBe(1);
        });

        it('should return false when removing non-existent component', () => {
            const removed = actor.removeComponent(TestComponent);
            expect(removed).toBe(false);
        });

        it('should get all components correctly', () => {
            actor.addComponent(TestComponent, 1, 'first');
            actor.addComponent(AsyncComponent);

            const components = actor.getAllComponents();
            expect(components).toHaveLength(3);
            expect(components.some((c) => c instanceof TestComponent)).toBe(true);
            expect(components.some((c) => c instanceof AsyncComponent)).toBe(true);
        });

        it('should prevent duplicate components of same type', () => {
            actor.addComponent(TestComponent, 1, 'first');

            expect(() => {
                actor.addComponent(TestComponent, 2, 'second');
            }).toThrow(ComponentError);
        });

        it('should maintain single instance of component type', () => {
            actor.addComponent(TestComponent, 1, 'first');

            const component = actor.getComponent(TestComponent);
            expect(component?.value).toBe(2);
            expect(component?.name).toBe('first');
            expect(actor.componentCount).toBe(2);
        });
    });

    describe('component dependencies', () => {
        it('should handle component dependencies correctly', () => {
            actor.addComponent(TestComponent, 100, 'dependency');
            const dependent = actor.addComponent(DependentComponent);

            actor.start();

            expect(dependent.dependency).toBeInstanceOf(TestComponent);
            expect(dependent.dependency?.value).toBe(2);
        });

        it('should throw error when dependency is missing', () => {
            expect(() => {
                actor.addComponent(DependentComponent);
            }).toThrow();
        });

        it('should respect component priorities', () => {
            const testComp = actor.addComponent(TestComponent, 0, 'test');
            const depComp = actor.addComponent(DependentComponent);

            actor.start();

            expect(testComp.value).toBe(2);
            expect(depComp.dependency).toBe(testComp);
        });
    });

    describe('lifecycle management', () => {
        it('should transition through lifecycle states correctly', () => {
            const component = actor.addComponent(TestComponent, 0, 'lifecycle');

            expect(actor.state).toBe('active');
            expect(component.value).toBe(2);

            actor.start();

            expect(actor.state).toBe('active');
            expect(component.value).toBe(2);
        });

        it('should handle async components correctly', async () => {
            const asyncComp = actor.addComponent(AsyncComponent);

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(asyncComp.initialized).toBe(true);

            actor.start();

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(asyncComp.started).toBe(true);
        });

        it('should handle component lifecycle errors gracefully', () => {
            const errorComp = actor.addComponent(ErrorComponent);
            errorComp.shouldThrowInStart = true;

            expect(() => actor.start()).not.toThrow();
            expect(actor.state).toBe('active');
        });

        it('should update components correctly', () => {
            const component = actor.addComponent(TestComponent, 0, 'update');
            actor.start();

            const initialValue = component.value;
            actor.update(0.016);

            expect(component.value).toBeCloseTo(initialValue + 0.016, 5);
        });

        it('should not update inactive actors', () => {
            const component = actor.addComponent(TestComponent, 0, 'inactive');
            actor.start();

            actor.active = false;
            const initialValue = component.value;
            actor.update(0.016);

            expect(component.value).toBe(initialValue);
        });

        it('should destroy actor correctly', () => {
            const component = actor.addComponent(TestComponent, 0, 'destroy');
            actor.start();

            expect(actor.isDestroyed).toBe(false);

            actor.destroy();

            expect(actor.state).toBe('destroyed');
            expect(actor.isDestroyed).toBe(true);
            expect(actor.componentCount).toBe(0);
        });

        it('should handle multiple destroy calls', () => {
            actor.start();
            actor.destroy();

            expect(() => actor.destroy()).not.toThrow();
            expect(actor.state).toBe('destroyed');
        });
    });

    describe('state management', () => {
        it('should set and get active state correctly', () => {
            actor.start();

            expect(actor.active).toBe(true);

            actor.active = false;
            expect(actor.active).toBe(false);
            expect(actor.state).toBe('inactive');

            actor.active = true;
            expect(actor.active).toBe(true);
            expect(actor.state).toBe('active');
        });

        it('should prevent state changes on destroyed actor', () => {
            actor.destroy();

            expect(() => {
                actor.active = true;
            }).toThrow(ActorError);
        });

        it('should set name correctly', () => {
            expect(actor.name).toBe('Actor');

            actor.name = 'NewName';
            expect(actor.name).toBe('NewName');
        });

        it('should set layer correctly', () => {
            expect(actor.layer).toBe(0);

            actor.layer = 5 as any;
            expect(actor.layer).toBe(5);
        });

        it('should set tag correctly', () => {
            expect(actor.tag).toBe('Default');

            actor.tag = 'newtag' as any;
            expect(actor.tag).toBe('newtag');
        });
    });

    describe('component queries', () => {
        it('should get all components correctly', () => {
            actor.addComponent(TestComponent, 10, 'first');
            actor.addComponent(AsyncComponent);

            const allComponents = actor.getAllComponents();
            expect(allComponents).toHaveLength(3);
            expect(allComponents.some((c) => c instanceof TestComponent)).toBe(true);
            expect(allComponents.some((c) => c instanceof AsyncComponent)).toBe(true);
        });

        it('should filter components manually', () => {
            actor.addComponent(TestComponent, 15, 'findme');
            actor.addComponent(AsyncComponent);

            const allComponents = actor.getAllComponents();
            const testComponents = allComponents.filter((c) => c instanceof TestComponent);
            expect(testComponents).toHaveLength(1);
            expect((testComponents[0] as TestComponent).value).toBe(2);
        });
    });

    describe('properties', () => {
        it('should set and get properties correctly', () => {
            actor.name = 'TestActor';
            actor.layer = 3 as any;
            actor.tag = 'testtag' as any;

            expect(actor.name).toBe('TestActor');
            expect(actor.layer).toBe(3);
            expect(actor.tag).toBe('testtag');
        });

        it('should validate property values', () => {
            expect(() => {
                actor.name = '';
            }).toThrow(ActorError);

            expect(() => {
                actor.layer = -1 as any;
            }).toThrow(ActorError);

            expect(() => {
                actor.tag = '' as any;
            }).toThrow(ActorError);
        });
    });

    describe('event handling', () => {
        it('should handle event bus correctly', () => {
            const mockEventBus = {
                emit: vi.fn(),
                on: vi.fn().mockReturnValue(() => {}),
            };

            (actor as any)._eventBus = mockEventBus;

            const handler = vi.fn();
            const unsubscribe = actor.on('test-event', handler);

            expect(mockEventBus.on).toHaveBeenCalledWith('test-event', handler);
            expect(typeof unsubscribe).toBe('function');
        });

        it('should subscribe to events correctly', () => {
            const handler = vi.fn();
            const mockUnsubscribe = vi.fn();

            const mockEventBus = {
                emit: vi.fn(),
                on: vi.fn().mockReturnValue(mockUnsubscribe),
            };

            (actor as any)._eventBus = mockEventBus;

            const unsubscribe = actor.on('test-event', handler);

            expect(mockEventBus.on).toHaveBeenCalledWith('test-event', handler);
            expect(typeof unsubscribe).toBe('function');
        });
    });

    describe('cleanup and memory management', () => {
        it('should add and execute cleanup tasks', async () => {
            const cleanupTask = vi.fn();

            actor.addCleanupTask(cleanupTask);
            await actor.destroy();

            expect(cleanupTask).toHaveBeenCalled();
        });

        it('should execute cleanup tasks on destroy', () => {
            const cleanupTask = vi.fn();

            actor.addCleanupTask(cleanupTask);
            actor.destroy();

            expect(cleanupTask).toHaveBeenCalled();
        });

        it('should provide debug information', () => {
            actor.name = 'DebugActor';
            actor.addComponent(TestComponent, 40, 'debug');

            const debugStr = actor.toString();

            expect(debugStr).toContain('Actor');
            expect(debugStr).toContain(actor.id);
            expect(debugStr).toContain('TestComponent');
        });

        it('should provide string representation', () => {
            actor.name = 'StringActor';

            const str = actor.toString();

            expect(str).toContain('Actor');
            expect(str).toContain(actor.id);
            expect(str).toContain('active');
        });
    });

    describe('performance and metrics', () => {
        it('should track creation time', () => {
            expect(actor.creationTime).toBeDefined();
            expect(typeof actor.creationTime).toBe('number');
            expect(actor.creationTime).toBeGreaterThan(0);
        });

        it('should handle rapid component operations', () => {
            const startTime = performance.now();

            for (let i = 0; i < 5; i++) {
                actor.addComponent(TestComponent, i, `component_${i}`);
                actor.removeComponent(TestComponent);
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should handle many components efficiently', () => {
            const startTime = performance.now();

            actor.addComponent(TestComponent, 1, 'test1');
            actor.addComponent(AsyncComponent);
            actor.addComponent(ErrorComponent);

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(50);
            expect(actor.componentCount).toBe(4);
        });

        it('should track creation time', () => {
            expect(actor.creationTime).toBeDefined();
            expect(typeof actor.creationTime).toBe('number');
            expect(actor.creationTime).toBeGreaterThan(0);
        });
    });

    describe('edge cases', () => {
        it('should handle null and undefined values gracefully', () => {
            expect(() => {
                actor.name = null as any;
            }).toThrow(ActorError);
        });

        it('should handle extreme layer values', () => {
            actor.layer = Number.MAX_SAFE_INTEGER as any;
            expect(actor.layer).toBe(Number.MAX_SAFE_INTEGER);

            expect(() => {
                actor.layer = Number.MIN_SAFE_INTEGER as any;
            }).toThrow(ActorError);
        });

        it('should handle multiple start calls', () => {
            actor.start();
            actor.start();
            actor.start();

            expect(actor.state).toBe('active');
        });

        it('should handle component limit correctly', () => {
            const limitedActor = new Actor(world, { maxComponents: 2 });

            limitedActor.addComponent(TestComponent);

            expect(() => {
                limitedActor.addComponent(AsyncComponent);
            }).toThrow(ComponentError);

            limitedActor.destroy();
        });
    });
});
