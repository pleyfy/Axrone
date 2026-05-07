import { Component, Transform, script } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import { FollowCameraController, MeshRenderer } from '@axrone/scene-3d';
import {
	createAxesOverlay,
	createGridOverlay,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
	applyCameraPreset,
} from '@axrone/playground';
import type { PlaygroundCameraPreset, PlaygroundSceneHandle } from '../../shared/playground-types';

const FOLLOW_CLEAR_COLOR = [0.949, 0.941, 0.925, 1] as const;
const FOLLOW_AMBIENT = [0.39, 0.38, 0.35] as const;
const FOLLOW_KEY_LIGHT_DIRECTION = [-0.46, -0.82, -0.33] as const;
const FOLLOW_KEY_LIGHT_COLOR = [0.97, 0.92, 0.84] as const;
const FOLLOW_FILL_LIGHT_DIRECTION = [0.58, -0.4, 0.71] as const;
const FOLLOW_FILL_LIGHT_COLOR = [0.29, 0.32, 0.37] as const;
const FOLLOW_GRID_PRIMARY = [0.83, 0.8, 0.75] as const;
const FOLLOW_GRID_SECONDARY = [0.91, 0.89, 0.85] as const;
const FOLLOW_GRID_BACKGROUND = [0.957, 0.949, 0.937] as const;
const FOLLOW_LINE_COLOR = [0.18, 0.14, 0.12, 1] as const;

const FOLLOW_PLAYER_SHADER_ID = 'playground/follow-cube/player-shader';
const FOLLOW_PLAYER_MESH_ID = 'playground/follow-cube/player-mesh';
const FOLLOW_FLOOR_MESH_ID = 'playground/follow-cube/floor-mesh';
const FOLLOW_PLAYER_FILL_MATERIAL_ID = 'playground/follow-cube/player-fill';
const FOLLOW_PLAYER_WIRE_MATERIAL_ID = 'playground/follow-cube/player-wire';
const FOLLOW_FLOOR_FILL_MATERIAL_ID = 'playground/follow-cube/floor-fill';
const FOLLOW_FLOOR_WIRE_MATERIAL_ID = 'playground/follow-cube/floor-wire';

const FOLLOW_CUBE_SIZE = 1.8;
const FOLLOW_FLOOR_SIZE = 30;
const FOLLOW_MOVEMENT_LIMIT = 12.6;
const FOLLOW_MOVE_SPEED = 6.5;
const FOLLOW_ROTATION_DAMPING = 14;

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

class FollowCubeInput {
	private readonly pressedKeys = new Set<string>();
	private readonly handlePointerDown = () => {
		this.host.focus();
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (!MOVEMENT_KEYS.has(event.code)) {
			return;
		}

		event.preventDefault();
		this.pressedKeys.add(event.code);
	};

	private readonly handleKeyUp = (event: KeyboardEvent) => {
		if (!MOVEMENT_KEYS.has(event.code)) {
			return;
		}

		event.preventDefault();
		this.pressedKeys.delete(event.code);
	};

	private readonly handleBlur = () => {
		this.pressedKeys.clear();
	};

	constructor(private readonly host: HTMLElement) {
		this.host.tabIndex = 0;
		this.host.style.outline = 'none';
		this.host.addEventListener('pointerdown', this.handlePointerDown);
		this.host.addEventListener('keydown', this.handleKeyDown);
		this.host.addEventListener('keyup', this.handleKeyUp);
		this.host.addEventListener('blur', this.handleBlur);
	}

	isPressed(code: string): boolean {
		return this.pressedKeys.has(code);
	}

	dispose(): void {
		this.pressedKeys.clear();
		this.host.removeEventListener('pointerdown', this.handlePointerDown);
		this.host.removeEventListener('keydown', this.handleKeyDown);
		this.host.removeEventListener('keyup', this.handleKeyUp);
		this.host.removeEventListener('blur', this.handleBlur);
	}
}

@script({ scriptName: 'FollowCubeController' })
class FollowCubeController extends Component {
	public speed = FOLLOW_MOVE_SPEED;
	public rotationDamping = FOLLOW_ROTATION_DAMPING;
	private yaw = 0;

	constructor(private readonly input: FollowCubeInput) {
		super();
	}

	awake(): void {
		const transform = this.transform as Transform | undefined;
		if (!transform) {
			return;
		}

		const forward = Quat.rotateVector(transform.rotation, Vec3.FORWARD, new Vec3()) as Vec3;
		this.yaw = Math.atan2(forward.x, forward.z);
	}

	update(deltaTime: number): void {
		const transform = this.transform as Transform | undefined;
		if (!transform) {
			return;
		}

		const moveX =
			(this.input.isPressed('KeyD') ? 1 : 0) -
			(this.input.isPressed('KeyA') ? 1 : 0);
		const moveZ =
			(this.input.isPressed('KeyS') ? 1 : 0) -
			(this.input.isPressed('KeyW') ? 1 : 0);

		if (moveX === 0 && moveZ === 0) {
			return;
		}

		const deltaSeconds = Math.max(0, deltaTime / 1000);
		const direction = new Vec3(moveX, 0, moveZ);
		if (direction.lengthSquared() <= 1e-6) {
			return;
		}

		direction.normalize();
		const nextPosition = transform.position.clone();
		nextPosition.x = clamp(nextPosition.x + direction.x * this.speed * deltaSeconds, -FOLLOW_MOVEMENT_LIMIT, FOLLOW_MOVEMENT_LIMIT);
		nextPosition.y = FOLLOW_CUBE_SIZE * 0.5;
		nextPosition.z = clamp(nextPosition.z + direction.z * this.speed * deltaSeconds, -FOLLOW_MOVEMENT_LIMIT, FOLLOW_MOVEMENT_LIMIT);
		transform.position = nextPosition;

		const targetYaw = Math.atan2(direction.x, direction.z);
		const deltaYaw = Math.atan2(
			Math.sin(targetYaw - this.yaw),
			Math.cos(targetYaw - this.yaw),
		);
		this.yaw += deltaYaw * Math.min(1, this.rotationDamping * deltaSeconds);
		transform.rotation = Quat.fromEuler(0, this.yaw, 0);
	}
}

const applyFollowCameraPreset = (
	controller: FollowCameraController,
	preset: PlaygroundCameraPreset,
): void => {
	applyCameraPreset(controller as unknown as { azimuth: number; elevation: number }, preset);
	if (preset === 'perspective') {
		controller.distance = 10.5;
		controller.elevation = 0.48;
		controller.azimuth = 0;
		return;
	}

	if (preset === 'top') {
		controller.distance = 9;
		return;
	}

	controller.distance = 10.5;
};

export const createFollowCubeScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: FOLLOW_CLEAR_COLOR,
		ambientLight: FOLLOW_AMBIENT,
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/follow-cube');
	const input = new FollowCubeInput(container);

	scene.registerComponent(FollowCubeController);
	scene.createBoxMesh(FOLLOW_PLAYER_MESH_ID, FOLLOW_CUBE_SIZE, FOLLOW_CUBE_SIZE, FOLLOW_CUBE_SIZE);
	scene.createPlaneMesh(FOLLOW_FLOOR_MESH_ID, FOLLOW_FLOOR_SIZE, FOLLOW_FLOOR_SIZE);

	scene.registerShader({
		id: FOLLOW_PLAYER_SHADER_ID,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_LocalNormal;
out vec3 v_WorldNormal;
out vec3 v_WorldPosition;
void main() {
	v_LocalNormal = normalize(a_Normal);
	v_WorldNormal = normalize(mat3(u_Model) * a_Normal);
	vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
	v_WorldPosition = worldPosition.xyz;
	gl_Position = u_Projection * u_View * worldPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec3 u_AmbientColor;
uniform vec3 u_KeyLightDirection;
uniform vec3 u_KeyLightColor;
uniform vec3 u_FillLightDirection;
uniform vec3 u_FillLightColor;
uniform float u_RimStrength;
in vec3 v_LocalNormal;
in vec3 v_WorldNormal;
in vec3 v_WorldPosition;
out vec4 o_Color;

vec3 faceColor(vec3 normal) {
	vec3 n = normalize(normal);
	vec3 absNormal = abs(n);

	if (absNormal.x > absNormal.y && absNormal.x > absNormal.z) {
		return n.x > 0.0 ? vec3(0.98, 0.73, 0.18) : vec3(0.21, 0.81, 0.49);
	}

	if (absNormal.y > absNormal.x && absNormal.y > absNormal.z) {
		return n.y > 0.0 ? vec3(0.76, 0.38, 0.96) : vec3(0.99, 0.47, 0.73);
	}

	return n.z > 0.0 ? vec3(0.95, 0.28, 0.24) : vec3(0.18, 0.67, 0.98);
}

void main() {
	vec3 base = faceColor(v_LocalNormal);
	vec3 normal = normalize(v_WorldNormal);
	vec3 viewDirection = normalize(-v_WorldPosition);
	float keyDiffuse = max(dot(normal, normalize(-u_KeyLightDirection)), 0.0);
	float fillDiffuse = max(dot(normal, normalize(-u_FillLightDirection)), 0.0);
	float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.5) * u_RimStrength;
	vec3 lighting = u_AmbientColor + u_KeyLightColor * keyDiffuse + u_FillLightColor * fillDiffuse + vec3(rim * 0.14);
	o_Color = vec4(base * lighting, 1.0);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_AmbientColor',
			'u_KeyLightDirection',
			'u_KeyLightColor',
			'u_FillLightDirection',
			'u_FillLightColor',
			'u_RimStrength',
		],
	});

	const lightingUniforms = {
		u_AmbientColor: FOLLOW_AMBIENT,
		u_KeyLightDirection: FOLLOW_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: FOLLOW_KEY_LIGHT_COLOR,
		u_FillLightDirection: FOLLOW_FILL_LIGHT_DIRECTION,
		u_FillLightColor: FOLLOW_FILL_LIGHT_COLOR,
	} as const;

	scene.createMaterial({
		id: FOLLOW_PLAYER_FILL_MATERIAL_ID,
		shaderId: FOLLOW_PLAYER_SHADER_ID,
		uniforms: {
			...lightingUniforms,
			u_RimStrength: 0.22,
		},
	});
	scene.createMaterial({
		id: FOLLOW_PLAYER_WIRE_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: FOLLOW_LINE_COLOR },
		rasterizerState: { polygonMode: 'line', lineWidth: 1 },
	});
	scene.createMaterial({
		id: FOLLOW_FLOOR_FILL_MATERIAL_ID,
		shaderId: shaders.lit,
		uniforms: {
			u_Color: [0.938, 0.926, 0.902, 1],
			u_Shininess: 8,
			...lightingUniforms,
		},
	});
	scene.createMaterial({
		id: FOLLOW_FLOOR_WIRE_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: [0.39, 0.33, 0.28, 1] },
		rasterizerState: { polygonMode: 'line', lineWidth: 1 },
	});

	const camera = scene.createCameraActor(
		{ name: 'FollowCubeCamera' },
		{ primary: true, fieldOfView: 52 },
	);
	const followCamera = camera.addComponent(FollowCameraController, {
		targetOffset: [0, 0.95, 0],
		distance: 10.5,
		minDistance: 8,
		maxDistance: 13,
		azimuth: 0,
		elevation: 0.48,
		positionDamping: 5.5,
		targetDamping: 9,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/follow-cube',
		size: FOLLOW_FLOOR_SIZE,
		y: 0.02,
		scale: 1,
		color: FOLLOW_GRID_PRIMARY,
		gridColor: FOLLOW_GRID_SECONDARY,
		backgroundColor: FOLLOW_GRID_BACKGROUND,
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/follow-cube', length: 5 });
	axes.setVisible(false);

	const floorActor = scene.createRenderableActor(
		{ name: 'FollowCubeFloor' },
		{ meshId: FOLLOW_FLOOR_MESH_ID, materialId: FOLLOW_FLOOR_FILL_MATERIAL_ID },
	);
	floorActor.requireComponent(Transform).position = new Vec3(0, 0, 0);

	const playerActor = scene.createRenderableActor(
		{ name: 'FollowCubePlayer' },
		{ meshId: FOLLOW_PLAYER_MESH_ID, materialId: FOLLOW_PLAYER_FILL_MATERIAL_ID },
	);
	const playerTransform = playerActor.requireComponent(Transform);
	playerTransform.position = new Vec3(0, FOLLOW_CUBE_SIZE * 0.5, 0);
	playerActor.addComponent(FollowCubeController, input);

	followCamera.setTarget(playerTransform);

	const floorRenderer = floorActor.getComponent(MeshRenderer);
	const playerRenderer = playerActor.getComponent(MeshRenderer);
	if (!floorRenderer || !playerRenderer) {
		throw new Error('Follow cube scene renderers were not created correctly.');
	}

	const baseHandle = createPlaygroundHandle({
		container,
		scene,
		disposeScene: false,
		overlays: { grid, axes },
		disposeExtras: [() => input.dispose(), () => stage.dispose()],
		setWireframe(enabled: boolean) {
			playerRenderer.materialId = enabled ? FOLLOW_PLAYER_WIRE_MATERIAL_ID : FOLLOW_PLAYER_FILL_MATERIAL_ID;
			floorRenderer.materialId = enabled ? FOLLOW_FLOOR_WIRE_MATERIAL_ID : FOLLOW_FLOOR_FILL_MATERIAL_ID;
		},
		stats: () => ({
			objectCount: 2 + grid.actors.length + axes.actors.length,
			summary: 'WASD movement with follow camera',
		}),
	});

	return {
		...baseHandle,
		setCameraPreset(preset: PlaygroundCameraPreset) {
			applyFollowCameraPreset(followCamera, preset);
		},
	};
};