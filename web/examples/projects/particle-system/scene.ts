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
import type { PlaygroundSceneHandle } from '../shared/playground-types';
import {
	PARTICLE_CEILING,
	PARTICLE_CLEAR_COLOR,
	PARTICLE_COUNT,
	PARTICLE_GRID_MAJOR,
	PARTICLE_GRID_MINOR,
	PARTICLE_HORIZONTAL_SPAN,
	PARTICLE_POINT_SIZE,
	PARTICLE_VERTICAL_SPAN,
	ParticleEmitter,
	createParticleColor,
	type EmittedParticle,
} from './particle-data';

type ParticleState = EmittedParticle & {
	readonly color: readonly [number, number, number, number];
};

const PARTICLE_MESH_ID = 'playground/particles/cloud';
const PARTICLE_SHADER_ID = 'playground/particles/points';
const PARTICLE_FILL_MATERIAL_ID = 'playground/particles/fill';
const PARTICLE_WIRE_MATERIAL_ID = 'playground/particles/wire';
const PARTICLE_VERTEX_FLOATS = 7;
const PARTICLE_VERTEX_STRIDE = PARTICLE_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const GL_DYNAMIC_DRAW = 0x88e8;

const writeParticleVertex = (vertices: Float32Array, index: number, particle: ParticleState): void => {
	const base = index * PARTICLE_VERTEX_FLOATS;
	vertices[base] = particle.position.x;
	vertices[base + 1] = particle.position.y;
	vertices[base + 2] = particle.position.z;
	vertices[base + 3] = particle.color[0];
	vertices[base + 4] = particle.color[1];
	vertices[base + 5] = particle.color[2];
	vertices[base + 6] = particle.color[3];
};

const createParticleMeshDefinition = (vertices: Float32Array): SceneMeshDefinition => ({
	id: PARTICLE_MESH_ID,
	vertices,
	vertexCount: PARTICLE_COUNT,
	topology: 'points',
	usage: GL_DYNAMIC_DRAW,
	attributes: [
		{ semantic: 'position', componentCount: 3, offset: 0, stride: PARTICLE_VERTEX_STRIDE },
		{ semantic: 'color0', componentCount: 4, offset: Float32Array.BYTES_PER_ELEMENT * 3, stride: PARTICLE_VERTEX_STRIDE },
	],
});

const randomHorizontal = (): number => (Math.random() - 0.5) * PARTICLE_HORIZONTAL_SPAN;

const resetParticlePosition = (particle: ParticleState, y: number): void => {
	particle.position.x = randomHorizontal();
	particle.position.y = y;
	particle.position.z = randomHorizontal();
};

export const createParticleSystemScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: PARTICLE_CLEAR_COLOR,
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
	gl_PointSize = max(1.0, u_PointSize * u_Resolution.y * u_Projection[1][1] / distanceToCamera);
	v_Color = a_Color0;
	gl_Position = u_Projection * viewPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform float u_Opacity;
in vec4 v_Color;
out vec4 o_Color;
void main() {
	o_Color = vec4(v_Color.rgb, v_Color.a * u_Opacity);
}`,
		uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Resolution', 'u_PointSize', 'u_Opacity'],
		depthTest: true,
		cull: false,
		blend: true,
	});

	const particlePass = {
		id: 'particle-points',
		primitive: 'point-list',
		depthStencilState: {
			depthTest: true,
			depthWrite: false,
		},
		blendState: {
			targets: [
				{
					blend: true,
					srcColorFactor: 'src-alpha',
					dstColorFactor: 'one-minus-src-alpha',
					srcAlphaFactor: 'one',
					dstAlphaFactor: 'one-minus-src-alpha',
				},
			],
		},
	} as const;

	scene.createMaterial({
		id: PARTICLE_FILL_MATERIAL_ID,
		shaderId: PARTICLE_SHADER_ID,
		uniforms: {
			u_PointSize: PARTICLE_POINT_SIZE,
			u_Opacity: 0.85,
		},
		passes: [particlePass],
	});

	scene.createMaterial({
		id: PARTICLE_WIRE_MATERIAL_ID,
		shaderId: PARTICLE_SHADER_ID,
		uniforms: {
			u_PointSize: PARTICLE_POINT_SIZE * 1.05,
			u_Opacity: 0.65,
		},
		passes: [particlePass],
	});

	const camera = scene.createCameraActor({ name: 'ParticleCamera' }, { primary: true, fieldOfView: 60 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0, 0],
		distance: 10.7703296143,
		minDistance: 4,
		maxDistance: 20,
		azimuth: 0,
		elevation: 0.3805063771,
	});
	const detachInput = attachOrbitCameraInput(container, orbit, {
		minElevation: 0.04,
		maxElevation: 1.35,
	});

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/particles',
		size: 20,
		scale: 1,
		y: 0,
		color: PARTICLE_GRID_MAJOR,
		gridColor: PARTICLE_GRID_MINOR,
		backgroundColor: PARTICLE_CLEAR_COLOR.slice(0, 3),
		backgroundOpacity: 0,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/particles', length: 5 });
	axes.setVisible(false);

	const emitter = new ParticleEmitter({
		rate: PARTICLE_COUNT,
		lifetime: 6,
		speed: 0.02,
		spread: 0.04,
	});
	const particleStates: ParticleState[] = emitter.emit({ x: 0, y: 0, z: 0 }, PARTICLE_COUNT).map((particle) => ({
		...particle,
		color: createParticleColor(),
	}));
	const particleVertices = new Float32Array(PARTICLE_COUNT * PARTICLE_VERTEX_FLOATS);
	for (let index = 0; index < particleStates.length; index += 1) {
		const particle = particleStates[index]!;
		resetParticlePosition(particle, Math.random() * PARTICLE_VERTICAL_SPAN);
		writeParticleVertex(particleVertices, index, particle);
	}
	scene.registerMesh(createParticleMeshDefinition(particleVertices));

	const particleActor = scene.createRenderableActor(
		{ name: 'ParticleCloud' },
		{ meshId: PARTICLE_MESH_ID, materialId: PARTICLE_FILL_MATERIAL_ID, receiveLighting: false },
	);
	const particleRenderer = particleActor.getComponent(MeshRenderer);
	if (!particleRenderer) {
		throw new Error('Particle cloud renderer was not created correctly.');
	}

	console.log(`Particles: ${PARTICLE_COUNT} active`);

	let playing = true;
	let frameHandle = 0;
	let previousTime = 0;
	const loop = (now: number) => {
		if (playing) {
			const deltaFrames = previousTime === 0 ? 1 : Math.min((now - previousTime) / 16.6667, 2);
			for (let index = 0; index < particleStates.length; index += 1) {
				const particle = particleStates[index]!;
				particle.position.x += particle.velocity.x * deltaFrames;
				particle.position.y += particle.velocity.y * deltaFrames;
				particle.position.z += particle.velocity.z * deltaFrames;
				particle.life -= (deltaFrames / 60) * 0.75;
				if (particle.position.y > PARTICLE_CEILING || particle.life <= 0) {
					resetParticlePosition(particle, 0);
					particle.life = emitter.lifetime;
				}
				writeParticleVertex(particleVertices, index, particle);
			}
			scene.registerMesh(createParticleMeshDefinition(particleVertices));
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
			objectCount: PARTICLE_COUNT,
			summary: `${PARTICLE_COUNT} active particles`,
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