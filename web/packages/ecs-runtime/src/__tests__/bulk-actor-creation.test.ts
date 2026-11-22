import { afterEach, describe, expect, it } from 'vitest';
import { Actor, Component, Hierarchy, Transform, World } from '@axrone/ecs-runtime';
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

describe('Bulk actor creation', () => {
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

    it('creates real actors with lifecycle, identity and component access', () => {
        world = createWorld();
        let started = 0;

        class CountingProbe extends BulkProbe {
            override start(): void {
                started += 1;
            }
        }

        const configs = [{ name: 'A' }, { name: 'B' }];
        const componentsPerActor = configs.map((_, index) => [
            { componentType: Hierarchy, componentName: 'Hierarchy', component: new Hierarchy() },
            { componentType: Transform, componentName: 'Transform', component: new Transform() },
            {
                componentType: BulkProbe,
                componentName: 'BulkProbe',
                component: new CountingProbe(index),
            },
        ]);

        const actors = Actor.createManyWithComponents(world, configs, componentsPerActor);

        expect(actors).toHaveLength(2);
        expect(actors[0]!.id).not.toBe(actors[1]!.id);
        expect(actors[0]!.entity).not.toBe(actors[1]!.entity);
        expect(actors.every((actor) => actor.active && actor.started)).toBe(true);
        expect(started).toBe(2);
        expect(actors[1]!.requireComponent(BulkProbe).value).toBe(1);
        expect(world.getAllActors()).toHaveLength(2);

        // Transforms are real, attached instances and mutate normally.
        const transform = actors[0]!.requireComponent(Transform);
        transform.position = new Vec3(3, 4, 0);
        expect(transform.worldPosition.x).toBe(3);
        expect(transform.actor).toBe(actors[0]);

        // The render revision moved for the whole batch.
        expect(world.renderRevision).toBeGreaterThan(0);
    });

    it('emits EntityCreated per actor and component Added events for its components', () => {
        world = createWorld();
        const created: number[] = [];
        const probeAdded: number[] = [];
        const transformAdded: number[] = [];
        world.on('EntityCreated' as any, (data: any) => created.push(data.entity));
        world.on('BulkProbeAdded' as any, (data: any) => probeAdded.push(data.entity));
        world.on('TransformAdded' as any, (data: any) => transformAdded.push(data.entity));

        const configs = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
        const componentsPerActor = configs.map(() => [
            { componentType: Hierarchy, componentName: 'Hierarchy', component: new Hierarchy() },
            { componentType: Transform, componentName: 'Transform', component: new Transform() },
            { componentType: BulkProbe, componentName: 'BulkProbe', component: new BulkProbe() },
        ]);

        const actors = Actor.createManyWithComponents(world, configs, componentsPerActor);
        const entities = actors.map((actor) => actor.entity);

        expect(created).toEqual(entities);
        expect(probeAdded).toEqual(entities);
        expect(transformAdded).toEqual(entities);
    });

    it('rejects mismatched config/component-set counts', () => {
        world = createWorld();

        expect(() => Actor.createManyWithComponents(world, [{ name: 'A' }], [])).toThrow(
            /one component set per actor config/
        );
        expect(Actor.createManyWithComponents(world, [], [])).toEqual([]);
    });
});
