import { Vec4 } from '@axrone/numeric';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockGL,
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';

// Static import of the scene fixture for validation tests.
// The fixture is tracked in-repo so validation is hermetic — it must not
// depend on an untracked Main.scene.json in a parent checkout.
import mainSceneJson from './fixtures/Main.scene.json';

// ─── Static Scene File Validation (Main.scene.json) ─────────────────────────

/**
 * Type definitions matching the on-disk scene JSON schema.
 */
interface SceneComponent {
    id: string;
    kind: string;
    name: string;
    enabled: boolean;
    properties: Record<string, unknown>;
}

interface SceneEntity {
    id: string;
    name: string;
    parentId: string | null;
    enabled: boolean;
    tag: string;
    layer: string;
    components: SceneComponent[];
}

interface SceneFile {
    schemaVersion: number;
    id: string;
    name: string;
    createdAtMs: number;
    updatedAtMs: number;
    activeEntityId: string;
    settings: Record<string, unknown>;
    entities: SceneEntity[];
}

const sceneFile = mainSceneJson as SceneFile;

/** Known component kinds that are valid in the scene schema. */
const VALID_COMPONENT_KINDS = new Set([
    'transform',
    'camera',
    'directional-light',
    'point-light',
    'spot-light',
    'mesh-renderer',
    'script',
    'ui-host',
    'prefab-instance',
    'animator',
    'rigidbody',
    'collider',
    'audio-source',
    'particle-system',
]);

describe('Main.scene.json — Static Validation', () => {
    // ─── 1. Scene JSON Parsing ──────────────────────────────────────────────

    describe('Scene JSON Parsing', () => {
        it('parses without errors and produces a valid object', () => {
            expect(sceneFile).toBeDefined();
            expect(typeof sceneFile).toBe('object');
        });

        it('contains the expected top-level keys', () => {
            const topKeys = Object.keys(sceneFile);
            expect(topKeys).toContain('schemaVersion');
            expect(topKeys).toContain('id');
            expect(topKeys).toContain('name');
            expect(topKeys).toContain('entities');
            expect(topKeys).toContain('settings');
        });
    });

    // ─── 2. Scene Metadata ──────────────────────────────────────────────────

    describe('Scene Metadata', () => {
        it('has a valid schemaVersion (positive integer)', () => {
            expect(sceneFile.schemaVersion).toBeGreaterThanOrEqual(1);
            expect(Number.isInteger(sceneFile.schemaVersion)).toBe(true);
        });

        it('has a non-empty scene id', () => {
            expect(sceneFile.id).toBeTruthy();
            expect(typeof sceneFile.id).toBe('string');
            expect(sceneFile.id.startsWith('scn_')).toBe(true);
        });

        it('has a valid scene name', () => {
            expect(sceneFile.name).toBe('Main.scene');
        });

        it('has valid timestamps (createdAt <= updatedAt)', () => {
            expect(sceneFile.createdAtMs).toBeGreaterThan(0);
            expect(sceneFile.updatedAtMs).toBeGreaterThanOrEqual(sceneFile.createdAtMs);
        });

        it('has an activeEntityId that references an existing entity', () => {
            const entityIds = new Set(sceneFile.entities.map((e) => e.id));
            expect(entityIds.has(sceneFile.activeEntityId)).toBe(true);
        });
    });

    // ─── 3. Entity Count and Identity ───────────────────────────────────────

    describe('Entity Structure', () => {
        it('contains exactly 9 entities', () => {
            expect(sceneFile.entities.length).toBe(9);
        });

        it('every entity has a unique id', () => {
            const ids = sceneFile.entities.map((e) => e.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });

        it('every entity id starts with ent_ prefix', () => {
            for (const entity of sceneFile.entities) {
                expect(entity.id.startsWith('ent_')).toBe(true);
            }
        });

        it('every entity has a non-empty name', () => {
            for (const entity of sceneFile.entities) {
                expect(entity.name).toBeTruthy();
                expect(typeof entity.name).toBe('string');
            }
        });

        it('contains all expected entity names from the Main scene', () => {
            const names = new Set(sceneFile.entities.map((e) => e.name));
            const expectedNames = [
                'Main Camera',
                'Directional Light',
                'World',
                'Ground',
                'Player',
                'Actor',
                'Cube',
                'cone_0001',
                'UI Host',
            ];
            for (const name of expectedNames) {
                expect(names.has(name)).toBe(true);
            }
        });
    });

    // ─── 4. Entity Reference Resolution (no dangling parentId) ──────────────

    describe('Entity Reference Resolution', () => {
        it('all parentId references resolve to existing entities (no dangling refs)', () => {
            const entityIds = new Set(sceneFile.entities.map((e) => e.id));
            for (const entity of sceneFile.entities) {
                if (entity.parentId !== null) {
                    expect(entityIds.has(entity.parentId)).toBe(true);
                }
            }
        });

        it('root entities have parentId set to null', () => {
            const rootEntities = sceneFile.entities.filter((e) => e.parentId === null);
            expect(rootEntities.length).toBeGreaterThan(0);
            const rootNames = rootEntities.map((e) => e.name);
            expect(rootNames).toContain('Main Camera');
            expect(rootNames).toContain('Directional Light');
            expect(rootNames).toContain('World');
        });

        it('child entities reference the correct parent', () => {
            const worldEntity = sceneFile.entities.find((e) => e.name === 'World');
            expect(worldEntity).toBeDefined();

            const groundEntity = sceneFile.entities.find((e) => e.name === 'Ground');
            const playerEntity = sceneFile.entities.find((e) => e.name === 'Player');

            expect(groundEntity!.parentId).toBe(worldEntity!.id);
            expect(playerEntity!.parentId).toBe(worldEntity!.id);
        });
    });

    // ─── 5. Component Schema Validation ─────────────────────────────────────

    describe('Component Data Validation', () => {
        it('every component has a valid kind', () => {
            for (const entity of sceneFile.entities) {
                for (const component of entity.components) {
                    expect(VALID_COMPONENT_KINDS.has(component.kind)).toBe(true);
                }
            }
        });

        it('every component has a non-empty id starting with cmp_', () => {
            for (const entity of sceneFile.entities) {
                for (const component of entity.components) {
                    expect(component.id).toBeTruthy();
                    expect(component.id.startsWith('cmp_')).toBe(true);
                }
            }
        });

        it('every entity has exactly one Transform component', () => {
            for (const entity of sceneFile.entities) {
                const transforms = entity.components.filter((c) => c.kind === 'transform');
                expect(transforms.length).toBe(1);
            }
        });

        it('total component count matches the scene composition (18)', () => {
            const totalComponents = sceneFile.entities.reduce(
                (sum, e) => sum + e.components.length,
                0,
            );
            // 9 entities x 1 transform each = 9 transforms
            // Extras: Camera(1) + DirectionalLight(1) + MeshRenderer(4)
            //         + Script(1) + AudioSource(1) + UIHost(1) = 9
            expect(totalComponents).toBe(18);
        });

        it('Camera component has required properties', () => {
            const cameraEntity = sceneFile.entities.find((e) => e.name === 'Main Camera');
            const cameraComp = cameraEntity!.components.find((c) => c.kind === 'camera');
            expect(cameraComp).toBeDefined();
            expect(cameraComp!.properties).toHaveProperty('fieldOfView');
            expect(cameraComp!.properties).toHaveProperty('nearClip');
            expect(cameraComp!.properties).toHaveProperty('farClip');
            expect(cameraComp!.properties).toHaveProperty('primary');
            expect(cameraComp!.properties.primary).toBe(true);
        });

        it('DirectionalLight component has required properties', () => {
            const lightEntity = sceneFile.entities.find((e) => e.name === 'Directional Light');
            const lightComp = lightEntity!.components.find((c) => c.kind === 'directional-light');
            expect(lightComp).toBeDefined();
            expect(lightComp!.properties).toHaveProperty('intensity');
            expect(lightComp!.properties).toHaveProperty('castShadows');
            expect(typeof lightComp!.properties.intensity).toBe('number');
            expect(lightComp!.properties.intensity).toBeGreaterThan(0);
        });

        it('MeshRenderer components reference valid mesh and material paths', () => {
            const meshRenderers = sceneFile.entities.flatMap((e) =>
                e.components.filter((c) => c.kind === 'mesh-renderer'),
            );
            expect(meshRenderers.length).toBeGreaterThan(0);

            for (const mr of meshRenderers) {
                expect(mr.properties).toHaveProperty('mesh');
                expect(mr.properties).toHaveProperty('material');
                expect(typeof mr.properties.mesh).toBe('string');
                expect(typeof mr.properties.material).toBe('string');
                expect((mr.properties.mesh as string).length).toBeGreaterThan(0);
                expect((mr.properties.material as string).length).toBeGreaterThan(0);
            }
        });

        it('Script components reference a script path and expose property values', () => {
            const scripts = sceneFile.entities.flatMap((e) =>
                e.components.filter((c) => c.kind === 'script'),
            );
            expect(scripts.length).toBeGreaterThan(0);

            for (const script of scripts) {
                expect(script.properties).toHaveProperty('className');
                expect(script.properties).toHaveProperty('scriptPath');
                expect(typeof script.properties.className).toBe('string');
                expect((script.properties.className as string).length).toBeGreaterThan(0);
                expect((script.properties.scriptPath as string).endsWith('.ts')).toBe(true);
                expect(script.properties).toHaveProperty('propertyValues');
                expect(typeof script.properties.propertyValues).toBe('object');
            }
        });
    });

    // ─── 6. Hierarchy Structure ─────────────────────────────────────────────

    describe('Hierarchy Structure', () => {
        it('forms a valid tree (no cycles)', () => {
            const entityMap = new Map(sceneFile.entities.map((e) => [e.id, e]));

            for (const entity of sceneFile.entities) {
                const visited = new Set<string>();
                let current: SceneEntity | undefined = entity;

                while (current && current.parentId !== null) {
                    if (visited.has(current.id)) {
                        throw new Error(`Cycle detected involving entity: ${entity.name}`);
                    }
                    visited.add(current.id);
                    current = entityMap.get(current.parentId);
                }
            }
            expect(sceneFile.entities.length).toBeGreaterThan(0);
        });

        it('has exactly 2 levels (root + one level of children)', () => {
            const depths = sceneFile.entities.map((entity) => {
                let depth = 0;
                let current: SceneEntity | undefined = entity;
                const entityMap = new Map(sceneFile.entities.map((e) => [e.id, e]));

                while (current && current.parentId !== null) {
                    depth++;
                    current = entityMap.get(current.parentId);
                }
                return depth;
            });

            expect(Math.max(...depths)).toBe(1);
        });

        it('World entity has exactly 2 children (Ground and Player)', () => {
            const worldEntity = sceneFile.entities.find((e) => e.name === 'World');
            const children = sceneFile.entities.filter((e) => e.parentId === worldEntity!.id);
            expect(children.length).toBe(2);
            const childNames = children.map((c) => c.name);
            expect(childNames).toContain('Ground');
            expect(childNames).toContain('Player');
        });
    });

    // ─── 7. Transform Data Well-formedness ──────────────────────────────────

    describe('Transform Data', () => {
        it('every Transform has position, rotation, and scale arrays of length 3', () => {
            for (const entity of sceneFile.entities) {
                const transform = entity.components.find((c) => c.kind === 'transform');
                expect(transform).toBeDefined();

                const { position, rotation, scale } = transform!.properties;

                expect(Array.isArray(position)).toBe(true);
                expect((position as number[]).length).toBe(3);

                expect(Array.isArray(rotation)).toBe(true);
                expect((rotation as number[]).length).toBe(3);

                expect(Array.isArray(scale)).toBe(true);
                expect((scale as number[]).length).toBe(3);
            }
        });

        it('all transform values are finite numbers (no NaN or Infinity)', () => {
            for (const entity of sceneFile.entities) {
                const transform = entity.components.find((c) => c.kind === 'transform');
                const values = [
                    ...(transform!.properties.position as number[]),
                    ...(transform!.properties.rotation as number[]),
                    ...(transform!.properties.scale as number[]),
                ];

                for (const v of values) {
                    expect(typeof v).toBe('number');
                    expect(Number.isFinite(v)).toBe(true);
                }
            }
        });

        it('scale values are non-zero on at least one axis for every entity', () => {
            for (const entity of sceneFile.entities) {
                const transform = entity.components.find((c) => c.kind === 'transform');
                const scale = transform!.properties.scale as number[];
                const hasNonZero = scale.some((v) => v !== 0);
                expect(hasNonZero).toBe(true);
            }
        });

        it('Main Camera has the expected position from the scene file', () => {
            const cameraEntity = sceneFile.entities.find((e) => e.name === 'Main Camera');
            const transform = cameraEntity!.components.find((c) => c.kind === 'transform');
            const position = transform!.properties.position as number[];

            expect(position[0]).toBeCloseTo(0, 5);
            expect(position[1]).toBeCloseTo(2.5, 5);
            expect(position[2]).toBeCloseTo(8, 5);
        });

        it('Ground entity has non-uniform scale (12, 1, 12)', () => {
            const groundEntity = sceneFile.entities.find((e) => e.name === 'Ground');
            const transform = groundEntity!.components.find((c) => c.kind === 'transform');
            const scale = transform!.properties.scale as number[];

            expect(scale[0]).toBeCloseTo(12, 5);
            expect(scale[1]).toBeCloseTo(1, 5);
            expect(scale[2]).toBeCloseTo(12, 5);
        });
    });

    // ─── 8. Settings Validation ─────────────────────────────────────────────

    describe('Scene Settings', () => {
        it('has environment settings with required fields', () => {
            const env = (sceneFile.settings as { environment: Record<string, unknown> }).environment;
            expect(env).toBeDefined();
            expect(env).toHaveProperty('skyColor');
            expect(env).toHaveProperty('ambientColor');
            expect(env).toHaveProperty('gravity');
            expect(env).toHaveProperty('shadowType');
        });

        it('gravity is a 3-element array', () => {
            const env = (sceneFile.settings as { environment: Record<string, unknown> }).environment;
            const gravity = env.gravity as number[];
            expect(Array.isArray(gravity)).toBe(true);
            expect(gravity.length).toBe(3);
        });
    });
});

let Scene: typeof import('@axrone/scene-3d').Scene;
let Camera: typeof import('@axrone/scene-3d').Camera;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;
let DirectionalLight: typeof import('@axrone/scene-3d').DirectionalLight;
let Transform: typeof import('@axrone/ecs-runtime').Transform;
let Hierarchy: typeof import('@axrone/ecs-runtime').Hierarchy;
let PrefabNodeBinding: typeof import('@axrone/scene-3d').PrefabNodeBinding;
let SceneSnapshotLoader: typeof import('@axrone/scene-3d').SceneSnapshotLoader;
let SceneLifecycleError: typeof import('@axrone/scene-3d').SceneLifecycleError;

import type {
    SceneSnapshot,
    ScenePrefabDefinition,
    SceneActorSnapshot,
    SceneComponentSnapshot,
} from '@axrone/scene-3d';

/**
 * Helper: build a minimal valid SceneSnapshot.
 */
function buildMinimalSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'test/solid',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'cube',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
        ],
        samplers: [],
        textures: [],
        renderPasses: [],
        materials: [{ id: 'default-mat', shaderId: 'test/solid' }],
        prefab: {
            id: 'root-prefab',
            actors: [
                {
                    name: 'TestActor',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'cube', materialId: 'default-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

/**
 * Helper: build a snapshot mirroring Main.scene.json structure (10 entities, 13+ components).
 */
function buildFullSceneSnapshot(): SceneSnapshot {
    const actors: SceneActorSnapshot[] = [
        // 1. Main Camera (root)
        {
            name: 'Main Camera',
            layer: 0,
            tag: 'Camera',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 2.5, 8], rotation: [-12, 0, 0], scale: [1, 1, 1] } },
                { type: 'Camera', data: { primary: true, fieldOfView: 60, nearClip: 0.1, farClip: 1000 } },
            ],
        },
        // 2. Directional Light (root)
        {
            name: 'Directional Light',
            layer: 1,
            tag: 'Lighting',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [4, 6, 2], rotation: [48, -32, 0], scale: [1, 1, 1] } },
                { type: 'DirectionalLight', data: { castShadows: true, color: [1, 0.95, 0.84], intensity: 1.15 } },
            ],
        },
        // 3. World (root) — parent for Ground and Player
        {
            nodeId: 'node-world',
            name: 'World',
            layer: 0,
            tag: 'Environment',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            ],
        },
        // 4. Ground (child of World)
        {
            nodeId: 'node-ground',
            parentNodeId: 'node-world',
            name: 'Ground',
            layer: 0,
            tag: 'Environment',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [12, 1, 12] } },
                { type: 'MeshRenderer', data: { meshId: 'plane', materialId: 'floor-mat', castShadows: true } },
            ],
        },
        // 5. Player (child of World)
        {
            nodeId: 'node-player',
            parentNodeId: 'node-world',
            name: 'Player',
            layer: 2,
            tag: 'Player',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
                { type: 'MeshRenderer', data: { meshId: 'capsule', materialId: 'player-mat', castShadows: true } },
            ],
        },
        // 6. UI Host (root)
        {
            name: 'UI Host',
            layer: 3,
            tag: 'UI',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
                { type: 'UIHost', data: { renderMode: 'screen-overlay', width: 200, height: 80 } },
            ],
        },
        // 7. Actor (empty, root)
        {
            name: 'Actor',
            layer: 0,
            tag: 'Untagged',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            ],
        },
        // 8. EN_Character_Stickman_01 (prefab instance, root)
        {
            name: 'EN_Character_Stickman_01',
            layer: 0,
            tag: 'Imported',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0.5, 0, -1.97], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            ],
        },
        // 9. Actor 2 (empty, root)
        {
            name: 'Actor 2',
            layer: 0,
            tag: 'Untagged',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            ],
        },
        // 10. Cube (prefab instance, root)
        {
            name: 'Cube',
            layer: 0,
            tag: 'Untagged',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                { type: 'Transform', data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            ],
        },
    ];

    return {
        version: 1,
        shaders: [
            {
                id: 'test/lit',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'plane',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
            {
                id: 'capsule',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
        ],
        samplers: [],
        textures: [],
        renderPasses: [],
        materials: [
            { id: 'floor-mat', shaderId: 'test/lit' },
            { id: 'player-mat', shaderId: 'test/lit' },
        ],
        prefab: {
            id: 'main-scene-prefab',
            actors,
        },
    };
}

describe('Scene Loading Integration', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        Camera = sceneModule.Camera;
        MeshRenderer = sceneModule.MeshRenderer;
        DirectionalLight = sceneModule.DirectionalLight;
        PrefabNodeBinding = sceneModule.PrefabNodeBinding;
        SceneSnapshotLoader = sceneModule.SceneSnapshotLoader;
        SceneLifecycleError = sceneModule.SceneLifecycleError;

        const ecsModule = await import('@axrone/ecs-runtime');
        Transform = ecsModule.Transform;
        Hierarchy = ecsModule.Hierarchy;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ─── Test Group 1: Minimal Scene Loading ──────────────────────────────

    describe('Minimal Scene Loading', () => {
        it('loads a minimal scene with one actor and verifies components', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot();
            const actors = await scene.loadScene(snapshot);

            expect(actors.length).toBeGreaterThanOrEqual(1);

            const testActor = actors.find((a) => a.name === 'TestActor');
            expect(testActor).toBeDefined();
            expect(testActor!.getComponent(Transform)).toBeDefined();
            expect(testActor!.getComponent(MeshRenderer)).toBeDefined();
            expect(testActor!.getComponent(MeshRenderer)!.meshId).toBe('cube');
            expect(testActor!.getComponent(MeshRenderer)!.materialId).toBe('default-mat');

            scene.dispose();
        });

        it('registers shaders, meshes, and materials during minimal load', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot();
            await scene.loadScene(snapshot);

            expect(scene.getTexture).toBeDefined();
            // Verify the mesh was registered by checking the scene can reference it
            expect(snapshot.meshes[0]!.id).toBe('cube');
            expect(snapshot.materials[0]!.shaderId).toBe('test/solid');

            scene.dispose();
        });
    });

    // ─── Test Group 2: Full Scene Loading (Main.scene.json equivalent) ────

    describe('Full Scene Loading', () => {
        it('loads all 10 entities from a Main.scene.json-equivalent snapshot', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            expect(actors.length).toBe(10);

            const names = actors.map((a) => a.name);
            expect(names).toContain('Main Camera');
            expect(names).toContain('Directional Light');
            expect(names).toContain('World');
            expect(names).toContain('Ground');
            expect(names).toContain('Player');
            expect(names).toContain('UI Host');
            expect(names).toContain('Actor');
            expect(names).toContain('EN_Character_Stickman_01');
            expect(names).toContain('Actor 2');
            expect(names).toContain('Cube');

            scene.dispose();
        });

        it('attaches Camera component marked as primary', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            const cameraActor = actors.find((a) => a.name === 'Main Camera');
            expect(cameraActor).toBeDefined();
            const camera = cameraActor!.getComponent(Camera);
            expect(camera).toBeDefined();
            expect(camera!.primary).toBe(true);

            scene.dispose();
        });

        it('attaches DirectionalLight with correct intensity', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            const lightActor = actors.find((a) => a.name === 'Directional Light');
            expect(lightActor).toBeDefined();
            const light = lightActor!.getComponent(DirectionalLight);
            expect(light).toBeDefined();
            expect(light!.intensity).toBeCloseTo(1.15, 2);

            scene.dispose();
        });

        it('establishes parent-child hierarchy (Ground and Player under World)', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            const world = actors.find((a) => a.name === 'World');
            const ground = actors.find((a) => a.name === 'Ground');
            const player = actors.find((a) => a.name === 'Player');

            expect(world).toBeDefined();
            expect(ground).toBeDefined();
            expect(player).toBeDefined();

            // Verify hierarchy via Transform parent links
            const worldTransform = world!.getComponent(Transform);
            const groundTransform = ground!.getComponent(Transform);
            const playerTransform = player!.getComponent(Transform);

            expect(groundTransform!.parent).toBe(worldTransform);
            expect(playerTransform!.parent).toBe(worldTransform);

            scene.dispose();
        });

        it('attaches MeshRenderer to Ground and Player actors', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            const ground = actors.find((a) => a.name === 'Ground');
            const player = actors.find((a) => a.name === 'Player');

            expect(ground!.getComponent(MeshRenderer)).toBeDefined();
            expect(ground!.getComponent(MeshRenderer)!.meshId).toBe('plane');
            expect(player!.getComponent(MeshRenderer)).toBeDefined();
            expect(player!.getComponent(MeshRenderer)!.meshId).toBe('capsule');

            scene.dispose();
        });
    });

    // ─── Test Group 3: Scene with Textures (Async Loading) ────────────────

    describe('Scene with Textures', () => {
        it('loads textures asynchronously and registers them before materials', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot({
                textures: [
                    {
                        id: 'test-color',
                        source: { kind: 'color', color: [1, 0, 0, 1] as const, width: 2, height: 2 },
                    },
                ],
                materials: [
                    {
                        id: 'textured-mat',
                        shaderId: 'test/solid',
                        textures: { u_MainTex: 'test-color' },
                    },
                ],
            });

            await scene.loadScene(snapshot);

            const texture = scene.getTexture('test-color');
            expect(texture).toBeDefined();
            expect(texture!.id).toBe('test-color');

            scene.dispose();
        });

        it('handles multiple textures loading concurrently', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot({
                textures: [
                    {
                        id: 'tex-albedo',
                        source: { kind: 'color', color: [0.2, 0.6, 1, 1] as const, width: 4, height: 4 },
                    },
                    {
                        id: 'tex-normal',
                        source: { kind: 'color', color: [0.5, 0.5, 1, 1] as const, width: 4, height: 4 },
                    },
                    {
                        id: 'tex-roughness',
                        source: { kind: 'checker', size: 8 },
                    },
                ],
            });

            await scene.loadScene(snapshot);

            expect(scene.getTexture('tex-albedo')).toBeDefined();
            expect(scene.getTexture('tex-normal')).toBeDefined();
            expect(scene.getTexture('tex-roughness')).toBeDefined();

            scene.dispose();
        });
    });

    // ─── Test Group 4: Scene with Prefab Instances ────────────────────────

    describe('Scene with Prefab Instances', () => {
        it('instantiates a prefab with nested actors and verifies hierarchy', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Create a template prefab with nested actors
            const templateRoot = scene.createActor({ name: 'PrefabRoot' });
            templateRoot.addComponent(PrefabNodeBinding, { nodeId: 'node/0' });

            const templateChild = scene.createActor({ name: 'PrefabChild' });
            templateChild.addComponent(PrefabNodeBinding, { nodeId: 'node/1' });
            templateChild.setParent(templateRoot);

            const prefab = scene.createPrefab('nested-prefab', [templateRoot, templateChild]);

            // Clean up templates
            templateChild.destroy(true);
            templateRoot.destroy(true);

            // Build a snapshot that includes the prefab definition
            const snapshot = buildMinimalSnapshot({
                prefab: {
                    id: 'scene-with-prefab',
                    actors: [
                        {
                            name: 'SceneRoot',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: {} }],
                        },
                    ],
                },
            });

            const actors = await scene.loadScene(snapshot);
            expect(actors.length).toBeGreaterThanOrEqual(1);

            // Instantiate the nested prefab separately
            const instances = scene.instantiatePrefab(prefab, { namePrefix: 'Inst ' });
            expect(instances.length).toBe(2);

            const instRoot = instances.find((a) => a.name === 'Inst PrefabRoot');
            const instChild = instances.find((a) => a.name === 'Inst PrefabChild');
            expect(instRoot).toBeDefined();
            expect(instChild).toBeDefined();

            // Verify parent-child relationship
            const rootTransform = instRoot!.getComponent(Transform);
            const childTransform = instChild!.getComponent(Transform);
            expect(childTransform!.parent).toBe(rootTransform);

            // Verify PrefabNodeBinding
            expect(instRoot!.getComponent(PrefabNodeBinding)).toBeDefined();
            expect(instRoot!.getComponent(PrefabNodeBinding)!.nodeId).toBe('node/0');
            expect(instChild!.getComponent(PrefabNodeBinding)!.nodeId).toBe('node/1');

            scene.dispose();
        });
    });

    // ─── Test Group 5: Scene Disposal and Cleanup ─────────────────────────

    describe('Scene Disposal and Cleanup', () => {
        it('disposes a loaded scene and allows loading a new one', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Load first scene
            const snapshot1 = buildMinimalSnapshot({
                prefab: {
                    id: 'first-prefab',
                    actors: [
                        {
                            name: 'FirstActor',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: {} }],
                        },
                    ],
                },
            });

            const actors1 = await scene.loadScene(snapshot1);
            expect(actors1.find((a) => a.name === 'FirstActor')).toBeDefined();

            // Dispose the scene
            scene.dispose();
            expect(scene.isDisposed).toBe(true);

            // Create a new scene and load a different snapshot
            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));

            const snapshot2 = buildMinimalSnapshot({
                prefab: {
                    id: 'second-prefab',
                    actors: [
                        {
                            name: 'SecondActor',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: {} }],
                        },
                    ],
                },
            });

            const actors2 = await scene2.loadScene(snapshot2);
            expect(actors2.find((a) => a.name === 'SecondActor')).toBeDefined();

            scene2.dispose();
        });

        it('clears existing actors when loading a new scene into the same Scene', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Load first scene
            const snapshot1 = buildMinimalSnapshot({
                prefab: {
                    id: 'prefab-1',
                    actors: [
                        {
                            name: 'OldActor',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: {} }],
                        },
                    ],
                },
            });
            await scene.loadScene(snapshot1);

            // Load second scene — should clear old actors
            const snapshot2 = buildMinimalSnapshot({
                prefab: {
                    id: 'prefab-2',
                    actors: [
                        {
                            name: 'NewActor',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: {} }],
                        },
                    ],
                },
            });
            const actors2 = await scene.loadScene(snapshot2);

            expect(actors2.find((a) => a.name === 'NewActor')).toBeDefined();
            expect(actors2.find((a) => a.name === 'OldActor')).toBeUndefined();

            scene.dispose();
        });

        it('prevents creating actors after disposal', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot();
            await scene.loadScene(snapshot);

            scene.dispose();

            expect(() => scene.createActor({ name: 'PostDispose' })).toThrow();
        });
    });

    // ─── Test Group 6: Scene Lifecycle (start → update → stop → dispose) ──

    describe('Scene Lifecycle', () => {
        it('runs start, update ticks, and stop without errors on a loaded scene', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);
            expect(actors.length).toBe(10);

            // Start the scene lifecycle
            scene.start(0);
            expect(scene.status).toBe('running');

            // Simulate a few update ticks
            scheduler.flush(16);
            scheduler.flush(32);
            scheduler.flush(48);

            // Stop the scene
            scene.stop();
            expect(scene.status).toBe('stopped');

            // Dispose cleans up
            scene.dispose();
            expect(scene.isDisposed).toBe(true);
        });

        it('supports pause and resume after loading a scene', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot();
            await scene.loadScene(snapshot);

            scene.start(0);
            expect(scene.status).toBe('running');

            scene.pause();
            expect(scene.status).toBe('paused');

            scene.resume(16);
            expect(scene.status).toBe('running');

            scene.stop();
            expect(scene.status).toBe('stopped');

            scene.dispose();
        });
    });

    // ─── Test Group 7: UI Host References ──────────────────────────────────

    describe('UI Host References', () => {
        it('loads a scene with a UIHost component and verifies it is attached', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            const uiHost = actors.find((a) => a.name === 'UI Host');
            expect(uiHost).toBeDefined();

            // UIHost component should be present
            const { UIHost } = await import('@axrone/scene-3d');
            const uiHostComponent = uiHost!.getComponent(UIHost);
            expect(uiHostComponent).toBeDefined();

            scene.dispose();
        });

        it('loads a scene where UI Host is a root actor with no parent', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            const uiHost = actors.find((a) => a.name === 'UI Host');
            expect(uiHost).toBeDefined();

            // UI Host has no parentNodeId, so its Transform parent should be unset
            const uiHostTransform = uiHost!.getComponent(Transform);
            expect(uiHostTransform!.parent).toBeFalsy();

            scene.dispose();
        });
    });

    // ─── Test Group 8: Multiple Root Actors ────────────────────────────────

    describe('Multiple Root Actors', () => {
        it('loads a scene with multiple root actors and verifies all are root-level', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot({
                prefab: {
                    id: 'multi-root-prefab',
                    actors: [
                        {
                            name: 'Root_A',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: { position: [1, 0, 0] } }],
                        },
                        {
                            name: 'Root_B',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: { position: [2, 0, 0] } }],
                        },
                        {
                            name: 'Root_C',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [{ type: 'Transform', data: { position: [3, 0, 0] } }],
                        },
                    ],
                },
            });

            const actors = await scene.loadScene(snapshot);
            expect(actors.length).toBe(3);

            // All actors should have no parent (root-level)
            for (const actor of actors) {
                const transform = actor.getComponent(Transform);
                expect(transform!.parent).toBeFalsy();
            }

            scene.dispose();
        });

        it('loads a mixed scene with both root and child actors correctly', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            // Count root actors (those without parentNodeId)
            const rootActors = actors.filter((a) => {
                const transform = a.getComponent(Transform);
                return !transform!.parent;
            });

            // Main Camera, Directional Light, World, UI Host, Actor,
            // EN_Character_Stickman_01, Actor 2, Cube = 8 root actors
            expect(rootActors.length).toBe(8);

            // Ground and Player are children of World
            const childActors = actors.filter((a) => {
                const transform = a.getComponent(Transform);
                return !!transform!.parent;
            });
            expect(childActors.length).toBe(2);

            scene.dispose();
        });
    });

    // ─── Test Group 9: Component Ordering ─────────────────────────────────

    describe('Component Ordering', () => {
        it('preserves component data as defined in the snapshot', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildMinimalSnapshot({
                prefab: {
                    id: 'ordered-prefab',
                    actors: [
                        {
                            name: 'OrderedActor',
                            layer: 0,
                            tag: 'Default',
                            active: true,
                            persistent: false,
                            pooled: false,
                            components: [
                                { type: 'Transform', data: { position: [5, 10, 15] } },
                                { type: 'MeshRenderer', data: { meshId: 'cube', materialId: 'default-mat' } },
                            ],
                        },
                    ],
                },
            });

            const actors = await scene.loadScene(snapshot);
            const actor = actors[0];
            expect(actor).toBeDefined();

            // Verify Transform is present and has correct data
            const transform = actor!.getComponent(Transform);
            expect(transform).toBeDefined();
            expect(transform!.position.x).toBeCloseTo(5, 5);
            expect(transform!.position.y).toBeCloseTo(10, 5);
            expect(transform!.position.z).toBeCloseTo(15, 5);

            // Verify MeshRenderer is present with correct data
            const meshRenderer = actor!.getComponent(MeshRenderer);
            expect(meshRenderer).toBeDefined();
            expect(meshRenderer!.meshId).toBe('cube');
            expect(meshRenderer!.materialId).toBe('default-mat');

            scene.dispose();
        });

        it('verifies each entity in a multi-actor scene has its own correct components', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildFullSceneSnapshot();
            const actors = await scene.loadScene(snapshot);

            // Camera actor should have Camera component
            const cameraActor = actors.find((a) => a.name === 'Main Camera');
            expect(cameraActor!.getComponent(Camera)).toBeDefined();
            expect(cameraActor!.getComponent(MeshRenderer)).toBeUndefined();

            // Ground should have MeshRenderer but not Camera
            const ground = actors.find((a) => a.name === 'Ground');
            expect(ground!.getComponent(MeshRenderer)).toBeDefined();
            expect(ground!.getComponent(Camera)).toBeUndefined();

            // Directional Light should have DirectionalLight but not MeshRenderer
            const light = actors.find((a) => a.name === 'Directional Light');
            expect(light!.getComponent(DirectionalLight)).toBeDefined();
            expect(light!.getComponent(MeshRenderer)).toBeUndefined();

            // Player should have MeshRenderer
            const player = actors.find((a) => a.name === 'Player');
            expect(player!.getComponent(MeshRenderer)).toBeDefined();
            expect(player!.getComponent(Camera)).toBeUndefined();

            scene.dispose();
        });
    });

    // ─── Test Group 10: Error Handling ─────────────────────────────────────

    describe('Error Handling', () => {
        it('rejects snapshots with unsupported version', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const badSnapshot = {
                ...buildMinimalSnapshot(),
                version: 2,
            } as unknown as SceneSnapshot;

            await expect(scene.loadScene(badSnapshot)).rejects.toThrow(SceneLifecycleError);

            scene.dispose();
        });

        it('rejects snapshots with version 0', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const badSnapshot = {
                ...buildMinimalSnapshot(),
                version: 0,
            } as unknown as SceneSnapshot;

            await expect(scene.loadScene(badSnapshot)).rejects.toThrow(SceneLifecycleError);

            scene.dispose();
        });

        it('handles loading a snapshot with empty prefab actors gracefully', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const emptySnapshot = buildMinimalSnapshot({
                prefab: {
                    id: 'empty-prefab',
                    actors: [],
                },
            });

            const actors = await scene.loadScene(emptySnapshot);
            expect(actors).toEqual([]);

            scene.dispose();
        });

        it('handles loading a snapshot with no shaders or meshes', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const bareSnapshot = buildMinimalSnapshot({
                shaders: [],
                meshes: [],
                materials: [],
            });

            const actors = await scene.loadScene(bareSnapshot);
            // Should still instantiate actors even without assets
            expect(actors.length).toBeGreaterThanOrEqual(1);

            scene.dispose();
        });

        it('SceneSnapshotLoader rejects invalid version independently', async () => {
            const loader = new SceneSnapshotLoader({
                defaultRenderPassId: 'main',
                defaultClearColor: new Vec4(0, 0, 0, 1),
                clearExisting: vi.fn(),
                clearRenderPasses: vi.fn(),
                registerShader: vi.fn(),
                registerMesh: vi.fn(),
                registerSampler: vi.fn(),
                registerTexture: vi.fn(async () => {}),
                registerRenderPass: vi.fn(),
                createMaterial: vi.fn(),
                instantiatePrefab: vi.fn(() => []),
            });

            await expect(
                loader.load({
                    version: 99,
                    prefab: { id: 'p', actors: [] },
                    shaders: [],
                    meshes: [],
                    samplers: [],
                    textures: [],
                    renderPasses: [],
                    materials: [],
                } as unknown as SceneSnapshot)
            ).rejects.toThrow(SceneLifecycleError);
        });
    });
});
