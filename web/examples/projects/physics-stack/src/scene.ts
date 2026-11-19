import { Transform } from '@axrone/ecs-runtime';
import { PhysicsWorld3D } from '@axrone/physics';
import type { Density, Friction, Restitution } from '@axrone/physics';
import { OrbitCameraController } from '@axrone/scene-3d';
import {
	attachOrbitCameraInput,
	createAxesOverlay,
	createGridOverlay,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
} from '@axrone/playground';
import { Quat, Vec3 } from '@axrone/numeric';
import type { PlaygroundSceneHandle } from '../../shared/playground-types';

const BOX_MESH_ID = 'playground/physics-stack/box';
const SPHERE_MESH_ID = 'playground/physics-stack/sphere';
const GROUND_MATERIAL_ID = 'playground/physics-stack/ground';
const BOX_MATERIAL_PREFIX = 'playground/physics-stack/box-material-';
const SPHERE_MATERIAL_ID = 'playground/physics-stack/sphere-material';
const FIXED_STEP = 1 / 60;
const BODY_STATIC = 0;
const BODY_DYNAMIC = 2;

type SyncEntry = {
	readonly body: NonNullable<ReturnType<PhysicsWorld3D['getBody']>>;
	readonly transform: Transform;
};

const BLOCK_COLORS = [
	[0.71, 0.29, 0.19, 1],
	[0.35, 0.48, 0.32, 1],
	[0.78, 0.6, 0.27, 1],
	[0.25, 0.33, 0.4, 1],
	[0.86, 0.83, 0.77, 1],
] as const;

const physicsMaterial = (friction: number, restitution: number, density = 1) => ({
	friction: friction as Friction,
	restitution: restitution as Restitution,
	density: density as Density,
});

export const createPhysicsStackScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: [0.93, 0.95, 0.93, 0],
		background:
			'radial-gradient(90% 65% at 50% 0%, rgba(255, 255, 255, 0.85), transparent 58%), linear-gradient(180deg, #eef2ee 0%, #dfe7df 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/physics-stack');

	scene.createBoxMesh(BOX_MESH_ID, 1, 1, 1);
	scene.createSphereMesh(SPHERE_MESH_ID, 1, 28);

	const lightingUniforms = {
		u_AmbientColor: [0.36, 0.38, 0.36],
		u_KeyLightDirection: [-0.35, -0.82, -0.45],
		u_KeyLightColor: [0.9, 0.92, 0.88],
		u_FillLightDirection: [0.5, -0.3, 0.7],
		u_FillLightColor: [0.28, 0.36, 0.4],
	} as const;

	const registerMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		shininess = 6,
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.lit,
			uniforms: {
				u_Color: color,
				u_Shininess: shininess,
				...lightingUniforms,
			},
		});
	};

	registerMaterial(GROUND_MATERIAL_ID, [0.78, 0.8, 0.77, 1], 4);
	for (let index = 0; index < BLOCK_COLORS.length; index += 1) {
		registerMaterial(`${BOX_MATERIAL_PREFIX}${index}`, BLOCK_COLORS[index]!, 5);
	}
	registerMaterial(SPHERE_MATERIAL_ID, [0.68, 0.22, 0.18, 1], 18);

	const world = new PhysicsWorld3D({
		gravity: { x: 0, y: -9.81, z: 0 },
		allowSleep: true,
		maxBodies: 96,
		maxShapes: 160,
		maxConstraints: 32,
	});

	const groundBodyId = world.createBody({
		type: BODY_STATIC,
		position: { x: 0, y: -0.3, z: 0 },
	});
	world.createBoxShape(
		groundBodyId,
		{
			center: { x: 0, y: 0, z: 0 },
			halfExtents: { x: 12, y: 0.3, z: 12 },
		},
		physicsMaterial(0.8, 0.04),
	);

	const groundActor = scene.createRenderableActor(
		{ name: 'PhysicsGround' },
		{ meshId: BOX_MESH_ID, materialId: GROUND_MATERIAL_ID },
	);
	const groundTransform = groundActor.requireComponent(Transform);
	groundTransform.position = new Vec3(0, -0.3, 0);
	groundTransform.scale = new Vec3(24, 0.6, 24);

	const syncEntries: SyncEntry[] = [];
	const actors: ReturnType<typeof scene.createRenderableActor>[] = [groundActor];

	const addBodyVisual = (
		bodyId: number,
		meshId: string,
		materialId: string,
		position: Vec3,
		scale: Vec3,
		rotation = Quat.IDENTITY,
	): void => {
		const actor = scene.createRenderableActor(
			{ name: `PhysicsBody-${bodyId}` },
			{ meshId, materialId },
		);
		const transform = actor.requireComponent(Transform);
		transform.position = position;
		transform.scale = scale;
		transform.rotation = rotation;
		actors.push(actor);
		const body = world.getBody(bodyId as never);
		if (body) {
			syncEntries.push({ body, transform });
		}
	};

	const spawnBox = (
		size: number,
		position: readonly [number, number, number],
		rotation: Quat,
		colorIndex: number,
	): void => {
		const bodyId = world.createBody({
			type: BODY_DYNAMIC,
			position: { x: position[0], y: position[1], z: position[2] },
			rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
			linearDamping: 0.02,
			angularDamping: 0.12,
			allowSleep: true,
			awake: true,
		});
		world.createBoxShape(
			bodyId,
			{
				center: { x: 0, y: 0, z: 0 },
				halfExtents: { x: size * 0.5, y: size * 0.5, z: size * 0.5 },
			},
			physicsMaterial(0.58, 0.08),
		);
		world.getBody(bodyId as never)?.resetMassData();
		addBodyVisual(
			bodyId,
			BOX_MESH_ID,
			`${BOX_MATERIAL_PREFIX}${colorIndex % BLOCK_COLORS.length}`,
			new Vec3(position[0], position[1], position[2]),
			new Vec3(size, size, size),
			rotation,
		);
	};

	const spawnSphere = (
		radius: number,
		position: readonly [number, number, number],
		velocity: readonly [number, number, number] = [0, -1.2, 0],
	): void => {
		const bodyId = world.createBody({
			type: BODY_DYNAMIC,
			position: { x: position[0], y: position[1], z: position[2] },
			linearVelocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
			linearDamping: 0.04,
			angularDamping: 0.08,
			allowSleep: true,
			awake: true,
		});
		world.createSphereShape(
			bodyId,
			{ center: { x: 0, y: 0, z: 0 }, radius },
			physicsMaterial(0.35, 0.32),
		);
		world.getBody(bodyId as never)?.resetMassData();
		addBodyVisual(
			bodyId,
			SPHERE_MESH_ID,
			SPHERE_MATERIAL_ID,
			new Vec3(position[0], position[1], position[2]),
			new Vec3(radius, radius, radius),
		);
	};

	const blockSize = 1.15;
	const baseY = blockSize * 0.5 + 0.02;
	const middleY = baseY + blockSize + 0.03;
	const topY = middleY + blockSize + 0.03;
	spawnBox(blockSize, [-1.25, baseY, 0], Quat.fromEuler(0, 0.04, 0), 0);
	spawnBox(blockSize, [0, baseY, 0], Quat.fromEuler(0, -0.03, 0), 1);
	spawnBox(blockSize, [1.25, baseY, 0], Quat.fromEuler(0, 0.02, 0), 2);
	spawnBox(blockSize, [-0.62, middleY, 0.02], Quat.fromEuler(0.02, 0, 0.02), 3);
	spawnBox(blockSize, [0.62, middleY, -0.02], Quat.fromEuler(-0.02, 0, -0.02), 0);
	spawnBox(blockSize, [0, topY, 0], Quat.fromEuler(0, 0.03, 0), 2);
	spawnSphere(0.36, [-0.72, topY + 1.3, 0.3]);
	spawnSphere(0.3, [0.82, topY + 1.65, -0.2]);

	const camera = scene.createCameraActor({ name: 'PhysicsStackCamera' }, { primary: true, fieldOfView: 50 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 1.35, 0],
		distance: 11.5,
		minDistance: 5,
		maxDistance: 24,
		azimuth: 0.58,
		elevation: 0.34,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.06,
		maxElevation: 1.2,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/physics-stack',
		size: 24,
		scale: 1,
		y: 0.012,
		color: [0.58, 0.65, 0.59],
		gridColor: [0.69, 0.75, 0.7],
		backgroundColor: [0.89, 0.92, 0.89],
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/physics-stack', length: 5 });
	axes.setVisible(false);

	const syncBodies = (): void => {
		for (const entry of syncEntries) {
			const transform = entry.body.getTransform();
			entry.transform.position = new Vec3(
				transform.position.x,
				transform.position.y,
				transform.position.z,
			);
			entry.transform.rotation = new Quat(
				transform.rotation.x,
				transform.rotation.y,
				transform.rotation.z,
				transform.rotation.w,
			);
		}
	};

	let playing = true;
	let frameHandle = 0;
	let previousTime = 0;
	let accumulator = 0;
	const loop = (now: number) => {
		const deltaSeconds = previousTime === 0 ? 0 : Math.min((now - previousTime) / 1000, 0.05);
		previousTime = now;
		if (playing) {
			accumulator += deltaSeconds;
			let steps = 0;
			while (accumulator >= FIXED_STEP && steps < 5) {
				world.step(FIXED_STEP, 8, 4);
				accumulator -= FIXED_STEP;
				steps += 1;
			}
			syncBodies();
		}
		frameHandle = globalThis.requestAnimationFrame(loop);
	};
	frameHandle = globalThis.requestAnimationFrame(loop);

	let pointerDownX = 0;
	let pointerDownY = 0;
	const handlePointerDown = (event: PointerEvent) => {
		pointerDownX = event.clientX;
		pointerDownY = event.clientY;
	};
	const handlePointerUp = (event: PointerEvent) => {
		if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 4) {
			return;
		}
		spawnSphere(
			0.28 + Math.random() * 0.18,
			[(Math.random() - 0.5) * 4, 5.2 + Math.random() * 0.8, (Math.random() - 0.5) * 3],
			[0, -1.5, 0],
		);
	};
	container.addEventListener('pointerdown', handlePointerDown);
	container.addEventListener('pointerup', handlePointerUp);

	const baseHandle = createPlaygroundHandle({
		container,
		scene,
		disposeScene: false,
		orbit,
		overlays: { grid, axes },
		disposeExtras: [
			detachInput,
			() => {
				container.removeEventListener('pointerdown', handlePointerDown);
				container.removeEventListener('pointerup', handlePointerUp);
			},
			() => world[Symbol.dispose](),
			() => stage.dispose(),
		],
		stats: () => ({
			objectCount: world.getBodies().size,
			summary: 'Click to drop bodies',
		}),
	});

	return {
		...baseHandle,
		setPlaying(nextPlaying: boolean) {
			playing = nextPlaying;
			baseHandle.setPlaying?.(nextPlaying);
		},
		async dispose() {
			playing = false;
			if (frameHandle !== 0) {
				globalThis.cancelAnimationFrame(frameHandle);
			}
			await baseHandle.dispose();
		},
	};
};
