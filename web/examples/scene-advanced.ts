import {
    DirectionalLight,
    FilterMode,
    OrbitCameraController,
    Scene,
    TextureFormat,
    Transform,
    WrapMode,
    createUnlitColorShaderDefinition,
} from '@axrone/core';
import { Quat, Vec3 } from '@axrone/numeric';

const scene = new Scene({
    width: 1280,
    height: 720,
    autoStart: true,
    ambientLight: [0.1, 0.12, 0.16],
    renderPasses: [
        {
            id: 'main',
            order: 0,
            rendererPassId: 'main',
            clearFlags: ['color', 'depth'],
            clearColor: [0.03, 0.04, 0.06, 1],
        },
        {
            id: 'overlay',
            order: 1,
            rendererPassId: 'overlay',
            clearFlags: [],
            blend: true,
            depthTest: false,
            cull: false,
        },
    ],
});

scene.registerShader({
    id: 'examples/lit-textured',
    vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_Normal;
out vec2 v_UV0;
void main() {
    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
    v_Normal = mat3(u_Model) * a_Normal;
    v_UV0 = a_UV0;
    gl_Position = u_Projection * u_View * worldPosition;
}`,
    fragmentSource: `#version 300 es
precision highp float;
uniform sampler2D u_MainTex;
uniform vec3 u_LightDirection;
uniform vec3 u_LightColor;
uniform vec3 u_AmbientLight;
uniform bool u_ReceiveLighting;
in vec3 v_Normal;
in vec2 v_UV0;
out vec4 o_Color;
void main() {
    vec3 albedo = texture(u_MainTex, v_UV0 * 2.0).rgb;
    vec3 normal = normalize(v_Normal);
    float ndl = max(dot(normalize(-u_LightDirection), normal), 0.0);
    vec3 direct = u_ReceiveLighting ? u_LightColor * ndl : vec3(0.0);
    vec3 lighting = u_AmbientLight + direct;
    o_Color = vec4(albedo * lighting, 1.0);
}`,
    uniforms: [
        'u_Model',
        'u_View',
        'u_Projection',
        'u_MainTex',
        'u_LightDirection',
        'u_LightColor',
        'u_AmbientLight',
        'u_ReceiveLighting',
    ],
});

scene.registerShader(createUnlitColorShaderDefinition('examples/overlay'));

scene.registerSampler({
    id: 'linear-repeat',
    minFilter: FilterMode.LINEAR,
    magFilter: FilterMode.LINEAR,
    wrapS: WrapMode.REPEAT,
    wrapT: WrapMode.REPEAT,
});

await scene.registerTexture({
    id: 'floor-checker',
    format: TextureFormat.RGBA8,
    samplerId: 'linear-repeat',
    source: {
        kind: 'checker',
        size: 8,
        colorA: [0.12, 0.15, 0.2, 1],
        colorB: [0.84, 0.88, 0.95, 1],
    },
});

await scene.registerTexture({
    id: 'accent',
    format: TextureFormat.RGBA8,
    source: {
        kind: 'color',
        color: [0.92, 0.52, 0.16, 1],
        width: 2,
        height: 2,
    },
});

scene.createMaterial({
    id: 'lit-floor',
    shaderId: 'examples/lit-textured',
    textures: {
        u_MainTex: {
            textureId: 'floor-checker',
            samplerId: 'linear-repeat',
        },
    },
});

scene.createMaterial({
    id: 'lit-accent',
    shaderId: 'examples/lit-textured',
    textures: {
        u_MainTex: 'accent',
    },
});

scene.createMaterial({
    id: 'overlay-ribbon',
    shaderId: 'examples/overlay',
    uniforms: {
        u_Color: [0.94, 0.58, 0.18, 0.5],
    },
});

scene.createPlaneMesh('floor', 8, 8);
scene.createBoxMesh('box', 1.1, 1.1, 1.1);
scene.createPlaneMesh('overlay-quad', 1.75, 0.2);

const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true, fieldOfView: 55 });
cameraActor.addComponent(OrbitCameraController, {
    distance: 6,
    azimuth: 0.9,
    elevation: 0.35,
    target: [0, 0.4, -3],
    autoRotateSpeed: 0.2,
});

const sun = scene.createActor({ name: 'Sun' });
sun.addComponent(DirectionalLight, {
    color: [1, 0.96, 0.9],
    intensity: 1.2,
    primary: true,
});
sun.requireComponent(Transform).rotation = Quat.fromEuler(-0.65, 0.85, 0);

const floor = scene.createRenderableActor(
    { name: 'Floor' },
    { meshId: 'floor', materialId: 'lit-floor', passId: 'main' }
);
floor.requireComponent(Transform).position = new Vec3(0, -1, -3);
floor.requireComponent(Transform).rotation = Quat.fromEuler(-Math.PI * 0.5, 0, 0);

const cube = scene.createRenderableActor(
    { name: 'AccentBox' },
    { meshId: 'box', materialId: 'lit-accent', passId: 'main' }
);
cube.requireComponent(Transform).position = new Vec3(0, 0.3, -3);

const overlay = scene.createRenderableActor(
    { name: 'OverlayRibbon' },
    {
        meshId: 'overlay-quad',
        materialId: 'overlay-ribbon',
        passId: 'overlay',
        receiveLighting: false,
    }
);
overlay.requireComponent(Transform).position = new Vec3(0, -1.15, -1.5);

const prefab = scene.createPrefab('examples/advanced-scene');
const snapshot = scene.serializeScene();

const root = globalThis as {
    scene?: Scene;
    scenePrefab?: typeof prefab;
    sceneSnapshot?: typeof snapshot;
    spawnPrefab?: () => readonly unknown[];
    reloadScene?: () => Promise<readonly unknown[]>;
};

root.scene = scene;
root.scenePrefab = prefab;
root.sceneSnapshot = snapshot;
root.spawnPrefab = () => scene.instantiatePrefab(prefab, { namePrefix: 'Clone:' });
root.reloadScene = () => scene.loadScene(snapshot);
