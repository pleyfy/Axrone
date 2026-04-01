import { Component, Scene, Transform, Vec3, script } from '@axrone/core';
import { Quat } from '@axrone/numeric';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

/**
 * Player movement controller using WASD keys
 */
@script({ scriptName: 'PlayerController' })
class PlayerController extends Component {
    private readonly _speed = 5;
    private readonly _rotationSpeed = 10;
    private readonly _pressedKeys = new Set<string>();

    awake(): void {
        const onKeyDown = (event: KeyboardEvent) => this._pressedKeys.add(event.code);
        const onKeyUp = (event: KeyboardEvent) => this._pressedKeys.delete(event.code);

        globalThis.addEventListener('keydown', onKeyDown);
        globalThis.addEventListener('keyup', onKeyUp);

        // Store cleanup in component
        (this as any)._cleanupInput = () => {
            globalThis.removeEventListener('keydown', onKeyDown);
            globalThis.removeEventListener('keyup', onKeyUp);
        };
    }

    update(deltaTime: number): void {
        const transform = this.transform as Transform | undefined;
        if (!transform) return;

        const moveX =
            (this._pressedKeys.has('KeyD') ? 1 : 0) -
            (this._pressedKeys.has('KeyA') ? 1 : 0);
        const moveZ =
            (this._pressedKeys.has('KeyS') ? 1 : 0) -
            (this._pressedKeys.has('KeyW') ? 1 : 0);

        if (moveX !== 0 || moveZ !== 0) {
            const deltaSeconds = deltaTime / 1000;
            const direction = new Vec3(moveX, 0, moveZ).normalize();
            const speed = this._speed * deltaSeconds;
            const movement = new Vec3(
                direction.x * speed,
                direction.y * speed,
                direction.z * speed
            );

            const position = transform.position.clone();
            position.x += movement.x;
            position.z += movement.z;
            transform.position = position;

            // Rotate to face movement direction
            const targetYaw = Math.atan2(direction.x, direction.z);
            const currentRotation = transform.rotation.toEuler();
            const deltaYaw = Math.atan2(
                Math.sin(targetYaw - currentRotation.y),
                Math.cos(targetYaw - currentRotation.y)
            );
            const newYaw =
                currentRotation.y + deltaYaw * Math.min(1, this._rotationSpeed * deltaSeconds);
            transform.rotation = Quat.fromEuler(0, newYaw, 0);
        }
    }

    onDestroy(): void {
        (this as any)._cleanupInput?.();
    }
}

/**
 * Smooth camera follow controller
 */
@script({ scriptName: 'CameraFollow' })
class CameraFollow extends Component {
    private _target?: Transform;
    private readonly _offset: Vec3;
    private readonly _damping: number;

    constructor(offset: Vec3 = new Vec3(0, 3, 6), damping: number = 8) {
        super();
        this._offset = offset;
        this._damping = damping;
    }

    setTarget(target: Transform): void {
        this._target = target;
    }

    lateUpdate(deltaTime: number): void {
        if (!this._target) return;

        const cameraTransform = this.transform as Transform | undefined;
        if (!cameraTransform) return;

        // Calculate target position
        const targetPosition = this._target.position.clone().add(this._offset);

        // Smooth follow using lerp
        const deltaSeconds = deltaTime / 1000;
        const t = Math.min(1, this._damping * deltaSeconds);

        const currentPos = cameraTransform.position;
        const newPos = Vec3.lerp(currentPos, targetPosition, t);
        cameraTransform.position = newPos;

        // Always look at the target
        const lookAt = this._target.position.clone().add(new Vec3(0, 0.5, 0));
        cameraTransform.rotation = Quat.fromLookAt(
            newPos,
            lookAt,
            Vec3.UP,
            new Quat()
        );
    }
}

/**
 * Example: Follow Cube Controller
 * Shows WASD movement with smooth camera follow on a grid plane
 */
const followCubeSceneExample: SceneExample = {
    id: 'scene-follow-cube',
    title: 'Follow Cube Controller',
    description:
        'WASD movement with smooth camera follow. A colored cube moves on a grid plane with third-person camera.',
    tags: ['input', 'camera', 'controller', 'movement'],
    order: 4,
    mount({ container }: ExampleContext) {
        container.replaceChildren();

        const scene = new Scene({
            width: container.clientWidth || 1280,
            height: container.clientHeight || 720,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
            clearColor: [0.035, 0.045, 0.06, 1],
        });

        // Register custom components
        scene.registerComponent(PlayerController);
        scene.registerComponent(CameraFollow);

        // Shader for the colored cube (each face has different color based on normal)
        scene.registerShader({
            id: 'examples/follow-cube',
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
        return n.x > 0.0 ? vec3(0.98, 0.73, 0.18) : vec3(0.18, 0.83, 0.49);
    }

    if (absN.y > absN.x && absN.y > absN.z) {
        return n.y > 0.0 ? vec3(0.74, 0.38, 0.97) : vec3(0.98, 0.48, 0.76);
    }

    return n.z > 0.0 ? vec3(0.96, 0.25, 0.27) : vec3(0.17, 0.69, 0.98);
}

void main() {
    vec3 base = faceColor(v_LocalNormal);
    vec3 normal = normalize(v_WorldNormal);
    float diffuse = max(dot(normal, normalize(-u_LightDirection)), 0.0);
    float lighting = u_AmbientStrength + diffuse * 0.75;
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

        // Shader for grid plane
        scene.registerShader({
            id: 'examples/ground-grid',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_UV0;
out vec3 v_WorldNormal;
void main() {
    v_UV0 = a_UV0;
    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform vec3 u_LightDirection;
uniform vec3 u_BaseColor;
uniform vec3 u_LineColor;
in vec2 v_UV0;
in vec3 v_WorldNormal;
out vec4 o_Color;

void main() {
    vec2 gridUv = v_UV0 * 18.0;
    vec2 cell = abs(fract(gridUv - 0.5) - 0.5) / fwidth(gridUv);
    float line = 1.0 - min(min(cell.x, cell.y), 1.0);
    float diffuse = max(dot(normalize(v_WorldNormal), normalize(-u_LightDirection)), 0.0);
    vec3 base = mix(u_BaseColor, u_LineColor, line * 0.55);
    vec3 lit = base * (0.42 + diffuse * 0.58);
    o_Color = vec4(lit, 1.0);
}`,
            uniforms: [
                'u_Model',
                'u_View',
                'u_Projection',
                'u_LightDirection',
                'u_BaseColor',
                'u_LineColor',
            ],
        });

        // Create meshes
        scene.createBoxMesh('controller-cube', 1.8, 1.8, 1.8);
        scene.createPlaneMesh('ground-plane', 28, 28);

        // Create materials
        scene.createMaterial({
            id: 'controller-cube-material',
            shaderId: 'examples/follow-cube',
            uniforms: {
                u_LightDirection: [-0.55, -0.75, -0.35],
                u_AmbientStrength: 0.42,
            },
        });

        scene.createMaterial({
            id: 'ground-grid-material',
            shaderId: 'examples/ground-grid',
            uniforms: {
                u_LightDirection: [-0.55, -0.75, -0.35],
                u_BaseColor: [0.1, 0.14, 0.18],
                u_LineColor: [0.28, 0.35, 0.42],
            },
        });

        // Create ground plane
        const ground = scene.createRenderableActor(
            { name: 'Ground' },
            { meshId: 'ground-plane', materialId: 'ground-grid-material' }
        );
        ground.requireComponent(Transform).position = new Vec3(0, -0.9, 0);

        // Create player cube with controller
        const player = scene.createRenderableActor(
            { name: 'Player' },
            { meshId: 'controller-cube', materialId: 'controller-cube-material' }
        );
        const playerTransform = player.requireComponent(Transform);
        playerTransform.position = new Vec3(0, 0, 0);
        player.addComponent(PlayerController);

        // Create follow camera
        const camera = scene.createCameraActor(
            { name: 'FollowCamera' },
            { primary: true, fieldOfView: 52 }
        );
        const cameraTransform = camera.requireComponent(Transform);
        cameraTransform.position = new Vec3(0, 3, 6);

        // Add camera follow component and set target
        const cameraFollow = camera.addComponent(CameraFollow);
        cameraFollow.setTarget(playerTransform);

        // Setup resize handler
        const cleanupResize = bindSceneToContainer(scene, container, 1280, 720);

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

export default followCubeSceneExample;
