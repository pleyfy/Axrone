import { createBox, createCylinder, createRing, createRoundedBox } from '@axrone/geometry';
import { Component, Transform, script } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import { FollowCameraController, MeshRenderer } from '@axrone/scene-3d';
import {
	applyCameraPreset,
	createAxesOverlay,
	createContactShadow,
	createGridOverlay,
	createMeshBuilder,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
	registerStudioLitShader,
} from '@axrone/playground';
import type { PlaygroundCameraPreset, PlaygroundSceneHandle } from '../../shared/playground-types';

const FOLLOW_CLEAR_COLOR = [0.07, 0.045, 0.11, 0] as const;
const FOLLOW_AMBIENT = [0.36, 0.29, 0.36] as const;
const FOLLOW_KEY_LIGHT_DIRECTION = [-0.46, -0.82, -0.33] as const;
const FOLLOW_KEY_LIGHT_COLOR = [1, 0.78, 0.56] as const;
const FOLLOW_FILL_LIGHT_DIRECTION = [0.58, -0.4, 0.71] as const;
const FOLLOW_FILL_LIGHT_COLOR = [0.28, 0.42, 0.58] as const;
const FOLLOW_GRID_PRIMARY = [0.38, 0.24, 0.36] as const;
const FOLLOW_GRID_SECONDARY = [0.22, 0.15, 0.25] as const;
const FOLLOW_GRID_BACKGROUND = [0.1, 0.07, 0.13] as const;
const FOLLOW_FLOOR_COLOR = [0.18, 0.13, 0.2, 1] as const;
const FOLLOW_FLOOR_WIRE_COLOR = [0.48, 0.38, 0.52, 1] as const;
const FOLLOW_PLAYER_COLOR = [0.78, 0.28, 0.08, 1] as const;
const FOLLOW_PLAYER_RIM = [0.36, 0.84, 0.76] as const;
const FOLLOW_POST_COLOR = [0.2, 0.14, 0.24, 1] as const;
const FOLLOW_CAP_COLOR = [1, 0.52, 0.22, 1] as const;
const FOLLOW_ACCENT_COLOR = [1, 0.58, 0.26, 1] as const;

const FOLLOW_PLAYER_MESH_ID = 'playground/follow-cube/player-mesh';
const FOLLOW_ARENA_MESH_ID = 'playground/follow-cube/arena-mesh';
const FOLLOW_PLAYER_FILL_MATERIAL_ID = 'playground/follow-cube/player-fill';
const FOLLOW_PLAYER_WIRE_MATERIAL_ID = 'playground/follow-cube/player-wire';
const FOLLOW_FLOOR_FILL_MATERIAL_ID = 'playground/follow-cube/floor-fill';
const FOLLOW_FLOOR_WIRE_MATERIAL_ID = 'playground/follow-cube/floor-wire';

const FOLLOW_CUBE_SIZE = 1.8;
const FOLLOW_ARENA_RADIUS = 10.2;
const FOLLOW_ARENA_HEIGHT = 0.26;
const FOLLOW_MOVEMENT_LIMIT = 9.6;
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

	onLoad(): void {
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
		nextPosition.x = clamp(
			nextPosition.x + direction.x * this.speed * deltaSeconds,
			-FOLLOW_MOVEMENT_LIMIT,
			FOLLOW_MOVEMENT_LIMIT,
		);
		nextPosition.y = FOLLOW_CUBE_SIZE * 0.5;
		nextPosition.z = clamp(
			nextPosition.z + direction.z * this.speed * deltaSeconds,
			-FOLLOW_MOVEMENT_LIMIT,
			FOLLOW_MOVEMENT_LIMIT,
		);
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

type FollowCubeGroundingOptions = {
	readonly target: Transform;
	readonly height: number;
};

@script({ scriptName: 'FollowCubeGrounding' })
class FollowCubeGrounding extends Component {
	constructor(private readonly options: FollowCubeGroundingOptions) {
		super();
	}

	update(): void {
		const transform = this.transform as Transform | undefined;
		if (!transform) {
			return;
		}

		transform.position = new Vec3(
			this.options.target.position.x,
			this.options.height,
			this.options.target.position.z,
		);
	}
}

const applyFollowCameraPreset = (
	controller: FollowCameraController,
	preset: PlaygroundCameraPreset,
): void => {
	applyCameraPreset(controller as unknown as { azimuth: number; elevation: number }, preset);
	if (preset === 'perspective') {
		controller.distance = 12.5;
		controller.elevation = 0.48;
		controller.azimuth = 0;
		return;
	}

	if (preset === 'top') {
		controller.distance = 10;
		return;
	}

	controller.distance = 12.5;
};

export const createFollowCubeScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: FOLLOW_CLEAR_COLOR,
		ambientLight: FOLLOW_AMBIENT,
		background:
			'radial-gradient(80% 50% at 50% 42%, rgba(246, 160, 92, 0.46), rgba(246, 160, 92, 0) 64%), linear-gradient(180deg, #241732 0%, #4b3055 24%, #9a5b6b 38%, #f0a35e 47%, #2a1830 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/follow-cube');
	const studioShader = registerStudioLitShader(scene, 'playground/follow-cube/studio');
	const meshBuilder = createMeshBuilder();
	const input = new FollowCubeInput(container);

	scene.registerComponent(FollowCubeController);
	scene.registerComponent(FollowCubeGrounding);

	scene.registerMesh(
		meshBuilder.createDefinition(
			FOLLOW_PLAYER_MESH_ID,
			createRoundedBox({
				width: FOLLOW_CUBE_SIZE,
				height: FOLLOW_CUBE_SIZE,
				depth: FOLLOW_CUBE_SIZE,
				radius: 0.08,
				smoothness: 4,
			}),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			FOLLOW_ARENA_MESH_ID,
			createCylinder({
				radiusTop: FOLLOW_ARENA_RADIUS,
				radiusBottom: FOLLOW_ARENA_RADIUS + 0.15,
				height: FOLLOW_ARENA_HEIGHT,
				radialSegments: 128,
			}),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/follow-cube/boundary-ring',
			createRing({ innerRadius: 9.56, outerRadius: 9.64, segments: 160 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/follow-cube/center-ring',
			createRing({ innerRadius: 2.1, outerRadius: 2.16, segments: 96 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/follow-cube/edge-ring',
			createRing({ innerRadius: 10.1, outerRadius: 10.18, segments: 160 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/follow-cube/selection-ring',
			createRing({ innerRadius: 1.48, outerRadius: 1.55, segments: 96 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/follow-cube/post',
			createBox({ width: 0.24, height: 1.25, depth: 0.24 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/follow-cube/post-cap',
			createCylinder({ radiusTop: 0.34, radiusBottom: 0.34, height: 0.09, radialSegments: 24 }),
		),
	);

	scene.createMaterial({
		id: FOLLOW_PLAYER_FILL_MATERIAL_ID,
		shaderId: studioShader,
		uniforms: {
			u_Color: FOLLOW_PLAYER_COLOR,
			u_AmbientColor: FOLLOW_AMBIENT,
			u_KeyLightDirection: FOLLOW_KEY_LIGHT_DIRECTION,
			u_KeyLightColor: FOLLOW_KEY_LIGHT_COLOR,
			u_FillLightDirection: FOLLOW_FILL_LIGHT_DIRECTION,
			u_FillLightColor: FOLLOW_FILL_LIGHT_COLOR,
			u_RimColor: FOLLOW_PLAYER_RIM,
			u_RimStrength: 0.24,
			u_Shininess: 12,
		},
		passes: [
			{
				id: 'follow-cube-player-pass',
				primitive: 'triangle-list',
				rasterizerState: { cullMode: 'none' },
			},
		],
	});
	scene.createMaterial({
		id: FOLLOW_PLAYER_WIRE_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: [1, 0.78, 0.52, 1] },
		rasterizerState: { polygonMode: 'line', lineWidth: 1 },
	});
	scene.createMaterial({
		id: FOLLOW_FLOOR_FILL_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: FOLLOW_FLOOR_COLOR },
	});
	scene.createMaterial({
		id: FOLLOW_FLOOR_WIRE_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: FOLLOW_FLOOR_WIRE_COLOR },
		rasterizerState: { polygonMode: 'line', lineWidth: 1 },
	});
	scene.createMaterial({
		id: 'playground/follow-cube/post-material',
		shaderId: shaders.solid,
		uniforms: { u_Color: FOLLOW_POST_COLOR },
	});
	scene.createMaterial({
		id: 'playground/follow-cube/cap-material',
		shaderId: shaders.solid,
		uniforms: { u_Color: FOLLOW_CAP_COLOR },
	});

	const createAdditiveRingPass = (id: string) => ({
		id,
		primitive: 'triangle-list' as const,
		rasterizerState: { cullMode: 'none' as const },
		depthStencilState: { depthTest: true, depthWrite: false },
		blendState: {
			targets: [
				{
					blend: true,
					srcColorFactor: 'src-alpha' as const,
					dstColorFactor: 'one' as const,
					srcAlphaFactor: 'one' as const,
					dstAlphaFactor: 'one' as const,
				},
			],
		},
	});
	scene.createMaterial({
		id: 'playground/follow-cube/boundary-material',
		shaderId: shaders.solid,
		uniforms: { u_Color: [...FOLLOW_ACCENT_COLOR.slice(0, 3), 0.32] },
		surface: { alphaMode: 'blend' },
		passes: [createAdditiveRingPass('follow-cube-boundary-ring')],
	});
	scene.createMaterial({
		id: 'playground/follow-cube/center-material',
		shaderId: shaders.solid,
		uniforms: { u_Color: [...FOLLOW_ACCENT_COLOR.slice(0, 3), 0.22] },
		surface: { alphaMode: 'blend' },
		passes: [createAdditiveRingPass('follow-cube-center-ring')],
	});
	scene.createMaterial({
		id: 'playground/follow-cube/selection-material',
		shaderId: shaders.solid,
		uniforms: { u_Color: [...FOLLOW_PLAYER_RIM, 0.5] },
		surface: { alphaMode: 'blend' },
		passes: [createAdditiveRingPass('follow-cube-selection-ring')],
	});
	scene.createMaterial({
		id: 'playground/follow-cube/edge-material',
		shaderId: shaders.solid,
		uniforms: { u_Color: [...FOLLOW_ACCENT_COLOR.slice(0, 3), 0.3] },
		surface: { alphaMode: 'blend' },
		passes: [createAdditiveRingPass('follow-cube-edge-ring')],
	});

	const camera = scene.createCameraEntity(
		{ name: 'FollowCubeCamera' },
		{ primary: true, fieldOfView: 55, near: 0.1, far: 600 },
	);
	const followCamera = camera.addComponent(FollowCameraController, {
		targetOffset: [0, 0.9, 0],
		distance: 12.5,
		minDistance: 8,
		maxDistance: 17,
		azimuth: 0,
		elevation: 0.48,
		positionDamping: 5.5,
		targetDamping: 9,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/follow-cube',
		size: 13.5,
		y: 0.018,
		scale: 1,
		color: FOLLOW_GRID_PRIMARY,
		gridColor: FOLLOW_GRID_SECONDARY,
		backgroundColor: FOLLOW_GRID_BACKGROUND,
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/follow-cube', length: 5 });
	axes.setVisible(false);

	const floorEntity = scene.createRenderableEntity(
		{ name: 'FollowCubeArena' },
		{ meshId: FOLLOW_ARENA_MESH_ID, materialId: FOLLOW_FLOOR_FILL_MATERIAL_ID },
	);
	floorEntity.requireComponent(Transform).position = new Vec3(0, -FOLLOW_ARENA_HEIGHT * 0.5, 0);

	const boundaryEntity = scene.createRenderableEntity(
		{ name: 'FollowCubeBoundary' },
		{ meshId: 'playground/follow-cube/boundary-ring', materialId: 'playground/follow-cube/boundary-material' },
	);
	boundaryEntity.requireComponent(Transform).position = new Vec3(0, 0.035, 0);

	const centerEntity = scene.createRenderableEntity(
		{ name: 'FollowCubeCenterMark' },
		{ meshId: 'playground/follow-cube/center-ring', materialId: 'playground/follow-cube/center-material' },
	);
	centerEntity.requireComponent(Transform).position = new Vec3(0, 0.03, 0);

	const edgeEntity = scene.createRenderableEntity(
		{ name: 'FollowCubeArenaEdge' },
		{ meshId: 'playground/follow-cube/edge-ring', materialId: 'playground/follow-cube/edge-material' },
	);
	edgeEntity.requireComponent(Transform).position = new Vec3(0, 0.012, 0);

	const platformShadow = createContactShadow(scene, {
		prefix: 'playground/follow-cube/arena-shadow',
		size: 24,
		y: -FOLLOW_ARENA_HEIGHT - 0.02,
		color: [0.02, 0.01, 0.03, 0.32],
	});
	platformShadow.entity.active = true;

	const playerEntity = scene.createRenderableEntity(
		{ name: 'FollowCubePlayer' },
		{ meshId: FOLLOW_PLAYER_MESH_ID, materialId: FOLLOW_PLAYER_FILL_MATERIAL_ID },
	);
	const playerTransform = playerEntity.requireComponent(Transform);
	playerTransform.position = new Vec3(0, FOLLOW_CUBE_SIZE * 0.5, 0);
	playerEntity.addComponent(FollowCubeController, input);

	const selectionEntity = scene.createRenderableEntity(
		{ name: 'FollowCubeSelection' },
		{ meshId: 'playground/follow-cube/selection-ring', materialId: 'playground/follow-cube/selection-material' },
	);
	selectionEntity.requireComponent(Transform);
	selectionEntity.addComponent(FollowCubeGrounding, { target: playerTransform, height: 0.04 });

	const shadow = createContactShadow(scene, {
		prefix: 'playground/follow-cube/player-shadow',
		size: 2.9,
		y: 0.025,
		color: [0.03, 0.015, 0.03, 0.62],
	});
	shadow.entity.addComponent(FollowCubeGrounding, { target: playerTransform, height: 0.025 });

	for (const x of [-7.2, 7.2]) {
		for (const z of [-7.2, 7.2]) {
			const postEntity = scene.createRenderableEntity(
				{ name: `FollowCubePost-${x}-${z}` },
				{ meshId: 'playground/follow-cube/post', materialId: 'playground/follow-cube/post-material' },
			);
			postEntity.requireComponent(Transform).position = new Vec3(x, 0.625, z);
			const capEntity = scene.createRenderableEntity(
				{ name: `FollowCubePostCap-${x}-${z}` },
				{ meshId: 'playground/follow-cube/post-cap', materialId: 'playground/follow-cube/cap-material' },
			);
			capEntity.requireComponent(Transform).position = new Vec3(x, 1.29, z);
		}
	}

	followCamera.setTarget(playerTransform);

	const floorRenderer = floorEntity.getComponent(MeshRenderer);
	const playerRenderer = playerEntity.getComponent(MeshRenderer);
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
			objectCount: 16,
			summary: 'WASD arena · follow camera',
		}),
	});

	return {
		...baseHandle,
		setCameraPreset(preset: PlaygroundCameraPreset) {
			applyFollowCameraPreset(followCamera, preset);
		},
	};
};
