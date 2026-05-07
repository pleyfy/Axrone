import { createRing } from '@axrone/geometry';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController, PointLight } from '@axrone/scene-3d';
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
	SOLAR_AMBIENT_LIGHT,
	SOLAR_CLEAR_COLOR,
	SOLAR_GRID_MAJOR,
	SOLAR_GRID_MINOR,
	SOLAR_LIGHT_COLOR,
	SOLAR_LIGHT_INTENSITY,
	SOLAR_LIGHT_RANGE,
	SOLAR_PLANETS,
	SOLAR_SUN_COLOR,
	SOLAR_SUN_WIREFRAME_COLOR,
	type SolarPlanetDefinition,
} from './data';

type SolarPlanetRuntime = {
	readonly config: SolarPlanetDefinition;
	readonly planetTransform: Transform;
	readonly planetRenderer: MeshRenderer;
	readonly fillMaterialId: string;
	readonly wireMaterialId: string;
	readonly orbitRenderer: MeshRenderer;
	readonly orbitFillMaterialId: string;
	readonly orbitWireMaterialId: string;
	readonly saturnRingTransform?: Transform;
	readonly saturnRingRenderer?: MeshRenderer;
	readonly saturnRingFillMaterialId?: string;
	readonly saturnRingWireMaterialId?: string;
};

const SOLAR_SPHERE_MESH_ID = 'playground/solar/sphere';
const SOLAR_PLANET_SHADER_ID = 'playground/solar/planet-light';
const SOLAR_SATURN_RING_MESH_ID = 'playground/solar/saturn-ring';
const SOLAR_ORBIT_SPEED_SCALE = 0.24;
const OPAQUE_DOUBLE_SIDED_STATE = { cullMode: 'off' as const };
const ORBIT_RING_SEGMENTS = 128;
const SATURN_RING_PASS = {
	id: 'saturn-ring',
	primitive: 'triangle-list' as const,
	rasterizerState: {
		cullMode: 'off' as const,
	},
	depthStencilState: {
		depthTest: true,
		depthWrite: false,
	},
	blendState: {
		targets: [
			{
				blend: true,
				srcColorFactor: 'src-alpha' as const,
				dstColorFactor: 'one-minus-src-alpha' as const,
				srcAlphaFactor: 'one' as const,
				dstAlphaFactor: 'one-minus-src-alpha' as const,
			},
		],
	},
};

export const createSolarSystemScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: SOLAR_CLEAR_COLOR,
		ambientLight: SOLAR_AMBIENT_LIGHT,
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/solar');
	const meshBuilder = createMeshBuilder();

	scene.createSphereMesh(SOLAR_SPHERE_MESH_ID, 1, 32, 32);
	scene.registerMesh(
		meshBuilder.createDefinition(
			SOLAR_SATURN_RING_MESH_ID,
			createRing({ innerRadius: 1.8, outerRadius: 2.8, segments: 64 }),
		),
	);

	scene.registerShader({
		id: SOLAR_PLANET_SHADER_ID,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_WorldPosition;
out vec3 v_WorldNormal;
void main() {
	vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
	v_WorldPosition = worldPosition.xyz;
	v_WorldNormal = normalize(mat3(u_Model) * a_Normal);
	gl_Position = u_Projection * u_View * worldPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
uniform float u_Roughness;
uniform bool u_ReceiveLighting;
uniform vec3 u_AmbientLight;
uniform int u_LocalLightCount;
uniform int u_LocalLightType[4];
uniform vec3 u_LocalLightPosition[4];
uniform vec3 u_LocalLightColor[4];
uniform float u_LocalLightIntensity[4];
uniform float u_LocalLightRange[4];
in vec3 v_WorldPosition;
in vec3 v_WorldNormal;
out vec4 o_Color;
void main() {
	vec3 normal = normalize(v_WorldNormal);
	vec3 viewDirection = normalize(-v_WorldPosition);
	vec3 diffuseLighting = vec3(0.0);
	vec3 specularLighting = vec3(0.0);
	if (u_ReceiveLighting) {
		for (int lightIndex = 0; lightIndex < 4; lightIndex++) {
			if (lightIndex >= u_LocalLightCount) {
				break;
			}
			if (u_LocalLightType[lightIndex] != 0) {
				continue;
			}
			vec3 toLight = u_LocalLightPosition[lightIndex] - v_WorldPosition;
			float distanceToLight = length(toLight);
			if (distanceToLight <= 0.0001 || distanceToLight >= u_LocalLightRange[lightIndex]) {
				continue;
			}
			vec3 lightDirection = toLight / distanceToLight;
			float attenuation = 1.0 - smoothstep(0.0, u_LocalLightRange[lightIndex], distanceToLight);
			attenuation *= attenuation;
			float diffuse = max(dot(normal, lightDirection), 0.0);
			vec3 halfVector = normalize(lightDirection + viewDirection);
			float shininess = mix(72.0, 12.0, clamp(u_Roughness, 0.0, 1.0));
			float specular = pow(max(dot(normal, halfVector), 0.0), shininess) * (1.0 - clamp(u_Roughness, 0.0, 1.0)) * 0.35;
			vec3 lightColor = u_LocalLightColor[lightIndex] * u_LocalLightIntensity[lightIndex] * attenuation;
			diffuseLighting += lightColor * diffuse;
			specularLighting += lightColor * specular;
		}
	}
	vec3 shaded = u_Color.rgb * (u_AmbientLight + diffuseLighting) + specularLighting;
	o_Color = vec4(shaded, u_Color.a);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_Color',
			'u_Roughness',
			'u_ReceiveLighting',
			'u_AmbientLight',
			'u_LocalLightCount',
			'u_LocalLightType',
			'u_LocalLightPosition',
			'u_LocalLightColor',
			'u_LocalLightIntensity',
			'u_LocalLightRange',
		],
	});

	const registerPlanetMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		roughness: number,
		polygonMode: 'fill' | 'line',
	) => {
		scene.createMaterial({
			id,
			shaderId: SOLAR_PLANET_SHADER_ID,
			uniforms: {
				u_Color: color,
				u_Roughness: roughness,
			},
			rasterizerState: polygonMode === 'line' ? { polygonMode: 'line', lineWidth: 1 } : undefined,
		});
	};

	const registerSolidMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		polygonMode: 'fill' | 'line',
		options?: {
			readonly doubleSided?: boolean;
			readonly passes?: readonly [typeof SATURN_RING_PASS];
		},
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.solid,
			uniforms: { u_Color: color },
			rasterizerState:
				polygonMode === 'line'
					? {
						polygonMode: 'line',
						lineWidth: 1,
						...(options?.doubleSided ? OPAQUE_DOUBLE_SIDED_STATE : {}),
					}
					: options?.doubleSided
						? OPAQUE_DOUBLE_SIDED_STATE
						: undefined,
			...(options?.passes ? { passes: options.passes } : {}),
		});
	};

	registerSolidMaterial('playground/solar/sun-fill', SOLAR_SUN_COLOR, 'fill');
	registerSolidMaterial('playground/solar/sun-wire', SOLAR_SUN_WIREFRAME_COLOR, 'line');

	const camera = scene.createCameraActor({ name: 'SolarCamera' }, { primary: true, fieldOfView: 60 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0, 0],
		distance: 52,
		minDistance: 12,
		maxDistance: 120,
		azimuth: Math.PI * 0.25,
		elevation: 0.92,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.22,
		maxElevation: 1.25,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/solar',
		size: 80,
		scale: 2,
		y: 0,
		color: SOLAR_GRID_MAJOR,
		gridColor: SOLAR_GRID_MINOR,
		backgroundColor: SOLAR_CLEAR_COLOR.slice(0, 3),
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/solar', length: 5 });
	axes.setVisible(false);

	const sun = scene.createRenderableActor(
		{ name: 'SolarSun' },
		{ meshId: SOLAR_SPHERE_MESH_ID, materialId: 'playground/solar/sun-fill', receiveLighting: false },
	);
	const sunTransform = sun.requireComponent(Transform);
	sunTransform.scale = new Vec3(3, 3, 3);
	const sunRenderer = sun.getComponent(MeshRenderer);
	if (!sunRenderer) {
		throw new Error('Solar system sun renderer was not created correctly.');
	}

	const sunLight = scene.createActor({ name: 'SolarSunLight' });
	sunLight.addComponent(PointLight, {
		color: SOLAR_LIGHT_COLOR,
		intensity: SOLAR_LIGHT_INTENSITY,
		range: SOLAR_LIGHT_RANGE,
	});

	const planetRuntimes: SolarPlanetRuntime[] = [];

	for (const planet of SOLAR_PLANETS) {
		const fillMaterialId = `playground/solar/${planet.id}-fill`;
		const wireMaterialId = `playground/solar/${planet.id}-wire`;
		registerPlanetMaterial(fillMaterialId, planet.color, planet.roughness, 'fill');
		registerSolidMaterial(wireMaterialId, [0.3, 0.26, 0.23, 1], 'line');

		const orbitFillMaterialId = `playground/solar/${planet.id}-orbit-fill`;
		const orbitWireMaterialId = `playground/solar/${planet.id}-orbit-wire`;
		const orbitMeshId = `playground/solar/${planet.id}-orbit-mesh`;
		const orbitThickness = 0.11;
		scene.registerMesh(
			meshBuilder.createDefinition(
				orbitMeshId,
				createRing({
					innerRadius: Math.max(0.01, planet.distance - orbitThickness * 0.5),
					outerRadius: planet.distance + orbitThickness * 0.5,
					segments: ORBIT_RING_SEGMENTS,
				}),
			),
		);
		registerSolidMaterial(orbitFillMaterialId, [0.66, 0.64, 0.6, 0.96], 'fill', {
			doubleSided: true,
		});
		registerSolidMaterial(orbitWireMaterialId, [0.52, 0.5, 0.47, 1], 'line', { doubleSided: true });

		const orbitActor = scene.createRenderableActor(
			{ name: `${planet.label}OrbitRing` },
			{ meshId: orbitMeshId, materialId: orbitFillMaterialId, receiveLighting: false },
		);
		const orbitTransform = orbitActor.requireComponent(Transform);
		orbitTransform.position = new Vec3(0, 0.03, 0);

		const planetActor = scene.createRenderableActor(
			{ name: planet.label },
			{ meshId: SOLAR_SPHERE_MESH_ID, materialId: fillMaterialId, receiveLighting: true },
		);
		const planetTransform = planetActor.requireComponent(Transform);
		planetTransform.scale = new Vec3(planet.radius, planet.radius, planet.radius);

		const planetRenderer = planetActor.getComponent(MeshRenderer);
		const orbitRenderer = orbitActor.getComponent(MeshRenderer);
		if (!planetRenderer || !orbitRenderer) {
			throw new Error(`Solar system actor setup failed for ${planet.label}.`);
		}

		let saturnRingTransform: Transform | undefined;
		let saturnRingRenderer: MeshRenderer | undefined;
		let saturnRingFillMaterialId: string | undefined;
		let saturnRingWireMaterialId: string | undefined;

		if (planet.ring) {
			saturnRingFillMaterialId = `playground/solar/${planet.id}-ring-fill`;
			saturnRingWireMaterialId = `playground/solar/${planet.id}-ring-wire`;
			registerSolidMaterial(saturnRingFillMaterialId, planet.ring.color, 'fill', {
				doubleSided: true,
				passes: [SATURN_RING_PASS],
			});
			registerSolidMaterial(saturnRingWireMaterialId, [0.72, 0.68, 0.55, 1], 'line', { doubleSided: true });

			const saturnRing = scene.createRenderableActor(
				{ name: `${planet.label}Ring` },
				{ meshId: SOLAR_SATURN_RING_MESH_ID, materialId: saturnRingFillMaterialId, receiveLighting: false },
			);
			saturnRingTransform = saturnRing.requireComponent(Transform);
			saturnRingRenderer = saturnRing.getComponent(MeshRenderer) ?? undefined;
		}

		planetRuntimes.push({
			config: planet,
			planetTransform,
			planetRenderer,
			fillMaterialId,
			wireMaterialId,
			orbitRenderer,
			orbitFillMaterialId,
			orbitWireMaterialId,
			saturnRingTransform,
			saturnRingRenderer,
			saturnRingFillMaterialId,
			saturnRingWireMaterialId,
		});
	}

	console.log(`Solar system: ${planetRuntimes.length} planets`);

	let playing = true;
	let frameHandle = 0;
	let elapsed = 0;
	let previousTime = 0;
	const loop = (now: number) => {
		const deltaSeconds = previousTime === 0 ? 0 : Math.min((now - previousTime) / 1000, 0.05);
		if (playing) {
			elapsed += deltaSeconds;
			sunTransform.rotation = Quat.fromEuler(0, elapsed * 0.18, 0);

			for (const runtime of planetRuntimes) {
				const angle = runtime.config.meanAnomaly + elapsed * runtime.config.speed * SOLAR_ORBIT_SPEED_SCALE;
				const x = Math.cos(angle) * runtime.config.distance;
				const z = Math.sin(angle) * runtime.config.distance;
				const y = 0;
				runtime.planetTransform.position = new Vec3(x, y, z);
				runtime.planetTransform.rotation = Quat.fromEuler(0, elapsed * 1.2 + runtime.config.meanAnomaly, 0);

				if (runtime.saturnRingTransform) {
					runtime.saturnRingTransform.position = new Vec3(x, y, z);
					runtime.saturnRingTransform.rotation = Quat.fromEuler(runtime.config.ring?.tilt ?? 0, 0, 0);
				}
			}
		}
		previousTime = now;

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
		setWireframe(enabled: boolean) {
			sunRenderer.materialId = enabled ? 'playground/solar/sun-wire' : 'playground/solar/sun-fill';
			for (const runtime of planetRuntimes) {
				runtime.planetRenderer.materialId = enabled ? runtime.wireMaterialId : runtime.fillMaterialId;
				runtime.orbitRenderer.materialId = enabled ? runtime.orbitWireMaterialId : runtime.orbitFillMaterialId;
				if (runtime.saturnRingRenderer && runtime.saturnRingFillMaterialId && runtime.saturnRingWireMaterialId) {
					runtime.saturnRingRenderer.materialId = enabled
						? runtime.saturnRingWireMaterialId
						: runtime.saturnRingFillMaterialId;
				}
			}
		},
		stats: () => ({
			objectCount: 1 + planetRuntimes.length,
			summary: `${planetRuntimes.length} planets`,
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