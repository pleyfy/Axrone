import { Component, Scene, Transform, Vec3 } from '@axrone/core';
import { Quat } from '@axrone/numeric';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

class CubeSpin extends Component {
    private _elapsed = 0;

    update(deltaTime: number): void {
        this._elapsed += deltaTime;

        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return;
        }

        transform.rotation = Quat.fromEuler(
            this._elapsed * 0.00045,
            this._elapsed * 0.0008,
            0
        );
    }
}

const colorCubeSceneExample: SceneExample = {
    id: 'scene-color-cube',
    title: 'Color Cube Spin',
    description:
        'Tek box mesh uzerinde alti yuzu farkli renge boyayip sabit kamera ile temiz bir sekilde gosterir.',
    tags: ['camera', 'mesh', 'shader', 'rotation'],
    order: 3,
    mount({ container }: ExampleContext) {
        container.replaceChildren();

        const scene = new Scene({
            width: container.clientWidth || 1280,
            height: container.clientHeight || 720,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
            clearColor: [0.02, 0.03, 0.05, 1],
        });

        scene.registerComponent(CubeSpin);

        scene.registerShader({
            id: 'examples/color-cube',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_LocalNormal;
out vec3 v_WorldNormal;
void main() {
    v_LocalNormal = normalize(a_Normal);
    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform vec3 u_LightDirection;
uniform float u_AmbientStrength;
in vec3 v_LocalNormal;
in vec3 v_WorldNormal;
out vec4 o_Color;

vec3 faceColor(vec3 normal) {
    vec3 n = normalize(normal);
    vec3 absN = abs(n);

    if (absN.x > absN.y && absN.x > absN.z) {
        return n.x > 0.0 ? vec3(0.99, 0.76, 0.19) : vec3(0.17, 0.82, 0.47);
    }

    if (absN.y > absN.x && absN.y > absN.z) {
        return n.y > 0.0 ? vec3(0.72, 0.34, 0.95) : vec3(0.98, 0.48, 0.78);
    }

    return n.z > 0.0 ? vec3(0.93, 0.23, 0.23) : vec3(0.14, 0.72, 0.98);
}

void main() {
    vec3 base = faceColor(v_LocalNormal);
    vec3 normal = normalize(v_WorldNormal);
    float diffuse = max(dot(normal, normalize(-u_LightDirection)), 0.0);
    float lighting = u_AmbientStrength + diffuse * 0.7;
    o_Color = vec4(base * lighting, 1.0);
}`,
            uniforms: [
                'u_Model',
                'u_View',
                'u_Projection',
                'u_LightDirection',
                'u_AmbientStrength',
            ],
        });

        scene.createBoxMesh('color-cube-mesh', 1.8, 1.8, 1.8);
        scene.createMaterial({
            id: 'color-cube-material',
            shaderId: 'examples/color-cube',
            uniforms: {
                u_LightDirection: [-0.45, -0.7, -0.35],
                u_AmbientStrength: 0.42,
            },
        });

        const cube = scene.createRenderableActor(
            { name: 'ColorCube' },
            { meshId: 'color-cube-mesh', materialId: 'color-cube-material' }
        );
        const cubeTransform = cube.requireComponent(Transform);
        cubeTransform.position = new Vec3(0, 0, -4);
        cube.addComponent(CubeSpin);

        const camera = scene.createCameraActor(
            { name: 'MainCamera' },
            { primary: true, fieldOfView: 50 }
        );
        const cameraTransform = camera.requireComponent(Transform);
        cameraTransform.position = new Vec3(0, 0.8, 1.8);
        cameraTransform.rotation = Quat.fromLookAt(
            cameraTransform.position,
            cubeTransform.position,
            Vec3.UP,
            new Quat()
        );

        const cleanupResize = bindSceneToContainer(scene, container, 1280, 720);
        const root = globalThis as { scene?: Scene };
        root.scene = scene;

        return {
            dispose() {
                cleanupResize();
                if (root.scene === scene) {
                    delete root.scene;
                }
                scene.dispose();
                container.replaceChildren();
            },
        };
    },
};

export default colorCubeSceneExample;
