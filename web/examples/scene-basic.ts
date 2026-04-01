import { Component, Scene, Camera, MeshRenderer, Transform, Vec3 } from '@axrone/core';

class OrbitMotion extends Component {
    private _elapsed = 0;
    private readonly _radius: number;
    private readonly _speed: number;

    constructor(radius: number = 0.75, speed: number = 0.0012) {
        super();
        this._radius = radius;
        this._speed = speed;
    }

    update(deltaTime: number): void {
        this._elapsed += deltaTime;
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return;
        }

        const t = this._elapsed * this._speed;
        transform.position = new Vec3(Math.cos(t) * this._radius, Math.sin(t * 1.5) * 0.35, -4);
    }
}

const scene = new Scene({
    width: 960,
    height: 540,
    autoStart: true,
});

scene.registerComponent(OrbitMotion);

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

scene.createBoxMesh('box');
scene.createMaterial({
    id: 'box-material',
    shaderId: 'examples/time-color',
    uniforms: {
        u_Color: [0.14, 0.72, 0.98, 1],
    },
});

scene.createCameraActor({ name: 'MainCamera' }, { primary: true, fieldOfView: 60 });

const box = scene.createRenderableActor(
    { name: 'Box' },
    { meshId: 'box', materialId: 'box-material' }
);

box.addComponent(OrbitMotion);
box.requireComponent(Transform).position = new Vec3(0, 0, -4);

(globalThis as { scene?: Scene }).scene = scene;