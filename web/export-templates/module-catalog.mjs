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
    '@axrone/ui',
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
// This list mirrors PREVIEW_2D_COMPONENT_TYPES in the Editor preview build
// exactly (physics-2d bodies/colliders/joints/world + scene-2d sprites) so an
// exported 2D or mixed scene can never fail to instantiate a component that the
// preview happily registered. Registration is idempotent, so re-declaring the
// built-in sprites is a guarantee, not a duplicate cost.
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

const ENGINE_COMPONENTS_2D = Object.freeze([
    { module: '@axrone/physics-2d', exports: PHYSICS_2D_COMPONENTS },
    { module: '@axrone/scene-2d', exports: SCENE_2D_COMPONENTS },
]);

const ENGINE_COMPONENTS_3D = Object.freeze([
    { module: '@axrone/physics-3d', exports: ['Rigidbody3D', 'BoxCollider3D', 'CapsuleCollider3D', 'HingeJoint3D'] },
    { module: '@axrone/audio', exports: ['AudioSourceComponent', 'AudioListenerComponent'] },
    { module: '@axrone/scene-3d/support', exports: ['ParticleSystem'] },
    { module: '@axrone/scene-runtime/scene-facade', exports: ['UIHost'] },
]);

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
        engineComponents: [...ENGINE_COMPONENTS_3D, ...ENGINE_COMPONENTS_2D],
    },
]);

export const TEMPLATE_2D_COMPONENT_EXPORTS = Object.freeze(
    ENGINE_COMPONENTS_2D.flatMap((set) => set.exports)
);
