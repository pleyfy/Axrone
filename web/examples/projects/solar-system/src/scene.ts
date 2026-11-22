import { createRing } from '@axrone/geometry';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController, PointLight } from '@axrone/scene-3d';
import type { SceneMeshDefinition } from '@axrone/scene-runtime';
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
import type { PlaygroundSceneHandle } from '../../shared/playground-types';
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
} from '../assets/data';

type SolarPlanetRuntime = {
	readonly config: SolarPlanetDefinition;
	readonly planetTransform: Transform;
	readonly planetRenderer: MeshRenderer;
	readonly fillMaterialId: string;
	readonly wireMaterialId: string;
	readonly orbitRenderer: MeshRenderer;
	readonly orbitFillMaterialId: string;
	readonly orbitWireMaterialId: string;
	readonly moonTransform?: Transform;
	readonly moonRenderer?: MeshRenderer;
	readonly moonFillMaterialId?: string;
	readonly moonWireMaterialId?: string;
	readonly saturnRingTransform?: Transform;
	readonly saturnRingRenderer?: MeshRenderer;
	readonly saturnRingFillMaterialId?: string;
	readonly saturnRingWireMaterialId?: string;
};

const SOLAR_SPHERE_MESH_ID = 'playground/solar/sphere';
const SOLAR_PLANET_SHADER_ID = 'playground/solar/planet-light';
const SOLAR_STAR_SHADER_ID = 'playground/solar/starfield';
const SOLAR_SATURN_RING_MESH_ID = 'playground/solar/saturn-ring';
const SOLAR_STAR_COUNT = 900;
const SOLAR_ORBIT_SPEED_SCALE = 0.24;
const OPAQUE_DOUBLE_SIDED_STATE = { cullMode: 'none' as const };
const ORBIT_RING_SEGMENTS = 128;

const createAdditivePass = (id: string, primitive: 'triangle-list' | 'point-list' = 'triangle-list') => ({
	id,
	primitive,
	rasterizerState: { cullMode: 'none' as const },
	depthStencilState: {
		depthTest: true,
		depthWrite: false,
	},
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

const SATURN_RING_PASS = {
	id: 'saturn-ring',
	primitive: 'triangle-list' as const,
	rasterizerState: {
		cullMode: 'none' as const,
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

const createStarfieldMesh = (id: string, count: number): SceneMeshDefinition => {
	const vertices = new Float32Array(count * 7);
	const palette = [
		[0.96, 0.98, 1],
		[0.74, 0.84, 1],
		[1, 0.9, 0.72],
		[0.87, 0.82, 1],
	];

	for (let index = 0; index < count; index += 1) {
		const theta = Math.random() * Math.PI * 2;
		const y = Math.random() * 2 - 1;
		const radial = Math.sqrt(Math.max(0, 1 - y * y));
		const radius = 120 + Math.random() * 80;
		const color = palette[Math.floor(Math.random() * palette.length)]!;
		const base = index * 7;
		vertices[base] = Math.cos(theta) * radial * radius;
		vertices[base + 1] = y * radius;
		vertices[base + 2] = Math.sin(theta) * radial * radius;
		vertices[base + 3] = color[0]!;
		vertices[base + 4] = color[1]!;
		vertices[base + 5] = color[2]!;
		vertices[base + 6] = 0.35 + Math.random() * 0.65;
	}

	return {
		id,
		vertices,
		vertexCount: count,
		topology: 'points',
		attributes: [
			{ semantic: 'position', componentCount: 3, offset: 0, stride: 7 * Float32Array.BYTES_PER_ELEMENT },
			{
				semantic: 'color0',
				componentCount: 4,
				offset: 3 * Float32Array.BYTES_PER_ELEMENT,
				stride: 7 * Float32Array.BYTES_PER_ELEMENT,
			},
		],
	};
};

export const createSolarSystemScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: SOLAR_CLEAR_COLOR,
		ambientLight: SOLAR_AMBIENT_LIGHT,
		background:
			'radial-gradient(circle at 50% 48%, rgba(255, 170, 76, 0.28) 0%, rgba(255, 140, 54, 0.12) 13%, transparent 34%), radial-gradient(75% 55% at 72% 18%, rgba(92, 68, 156, 0.3), transparent 62%), radial-gradient(65% 55% at 18% 72%, rgba(30, 64, 105, 0.25), transparent 70%), linear-gradient(180deg, #050813 0%, #0a1122 55%, #04060c 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/solar');
	const meshBuilder = createMeshBuilder();

	scene.createSphereMesh(SOLAR_SPHERE_MESH_ID, 1, 40);
	scene.registerMesh(
		meshBuilder.createDefinition(
			SOLAR_SATURN_RING_MESH_ID,
			createRing({ innerRadius: 1.8, outerRadius: 2.8, segments: 96 }),
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
out vec3 v_LocalPosition;
void main() {
	vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
	v_WorldPosition = worldPosition.xyz;
	v_WorldNormal = normalize(mat3(u_Model) * a_Normal);
	v_LocalPosition = a_Position;
	gl_Position = u_Projection * u_View * worldPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
uniform float u_Roughness;
uniform bool u_ReceiveLighting;
uniform vec3 u_AmbientLight;
uniform vec3 u_CameraPosition;
uniform int u_LocalLightCount;
uniform int u_LocalLightType[4];
uniform vec3 u_LocalLightPosition[4];
uniform vec3 u_LocalLightColor[4];
uniform float u_LocalLightIntensity[4];
uniform float u_LocalLightRange[4];
uniform vec3 u_BandColor;
uniform float u_BandStrength;
uniform float u_BandFrequency;
uniform vec3 u_RimColor;
uniform float u_RimStrength;
in vec3 v_WorldPosition;
in vec3 v_WorldNormal;
in vec3 v_LocalPosition;
out vec4 o_Color;

vec3 softClip(vec3 color) {
	float peak = max(color.r, max(color.g, color.b));
	return peak > 0.92 ? color * (0.92 / peak) : color;
}

void main() {
	vec3 normal = normalize(v_WorldNormal);
	vec3 viewDirection = normalize(u_CameraPosition - v_WorldPosition);
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
			float shininess = mix(84.0, 16.0, clamp(u_Roughness, 0.0, 1.0));
			float specular = pow(max(dot(normal, halfVector), 0.0), shininess) * (1.0 - clamp(u_Roughness, 0.0, 1.0)) * 0.32;
			vec3 lightColor = u_LocalLightColor[lightIndex] * u_LocalLightIntensity[lightIndex] * attenuation;
			diffuseLighting += lightColor * diffuse;
			specularLighting += lightColor * specular;
		}
	}
	float bandWave = sin(v_LocalPosition.y * u_BandFrequency + sin(v_LocalPosition.x * u_BandFrequency * 0.55) * 0.85);
	float bandMix = smoothstep(-0.35, 0.75, bandWave) * u_BandStrength;
	vec3 baseColor = mix(u_Color.rgb, u_BandColor, bandMix);
	float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
	vec3 shaded = baseColor * (u_AmbientLight + diffuseLighting) + specularLighting;
	shaded += u_RimColor * rim * u_RimStrength;
	o_Color = vec4(softClip(shaded), u_Color.a);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_Color',
			'u_Roughness',
			'u_ReceiveLighting',
			'u_AmbientLight',
			'u_CameraPosition',
			'u_LocalLightCount',
			'u_LocalLightType',
			'u_LocalLightPosition',
			'u_LocalLightColor',
			'u_LocalLightIntensity',
			'u_LocalLightRange',
			'u_BandColor',
			'u_BandStrength',
			'u_BandFrequency',
			'u_RimColor',
			'u_RimStrength',
		],
	});

	scene.registerShader({
		id: SOLAR_STAR_SHADER_ID,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 3) in vec4 a_Color0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
uniform vec2 u_Resolution;
uniform float u_StarSize;
out vec4 v_Color;
void main() {
	v_Color = a_Color0;
	gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
	gl_PointSize = max(1.0, u_StarSize * (u_Resolution.y / 900.0));
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform float u_Opacity;
in vec4 v_Color;
out vec4 o_Color;
void main() {
	vec2 centered = gl_PointCoord - vec2(0.5);
	float distanceToCenter = length(centered);
	float alpha = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
	o_Color = vec4(v_Color.rgb, v_Color.a * alpha * u_Opacity);
}`,
		uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Resolution', 'u_StarSize', 'u_Opacity'],
	});

	const registerPlanetMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		roughness: number,
		polygonMode: 'fill' | 'line',
		bands?: SolarPlanetDefinition['bands'],
		rim?: SolarPlanetDefinition['rim'],
	) => {
		scene.createMaterial({
			id,
			shaderId: SOLAR_PLANET_SHADER_ID,
			uniforms: {
				u_Color: color,
				u_Roughness: roughness,
				u_BandColor: bands?.color ?? [0, 0, 0],
				u_BandStrength: bands?.strength ?? 0,
				u_BandFrequency: bands?.frequency ?? 1,
				u_RimColor: rim?.color ?? [0, 0, 0],
				u_RimStrength: rim?.strength ?? 0,
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
			readonly passes?: readonly unknown[];
		},
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.solid,
			uniforms: { u_Color: color },
			surface: options?.passes ? { alphaMode: 'blend' } : undefined,
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
			...(options?.passes ? { passes: options.passes as never } : {}),
		});
	};

	registerSolidMaterial('playground/solar/sun-fill', SOLAR_SUN_COLOR, 'fill');
	registerSolidMaterial('playground/solar/sun-wire', SOLAR_SUN_WIREFRAME_COLOR, 'line');

	const camera = scene.createCameraActor(
		{ name: 'SolarCamera' },
		{ primary: true, fieldOfView: 55, near: 0.1, far: 800 },
	);
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0, 0],
		distance: 102,
		minDistance: 26,
		maxDistance: 140,
		azimuth: 0.72,
		elevation: 0.78,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.18,
		maxElevation: 1.2,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/solar',
		size: 120,
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
	sunTransform.scale = new Vec3(3.1, 3.1, 3.1);
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

	const fillLight = scene.createActor({ name: 'SolarFillLight' });
	fillLight.requireComponent(Transform).position = new Vec3(34, 42, 46);
	fillLight.addComponent(PointLight, {
		color: [0.55, 0.68, 1],
		intensity: 0.5,
		range: 220,
	});
	const rimLight = scene.createActor({ name: 'SolarRimLight' });
	rimLight.requireComponent(Transform).position = new Vec3(-52, 26, -38);
	rimLight.addComponent(PointLight, {
		color: [0.45, 0.52, 0.85],
		intensity: 0.3,
		range: 220,
	});

	const planetRuntimes: SolarPlanetRuntime[] = [];

	for (const planet of SOLAR_PLANETS) {
		const fillMaterialId = `playground/solar/${planet.id}-fill`;
		const wireMaterialId = `playground/solar/${planet.id}-wire`;
		registerPlanetMaterial(fillMaterialId, planet.color, planet.roughness, 'fill', planet.bands, planet.rim);
		registerSolidMaterial(wireMaterialId, [0.5, 0.58, 0.72, 1], 'line');

		const orbitFillMaterialId = `playground/solar/${planet.id}-orbit-fill`;
		const orbitWireMaterialId = `playground/solar/${planet.id}-orbit-wire`;
		const orbitMeshId = `playground/solar/${planet.id}-orbit-mesh`;
		const orbitThickness = 0.15;
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
		const orbitColor = [
			Math.min(1, planet.color[0] * 0.8 + 0.12),
			Math.min(1, planet.color[1] * 0.8 + 0.12),
			Math.min(1, planet.color[2] * 0.8 + 0.16),
			0.42,
		] as const;
		scene.createMaterial({
			id: orbitFillMaterialId,
			shaderId: shaders.solid,
			uniforms: { u_Color: orbitColor },
			surface: { alphaMode: 'blend' },
			passes: [createAdditivePass(`solar-orbit-${planet.id}`)],
		});
		registerSolidMaterial(orbitWireMaterialId, [0.6, 0.72, 0.92, 1], 'line', { doubleSided: true });

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

		let moonTransform: Transform | undefined;
		let moonRenderer: MeshRenderer | undefined;
		let moonFillMaterialId: string | undefined;
		let moonWireMaterialId: string | undefined;
		if (planet.moon) {
			moonFillMaterialId = `playground/solar/${planet.id}-moon-fill`;
			moonWireMaterialId = `playground/solar/${planet.id}-moon-wire`;
			registerPlanetMaterial(
				moonFillMaterialId,
				planet.moon.color,
				0.72,
				'fill',
				undefined,
				{ color: [0.9, 0.88, 0.82], strength: 0.12 },
			);
			registerSolidMaterial(moonWireMaterialId, [0.72, 0.7, 0.64, 1], 'line');
			const moonActor = scene.createRenderableActor(
				{ name: `${planet.label}Moon` },
				{ meshId: SOLAR_SPHERE_MESH_ID, materialId: moonFillMaterialId, receiveLighting: true },
			);
			moonTransform = moonActor.requireComponent(Transform);
			moonTransform.scale = new Vec3(planet.moon.radius, planet.moon.radius, planet.moon.radius);
			moonRenderer = moonActor.getComponent(MeshRenderer) ?? undefined;
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
			registerSolidMaterial(saturnRingWireMaterialId, [0.9, 0.83, 0.63, 1], 'line', { doubleSided: true });

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
			moonTransform,
			moonRenderer,
			moonFillMaterialId,
			moonWireMaterialId,
			saturnRingTransform,
			saturnRingRenderer,
			saturnRingFillMaterialId,
			saturnRingWireMaterialId,
		});
	}

	const starfieldMeshes = [
		{ id: 'playground/solar/stars-faint', count: 900, size: 2.8, opacity: 0.75 },
		{ id: 'playground/solar/stars-bright', count: 120, size: 4.6, opacity: 1 },
	];
	const starfieldActors: ReturnType<typeof scene.createRenderableActor>[] = [];
	for (const layer of starfieldMeshes) {
		scene.registerMesh(createStarfieldMesh(layer.id, layer.count));
		const materialId = `${layer.id}-material`;
		scene.createMaterial({
			id: materialId,
			shaderId: SOLAR_STAR_SHADER_ID,
			uniforms: {
				u_StarSize: layer.size,
				u_Opacity: layer.opacity,
			},
			surface: { alphaMode: 'blend' },
			passes: [createAdditivePass(`${layer.id}-pass`, 'point-list')],
		});
		const actor = scene.createRenderableActor(
			{ name: `${layer.id}-actor` },
			{ meshId: layer.id, materialId, receiveLighting: false },
		);
		starfieldActors.push(actor);
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
			sunTransform.rotation = Quat.fromEuler(0, elapsed * 0.12, 0);
			for (const starfieldActor of starfieldActors) {
				starfieldActor.requireComponent(Transform).rotation = Quat.fromEuler(0, elapsed * 0.0035, 0);
			}

			for (const runtime of planetRuntimes) {
				const angle = runtime.config.meanAnomaly + elapsed * runtime.config.speed * SOLAR_ORBIT_SPEED_SCALE;
				const planetX = Math.cos(angle) * runtime.config.distance;
				const planetZ = Math.sin(angle) * runtime.config.distance;
				runtime.planetTransform.position = new Vec3(planetX, 0, planetZ);
				runtime.planetTransform.rotation = Quat.fromEuler(0, elapsed * 1.2 + runtime.config.meanAnomaly, 0);

				if (runtime.moonTransform && runtime.config.moon) {
					const moonAngle = elapsed * runtime.config.moon.speed + runtime.config.meanAnomaly;
					runtime.moonTransform.position = new Vec3(
						planetX + Math.cos(moonAngle) * runtime.config.moon.distance,
						Math.sin(moonAngle * 0.6) * 0.18,
						planetZ + Math.sin(moonAngle) * runtime.config.moon.distance,
					);
					runtime.moonTransform.rotation = Quat.fromEuler(0, elapsed * 1.8, 0);
				}

				if (runtime.saturnRingTransform) {
					runtime.saturnRingTransform.position = new Vec3(planetX, 0, planetZ);
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
				if (runtime.moonRenderer && runtime.moonFillMaterialId && runtime.moonWireMaterialId) {
					runtime.moonRenderer.materialId = enabled ? runtime.moonWireMaterialId : runtime.moonFillMaterialId;
				}
				if (runtime.saturnRingRenderer && runtime.saturnRingFillMaterialId && runtime.saturnRingWireMaterialId) {
					runtime.saturnRingRenderer.materialId = enabled
						? runtime.saturnRingWireMaterialId
						: runtime.saturnRingFillMaterialId;
				}
			}
		},
		stats: () => ({
			objectCount: 1 + planetRuntimes.length * 2 + 1 + 1 + 2,
			summary: `${planetRuntimes.length} planets · 1 moon`,
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
