import { createRing, createSphere, createTorusKnot } from '@axrone/geometry';
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
	DEMO_AMBIENT,
	DEMO_CLEAR_COLOR,
	DEMO_COLORS,
	DEMO_FILL_LIGHT_COLOR,
	DEMO_FILL_LIGHT_DIRECTION,
	DEMO_KEY_LIGHT_COLOR,
	DEMO_KEY_LIGHT_DIRECTION,
} from './palette';

export const createDemoScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: DEMO_CLEAR_COLOR,
		ambientLight: [0.08, 0.08, 0.1],
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/demo');
	const meshBuilder = createMeshBuilder();

	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/demo/torus',
			createTorusKnot({
				radius: 1.08,
				tube: 0.28,
				radialSegments: 30,
				tubularSegments: 192,
			})
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/demo/orb',
			createSphere({ radius: 0.7, widthSegments: 28, heightSegments: 20 })
		),
	);
	scene.registerMesh(
		meshBuilder.createDefinition(
			'playground/demo/ring',
			createRing({ innerRadius: 1.38, outerRadius: 1.88, segments: 84 })
		),
	);

	const lightingUniforms = {
		u_AmbientColor: DEMO_AMBIENT,
		u_KeyLightDirection: DEMO_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: DEMO_KEY_LIGHT_COLOR,
		u_FillLightDirection: DEMO_FILL_LIGHT_DIRECTION,
		u_FillLightColor: DEMO_FILL_LIGHT_COLOR,
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

	registerLitMaterial('playground/demo/torus-fill', DEMO_COLORS.torus, 22, 'fill');
	registerLitMaterial('playground/demo/torus-wire', DEMO_COLORS.line, 10, 'line');
	registerLitMaterial('playground/demo/orb-fill', DEMO_COLORS.orb, 42, 'fill');
	registerLitMaterial('playground/demo/orb-wire', DEMO_COLORS.line, 10, 'line');
	registerLitMaterial('playground/demo/ring-fill', DEMO_COLORS.ring, 18, 'fill');
	registerLitMaterial('playground/demo/ring-wire', DEMO_COLORS.line, 10, 'line');

	const camera = scene.createCameraActor({ name: 'DemoCamera' }, { primary: true, fieldOfView: 54 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 0.35, 0],
		distance: 7.8,
		minDistance: 4.2,
		maxDistance: 14,
		azimuth: 0.72,
		elevation: 0.34,
	});
	const detachInput = attachOrbitCameraInput(container, orbit);

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/demo',
		size: 24,
		scale: 0.8,
		color: DEMO_COLORS.line.slice(0, 3),
		gridColor: DEMO_COLORS.grid,
		backgroundColor: DEMO_COLORS.background,
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/demo', length: 2.8 });

	const torusActor = scene.createRenderableActor(
		{ name: 'DemoTorus' },
		{ meshId: 'playground/demo/torus', materialId: 'playground/demo/torus-fill' },
	);
	const orbActor = scene.createRenderableActor(
		{ name: 'DemoOrb' },
		{ meshId: 'playground/demo/orb', materialId: 'playground/demo/orb-fill' },
	);
	const ringActor = scene.createRenderableActor(
		{ name: 'DemoRing' },
		{ meshId: 'playground/demo/ring', materialId: 'playground/demo/ring-fill' },
	);

	const torusTransform = torusActor.requireComponent(Transform);
	const orbTransform = orbActor.requireComponent(Transform);
	const ringTransform = ringActor.requireComponent(Transform);

	torusTransform.position = new Vec3(0, 1.35, 0);
	orbTransform.position = new Vec3(2.1, 1.15, -0.3);
	ringTransform.position = new Vec3(0, 0.24, 0);
	ringTransform.rotation = Quat.fromEuler(-Math.PI * 0.5, 0, 0);

	const torusRenderer = torusActor.getComponent(MeshRenderer);
	const orbRenderer = orbActor.getComponent(MeshRenderer);
	const ringRenderer = ringActor.getComponent(MeshRenderer);
	if (!torusRenderer || !orbRenderer || !ringRenderer) {
		throw new Error('Demo scene renderers were not created correctly.');
	}

	const materialPairs = [
		{ renderer: torusRenderer, fill: 'playground/demo/torus-fill', wire: 'playground/demo/torus-wire' },
		{ renderer: orbRenderer, fill: 'playground/demo/orb-fill', wire: 'playground/demo/orb-wire' },
		{ renderer: ringRenderer, fill: 'playground/demo/ring-fill', wire: 'playground/demo/ring-wire' },
	] as const;

	let playing = true;
	let frameHandle = 0;
	const loop = (now: number) => {
		if (playing) {
			const time = now * 0.001;
			torusTransform.rotation = Quat.fromEuler(Math.sin(time * 0.7) * 0.3, time * 0.72, Math.cos(time * 0.5) * 0.22);
			orbTransform.position = new Vec3(
				Math.cos(time * 1.1) * 2.25,
				1.05 + Math.sin(time * 2.2) * 0.26,
				Math.sin(time * 0.85) * 1.2,
			);
			orbTransform.rotation = Quat.fromEuler(time * 0.8, time * 1.4, 0);
			ringTransform.rotation = Quat.fromEuler(-Math.PI * 0.5, time * 0.18, 0);
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
			for (const pair of materialPairs) {
				pair.renderer.materialId = enabled ? pair.wire : pair.fill;
			}
		},
		stats: () => ({
			objectCount: 1 + 1 + materialPairs.length + grid.actors.length + axes.actors.length,
			summary: 'Hero composition',
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