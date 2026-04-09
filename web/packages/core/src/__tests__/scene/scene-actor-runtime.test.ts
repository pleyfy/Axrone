import { describe, expect, it } from 'vitest';
import { Component, script } from '../../component-system/core/component';
import { World } from '../../component-system/core/world';
import { createSceneRegistry } from '../../scene';
import { SceneActorRuntime } from '../../scene/scene-actor-runtime';
import { SceneComponentCatalog } from '../../scene/component-catalog';

class PulseComponent extends Component {}

@script({
    scriptName: 'SceneActorAlias',
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

const createActorRuntime = () => {
    const registry = createSceneRegistry({
        registry: {
            AliasedComponent,
        },
    });
    const world = new World(registry);
    const componentCatalog = new SceneComponentCatalog(registry);
    return new SceneActorRuntime({
        world,
        componentCatalog,
    });
};

describe('SceneActorRuntime', () => {
    it('registers components through the shared world boundary', () => {
        const runtime = createActorRuntime();

        runtime.registerComponent(PulseComponent);

        expect(runtime.isComponentRegistered(PulseComponent)).toBe(true);
        expect(runtime.getRegisteredComponentNames()).toContain('PulseComponent');
    });

    it('creates plain actors through the core actor service boundary', () => {
        const runtime = createActorRuntime();

        const actor = runtime.createActor({
            name: 'PlainActor',
        });

        expect(actor.name).toBe('PlainActor');
        expect(actor.started).toBe(true);
    });

    it('owns prefab creation and instantiation without leaking catalog details', () => {
        const runtime = createActorRuntime();
        runtime.registerComponent(AliasedComponent);
        const actor = runtime.createActor({ name: 'Aliased' });
        actor.addComponent(AliasedComponent).value = 42;

        const prefab = runtime.createPrefab('aliased-prefab', [actor]);
        const [instantiated] = runtime.instantiatePrefab(prefab, {
            namePrefix: 'Copy ',
        });
        const aliasedSnapshot = prefab.actors[0]?.components.find(
            (component) => component.type === 'SceneActorAlias'
        );

        expect(aliasedSnapshot?.type).toBe('SceneActorAlias');
        expect(instantiated?.name).toBe('Copy Aliased');
        expect(instantiated?.getComponent(AliasedComponent)?.value).toBe(42);
    });
});
