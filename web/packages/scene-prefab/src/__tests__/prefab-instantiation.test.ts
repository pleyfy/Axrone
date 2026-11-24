import { describe, expect, it, beforeEach } from 'vitest';
import {
    Entity,
    Component,
    Hierarchy,
    Transform,
    World,
    property,
    script,
} from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { PrefabNodeBinding } from '../prefab-node-binding';
import { ScenePrefabWorkflow } from '../scene-prefab-workflow';
import { SceneEntityRuntime, createSceneRegistry } from '@axrone/scene-runtime';
import { SceneComponentCatalog } from '@axrone/scene-runtime/component-catalog';
import { encodeSceneValue } from '@axrone/scene-runtime/serialization';
import type {
    SceneEntitySnapshot,
    SceneComponentSnapshot,
    ScenePrefabDefinition,
} from '../types';

// ─── Test fixture components ───────────────────────────────────────────────

@script({ scriptName: 'TestHealth' })
class TestHealth extends Component {
    @property({ type: 'number' })
    public maxHealth = 100;

    @property({ type: 'number' })
    public currentHealth = 100;

    @property({ type: 'boolean' })
    public isInvincible = false;
}

@script({ scriptName: 'TestWeapon' })
class TestWeapon extends Component {
    @property({ type: 'number' })
    public damage = 10;

    @property({ type: 'string' })
    public weaponName = 'Sword';

    @property({ type: EntityId })
    public targetEntity: EntityId | null = null;

    @property({ type: Transform })
    public targetTransform: Transform | null = null;
}

@script({ scriptName: 'TestFollowTarget' })
class TestFollowTarget extends Component {
    @property({ type: EntityId })
    public leader: EntityId | null = null;

    @property({ type: Transform })
    public leaderTransform: Transform | null = null;

    @property({ type: 'vec3' })
    public offset = new Vec3(0, 0, 0);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface PrefabTestHarness {
    readonly entityRuntime: SceneEntityRuntime<any>;
    readonly world: World<any>;
    readonly componentCatalog: SceneComponentCatalog;
}

const createPrefabTestHarness = (): PrefabTestHarness => {
    const registry = createSceneRegistry({
        registry: {
            TestHealth,
            TestWeapon,
            TestFollowTarget,
        },
    });
    const world = new World(registry);
    const componentCatalog = new SceneComponentCatalog(registry);
    const entityRuntime = new SceneEntityRuntime({
        world,
        componentCatalog,
    });

    entityRuntime.registerComponent(TestHealth);
    entityRuntime.registerComponent(TestWeapon);
    entityRuntime.registerComponent(TestFollowTarget);

    return { entityRuntime, world, componentCatalog };
};

const makeComponent = (
    type: string,
    data: unknown,
    id?: string,
): SceneComponentSnapshot => ({
    ...(id ? { id } : {}),
    type,
    data: encodeSceneValue(data),
});

const makeTransformComponent = (
    position: readonly [number, number, number] = [0, 0, 0],
    rotation: readonly [number, number, number, number] = [0, 0, 0, 1],
    scale: readonly [number, number, number] = [1, 1, 1],
): SceneComponentSnapshot =>
    makeComponent('Transform', { position, rotation, scale });

const makeEntitySnapshot = (
    nodeId: string,
    name: string,
    options: {
        parentNodeId?: string | null;
        components?: SceneComponentSnapshot[];
        active?: boolean;
        layer?: number;
        tag?: string;
    } = {},
): SceneEntitySnapshot => ({
    nodeId,
    parentNodeId: options.parentNodeId ?? null,
    name,
    layer: options.layer ?? 0,
    tag: options.tag ?? 'default',
    active: options.active ?? true,
    persistent: false,
    pooled: false,
    components: options.components ?? [makeTransformComponent()],
});

const makeSimplePrefab = (
    id = 'prefab/simple',
    entityName = 'Cube',
): ScenePrefabDefinition => ({
    id,
    kind: 'prefab',
    entities: [makeEntitySnapshot('root', entityName)],
});

// ---------------------------------------------------------------------------
// Test Group 1: Simple Prefab Instantiation (Cube-like)
// ---------------------------------------------------------------------------
describe('Prefab Instantiation — Simple Prefab', () => {
    let harness: PrefabTestHarness;

    beforeEach(() => {
        harness = createPrefabTestHarness();
    });

    it('creates an entity with the correct name from a minimal prefab', () => {
        const prefab = makeSimplePrefab('prefab/cube', 'Cube');
        const entities = harness.entityRuntime.instantiatePrefab(prefab);

        expect(entities).toHaveLength(1);
        expect(entities[0]!.name).toBe('Cube');
    });

    it('adds a Transform component to the instantiated entity', () => {
        const prefab = makeSimplePrefab();
        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const entity = entities[0]!;

        const transform = entity.getComponent(Transform);
        expect(transform).toBeDefined();
        expect(transform).toBeInstanceOf(Transform);
    });

    it('sets the entity to active after instantiation when snapshot says active', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/active-test',
            kind: 'prefab',
            entities: [makeEntitySnapshot('root', 'ActiveEntity', { active: true })],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        expect(entities[0]!.active).toBe(true);
    });

    it('sets the entity to inactive when snapshot says inactive', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/inactive-test',
            kind: 'prefab',
            entities: [makeEntitySnapshot('root', 'InactiveEntity', { active: false })],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        expect(entities[0]!.active).toBe(false);
    });

    it('attaches PrefabNodeBinding that maps nodeId to entity', () => {
        const prefab = makeSimplePrefab('prefab/binding-test', 'Bound');
        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const entity = entities[0]!;

        const binding = entity.getComponent(PrefabNodeBinding);
        expect(binding).toBeDefined();
        expect(binding!.nodeId).toBe('root');
        expect(binding!.instanceId).toBeTruthy();
    });

    it('applies namePrefix option to entity names', () => {
        const prefab = makeSimplePrefab('prefab/prefix-test', 'Enemy');
        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            namePrefix: 'Instance_1/',
        });

        expect(entities[0]!.name).toBe('Instance_1/Enemy');
    });

    it('creates multiple entities from a prefab with several entity snapshots', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/multi',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('node-a', 'EntityA'),
                makeEntitySnapshot('node-b', 'EntityB'),
                makeEntitySnapshot('node-c', 'EntityC'),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        expect(entities).toHaveLength(3);
        expect(entities.map((a) => a.name)).toEqual(['EntityA', 'EntityB', 'EntityC']);
    });
});

// ---------------------------------------------------------------------------
// Test Group 2: Hierarchical Prefab (Parent-Child)
// ---------------------------------------------------------------------------
describe('Prefab Instantiation — Hierarchical Prefab', () => {
    let harness: PrefabTestHarness;

    beforeEach(() => {
        harness = createPrefabTestHarness();
    });

    it('preserves parent-child hierarchy from prefab definition', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/hierarchy',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('parent', 'Parent'),
                makeEntitySnapshot('child', 'Child', { parentNodeId: 'parent' }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const parent = entities.find((a) => a.name === 'Parent')!;
        const child = entities.find((a) => a.name === 'Child')!;

        const childHierarchy = child.getComponent(Hierarchy);
        expect(childHierarchy).toBeDefined();
        expect(childHierarchy!.parentEntity).toBe(parent);
    });

    it('supports multi-level hierarchy (grandparent -> parent -> child)', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/deep-hierarchy',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('grandparent', 'GrandParent'),
                makeEntitySnapshot('parent', 'Parent', { parentNodeId: 'grandparent' }),
                makeEntitySnapshot('child', 'Child', { parentNodeId: 'parent' }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const grandParent = entities.find((a) => a.name === 'GrandParent')!;
        const parent = entities.find((a) => a.name === 'Parent')!;
        const child = entities.find((a) => a.name === 'Child')!;

        expect(parent.getComponent(Hierarchy)!.parentEntity).toBe(grandParent);
        expect(child.getComponent(Hierarchy)!.parentEntity).toBe(parent);
    });

    it('root entities have no parent', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/roots',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root-a', 'RootA'),
                makeEntitySnapshot('root-b', 'RootB'),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);

        for (const entity of entities) {
            const hierarchy = entity.getComponent(Hierarchy);
            expect(hierarchy!.parentEntity).toBeUndefined();
        }
    });

    it('preserves hierarchy in a skeleton-like structure', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/skeleton',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Root'),
                makeEntitySnapshot('spine', 'Spine', { parentNodeId: 'root' }),
                makeEntitySnapshot('head', 'Head', { parentNodeId: 'spine' }),
                makeEntitySnapshot('left-arm', 'LeftArm', { parentNodeId: 'spine' }),
                makeEntitySnapshot('right-arm', 'RightArm', { parentNodeId: 'spine' }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const spine = entities.find((a) => a.name === 'Spine')!;
        const head = entities.find((a) => a.name === 'Head')!;
        const leftArm = entities.find((a) => a.name === 'LeftArm')!;
        const rightArm = entities.find((a) => a.name === 'RightArm')!;

        expect(head.getComponent(Hierarchy)!.parentEntity).toBe(spine);
        expect(leftArm.getComponent(Hierarchy)!.parentEntity).toBe(spine);
        expect(rightArm.getComponent(Hierarchy)!.parentEntity).toBe(spine);
    });

    it('child transforms are relative to parent after instantiation', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/transform-hierarchy',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('parent', 'Parent', {
                    components: [makeTransformComponent([10, 0, 0])],
                }),
                makeEntitySnapshot('child', 'Child', {
                    parentNodeId: 'parent',
                    components: [makeTransformComponent([0, 5, 0])],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const parentTransform = entities[0]!.getComponent(Transform)!;
        const childTransform = entities[1]!.getComponent(Transform)!;

        expect(parentTransform.position.x).toBe(10);
        expect(childTransform.position.y).toBe(5);
    });
});

// ---------------------------------------------------------------------------
// Test Group 3: Multiple Instances (ID Uniqueness)
// ---------------------------------------------------------------------------
describe('Prefab Instantiation — Multiple Instances', () => {
    let harness: PrefabTestHarness;

    beforeEach(() => {
        harness = createPrefabTestHarness();
    });

    it('each instance gets unique entity/entity IDs', () => {
        const prefab = makeSimplePrefab('prefab/id-test', 'Clone');

        const instance1 = harness.entityRuntime.instantiatePrefab(prefab);
        const instance2 = harness.entityRuntime.instantiatePrefab(prefab);

        expect(instance1[0]!.id).not.toBe(instance2[0]!.id);
    });

    it('each instance gets unique PrefabNodeBinding instanceId', () => {
        const prefab = makeSimplePrefab('prefab/instance-id-test', 'Clone');

        const instance1 = harness.entityRuntime.instantiatePrefab(prefab);
        const instance2 = harness.entityRuntime.instantiatePrefab(prefab);

        const binding1 = instance1[0]!.getComponent(PrefabNodeBinding)!;
        const binding2 = instance2[0]!.getComponent(PrefabNodeBinding)!;

        expect(binding1.instanceId).not.toBe(binding2.instanceId);
    });

    it('each instance gets unique component IDs', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/comp-id-test',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Entity', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestHealth', { maxHealth: 100, currentHealth: 100, isInvincible: false }),
                    ],
                }),
            ],
        };

        const instance1 = harness.entityRuntime.instantiatePrefab(prefab);
        const instance2 = harness.entityRuntime.instantiatePrefab(prefab);

        const components1 = instance1[0]!.getAllComponents();
        const components2 = instance2[0]!.getAllComponents();

        const ids1 = new Set(components1.map((c) => c.id));
        const ids2 = new Set(components2.map((c) => c.id));

        for (const id of ids1) {
            expect(ids2.has(id)).toBe(false);
        }
    });

    it('instances do not interfere with each other', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/isolation-test',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Entity', {
                    components: [
                        makeTransformComponent([0, 0, 0]),
                        makeComponent('TestHealth', { maxHealth: 100, currentHealth: 50, isInvincible: false }),
                    ],
                }),
            ],
        };

        const instance1 = harness.entityRuntime.instantiatePrefab(prefab);
        const instance2 = harness.entityRuntime.instantiatePrefab(prefab);

        const health1 = instance1[0]!.getComponent(TestHealth)!;
        const health2 = instance2[0]!.getComponent(TestHealth)!;

        health1.currentHealth = 0;

        expect(health1.currentHealth).toBe(0);
        expect(health2.currentHealth).toBe(50);
    });

    it('both instances are functional after creation', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/functional-test',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Entity', {
                    components: [
                        makeTransformComponent([1, 2, 3]),
                        makeComponent('TestHealth', { maxHealth: 200, currentHealth: 200, isInvincible: true }),
                    ],
                }),
            ],
        };

        const instance1 = harness.entityRuntime.instantiatePrefab(prefab);
        const instance2 = harness.entityRuntime.instantiatePrefab(prefab);

        for (const entities of [instance1, instance2]) {
            const entity = entities[0]!;
            expect(entity.getComponent(Transform)).toBeDefined();
            expect(entity.getComponent(TestHealth)).toBeDefined();
            expect(entity.getComponent(PrefabNodeBinding)).toBeDefined();
            expect(entity.active).toBe(true);
        }
    });

    it('can instantiate the same prefab many times without errors', () => {
        const prefab = makeSimplePrefab('prefab/stress-test', 'Stress');
        const allInstances: EntityId[][] = [];

        for (let i = 0; i < 20; i++) {
            allInstances.push(harness.entityRuntime.instantiatePrefab(prefab) as EntityId[]);
        }

        const allIds = new Set(allInstances.map((inst) => inst[0]!.id));
        expect(allIds.size).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// Test Group 4: Component Data Hydration
// ---------------------------------------------------------------------------
describe('Prefab Instantiation — Component Data Hydration', () => {
    let harness: PrefabTestHarness;

    beforeEach(() => {
        harness = createPrefabTestHarness();
    });

    it('applies Transform position/rotation/scale from serialized data', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/transform-data',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'PositionedEntity', {
                    components: [
                        makeTransformComponent([5, 10, -3], [0, 0.707, 0, 0.707], [2, 2, 2]),
                    ],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const transform = entities[0]!.getComponent(Transform)!;

        expect(transform.position.x).toBeCloseTo(5);
        expect(transform.position.y).toBeCloseTo(10);
        expect(transform.position.z).toBeCloseTo(-3);
        expect(transform.rotation.y).toBeCloseTo(0.707);
        expect(transform.scale.x).toBeCloseTo(2);
        expect(transform.scale.y).toBeCloseTo(2);
        expect(transform.scale.z).toBeCloseTo(2);
    });

    it('hydrates custom component scalar properties', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/health-data',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Tank', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestHealth', {
                            maxHealth: 500,
                            currentHealth: 350,
                            isInvincible: true,
                        }),
                    ],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const health = entities[0]!.getComponent(TestHealth)!;

        expect(health.maxHealth).toBe(500);
        expect(health.currentHealth).toBe(350);
        expect(health.isInvincible).toBe(true);
    });

    it('hydrates string properties on custom components', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/weapon-string',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Warrior', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestWeapon', {
                            damage: 25,
                            weaponName: 'Flamebrand',
                        }),
                    ],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const weapon = entities[0]!.getComponent(TestWeapon)!;

        expect(weapon.damage).toBe(25);
        expect(weapon.weaponName).toBe('Flamebrand');
    });

    it('resolves entity references (nodeId to EntityId)', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/entity-ref',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('node/weapon', 'WeaponHolder', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestWeapon', {
                            damage: 15,
                            weaponName: 'Dagger',
                            targetEntity: { kind: 'entity', target: 'node/enemy' },
                        }),
                    ],
                }),
                makeEntitySnapshot('node/enemy', 'Enemy', {
                    components: [makeTransformComponent([10, 0, 0])],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const weaponHolder = entities.find((a) => a.name === 'WeaponHolder')!;
        const enemy = entities.find((a) => a.name === 'Enemy')!;
        const weapon = weaponHolder.getComponent(TestWeapon)!;

        expect(weapon.targetEntity).toBe(enemy);
    });

    it('resolves transform references (nodeId to Transform)', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/transform-ref',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('node/follower', 'Follower', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestFollowTarget', {
                            leaderTransform: { kind: 'entity', target: 'node/leader' },
                            offset: { x: 1, y: 2, z: 3 },
                        }),
                    ],
                }),
                makeEntitySnapshot('node/leader', 'Leader', {
                    components: [makeTransformComponent([5, 0, 0])],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const follower = entities.find((a) => a.name === 'Follower')!;
        const leader = entities.find((a) => a.name === 'Leader')!;
        const follow = follower.getComponent(TestFollowTarget)!;

        expect(follow.leaderTransform).toBe(leader.getComponent(Transform));
    });

    it('hydrates Vec3 properties from serialized data', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/vec3-hydration',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('node/follower', 'Follower', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestFollowTarget', {
                            offset: { x: 7, y: -3, z: 12 },
                        }),
                    ],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab);
        const follow = entities[0]!.getComponent(TestFollowTarget)!;

        expect(follow.offset).toBeInstanceOf(Vec3);
        expect(follow.offset.x).toBeCloseTo(7);
        expect(follow.offset.y).toBeCloseTo(-3);
        expect(follow.offset.z).toBeCloseTo(12);
    });
});

// ---------------------------------------------------------------------------
// Test Group 5: Prefab Overrides
// ---------------------------------------------------------------------------
describe('Prefab Instantiation — Prefab Overrides', () => {
    let harness: PrefabTestHarness;

    beforeEach(() => {
        harness = createPrefabTestHarness();
    });

    it('applies set-entity-field override to change entity name', () => {
        const prefab = makeSimplePrefab('prefab/override-name', 'Original');

        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            liveOverrides: [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'name',
                    value: 'Overridden',
                },
            ],
        });

        expect(entities[0]!.name).toBe('Overridden');
    });

    it('applies set-entity-field override to change active state', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/override-active',
            kind: 'prefab',
            entities: [makeEntitySnapshot('root', 'Entity', { active: true })],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            liveOverrides: [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'active',
                    value: false,
                },
            ],
        });

        expect(entities[0]!.active).toBe(false);
    });

    it('applies set-component-property override to modify component data', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/override-comp',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Entity', {
                    components: [
                        makeTransformComponent(),
                        makeComponent('TestHealth', {
                            maxHealth: 100,
                            currentHealth: 100,
                            isInvincible: false,
                        }, 'cmp-health'),
                    ],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            liveOverrides: [
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-health', type: 'TestHealth' },
                    path: ['maxHealth'],
                    value: encodeSceneValue(999),
                },
            ],
        });

        const health = entities[0]!.getComponent(TestHealth)!;
        expect(health.maxHealth).toBe(999);
    });

    it('applies add-entity override to add a new entity to the prefab', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/override-add-entity',
            kind: 'prefab',
            entities: [makeEntitySnapshot('root', 'Root')],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            liveOverrides: [
                {
                    kind: 'add-entity',
                    entity: makeEntitySnapshot('extra', 'ExtraEntity', {
                        parentNodeId: 'root',
                    }),
                },
            ],
        });

        expect(entities).toHaveLength(2);
        const extra = entities.find((a) => a.name === 'ExtraEntity');
        expect(extra).toBeDefined();
    });

    it('applies remove-entity override to remove an entity from the prefab', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/override-remove',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Root'),
                makeEntitySnapshot('disposable', 'Disposable', { parentNodeId: 'root' }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            liveOverrides: [
                { kind: 'remove-entity', nodeId: 'disposable' },
            ],
        });

        expect(entities).toHaveLength(1);
        expect(entities[0]!.name).toBe('Root');
    });

    it('applies multiple overrides simultaneously', () => {
        const prefab: ScenePrefabDefinition = {
            id: 'prefab/multi-override',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'Original', {
                    components: [
                        makeTransformComponent([0, 0, 0]),
                        makeComponent('TestHealth', {
                            maxHealth: 100,
                            currentHealth: 100,
                            isInvincible: false,
                        }, 'cmp-health'),
                    ],
                }),
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(prefab, {
            liveOverrides: [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'name',
                    value: 'Renamed',
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-health', type: 'TestHealth' },
                    path: ['isInvincible'],
                    value: encodeSceneValue(true),
                },
            ],
        });

        expect(entities[0]!.name).toBe('Renamed');
        expect(entities[0]!.getComponent(TestHealth)!.isInvincible).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Test Group 6: Prefab Variant (Base + Derived)
// ---------------------------------------------------------------------------
describe('Prefab Instantiation — Prefab Variant', () => {
    let harness: PrefabTestHarness;

    beforeEach(() => {
        harness = createPrefabTestHarness();
    });

    it('instantiates a variant that extends a base prefab', () => {
        const basePrefab: ScenePrefabDefinition = {
            id: 'prefab/base-enemy',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'BaseEnemy', {
                    components: [
                        makeTransformComponent([0, 0, 0]),
                        makeComponent('TestHealth', {
                            maxHealth: 100,
                            currentHealth: 100,
                            isInvincible: false,
                        }, 'cmp-health'),
                    ],
                }),
            ],
        };

        const variant: ScenePrefabDefinition = {
            id: 'prefab/elite-enemy',
            kind: 'variant',
            base: { kind: 'registry', prefabId: 'prefab/base-enemy' },
            entities: [],
            overrides: [
                {
                    kind: 'set-entity-field',
                    nodeId: 'root',
                    field: 'name',
                    value: 'EliteEnemy',
                },
                {
                    kind: 'set-component-property',
                    nodeId: 'root',
                    selector: { kind: 'id', componentId: 'cmp-health', type: 'TestHealth' },
                    path: ['maxHealth'],
                    value: encodeSceneValue(500),
                },
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(variant, {
            prefabResolver: {
                resolvePrefab: (prefab) => {
                    const workflow = new ScenePrefabWorkflow({
                        prefabs: [basePrefab, variant],
                    });
                    return workflow.resolvePrefab(prefab);
                },
            },
        });

        expect(entities).toHaveLength(1);
        expect(entities[0]!.name).toBe('EliteEnemy');
        expect(entities[0]!.getComponent(TestHealth)!.maxHealth).toBe(500);
    });

    it('variant inherits base entities when no entity overrides exist', () => {
        const basePrefab: ScenePrefabDefinition = {
            id: 'prefab/base-structure',
            kind: 'prefab',
            entities: [
                makeEntitySnapshot('root', 'BaseRoot'),
                makeEntitySnapshot('child', 'BaseChild', { parentNodeId: 'root' }),
            ],
        };

        const variant: ScenePrefabDefinition = {
            id: 'prefab/derived-structure',
            kind: 'variant',
            base: { kind: 'registry', prefabId: 'prefab/base-structure' },
            entities: [],
            overrides: [],
        };

        const entities = harness.entityRuntime.instantiatePrefab(variant, {
            prefabResolver: {
                resolvePrefab: (prefab) => {
                    const workflow = new ScenePrefabWorkflow({
                        prefabs: [basePrefab, variant],
                    });
                    return workflow.resolvePrefab(prefab);
                },
            },
        });

        expect(entities).toHaveLength(2);
        expect(entities.map((a) => a.name)).toEqual(['BaseRoot', 'BaseChild']);
    });

    it('variant can add new entities on top of base', () => {
        const basePrefab: ScenePrefabDefinition = {
            id: 'prefab/base-with-entity',
            kind: 'prefab',
            entities: [makeEntitySnapshot('root', 'BaseRoot')],
        };

        const variant: ScenePrefabDefinition = {
            id: 'prefab/variant-extra-entity',
            kind: 'variant',
            base: { kind: 'registry', prefabId: 'prefab/base-with-entity' },
            entities: [],
            overrides: [
                {
                    kind: 'add-entity',
                    entity: makeEntitySnapshot('extra', 'ExtraFromVariant', {
                        parentNodeId: 'root',
                    }),
                },
            ],
        };

        const entities = harness.entityRuntime.instantiatePrefab(variant, {
            prefabResolver: {
                resolvePrefab: (prefab) => {
                    const workflow = new ScenePrefabWorkflow({
                        prefabs: [basePrefab, variant],
                    });
                    return workflow.resolvePrefab(prefab);
                },
            },
        });

        expect(entities).toHaveLength(2);
        const extra = entities.find((a) => a.name === 'ExtraFromVariant');
        expect(extra).toBeDefined();
        expect(extra!.getComponent(Hierarchy)!.parentEntity).toBe(entities[0]);
    });

    it('resolved variant has lineage including both base and variant IDs', () => {
        const basePrefab: ScenePrefabDefinition = {
            id: 'prefab/lineage-base',
            kind: 'prefab',
            entities: [makeEntitySnapshot('root', 'Base')],
        };

        const variant: ScenePrefabDefinition = {
            id: 'prefab/lineage-variant',
            kind: 'variant',
            base: { kind: 'registry', prefabId: 'prefab/lineage-base' },
            entities: [],
        };

        let resolvedLineage: readonly string[] = [];

        harness.entityRuntime.instantiatePrefab(variant, {
            prefabResolver: {
                resolvePrefab: (prefab) => {
                    const workflow = new ScenePrefabWorkflow({
                        prefabs: [basePrefab, variant],
                    });
                    const result = workflow.resolvePrefab(prefab);
                    resolvedLineage = result.definition.lineage;
                    return result;
                },
            },
        });

        expect(resolvedLineage).toContain('prefab/lineage-base');
        expect(resolvedLineage).toContain('prefab/lineage-variant');
    });
});
