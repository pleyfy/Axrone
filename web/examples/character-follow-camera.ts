import { AssetDatabase, type AssetImporter } from '@axrone/asset-core';
import {
    createGltfImporter,
    type GltfAssetSchemaLike,
} from '@axrone/asset-gltf';
import { Component, Transform, script } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import {
    Animator,
    createUnlitColorShaderDefinition,
    DirectionalLight,
    FilterMode,
    FollowCameraController,
    MeshRenderer,
    Scene,
    WrapMode,
} from '@axrone/scene-3d';
import {
    loadGltfSceneIntoScene,
    type LoadGltfSceneIntoSceneResult,
} from '@axrone/scene-runtime-gltf';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

const CHARACTER_MODEL_URL = '/models/GM_AssetStore_3D_Character.glb';
const DESK_MODEL_URL = '/models/GM_AssetStore_3D_CityDesk.glb';
const COLOR_PALETTE_URL = '/color_palette/color-palette.jpg';
const CHARACTER_PALETTE_SAMPLER_ID = 'character-demo.palette-sampler';
const CHARACTER_PALETTE_TEXTURE_ID = 'character-demo.palette-texture';
const CHARACTER_PALETTE_MATERIAL_ID = 'character-demo.character-palette-material';
const CHARACTER_REFERENCE_SHADER_ID = 'examples/character-reference';
const CHARACTER_REFERENCE_MATERIAL_ID = 'character-demo.reference-material';
const CHARACTER_REFERENCE_BAR_X_MESH_ID = 'character-demo.reference-bar-x';
const CHARACTER_REFERENCE_BAR_Z_MESH_ID = 'character-demo.reference-bar-z';
const CHARACTER_TRAIL_MATERIAL_ID = 'character-demo.trail-material';
const CHARACTER_TRAIL_MESH_ID = 'character-demo.trail-mesh';
const CHARACTER_TRAIL_POINT_COUNT = 14;
const CHARACTER_TELEMETRY_SYSTEM_ID = 'character-follow-camera.telemetry';

type SceneActor = ReturnType<Scene['createActor']>;

interface SceneBounds {
    readonly min: Vec3;
    readonly max: Vec3;
    readonly center: Vec3;
    readonly size: Vec3;
}

interface CharacterClipSet {
    readonly ids: readonly string[];
    readonly idle: string | null;
    readonly run: string | null;
    readonly walk: string | null;
}

interface DashboardHandle {
    readonly controlsHost: HTMLElement;
    setStatus(next: string, color?: string): void;
    setAnimationState(next: string): void;
    setClipSummary(next: string): void;
    setMotionTelemetry(position: Readonly<Vec3>, speed: number): void;
    setHierarchyRoot(rootTransform: Transform): void;
    refreshSelection(): void;
    dispose(): void;
}

const computeSmoothingFactor = (damping: number, deltaSeconds: number): number => {
    if (damping <= 0 || deltaSeconds <= 0) {
        return 1;
    }

    return 1 - Math.exp(-damping * deltaSeconds);
};

const normalizeClipName = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');

const formatClipLabel = (clipId: string | null | undefined): string => {
    if (!clipId) {
        return 'Unavailable';
    }

    return normalizeClipName(clipId) === 'iddle' ? 'Idle' : clipId;
};

const formatWorldPositionLabel = (position: Readonly<Vec3>): string =>
    `${position.x.toFixed(2)}, ${position.z.toFixed(2)}`;

const formatSpeedLabel = (speed: number): string => `${speed.toFixed(2)} u/s`;

const formatDebugVec3 = (value: Readonly<Vec3>): string =>
    `${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)}`;

const formatDebugQuat = (value: Readonly<Quat>): string =>
    `${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)}, ${value.w.toFixed(3)}`;

const getActorFromTransform = (transform: Transform | null | undefined): SceneActor | null =>
    ((transform as unknown as { actor?: SceneActor | undefined })?.actor ?? null);

const resolveCharacterClipSet = (animator: Animator | null): CharacterClipSet => {
    const serialized = animator?.serialize() as { clips?: readonly { id?: unknown }[] } | undefined;
    const ids = (serialized?.clips ?? [])
        .map((clip) => (typeof clip.id === 'string' ? clip.id : null))
        .filter((clipId): clipId is string => Boolean(clipId));

    const findClip = (...aliases: readonly string[]): string | null =>
        ids.find((clipId) => aliases.some((alias) => normalizeClipName(clipId).includes(alias))) ??
        null;

    return {
        ids,
        idle: findClip('idle', 'iddle') ?? ids[0] ?? null,
        run: findClip('run'),
        walk: findClip('walk'),
    };
};

const computeActorsBounds = (
    actors: readonly SceneActor[],
    database: AssetDatabase<GltfAssetSchemaLike>
): SceneBounds | null => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let found = false;

    for (const actor of actors) {
        const renderer = actor.getComponent(MeshRenderer);
        const transform = actor.getComponent(Transform);
        if (!renderer?.meshId || !transform) {
            continue;
        }

        const meshAsset = database.get({ key: renderer.meshId, kind: 'gltf.mesh' });
        const meshBounds = meshAsset?.data.bounds;
        if (!meshBounds) {
            continue;
        }

        const corners = [
            new Vec3(meshBounds.min[0], meshBounds.min[1], meshBounds.min[2]),
            new Vec3(meshBounds.min[0], meshBounds.min[1], meshBounds.max[2]),
            new Vec3(meshBounds.min[0], meshBounds.max[1], meshBounds.min[2]),
            new Vec3(meshBounds.min[0], meshBounds.max[1], meshBounds.max[2]),
            new Vec3(meshBounds.max[0], meshBounds.min[1], meshBounds.min[2]),
            new Vec3(meshBounds.max[0], meshBounds.min[1], meshBounds.max[2]),
            new Vec3(meshBounds.max[0], meshBounds.max[1], meshBounds.min[2]),
            new Vec3(meshBounds.max[0], meshBounds.max[1], meshBounds.max[2]),
        ];

        for (const corner of corners) {
            const worldCorner = transform.worldMatrix.transformVec3(corner, new Vec3());
            minX = Math.min(minX, worldCorner.x);
            minY = Math.min(minY, worldCorner.y);
            minZ = Math.min(minZ, worldCorner.z);
            maxX = Math.max(maxX, worldCorner.x);
            maxY = Math.max(maxY, worldCorner.y);
            maxZ = Math.max(maxZ, worldCorner.z);
        }

        found = true;
    }

    if (!found) {
        return null;
    }

    return {
        min: new Vec3(minX, minY, minZ),
        max: new Vec3(maxX, maxY, maxZ),
        center: new Vec3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
        size: new Vec3(maxX - minX, maxY - minY, maxZ - minZ),
    };
};

const collectImportedRootTransforms = (actors: readonly SceneActor[]): readonly Transform[] => {
    const roots: Transform[] = [];

    for (const actor of actors) {
        const transform = actor.getComponent(Transform);
        if (!transform || transform.parent) {
            continue;
        }

        roots.push(transform);
    }

    return roots;
};

const createImportedModelContainer = (
    scene: Scene,
    actors: readonly SceneActor[],
    name: string
): SceneActor => {
    const container = scene.createActor({ name });
    const containerTransform = container.requireComponent(Transform);

    for (const rootTransform of collectImportedRootTransforms(actors)) {
        rootTransform.parent = containerTransform;
    }

    return container;
};

const fitImportedModel = (
    actors: readonly SceneActor[],
    container: SceneActor,
    database: AssetDatabase<GltfAssetSchemaLike>,
    options: {
        readonly targetHeight: number;
        readonly position: Vec3;
        readonly groundY?: number;
        readonly yaw?: number;
    }
): SceneBounds | null => {
    const containerTransform = container.requireComponent(Transform);

    if (typeof options.yaw === 'number') {
        containerTransform.rotation = Quat.fromEuler(0, options.yaw, 0);
    }

    const initialBounds = computeActorsBounds(actors, database);
    if (!initialBounds) {
        containerTransform.position = options.position.clone();
        return null;
    }

    if (initialBounds.size.y > 1e-5) {
        const scale = options.targetHeight / initialBounds.size.y;
        containerTransform.scale = new Vec3(scale, scale, scale);
    }

    const scaledBounds = computeActorsBounds(actors, database);
    if (!scaledBounds) {
        return null;
    }

    const groundY = options.groundY ?? 0;
    containerTransform.position = new Vec3(
        options.position.x - scaledBounds.center.x,
        groundY - scaledBounds.min.y,
        options.position.z - scaledBounds.center.z
    );

    return computeActorsBounds(actors, database);
};

const registerGroundAssets = (scene: Scene): void => {
    scene.registerShader({
        id: 'examples/character-ground',
        cull: false,
        vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_UV0;
out vec3 v_WorldNormal;
void main() {
    v_UV0 = a_UV0;
    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
        fragmentSource: `#version 300 es
precision highp float;
uniform vec3 u_LightDirection;
uniform vec3 u_BaseColor;
uniform vec3 u_LineColor;
uniform vec3 u_FadeColor;
in vec2 v_UV0;
in vec3 v_WorldNormal;
out vec4 o_Color;

void main() {
    vec2 gridUv = v_UV0 * 24.0;
    vec2 cell = abs(fract(gridUv - 0.5) - 0.5) / fwidth(gridUv);
    float major = 1.0 - min(min(cell.x, cell.y), 1.0);
    float radial = clamp(length(v_UV0 - 0.5) * 1.35, 0.0, 1.0);
    float diffuse = max(dot(normalize(v_WorldNormal), normalize(-u_LightDirection)), 0.0);
    vec3 gridColor = mix(u_BaseColor, u_LineColor, major * 0.7);
    vec3 base = mix(gridColor, u_FadeColor, radial * 0.55);
    vec3 lit = base * (0.45 + diffuse * 0.55);
    o_Color = vec4(lit, 1.0);
}`,
        uniforms: [
            'u_Model',
            'u_View',
            'u_Projection',
            'u_LightDirection',
            'u_BaseColor',
            'u_LineColor',
            'u_FadeColor',
        ],
    });

    scene.createPlaneMesh('character-demo-ground', 64, 64);
    scene.createMaterial({
        id: 'character-demo-ground-material',
        shaderId: 'examples/character-ground',
        uniforms: {
            u_LightDirection: [-0.45, -0.85, -0.25],
            u_BaseColor: [0.14, 0.16, 0.19],
            u_LineColor: [0.83, 0.62, 0.34],
            u_FadeColor: [0.08, 0.1, 0.13],
        },
    });
};

const createGround = (scene: Scene): void => {
    registerGroundAssets(scene);

    const ground = scene.createRenderableActor(
        { name: 'Ground' },
        {
            meshId: 'character-demo-ground',
            materialId: 'character-demo-ground-material',
        }
    );
    ground.requireComponent(Transform).position = new Vec3(0, -0.01, 0);
};

const createReferenceMarker = (scene: Scene): void => {
    const shader = scene.registerShader(
        createUnlitColorShaderDefinition(CHARACTER_REFERENCE_SHADER_ID)
    );

    scene.createBoxMesh(CHARACTER_REFERENCE_BAR_X_MESH_ID, 0.72, 0.04, 0.12);
    scene.createBoxMesh(CHARACTER_REFERENCE_BAR_Z_MESH_ID, 0.12, 0.04, 0.72);
    scene.createMaterial({
        id: CHARACTER_REFERENCE_MATERIAL_ID,
        shaderId: shader.id,
        uniforms: {
            u_Color: [0.2, 0.82, 1, 1],
        },
    });

    const segments = [
        {
            name: 'SpawnMarkerNorth',
            meshId: CHARACTER_REFERENCE_BAR_X_MESH_ID,
            position: new Vec3(0, 0.025, 0.42),
        },
        {
            name: 'SpawnMarkerSouth',
            meshId: CHARACTER_REFERENCE_BAR_X_MESH_ID,
            position: new Vec3(0, 0.025, -0.42),
        },
        {
            name: 'SpawnMarkerEast',
            meshId: CHARACTER_REFERENCE_BAR_Z_MESH_ID,
            position: new Vec3(0.42, 0.025, 0),
        },
        {
            name: 'SpawnMarkerWest',
            meshId: CHARACTER_REFERENCE_BAR_Z_MESH_ID,
            position: new Vec3(-0.42, 0.025, 0),
        },
    ] as const;

    for (const segment of segments) {
        const actor = scene.createRenderableActor(
            { name: segment.name },
            {
                meshId: segment.meshId,
                materialId: CHARACTER_REFERENCE_MATERIAL_ID,
                receiveLighting: false,
            }
        );
        actor.requireComponent(Transform).position = segment.position.clone();
    }
};

const createMotionTrail = (scene: Scene): readonly SceneActor[] => {
    scene.createSphereMesh(CHARACTER_TRAIL_MESH_ID, 0.09, 12);
    scene.createMaterial({
        id: CHARACTER_TRAIL_MATERIAL_ID,
        shaderId: CHARACTER_REFERENCE_SHADER_ID,
        uniforms: {
            u_Color: [1, 0.76, 0.28, 1],
        },
    });

    const actors: SceneActor[] = [];
    for (let index = 0; index < CHARACTER_TRAIL_POINT_COUNT; index += 1) {
        const actor = scene.createRenderableActor(
            { name: `MotionTrail${index}` },
            {
                meshId: CHARACTER_TRAIL_MESH_ID,
                materialId: CHARACTER_TRAIL_MATERIAL_ID,
                receiveLighting: false,
            }
        );
        actor.requireComponent(Transform).position = new Vec3(0, -100 - index, 0);
        actors.push(actor);
    }

    return actors;
};

const createLighting = (scene: Scene): void => {
    const sun = scene.createActor({ name: 'KeyLight' });
    const light = sun.addComponent(DirectionalLight, {
        color: [1, 0.95, 0.9],
        intensity: 1.45,
        primary: true,
    });
    light.primary = true;

    const sunTransform = sun.requireComponent(Transform);
    sunTransform.position = new Vec3(8, 12, 6);
    sunTransform.lookAt(new Vec3(0, 0.5, 0));
};

const loadLocalGltf = async (
    scene: Scene,
    database: AssetDatabase<GltfAssetSchemaLike>,
    uri: string,
    namePrefix: string
): Promise<LoadGltfSceneIntoSceneResult> => {
    const response = await fetch(uri);
    if (!response.ok) {
        throw new Error(`${uri} returned ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const receipt = await database.import({
        kind: 'bytes',
        data: bytes,
        uri,
        mimeType: 'model/gltf-binary',
    });

    return loadGltfSceneIntoScene(
        scene,
        database,
        { key: receipt.primary.key, kind: 'gltf.document' },
        { clearExisting: false, namePrefix }
    );
};

const registerCharacterPaletteMaterial = async (scene: Scene): Promise<void> => {
    scene.registerSampler({
        id: CHARACTER_PALETTE_SAMPLER_ID,
        minFilter: FilterMode.NEAREST,
        magFilter: FilterMode.NEAREST,
        wrapS: WrapMode.CLAMP_TO_EDGE,
        wrapT: WrapMode.CLAMP_TO_EDGE,
    });

    await scene.registerTexture({
        id: CHARACTER_PALETTE_TEXTURE_ID,
        samplerId: CHARACTER_PALETTE_SAMPLER_ID,
        source: {
            kind: 'url',
            url: COLOR_PALETTE_URL,
        },
    });

    scene.createMaterial({
        id: CHARACTER_PALETTE_MATERIAL_ID,
        shaderId: 'gltf/pbr',
        uniforms: {
            _BaseColorFactor: [1, 1, 1, 1],
            _BaseColorTexture_TexCoord: 0,
            _MetallicFactor: 0,
            _RoughnessFactor: 0.94,
        },
        textures: {
            _BaseColorTexture: {
                textureId: CHARACTER_PALETTE_TEXTURE_ID,
                samplerId: CHARACTER_PALETTE_SAMPLER_ID,
            },
        },
    });
};

const applyMaterialToImportedRenderers = (
    actors: readonly SceneActor[],
    materialId: string,
    predicate: (renderer: MeshRenderer) => boolean = () => true
): number => {
    let appliedCount = 0;

    for (const actor of actors) {
        const renderer = actor.getComponent(MeshRenderer);
        if (!renderer?.meshId || !predicate(renderer)) {
            continue;
        }

        renderer.materialId = materialId;
        appliedCount += 1;
    }

    return appliedCount;
};

const createDashboard = (container: HTMLElement): DashboardHandle => {
    const hud = document.createElement('div');
    Object.assign(hud.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '10',
    });

    const debugPanel = document.createElement('section');
    Object.assign(debugPanel.style, {
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '360px',
        maxHeight: 'calc(100% - 40px)',
        padding: '18px 18px 16px',
        borderRadius: '18px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'linear-gradient(160deg, rgba(17, 20, 26, 0.92), rgba(10, 12, 16, 0.82))',
        backdropFilter: 'blur(14px)',
        color: '#f7f1e7',
        fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.35)',
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    });

    const title = document.createElement('div');
    title.textContent = 'Character Hierarchy';
    Object.assign(title.style, {
        fontSize: '18px',
        fontWeight: '700',
        letterSpacing: '0.06em',
        marginBottom: '6px',
    });

    const subtitle = document.createElement('div');
    subtitle.textContent =
        'Imported character node tree. Select any node to inspect its live local and world transform values.';
    Object.assign(subtitle.style, {
        fontSize: '12px',
        lineHeight: '1.6',
        color: '#d7d0c4',
        marginBottom: '4px',
    });

    const metrics = document.createElement('div');
    Object.assign(metrics.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '10px',
    });

    const createMetric = (label: string) => {
        const card = document.createElement('div');
        Object.assign(card.style, {
            padding: '10px 12px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
        });

        const metricLabel = document.createElement('div');
        metricLabel.textContent = label;
        Object.assign(metricLabel.style, {
            fontSize: '10px',
            letterSpacing: '0.12em',
            color: '#a8b1ba',
            marginBottom: '6px',
            textTransform: 'uppercase',
        });

        const metricValue = document.createElement('div');
        metricValue.textContent = 'Pending';
        Object.assign(metricValue.style, {
            fontSize: '14px',
            fontWeight: '600',
            color: '#fff7ec',
        });

        card.appendChild(metricLabel);
        card.appendChild(metricValue);
        metrics.appendChild(card);
        return metricValue;
    };

    const stateValue = createMetric('Animation');
    const clipValue = createMetric('Loaded Clips');
    const positionValue = createMetric('World XZ');
    const speedValue = createMetric('Speed');

    positionValue.textContent = '0.00, 0.00';
    speedValue.textContent = '0.00 u/s';

    const treeLabel = document.createElement('div');
    treeLabel.textContent = 'Nodes';
    Object.assign(treeLabel.style, {
        fontSize: '10px',
        fontWeight: '700',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#96a4b1',
    });

    const hierarchyHost = document.createElement('div');
    Object.assign(hierarchyHost.style, {
        minHeight: '220px',
        maxHeight: '320px',
        overflow: 'auto',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(255, 255, 255, 0.03)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    });

    const inspectorLabel = document.createElement('div');
    inspectorLabel.textContent = 'Transform Inspector';
    Object.assign(inspectorLabel.style, {
        fontSize: '10px',
        fontWeight: '700',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#96a4b1',
    });

    const inspectorHost = document.createElement('div');
    Object.assign(inspectorHost.style, {
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(255, 255, 255, 0.03)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    });

    const createInspectorRow = (label: string) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'grid',
            gridTemplateColumns: '94px minmax(0, 1fr)',
            gap: '10px',
            alignItems: 'start',
        });

        const labelElement = document.createElement('div');
        labelElement.textContent = label;
        Object.assign(labelElement.style, {
            fontSize: '11px',
            color: '#a8b1ba',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
        });

        const valueElement = document.createElement('div');
        valueElement.textContent = 'Pending';
        Object.assign(valueElement.style, {
            fontSize: '12px',
            lineHeight: '1.5',
            color: '#fff7ec',
            fontFamily: '"IBM Plex Mono", Consolas, monospace',
            wordBreak: 'break-word',
        });

        row.appendChild(labelElement);
        row.appendChild(valueElement);
        inspectorHost.appendChild(row);

        return valueElement;
    };

    const selectedNodeValue = createInspectorRow('Node');
    const parentNodeValue = createInspectorRow('Parent');
    const childCountValue = createInspectorRow('Children');
    const localPositionValue = createInspectorRow('Local Pos');
    const worldPositionValue = createInspectorRow('World Pos');
    const localRotationValue = createInspectorRow('Local Rot');
    const worldRotationValue = createInspectorRow('World Rot');
    const localScaleValue = createInspectorRow('Local Scale');
    const worldScaleValue = createInspectorRow('World Scale');

    const statusValue = document.createElement('div');
    statusValue.textContent = 'Loading local assets...';
    Object.assign(statusValue.style, {
        fontSize: '12px',
        lineHeight: '1.6',
        color: '#c9d6df',
        whiteSpace: 'pre-wrap',
        borderRadius: '12px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '10px 12px',
        maxHeight: '160px',
        overflow: 'auto',
    });

    const treeButtons = new Map<Transform, HTMLButtonElement>();
    let selectedTransform: Transform | null = null;

    const refreshSelection = () => {
        if (!selectedTransform) {
            selectedNodeValue.textContent = 'None';
            parentNodeValue.textContent = 'None';
            childCountValue.textContent = '0';
            localPositionValue.textContent = '0.000, 0.000, 0.000';
            worldPositionValue.textContent = '0.000, 0.000, 0.000';
            localRotationValue.textContent = '0.000, 0.000, 0.000, 1.000';
            worldRotationValue.textContent = '0.000, 0.000, 0.000, 1.000';
            localScaleValue.textContent = '1.000, 1.000, 1.000';
            worldScaleValue.textContent = '1.000, 1.000, 1.000';
            return;
        }

        const actor = getActorFromTransform(selectedTransform);
        const parentActor = getActorFromTransform(selectedTransform.parent);
        selectedNodeValue.textContent = actor?.name ?? 'Unnamed';
        parentNodeValue.textContent = parentActor?.name ?? 'None';
        childCountValue.textContent = String(selectedTransform.children.length);
        localPositionValue.textContent = formatDebugVec3(selectedTransform.position);
        worldPositionValue.textContent = formatDebugVec3(selectedTransform.worldPosition);
        localRotationValue.textContent = formatDebugQuat(selectedTransform.rotation);
        worldRotationValue.textContent = formatDebugQuat(selectedTransform.worldRotation);
        localScaleValue.textContent = formatDebugVec3(selectedTransform.scale);
        worldScaleValue.textContent = formatDebugVec3(selectedTransform.worldScale);
    };

    const syncSelectionStyles = () => {
        for (const [transform, button] of treeButtons) {
            const isSelected = transform === selectedTransform;
            button.style.background = isSelected ? 'rgba(227, 161, 76, 0.22)' : 'transparent';
            button.style.borderColor = isSelected
                ? 'rgba(227, 161, 76, 0.55)'
                : 'rgba(255, 255, 255, 0.04)';
            button.style.color = isSelected ? '#fff4df' : '#d8e0e7';
        }
    };

    const selectTransform = (transform: Transform) => {
        selectedTransform = transform;
        syncSelectionStyles();
        refreshSelection();
    };

    const appendTransformNode = (transform: Transform, depth: number) => {
        const actor = getActorFromTransform(transform);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${transform.children.length > 0 ? '▾' : '•'} ${actor?.name ?? 'Unnamed Node'}`;
        Object.assign(button.style, {
            appearance: 'none',
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: '10px',
            color: '#d8e0e7',
            cursor: 'pointer',
            fontFamily: '"IBM Plex Mono", Consolas, monospace',
            fontSize: '11px',
            lineHeight: '1.4',
            padding: `7px 10px 7px ${10 + depth * 16}px`,
            textAlign: 'left',
            width: '100%',
        });
        button.addEventListener('click', () => {
            selectTransform(transform);
        });
        treeButtons.set(transform, button);
        hierarchyHost.appendChild(button);

        for (const child of transform.children) {
            appendTransformNode(child, depth + 1);
        }
    };

    debugPanel.appendChild(title);
    debugPanel.appendChild(subtitle);
    debugPanel.appendChild(metrics);
    debugPanel.appendChild(treeLabel);
    debugPanel.appendChild(hierarchyHost);
    debugPanel.appendChild(inspectorLabel);
    debugPanel.appendChild(inspectorHost);
    debugPanel.appendChild(statusValue);

    const controlsPanel = document.createElement('section');
    Object.assign(controlsPanel.style, {
        position: 'absolute',
        top: '20px',
        right: '20px',
        width: '280px',
        padding: '18px',
        borderRadius: '18px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'linear-gradient(180deg, rgba(19, 23, 28, 0.9), rgba(12, 14, 18, 0.84))',
        backdropFilter: 'blur(14px)',
        color: '#ecf1f5',
        fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.28)',
        pointerEvents: 'auto',
        overflow: 'hidden',
    });

    const controlsTitle = document.createElement('div');
    controlsTitle.textContent = 'Camera + Locomotion';
    Object.assign(controlsTitle.style, {
        fontSize: '15px',
        fontWeight: '700',
        marginBottom: '14px',
    });

    const controlsHost = document.createElement('div');
    Object.assign(controlsHost.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    });

    controlsPanel.appendChild(controlsTitle);
    controlsPanel.appendChild(controlsHost);

    hud.appendChild(debugPanel);
    hud.appendChild(controlsPanel);
    container.appendChild(hud);

    refreshSelection();

    return {
        controlsHost,
        setStatus(next: string, color: string = '#c9d6df') {
            statusValue.textContent = next;
            statusValue.style.color = color;
        },
        setAnimationState(next: string) {
            stateValue.textContent = next;
        },
        setClipSummary(next: string) {
            clipValue.textContent = next;
        },
        setMotionTelemetry(position: Readonly<Vec3>, speed: number) {
            positionValue.textContent = formatWorldPositionLabel(position);
            speedValue.textContent = formatSpeedLabel(speed);
        },
        setHierarchyRoot(rootTransform: Transform) {
            hierarchyHost.replaceChildren();
            treeButtons.clear();
            appendTransformNode(rootTransform, 0);
            selectTransform(rootTransform);
        },
        refreshSelection,
        dispose() {
            hud.remove();
        },
    };
};

const addSectionLabel = (host: HTMLElement, label: string): void => {
    const element = document.createElement('div');
    element.textContent = label;
    Object.assign(element.style, {
        fontSize: '10px',
        fontWeight: '700',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#96a4b1',
        paddingTop: '6px',
    });
    host.appendChild(element);
};

const addSlider = (
    host: HTMLElement,
    options: {
        readonly label: string;
        readonly min: number;
        readonly max: number;
        readonly step: number;
        readonly value: number;
        readonly format?: (value: number) => string;
        readonly onChange: (value: number) => void;
    }
): void => {
    const row = document.createElement('label');
    Object.assign(row.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
    });

    const top = document.createElement('div');
    Object.assign(top.style, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '12px',
        color: '#d1dae2',
    });

    const label = document.createElement('span');
    label.textContent = options.label;

    const value = document.createElement('span');
    value.textContent = options.format?.(options.value) ?? options.value.toFixed(2);
    Object.assign(value.style, {
        color: '#fff9f0',
        fontFamily: '"IBM Plex Mono", Consolas, monospace',
    });

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    input.value = String(options.value);
    Object.assign(input.style, {
        width: '100%',
        accentColor: '#e3a14c',
        cursor: 'pointer',
        margin: '0',
    });

    input.addEventListener('input', (event) => {
        const nextValue = Number((event.target as HTMLInputElement).value);
        value.textContent = options.format?.(nextValue) ?? nextValue.toFixed(2);
        options.onChange(nextValue);
    });

    top.appendChild(label);
    top.appendChild(value);
    row.appendChild(top);
    row.appendChild(input);
    host.appendChild(row);
};

const addReadonlyValue = (host: HTMLElement, label: string, value: string): void => {
    const row = document.createElement('div');
    Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '12px',
        color: '#d1dae2',
    });

    const title = document.createElement('span');
    title.textContent = label;

    const body = document.createElement('span');
    body.textContent = value;
    Object.assign(body.style, {
        color: '#fff9f0',
        fontFamily: '"IBM Plex Mono", Consolas, monospace',
        textAlign: 'right',
    });

    row.appendChild(title);
    row.appendChild(body);
    host.appendChild(row);
};

@script({ scriptName: 'CharacterLocomotionController' })
class CharacterLocomotionController extends Component {
    public moveSpeed = 5.2;
    public acceleration = 16;
    public deceleration = 20;
    public turnSpeed = 14;
    public transitionDuration = 0.16;
    public onStateChanged?: (label: string, clipId: string | null) => void;

    private readonly _pressedKeys = new Set<string>();
    private readonly _velocity = new Vec3();
    private readonly _desiredVelocity = new Vec3();
    private readonly _movementDirection = new Vec3();
    private readonly _cameraForward = new Vec3();
    private readonly _cameraRight = new Vec3();
    private _cameraTransform?: Transform;
    private _inputScopeElement: HTMLElement | null = null;
    private _animator: Animator | null = null;
    private _idleClipId: string | null = null;
    private _moveClipId: string | null = null;
    private _activeClipId: string | null = null;
    private _yaw = 0;

    setCameraReference(transform: Transform | undefined): this {
        this._cameraTransform = transform;
        return this;
    }

    setInputScopeElement(element: HTMLElement | null | undefined): this {
        this._inputScopeElement = element ?? null;
        return this;
    }

    bindAnimator(animator: Animator | null, clips: CharacterClipSet): this {
        this._animator = animator;
        this._idleClipId = clips.idle;
        this._moveClipId = clips.run ?? clips.walk ?? clips.idle;

        if (this._animator && this._idleClipId) {
            this._transitionTo(this._idleClipId, true);
        }

        return this;
    }

    awake(): void {
        const trackedKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
        const clearPressedKeys = () => {
            this._pressedKeys.clear();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (!trackedKeys.has(event.code)) {
                return;
            }

            if (!this._shouldCaptureKeyboardInput()) {
                return;
            }

            event.preventDefault();
            this._pressedKeys.add(event.code);
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (!trackedKeys.has(event.code)) {
                return;
            }

            if (!this._shouldCaptureKeyboardInput()) {
                return;
            }

            event.preventDefault();
            this._pressedKeys.delete(event.code);
        };

        globalThis.addEventListener('keydown', onKeyDown, { passive: false, capture: true });
        globalThis.addEventListener('keyup', onKeyUp, { passive: false, capture: true });
        globalThis.addEventListener('blur', clearPressedKeys);
        this._inputScopeElement?.addEventListener('blur', clearPressedKeys);

        (this as { _cleanupInput?: () => void })._cleanupInput = () => {
            globalThis.removeEventListener('keydown', onKeyDown, true);
            globalThis.removeEventListener('keyup', onKeyUp, true);
            globalThis.removeEventListener('blur', clearPressedKeys);
            this._inputScopeElement?.removeEventListener('blur', clearPressedKeys);
            clearPressedKeys();
        };
    }

    update(deltaTime: number): void {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return;
        }

        const deltaSeconds = Math.max(0, deltaTime / 1000);
        const inputX =
            (this._pressedKeys.has('KeyD') ? 1 : 0) -
            (this._pressedKeys.has('KeyA') ? 1 : 0);
        const inputZ =
            (this._pressedKeys.has('KeyW') ? 1 : 0) -
            (this._pressedKeys.has('KeyS') ? 1 : 0);

        this._movementDirection.x = 0;
        this._movementDirection.y = 0;
        this._movementDirection.z = 0;

        if (inputX !== 0 || inputZ !== 0) {
            const forward = this._resolvePlanarCameraVector(Vec3.BACK, this._cameraForward);
            const right = this._resolvePlanarCameraVector(Vec3.RIGHT, this._cameraRight);

            this._movementDirection.x = right.x * inputX + forward.x * inputZ;
            this._movementDirection.z = right.z * inputX + forward.z * inputZ;

            if (this._movementDirection.lengthSquared() > 1e-6) {
                this._movementDirection.normalize();
            }
        }

        this._desiredVelocity.x = this._movementDirection.x * this.moveSpeed;
        this._desiredVelocity.y = 0;
        this._desiredVelocity.z = this._movementDirection.z * this.moveSpeed;

        const velocityBlend = computeSmoothingFactor(
            this._movementDirection.lengthSquared() > 1e-6 ? this.acceleration : this.deceleration,
            deltaSeconds
        );
        Vec3.lerp(this._velocity, this._desiredVelocity, velocityBlend, this._velocity);

        if (this._velocity.lengthSquared() > 1e-6) {
            const position = transform.position.clone();
            position.x += this._velocity.x * deltaSeconds;
            position.z += this._velocity.z * deltaSeconds;
            transform.position = position;
        }

        const facingDirection =
            this._movementDirection.lengthSquared() > 1e-6 ? this._movementDirection : this._velocity;
        if (facingDirection.lengthSquared() > 1e-6) {
            const targetYaw = Math.atan2(facingDirection.x, facingDirection.z);
            const deltaYaw = Math.atan2(
                Math.sin(targetYaw - this._yaw),
                Math.cos(targetYaw - this._yaw)
            );
            this._yaw += deltaYaw * computeSmoothingFactor(this.turnSpeed, deltaSeconds);
            transform.rotation = Quat.fromEuler(0, this._yaw, 0);
        }

        const isMoving =
            this._movementDirection.lengthSquared() > 1e-6 || this._velocity.lengthSquared() > 0.04;
        this._transitionTo(
            isMoving ? this._moveClipId ?? this._idleClipId : this._idleClipId ?? this._moveClipId,
            false
        );
    }

    onDestroy(): void {
        (this as { _cleanupInput?: () => void })._cleanupInput?.();
    }

    private _resolvePlanarCameraVector(
        localDirection: Readonly<Vec3>,
        out: Vec3
    ): Vec3 {
        if (this._cameraTransform) {
            Quat.rotateVector(this._cameraTransform.worldRotation, localDirection, out);
            out.y = 0;
            if (out.lengthSquared() > 1e-6) {
                out.normalize();
                return out;
            }
        }

        out.x = localDirection.x;
        out.y = 0;
        out.z = localDirection.z;
        if (out.lengthSquared() > 1e-6) {
            out.normalize();
        }
        return out;
    }

    private _shouldCaptureKeyboardInput(): boolean {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement) || activeElement === document.body) {
            return true;
        }

        const tagName = activeElement.tagName;
        if (tagName === 'TEXTAREA' || tagName === 'SELECT' || activeElement.isContentEditable) {
            return false;
        }

        if (tagName === 'INPUT') {
            const input = activeElement as HTMLInputElement;
            const textLikeTypes = new Set([
                'text',
                'search',
                'email',
                'password',
                'tel',
                'url',
                'number',
            ]);
            if (textLikeTypes.has((input.type || 'text').toLowerCase())) {
                return false;
            }
        }

        if (
            activeElement.closest('#editor-host') ||
            activeElement.closest('.monaco-editor') ||
            activeElement.getAttribute('role') === 'textbox'
        ) {
            return false;
        }

        return true;
    }

    private _transitionTo(clipId: string | null, immediate: boolean): void {
        if (!this._animator || !clipId || clipId === this._activeClipId) {
            return;
        }

        this._activeClipId = clipId;

        try {
            if (immediate || !this._animator.clipId) {
                this._animator.play(clipId);
            } else {
                this._animator.crossFade(clipId, this.transitionDuration);
            }
        } catch {
            this._animator.play(clipId);
        }

        this.onStateChanged?.(formatClipLabel(clipId), clipId);
    }
}

const characterFollowCameraExample: SceneExample = {
    id: 'character-follow-camera',
    title: 'Character Follow Camera',
    description:
        'Imports a local animated glTF character, switches between Idle and Run at runtime, and drives it with camera-relative WASD movement.',
    tags: ['scene', 'gltf', 'animation', 'camera', 'controller'],
    order: 4,
    async mount({ container }: ExampleContext) {
        container.replaceChildren();

        const shell = document.createElement('div');
        Object.assign(shell.style, {
            position: 'relative',
            width: '100%',
            height: '100%',
        });

        const sceneHost = document.createElement('div');
        Object.assign(sceneHost.style, {
            width: '100%',
            height: '100%',
            cursor: 'grab',
            outline: 'none',
        });
        sceneHost.tabIndex = 0;
        sceneHost.setAttribute('aria-label', 'Character follow camera preview');

        shell.appendChild(sceneHost);
        container.appendChild(shell);

        const viewportWidth = sceneHost.clientWidth || 1280;
        const viewportHeight = sceneHost.clientHeight || 720;
        const dashboard = createDashboard(shell);
        const scene = new Scene({
            width: viewportWidth,
            height: viewportHeight,
            autoStart: true,
            parent: sceneHost,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
            clearColor: [0.03, 0.035, 0.045, 1],
            ambientLight: [0.34, 0.34, 0.38],
        });

        scene.registerComponent(CharacterLocomotionController);
        scene.registerComponent(FollowCameraController);

        createGround(scene);
        createReferenceMarker(scene);
        const motionTrailActors = createMotionTrail(scene);
        createLighting(scene);

        const cleanupResize = bindSceneToContainer(scene, sceneHost, viewportWidth, viewportHeight);
        const database = new AssetDatabase<GltfAssetSchemaLike>({
            importers: [
                createGltfImporter<GltfAssetSchemaLike>() as AssetImporter<GltfAssetSchemaLike>,
            ],
        });

        let removeInteractionListeners = () => {};
        let deferredDeskPaletteBinding: ReturnType<typeof globalThis.setTimeout> | null = null;

        try {
            const [characterLoadResult, deskLoadResult] = await Promise.allSettled([
                loadLocalGltf(scene, database, CHARACTER_MODEL_URL, 'Character '),
                loadLocalGltf(scene, database, DESK_MODEL_URL, 'Desk '),
            ]);

            if (characterLoadResult.status !== 'fulfilled') {
                throw characterLoadResult.reason;
            }

            const characterActors = characterLoadResult.value.actors as readonly SceneActor[];
            await registerCharacterPaletteMaterial(scene);
            const characterContainer = createImportedModelContainer(
                scene,
                characterActors,
                'CharacterRoot'
            );
            const paletteRendererCount = applyMaterialToImportedRenderers(
                characterActors,
                CHARACTER_PALETTE_MATERIAL_ID
            );
            const characterBounds = fitImportedModel(
                characterActors,
                characterContainer,
                database,
                {
                    targetHeight: 2.15,
                    position: new Vec3(0, 0, 0),
                }
            );

            let deskPaletteRendererCount = 0;
            let deskActorsForPaletteBinding: readonly SceneActor[] = [];
            if (deskLoadResult.status === 'fulfilled') {
                const deskActors = deskLoadResult.value.actors as readonly SceneActor[];
                deskActorsForPaletteBinding = deskActors;
                const deskContainer = createImportedModelContainer(scene, deskActors, 'DeskRoot');
                fitImportedModel(deskActors, deskContainer, database, {
                    targetHeight: 1.75,
                    position: new Vec3(4.4, 0, -2.8),
                    yaw: -0.62,
                });
            }

            const animator =
                characterActors
                    .map((actor) => actor.getComponent(Animator))
                    .find((component): component is Animator => Boolean(component)) ?? null;
            const clipSet = resolveCharacterClipSet(animator);
            dashboard.setClipSummary(
                clipSet.ids.length > 0
                    ? clipSet.ids.map((clipId) => formatClipLabel(clipId)).join(', ')
                    : 'No clips'
            );
            dashboard.setAnimationState(formatClipLabel(clipSet.idle ?? clipSet.run));

            const characterRig = characterContainer.requireComponent(Transform);
            dashboard.setHierarchyRoot(characterRig);
            const locomotion = characterContainer.addComponent(CharacterLocomotionController);
            locomotion.bindAnimator(animator, clipSet);
            locomotion.setInputScopeElement(sceneHost);
            locomotion.onStateChanged = (label) => dashboard.setAnimationState(label);
            dashboard.setMotionTelemetry(characterRig.worldPosition, 0);

            const camera = scene.createCameraActor(
                { name: 'FollowCamera' },
                { primary: true, fieldOfView: 46, near: 0.1, far: 200 }
            );
            const followCamera = camera.addComponent(FollowCameraController, {
                distance: 8.4,
                minDistance: 3,
                maxDistance: 11.5,
                azimuth: 0.62,
                elevation: 0.44,
                targetOffset: [0, Math.max(1.28, (characterBounds?.size.y ?? 2) * 0.64), 0],
                positionDamping: 4.6,
                targetDamping: 5.2,
            });
            followCamera.setTarget(characterRig);
            locomotion.setCameraReference(camera.requireComponent(Transform));

            const previousTelemetryPosition = characterRig.worldPosition.clone();
            const lastTrailDropPosition = characterRig.worldPosition.clone();
            let trailWriteIndex = 0;
            scene.loop.addSystem({
                id: CHARACTER_TELEMETRY_SYSTEM_ID,
                priority: 110,
                enabled: true,
                update(context) {
                    const position = characterRig.worldPosition;
                    const deltaSeconds = Math.max(1 / 1000, context.delta / 1000);
                    const deltaX = position.x - previousTelemetryPosition.x;
                    const deltaY = position.y - previousTelemetryPosition.y;
                    const deltaZ = position.z - previousTelemetryPosition.z;
                    const speed = Math.hypot(deltaX, deltaY, deltaZ) / deltaSeconds;
                    dashboard.setMotionTelemetry(position, speed);
                    dashboard.refreshSelection();

                    const planarTravel = Math.hypot(
                        position.x - lastTrailDropPosition.x,
                        position.z - lastTrailDropPosition.z
                    );
                    if (speed >= 0.35 && planarTravel >= 0.7) {
                        motionTrailActors[trailWriteIndex]
                            .requireComponent(Transform)
                            .position = new Vec3(position.x, 0.09, position.z);
                        trailWriteIndex = (trailWriteIndex + 1) % motionTrailActors.length;
                        lastTrailDropPosition.x = position.x;
                        lastTrailDropPosition.y = position.y;
                        lastTrailDropPosition.z = position.z;
                    }

                    previousTelemetryPosition.x = position.x;
                    previousTelemetryPosition.y = position.y;
                    previousTelemetryPosition.z = position.z;
                },
            });

            let orbiting = false;
            let pointerId = -1;
            let previousX = 0;
            let previousY = 0;

            const handlePointerDown = (event: PointerEvent) => {
                if (event.button !== 2 && event.button !== 1) {
                    sceneHost.focus({ preventScroll: true });
                    return;
                }

                orbiting = true;
                pointerId = event.pointerId;
                previousX = event.clientX;
                previousY = event.clientY;
                sceneHost.focus({ preventScroll: true });
                sceneHost.setPointerCapture(event.pointerId);
                sceneHost.style.cursor = 'grabbing';
                event.preventDefault();
            };

            const handlePointerMove = (event: PointerEvent) => {
                if (!orbiting || event.pointerId !== pointerId) {
                    return;
                }

                const deltaX = event.clientX - previousX;
                const deltaY = event.clientY - previousY;
                previousX = event.clientX;
                previousY = event.clientY;

                followCamera.orbit(-deltaX * 0.0125, -deltaY * 0.0095);
                event.preventDefault();
            };

            const endOrbit = (event: PointerEvent) => {
                if (event.pointerId !== pointerId) {
                    return;
                }

                orbiting = false;
                pointerId = -1;
                sceneHost.style.cursor = 'grab';
                if (sceneHost.hasPointerCapture(event.pointerId)) {
                    sceneHost.releasePointerCapture(event.pointerId);
                }
            };

            const handleWheel = (event: WheelEvent) => {
                event.preventDefault();
                followCamera.zoom(event.deltaY * 0.009);
            };

            const handleContextMenu = (event: MouseEvent) => {
                event.preventDefault();
            };

            sceneHost.addEventListener('pointerdown', handlePointerDown);
            sceneHost.addEventListener('pointermove', handlePointerMove);
            sceneHost.addEventListener('pointerup', endOrbit);
            sceneHost.addEventListener('pointercancel', endOrbit);
            sceneHost.addEventListener('wheel', handleWheel, { passive: false });
            sceneHost.addEventListener('contextmenu', handleContextMenu);
            sceneHost.focus({ preventScroll: true });

            removeInteractionListeners = () => {
                sceneHost.removeEventListener('pointerdown', handlePointerDown);
                sceneHost.removeEventListener('pointermove', handlePointerMove);
                sceneHost.removeEventListener('pointerup', endOrbit);
                sceneHost.removeEventListener('pointercancel', endOrbit);
                sceneHost.removeEventListener('wheel', handleWheel);
                sceneHost.removeEventListener('contextmenu', handleContextMenu);
            };

            addSectionLabel(dashboard.controlsHost, 'Camera');
            addSlider(dashboard.controlsHost, {
                label: 'Distance',
                min: 3,
                max: 11.5,
                step: 0.1,
                value: followCamera.distance,
                format: (value) => value.toFixed(1),
                onChange: (value) => {
                    followCamera.distance = value;
                    followCamera.snap();
                },
            });
            addSlider(dashboard.controlsHost, {
                label: 'Azimuth',
                min: -180,
                max: 180,
                step: 1,
                value: (followCamera.azimuth * 180) / Math.PI,
                format: (value) => `${value.toFixed(0)}deg`,
                onChange: (value) => {
                    followCamera.azimuth = (value * Math.PI) / 180;
                    followCamera.snap();
                },
            });
            addSlider(dashboard.controlsHost, {
                label: 'Elevation',
                min: 10,
                max: 70,
                step: 1,
                value: (followCamera.elevation * 180) / Math.PI,
                format: (value) => `${value.toFixed(0)}deg`,
                onChange: (value) => {
                    followCamera.elevation = (value * Math.PI) / 180;
                    followCamera.snap();
                },
            });
            addSlider(dashboard.controlsHost, {
                label: 'Target Height',
                min: 0.8,
                max: 2.8,
                step: 0.05,
                value: followCamera.targetOffset.y,
                format: (value) => value.toFixed(2),
                onChange: (value) => {
                    followCamera.targetOffset = new Vec3(
                        followCamera.targetOffset.x,
                        value,
                        followCamera.targetOffset.z
                    );
                    followCamera.snap();
                },
            });
            addSlider(dashboard.controlsHost, {
                label: 'Camera Smoothing',
                min: 1,
                max: 14,
                step: 0.5,
                value: followCamera.positionDamping,
                format: (value) => value.toFixed(1),
                onChange: (value) => {
                    followCamera.positionDamping = value;
                },
            });

            addSectionLabel(dashboard.controlsHost, 'Locomotion');
            addSlider(dashboard.controlsHost, {
                label: 'Move Speed',
                min: 1.5,
                max: 8,
                step: 0.1,
                value: locomotion.moveSpeed,
                format: (value) => value.toFixed(1),
                onChange: (value) => {
                    locomotion.moveSpeed = value;
                },
            });
            addSlider(dashboard.controlsHost, {
                label: 'Turn Smoothing',
                min: 3,
                max: 20,
                step: 0.5,
                value: locomotion.turnSpeed,
                format: (value) => value.toFixed(1),
                onChange: (value) => {
                    locomotion.turnSpeed = value;
                },
            });
            addSlider(dashboard.controlsHost, {
                label: 'Anim Blend',
                min: 0.05,
                max: 0.4,
                step: 0.01,
                value: locomotion.transitionDuration,
                format: (value) => `${value.toFixed(2)}s`,
                onChange: (value) => {
                    locomotion.transitionDuration = value;
                },
            });

            addSectionLabel(dashboard.controlsHost, 'Runtime');
            addReadonlyValue(
                dashboard.controlsHost,
                'Character Clips',
                clipSet.ids.length > 0 ? String(clipSet.ids.length) : '0'
            );
            addReadonlyValue(
                dashboard.controlsHost,
                'Environment Prop',
                deskLoadResult.status === 'fulfilled' ? 'CityDesk loaded' : 'Unavailable'
            );

            const diagnosticSummary = [
                ...characterLoadResult.value.diagnostics,
                ...(deskLoadResult.status === 'fulfilled' ? deskLoadResult.value.diagnostics : []),
            ]
                .slice(0, 4)
                .map((entry) => `${entry.level.toUpperCase()} ${entry.code}`)
                .join('\n');

            const updateStatus = () => {
                dashboard.setStatus(
                    `Character loaded from ${CHARACTER_MODEL_URL}\nEnvironment prop ${
                        deskLoadResult.status === 'fulfilled' ? 'loaded' : 'skipped'
                    }.\nPalette material bound from ${COLOR_PALETTE_URL} to ${paletteRendererCount} character renderer${
                        paletteRendererCount === 1 ? '' : 's'
                    } because the GLB does not embed material data.${
                        deskPaletteRendererCount > 0
                            ? `\nPalette material also bound to ${deskPaletteRendererCount} desk renderer${deskPaletteRendererCount === 1 ? '' : 's'}.`
                            : ''
                    }${diagnosticSummary ? `\n${diagnosticSummary}` : '\nNo importer warnings.'}`,
                    '#d7e2ea'
                );
            };

            updateStatus();

            if (deskActorsForPaletteBinding.length > 0) {
                deferredDeskPaletteBinding = globalThis.setTimeout(() => {
                    deskPaletteRendererCount = applyMaterialToImportedRenderers(
                        deskActorsForPaletteBinding,
                        CHARACTER_PALETTE_MATERIAL_ID,
                        (renderer) =>
                            renderer.materialId === null || renderer.materialId.endsWith('#material/default')
                    );
                    updateStatus();
                }, 150);
            }

            const root = globalThis as { scene?: Scene };
            root.scene = scene;

            return {
                dispose() {
                    if (deferredDeskPaletteBinding !== null) {
                        globalThis.clearTimeout(deferredDeskPaletteBinding);
                    }
                    scene.loop.removeSystem(CHARACTER_TELEMETRY_SYSTEM_ID);
                    removeInteractionListeners();
                    cleanupResize();
                    dashboard.dispose();
                    database.dispose();
                    if (root.scene === scene) {
                        delete root.scene;
                    }
                    scene.dispose();
                    container.replaceChildren();
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dashboard.setStatus(
                `Character demo failed to initialize.\n${message}`,
                '#ffb4b4'
            );

            return {
                dispose() {
                    removeInteractionListeners();
                    cleanupResize();
                    dashboard.dispose();
                    database.dispose();
                    scene.dispose();
                    container.replaceChildren();
                },
            };
        }
    },
};

export default characterFollowCameraExample;