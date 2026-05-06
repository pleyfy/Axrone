import { Transform } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import {
	MeshRenderer,
	OrbitCameraController,
	Scene,
	SceneGeometryMeshBuilder,
	createUnlitColorShaderDefinition,
} from '@axrone/scene-3d';
import type { Actor } from '@axrone/ecs-runtime';
import type { PlaygroundCameraPreset, PlaygroundSceneHandle, PlaygroundStats } from '../projects/shared/playground-types';

export type SceneStage = {
	readonly scene: Scene;
	dispose(): void;
};

export type ToggleableOverlay = {
	setVisible(visible: boolean): void;
	readonly actors: readonly Actor[];
};

export type HandleOptions = {
	readonly container: HTMLElement;
	readonly scene: Scene;
	readonly disposeScene?: boolean;
	readonly orbit?: OrbitCameraController;
	readonly overlays?: {
		readonly grid?: ToggleableOverlay;
		readonly axes?: ToggleableOverlay;
	};
	readonly disposeExtras?: readonly (() => void)[];
	readonly setWireframe?: (enabled: boolean) => void;
	readonly stats?: () => PlaygroundStats;
};

export const bindSceneToContainer = (
	scene: Scene,
	container: HTMLElement,
	fallbackWidth: number,
	fallbackHeight: number,
): (() => void) => {
	const resize = () => {
		const rect = container.getBoundingClientRect();
		const width = Math.max(1, Math.floor(rect.width || fallbackWidth));
		const height = Math.max(1, Math.floor(rect.height || fallbackHeight));
		scene.resize(width, height);
	};

	resize();

	if (typeof ResizeObserver !== 'undefined') {
		const observer = new ResizeObserver(() => resize());
		observer.observe(container);
		return () => observer.disconnect();
	}

	const handleResize = () => resize();
	globalThis.addEventListener('resize', handleResize);
	return () => globalThis.removeEventListener('resize', handleResize);
};

export const createSceneStage = (
	container: HTMLElement,
	options: {
		readonly width?: number;
		readonly height?: number;
		readonly clearColor?: readonly [number, number, number, number];
		readonly ambientLight?: readonly [number, number, number];
	},
): SceneStage => {
	container.replaceChildren();
	const width = container.clientWidth || options.width || 960;
	const height = container.clientHeight || options.height || 540;
	const scene = new Scene({
		width,
		height,
		autoStart: true,
		parent: container,
		appendToDom: true,
		createCanvas: () => document.createElement('canvas'),
		clearColor: options.clearColor,
		ambientLight: options.ambientLight,
	});
	const cleanupResize = bindSceneToContainer(scene, container, width, height);

	return {
		scene,
		dispose() {
			cleanupResize();
			scene.dispose();
			container.replaceChildren();
		},
	};
};

export const attachOrbitCameraInput = (
	host: HTMLElement,
	orbit: OrbitCameraController,
	options?: {
		readonly minElevation?: number;
		readonly maxElevation?: number;
	},
): (() => void) => {
	let orbiting = false;
	let pointerId = -1;
	let previousX = 0;
	let previousY = 0;

	const clampElevation = () => {
		if (options?.minElevation !== undefined && orbit.elevation < options.minElevation) {
			orbit.elevation = options.minElevation;
		}
		if (options?.maxElevation !== undefined && orbit.elevation > options.maxElevation) {
			orbit.elevation = options.maxElevation;
		}
	};

	clampElevation();

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0) {
			return;
		}

		orbiting = true;
		pointerId = event.pointerId;
		previousX = event.clientX;
		previousY = event.clientY;
		host.setPointerCapture?.(event.pointerId);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!orbiting || event.pointerId !== pointerId) {
			return;
		}

		const deltaX = event.clientX - previousX;
		const deltaY = event.clientY - previousY;
		previousX = event.clientX;
		previousY = event.clientY;
		orbit.orbit(-deltaX * 0.0125, -deltaY * 0.0095);
		clampElevation();
	};

	const endOrbit = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) {
			return;
		}

		orbiting = false;
		pointerId = -1;
		host.releasePointerCapture?.(event.pointerId);
	};

	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		orbit.zoom(event.deltaY * 0.009);
	};

	host.addEventListener('pointerdown', onPointerDown);
	host.addEventListener('pointermove', onPointerMove);
	host.addEventListener('pointerup', endOrbit);
	host.addEventListener('pointercancel', endOrbit);
	host.addEventListener('wheel', onWheel, { passive: false });

	return () => {
		host.removeEventListener('pointerdown', onPointerDown);
		host.removeEventListener('pointermove', onPointerMove);
		host.removeEventListener('pointerup', endOrbit);
		host.removeEventListener('pointercancel', endOrbit);
		host.removeEventListener('wheel', onWheel);
	};
};

export const createMeshBuilder = (): SceneGeometryMeshBuilder => new SceneGeometryMeshBuilder();

export const registerPlaygroundShaders = (
	scene: Scene,
	prefix = 'axrone/playground',
): {
	readonly solid: string;
	readonly lit: string;
	readonly vertexColorLit: string;
	readonly grid: string;
} => {
	const solid = `${prefix}/solid`;
	const lit = `${prefix}/lit`;
	const vertexColorLit = `${prefix}/vertex-color-lit`;
	const grid = `${prefix}/grid`;

	scene.registerShader(createUnlitColorShaderDefinition(solid));
	scene.registerShader({
		id: lit,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_Normal;
out vec3 v_WorldPosition;
void main() {
    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
    v_WorldPosition = worldPosition.xyz;
    v_Normal = mat3(u_Model) * a_Normal;
    gl_Position = u_Projection * u_View * worldPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
uniform vec3 u_AmbientColor;
uniform vec3 u_KeyLightDirection;
uniform vec3 u_KeyLightColor;
uniform vec3 u_FillLightDirection;
uniform vec3 u_FillLightColor;
uniform float u_Shininess;
in vec3 v_Normal;
in vec3 v_WorldPosition;
out vec4 o_Color;
void main() {
    vec3 normal = normalize(v_Normal);
    vec3 viewDirection = normalize(-v_WorldPosition);
    vec3 keyDirection = normalize(-u_KeyLightDirection);
    vec3 fillDirection = normalize(-u_FillLightDirection);
    float keyDiffuse = max(dot(normal, keyDirection), 0.0);
    float fillDiffuse = max(dot(normal, fillDirection), 0.0);
    vec3 halfVector = normalize(keyDirection + viewDirection);
    float specular = pow(max(dot(normal, halfVector), 0.0), max(1.0, u_Shininess));
    vec3 lighting = u_AmbientColor + u_KeyLightColor * keyDiffuse + u_FillLightColor * fillDiffuse + vec3(specular * 0.18);
    o_Color = vec4(u_Color.rgb * lighting, u_Color.a);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_Color',
			'u_AmbientColor',
			'u_KeyLightDirection',
			'u_KeyLightColor',
			'u_FillLightDirection',
			'u_FillLightColor',
			'u_Shininess',
		],
	});

	scene.registerShader({
		id: vertexColorLit,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 3) in vec4 a_Color0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_Normal;
out vec4 v_Color;
out vec3 v_WorldPosition;
void main() {
    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
    v_WorldPosition = worldPosition.xyz;
    v_Normal = mat3(u_Model) * a_Normal;
    v_Color = a_Color0;
    gl_Position = u_Projection * u_View * worldPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec3 u_AmbientColor;
uniform vec3 u_KeyLightDirection;
uniform vec3 u_KeyLightColor;
uniform vec3 u_FillLightDirection;
uniform vec3 u_FillLightColor;
in vec3 v_Normal;
in vec4 v_Color;
in vec3 v_WorldPosition;
out vec4 o_Color;
void main() {
    vec3 normal = normalize(v_Normal);
    float keyDiffuse = max(dot(normal, normalize(-u_KeyLightDirection)), 0.0);
    float fillDiffuse = max(dot(normal, normalize(-u_FillLightDirection)), 0.0);
    vec3 lighting = u_AmbientColor + u_KeyLightColor * keyDiffuse + u_FillLightColor * fillDiffuse;
    o_Color = vec4(v_Color.rgb * lighting, v_Color.a);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_AmbientColor',
			'u_KeyLightDirection',
			'u_KeyLightColor',
			'u_FillLightDirection',
			'u_FillLightColor',
		],
	});

	scene.registerShader({
		id: grid,
		vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec3 v_WorldPosition;
void main() {
    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
    v_WorldPosition = worldPosition.xyz;
    gl_Position = u_Projection * u_View * worldPosition;
}`,
		fragmentSource: `#version 300 es
precision highp float;
uniform vec3 u_Color;
uniform vec3 u_GridColor;
uniform vec3 u_BackgroundColor;
uniform float u_GridScale;
uniform float u_BackgroundOpacity;
in vec3 v_WorldPosition;
out vec4 o_Color;
float gridLine(vec2 coord, float scale) {
    vec2 grid = abs(fract(coord / scale - 0.5) - 0.5) / fwidth(coord / scale);
    return 1.0 - min(min(grid.x, grid.y), 1.0);
}
void main() {
    float primary = gridLine(v_WorldPosition.xz, u_GridScale);
    float secondary = gridLine(v_WorldPosition.xz, u_GridScale * 5.0);
    float gridMix = primary * 0.65 + secondary * 0.35;
    if (u_BackgroundOpacity <= 0.001 && gridMix <= 0.001) {
        discard;
    }
    vec3 color = mix(u_BackgroundColor, u_GridColor, gridMix * max(u_BackgroundOpacity, 1.0));
    o_Color = vec4(mix(color, u_Color, secondary), 1.0);
}`,
		uniforms: [
			'u_Model',
			'u_View',
			'u_Projection',
			'u_Color',
			'u_GridColor',
			'u_BackgroundColor',
			'u_GridScale',
			'u_BackgroundOpacity',
		],
	});

	return { solid, lit, vertexColorLit, grid };
};

export const createGridOverlay = (
	scene: Scene,
	shaderId: string,
	options: {
		readonly prefix: string;
		readonly size: number;
		readonly y?: number;
		readonly scale?: number;
		readonly color?: readonly [number, number, number];
		readonly gridColor?: readonly [number, number, number];
		readonly backgroundColor?: readonly [number, number, number];
		readonly backgroundOpacity?: number;
	},
): ToggleableOverlay => {
	const meshId = `${options.prefix}/grid-mesh`;
	const materialId = `${options.prefix}/grid-material`;
	scene.createPlaneMesh(meshId, options.size, options.size);
	scene.createMaterial({
		id: materialId,
		shaderId,
		uniforms: {
			u_Color: options.color ?? [0.81, 0.8, 0.77],
			u_GridColor: options.gridColor ?? [0.89, 0.88, 0.84],
			u_BackgroundColor: options.backgroundColor ?? [0.94, 0.93, 0.91],
			u_GridScale: options.scale ?? 1,
			u_BackgroundOpacity: options.backgroundOpacity ?? 1,
		},
	});
	const actor = scene.createRenderableActor(
		{ name: `${options.prefix}-grid` },
		{ meshId, materialId, receiveLighting: false },
	);
	const transform = actor.requireComponent(Transform);
	transform.position = new Vec3(0, options.y ?? 0.01, 0);

	return {
		actors: [actor],
		setVisible(visible: boolean) {
			actor.active = visible;
		},
	};
};

export const createAxesOverlay = (
	scene: Scene,
	shaderId: string,
	options: {
		readonly prefix: string;
		readonly length: number;
		readonly thickness?: number;
	},
): ToggleableOverlay => {
	const thickness = options.thickness ?? Math.max(0.04, options.length * 0.015);
	const xMeshId = `${options.prefix}/axis-x-mesh`;
	const yMeshId = `${options.prefix}/axis-y-mesh`;
	const zMeshId = `${options.prefix}/axis-z-mesh`;
	scene.createBoxMesh(xMeshId, options.length, thickness, thickness);
	scene.createBoxMesh(yMeshId, thickness, options.length, thickness);
	scene.createBoxMesh(zMeshId, thickness, thickness, options.length);

	const axisConfigs = [
		{ axis: 'x', meshId: xMeshId, color: [0.86, 0.23, 0.18], position: new Vec3(options.length * 0.5, 0, 0) },
		{ axis: 'y', meshId: yMeshId, color: [0.17, 0.62, 0.32], position: new Vec3(0, options.length * 0.5, 0) },
		{ axis: 'z', meshId: zMeshId, color: [0.16, 0.39, 0.89], position: new Vec3(0, 0, options.length * 0.5) },
	] as const;

	const actors = axisConfigs.map((config) => {
		const materialId = `${options.prefix}/${config.axis}-material`;
		scene.createMaterial({
			id: materialId,
			shaderId,
			uniforms: { u_Color: [...config.color, 1] },
		});
		const actor = scene.createRenderableActor(
			{ name: `${options.prefix}-${config.axis}` },
			{ meshId: config.meshId, materialId, receiveLighting: false },
		);
		actor.requireComponent(Transform).position = config.position;
		actor.active = false;
		return actor;
	});

	return {
		actors,
		setVisible(visible: boolean) {
			for (const actor of actors) {
				actor.active = visible;
			}
		},
	};
};

export const applyCameraPreset = (
	orbit: OrbitCameraController,
	preset: PlaygroundCameraPreset,
): void => {
	switch (preset) {
		case 'front':
			orbit.azimuth = 0;
			orbit.elevation = 0;
			break;
		case 'top':
			orbit.azimuth = 0;
			orbit.elevation = 1.45;
			break;
		case 'right':
			orbit.azimuth = Math.PI * 0.5;
			orbit.elevation = 0;
			break;
		default:
			orbit.azimuth = 0.68;
			orbit.elevation = 0.34;
			break;
	}
};

export const createPlaygroundHandle = ({
	container,
	scene,
	disposeScene = true,
	orbit,
	overlays,
	disposeExtras = [],
	setWireframe,
	stats,
}: HandleOptions): PlaygroundSceneHandle => ({
	async dispose() {
		for (const cleanup of disposeExtras) {
			cleanup();
		}
		if (disposeScene) {
			scene.dispose();
		}
		container.replaceChildren();
	},
	setPlaying(playing: boolean) {
		if (playing) {
			scene.resume();
			return;
		}

		scene.pause();
	},
	setWireframe(enabled: boolean) {
		setWireframe?.(enabled);
	},
	setGridVisible(visible: boolean) {
		overlays?.grid?.setVisible(visible);
	},
	setAxesVisible(visible: boolean) {
		overlays?.axes?.setVisible(visible);
	},
	setCameraPreset(preset: PlaygroundCameraPreset) {
		if (orbit) {
			applyCameraPreset(orbit, preset);
		}
	},
	getStats() {
		return stats?.() ?? { objectCount: 0 };
	},
});

export const resolveRenderers = (actors: readonly Actor[]): readonly MeshRenderer[] =>
	actors
		.map((actor) => actor.getComponent(MeshRenderer))
		.filter((renderer): renderer is MeshRenderer => renderer !== undefined && renderer !== null);