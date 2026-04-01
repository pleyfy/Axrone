import { Component, Scene, Transform, Vec3, script } from '@axrone/core';
import { Quat } from '@axrone/numeric';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

/**
 * Player movement controller using WASD keys
 */
@script({ scriptName: 'PlayerController' })
class PlayerController extends Component {
    public speed = 5;
    public rotationSpeed = 10;
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
            const speed = this.speed * deltaSeconds;
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
                currentRotation.y + deltaYaw * Math.min(1, this.rotationSpeed * deltaSeconds);
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
    public offset: Vec3;
    public lookAtOffset: Vec3 = new Vec3(0, 0.5, 0);
    public damping: number;
    private _distanceMultiplier: number = 1.0;

    // Zoom limits
    private readonly _minZoom: number = 0.2;
    private readonly _maxZoom: number = 4.0;

    constructor(offset: Vec3 = new Vec3(0, 6, 10), damping: number = 8) {
        super();
        this.offset = offset;
        this.damping = damping;
    }

    awake(): void {
        const onWheel = (e: WheelEvent) => {
            // Adjust zoom based on scroll
            const zoomAmount = e.deltaY * 0.001;
            this._distanceMultiplier += zoomAmount;
            
            // Clamp zoom to prevent going too close or too far
            this._distanceMultiplier = Math.max(this._minZoom, Math.min(this._maxZoom, this._distanceMultiplier));
        };
        
        globalThis.addEventListener('wheel', onWheel, { passive: false });
        
        (this as any)._cleanupInput = () => {
            globalThis.removeEventListener('wheel', onWheel);
        };
    }

    setTarget(target: Transform): void {
        this._target = target;
    }

    lateUpdate(deltaTime: number): void {
        if (!this._target) return;

        const cameraTransform = this.transform as Transform | undefined;
        if (!cameraTransform) return;

        // Apply scale to offset for zoom effect
        const scaledOffset = new Vec3(
            this.offset.x * this._distanceMultiplier,
            this.offset.y * this._distanceMultiplier,
            this.offset.z * this._distanceMultiplier
        );

        // Calculate target camera position
        const targetPosition = this._target.position.clone().add(scaledOffset);

        // Professional frame-independent smooth damping
        const deltaSeconds = deltaTime / 1000;
        const t = 1.0 - Math.exp(-this.damping * deltaSeconds);

        const currentPos = cameraTransform.position;
        const newPos = Vec3.lerp(currentPos, targetPosition, t) as Vec3;
        cameraTransform.position = newPos;

        // Look at the target with lookAtOffset
        const lookAt = this._target.position.clone().add(this.lookAtOffset);
        cameraTransform.rotation = Quat.fromLookAt(
            newPos,
            lookAt,
            Vec3.UP,
            new Quat()
        );
    }
    
    onDestroy(): void {
        (this as any)._cleanupInput?.();
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

        // Shader for grid plane with light color
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
    vec2 gridUv = v_UV0 * 10.0;
    vec2 cell = abs(fract(gridUv - 0.5) - 0.5) / fwidth(gridUv);
    float line = 1.0 - min(min(cell.x, cell.y), 1.0);
    float diffuse = max(dot(normalize(v_WorldNormal), normalize(-u_LightDirection)), 0.0);
    vec3 base = mix(u_BaseColor, u_LineColor, line * 0.6);
    vec3 lit = base * (0.5 + diffuse * 0.5);
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
        scene.createPlaneMesh('ground-plane', 100, 100);

        // Create materials
        scene.createMaterial({
            id: 'controller-cube-material',
            shaderId: 'examples/follow-cube',
            uniforms: {
                u_LightDirection: [-0.55, -0.75, -0.35],
                u_AmbientStrength: 0.42,
            },
        });

        // Light gray/white ground with subtle grid lines
        scene.createMaterial({
            id: 'ground-grid-material',
            shaderId: 'examples/ground-grid',
            uniforms: {
                u_LightDirection: [-0.55, -0.75, -0.35],
                u_BaseColor: [0.85, 0.85, 0.85],
                u_LineColor: [0.65, 0.65, 0.65],
            },
        });

        // Create ground plane - rotated to be flat
        const ground = scene.createRenderableActor(
            { name: 'Ground' },
            { meshId: 'ground-plane', materialId: 'ground-grid-material' }
        );
        const groundTransform = ground.requireComponent(Transform);
        groundTransform.position = new Vec3(0, -0.9, 0);
        groundTransform.rotation = Quat.fromEuler(-Math.PI / 2, 0, 0);

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
            { primary: true, fieldOfView: 60 }
        );
        const cameraTransform = camera.requireComponent(Transform);
        cameraTransform.position = new Vec3(0, 8, 12);

        // Add camera follow component with default offset that can be tweaked via UI
        const cameraFollow = camera.addComponent(CameraFollow, new Vec3(0, 6, 10), 4);
        cameraFollow.setTarget(playerTransform);
        cameraFollow.lookAtOffset = new Vec3(0, 0.5, 0);

        // Create professional GUI panel
        const uiPanel = document.createElement('div');
        Object.assign(uiPanel.style, {
            position: 'absolute',
            top: '15px',
            right: '15px',
            backgroundColor: 'rgba(15, 15, 20, 0.9)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '0',
            borderRadius: '8px',
            color: '#e0e0e0',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '12px',
            zIndex: '1000',
            width: '280px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            padding: '12px 16px',
            fontWeight: '600',
            fontSize: '13px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
        });
        header.innerHTML = '⚙️ Scene Controls <span style="color:#4CAF50; font-size:10px; font-weight:800; letter-spacing:1px;">PRO</span>';
        uiPanel.appendChild(header);

        const content = document.createElement('div');
        Object.assign(content.style, {
            padding: '16px',
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto'
        });
        uiPanel.appendChild(content);

        // Helper to create sections
        const addSection = (title: string) => {
            const h = document.createElement('div');
            Object.assign(h.style, {
                fontWeight: '600',
                color: '#fff',
                marginBottom: '12px',
                marginTop: content.children.length > 0 ? '16px' : '0',
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                paddingBottom: '4px'
            });
            h.innerText = title;
            content.appendChild(h);
        };

        // Helper to create sliders
        const addSlider = (label: string, min: number, max: number, step: number, val: number, onChange: (v: number) => void) => {
            const row = document.createElement('div');
            Object.assign(row.style, { marginBottom: '10px' });
            
            const info = document.createElement('div');
            Object.assign(info.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: '#aaa' });
            
            const title = document.createElement('span');
            title.innerText = label;
            
            const valueLabel = document.createElement('span');
            valueLabel.innerText = val.toFixed(step >= 1 ? 0 : 1);
            valueLabel.style.color = '#fff';
            valueLabel.style.fontFamily = 'SFMono-Regular, "Liberation Mono", Menlo, monospace';
            
            info.appendChild(title);
            info.appendChild(valueLabel);
            row.appendChild(info);
            
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = min.toString();
            slider.max = max.toString();
            slider.step = step.toString();
            slider.value = val.toString();
            Object.assign(slider.style, { width: '100%', cursor: 'pointer', margin: 0 });
            
            slider.addEventListener('input', (e) => {
                const num = parseFloat((e.target as HTMLInputElement).value);
                valueLabel.innerText = num.toFixed(step >= 1 ? 0 : 1);
                onChange(num);
            });
            
            row.appendChild(slider);
            content.appendChild(row);
        };

        addSection('🎥 Camera Position');
        addSlider('Offset X', -30, 30, 0.5, cameraFollow.offset.x, v => cameraFollow.offset.x = v);
        addSlider('Offset Y', -30, 30, 0.5, cameraFollow.offset.y, v => cameraFollow.offset.y = v);
        addSlider('Offset Z', -30, 30, 0.5, cameraFollow.offset.z, v => cameraFollow.offset.z = v);
        
        addSection('🎯 Camera Look-At');
        addSlider('Look Target X', -10, 10, 0.1, cameraFollow.lookAtOffset.x, v => cameraFollow.lookAtOffset.x = v);
        addSlider('Look Target Y', -10, 10, 0.1, cameraFollow.lookAtOffset.y, v => cameraFollow.lookAtOffset.y = v);
        addSlider('Look Target Z', -10, 10, 0.1, cameraFollow.lookAtOffset.z, v => cameraFollow.lookAtOffset.z = v);

        addSection('🚀 Camera Dynamics');
        addSlider('Smooth Damping', 1, 30, 0.5, cameraFollow.damping, v => cameraFollow.damping = v);

        const playerController = player.getComponent(PlayerController);
        if (playerController) {
            addSection('🎮 Player Settings');
            addSlider('Movement Speed', 1, 20, 0.5, playerController.speed, v => playerController.speed = v);
            addSlider('Rotation Speed', 1, 30, 0.5, playerController.rotationSpeed, v => playerController.rotationSpeed = v);
        }

        container.appendChild(uiPanel);

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
