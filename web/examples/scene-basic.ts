import { Component, Scene, Transform, Vec3, script } from '@axrone/core';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

/**
 * Simple orbital motion component - rotates around center
 */
@script({ scriptName: 'OrbitMotion' })
class OrbitMotion extends Component {
    private _elapsed = 0;

    constructor(
        private readonly _radius = 0.75,
        private readonly _speed = 0.0012
    ) {
        super();
    }

    update(deltaTime: number): void {
        this._elapsed += deltaTime;

        const transform = this.transform as Transform | undefined;
        if (!transform) return;

        const t = this._elapsed * this._speed;
        transform.position = new Vec3(
            Math.cos(t) * this._radius,
            Math.sin(t * 1.5) * 0.35,
            -4
        );
    }
}

/**
 * Example: Basic Scene
 * Minimal scene setup with single shader, mesh, and custom component
 */
const basicSceneExample: SceneExample = {
    id: 'scene-basic',
    title: 'Basic Scene',
    description:
        'Minimal scene demonstrating custom component with update lifecycle, single shader and mesh.',
    tags: ['scene', 'component', 'shader', 'basic'],
    order: 1,
    mount({ container }: ExampleContext) {
        container.replaceChildren();

        const scene = new Scene({
            width: container.clientWidth || 960,
            height: container.clientHeight || 540,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
        });

        // Register custom component
        scene.registerComponent(OrbitMotion);

        // Register shader with time-based pulsing color
        scene.registerShader({
            id: 'examples/time-color',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_UV0;
void main() {
    v_UV0 = a_UV0;
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
uniform float u_Time;
in vec2 v_UV0;
out vec4 o_Color;
void main() {
    float pulse = 0.6 + 0.4 * sin(u_Time * 2.0 + v_UV0.x * 6.28318);
    o_Color = vec4(u_Color.rgb * pulse, u_Color.a);
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Color', 'u_Time'],
        });

        // Create mesh and material
        scene.createBoxMesh('box');
        scene.createMaterial({
            id: 'box-material',
            shaderId: 'examples/time-color',
            uniforms: {
                u_Color: [0.14, 0.72, 0.98, 1],
            },
        });

        // Create camera
        scene.createCameraActor({ name: 'MainCamera' }, { primary: true, fieldOfView: 60 });

        // Create box actor with orbit motion
        const box = scene.createRenderableActor(
            { name: 'Box' },
            { meshId: 'box', materialId: 'box-material' }
        );

        box.addComponent(OrbitMotion);
        box.requireComponent(Transform).position = new Vec3(0, 0, -4);

        // Setup resize handler
        const cleanupResize = bindSceneToContainer(scene, container, 960, 540);

        // Expose scene globally for debugging
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

export default basicSceneExample;
