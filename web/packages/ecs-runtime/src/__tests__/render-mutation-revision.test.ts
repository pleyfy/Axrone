import { afterEach, describe, expect, it } from 'vitest';
import { Entity, Component, Hierarchy, Transform, World } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';

/**
 * A component with the same contract as the engine's renderable components:
 * every mutator that can affect rendering calls `touch()`.
 */
class RevisionProbe extends Component {
    value = 0;

    setValue(value: number): void {
        this.value = value;
        this.touch();
    }
}

const createWorld = () =>
    new World({
        Hierarchy,
        Transform,
        RevisionProbe,
    } as any);

describe('World render mutation revision', () => {
    let world: World<any>;

    afterEach(() => {
        if (world && !world.isDisposed) {
            world.clear();
        }
    });

    it('advances on entity and entity creation and destruction', () => {
        world = createWorld();
        const start = world.renderRevision;

        const entity = new Entity(world, { name: 'Created' });
        const afterCreate = world.renderRevision;
        expect(afterCreate).not.toBe(start);

        entity.destroy();
        expect(world.renderRevision).not.toBe(afterCreate);
    });

    it('advances when a component mutator touches its revision', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Mover' });
        const transform = entity.requireComponent(Transform);
        const before = world.renderRevision;

        transform.position = new Vec3(1, 2, 3);

        expect(world.renderRevision).not.toBe(before);
    });

    it('stays put when a setter writes an unchanged value (no touch)', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Still' });
        const transform = entity.requireComponent(Transform);
        transform.position = new Vec3(1, 2, 3);
        const before = world.renderRevision;

        transform.position = new Vec3(1, 2, 3);

        expect(world.renderRevision).toBe(before);
    });

    it('advances on component add and remove', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Mutating' });
        const beforeAdd = world.renderRevision;

        entity.addComponent(RevisionProbe);
        expect(world.renderRevision).not.toBe(beforeAdd);

        const beforeRemove = world.renderRevision;
        entity.removeComponent(RevisionProbe);
        expect(world.renderRevision).not.toBe(beforeRemove);
    });

    it('advances on entity active-state changes only when the value changes', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Toggle' });
        const before = world.renderRevision;

        entity.active = false;
        const afterDisable = world.renderRevision;
        expect(afterDisable).not.toBe(before);

        entity.active = false;
        expect(world.renderRevision).toBe(afterDisable);

        entity.active = true;
        expect(world.renderRevision).not.toBe(afterDisable);
    });

    it('does not advance on reads', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Reader' });
        const before = world.renderRevision;

        entity.getComponent(Transform);
        entity.hasComponent(RevisionProbe);
        entity.name;
        entity.active;
        entity.revision;
        void entity.requireComponent(Transform).revision;
        world.getAllEntityIds();
        world.getComponent(entity.entityId, 'Transform');

        expect(world.renderRevision).toBe(before);
    });

    it('ignores components that are not attached to an entity in this world', () => {
        world = createWorld();
        const before = world.renderRevision;

        const detached = new RevisionProbe();
        detached.setValue(1);

        expect(detached.revision).toBeGreaterThan(0);
        expect(world.renderRevision).toBe(before);
    });

    it('stops tracking a component once it is removed from its entity', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Detaching' });
        const probe = entity.addComponent(RevisionProbe);
        probe.setValue(1);
        const before = world.renderRevision;

        entity.removeComponent(RevisionProbe);
        const afterRemove = world.renderRevision;
        expect(afterRemove).not.toBe(before);

        probe.setValue(2);
        expect(world.renderRevision).toBe(afterRemove);
    });

    it('covers the preloaded component path used by bulk creation', () => {
        world = createWorld();
        const entity = Entity.createWithComponents(world, { name: 'Preloaded' }, [
            { componentType: Hierarchy, component: new Hierarchy() },
            { componentType: Transform, component: new Transform() },
            { componentType: RevisionProbe, component: new RevisionProbe() },
        ]);

        const transform = entity.requireComponent(Transform);
        const before = world.renderRevision;
        transform.setLocalTRS2D(4, 5, 0.25, 2, 2);
        expect(world.renderRevision).not.toBe(before);

        const probe = entity.requireComponent(RevisionProbe);
        const beforeProbe = world.renderRevision;
        probe.setValue(9);
        expect(world.renderRevision).not.toBe(beforeProbe);
    });

    it('reports a stable clock object shared with attached components', () => {
        world = createWorld();
        const entity = new Entity(world, { name: 'Clock' });
        const clock = world.renderMutationClock;

        expect(clock).toBe(world.renderMutationClock);
        expect(clock.value).toBe(world.renderRevision);

        entity.requireComponent(Transform).position = new Vec3(0, 1, 0);
        expect(clock.value).toBe(world.renderRevision);
        expect(world.renderRevision).toBeGreaterThan(0);
    });
});
