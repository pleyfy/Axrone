import { Transform } from '@axrone/ecs-runtime';
import { PhysicsWorld3D } from '@axrone/physics';
import type { Density, Friction, Restitution } from '@axrone/physics';
import { OrbitCameraController } from '@axrone/scene-3d';
import {
	attachOrbitCameraInput,
	createAxesOverlay,
	createContactShadow,
	createGridOverlay,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
	registerStudioLitShader,
} from '@axrone/playground';
import { Quat, Vec3 } from '@axrone/numeric';
import type { PlaygroundSceneHandle } from '../../shared/playground-types';

const TABLE_MESH_ID = 'playground/physics-domino/table';
const DOMINO_MESH_ID = 'playground/physics-domino/domino';
const TABLE_MATERIAL_ID = 'playground/physics-domino/table-material';
const DOMINO_MATERIAL_PREFIX = 'playground/physics-domino/domino-material-';
const FIXED_STEP = 1 / 60;
const BODY_STATIC = 0;
const BODY_DYNAMIC = 2;
const DOMINO_COUNT = 16;
const DOMINO_SIZE = { x: 0.16, y: 1.4, z: 0.72 } as const;
const DOMINO_SPACING = 0.7;
const TRIGGER_DELAY = 0.9;
const REST_Y = DOMINO_SIZE.y * 0.5 + 0.005;

type SyncEntry = {
	readonly body: NonNullable<ReturnType<PhysicsWorld3D['getBody']>>;
	readonly transform: Transform;
	readonly x: number;
};

const DOMINO_COLORS = [
	[0.7, 0.27, 0.14, 1],
	[0.78, 0.55, 0.22, 1],
	[0.4, 0.49, 0.31, 1],
	[0.12, 0.43, 0.4, 1],
	[0.3, 0.34, 0.41, 1],
] as const;

const physicsMaterial = (friction: number, restitution: number, density = 1) => ({
	friction: friction as Friction,
	restitution: restitution as Restitution,
	density: density as Density,
});

export const createPhysicsDominoScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: [0.95, 0.92, 0.87, 0],
		background:
			'radial-gradient(80% 65% at 55% 0%, rgba(255, 255, 255, 0.68), transparent 58%), linear-gradient(180deg, #f4efe8 0%, #e7ddd0 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/physics-domino');
	const studioShader = registerStudioLitShader(scene, 'playground/physics-domino/studio');

	scene.createBoxMesh(TABLE_MESH_ID, 1, 1, 1);
	scene.createBoxMesh(DOMINO_MESH_ID, 1, 1, 1);

	const lightingUniforms = {
		u_AmbientColor: [0.36, 0.34, 0.31],
		u_KeyLightDirection: [-0.38, -0.8, -0.42],
		u_KeyLightColor: [0.94, 0.86, 0.74],
		u_FillLightDirection: [0.55, -0.35, 0.7],
		u_FillLightColor: [0.3, 0.37, 0.48],
	} as const;

	const registerMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		shininess: number,
		rim: readonly [number, number, number],
		rimStrength: number,
	): void => {
		scene.createMaterial({
			id,
			shaderId: studioShader,
			uniforms: {
				u_Color: color,
				u_Shininess: shininess,
				u_RimColor: rim,
				u_RimStrength: rimStrength,
				...lightingUniforms,
			},
		});
	};

	registerMaterial(TABLE_MATERIAL_ID, [0.8, 0.75, 0.68, 1], 4, [1, 0.87, 0.68], 0.08);
	for (let index = 0; index < DOMINO_COLORS.length; index += 1) {
		registerMaterial(
			`${DOMINO_MATERIAL_PREFIX}${index}`,
			DOMINO_COLORS[index]!,
			8,
			[1, 0.84, 0.6],
			0.12,
		);
	}

	const tableActor = scene.createRenderableActor(
		{ name: 'DominoTable' },
		{ meshId: TABLE_MESH_ID, materialId: TABLE_MATERIAL_ID },
	);
	const tableTransform = tableActor.requireComponent(Transform);
	tableTransform.position = new Vec3(0, -0.22, 0);
	tableTransform.scale = new Vec3(18, 0.44, 6.4);

	createContactShadow(scene, {
		prefix: 'playground/physics-domino/table-shadow',
		size: 18,
		y: -0.48,
		color: [0.16, 0.11, 0.07, 0.18],
	});

	const world = new PhysicsWorld3D({
		gravity: { x: 0, y: -9.81, z: 0 },
		allowSleep: true,
		maxBodies: 64,
		maxShapes: 96,
		maxConstraints: 16,
	});

	const groundBodyId = world.createBody({
		type: BODY_STATIC,
		position: { x: 0, y: -0.22, z: 0 },
	});
	world.createBoxShape(
		groundBodyId,
		{
			center: { x: 0, y: 0, z: 0 },
			halfExtents: { x: 9, y: 0.22, z: 3.2 },
		},
		physicsMaterial(0.7, 0),
	);

	const entries: SyncEntry[] = [];
	const startX = -((DOMINO_COUNT - 1) * DOMINO_SPACING) * 0.5;
	for (let index = 0; index < DOMINO_COUNT; index += 1) {
		const x = startX + index * DOMINO_SPACING;
		const materialId = `${DOMINO_MATERIAL_PREFIX}${index % DOMINO_COLORS.length}`;
		const bodyId = world.createBody({
			type: BODY_DYNAMIC,
			position: { x, y: REST_Y, z: 0 },
			linearDamping: 0.06,
			angularDamping: 0.28,
			allowSleep: true,
			awake: true,
		});
		world.createBoxShape(
			bodyId,
			{
				center: { x: 0, y: 0, z: 0 },
				halfExtents: {
					x: DOMINO_SIZE.x * 0.5,
					y: DOMINO_SIZE.y * 0.5,
					z: DOMINO_SIZE.z * 0.5,
				},
			},
			physicsMaterial(0.62, 0),
		);
		world.getBody(bodyId as never)?.resetMassData();

		const actor = scene.createRenderableActor(
			{ name: `Domino-${index}` },
			{ meshId: DOMINO_MESH_ID, materialId },
		);
		const transform = actor.requireComponent(Transform);
		transform.position = new Vec3(x, REST_Y, 0);
		transform.scale = new Vec3(DOMINO_SIZE.x, DOMINO_SIZE.y, DOMINO_SIZE.z);
		const body = world.getBody(bodyId as never);
		if (body) {
			entries.push({ body, transform, x });
		}
	}

	const resetDominoes = (): void => {
		for (const entry of entries) {
			entry.body.setTransform(
				{ x: entry.x, y: REST_Y, z: 0 },
				{ x: 0, y: 0, z: 0, w: 1 },
			);
			entry.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
			entry.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
			entry.body.setAwake(true);
			entry.transform.position = new Vec3(entry.x, REST_Y, 0);
			entry.transform.rotation = Quat.IDENTITY;
		}
	};

	const camera = scene.createCameraActor({ name: 'DominoCamera' }, { primary: true, fieldOfView: 50 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [1, 0.72, 0],
		distance: 15.2,
		minDistance: 6,
		maxDistance: 26,
		azimuth: 0.4,
		elevation: 0.5,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.08,
		maxElevation: 1.2,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/physics-domino',
		size: 18,
		scale: 1,
		y: 0.012,
		color: [0.68, 0.62, 0.55],
		gridColor: [0.78, 0.73, 0.67],
		backgroundColor: [0.92, 0.88, 0.82],
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/physics-domino', length: 5 });
	axes.setVisible(false);

	const syncBodies = (): void => {
		for (const entry of entries) {
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
	let simulatedTime = 0;
	let triggered = false;
	let settled = false;
	let lowMotionTime = 0;
	const loop = (now: number) => {
		const deltaSeconds = previousTime === 0 ? 0 : Math.min((now - previousTime) / 1000, 0.05);
		previousTime = now;
		if (playing && !settled) {
			accumulator += deltaSeconds;
			let steps = 0;
			while (accumulator >= FIXED_STEP && steps < 5) {
				world.step(FIXED_STEP, 12, 6);
				accumulator -= FIXED_STEP;
				simulatedTime += FIXED_STEP;
				steps += 1;
			}
			if (!triggered && simulatedTime >= TRIGGER_DELAY) {
				const first = entries[0];
				if (first) {
					first.body.setAwake(true);
					first.body.applyImpulse(
						{ x: 0.035, y: 0, z: 0 },
						{ x: first.x, y: 1.32, z: 0 },
					);
				}
				triggered = true;
			}
			if (triggered && !settled) {
				let maxSpeed = 0;
				for (const entry of entries) {
					const linear = entry.body.getLinearVelocity();
					const angular = entry.body.getAngularVelocity();
					maxSpeed = Math.max(
						maxSpeed,
						Math.hypot(linear.x, linear.y, linear.z),
						Math.hypot(angular.x, angular.y, angular.z) * 0.4,
					);
				}
				if (maxSpeed > 0.35) {
					lowMotionTime = 0;
				} else {
					lowMotionTime += deltaSeconds;
				}
				if (lowMotionTime > 0.9) {
					for (const entry of entries) {
						entry.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
						entry.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
						entry.body.setSleeping(true);
					}
					settled = true;
				}
			}
			if (triggered && !settled && simulatedTime >= TRIGGER_DELAY + 7) {
				for (const entry of entries) {
					entry.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
					entry.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
					entry.body.setSleeping(true);
				}
				settled = true;
			}
			syncBodies();
		}
		frameHandle = globalThis.requestAnimationFrame(loop);
	};
	frameHandle = globalThis.requestAnimationFrame(loop);

	let pointerDownX = 0;
	let pointerDownY = 0;
	const handlePointerDown = (event: PointerEvent): void => {
		pointerDownX = event.clientX;
		pointerDownY = event.clientY;
	};
	const handlePointerUp = (event: PointerEvent): void => {
		if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 4) {
			return;
		}
		resetDominoes();
		simulatedTime = 0;
		triggered = false;
		settled = false;
		lowMotionTime = 0;
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
			summary: '16 dominoes · click to restart',
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
