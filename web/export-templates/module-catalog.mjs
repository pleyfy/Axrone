const CORE_MODULES = [
    '@axrone/ecs-runtime',
    '@axrone/ecs-runtime/query',
    '@axrone/ecs-runtime/storage',
    '@axrone/ecs-runtime/support',
    '@axrone/event',
    '@axrone/game-loop',
    '@axrone/numeric',
    '@axrone/observer',
    '@axrone/random',
    '@axrone/utility',
    '@axrone/render-core',
    '@axrone/render-webgl2',
    '@axrone/scene-runtime',
    '@axrone/scene-runtime/prefab',
    '@axrone/scene-prefab',
    '@axrone/animation',
    '@axrone/input',
    '@axrone/tween',
    '@axrone/geometry',
    '@axrone/raycast',
    '@axrone/runtime-profile-core',
];

const MODULES_2D = [
    '@axrone/scene-2d',
    '@axrone/asset-2d',
    '@axrone/render-2d',
    '@axrone/physics-core',
    '@axrone/physics-2d',
    '@axrone/shapes-2d',
    '@axrone/tilemap',
    '@axrone/ui',
    '@axrone/audio',
    '@axrone/ui-webgl2/scene-host',
    '@axrone/runtime-profile-2d',
];

const MODULES_3D = [
    '@axrone/scene-3d',
    '@axrone/scene-3d/facade',
    '@axrone/scene-3d/support',
    '@axrone/asset-core',
    '@axrone/asset-gltf',
    '@axrone/asset-shader',
    '@axrone/asset-ui',
    '@axrone/render-3d',
    '@axrone/physics-core',
    '@axrone/physics-3d',
    '@axrone/lighting',
    '@axrone/terrain',
    '@axrone/ui-webgl2',
    '@axrone/ui-webgl2/scene-host',
    '@axrone/audio',
    '@axrone/particle-system',
    '@axrone/scene-runtime-gltf',
    '@axrone/runtime-profile-3d',
];

const dedupe = (modules) => [...new Set(modules)];

// 2D engine components registered by the templates that can host 2D content.
// Relationship to the Editor preview build:
//   - The sprite/physics set is an exact match for PREVIEW_2D_COMPONENT_TYPES,
//     so nothing the preview can instantiate may be missing from a 2D export.
//   - AudioSourceComponent/AudioListenerComponent are part of the preview's
//     PREVIEW_SHARED_COMPONENT_TYPES, which is registered for every profile
//     including 2D; the template was behind and now matches.
//   - TilemapRenderer/TilemapCollider2D/TilemapAgent and UIHost are a deliberate
//     superset: the template already hosts them while the preview does not
//     register them yet, so a 2D scene exported with tilemap or UI content works.
//   - ParticleSystem stays out; its owner module lives in @axrone/scene-3d/support,
//     a 3D-only package, and pinning it would drag the 3D surface into web-2d.
// Registration is idempotent, so re-declaring the built-in sprites is a
// guarantee, not a duplicate cost.
const PHYSICS_2D_COMPONENTS = [
    'PhysicsWorld2DComponent',
    'Rigidbody2D',
    'BoxCollider2D',
    'CircleCollider2D',
    'CapsuleCollider2D',
    'PolygonCollider2D',
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

const SCENE_2D_COMPONENTS = ['SpriteRenderer', 'SpriteAnimator', 'SpriteMask'];

const TILEMAP_2D_COMPONENTS = ['TilemapRenderer', 'TilemapCollider2D', 'TilemapAgent'];

const AUDIO_SHARED_COMPONENTS = ['AudioSourceComponent', 'AudioListenerComponent'];

const ENGINE_COMPONENTS_2D = Object.freeze([
    { module: '@axrone/physics-2d', exports: PHYSICS_2D_COMPONENTS },
    { module: '@axrone/scene-2d', exports: SCENE_2D_COMPONENTS },
    { module: '@axrone/scene-2d/tilemap', exports: TILEMAP_2D_COMPONENTS },
    { module: '@axrone/scene-runtime/scene-facade', exports: ['UIHost'] },
    { module: '@axrone/audio', exports: AUDIO_SHARED_COMPONENTS },
]);

const ENGINE_COMPONENTS_3D = Object.freeze([
    { module: '@axrone/physics-3d', exports: ['Rigidbody3D', 'BoxCollider3D', 'CapsuleCollider3D', 'HingeJoint3D'] },
    { module: '@axrone/audio', exports: AUDIO_SHARED_COMPONENTS },
    { module: '@axrone/scene-3d/support', exports: ['ParticleSystem'] },
    { module: '@axrone/scene-runtime/scene-facade', exports: ['UIHost'] },
]);

// The build script emits one `import { ... } from 'module'` statement per entry,
// so a template that combines two component sets must not list the same module
// twice. Bindings are unioned per module and modules keep first-seen order.
const mergeEngineComponentSets = (...sets) => {
    const merged = new Map();
    for (const set of sets.flat()) {
        const existing = merged.get(set.module);
        if (existing) {
            for (const name of set.exports) {
                if (!existing.includes(name)) {
                    existing.push(name);
                }
            }
        } else {
            merged.set(set.module, [...set.exports]);
        }
    }
    return Object.freeze(
        [...merged].map(([module, exports]) => Object.freeze({ module, exports: Object.freeze(exports) }))
    );
};

export const PROFILE_MODULE_CATALOG = Object.freeze({
    '2d': dedupe([...CORE_MODULES, ...MODULES_2D]),
    '3d': dedupe([...CORE_MODULES, ...MODULES_3D]),
    full: dedupe([...CORE_MODULES, ...MODULES_2D, ...MODULES_3D, '@axrone/runtime-profile-full']),
});

export const PROFILE_IDS = Object.freeze({
    '2d': 'scene/2d-default',
    '3d': 'scene/3d-default',
    full: 'scene/3d-full',
});

export const TEMPLATE_DEFINITIONS = Object.freeze([
    {
        id: 'web-2d',
        profile: '2d',
        sceneFacadeModule: '@axrone/scene-2d',
        sceneFacadeExport: 'Scene2D',
        engineComponents: ENGINE_COMPONENTS_2D,
    },
    {
        id: 'web-3d',
        profile: '3d',
        sceneFacadeModule: '@axrone/scene-3d/facade',
        sceneFacadeExport: 'Scene',
        engineComponents: ENGINE_COMPONENTS_3D,
    },
    {
        id: 'web-full',
        profile: 'full',
        sceneFacadeModule: '@axrone/scene-3d/facade',
        sceneFacadeExport: 'Scene',
        // web-full is the only template that must be able to host a 2D, 3D or
        // mixed scene from a single bundle, so it registers the union of the 3D
        // and 2D component sets. The 2D bridge is armed at boot from the scene
        // snapshot (see boot-factory resolveSceneProfile).
        engineComponents: mergeEngineComponentSets(ENGINE_COMPONENTS_3D, ENGINE_COMPONENTS_2D),
    },
]);

export const TEMPLATE_2D_COMPONENT_EXPORTS = Object.freeze(
    ENGINE_COMPONENTS_2D.flatMap((set) => set.exports)
);
