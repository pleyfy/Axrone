import { createRing, createSphere } from '@axrone/geometry';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController } from '@axrone/scene-3d';
import {
	attachOrbitCameraInput,
	createAxesOverlay,
	createGridOverlay,
	createMeshBuilder,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
} from '@axrone/playground';
import { Quat, Vec3 } from '@axrone/numeric';
import type { PlaygroundSceneHandle } from '../shared/playground-types';
import {
	PARTICLE_AMBIENT,
	PARTICLE_CLEAR_COLOR,
	PARTICLE_FILL_LIGHT_COLOR,
	PARTICLE_FILL_LIGHT_DIRECTION,
	PARTICLE_KEY_LIGHT_COLOR,
	PARTICLE_KEY_LIGHT_DIRECTION,
	PARTICLE_SEEDS,
	type ParticleSeed,
} from './particle-data';

type ParticleRuntime = {
	readonly seed: ParticleSeed;
	readonly transform: Transform;
	readonly renderer: MeshRenderer;
	readonly fillMaterialId: string;
	readonly wireMaterialId: string;
};

export const createParticleSystemScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: PARTICLE_CLEAR_COLOR,
		ambientLight: [0.05, 0.06, 0.05],
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/particles');
	const meshBuilder = createMeshBuilder();

	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/particles/sphere',
			createSphere({ radius: 1, widthSegments: 18, heightSegments: 14 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/particles/ring',
			createRing({ innerRadius: 0.88, outerRadius: 1.08, segments: 80 }),
		),
	);

	const lightingUniforms = {
		u_AmbientColor: PARTICLE_AMBIENT,
		u_KeyLightDirection: PARTICLE_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: PARTICLE_KEY_LIGHT_COLOR,
		u_FillLightDirection: PARTICLE_FILL_LIGHT_DIRECTION,
		u_FillLightColor: PARTICLE_FILL_LIGHT_COLOR,
	} as const;

	const registerLitMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		shininess: number,
		polygonMode: 'fill' | 'line',
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.lit,
			uniforms: {
				u_Color: color,
				u_Shininess: shininess,
				...lightingUniforms,
			},
			rasterizerState: polygonMode === 'line' ? { polygonMode: 'line', lineWidth: 1 } : undefined,
		});
	};

	const registerSolidMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		polygonMode: 'fill' | 'line',
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.solid,
			uniforms: { u_Color: color },
			rasterizerState: polygonMode === 'line' ? { polygonMode: 'line', lineWidth: 1 } : undefined,
		});
	};

	const camera = scene.createCameraActor({ name: 'ParticleCamera' }, { primary: true, fieldOfView: 52 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 1.15, 0],
		distance: 8.8,
		minDistance: 4.8,
		maxDistance: 16,
		azimuth: 0.68,
		elevation: 0.35,
	});
	const detachInput = attachOrbitCameraInput(container, orbit);

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/particles',
		size: 20,
		scale: 0.7,
		color: [0.18, 0.22, 0.18],
		gridColor: [0.82, 0.88, 0.82],
		backgroundColor: [0.94, 0.95, 0.92],
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/particles', length: 2.6 });

	registerSolidMaterial('playground/particles/core-fill', [0.12, 0.16, 0.14, 1], 'fill');
	registerSolidMaterial('playground/particles/core-wire', [0.05, 0.08, 0.07, 1], 'line');

	const core = scene.createRenderableActor(
		{ name: 'EmitterCore' },
		{ meshId: 'playground/particles/sphere', materialId: 'playground/particles/core-fill', receiveLighting: false },
	);
	const coreTransform = core.requireComponent(Transform);
	coreTransform.position = new Vec3(0, 1.05, 0);
	coreTransform.scale = new Vec3(0.42, 0.42, 0.42);
	const coreRenderer = core.getComponent(MeshRenderer);
	if (!coreRenderer) {
		throw new Error('Particle core renderer was not created correctly.');
	}

	const haloDefinitions = [
		{ id: 'inner', scale: 1.1, color: [0.19, 0.62, 0.43, 1] as const },
		{ id: 'mid', scale: 1.55, color: [0.17, 0.46, 0.95, 1] as const },
		{ id: 'outer', scale: 2.05, color: [0.95, 0.72, 0.21, 1] as const },
	] as const;

	const haloRenderers: Array<{ renderer: MeshRenderer; fillMaterialId: string; wireMaterialId: string; transform: Transform }> = [];
	for (const halo of haloDefinitions) {
		const fillMaterialId = `playground/particles/${halo.id}-fill`;
		const wireMaterialId = `playground/particles/${halo.id}-wire`;
		registerSolidMaterial(fillMaterialId, halo.color, 'fill');
		registerSolidMaterial(wireMaterialId, [0.16, 0.2, 0.18, 1], 'line');

		const actor = scene.createRenderableActor(
			{ name: `Halo${halo.id}` },
			{ meshId: 'playground/particles/ring', materialId: fillMaterialId, receiveLighting: false },
		);
		const transform = actor.requireComponent(Transform);
		transform.position = new Vec3(0, 1.02, 0);
		transform.rotation = Quat.fromEuler(-Math.PI * 0.5, 0, 0);
		transform.scale = new Vec3(halo.scale, halo.scale, halo.scale);
		const renderer = actor.getComponent(MeshRenderer);
		if (!renderer) {
			throw new Error(`Particle halo renderer setup failed for ${halo.id}.`);
		}
		haloRenderers.push({ renderer, fillMaterialId, wireMaterialId, transform });
	}

	const particles: ParticleRuntime[] = [];
	for (const seed of PARTICLE_SEEDS) {
		const fillMaterialId = `playground/particles/${seed.id}-fill`;
		const wireMaterialId = `playground/particles/${seed.id}-wire`;
		registerLitMaterial(fillMaterialId, seed.color, 28, 'fill');
		registerLitMaterial(wireMaterialId, [0.14, 0.16, 0.18, 1], 8, 'line');

		const actor = scene.createRenderableActor(
			{ name: seed.id },
			{ meshId: 'playground/particles/sphere', materialId: fillMaterialId },
		);
		const transform = actor.requireComponent(Transform);
		transform.scale = new Vec3(seed.size, seed.size, seed.size);
		const renderer = actor.getComponent(MeshRenderer);
		if (!renderer) {
			throw new Error(`Particle renderer setup failed for ${seed.id}.`);
		}

		particles.push({ seed, transform, renderer, fillMaterialId, wireMaterialId });
	}

	let playing = true;
	let frameHandle = 0;
	const loop = (now: number) => {
		const time = now * 0.001;
		if (playing) {
			coreTransform.scale = new Vec3(
				0.42 + Math.sin(time * 2.1) * 0.04,
				0.42 + Math.sin(time * 2.1) * 0.04,
				0.42 + Math.sin(time * 2.1) * 0.04,
			);
			for (const [index, halo] of haloRenderers.entries()) {
				halo.transform.rotation = Quat.fromEuler(-Math.PI * 0.5, time * (0.2 + index * 0.14), 0);
			}

			for (const particle of particles) {
				const angle = time * particle.seed.speed + particle.seed.phase;
				const radius = particle.seed.orbitRadius + Math.sin(time * particle.seed.wobble + particle.seed.phase) * 0.22;
				particle.transform.position = new Vec3(
					Math.cos(angle) * radius,
					1.05 + particle.seed.heightOffset + Math.sin(angle * 2.1) * 0.62,
					Math.sin(angle) * radius,
				);
				particle.transform.rotation = Quat.fromEuler(angle, angle * 1.3, 0);
			}
		}

		frameHandle = globalThis.requestAnimationFrame(loop);
	};
	frameHandle = globalThis.requestAnimationFrame(loop);

	const baseHandle = createPlaygroundHandle({
		container,
		scene,
		disposeScene: false,
		orbit,
		overlays: { grid, axes },
		disposeExtras: [detachInput, () => stage.dispose()],
		setWireframe(enabled) {
			coreRenderer.materialId = enabled ? 'playground/particles/core-wire' : 'playground/particles/core-fill';
			for (const halo of haloRenderers) {
				halo.renderer.materialId = enabled ? halo.wireMaterialId : halo.fillMaterialId;
			}
			for (const particle of particles) {
				particle.renderer.materialId = enabled ? particle.wireMaterialId : particle.fillMaterialId;
			}
		},
		stats: () => ({
			objectCount: 1 + haloRenderers.length + particles.length + grid.actors.length + axes.actors.length,
			summary: 'Kinetic emitter field',
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