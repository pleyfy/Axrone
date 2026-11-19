import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { PrefabNodeBinding } from '@axrone/scene-prefab';

import {
    PROFILE_IDS,
    PROFILE_MODULE_CATALOG,
    TEMPLATE_2D_COMPONENT_EXPORTS,
    TEMPLATE_DEFINITIONS,
} from '../../../../export-templates/module-catalog.mjs';
import { createAxroneBoot, resolveSceneProfile } from '../../../../export-templates/boot-factory';

// The exact set the Editor preview registers for a 2D scene
// (Editor/src/lib/editor/preview/preview-runtime-build.ts :: PREVIEW_2D_COMPONENT_TYPES).
// The export templates must reach 100% parity with this list or an exported
// scene can fail to instantiate a component the preview could play.
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

const templateById = (id: string) =>
    TEMPLATE_DEFINITIONS.find((definition) => definition.id === id);

const exportsForTemplate = (id: string): string[] =>
    (templateById(id)?.engineComponents ?? []).flatMap((set) => set.exports);

describe('export-template 2D component registration parity', () => {
    it('catalogs every 2D preview component type in the shared list', () => {
        expect([...TEMPLATE_2D_COMPONENT_EXPORTS].sort()).toEqual(
            [...PREVIEW_2D_COMPONENT_TYPES].sort()
        );
    });

    it('registers the full 2D set for web-2d', () => {
        const registered = exportsForTemplate('web-2d');
        for (const type of PREVIEW_2D_COMPONENT_TYPES) {
            expect(registered).toContain(type);
        }
        // Sprite components come from @axrone/scene-2d, physics from @axrone/physics-2d.
        const modules = new Set(
            (templateById('web-2d')?.engineComponents ?? []).map((set) => set.module)
        );
        expect(modules).toContain('@axrone/physics-2d');
        expect(modules).toContain('@axrone/scene-2d');
    });

    it('registers the full 2D set alongside the 3D set for web-full', () => {
        const registered = exportsForTemplate('web-full');
        for (const type of PREVIEW_2D_COMPONENT_TYPES) {
            expect(registered).toContain(type);
        }
        // Retained 3D capabilities must not regress.
        expect(registered).toContain('Rigidbody3D');
        expect(registered).toContain('AudioSourceComponent');
        expect(registered).toContain('UIHost');
    });

    it('keeps web-2d free of 3D-only component modules', () => {
        const modules = (templateById('web-2d')?.engineComponents ?? []).map((set) => set.module);
        expect(modules).not.toContain('@axrone/physics-3d');
        expect(modules).not.toContain('@axrone/audio');
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
