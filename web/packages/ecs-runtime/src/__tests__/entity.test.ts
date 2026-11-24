import { Entity, EntityLifecycleError, ComponentError } from '@axrone/ecs-runtime/entity';
import { Component, Transform, World, script } from '@axrone/ecs-runtime';
import { createEntity } from './factory-helpers';
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

describe('Entity', () => {
    let world: World<any>;
    let entity: EntityId;
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
        entity = createEntity(world);
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

    describe('initialization', () => {
        it('should initialize with correct default values', () => {
            expect(entity.id).toBeDefined();
            expect(entity.entityId).toBeDefined();
            expect(entity.world).toBe(world);
            expect(entity.state).toBe('active');
            expect(entity.active).toBe(true);
            expect(entity.name).toBe('Entity');
            expect(entity.layer).toBe(0);
            expect(entity.tag).toBe('Default');
            expect(entity.isDestroyed).toBe(false);
            expect(entity.componentCount).toBe(2);
        });

        it('should initialize with custom configuration', () => {
            const customEntity = new Entity(world, {
                name: 'CustomEntity',
                layer: 5 as any,
                tag: 'custom' as any,
                active: false,
                persistent: true,
                autoStart: false,
            });

            expect(customEntity.name).toBe('CustomEntity');
            expect(customEntity.layer).toBe(5);
            expect(customEntity.tag).toBe('custom');
            expect(customEntity.active).toBe(false);
            expect(customEntity.state).toBe('active');

            customEntity.destroy();
        });

        it('should generate unique IDs', () => {
            const entity1 = createEntity(world);
            const entity2 = createEntity(world);

            expect(entity1.id).not.toBe(entity2.id);

            entity1.destroy();
            entity2.destroy();
        });

        it('should throw error with invalid world', () => {
            expect(() => {
                new Entity(null as any);
            }).toThrow(EntityLifecycleError);
        });

        it('should initialize preloaded components through the fast path', () => {
            const preloadedEntity = Entity.createWithComponents(world, { autoStart: false }, [
                {
                    componentType: Transform,
                    component: new Transform(),
                },
                {
                    componentType: TestComponent,
                    component: new TestComponent(10, 'preloaded'),
                },
            ]);

            expect(preloadedEntity.getComponent(Transform)).toBeInstanceOf(Transform);
            expect(preloadedEntity.getComponent(TestComponent)?.value).toBe(1);
            expect(preloadedEntity.getComponent(TestComponent)?.name).toBe('preloaded');

            preloadedEntity.start();

            expect(preloadedEntity.getComponent(TestComponent)?.value).toBe(2);

            preloadedEntity.destroy();
        });
    });

    describe('component management', () => {
        it('should add components correctly', () => {
            const component = entity.addComponent(TestComponent, 10, 'test');

            expect(component).toBeInstanceOf(TestComponent);
            expect(component.value).toBe(2);
            expect(component.name).toBe('test');
            expect(entity.hasComponent(TestComponent)).toBe(true);
            expect(entity.componentCount).toBe(3);
        });

        it('should get components correctly', () => {
            const addedComponent = entity.addComponent(TestComponent, 5, 'test');
            const retrievedComponent = entity.getComponent(TestComponent);

            expect(retrievedComponent).toBe(addedComponent);
            expect(retrievedComponent?.value).toBe(2);
            expect(retrievedComponent?.name).toBe('test');
        });

        it('should return undefined for non-existent components', () => {
            expect(entity.getComponent(TestComponent)).toBeUndefined();
            expect(entity.hasComponent(TestComponent)).toBe(false);
        });

        it('should require components correctly', () => {
            entity.addComponent(TestComponent, 15, 'required');
            const component = entity.requireComponent(TestComponent);

            expect(component).toBeInstanceOf(TestComponent);
            expect(component.value).toBe(2);
        });

        it('should throw error when requiring non-existent component', () => {
            expect(() => {
                entity.requireComponent(TestComponent);
            }).toThrow(ComponentError);
        });

        it('should remove components correctly', () => {
            entity.addComponent(TestComponent, 20, 'remove');
            expect(entity.hasComponent(TestComponent)).toBe(true);

            const removed = entity.removeComponent(TestComponent);
            expect(removed).toBe(true);
            expect(entity.hasComponent(TestComponent)).toBe(false);
            expect(entity.componentCount).toBe(2);
        });

        it('should return false when removing non-existent component', () => {
            const removed = entity.removeComponent(TestComponent);
            expect(removed).toBe(false);
        });

        it('should get all components correctly', () => {
            entity.addComponent(TestComponent, 1, 'first');
            entity.addComponent(AsyncComponent);

            const components = entity.getAllComponents();
            expect(components).toHaveLength(4);
            expect(components.some((c) => c instanceof TestComponent)).toBe(true);
            expect(components.some((c) => c instanceof AsyncComponent)).toBe(true);
        });

        it('should prevent duplicate components of same type', () => {
            entity.addComponent(TestComponent, 1, 'first');

            expect(() => {
                entity.addComponent(TestComponent, 2, 'second');
            }).toThrow(ComponentError);
        });

        it('should maintain single instance of component type', () => {
            entity.addComponent(TestComponent, 1, 'first');

            const component = entity.getComponent(TestComponent);
            expect(component?.value).toBe(2);
            expect(component?.name).toBe('first');
            expect(entity.componentCount).toBe(3);
        });
    });

    describe('component dependencies', () => {
        it('should handle component dependencies correctly', () => {
            entity.addComponent(TestComponent, 100, 'dependency');
            const dependent = entity.addComponent(DependentComponent);

            entity.start();

            expect(dependent.dependency).toBeInstanceOf(TestComponent);
            expect(dependent.dependency?.value).toBe(2);
        });

        it('should throw error when dependency is missing', () => {
            expect(() => {
                entity.addComponent(DependentComponent);
            }).toThrow();
        });

        it('should respect component priorities', () => {
            const testComp = entity.addComponent(TestComponent, 0, 'test');
            const depComp = entity.addComponent(DependentComponent);

            entity.start();

            expect(testComp.value).toBe(2);
            expect(depComp.dependency).toBe(testComp);
        });
    });

    describe('lifecycle management', () => {
        it('should transition through lifecycle states correctly', () => {
            const component = entity.addComponent(TestComponent, 0, 'lifecycle');

            expect(entity.state).toBe('active');
            expect(component.value).toBe(2);

            entity.start();

            expect(entity.state).toBe('active');
            expect(component.value).toBe(2);
        });

        it('should handle async components correctly', async () => {
            const asyncComp = entity.addComponent(AsyncComponent);

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(asyncComp.initialized).toBe(true);

            entity.start();

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(asyncComp.started).toBe(true);
        });

        it('should handle component lifecycle errors gracefully', () => {
            const errorComp = entity.addComponent(ErrorComponent);
            errorComp.shouldThrowInStart = true;

            expect(() => entity.start()).not.toThrow();
            expect(entity.state).toBe('active');
        });

        it('should update components correctly', () => {
            const component = entity.addComponent(TestComponent, 0, 'update');
            entity.start();

            const initialValue = component.value;
            entity.update(0.016);

            expect(component.value).toBeCloseTo(initialValue + 0.016, 5);
        });

        it('should not update inactive entities', () => {
            const component = entity.addComponent(TestComponent, 0, 'inactive');
            entity.start();

            entity.active = false;
            const initialValue = component.value;
            entity.update(0.016);

            expect(component.value).toBe(initialValue);
        });

        it('should destroy entity correctly', () => {
            const component = entity.addComponent(TestComponent, 0, 'destroy');
            entity.start();

            expect(entity.isDestroyed).toBe(false);

            entity.destroy();

            expect(entity.state).toBe('destroyed');
            expect(entity.isDestroyed).toBe(true);
            expect(entity.componentCount).toBe(0);
        });

        it('should handle multiple destroy calls', () => {
            entity.start();
            entity.destroy();

            expect(() => entity.destroy()).not.toThrow();
            expect(entity.state).toBe('destroyed');
        });
    });

    describe('state management', () => {
        it('should set and get active state correctly', () => {
            entity.start();

            expect(entity.active).toBe(true);

            entity.active = false;
            expect(entity.active).toBe(false);
            expect(entity.state).toBe('inactive');

            entity.active = true;
            expect(entity.active).toBe(true);
            expect(entity.state).toBe('active');
        });

        it('should prevent state changes on destroyed entity', () => {
            entity.destroy();

            expect(() => {
                entity.active = true;
            }).toThrow(EntityLifecycleError);
        });

        it('should set name correctly', () => {
            expect(entity.name).toBe('Entity');

            entity.name = 'NewName';
            expect(entity.name).toBe('NewName');
        });

        it('should set layer correctly', () => {
            expect(entity.layer).toBe(0);

            entity.layer = 5 as any;
            expect(entity.layer).toBe(5);
        });

        it('should set tag correctly', () => {
            expect(entity.tag).toBe('Default');

            entity.tag = 'newtag' as any;
            expect(entity.tag).toBe('newtag');
        });
    });

    describe('component queries', () => {
        it('should get all components correctly', () => {
            entity.addComponent(TestComponent, 10, 'first');
            entity.addComponent(AsyncComponent);

            const allComponents = entity.getAllComponents();
            expect(allComponents).toHaveLength(4);
            expect(allComponents.some((c) => c instanceof TestComponent)).toBe(true);
            expect(allComponents.some((c) => c instanceof AsyncComponent)).toBe(true);
        });

        it('should filter components manually', () => {
            entity.addComponent(TestComponent, 15, 'findme');
            entity.addComponent(AsyncComponent);

            const allComponents = entity.getAllComponents();
            const testComponents = allComponents.filter((c) => c instanceof TestComponent);
            expect(testComponents).toHaveLength(1);
            expect((testComponents[0] as TestComponent).value).toBe(2);
        });
    });

    describe('properties', () => {
        it('should set and get properties correctly', () => {
            entity.name = 'TestEntity';
            entity.layer = 3 as any;
            entity.tag = 'testtag' as any;

            expect(entity.name).toBe('TestEntity');
            expect(entity.layer).toBe(3);
            expect(entity.tag).toBe('testtag');
        });

        it('should validate property values', () => {
            expect(() => {
                entity.name = '';
            }).toThrow(EntityLifecycleError);

            expect(() => {
                entity.layer = -1 as any;
            }).toThrow(EntityLifecycleError);

            expect(() => {
                entity.tag = '' as any;
            }).toThrow(EntityLifecycleError);
        });
    });

    describe('event handling', () => {
        it('should handle event bus correctly', () => {
            const mockEventBus = {
                emit: vi.fn(),
                on: vi.fn().mockReturnValue(() => {}),
            };

            (entity as any)._eventBus = mockEventBus;

            const handler = vi.fn();
            const unsubscribe = entity.on('test-event', handler);

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

            (entity as any)._eventBus = mockEventBus;

            const unsubscribe = entity.on('test-event', handler);

            expect(mockEventBus.on).toHaveBeenCalledWith('test-event', handler);
            expect(typeof unsubscribe).toBe('function');
        });
    });

    describe('cleanup and memory management', () => {
        it('should add and execute cleanup tasks', async () => {
            const cleanupTask = vi.fn();

            entity.addCleanupTask(cleanupTask);
            await entity.destroy();

            expect(cleanupTask).toHaveBeenCalled();
        });

        it('should execute cleanup tasks on destroy', () => {
            const cleanupTask = vi.fn();

            entity.addCleanupTask(cleanupTask);
            entity.destroy();

            expect(cleanupTask).toHaveBeenCalled();
        });

        it('should provide debug information', () => {
            entity.name = 'DebugEntity';
            entity.addComponent(TestComponent, 40, 'debug');

            const debugStr = entity.toString();

            expect(debugStr).toContain('Entity');
            expect(debugStr).toContain(entity.id);
            expect(debugStr).toContain('TestComponent');
        });

        it('should provide string representation', () => {
            entity.name = 'StringEntity';

            const str = entity.toString();

            expect(str).toContain('Entity');
            expect(str).toContain(entity.id);
            expect(str).toContain('active');
        });
    });

    describe('performance and metrics', () => {
        it('should track creation time', () => {
            expect(entity.creationTime).toBeDefined();
            expect(typeof entity.creationTime).toBe('number');
            expect(entity.creationTime).toBeGreaterThan(0);
        });

        it('should handle rapid component operations', () => {
            const startTime = performance.now();

            for (let i = 0; i < 5; i++) {
                entity.addComponent(TestComponent, i, `component_${i}`);
                entity.removeComponent(TestComponent);
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should handle many components efficiently', () => {
            const startTime = performance.now();

            entity.addComponent(TestComponent, 1, 'test1');
            entity.addComponent(AsyncComponent);
            entity.addComponent(ErrorComponent);

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(50);
            expect(entity.componentCount).toBe(5);
        });

        it('should track creation time', () => {
            expect(entity.creationTime).toBeDefined();
            expect(typeof entity.creationTime).toBe('number');
            expect(entity.creationTime).toBeGreaterThan(0);
        });
    });

    describe('edge cases', () => {
        it('should handle null and undefined values gracefully', () => {
            expect(() => {
                entity.name = null as any;
            }).toThrow(EntityLifecycleError);
        });

        it('should handle extreme layer values', () => {
            entity.layer = Number.MAX_SAFE_INTEGER as any;
            expect(entity.layer).toBe(Number.MAX_SAFE_INTEGER);

            expect(() => {
                entity.layer = Number.MIN_SAFE_INTEGER as any;
            }).toThrow(EntityLifecycleError);
        });

        it('should handle multiple start calls', () => {
            entity.start();
            entity.start();
            entity.start();

            expect(entity.state).toBe('active');
        });

        it('should handle component limit correctly', () => {
            const limitedEntity = new Entity(world, { maxComponents: 2 });

            limitedEntity.addComponent(TestComponent);

            expect(() => {
                limitedEntity.addComponent(AsyncComponent);
            }).toThrow(ComponentError);

            limitedEntity.destroy();
        });
    });

    // ─── fixedUpdate ─────────────────────────────────────────────────

    describe('fixedUpdate', () => {
        it('calls fixedUpdate on enabled components of active entity', () => {
            const fixedUpdateSpy = vi.fn();
            class FixedComp extends Component {
                fixedUpdate(dt: number) {
                    fixedUpdateSpy(dt);
                }
            }
            world.registerComponentType(FixedComp);

            const comp = entity.addComponent(FixedComp);
            entity.fixedUpdate(0.02);

            expect(fixedUpdateSpy).toHaveBeenCalledWith(0.02);
        });

        it('skips inactive entities', () => {
            const fixedUpdateSpy = vi.fn();
            class FixedComp2 extends Component {
                fixedUpdate(dt: number) {
                    fixedUpdateSpy(dt);
                }
            }
            world.registerComponentType(FixedComp2);

            entity.addComponent(FixedComp2);
            entity.active = false;
            entity.fixedUpdate(0.02);

            expect(fixedUpdateSpy).not.toHaveBeenCalled();
        });

        it('skips destroyed entities', () => {
            const fixedUpdateSpy = vi.fn();
            class FixedComp3 extends Component {
                fixedUpdate(dt: number) {
                    fixedUpdateSpy(dt);
                }
            }
            world.registerComponentType(FixedComp3);

            entity.addComponent(FixedComp3);
            entity.destroy();
            entity.fixedUpdate(0.02);

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

            entity.addComponent(LateComp);
            entity.lateUpdate(0.016);

            expect(lateUpdateSpy).toHaveBeenCalledWith(0.016);
        });

        it('skips inactive entities', () => {
            const lateUpdateSpy = vi.fn();
            class LateComp2 extends Component {
                lateUpdate(dt: number) {
                    lateUpdateSpy(dt);
                }
            }
            world.registerComponentType(LateComp2);

            entity.addComponent(LateComp2);
            entity.active = false;
            entity.lateUpdate(0.016);

            expect(lateUpdateSpy).not.toHaveBeenCalled();
        });
    });

    // ─── Hierarchy delegation ────────────────────────────────────────

    describe('hierarchy delegation', () => {
        it('setParent delegates to Hierarchy component', () => {
            const childEntity = createEntity(world);
            entity.setParent(childEntity);

            // Verify through the parent getter
            expect(entity.parent).toBe(childEntity);

            childEntity.destroy();
        });

        it('setParent with undefined removes parent', () => {
            const parentEntity = createEntity(world);
            entity.setParent(parentEntity);
            expect(entity.parent).toBe(parentEntity);

            entity.setParent(undefined);
            expect(entity.parent).toBeUndefined();

            parentEntity.destroy();
        });

        it('parent getter returns undefined when no hierarchy', () => {
            // Default entity has Hierarchy, so parent should be undefined (no parent set)
            expect(entity.parent).toBeUndefined();
        });

        it('children getter returns array', () => {
            expect(Array.isArray(entity.children)).toBe(true);
        });
    });

    // ─── addComponent edge cases ─────────────────────────────────────

    describe('addComponent edge cases', () => {
        it('throws ComponentError for invalid component type', () => {
            expect(() => entity.addComponent(null as any)).toThrow(ComponentError);
        });

        it('throws ComponentError on destroyed entity', () => {
            entity.destroy();
            expect(() => entity.addComponent(TestComponent)).toThrow(EntityLifecycleError);
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

            entity.addComponent(TestComponent, 100, 'dep');
            entity.addComponent(DependsOnTest);

            expect(() => entity.removeComponent(TestComponent)).toThrow(ComponentError);
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

            entity.addComponent(DestroyComp);
            entity.destroy();

            expect(onDestroySpy).toHaveBeenCalled();
        });

        it('runs cleanup tasks', () => {
            const cleanup = vi.fn();
            entity.addCleanupTask(cleanup);
            entity.destroy();

            expect(cleanup).toHaveBeenCalled();
        });

        it('unregisters entity and destroys entity', () => {
            const entityId = entity.entityId;
            entity.destroy();

            expect(world.getEntity(entityId)).toBeUndefined();
        });
    });

    // ─── destroy(immediate) ──────────────────────────────────────────

    describe('destroy(immediate)', () => {
        it('emits destroying event with immediate flag', () => {
            const mockEventBus = {
                emit: vi.fn(),
                on: vi.fn().mockReturnValue(() => {}),
            };
            (entity as any)._eventBus = mockEventBus;

            entity.destroy(true);

            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'entity:destroying',
                expect.objectContaining({ immediate: true })
            );
        });
    });

    // ─── Property setters on destroyed entity ─────────────────────────

    describe('property setters on destroyed entity', () => {
        it('name setter throws EntityLifecycleError', () => {
            entity.destroy();
            expect(() => {
                entity.name = 'New';
            }).toThrow(EntityLifecycleError);
        });

        it('layer setter throws EntityLifecycleError', () => {
            entity.destroy();
            expect(() => {
                entity.layer = 5;
            }).toThrow(EntityLifecycleError);
        });

        it('tag setter throws EntityLifecycleError', () => {
            entity.destroy();
            expect(() => {
                entity.tag = 'new';
            }).toThrow(EntityLifecycleError);
        });
    });

    // ─── on() without event bus ──────────────────────────────────────

    describe('on() without event bus', () => {
        it('returns no-op disposer and warns', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            (entity as any)._eventBus = null;

            const dispose = entity.on('test', () => {});
            expect(typeof dispose).toBe('function');
            expect(() => dispose()).not.toThrow();
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
        });
    });

    // ─── toString ────────────────────────────────────────────────────

    describe('toString', () => {
        it('includes entity id, component names, and state', () => {
            entity.addComponent(TestComponent, 10, 'test');
            const str = entity.toString();

            expect(str).toContain(entity.id);
            expect(str).toContain('TestComponent');
            expect(str).toContain('active');
        });
    });

    describe('revision tracking', () => {
        it('increments when components or active state change', () => {
            const initial = entity.revision;

            const component = entity.addComponent(TestComponent, 10, 'revision');
            const afterAdd = entity.revision;
            expect(afterAdd).toBeGreaterThan(initial);

            entity.removeComponent(TestComponent);
            expect(entity.revision).toBeGreaterThan(afterAdd);

            const afterRemove = entity.revision;
            entity.active = false;
            expect(entity.revision).toBeGreaterThan(afterRemove);

            entity.active = false;
            const afterSameActive = entity.revision;
            entity.active = true;
            expect(entity.revision).toBeGreaterThan(afterSameActive);

            expect(component).toBeDefined();
        });
    });
});
