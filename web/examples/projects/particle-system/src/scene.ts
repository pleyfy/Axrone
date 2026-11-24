import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController } from '@axrone/scene-3d';
import type { SceneMeshDefinition } from '@axrone/scene-runtime';
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
import {
	PARTICLE_CEILING,
	PARTICLE_CLEAR_COLOR,
	PARTICLE_COUNT,
	PARTICLE_DUST_COUNT,
	PARTICLE_DUST_POINT_SIZE,
	PARTICLE_GRID_MAJOR,
	PARTICLE_GRID_MINOR,
	PARTICLE_HORIZONTAL_SPAN,
	PARTICLE_POINT_SIZE,
	PARTICLE_VERTICAL_SPAN,
	ParticleEmitter,
	createParticleColor,
	type EmittedParticle,
} from '../assets/particle-data';

type ParticleState = EmittedParticle & {
	readonly color: readonly [number, number, number, number];
};

const PARTICLE_MESH_ID = 'playground/particles/cloud';
const PARTICLE_DUST_MESH_ID = 'playground/particles/dust';
const PARTICLE_SHADER_ID = 'playground/particles/points';
const PARTICLE_FILL_MATERIAL_ID = 'playground/particles/fill';
const PARTICLE_WIRE_MATERIAL_ID = 'playground/particles/wire';
const PARTICLE_DUST_MATERIAL_ID = 'playground/particles/dust-material';
const PARTICLE_GLOW_MESH_ID = 'playground/particles/ground-glow';
const PARTICLE_GLOW_SHADER_ID = 'playground/particles/ground-glow-shader';
const PARTICLE_GLOW_MATERIAL_ID = 'playground/particles/ground-glow-material';
const PARTICLE_CORE_GLOW_SHADER_ID = 'playground/particles/core-glow-shader';
const PARTICLE_CORE_MESH_ID = 'playground/particles/core-sphere';
const PARTICLE_VERTEX_FLOATS = 7;
const PARTICLE_VERTEX_STRIDE = PARTICLE_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const GL_DYNAMIC_DRAW = 0x88e8;

const createAdditivePointPass = (id: string) => ({
	id,
	primitive: 'point-list' as const,
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

const createAdditiveTrianglePass = (id: string) => ({
	id,
	primitive: 'triangle-list' as const,
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

const writeParticleVertex = (
	vertices: Float32Array,
	index: number,
	particle: ParticleState,
	alpha: number,
): void => {
	const base = index * PARTICLE_VERTEX_FLOATS;
	vertices[base] = particle.position.x;
	vertices[base + 1] = particle.position.y;
	vertices[base + 2] = particle.position.z;
	vertices[base + 3] = particle.color[0];
	vertices[base + 4] = particle.color[1];
	vertices[base + 5] = particle.color[2];
	vertices[base + 6] = particle.color[3] * alpha;
};

const createParticleMeshDefinition = (
	id: string,
	vertices: Float32Array,
	count: number,
	usage: number,
): SceneMeshDefinition => ({
	id,
	vertices,
	vertexCount: count,
	topology: 'points',
	usage,
	attributes: [
		{ semantic: 'position', componentCount: 3, offset: 0, stride: PARTICLE_VERTEX_STRIDE },
		{
			semantic: 'color0',
			componentCount: 4,
			offset: Float32Array.BYTES_PER_ELEMENT * 3,
			stride: PARTICLE_VERTEX_STRIDE,
		},
	],
});

const randomHorizontal = (): number => (Math.random() - 0.5) * PARTICLE_HORIZONTAL_SPAN;

const resetParticlePosition = (particle: ParticleState, y: number): void => {
	particle.position.x = randomHorizontal();
	particle.position.y = y;
	particle.position.z = randomHorizontal();
};

const createDustVertices = (): Float32Array => {
	const vertices = new Float32Array(PARTICLE_DUST_COUNT * PARTICLE_VERTEX_FLOATS);
	for (let index = 0; index < PARTICLE_DUST_COUNT; index += 1) {
		const color = createParticleColor();
		const base = index * PARTICLE_VERTEX_FLOATS;
		vertices[base] = (Math.random() - 0.5) * 30;
		vertices[base + 1] = Math.random() * 18;
		vertices[base + 2] = (Math.random() - 0.5) * 30;
		vertices[base + 3] = color[0];
		vertices[base + 4] = color[1];
		vertices[base + 5] = color[2];
		vertices[base + 6] = 0.08 + Math.random() * 0.22;
	}
	return vertices;
};

export const createParticleSystemScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: PARTICLE_CLEAR_COLOR,
		background:
			'radial-gradient(70% 60% at 50% 44%, rgba(26, 150, 126, 0.38), transparent 64%), radial-gradient(50% 40% at 68% 22%, rgba(220, 120, 50, 0.18), transparent 70%), linear-gradient(180deg, #03100e 0%, #06231d 55%, #020a09 100%)',
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/particles');

	scene.registerShader({
		id: PARTICLE_SHADER_ID,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 3) in vec4 a_Color0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
uniform vec2 u_Resolution;
uniform float u_PointSize;
out vec4 v_Color;
void main() {
	vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
	vec4 viewPosition = u_View * worldPosition;
	float distanceToCamera = max(-viewPosition.z, 0.001);
	gl_PointSize = max(1.0, u_PointSize * 0.5 * u_Resolution.y * u_Projection[1][1] / distanceToCamera);
	v_Color = a_Color0;
	gl_Position = u_Projection * viewPosition;
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
	vec3 color = v_Color.rgb * (0.82 + 0.35 * (1.0 - distanceToCenter * 2.0));
	o_Color = vec4(color, v_Color.a * alpha * u_Opacity);
}`,
		uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Resolution', 'u_PointSize', 'u_Opacity'],
	});

	scene.createMaterial({
		id: PARTICLE_FILL_MATERIAL_ID,
		shaderId: PARTICLE_SHADER_ID,
		uniforms: {
			u_PointSize: PARTICLE_POINT_SIZE,
			u_Opacity: 0.9,
		},
		surface: { alphaMode: 'blend' },
		passes: [createAdditivePointPass('particle-cloud-points')],
	});
	scene.createMaterial({
		id: PARTICLE_WIRE_MATERIAL_ID,
		shaderId: PARTICLE_SHADER_ID,
		uniforms: {
			u_PointSize: PARTICLE_POINT_SIZE * 1.35,
			u_Opacity: 0.75,
		},
		surface: { alphaMode: 'blend' },
		passes: [createAdditivePointPass('particle-wire-points')],
	});
	scene.createMaterial({
		id: PARTICLE_DUST_MATERIAL_ID,
		shaderId: PARTICLE_SHADER_ID,
		uniforms: {
			u_PointSize: PARTICLE_DUST_POINT_SIZE,
			u_Opacity: 0.45,
		},
		surface: { alphaMode: 'blend' },
		passes: [createAdditivePointPass('particle-dust-points')],
	});

	scene.registerShader({
		id: PARTICLE_GLOW_SHADER_ID,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_Local;
void main() {
	v_Local = a_Position.xz;
	gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
uniform float u_Opacity;
in vec2 v_Local;
out vec4 o_Color;
void main() {
	float distanceToCenter = length(v_Local) * 2.0;
	float alpha = pow(max(0.0, 1.0 - distanceToCenter), 2.2);
	o_Color = vec4(u_Color.rgb, alpha * u_Opacity);
}`,
		uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Color', 'u_Opacity'],
	});
	scene.createPlaneMesh(PARTICLE_GLOW_MESH_ID, 34, 34);
	scene.createMaterial({
		id: PARTICLE_GLOW_MATERIAL_ID,
		shaderId: PARTICLE_GLOW_SHADER_ID,
		uniforms: {
			u_Color: [0.1, 0.58, 0.48, 1],
			u_Opacity: 0.26,
		},
		surface: { alphaMode: 'blend' },
		passes: [createAdditiveTrianglePass('particle-ground-glow')],
	});

	scene.createSphereMesh(PARTICLE_CORE_MESH_ID, 1, 40);
	scene.registerShader({
		id: PARTICLE_CORE_GLOW_SHADER_ID,
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
uniform vec4 u_GlowColor;
uniform float u_GlowIntensity;
uniform float u_GlowPower;
uniform vec3 u_CameraPosition;
in vec3 v_WorldPosition;
in vec3 v_WorldNormal;
out vec4 o_Color;
void main() {
	vec3 normal = normalize(v_WorldNormal);
	vec3 viewDirection = normalize(u_CameraPosition - v_WorldPosition);
	float facing = max(dot(normal, viewDirection), 0.0);
	float glow = pow(facing, u_GlowPower);
	o_Color = vec4(u_GlowColor.rgb * u_GlowIntensity * glow, glow);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_GlowColor',
			'u_GlowIntensity',
			'u_GlowPower',
			'u_CameraPosition',
		],
	});
	const coreGlows = [
		{
			id: 'particle-core-teal',
			color: [0.12, 0.78, 0.62, 1] as const,
			intensity: 0.24,
			power: 2.2,
			scale: 6.2,
			position: [0, 5.4, 0] as const,
		},
		{
			id: 'particle-core-amber',
			color: [1, 0.55, 0.22, 1] as const,
			intensity: 0.12,
			power: 3,
			scale: 3.2,
			position: [1.8, 6.4, -1.2] as const,
		},
	];
	for (const glow of coreGlows) {
		const materialId = `${glow.id}-material`;
		scene.createMaterial({
			id: materialId,
			shaderId: PARTICLE_CORE_GLOW_SHADER_ID,
			uniforms: {
				u_GlowColor: glow.color,
				u_GlowIntensity: glow.intensity,
				u_GlowPower: glow.power,
			},
			surface: { alphaMode: 'blend' },
			passes: [createAdditiveTrianglePass(`${glow.id}-pass`)],
		});
		const entity = scene.createRenderableEntity(
			{ name: glow.id },
			{ meshId: PARTICLE_CORE_MESH_ID, materialId, receiveLighting: false },
		);
		const transform = entity.requireComponent(Transform);
		transform.position = new Vec3(glow.position[0], glow.position[1], glow.position[2]);
		transform.scale = new Vec3(glow.scale, glow.scale, glow.scale);
	}

	const camera = scene.createCameraEntity(
		{ name: 'ParticleCamera' },
		{ primary: true, fieldOfView: 62, near: 0.1, far: 400 },
	);
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 5, 0],
		distance: 16.8,
		minDistance: 5,
		maxDistance: 28,
		azimuth: 0.62,
		elevation: 0.16,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.03,
		maxElevation: 1.3,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/particles',
		size: 24,
		scale: 1,
		y: 0.014,
		color: PARTICLE_GRID_MAJOR,
		gridColor: PARTICLE_GRID_MINOR,
		backgroundColor: PARTICLE_CLEAR_COLOR.slice(0, 3),
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/particles', length: 5 });
	axes.setVisible(false);

	const glowEntity = scene.createRenderableEntity(
		{ name: 'ParticleGroundGlow' },
		{ meshId: PARTICLE_GLOW_MESH_ID, materialId: PARTICLE_GLOW_MATERIAL_ID, receiveLighting: false },
	);
	glowEntity.requireComponent(Transform).position = new Vec3(0, 0.006, 0);

	const emitter = new ParticleEmitter({
		rate: PARTICLE_COUNT,
		lifetime: 6,
		speed: 0.016,
		spread: 0.028,
	});
	const particleStates: ParticleState[] = emitter.emit({ x: 0, y: 0, z: 0 }, PARTICLE_COUNT).map((particle) => ({
		...particle,
		color: createParticleColor(),
	}));
	const particleVertices = new Float32Array(PARTICLE_COUNT * PARTICLE_VERTEX_FLOATS);
	for (let index = 0; index < particleStates.length; index += 1) {
		const particle = particleStates[index]!;
		resetParticlePosition(particle, Math.random() * PARTICLE_VERTICAL_SPAN);
		writeParticleVertex(particleVertices, index, particle, 1);
	}
	scene.registerMesh(
		createParticleMeshDefinition(PARTICLE_MESH_ID, particleVertices, PARTICLE_COUNT, GL_DYNAMIC_DRAW),
	);

	const particleEntity = scene.createRenderableEntity(
		{ name: 'ParticleCloud' },
		{ meshId: PARTICLE_MESH_ID, materialId: PARTICLE_FILL_MATERIAL_ID, receiveLighting: false },
	);
	const particleRenderer = particleEntity.getComponent(MeshRenderer);
	if (!particleRenderer) {
		throw new Error('Particle cloud renderer was not created correctly.');
	}

	const dustVertices = createDustVertices();
	scene.registerMesh(
		createParticleMeshDefinition(PARTICLE_DUST_MESH_ID, dustVertices, PARTICLE_DUST_COUNT, GL_DYNAMIC_DRAW),
	);
	const dustEntity = scene.createRenderableEntity(
		{ name: 'ParticleDust' },
		{ meshId: PARTICLE_DUST_MESH_ID, materialId: PARTICLE_DUST_MATERIAL_ID, receiveLighting: false },
	);
	dustEntity.requireComponent(Transform);

	console.log(`Particle nebula: ${PARTICLE_COUNT} particles`);

	let playing = true;
	let frameHandle = 0;
	let previousTime = 0;
	let elapsed = 0;
	const loop = (now: number) => {
		const deltaFrames = previousTime === 0 ? 1 : Math.min((now - previousTime) / 16.6667, 2);
		if (playing) {
			elapsed += deltaFrames / 60;
			for (let index = 0; index < particleStates.length; index += 1) {
				const particle = particleStates[index]!;
				const swirl = Math.sin(elapsed * 0.7 + index * 0.013) * 0.0022 * deltaFrames;
				particle.position.x += particle.velocity.x * deltaFrames + swirl;
				particle.position.y += particle.velocity.y * deltaFrames;
				particle.position.z += particle.velocity.z * deltaFrames + Math.cos(elapsed * 0.55 + index * 0.017) * 0.0018 * deltaFrames;
				particle.life -= (deltaFrames / 60) * 0.62;
				if (particle.position.y > PARTICLE_CEILING || particle.life <= 0) {
					resetParticlePosition(particle, 0);
					particle.life = emitter.lifetime;
				}
				const lifeRatio = Math.max(0, Math.min(1, particle.life / emitter.lifetime));
				const fadeIn = Math.min(1, (emitter.lifetime - particle.life) * 3.2);
				const fadeOut = Math.min(1, lifeRatio * 2.4);
				writeParticleVertex(particleVertices, index, particle, Math.min(fadeIn, fadeOut));
			}
			scene.registerMesh(
				createParticleMeshDefinition(PARTICLE_MESH_ID, particleVertices, PARTICLE_COUNT, GL_DYNAMIC_DRAW),
			);
			dustEntity.requireComponent(Transform).rotation = Quat.fromEuler(0, elapsed * 0.015, 0);
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
			particleRenderer.materialId = enabled ? PARTICLE_WIRE_MATERIAL_ID : PARTICLE_FILL_MATERIAL_ID;
		},
		stats: () => ({
			objectCount: PARTICLE_COUNT + PARTICLE_DUST_COUNT + 1,
			summary: `${PARTICLE_COUNT} embers · ${PARTICLE_DUST_COUNT} dust`,
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
