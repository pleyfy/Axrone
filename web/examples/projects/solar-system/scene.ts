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
	SOLAR_AMBIENT,
	SOLAR_BODIES,
	SOLAR_CLEAR_COLOR,
	SOLAR_FILL_LIGHT_COLOR,
	SOLAR_FILL_LIGHT_DIRECTION,
	SOLAR_KEY_LIGHT_COLOR,
	SOLAR_KEY_LIGHT_DIRECTION,
	type SolarBodyConfig,
} from './data';

type SolarBodyRuntime = {
	readonly config: SolarBodyConfig;
	readonly planetTransform: Transform;
	readonly planetRenderer: MeshRenderer;
	readonly fillMaterialId: string;
	readonly wireMaterialId: string;
	readonly ringRenderer?: MeshRenderer;
	readonly ringFillMaterialId?: string;
	readonly ringWireMaterialId?: string;
	readonly moonTransform?: Transform;
	readonly moonRenderer?: MeshRenderer;
	readonly moonFillMaterialId?: string;
	readonly moonWireMaterialId?: string;
	readonly orbitLineRenderer?: MeshRenderer;
	readonly orbitLineFillMaterialId?: string;
	readonly orbitLineWireMaterialId?: string;
};

export const createSolarSystemScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: SOLAR_CLEAR_COLOR,
		ambientLight: [0.05, 0.06, 0.08],
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/solar');
	const meshBuilder = createMeshBuilder();

	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/solar/sphere',
			createSphere({ radius: 1, widthSegments: 28, heightSegments: 20 }),
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/solar/saturn-ring',
			createRing({ innerRadius: 0.82, outerRadius: 1.16, segments: 88 }),
		),
	);

	const lightingUniforms = {
		u_AmbientColor: SOLAR_AMBIENT,
		u_KeyLightDirection: SOLAR_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: SOLAR_KEY_LIGHT_COLOR,
		u_FillLightDirection: SOLAR_FILL_LIGHT_DIRECTION,
		u_FillLightColor: SOLAR_FILL_LIGHT_COLOR,
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

	registerSolidMaterial('playground/solar/sun-fill', [0.98, 0.73, 0.18, 1], 'fill');
	registerSolidMaterial('playground/solar/sun-wire', [0.29, 0.18, 0.04, 1], 'line');

	const camera = scene.createCameraActor({ name: 'SolarCamera' }, { primary: true, fieldOfView: 50 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0.8, 0],
		distance: 15.5,
		minDistance: 7,
		maxDistance: 28,
		azimuth: 0.64,
		elevation: 0.34,
	});
	const detachInput = attachOrbitCameraInput(container, orbit);

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/solar',
		size: 48,
		scale: 2,
		color: [0.38, 0.43, 0.56],
		gridColor: [0.84, 0.88, 0.96],
		backgroundColor: [0.93, 0.95, 0.98],
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/solar', length: 3.4 });

	const sun = scene.createRenderableActor(
		{ name: 'SolarSun' },
		{ meshId: 'playground/solar/sphere', materialId: 'playground/solar/sun-fill', receiveLighting: false },
	);
	const sunTransform = sun.requireComponent(Transform);
	sunTransform.position = new Vec3(0, 1.1, 0);
	sunTransform.scale = new Vec3(1.6, 1.6, 1.6);
	const sunRenderer = sun.getComponent(MeshRenderer);
	if (!sunRenderer) {
		throw new Error('Solar system sun renderer was not created correctly.');
	}

	const bodyRuntimes: SolarBodyRuntime[] = [];

	for (const body of SOLAR_BODIES) {
		const fillMaterialId = `playground/solar/${body.id}-fill`;
		const wireMaterialId = `playground/solar/${body.id}-wire`;
		registerLitMaterial(fillMaterialId, body.color, 20, 'fill');
		registerLitMaterial(wireMaterialId, [0.18, 0.2, 0.24, 1], 8, 'line');

		const orbitFillMaterialId = `playground/solar/${body.id}-orbit-fill`;
		const orbitWireMaterialId = `playground/solar/${body.id}-orbit-wire`;
		const orbitMeshId = `playground/solar/${body.id}-orbit-mesh`;
		scene.registerMesh(
			meshBuilder.createDefinition(
				orbitMeshId,
				createRing({
					innerRadius: body.orbitRadius - 0.018,
					outerRadius: body.orbitRadius + 0.018,
					segments: 120,
				}),
			),
		);
		registerSolidMaterial(orbitFillMaterialId, [0.67, 0.74, 0.88, 1], 'fill');
		registerSolidMaterial(orbitWireMaterialId, [0.28, 0.33, 0.45, 1], 'line');

		const orbitActor = scene.createRenderableActor(
			{ name: `${body.label}OrbitLine` },
			{ meshId: orbitMeshId, materialId: orbitFillMaterialId, receiveLighting: false },
		);
		const orbitTransform = orbitActor.requireComponent(Transform);
		orbitTransform.position = new Vec3(0, 0.02, 0);
		orbitTransform.rotation = Quat.fromEuler(-Math.PI * 0.5, 0, 0);

		const planetActor = scene.createRenderableActor(
			{ name: body.label },
			{ meshId: 'playground/solar/sphere', materialId: fillMaterialId },
		);
		const planetTransform = planetActor.requireComponent(Transform);
		planetTransform.scale = new Vec3(body.radius, body.radius, body.radius);

		const planetRenderer = planetActor.getComponent(MeshRenderer);
		const orbitLineRenderer = orbitActor.getComponent(MeshRenderer);
		if (!planetRenderer || !orbitLineRenderer) {
			throw new Error(`Solar system actor setup failed for ${body.label}.`);
		}

		let ringRenderer: MeshRenderer | undefined;
		let ringFillMaterialId: string | undefined;
		let ringWireMaterialId: string | undefined;

		if (body.ringScale) {
			ringFillMaterialId = `playground/solar/${body.id}-ring-fill`;
			ringWireMaterialId = `playground/solar/${body.id}-ring-wire`;
			registerSolidMaterial(ringFillMaterialId, [0.86, 0.78, 0.64, 1], 'fill');
			registerSolidMaterial(ringWireMaterialId, [0.27, 0.24, 0.2, 1], 'line');

			const ringActor = scene.createRenderableActor(
				{ name: `${body.label}Ring` },
				{ meshId: 'playground/solar/saturn-ring', materialId: ringFillMaterialId, receiveLighting: false },
			);
			const ringTransform = ringActor.requireComponent(Transform);
			ringTransform.scale = new Vec3(body.ringScale[0], body.ringScale[1], body.ringScale[2]);
			ringTransform.rotation = Quat.fromEuler(-Math.PI * 0.5 + (body.tilt ?? 0), 0, 0);
			ringRenderer = ringActor.getComponent(MeshRenderer) ?? undefined;
			bodyRuntimes.push({
				config: body,
				planetTransform,
				planetRenderer,
				fillMaterialId,
				wireMaterialId,
				ringRenderer,
				ringFillMaterialId,
				ringWireMaterialId,
				orbitLineRenderer,
				orbitLineFillMaterialId: orbitFillMaterialId,
				orbitLineWireMaterialId: orbitWireMaterialId,
			});
			continue;
		}

		bodyRuntimes.push({
			config: body,
			planetTransform,
			planetRenderer,
			fillMaterialId,
			wireMaterialId,
			orbitLineRenderer,
			orbitLineFillMaterialId: orbitFillMaterialId,
			orbitLineWireMaterialId: orbitWireMaterialId,
		});
	}

	for (const runtime of bodyRuntimes) {
		if (!runtime.config.moon) {
			continue;
		}

		const moonFillMaterialId = `playground/solar/${runtime.config.id}-moon-fill`;
		const moonWireMaterialId = `playground/solar/${runtime.config.id}-moon-wire`;
		registerLitMaterial(moonFillMaterialId, runtime.config.moon.color, 14, 'fill');
		registerLitMaterial(moonWireMaterialId, [0.17, 0.18, 0.2, 1], 8, 'line');

		const moon = scene.createRenderableActor(
			{ name: `${runtime.config.label}Moon` },
			{ meshId: 'playground/solar/sphere', materialId: moonFillMaterialId },
		);
		const moonTransform = moon.requireComponent(Transform);
		moonTransform.scale = new Vec3(
			runtime.config.moon.radius,
			runtime.config.moon.radius,
			runtime.config.moon.radius,
		);
		const moonRenderer = moon.getComponent(MeshRenderer);
		if (!moonRenderer) {
			throw new Error(`Solar system moon renderer setup failed for ${runtime.config.label}.`);
		}

		(runtime as {
			moonTransform: Transform;
			moonRenderer: MeshRenderer;
			moonFillMaterialId: string;
			moonWireMaterialId: string;
		}).moonTransform = moonTransform;
		(runtime as {
			moonTransform: Transform;
			moonRenderer: MeshRenderer;
			moonFillMaterialId: string;
			moonWireMaterialId: string;
		}).moonRenderer = moonRenderer;
		(runtime as {
			moonTransform: Transform;
			moonRenderer: MeshRenderer;
			moonFillMaterialId: string;
			moonWireMaterialId: string;
		}).moonFillMaterialId = moonFillMaterialId;
		(runtime as {
			moonTransform: Transform;
			moonRenderer: MeshRenderer;
			moonFillMaterialId: string;
			moonWireMaterialId: string;
		}).moonWireMaterialId = moonWireMaterialId;
	}

	let playing = true;
	let frameHandle = 0;
	const loop = (now: number) => {
		const time = now * 0.001;
		if (playing) {
			sunTransform.rotation = Quat.fromEuler(0, time * 0.16, 0);
			const pulse = 1.6 + Math.sin(time * 1.8) * 0.05;
			sunTransform.scale = new Vec3(pulse, pulse, pulse);

			for (const runtime of bodyRuntimes) {
				const angle = time * runtime.config.orbitSpeed + runtime.config.orbitRadius * 0.18;
				const x = Math.cos(angle) * runtime.config.orbitRadius;
				const z = Math.sin(angle) * runtime.config.orbitRadius;
				runtime.planetTransform.position = new Vec3(x, runtime.config.height + 1.1, z);
				runtime.planetTransform.rotation = Quat.fromEuler(runtime.config.tilt ?? 0, time * runtime.config.spinSpeed, 0);

				if (runtime.ringRenderer) {
					const ringTransform = runtime.ringRenderer.transform as Transform | undefined;
					if (ringTransform) {
						ringTransform.position = new Vec3(x, runtime.config.height + 1.1, z);
						ringTransform.rotation = Quat.fromEuler(-Math.PI * 0.5 + (runtime.config.tilt ?? 0), time * 0.45, 0);
					}
				}

				if (runtime.moonTransform && runtime.config.moon) {
					const moonAngle = time * runtime.config.moon.orbitSpeed;
					runtime.moonTransform.position = new Vec3(
						x + Math.cos(moonAngle) * runtime.config.moon.orbitRadius,
						runtime.config.height + 1.1 + Math.sin(moonAngle * 1.7) * 0.12,
						z + Math.sin(moonAngle) * runtime.config.moon.orbitRadius,
					);
					runtime.moonTransform.rotation = Quat.fromEuler(0, time * 2.2, 0);
				}
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
			sunRenderer.materialId = enabled ? 'playground/solar/sun-wire' : 'playground/solar/sun-fill';
			for (const runtime of bodyRuntimes) {
				runtime.planetRenderer.materialId = enabled ? runtime.wireMaterialId : runtime.fillMaterialId;
				runtime.orbitLineRenderer?.materialId = enabled
					? runtime.orbitLineWireMaterialId ?? runtime.orbitLineFillMaterialId ?? null
					: runtime.orbitLineFillMaterialId ?? runtime.orbitLineWireMaterialId ?? null;
				if (runtime.ringRenderer) {
					runtime.ringRenderer.materialId = enabled
						? runtime.ringWireMaterialId ?? runtime.ringFillMaterialId ?? null
						: runtime.ringFillMaterialId ?? runtime.ringWireMaterialId ?? null;
				}
				if (runtime.moonRenderer) {
					runtime.moonRenderer.materialId = enabled
						? runtime.moonWireMaterialId ?? runtime.moonFillMaterialId ?? null
						: runtime.moonFillMaterialId ?? runtime.moonWireMaterialId ?? null;
				}
			}
		},
		stats: () => ({
			objectCount:
				1 +
				1 +
				bodyRuntimes.length +
				bodyRuntimes.filter((runtime) => runtime.ringRenderer).length +
				bodyRuntimes.filter((runtime) => runtime.moonRenderer).length +
				bodyRuntimes.length +
				grid.actors.length +
				axes.actors.length,
			summary: 'Orbital layout',
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