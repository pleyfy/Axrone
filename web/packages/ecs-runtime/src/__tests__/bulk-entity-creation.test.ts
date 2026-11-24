import { afterEach, describe, expect, it } from 'vitest';
import { Entity, Component, Hierarchy, Transform, World } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';

class BulkProbe extends Component {
    value = 0;

    constructor(value = 0) {
        super();
        this.value = value;
    }
}

const createWorld = () =>
    new World({
        Hierarchy,
        Transform,
        BulkProbe,
    } as any);

describe('Bulk entity creation', () => {
    let world: World<any>;

    afterEach(() => {
        if (world && !world.isDisposed) {
            world.clear();
        }
    });

    it('creates every entity in one archetype', () => {
        world = createWorld();
        const archetypesBefore = world.getArchetypeCount();

        const entities = world.createEntitiesWithComponentsBulk([
            { Hierarchy: new Hierarchy(), Transform: new Transform(), BulkProbe: new BulkProbe(1) },
            { Hierarchy: new Hierarchy(), Transform: new Transform(), BulkProbe: new BulkProbe(2) },
            { Hierarchy: new Hierarchy(), Transform: new Transform(), BulkProbe: new BulkProbe(3) },
        ]);

        expect(entities).toHaveLength(3);
        expect(new Set(entities).size).toBe(3);
        // One archetype for the whole batch.
        expect(world.getArchetypeCount()).toBe(archetypesBefore + 1);
        expect(world.getComponent(entities[1]!, 'BulkProbe')).toBeInstanceOf(BulkProbe);
        expect((world.getComponent(entities[1]!, 'BulkProbe') as BulkProbe).value).toBe(2);
    });

    it('rejects sets that do not share the first signature', () => {
        world = createWorld();

        expect(() =>
            world.createEntitiesWithComponentsBulk([
                { Hierarchy: new Hierarchy(), Transform: new Transform() },
                { Hierarchy: new Hierarchy() },
            ])
        ).toThrow(/shared component signature/);

        expect(() =>
            world.createEntitiesWithComponentsBulk([
                { Hierarchy: new Hierarchy(), Transform: new Transform() },
                { Hierarchy: new Hierarchy(), BulkProbe: new BulkProbe() },
            ])
        ).toThrow(/shared component signature/);

        // Nothing was created by the rejected batches.
        expect(world.getEntityCount()).toBe(0);
    });

    it('creates real entities with lifecycle, identity and component access', () => {
        world = createWorld();
        let started = 0;

        class CountingProbe extends BulkProbe {
            override start(): void {
                started += 1;
            }
        }

        const configs = [{ name: 'A' }, { name: 'B' }];
        const componentsPerEntity = configs.map((_, index) => [
            { componentType: Hierarchy, componentName: 'Hierarchy', component: new Hierarchy() },
            { componentType: Transform, componentName: 'Transform', component: new Transform() },
            {
                componentType: BulkProbe,
                componentName: 'BulkProbe',
                component: new CountingProbe(index),
            },
        ]);

        const entities = Entity.createManyWithComponents(world, configs, componentsPerEntity);

        expect(entities).toHaveLength(2);
        expect(entities[0]!.id).not.toBe(entities[1]!.id);
        expect(entities[0]!.entityId).not.toBe(entities[1]!.entityId);
        expect(entities.every((entity) => entity.active && entity.started)).toBe(true);
        expect(started).toBe(2);
        expect(entities[1]!.requireComponent(BulkProbe).value).toBe(1);
        expect(world.getAllEntityIds()).toHaveLength(2);

        // Transforms are real, attached instances and mutate normally.
        const transform = entities[0]!.requireComponent(Transform);
        transform.position = new Vec3(3, 4, 0);
        expect(transform.worldPosition.x).toBe(3);
        expect((transform as any).entity).toBe(entities[0]);

        // The render revision moved for the whole batch.
        expect(world.renderRevision).toBeGreaterThan(0);
    });

    it('emits EntityCreated per entity and component Added events for its components', () => {
        world = createWorld();
        const created: number[] = [];
        const probeAdded: number[] = [];
        const transformAdded: number[] = [];
        world.on('EntityCreated' as any, (data: any) => created.push(data.entityId));
        world.on('BulkProbeAdded' as any, (data: any) => probeAdded.push(data.entityId));
        world.on('TransformAdded' as any, (data: any) => transformAdded.push(data.entityId));

        const configs = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
        const componentsPerEntity = configs.map(() => [
            { componentType: Hierarchy, componentName: 'Hierarchy', component: new Hierarchy() },
            { componentType: Transform, componentName: 'Transform', component: new Transform() },
            { componentType: BulkProbe, componentName: 'BulkProbe', component: new BulkProbe() },
        ]);

        const entities = Entity.createManyWithComponents(world, configs, componentsPerEntity);
        const entityIds = entities.map((entity) => entity.entityId);

        expect(created).toEqual(entityIds);
        expect(probeAdded).toEqual(entities);
        expect(transformAdded).toEqual(entities);
    });

    it('rejects mismatched config/component-set counts', () => {
        world = createWorld();

        expect(() => Entity.createManyWithComponents(world, [{ name: 'A' }], [])).toThrow(
            /one component set per entity config/
        );
        expect(Entity.createManyWithComponents(world, [], [])).toEqual([]);
    });
});
