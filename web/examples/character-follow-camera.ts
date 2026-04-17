import { AssetDatabase, type AssetImporter } from '@axrone/asset-core';
import {
    createGltfImporter,
    type GltfAssetSchemaLike,
} from '@axrone/asset-gltf';
import { Component, Transform, script } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import {
    Animator,
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
    readonly stateValue: HTMLElement;
    readonly clipValue: HTMLElement;
    setStatus(next: string, color?: string): void;
    setAnimationState(next: string): void;
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

    const infoPanel = document.createElement('section');
    Object.assign(infoPanel.style, {
        position: 'absolute',
        top: '20px',
        left: '20px',
        width: '340px',
        padding: '18px 18px 16px',
        borderRadius: '18px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'linear-gradient(160deg, rgba(17, 20, 26, 0.92), rgba(10, 12, 16, 0.82))',
        backdropFilter: 'blur(14px)',
        color: '#f7f1e7',
        fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.35)',
        pointerEvents: 'auto',
    });

    const title = document.createElement('div');
    title.textContent = 'FOLLOW CHARACTER';
    Object.assign(title.style, {
        fontSize: '18px',
        fontWeight: '700',
        letterSpacing: '0.14em',
        marginBottom: '6px',
    });

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Local glTF import, runtime animation switching, and orbitable follow camera.';
    Object.assign(subtitle.style, {
        fontSize: '12px',
        lineHeight: '1.6',
        color: '#d7d0c4',
        marginBottom: '14px',
    });

    const statusValue = document.createElement('div');
    statusValue.textContent = 'Loading local assets...';
    Object.assign(statusValue.style, {
        fontSize: '12px',
        lineHeight: '1.6',
        color: '#c9d6df',
        marginBottom: '14px',
        whiteSpace: 'pre-wrap',
    });

    const metrics = document.createElement('div');
    Object.assign(metrics.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '10px',
        marginBottom: '14px',
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

    const instructionList = document.createElement('div');
    instructionList.innerHTML = [
        'WASD: camera-relative locomotion',
        'Right Mouse Drag: orbit camera',
        'Mouse Wheel: zoom',
        'Idle/Run clip switching is driven in runtime',
    ].join('<br />');
    Object.assign(instructionList.style, {
        fontSize: '12px',
        lineHeight: '1.7',
        color: '#d1d8df',
        marginBottom: '14px',
    });

    const palette = document.createElement('img');
    palette.src = COLOR_PALETTE_URL;
    palette.alt = 'Palette';
    Object.assign(palette.style, {
        display: 'block',
        width: '100%',
        height: '82px',
        objectFit: 'cover',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.06)',
    });

    infoPanel.appendChild(title);
    infoPanel.appendChild(subtitle);
    infoPanel.appendChild(statusValue);
    infoPanel.appendChild(metrics);
    infoPanel.appendChild(instructionList);
    infoPanel.appendChild(palette);

    const controlsPanel = document.createElement('section');
    Object.assign(controlsPanel.style, {
        position: 'absolute',
        top: '20px',
        right: '20px',
        width: '300px',
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

    hud.appendChild(infoPanel);
    hud.appendChild(controlsPanel);
    container.appendChild(hud);

    return {
        controlsHost,
        stateValue,
        clipValue,
        setStatus(next: string, color: string = '#c9d6df') {
            statusValue.textContent = next;
            statusValue.style.color = color;
        },
        setAnimationState(next: string) {
            stateValue.textContent = next;
        },
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
    private _animator: Animator | null = null;
    private _idleClipId: string | null = null;
    private _moveClipId: string | null = null;
    private _activeClipId: string | null = null;
    private _yaw = 0;

    setCameraReference(transform: Transform | undefined): this {
        this._cameraTransform = transform;
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
        const onKeyDown = (event: KeyboardEvent) => {
            if (!trackedKeys.has(event.code)) {
                return;
            }

            event.preventDefault();
            this._pressedKeys.add(event.code);
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (!trackedKeys.has(event.code)) {
                return;
            }

            event.preventDefault();
            this._pressedKeys.delete(event.code);
        };

        globalThis.addEventListener('keydown', onKeyDown, { passive: false });
        globalThis.addEventListener('keyup', onKeyUp, { passive: false });

        (this as { _cleanupInput?: () => void })._cleanupInput = () => {
            globalThis.removeEventListener('keydown', onKeyDown);
            globalThis.removeEventListener('keyup', onKeyUp);
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
        });

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
            dashboard.clipValue.textContent =
                clipSet.ids.length > 0
                    ? clipSet.ids.map((clipId) => formatClipLabel(clipId)).join(', ')
                    : 'No clips';
            dashboard.setAnimationState(formatClipLabel(clipSet.idle ?? clipSet.run));

            const characterRig = characterContainer.requireComponent(Transform);
            const locomotion = characterContainer.addComponent(CharacterLocomotionController);
            locomotion.bindAnimator(animator, clipSet);
            locomotion.onStateChanged = (label) => dashboard.setAnimationState(label);

            const camera = scene.createCameraActor(
                { name: 'FollowCamera' },
                { primary: true, fieldOfView: 46, near: 0.1, far: 200 }
            );
            const followCamera = camera.addComponent(FollowCameraController, {
                distance: 7.8,
                minDistance: 3,
                maxDistance: 16,
                azimuth: 0.55,
                elevation: 0.4,
                targetOffset: [0, Math.max(1.2, (characterBounds?.size.y ?? 2) * 0.68), 0],
                positionDamping: 6.5,
                targetDamping: 9,
            });
            followCamera.setTarget(characterRig);
            locomotion.setCameraReference(camera.requireComponent(Transform));

            let orbiting = false;
            let pointerId = -1;
            let previousX = 0;
            let previousY = 0;

            const handlePointerDown = (event: PointerEvent) => {
                if (event.button !== 2 && event.button !== 1) {
                    return;
                }

                orbiting = true;
                pointerId = event.pointerId;
                previousX = event.clientX;
                previousY = event.clientY;
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
                followCamera.zoom(event.deltaY * 0.01);
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
                max: 16,
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
                min: 2,
                max: 20,
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