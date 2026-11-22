import { afterEach, describe, expect, it } from 'vitest';
import { Actor, Component, Hierarchy, Transform, World } from '@axrone/ecs-runtime';
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

    it('advances on entity and actor creation and destruction', () => {
        world = createWorld();
        const start = world.renderRevision;

        const actor = new Actor(world, { name: 'Created' });
        const afterCreate = world.renderRevision;
        expect(afterCreate).not.toBe(start);

        actor.destroy();
        expect(world.renderRevision).not.toBe(afterCreate);
    });

    it('advances when a component mutator touches its revision', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Mover' });
        const transform = actor.requireComponent(Transform);
        const before = world.renderRevision;

        transform.position = new Vec3(1, 2, 3);

        expect(world.renderRevision).not.toBe(before);
    });

    it('stays put when a setter writes an unchanged value (no touch)', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Still' });
        const transform = actor.requireComponent(Transform);
        transform.position = new Vec3(1, 2, 3);
        const before = world.renderRevision;

        transform.position = new Vec3(1, 2, 3);

        expect(world.renderRevision).toBe(before);
    });

    it('advances on component add and remove', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Mutating' });
        const beforeAdd = world.renderRevision;

        actor.addComponent(RevisionProbe);
        expect(world.renderRevision).not.toBe(beforeAdd);

        const beforeRemove = world.renderRevision;
        actor.removeComponent(RevisionProbe);
        expect(world.renderRevision).not.toBe(beforeRemove);
    });

    it('advances on actor active-state changes only when the value changes', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Toggle' });
        const before = world.renderRevision;

        actor.active = false;
        const afterDisable = world.renderRevision;
        expect(afterDisable).not.toBe(before);

        actor.active = false;
        expect(world.renderRevision).toBe(afterDisable);

        actor.active = true;
        expect(world.renderRevision).not.toBe(afterDisable);
    });

    it('does not advance on reads', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Reader' });
        const before = world.renderRevision;

        actor.getComponent(Transform);
        actor.hasComponent(RevisionProbe);
        actor.name;
        actor.active;
        actor.revision;
        void actor.requireComponent(Transform).revision;
        world.getAllActors();
        world.getComponent(actor.entity, 'Transform');

        expect(world.renderRevision).toBe(before);
    });

    it('ignores components that are not attached to an actor in this world', () => {
        world = createWorld();
        const before = world.renderRevision;

        const detached = new RevisionProbe();
        detached.setValue(1);

        expect(detached.revision).toBeGreaterThan(0);
        expect(world.renderRevision).toBe(before);
    });

    it('stops tracking a component once it is removed from its actor', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Detaching' });
        const probe = actor.addComponent(RevisionProbe);
        probe.setValue(1);
        const before = world.renderRevision;

        actor.removeComponent(RevisionProbe);
        const afterRemove = world.renderRevision;
        expect(afterRemove).not.toBe(before);

        probe.setValue(2);
        expect(world.renderRevision).toBe(afterRemove);
    });

    it('covers the preloaded component path used by bulk creation', () => {
        world = createWorld();
        const actor = Actor.createWithComponents(world, { name: 'Preloaded' }, [
            { componentType: Hierarchy, component: new Hierarchy() },
            { componentType: Transform, component: new Transform() },
            { componentType: RevisionProbe, component: new RevisionProbe() },
        ]);

        const transform = actor.requireComponent(Transform);
        const before = world.renderRevision;
        transform.setLocalTRS2D(4, 5, 0.25, 2, 2);
        expect(world.renderRevision).not.toBe(before);

        const probe = actor.requireComponent(RevisionProbe);
        const beforeProbe = world.renderRevision;
        probe.setValue(9);
        expect(world.renderRevision).not.toBe(beforeProbe);
    });

    it('reports a stable clock object shared with attached components', () => {
        world = createWorld();
        const actor = new Actor(world, { name: 'Clock' });
        const clock = world.renderMutationClock;

        expect(clock).toBe(world.renderMutationClock);
        expect(clock.value).toBe(world.renderRevision);

        actor.requireComponent(Transform).position = new Vec3(0, 1, 0);
        expect(clock.value).toBe(world.renderRevision);
        expect(world.renderRevision).toBeGreaterThan(0);
    });
});
