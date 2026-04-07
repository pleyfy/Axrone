import { beforeEach, describe, expect, it } from 'vitest';
import { Archetype } from '../../component-system/archetype/archetype';
import { Component } from '../../component-system/core/component';
import type {
    ComponentRegistry,
    ArchetypeSignature,
    BitMask,
    ComponentMask,
} from '../../component-system/types/core';

class TestComponent extends Component {
    value: number = 0;

    constructor(value: number = 0) {
        super();
        this.value = value;
    }
}

class PositionComponent extends Component {
    x: number = 0;
    y: number = 0;

    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

class VelocityComponent extends Component {
    dx: number = 0;
    dy: number = 0;

    constructor(dx: number = 0, dy: number = 0) {
        super();
        this.dx = dx;
        this.dy = dy;
    }
}

describe('Archetype', () => {
    let registry: ComponentRegistry;
    let componentMask: ComponentMask;
    let archetype: Archetype<any>;

    beforeEach(() => {
        registry = {
            TestComponent,
            PositionComponent,
            VelocityComponent,
        };

        componentMask = new Map([
            ['TestComponent', 1],
            ['PositionComponent', 2],
            ['VelocityComponent', 4],
        ]);
    });

    describe('initialization', () => {
        it('should initialize empty archetype correctly', () => {
            const signature: ArchetypeSignature = [];
            const mask: BitMask = 0n;

            archetype = new Archetype(signature, mask, registry, componentMask);

            expect(archetype.id).toBe('EMPTY');
            expect(archetype.signature).toEqual([]);
            expect(archetype.mask).toBe(0n);
            expect(archetype.entityCount).toBe(0);
            expect(archetype.entities).toEqual([]);
            expect(archetype.components.size).toBe(0);
        });

        it('should initialize single component archetype correctly', () => {
            const signature: ArchetypeSignature = ['TestComponent'];
            const mask: BitMask = 1n;

            archetype = new Archetype(signature, mask, registry, componentMask);

            expect(archetype.id).toBe('TestComponent');
            expect(archetype.signature).toEqual(['TestComponent']);
            expect(archetype.mask).toBe(1n);
            expect(archetype.entityCount).toBe(0);
            expect(archetype.components.has('TestComponent')).toBe(true);
            expect(archetype.components.size).toBe(1);
        });

        it('should initialize multi-component archetype correctly', () => {
            const signature: ArchetypeSignature = ['PositionComponent', 'VelocityComponent'];
            const mask: BitMask = 6n;

            archetype = new Archetype(signature, mask, registry, componentMask);

            expect(archetype.id).toBe('PositionComponent|VelocityComponent');
            expect(archetype.signature).toEqual(['PositionComponent', 'VelocityComponent']);
            expect(archetype.mask).toBe(6n);
            expect(archetype.components.has('PositionComponent')).toBe(true);
            expect(archetype.components.has('VelocityComponent')).toBe(true);
            expect(archetype.components.size).toBe(2);
        });
    });

    describe('entity management', () => {
        beforeEach(() => {
            const signature: ArchetypeSignature = ['TestComponent', 'PositionComponent'];
            const mask: BitMask = 3n;
            archetype = new Archetype(signature, mask, registry, componentMask);
        });

        it('should add entity correctly', () => {
            const entity = 1 as any;
            const components = {
                TestComponent: new TestComponent(10),
                PositionComponent: new PositionComponent(5, 15),
            };

            archetype.addEntity(entity, components);

            expect(archetype.entityCount).toBe(1);
            expect(archetype.entities[0]).toBe(entity);
            expect(archetype.hasEntity(entity)).toBe(true);

            const testComp = archetype.getComponent<TestComponent>(entity, 'TestComponent');
            const posComp = archetype.getComponent<PositionComponent>(entity, 'PositionComponent');

            expect(testComp?.value).toBe(10);
            expect(posComp?.x).toBe(5);
            expect(posComp?.y).toBe(15);
        });

        it('should add multiple entities correctly', () => {
            const entity1 = 1 as any;
            const entity2 = 2 as any;

            archetype.addEntity(entity1, {
                TestComponent: new TestComponent(100),
                PositionComponent: new PositionComponent(10, 20),
            });

            archetype.addEntity(entity2, {
                TestComponent: new TestComponent(200),
                PositionComponent: new PositionComponent(30, 40),
            });

            expect(archetype.entityCount).toBe(2);
            expect(archetype.hasEntity(entity1)).toBe(true);
            expect(archetype.hasEntity(entity2)).toBe(true);

            const testComp1 = archetype.getComponent<TestComponent>(entity1, 'TestComponent');
            const testComp2 = archetype.getComponent<TestComponent>(entity2, 'TestComponent');

            expect(testComp1?.value).toBe(100);
            expect(testComp2?.value).toBe(200);
        });

        it('should remove entity correctly', () => {
            const entity1 = 1 as any;
            const entity2 = 2 as any;

            archetype.addEntity(entity1, {
                TestComponent: new TestComponent(100),
                PositionComponent: new PositionComponent(10, 20),
            });

            archetype.addEntity(entity2, {
                TestComponent: new TestComponent(200),
                PositionComponent: new PositionComponent(30, 40),
            });

            const removedComponents = archetype.removeEntity(entity1);

            expect(archetype.entityCount).toBe(1);
            expect(archetype.hasEntity(entity1)).toBe(false);
            expect(archetype.hasEntity(entity2)).toBe(true);

            expect(removedComponents.TestComponent?.value).toBe(100);
            expect(removedComponents.PositionComponent?.x).toBe(10);

            const testComp2 = archetype.getComponent<TestComponent>(entity2, 'TestComponent');
            expect(testComp2?.value).toBe(200);
        });

        it('should handle removing non-existent entity', () => {
            const entity = 999 as any;

            const removedComponents = archetype.removeEntity(entity);

            expect(removedComponents).toEqual({});
            expect(archetype.entityCount).toBe(0);
        });

        it('should maintain entity order after removal', () => {
            const entities = [1, 2, 3, 4, 5].map((i) => i as any);

            entities.forEach((entity, index) => {
                archetype.addEntity(entity, {
                    TestComponent: new TestComponent(index * 10),
                    PositionComponent: new PositionComponent(index, index * 2),
                });
            });

            archetype.removeEntity(entities[2]);

            expect(archetype.entityCount).toBe(4);
            expect(archetype.hasEntity(entities[2])).toBe(false);

            expect(archetype.hasEntity(entities[0])).toBe(true);
            expect(archetype.hasEntity(entities[1])).toBe(true);
            expect(archetype.hasEntity(entities[3])).toBe(true);
            expect(archetype.hasEntity(entities[4])).toBe(true);
        });
    });

    describe('component access', () => {
        beforeEach(() => {
            const signature: ArchetypeSignature = ['TestComponent', 'PositionComponent'];
            const mask: BitMask = 3n;
            archetype = new Archetype(signature, mask, registry, componentMask);
        });

        it('should get component correctly', () => {
            const entity = 1 as any;
            const testComponent = new TestComponent(42);

            archetype.addEntity(entity, {
                TestComponent: testComponent,
                PositionComponent: new PositionComponent(1, 2),
            });

            const retrieved = archetype.getComponent<TestComponent>(entity, 'TestComponent');
            expect(retrieved).toBe(testComponent);
            expect(retrieved?.value).toBe(42);
        });

        it('should return undefined for non-existent component', () => {
            const entity = 1 as any;

            archetype.addEntity(entity, {
                TestComponent: new TestComponent(10),
                PositionComponent: new PositionComponent(1, 2),
            });

            const nonExistent = archetype.getComponent(entity, 'VelocityComponent');
            expect(nonExistent).toBeUndefined();
        });

        it('should return undefined for non-existent entity', () => {
            const nonExistentEntity = 999 as any;

            const component = archetype.getComponent(nonExistentEntity, 'TestComponent');
            expect(component).toBeUndefined();
        });

        it('should handle component access correctly', () => {
            const entity = 1 as any;

            archetype.addEntity(entity, {
                TestComponent: new TestComponent(10),
                PositionComponent: new PositionComponent(1, 2),
            });

            const testComp = archetype.getComponent<TestComponent>(entity, 'TestComponent');
            const posComp = archetype.getComponent<PositionComponent>(entity, 'PositionComponent');

            expect(testComp?.value).toBe(10);
            expect(posComp?.x).toBe(1);
            expect(posComp?.y).toBe(2);
        });
    });

    describe('archetype transitions', () => {
        beforeEach(() => {
            const signature: ArchetypeSignature = ['TestComponent'];
            const mask: BitMask = 1n;
            archetype = new Archetype(signature, mask, registry, componentMask);
        });

        it('should manage archetype edges correctly', () => {
            const targetArchetypeId = 'TestComponent|PositionComponent' as any;

            archetype.edges.set('add:PositionComponent', targetArchetypeId);

            expect(archetype.edges.has('add:PositionComponent')).toBe(true);
            expect(archetype.edges.get('add:PositionComponent')).toBe(targetArchetypeId);
        });

        it('should handle edge removal', () => {
            const targetArchetypeId = 'TestComponent|PositionComponent' as any;

            archetype.edges.set('add:PositionComponent', targetArchetypeId);
            archetype.edges.delete('add:PositionComponent');

            expect(archetype.edges.has('add:PositionComponent')).toBe(false);
        });
    });

    describe('performance and memory', () => {
        beforeEach(() => {
            const signature: ArchetypeSignature = ['TestComponent', 'PositionComponent'];
            const mask: BitMask = 3n;
            archetype = new Archetype(signature, mask, registry, componentMask);
        });

        it('should handle many entities efficiently', () => {
            const entityCount = 1000;
            const startTime = performance.now();

            for (let i = 0; i < entityCount; i++) {
                archetype.addEntity(i as any, {
                    TestComponent: new TestComponent(i),
                    PositionComponent: new PositionComponent(i, i * 2),
                });
            }

            const endTime = performance.now();

            expect(archetype.entityCount).toBe(entityCount);
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should handle rapid add/remove operations', () => {
            const operations = 100;
            const startTime = performance.now();

            for (let i = 0; i < operations; i++) {
                const entity = i as any;

                archetype.addEntity(entity, {
                    TestComponent: new TestComponent(i),
                    PositionComponent: new PositionComponent(i, i),
                });

                if (i % 2 === 0) {
                    archetype.removeEntity(entity);
                }
            }

            const endTime = performance.now();

            expect(endTime - startTime).toBeLessThan(50);
            expect(archetype.entityCount).toBe(operations / 2);
        });

        it('should maintain component pool integrity', () => {
            const entities = [1, 2, 3].map((i) => i as any);

            entities.forEach((entity, index) => {
                archetype.addEntity(entity, {
                    TestComponent: new TestComponent(index * 10),
                    PositionComponent: new PositionComponent(index, index),
                });
            });

            entities.forEach((entity, index) => {
                const testComp = archetype.getComponent<TestComponent>(entity, 'TestComponent');
                const posComp = archetype.getComponent<PositionComponent>(
                    entity,
                    'PositionComponent'
                );

                expect(testComp?.value).toBe(index * 10);
                expect(posComp?.x).toBe(index);
                expect(posComp?.y).toBe(index);
            });

            archetype.removeEntity(entities[1]);

            const testComp0 = archetype.getComponent<TestComponent>(entities[0], 'TestComponent');
            const testComp2 = archetype.getComponent<TestComponent>(entities[2], 'TestComponent');

            expect(testComp0?.value).toBe(0);
            expect(testComp2?.value).toBe(20);
        });
    });

    describe('edge cases', () => {
        it('should handle archetype with no components', () => {
            const signature: ArchetypeSignature = [];
            const mask: BitMask = 0n;
            archetype = new Archetype(signature, mask, registry, componentMask);

            const entity = 1 as any;
            archetype.addEntity(entity, {});

            expect(archetype.entityCount).toBe(1);
            expect(archetype.hasEntity(entity)).toBe(true);

            const removed = archetype.removeEntity(entity);
            expect(removed).toEqual({});
            expect(archetype.entityCount).toBe(0);
        });

        it('should handle component pool edge cases', () => {
            const signature: ArchetypeSignature = ['TestComponent'];
            const mask: BitMask = 1n;
            archetype = new Archetype(signature, mask, registry, componentMask);

            const entity = 1 as any;

            archetype.addEntity(entity, {});

            const component = archetype.getComponent<TestComponent>(entity, 'TestComponent');
            expect(component).toBeDefined();
            expect(component?.value).toBe(0);
        });

        it('should handle invalid component names gracefully', () => {
            const signature: ArchetypeSignature = ['TestComponent'];
            const mask: BitMask = 1n;
            archetype = new Archetype(signature, mask, registry, componentMask);

            const entity = 1 as any;
            archetype.addEntity(entity, {
                TestComponent: new TestComponent(10),
            });

            const invalidComponent = archetype.getComponent(entity, 'InvalidComponent');
            expect(invalidComponent).toBeUndefined();
        });
    });

    describe('archetype signature and mask', () => {
        it('should generate correct signature for complex archetype', () => {
            const signature: ArchetypeSignature = [
                'TestComponent',
                'PositionComponent',
                'VelocityComponent',
            ];
            const mask: BitMask = 7n;
            archetype = new Archetype(signature, mask, registry, componentMask);

            expect(archetype.id).toBe('TestComponent|PositionComponent|VelocityComponent');
            expect(archetype.signature).toEqual([
                'TestComponent',
                'PositionComponent',
                'VelocityComponent',
            ]);
            expect(archetype.mask).toBe(7n);
        });

        it('should handle signature order consistency', () => {
            const signature1: ArchetypeSignature = ['TestComponent', 'PositionComponent'];
            const signature2: ArchetypeSignature = ['PositionComponent', 'TestComponent'];
            const mask: BitMask = 3n;

            const archetype1 = new Archetype(signature1, mask, registry, componentMask);
            const archetype2 = new Archetype(signature2, mask, registry, componentMask);

            expect(archetype1.id).toBe('TestComponent|PositionComponent');
            expect(archetype2.id).toBe('PositionComponent|TestComponent');
            expect(archetype1.id).not.toBe(archetype2.id);
        });
    });
});
