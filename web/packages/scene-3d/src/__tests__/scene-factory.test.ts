import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from '../../../../tests/shared/test-harness';

let Scene: typeof import('@axrone/scene-3d').Scene;
let createScene: typeof import('@axrone/scene-3d').createScene;
let Camera: typeof import('@axrone/scene-3d').Camera;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;

describe('createScene', () => {
	let scheduler: ManualScheduler;

	beforeAll(async () => {
		installWebGL2Constants();
		const mod = await import('@axrone/scene-3d');
		Scene = mod.Scene;
		createScene = mod.createScene;
		Camera = mod.Camera;
		MeshRenderer = mod.MeshRenderer;
	});

	beforeEach(() => {
		scheduler = new ManualScheduler();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('returns a Scene instance when called with no arguments', () => {
		const canvas = document.createElement('canvas');
		const scene = createScene(createSceneOptions(scheduler, canvas));

		expect(scene).toBeInstanceOf(Scene);

		scene.dispose();
	});

	it('passes options through to the underlying Scene constructor', () => {
		const canvas = document.createElement('canvas');
		const scene = createScene(createSceneOptions(scheduler, canvas));

		expect(scene.canvas).toBe(canvas);
		expect(scene.canvas.width).toBe(640);
		expect(scene.canvas.height).toBe(360);

		scene.dispose();
	});

	it('exposes working 3d entity creation methods', () => {
		const canvas = document.createElement('canvas');
		const scene = createScene(createSceneOptions(scheduler, canvas));

		const cameraEntity = scene.createCameraEntity({ name: 'Cam' }, { primary: true });
		const renderableEntity = scene.createRenderableEntity(
			{ name: 'Mesh' },
			{ meshId: 'm', materialId: 'mat' }
		);

		expect(cameraEntity.getComponent(Camera)?.primary).toBe(true);
		expect(renderableEntity.getComponent(MeshRenderer)?.meshId).toBe('m');

		scene.dispose();
	});

	it('disposes cleanly without errors', () => {
		const canvas = document.createElement('canvas');
		const scene = createScene(createSceneOptions(scheduler, canvas));

		expect(() => scene.dispose()).not.toThrow();
	});
});
