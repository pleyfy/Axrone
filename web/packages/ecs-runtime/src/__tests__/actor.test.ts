import { Actor, ActorError, ComponentError } from '@axrone/ecs-runtime/actor';
import { Component, Transform, World, script } from '@axrone/ecs-runtime';
import { createActor } from './factory-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hierarchy } from '../component-system/components/hierarchy';

class TestComponent extends Component {
    value: number = 0;
    name: string = '';

    constructor(value: number = 0, name: string = '') {
        super();
        this.value = value;
        this.name = name;
    }

    onLoad(): void {
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

    onLoad(): void {
        this.dependency = this.requireComponent(TestComponent);
    }
}

class AsyncComponent extends Component {
    initialized = false;
    started = false;

    async onLoad(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.initialized = true;
    }

    async start(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.started = true;
    }
}

class ErrorComponent extends Component {
    shouldThrowInOnLoad = false;
    shouldThrowInStart = false;

    onLoad(): void {
        if (this.shouldThrowInOnLoad) {
            throw new Error('OnLoad error');
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
            expect(actor.componentCount).toBe(2);
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

        it('should initialize preloaded components through the fast path', () => {
            const preloadedActor = Actor.createWithComponents(world, { autoStart: false }, [
                {
                    componentType: Transform,
                    component: new Transform(),
                },
                {
                    componentType: TestComponent,
                    component: new TestComponent(10, 'preloaded'),
                },
            ]);

            expect(preloadedActor.getComponent(Transform)).toBeInstanceOf(Transform);
            expect(preloadedActor.getComponent(TestComponent)?.value).toBe(1);
            expect(preloadedActor.getComponent(TestComponent)?.name).toBe('preloaded');

            preloadedActor.start();

            expect(preloadedActor.getComponent(TestComponent)?.value).toBe(2);

            preloadedActor.destroy();
        });
    });

    describe('component management', () => {
        it('should add components correctly', () => {
            const component = actor.addComponent(TestComponent, 10, 'test');

            expect(component).toBeInstanceOf(TestComponent);
            expect(component.value).toBe(2);
            expect(component.name).toBe('test');
            expect(actor.hasComponent(TestComponent)).toBe(true);
            expect(actor.componentCount).toBe(3);
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
            expect(actor.componentCount).toBe(2);
        });

        it('should return false when removing non-existent component', () => {
            const removed = actor.removeComponent(TestComponent);
            expect(removed).toBe(false);
        });

        it('should get all components correctly', () => {
            actor.addComponent(TestComponent, 1, 'first');
            actor.addComponent(AsyncComponent);

            const components = actor.getAllComponents();
            expect(components).toHaveLength(4);
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
            expect(actor.componentCount).toBe(3);
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
            expect(allComponents).toHaveLength(4);
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
            expect(actor.componentCount).toBe(5);
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

    // ─── fixedUpdate ─────────────────────────────────────────────────

    describe('fixedUpdate', () => {
        it('calls fixedUpdate on enabled components of active actor', () => {
            const fixedUpdateSpy = vi.fn();
            class FixedComp extends Component {
                fixedUpdate(dt: number) {
                    fixedUpdateSpy(dt);
                }
            }
            world.registerComponentType(FixedComp);

            const comp = actor.addComponent(FixedComp);
            actor.fixedUpdate(0.02);

            expect(fixedUpdateSpy).toHaveBeenCalledWith(0.02);
        });

        it('skips inactive actors', () => {
            const fixedUpdateSpy = vi.fn();
            class FixedComp2 extends Component {
                fixedUpdate(dt: number) {
                    fixedUpdateSpy(dt);
                }
            }
            world.registerComponentType(FixedComp2);

            actor.addComponent(FixedComp2);
            actor.active = false;
            actor.fixedUpdate(0.02);

            expect(fixedUpdateSpy).not.toHaveBeenCalled();
        });

        it('skips destroyed actors', () => {
            const fixedUpdateSpy = vi.fn();
            class FixedComp3 extends Component {
                fixedUpdate(dt: number) {
                    fixedUpdateSpy(dt);
                }
            }
            world.registerComponentType(FixedComp3);

            actor.addComponent(FixedComp3);
            actor.destroy();
            actor.fixedUpdate(0.02);

            expect(fixedUpdateSpy).not.toHaveBeenCalled();
        });
    });

    // ─── lateUpdate ──────────────────────────────────────────────────

    describe('lateUpdate', () => {
        it('calls lateUpdate on enabled components', () => {
            const lateUpdateSpy = vi.fn();
            class LateComp extends Component {
                lateUpdate(dt: number) {
                    lateUpdateSpy(dt);
                }
            }
            world.registerComponentType(LateComp);

            actor.addComponent(LateComp);
            actor.lateUpdate(0.016);

            expect(lateUpdateSpy).toHaveBeenCalledWith(0.016);
        });

        it('skips inactive actors', () => {
            const lateUpdateSpy = vi.fn();
            class LateComp2 extends Component {
                lateUpdate(dt: number) {
                    lateUpdateSpy(dt);
                }
            }
            world.registerComponentType(LateComp2);

            actor.addComponent(LateComp2);
            actor.active = false;
            actor.lateUpdate(0.016);

            expect(lateUpdateSpy).not.toHaveBeenCalled();
        });
    });

    // ─── Hierarchy delegation ────────────────────────────────────────

    describe('hierarchy delegation', () => {
        it('setParent delegates to Hierarchy component', () => {
            const childActor = createActor(world);
            actor.setParent(childActor);

            // Verify through the parent getter
            expect(actor.parent).toBe(childActor);

            childActor.destroy();
        });

        it('setParent with undefined removes parent', () => {
            const parentActor = createActor(world);
            actor.setParent(parentActor);
            expect(actor.parent).toBe(parentActor);

            actor.setParent(undefined);
            expect(actor.parent).toBeUndefined();

            parentActor.destroy();
        });

        it('parent getter returns undefined when no hierarchy', () => {
            // Default actor has Hierarchy, so parent should be undefined (no parent set)
            expect(actor.parent).toBeUndefined();
        });

        it('children getter returns array', () => {
            expect(Array.isArray(actor.children)).toBe(true);
        });
    });

    // ─── addComponent edge cases ─────────────────────────────────────

    describe('addComponent edge cases', () => {
        it('throws ComponentError for invalid component type', () => {
            expect(() => actor.addComponent(null as any)).toThrow(ComponentError);
        });

        it('throws ComponentError on destroyed actor', () => {
            actor.destroy();
            expect(() => actor.addComponent(TestComponent)).toThrow(ActorError);
        });
    });

    // ─── removeComponent with dependents ─────────────────────────────

    describe('removeComponent with dependents', () => {
        it('throws ComponentError when other components depend on it', () => {
            @script({ dependencies: [TestComponent] })
            class DependsOnTest extends Component {
                data = 0;
            }
            world.registerComponentType(DependsOnTest);

            actor.addComponent(TestComponent, 100, 'dep');
            actor.addComponent(DependsOnTest);

            expect(() => actor.removeComponent(TestComponent)).toThrow(ComponentError);
        });
    });

    // ─── destroy sequence ────────────────────────────────────────────

    describe('destroy sequence', () => {
        it('calls onDestroy on components', () => {
            const onDestroySpy = vi.fn();
            class DestroyComp extends Component {
                onDestroy() {
                    onDestroySpy();
                }
            }
            world.registerComponentType(DestroyComp);

            actor.addComponent(DestroyComp);
            actor.destroy();

            expect(onDestroySpy).toHaveBeenCalled();
        });

        it('runs cleanup tasks', () => {
            const cleanup = vi.fn();
            actor.addCleanupTask(cleanup);
            actor.destroy();

            expect(cleanup).toHaveBeenCalled();
        });

        it('unregisters actor and destroys entity', () => {
            const entity = actor.entity;
            actor.destroy();

            expect(world.getActor(entity)).toBeUndefined();
        });
    });

    // ─── destroy(immediate) ──────────────────────────────────────────

    describe('destroy(immediate)', () => {
        it('emits destroying event with immediate flag', () => {
            const mockEventBus = {
                emit: vi.fn(),
                on: vi.fn().mockReturnValue(() => {}),
            };
            (actor as any)._eventBus = mockEventBus;

            actor.destroy(true);

            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'actor:destroying',
                expect.objectContaining({ immediate: true })
            );
        });
    });

    // ─── Property setters on destroyed actor ─────────────────────────

    describe('property setters on destroyed actor', () => {
        it('name setter throws ActorError', () => {
            actor.destroy();
            expect(() => {
                actor.name = 'New';
            }).toThrow(ActorError);
        });

        it('layer setter throws ActorError', () => {
            actor.destroy();
            expect(() => {
                actor.layer = 5;
            }).toThrow(ActorError);
        });

        it('tag setter throws ActorError', () => {
            actor.destroy();
            expect(() => {
                actor.tag = 'new';
            }).toThrow(ActorError);
        });
    });

    // ─── on() without event bus ──────────────────────────────────────

    describe('on() without event bus', () => {
        it('returns no-op disposer and warns', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            (actor as any)._eventBus = null;

            const dispose = actor.on('test', () => {});
            expect(typeof dispose).toBe('function');
            expect(() => dispose()).not.toThrow();
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
        });
    });

    // ─── toString ────────────────────────────────────────────────────

    describe('toString', () => {
        it('includes actor id, component names, and state', () => {
            actor.addComponent(TestComponent, 10, 'test');
            const str = actor.toString();

            expect(str).toContain(actor.id);
            expect(str).toContain('TestComponent');
            expect(str).toContain('active');
        });
    });

    describe('revision tracking', () => {
        it('increments when components or active state change', () => {
            const initial = actor.revision;

            const component = actor.addComponent(TestComponent, 10, 'revision');
            const afterAdd = actor.revision;
            expect(afterAdd).toBeGreaterThan(initial);

            actor.removeComponent(TestComponent);
            expect(actor.revision).toBeGreaterThan(afterAdd);

            const afterRemove = actor.revision;
            actor.active = false;
            expect(actor.revision).toBeGreaterThan(afterRemove);

            actor.active = false;
            const afterSameActive = actor.revision;
            actor.active = true;
            expect(actor.revision).toBeGreaterThan(afterSameActive);

            expect(component).toBeDefined();
        });
    });
});
