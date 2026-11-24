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
	registerStudioLitShader,
} from '@axrone/playground';
import { Quat, Vec3 } from '@axrone/numeric';
import type { PlaygroundSceneHandle } from '../../shared/playground-types';

const SPHERE_MESH_ID = 'playground/physics-bounce/sphere';
const POST_MESH_ID = 'playground/physics-bounce/post';
const FLOOR_MATERIAL_ID = 'playground/physics-bounce/floor';
const POST_MATERIAL_ID = 'playground/physics-bounce/post-material';
const SPHERE_MATERIAL_PREFIX = 'playground/physics-bounce/sphere-material-';
const FIXED_STEP = 1 / 60;
const BODY_STATIC = 0;
const BODY_DYNAMIC = 2;
const SPHERE_COUNT = 20;

type SyncEntry = {
	readonly body: NonNullable<ReturnType<PhysicsWorld3D['getBody']>>;
	readonly transform: Transform;
};

type SphereColor = {
	readonly color: readonly [number, number, number, number];
	readonly rim: readonly [number, number, number];
};

const SPHERE_COLORS: readonly SphereColor[] = [
	{ color: [0.08, 0.62, 0.7, 1], rim: [0.3, 0.9, 0.95] },
	{ color: [0.86, 0.52, 0.18, 1], rim: [1, 0.76, 0.36] },
	{ color: [0.82, 0.28, 0.22, 1], rim: [1, 0.58, 0.45] },
	{ color: [0.3, 0.68, 0.52, 1], rim: [0.56, 1, 0.8] },
	{ color: [0.72, 0.42, 0.7, 1], rim: [0.95, 0.68, 1] },
	{ color: [0.8, 0.8, 0.74, 1], rim: [1, 1, 0.9] },
];

const physicsMaterial = (friction: number, restitution: number, density = 1) => ({
	friction: friction as Friction,
	restitution: restitution as Restitution,
	density: density as Density,
});

export const createPhysicsBounceScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: [0.02, 0.06, 0.07, 0],
		background:
			'radial-gradient(75% 60% at 50% 28%, rgba(26, 150, 150, 0.24), transparent 62%), linear-gradient(180deg, #071115 0%, #0b1a1e 58%, #040b0d 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/physics-bounce');
	const studioShader = registerStudioLitShader(scene, 'playground/physics-bounce/studio');

	scene.createSphereMesh(SPHERE_MESH_ID, 1, 28);
	scene.createBoxMesh(POST_MESH_ID, 1, 1, 1);

	const lightingUniforms = {
		u_AmbientColor: [0.28, 0.3, 0.32],
		u_KeyLightDirection: [-0.35, -0.82, -0.45],
		u_KeyLightColor: [0.8, 0.9, 1],
		u_FillLightDirection: [0.55, -0.32, 0.68],
		u_FillLightColor: [0.25, 0.4, 0.45],
	} as const;

	const registerSphereMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		rim: readonly [number, number, number],
	): void => {
		scene.createMaterial({
			id,
			shaderId: studioShader,
			uniforms: {
				u_Color: color,
				u_Shininess: 22,
				u_RimColor: rim,
				u_RimStrength: 0.26,
				...lightingUniforms,
			},
		});
	};

	scene.createMaterial({
		id: FLOOR_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: [0.055, 0.1, 0.12, 1] },
	});
	scene.createMaterial({
		id: POST_MATERIAL_ID,
		shaderId: shaders.solid,
		uniforms: { u_Color: [0.35, 0.62, 0.64, 1] },
	});
	for (let index = 0; index < SPHERE_COLORS.length; index += 1) {
		const palette = SPHERE_COLORS[index]!;
		registerSphereMaterial(`${SPHERE_MATERIAL_PREFIX}${index}`, palette.color, palette.rim);
	}

	const world = new PhysicsWorld3D({
		gravity: { x: 0, y: -9.81, z: 0 },
		allowSleep: true,
		maxBodies: 96,
		maxShapes: 128,
		maxConstraints: 16,
	});

	const groundBodyId = world.createBody({
		type: BODY_STATIC,
		position: { x: 0, y: -0.25, z: 0 },
	});
	world.createBoxShape(
		groundBodyId,
		{
			center: { x: 0, y: 0, z: 0 },
			halfExtents: { x: 14, y: 0.25, z: 14 },
		},
		physicsMaterial(0.35, 0.55),
	);

	scene.createBoxMesh('playground/physics-bounce/floor-mesh', 1, 1, 1);
	const floorEntity = scene.createRenderableEntity(
		{ name: 'BounceFloor' },
		{ meshId: 'playground/physics-bounce/floor-mesh', materialId: FLOOR_MATERIAL_ID },
	);
	const floorTransform = floorEntity.requireComponent(Transform);
	floorTransform.position = new Vec3(0, -0.25, 0);
	floorTransform.scale = new Vec3(28, 0.5, 28);

	for (const x of [-5.8, 5.8]) {
		for (const z of [-5.8, 5.8]) {
			const post = scene.createRenderableEntity(
				{ name: `BouncePost-${x}-${z}` },
				{ meshId: POST_MESH_ID, materialId: POST_MATERIAL_ID },
			);
			const transform = post.requireComponent(Transform);
			transform.position = new Vec3(x, 1.3, z);
			transform.scale = new Vec3(0.14, 2.6, 0.14);
		}
	}

	const syncEntries: SyncEntry[] = [];
	const spawnSphere = (
		radius: number,
		position: readonly [number, number, number],
		velocity: readonly [number, number, number],
		colorIndex: number,
	): void => {
		const bodyId = world.createBody({
			type: BODY_DYNAMIC,
			position: { x: position[0], y: position[1], z: position[2] },
			linearVelocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
			linearDamping: 0.02,
			angularDamping: 0.05,
			allowSleep: true,
			awake: true,
		});
		world.createSphereShape(
			bodyId,
			{ center: { x: 0, y: 0, z: 0 }, radius },
			physicsMaterial(0.22, 0.72 + Math.random() * 0.24),
		);
		world.getBody(bodyId as never)?.resetMassData();
		const entity = scene.createRenderableEntity(
			{ name: `BounceSphere-${bodyId}` },
			{ meshId: SPHERE_MESH_ID, materialId: `${SPHERE_MATERIAL_PREFIX}${colorIndex % SPHERE_COLORS.length}` },
		);
		const transform = entity.requireComponent(Transform);
		transform.position = new Vec3(position[0], position[1], position[2]);
		transform.scale = new Vec3(radius, radius, radius);
		const body = world.getBody(bodyId as never);
		if (body) {
			syncEntries.push({ body, transform });
		}
	};

	for (let index = 0; index < SPHERE_COUNT; index += 1) {
		const column = index % 5;
		const row = Math.floor(index / 5);
		spawnSphere(
			0.3 + Math.random() * 0.28,
			[-4.4 + column * 2.2, 2.4 + row * 0.8 + Math.random() * 0.6, -3.4 + row * 1.7],
			[(Math.random() - 0.5) * 1.4, -0.6, (Math.random() - 0.5) * 1.4],
			index,
		);
	}

	const camera = scene.createCameraEntity({ name: 'BounceCamera' }, { primary: true, fieldOfView: 54 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 1.1, 0],
		distance: 15,
		minDistance: 6,
		maxDistance: 30,
		azimuth: 0.55,
		elevation: 0.48,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.06,
		maxElevation: 1.3,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/physics-bounce',
		size: 26,
		scale: 1,
		y: 0.012,
		color: [0.12, 0.36, 0.38],
		gridColor: [0.07, 0.22, 0.24],
		backgroundColor: [0.03, 0.09, 0.1],
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/physics-bounce', length: 5 });
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
			0.3 + Math.random() * 0.3,
			[(Math.random() - 0.5) * 8, 7, (Math.random() - 0.5) * 6],
			[0, -0.8, 0],
			Math.floor(Math.random() * SPHERE_COLORS.length),
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
			summary: 'Click to drop spheres',
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
