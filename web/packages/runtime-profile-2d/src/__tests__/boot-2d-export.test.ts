import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { PrefabNodeBinding } from '@axrone/scene-prefab';

import {
    PROFILE_IDS,
    PROFILE_MODULE_CATALOG,
    TEMPLATE_2D_COMPONENT_EXPORTS,
    TEMPLATE_DEFINITIONS,
} from '../../../../export-templates/module-catalog.mjs';
import { createAxroneBoot, resolveSceneProfile } from '../../../../export-templates/boot-factory';

// The authoritative Editor preview registration split
// (Editor/src/lib/editor/preview/preview-runtime-build.ts). PREVIEW_SHARED_
// COMPONENT_TYPES is registered for EVERY profile, including 2D, so audio counts
// as part of what a 2D scene can instantiate in the preview.
const PREVIEW_2D_COMPONENT_TYPES = [
    'SpriteRenderer',
    'Rigidbody2D',
    'BoxCollider2D',
    'CircleCollider2D',
    'CapsuleCollider2D',
    'PolygonCollider2D',
    'PhysicsWorld2DComponent',
    'SpriteAnimator',
    'SpriteMask',
    'DistanceJoint2D',
    'FixedJoint2D',
    'HingeJoint2D',
    'SliderJoint2D',
    'SpringJoint2D',
    'WheelJoint2D',
    'MotorJoint2D',
    'MouseJoint2D',
    'GearJoint2D',
    'RopeJoint2D',
];

// The Editor preview registers these for every scene profile, so they are part
// of what a 2D scene can instantiate in the preview.
const PREVIEW_SHARED_COMPONENT_TYPES = ['AudioSourceComponent', 'AudioListenerComponent'];

// ParticleSystem is also in the preview's shared set but its owner module is
// @axrone/scene-3d/support, a 3D-only package; pulling it into web-2d would pin
// the whole 3D surface into the smallest template. It is the one component the
// parity guard below intentionally tolerates.
const PREVIEW_2D_PARITY_EXCLUSIONS = ['ParticleSystem'];

// The exact contract for web-2d: the sprite/physics set the Editor registers for
// a 2D profile, plus tilemap and UIHost which the template hosts ahead of the
// preview, plus the shared audio pair the preview already registers in 2D.
const WEB_2D_EXPECTED_COMPONENT_EXPORTS = Object.freeze([
    ...PREVIEW_2D_COMPONENT_TYPES,
    'TilemapRenderer',
    'TilemapCollider2D',
    'TilemapAgent',
    'UIHost',
    ...PREVIEW_SHARED_COMPONENT_TYPES,
]);

const templateById = (id: string) =>
    TEMPLATE_DEFINITIONS.find((definition) => definition.id === id);

const exportsForTemplate = (id: string): string[] =>
    (templateById(id)?.engineComponents ?? []).flatMap((set) => set.exports);

describe('export-template 2D component registration parity', () => {
    it('catalogs exactly the declared web-2d component contract', () => {
        expect([...TEMPLATE_2D_COMPONENT_EXPORTS].sort()).toEqual(
            [...WEB_2D_EXPECTED_COMPONENT_EXPORTS].sort()
        );
    });

    it('registers every component the Editor preview registers for a 2D profile', () => {
        const registered = new Set(exportsForTemplate('web-2d'));
        const previewSet = [
            ...PREVIEW_2D_COMPONENT_TYPES,
            ...PREVIEW_SHARED_COMPONENT_TYPES,
        ].filter((type) => !PREVIEW_2D_PARITY_EXCLUSIONS.includes(type));
        expect(previewSet.every((type) => registered.has(type))).toBe(true);
    });

    it('registers the full 2D set for web-2d', () => {
        const registered = new Set(exportsForTemplate('web-2d'));
        expect(PREVIEW_2D_COMPONENT_TYPES.every((type) => registered.has(type))).toBe(true);
        const modules = new Set(
            (templateById('web-2d')?.engineComponents ?? []).map((set) => set.module)
        );
        const expectedModules = [
            '@axrone/physics-2d',
            '@axrone/scene-2d',
            '@axrone/scene-2d/tilemap',
            '@axrone/scene-runtime/scene-facade',
            '@axrone/audio',
        ];
        expect(expectedModules.every((module) => modules.has(module))).toBe(true);
    });

    it('registers tilemap, UI and audio capabilities for web-2d', () => {
        const registered = new Set(exportsForTemplate('web-2d'));
        const expectedTypes = [
            'TilemapRenderer',
            'TilemapCollider2D',
            'TilemapAgent',
            'UIHost',
            ...PREVIEW_SHARED_COMPONENT_TYPES,
        ];
        expect(expectedTypes.every((type) => registered.has(type))).toBe(true);
        // The boot UI binding resolves through this module in the runtime map.
        expect(PROFILE_MODULE_CATALOG['2d']).toContain('@axrone/ui-webgl2/scene-host');
    });

    it('registers the full 2D set alongside the 3D set for web-full', () => {
        const registered = new Set(exportsForTemplate('web-full'));
        expect(PREVIEW_2D_COMPONENT_TYPES.every((type) => registered.has(type))).toBe(true);
        // Retained 3D capabilities must not regress.
        const expectedTypes = [
            'Rigidbody3D',
            'AudioSourceComponent',
            'UIHost',
            'TilemapRenderer',
            'TilemapCollider2D',
            'TilemapAgent',
        ];
        expect(expectedTypes.every((type) => registered.has(type))).toBe(true);
        expect(PROFILE_MODULE_CATALOG.full).toContain('@axrone/tilemap');
    });

    it('keeps web-2d free of 3D-only component modules', () => {
        // WHY: '@axrone/audio' used to be listed here as if it were 3D-only. The
        // Editor registers AudioSourceComponent/AudioListenerComponent for every
        // profile via PREVIEW_SHARED_COMPONENT_TYPES, so a 2D export that omitted
        // them was the parity bug, not the guarantee. The guard now only rejects
        // modules whose package is genuinely 3D-only.
        const modules = (templateById('web-2d')?.engineComponents ?? []).map((set) => set.module);
        expect(modules).not.toContain('@axrone/physics-3d');
        expect(modules).not.toContain('@axrone/scene-3d/support');
    });

    it('emits one import statement per component module for every template', () => {
        for (const definition of TEMPLATE_DEFINITIONS) {
            const modules = (definition.engineComponents ?? []).map((set) => set.module);
            expect(new Set(modules).size).toBe(modules.length);
        }
    });

    it('backs every registered component module with a catalogued package', () => {
        // Subpath specifiers (e.g. '@axrone/scene-runtime/scene-facade') resolve
        // through their parent package, which is what PROFILE_MODULE_CATALOG lists.
        const basePackage = (specifier: string): string =>
            specifier.split('/').slice(0, 2).join('/');

        const assertCovered = (templateId: string, catalog: readonly string[]) => {
            const packages = new Set(catalog.map(basePackage));
            for (const set of templateById(templateId)?.engineComponents ?? []) {
                expect(packages.has(basePackage(set.module))).toBe(true);
            }
        };

        assertCovered('web-2d', PROFILE_MODULE_CATALOG['2d']);
        assertCovered('web-full', PROFILE_MODULE_CATALOG.full);
    });

    it('exposes the 2D scene profile id used by the boot bridge resolver', () => {
        expect(PROFILE_IDS['2d']).toBe('scene/2d-default');
    });
});

describe('boot 2D physics bridge profile resolution', () => {
    const snapshotWith = (types: string[]) => ({
        prefab: { actors: [{ components: types.map((type) => ({ type })) }] },
    });

    it('arms the 2D profile for a 2D-only snapshot', () => {
        const profile = resolveSceneProfile(
            snapshotWith(['SpriteRenderer', 'Rigidbody2D', 'BoxCollider2D', 'HingeJoint2D'])
        );
        expect(profile?.id).toBe('scene/2d-default');
    });

    it('arms the mixed profile when both 2D and 3D components are present', () => {
        const profile = resolveSceneProfile(
            snapshotWith(['SpriteRenderer', 'Rigidbody2D', 'MeshRenderer', 'Rigidbody3D'])
        );
        expect(profile?.id).toBe('scene/mixed-default');
    });

    it('leaves a 3D-only snapshot on the facade default', () => {
        const profile = resolveSceneProfile(snapshotWith(['MeshRenderer', 'Rigidbody3D']));
        expect(profile).toBeUndefined();
    });

    it('arms the 2D profile for a tilemap-only snapshot', () => {
        // Tilemap content carries no sprite or rigidbody, so it has to be a
        // discriminator on its own or the 2D bridge never arms and
        // TilemapCollider2D cannot resolve the bridge world.
        const profile = resolveSceneProfile(
            snapshotWith(['TilemapRenderer', 'TilemapCollider2D', 'TilemapAgent'])
        );
        expect(profile?.id).toBe('scene/2d-default');
    });

    it('arms the mixed profile when tilemap content shares a scene with 3D', () => {
        const profile = resolveSceneProfile(
            snapshotWith(['TilemapRenderer', 'MeshRenderer', 'Rigidbody3D'])
        );
        expect(profile?.id).toBe('scene/mixed-default');
    });

    it('honors an explicit scene profile id when the snapshot yields no signal', () => {
        expect(resolveSceneProfile({}, 'scene/2d-default')?.id).toBe('scene/2d-default');
        expect(resolveSceneProfile({}, 'scene/mixed-default')?.id).toBe('scene/mixed-default');
        // Template ids (what game-data actually stores) must NOT force a bridge.
        expect(resolveSceneProfile({}, '@axrone/runtime-profile-full')).toBeUndefined();
    });
});

type FakeActor = {
    getComponent: (type: unknown) => unknown;
    getAllComponents: () => readonly unknown[];
};

const buildFakeScene = (actors: readonly FakeActor[], captured: Record<string, unknown>[]) => ({
    canvas: { style: {} as Record<string, string> },
    world: { getAllActors: () => actors },
    registerComponent: () => undefined,
    loadScene: async () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
    _captured: captured,
});

const makeGameData = (snapshot: unknown, componentStates: unknown[] = []) => ({
    schemaVersion: 1,
    engine: { version: '0.0.0', profileId: '@axrone/runtime-profile-full' },
    project: { name: 't', sceneName: 's' },
    presentation: { backgroundColor: '#000', width: 1280, height: 720 },
    environment: {
        clearColor: [0, 0, 0, 1] as const,
        ambientLight: [0, 0, 0] as const,
        skyLight: [0, 0, 0] as const,
        groundLight: [0, 0, 0] as const,
    },
    snapshot,
    componentStates,
    cameraEntityId: null,
    scripts: [],
    uiAssets: {},
    warnings: [],
});

describe('createAxroneBoot 2D wiring', () => {
    let resizeObserverSpy: unknown;

    beforeAll(() => {
        resizeObserverSpy = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        // happy-dom does not implement ResizeObserver; stub it for the boot path.
        (globalThis as Record<string, unknown>).ResizeObserver = resizeObserverSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes the resolved 2D profile into createScene and applies component enabled states', async () => {
        const rigidbody = { enabled: true, constructor: { name: 'Rigidbody2D' } };
        const animator = { enabled: true, constructor: { name: 'SpriteAnimator' } };
        const actors: FakeActor[] = [
            {
                getComponent: (type: unknown) =>
                    type === PrefabNodeBinding ? { nodeId: 'node-1' } : null,
                getAllComponents: () => [rigidbody, animator],
            },
        ];

        const captured: Record<string, unknown>[] = [];
        const boot = createAxroneBoot({
            createScene: (options) => {
                captured.push(options);
                return buildFakeScene(actors, captured) as never;
            },
            engineComponentTypes: [],
        });

        const handle = await boot({
            container: document.createElement('div'),
            scriptTypes: [],
            data: makeGameData(
                { prefab: { actors: [{ components: [{ type: 'SpriteRenderer' }, { type: 'Rigidbody2D' }] }] } },
                [
                    {
                        nodeId: 'node-1',
                        states: [
                            { type: 'Rigidbody2D', occurrenceIndex: 0, enabled: false },
                            { type: 'SpriteAnimator', occurrenceIndex: 0, enabled: false },
                        ],
                    },
                ]
            ),
        });

        // web-full boot of a 2D scene must install the 2D profile (=> PhysicsBridge2D).
        const sceneOptions = captured[0];
        expect(sceneOptions).toBeDefined();
        expect((sceneOptions.profile as { id?: string } | undefined)?.id).toBe('scene/2d-default');

        // applyComponentStates must toggle pooled 2D components after loadScene.
        expect(rigidbody.enabled).toBe(false);
        expect(animator.enabled).toBe(false);

        handle.dispose();
    });

    it('does not force a profile for a 3D-only snapshot', async () => {
        const captured: Record<string, unknown>[] = [];
        const boot = createAxroneBoot({
            createScene: (options) => {
                captured.push(options);
                return buildFakeScene([], captured) as never;
            },
            engineComponentTypes: [],
        });

        const handle = await boot({
            container: document.createElement('div'),
            scriptTypes: [],
            data: makeGameData({
                prefab: { actors: [{ components: [{ type: 'MeshRenderer' }] }] },
            }),
        });

        expect(captured[0]?.profile).toBeUndefined();
        handle.dispose();
    });
});
