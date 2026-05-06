import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer, OrbitCameraController } from '@axrone/scene-3d';
import {
	attachOrbitCameraInput,
	createAxesOverlay,
	createGridOverlay,
	createPlaygroundHandle,
	createSceneStage,
	registerPlaygroundShaders,
} from '@axrone/playground';
import { Quat, Vec3 } from '@axrone/numeric';
import type { PlaygroundSceneHandle } from '../shared/playground-types';
import {
	TERRAIN_AMBIENT,
	TERRAIN_CLEAR_COLOR,
	TERRAIN_COLUMNS,
	TERRAIN_FILL_LIGHT_COLOR,
	TERRAIN_FILL_LIGHT_DIRECTION,
	TERRAIN_KEY_LIGHT_COLOR,
	TERRAIN_KEY_LIGHT_DIRECTION,
} from './height-map';

type TerrainMaterialBand = 'low' | 'mid' | 'high';
type TerrainRuntime = {
	readonly renderer: MeshRenderer;
	readonly fillMaterialId: string;
	readonly wireMaterialId: string;
};

const TERRAIN_COLORS: Record<TerrainMaterialBand, readonly [number, number, number, number]> = {
	low: [0.76, 0.58, 0.33, 1],
	mid: [0.6, 0.68, 0.35, 1],
	high: [0.38, 0.48, 0.32, 1],
};

export const createTerrainScene = (container: HTMLElement): PlaygroundSceneHandle => {
	const stage = createSceneStage(container, {
		clearColor: TERRAIN_CLEAR_COLOR,
		ambientLight: [0.06, 0.06, 0.06],
	});
	const { scene } = stage;
	const shaders = registerPlaygroundShaders(scene, 'playground/terrain');

	const lightingUniforms = {
		u_AmbientColor: TERRAIN_AMBIENT,
		u_KeyLightDirection: TERRAIN_KEY_LIGHT_DIRECTION,
		u_KeyLightColor: TERRAIN_KEY_LIGHT_COLOR,
		u_FillLightDirection: TERRAIN_FILL_LIGHT_DIRECTION,
		u_FillLightColor: TERRAIN_FILL_LIGHT_COLOR,
	} as const;

	const registerLitMaterial = (
		id: string,
		color: readonly [number, number, number, number],
		polygonMode: 'fill' | 'line',
	) => {
		scene.createMaterial({
			id,
			shaderId: shaders.lit,
			uniforms: {
				u_Color: color,
				u_Shininess: 18,
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

	for (const band of ['low', 'mid', 'high'] as const) {
		registerLitMaterial(`playground/terrain/${band}-fill`, TERRAIN_COLORS[band], 'fill');
		registerLitMaterial(`playground/terrain/${band}-wire`, [0.16, 0.16, 0.16, 1], 'line');
	}

	registerSolidMaterial('playground/terrain/water-fill', [0.36, 0.58, 0.84, 0.95], 'fill');
	registerSolidMaterial('playground/terrain/water-wire', [0.14, 0.22, 0.31, 1], 'line');
	registerSolidMaterial('playground/terrain/scout-fill', [0.96, 0.66, 0.19, 1], 'fill');
	registerSolidMaterial('playground/terrain/scout-wire', [0.18, 0.14, 0.08, 1], 'line');

	scene.createBoxMesh('playground/terrain/column', 0.82, 1, 0.82);
	scene.createPlaneMesh('playground/terrain/water', 11.5, 11.5);
	scene.createSphereMesh('playground/terrain/scout', 0.34, 18, 14);

	const camera = scene.createCameraActor({ name: 'TerrainCamera' }, { primary: true, fieldOfView: 48 });
	const orbit = camera.addComponent(OrbitCameraController, {
		target: [0, 1.2, 0],
		distance: 11.5,
		minDistance: 6,
		maxDistance: 20,
		azimuth: 0.7,
		elevation: 0.44,
	});
	const detachInput = attachOrbitCameraInput(container, orbit);

	const grid = createGridOverlay(scene, shaders.grid, {
		prefix: 'playground/terrain',
		size: 24,
		scale: 1,
		color: [0.32, 0.28, 0.22],
		gridColor: [0.89, 0.86, 0.8],
		backgroundColor: [0.95, 0.94, 0.91],
	});
	const axes = createAxesOverlay(scene, shaders.solid, { prefix: 'playground/terrain', length: 3 });

	const terrainActors: TerrainRuntime[] = [];
	for (const column of TERRAIN_COLUMNS) {
		const actor = scene.createRenderableActor(
			{ name: column.id },
			{
				meshId: 'playground/terrain/column',
				materialId: `playground/terrain/${column.band}-fill`,
			},
		);
		const transform = actor.requireComponent(Transform);
		transform.position = new Vec3(column.x, column.height * 0.5, column.z);
		transform.scale = new Vec3(1, column.height, 1);
		const renderer = actor.getComponent(MeshRenderer);
		if (!renderer) {
			throw new Error(`Terrain renderer setup failed for ${column.id}.`);
		}

		terrainActors.push({
			renderer,
			fillMaterialId: `playground/terrain/${column.band}-fill`,
			wireMaterialId: `playground/terrain/${column.band}-wire`,
		});
	}

	const water = scene.createRenderableActor(
		{ name: 'TerrainWater' },
		{ meshId: 'playground/terrain/water', materialId: 'playground/terrain/water-fill', receiveLighting: false },
	);
	const waterTransform = water.requireComponent(Transform);
	waterTransform.position = new Vec3(0, 0.36, 0);
	waterTransform.rotation = Quat.fromEuler(-Math.PI * 0.5, 0, 0);
	const waterRenderer = water.getComponent(MeshRenderer);
	if (!waterRenderer) {
		throw new Error('Terrain water renderer was not created correctly.');
	}

	const scout = scene.createRenderableActor(
		{ name: 'TerrainScout' },
		{ meshId: 'playground/terrain/scout', materialId: 'playground/terrain/scout-fill', receiveLighting: false },
	);
	const scoutTransform = scout.requireComponent(Transform);
	scoutTransform.position = new Vec3(0, 2.6, 0);
	const scoutRenderer = scout.getComponent(MeshRenderer);
	if (!scoutRenderer) {
		throw new Error('Terrain scout renderer was not created correctly.');
	}

	let playing = true;
	let frameHandle = 0;
	const loop = (now: number) => {
		const time = now * 0.001;
		if (playing) {
			waterTransform.position = new Vec3(0, 0.34 + Math.sin(time * 1.4) * 0.04, 0);
			scoutTransform.position = new Vec3(Math.cos(time * 0.38) * 3.8, 2.5 + Math.sin(time * 1.7) * 0.22, Math.sin(time * 0.38) * 3.2);
			scoutTransform.rotation = Quat.fromEuler(0, -time * 1.1, 0);
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
			for (const actor of terrainActors) {
				actor.renderer.materialId = enabled ? actor.wireMaterialId : actor.fillMaterialId;
			}
			waterRenderer.materialId = enabled ? 'playground/terrain/water-wire' : 'playground/terrain/water-fill';
			scoutRenderer.materialId = enabled ? 'playground/terrain/scout-wire' : 'playground/terrain/scout-fill';
		},
		stats: () => ({
			objectCount: terrainActors.length + 2 + grid.actors.length + axes.actors.length,
			summary: 'Generated ridge field',
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