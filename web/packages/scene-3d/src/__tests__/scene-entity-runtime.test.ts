import { describe, expect, it } from 'vitest';
import { Component, script } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { SceneEntityRuntime } from '@axrone/scene-3d';
import { SceneComponentCatalog } from '@axrone/scene-3d';

class PulseComponent extends Component {}

@script({
    scriptName: 'SceneEntityAlias',
})
class AliasedComponent extends Component {
    value = 0;

    serialize(): Record<string, unknown> {
        return {
            value: this.value,
        };
    }

    deserialize(data: Record<string, unknown>): void {
        this.value = typeof data.value === 'number' ? data.value : 0;
    }
}

const createEntityRuntime = () => {
    const registry = createSceneRegistry({
        registry: {
            AliasedComponent,
        },
    });
    const world = new World(registry);
    const componentCatalog = new SceneComponentCatalog(registry);
    return new SceneEntityRuntime({
        world,
        componentCatalog,
    });
};

describe('SceneEntityRuntime', () => {
    it('registers components through the shared world boundary', () => {
        const runtime = createEntityRuntime();

        runtime.registerComponent(PulseComponent);

        expect(runtime.isComponentRegistered(PulseComponent)).toBe(true);
        expect(runtime.getRegisteredComponentNames()).toContain('PulseComponent');
    });

    it('creates plain entities through the core entity service boundary', () => {
        const runtime = createEntityRuntime();

        const entity = runtime.createEntity({
            name: 'PlainEntity',
        });

        expect(entity.name).toBe('PlainEntity');
        expect(entity.started).toBe(true);
    });

    it('owns prefab creation and instantiation without leaking catalog details', () => {
        const runtime = createEntityRuntime();
        runtime.registerComponent(AliasedComponent);
        const entity = runtime.createEntity({ name: 'Aliased' });
        entity.addComponent(AliasedComponent).value = 42;

        const prefab = runtime.createPrefab('aliased-prefab', [entity]);
        const [instantiated] = runtime.instantiatePrefab(prefab, {
            namePrefix: 'Copy ',
        });
        const aliasedSnapshot = prefab.entities[0]?.components.find(
            (component) => component.type === 'SceneEntityAlias'
        );

        expect(aliasedSnapshot?.type).toBe('SceneEntityAlias');
        expect(instantiated?.name).toBe('Copy Aliased');
        expect(instantiated?.getComponent(AliasedComponent)?.value).toBe(42);
    });
});
