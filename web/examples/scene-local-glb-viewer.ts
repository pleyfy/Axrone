import { AssetDatabase, type AssetImporter } from '@axrone/asset-core';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import {
    createGltfImporter,
    type GltfAssetSchemaLike,
} from '@axrone/asset-gltf';
import {
    Animator,
    Camera,
    DirectionalLight,
    MeshRenderer,
    OrbitCameraController,
    Scene,
} from '@axrone/scene-3d';
import {
    loadGltfSceneIntoScene,
    type LoadGltfSceneIntoSceneResult,
} from '@axrone/scene-runtime-gltf';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

const LOCAL_GLTF_GROUND_SHADER_ID = 'examples/local-glb-viewer-ground';
const LOCAL_GLTF_GROUND_MATERIAL_ID = 'local-glb-viewer.ground-material';
const LOCAL_GLTF_GROUND_MESH_ID = 'local-glb-viewer.ground-mesh';
const LOCAL_GLTF_WHITE_TEXTURE_ID = 'local-glb-viewer.white-texture';

type SceneActor = ReturnType<Scene['createActor']>;

interface SceneBounds {
    readonly min: Vec3;
    readonly max: Vec3;
    readonly center: Vec3;
    readonly size: Vec3;
}

interface AnimatorRuntime {
    readonly animator: Animator;
    readonly clipIds: ReadonlySet<string>;
}

interface ClipEntry {
    readonly id: string;
    readonly duration: number | null;
    readonly animatorCount: number;
}

interface ViewerStage {
    readonly scene: Scene;
    readonly database: AssetDatabase<GltfAssetSchemaLike>;
    readonly orbit: OrbitCameraController;
    dispose(): void;
}

interface LoadedViewerState {
    readonly load: LoadGltfSceneIntoSceneResult;
    readonly animators: readonly AnimatorRuntime[];
    readonly clips: readonly ClipEntry[];
}

interface ViewerPanelHandle {
    readonly fileInput: HTMLInputElement;
    readonly dropZone: HTMLElement;
    readonly chooseButton: HTMLButtonElement;
    readonly playButton: HTMLButtonElement;
    readonly pauseButton: HTMLButtonElement;
    readonly stopButton: HTMLButtonElement;
    readonly speedInput: HTMLInputElement;
    setBusy(value: boolean): void;
    setStatus(next: string, tone?: 'neutral' | 'success' | 'error'): void;
    setSummary(next: string): void;
    setFileLabel(next: string): void;
    setSelectedClip(next: string | null): void;
    setSpeed(next: number): void;
    setClipEntries(
        clips: readonly ClipEntry[],
        selectedClipId: string | null,
        onSelect: (clipId: string) => void
    ): void;
    dispose(): void;
}

const syncButtonDisabledState = (button: HTMLButtonElement): void => {
    const disabled = button.disabled;
    button.style.opacity = disabled ? '0.55' : '1';
    button.style.cursor = disabled ? 'not-allowed' : 'pointer';
};

const createPanelButton = (label: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
        appearance: 'none',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        background: 'rgba(15, 23, 42, 0.72)',
        color: '#e2e8f0',
        borderRadius: '10px',
        padding: '10px 12px',
        fontSize: '12px',
        fontWeight: '600',
        letterSpacing: '0.02em',
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    button.addEventListener('mouseenter', () => {
        if (!button.disabled) {
            button.style.background = 'rgba(30, 41, 59, 0.94)';
            button.style.borderColor = 'rgba(125, 211, 252, 0.45)';
        }
    });

    button.addEventListener('mouseleave', () => {
        button.style.background = 'rgba(15, 23, 42, 0.72)';
        button.style.borderColor = 'rgba(148, 163, 184, 0.25)';
    });

    syncButtonDisabledState(button);

    return button;
};

const createViewerPanel = (shell: HTMLElement): ViewerPanelHandle => {
    const panel = document.createElement('section');
    Object.assign(panel.style, {
        position: 'absolute',
        top: '24px',
        left: '24px',
        width: '360px',
        maxHeight: 'calc(100% - 48px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '18px',
        borderRadius: '20px',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        background: 'rgba(2, 6, 23, 0.8)',
        backdropFilter: 'blur(14px)',
        color: '#e2e8f0',
        fontFamily: 'Consolas, "SFMono-Regular", ui-monospace, monospace',
        boxShadow: '0 22px 60px rgba(15, 23, 42, 0.38)',
        pointerEvents: 'auto',
        zIndex: '1',
    } satisfies Partial<CSSStyleDeclaration>);

    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'LOCAL GLB VIEWER';
    Object.assign(eyebrow.style, {
        fontSize: '11px',
        fontWeight: '700',
        letterSpacing: '0.16em',
        color: '#7dd3fc',
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = 'Upload a local animated model';
    Object.assign(title.style, {
        fontSize: '20px',
        lineHeight: '1.2',
        fontWeight: '700',
        color: '#f8fafc',
    } satisfies Partial<CSSStyleDeclaration>);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'The scene recenters your GLB on a plane, neutralizes imported materials, and lists animation clips for playback.';
    Object.assign(subtitle.style, {
        fontSize: '12px',
        lineHeight: '1.55',
        color: '#cbd5e1',
    } satisfies Partial<CSSStyleDeclaration>);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.glb,model/gltf-binary';
    fileInput.style.display = 'none';

    const chooseButton = createPanelButton('Choose GLB');
    Object.assign(chooseButton.style, {
        background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.96), rgba(37, 99, 235, 0.96))',
        border: 'none',
        color: '#eff6ff',
        boxShadow: '0 12px 26px rgba(14, 165, 233, 0.28)',
    } satisfies Partial<CSSStyleDeclaration>);

    const dropZone = document.createElement('label');
    Object.assign(dropZone.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        alignItems: 'stretch',
        padding: '16px',
        borderRadius: '16px',
        border: '1px dashed rgba(125, 211, 252, 0.35)',
        background: 'rgba(15, 23, 42, 0.54)',
        cursor: 'pointer',
        transition: 'border-color 120ms ease, background 120ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    const dropText = document.createElement('div');
    dropText.textContent = 'Drop a .glb file here or browse from disk.';
    Object.assign(dropText.style, {
        fontSize: '12px',
        lineHeight: '1.5',
        color: '#e2e8f0',
    } satisfies Partial<CSSStyleDeclaration>);

    const fileLabel = document.createElement('div');
    fileLabel.textContent = 'No file loaded yet.';
    Object.assign(fileLabel.style, {
        fontSize: '11px',
        color: '#94a3b8',
    } satisfies Partial<CSSStyleDeclaration>);

    dropZone.appendChild(chooseButton);
    dropZone.appendChild(dropText);
    dropZone.appendChild(fileLabel);
    dropZone.appendChild(fileInput);

    const status = document.createElement('div');
    status.textContent = 'Ready. Load a local GLB to inspect clips and preview animation.';
    Object.assign(status.style, {
        fontSize: '12px',
        lineHeight: '1.55',
        color: '#cbd5e1',
        whiteSpace: 'pre-wrap',
    } satisfies Partial<CSSStyleDeclaration>);

    const summary = document.createElement('div');
    summary.textContent = 'Scene is waiting for a model.';
    Object.assign(summary.style, {
        fontSize: '11px',
        color: '#7dd3fc',
        lineHeight: '1.45',
    } satisfies Partial<CSSStyleDeclaration>);

    const clipHeader = document.createElement('div');
    clipHeader.textContent = 'Animation Clips';
    Object.assign(clipHeader.style, {
        fontSize: '11px',
        fontWeight: '700',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#94a3b8',
    } satisfies Partial<CSSStyleDeclaration>);

    const selectedClip = document.createElement('div');
    selectedClip.textContent = 'Selected clip: none';
    Object.assign(selectedClip.style, {
        fontSize: '12px',
        lineHeight: '1.45',
        color: '#f8fafc',
    } satisfies Partial<CSSStyleDeclaration>);

    const clipList = document.createElement('div');
    Object.assign(clipList.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '240px',
        overflowY: 'auto',
        paddingRight: '4px',
    } satisfies Partial<CSSStyleDeclaration>);

    const controlsRow = document.createElement('div');
    Object.assign(controlsRow.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>);

    const playButton = createPanelButton('Play');
    const pauseButton = createPanelButton('Pause');
    const stopButton = createPanelButton('Stop');
    controlsRow.appendChild(playButton);
    controlsRow.appendChild(pauseButton);
    controlsRow.appendChild(stopButton);

    const speedRow = document.createElement('div');
    Object.assign(speedRow.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>);

    const speedHeader = document.createElement('div');
    Object.assign(speedHeader.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
    } satisfies Partial<CSSStyleDeclaration>);

    const speedLabel = document.createElement('span');
    speedLabel.textContent = 'Playback Speed';
    Object.assign(speedLabel.style, {
        fontSize: '11px',
        fontWeight: '700',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#94a3b8',
    } satisfies Partial<CSSStyleDeclaration>);

    const speedValue = document.createElement('span');
    speedValue.textContent = '1.00x';
    Object.assign(speedValue.style, {
        fontSize: '12px',
        color: '#e2e8f0',
    } satisfies Partial<CSSStyleDeclaration>);

    speedHeader.appendChild(speedLabel);
    speedHeader.appendChild(speedValue);

    const speedInput = document.createElement('input');
    speedInput.type = 'range';
    speedInput.min = '0';
    speedInput.max = '2.5';
    speedInput.step = '0.05';
    speedInput.value = '1';
    Object.assign(speedInput.style, {
        width: '100%',
        accentColor: '#38bdf8',
    } satisfies Partial<CSSStyleDeclaration>);

    speedRow.appendChild(speedHeader);
    speedRow.appendChild(speedInput);

    panel.appendChild(eyebrow);
    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(dropZone);
    panel.appendChild(status);
    panel.appendChild(summary);
    panel.appendChild(clipHeader);
    panel.appendChild(selectedClip);
    panel.appendChild(clipList);
    panel.appendChild(controlsRow);
    panel.appendChild(speedRow);

    shell.appendChild(panel);

    const placeholder = document.createElement('div');
    placeholder.textContent = 'No clips discovered in the current file.';
    Object.assign(placeholder.style, {
        fontSize: '12px',
        lineHeight: '1.5',
        color: '#64748b',
        padding: '12px 4px 4px 2px',
    } satisfies Partial<CSSStyleDeclaration>);
    clipList.appendChild(placeholder);

    chooseButton.addEventListener('click', (event) => {
        event.preventDefault();
        if (!chooseButton.disabled) {
            fileInput.click();
        }
    });

    return {
        fileInput,
        dropZone,
        chooseButton,
        playButton,
        pauseButton,
        stopButton,
        speedInput,
        setBusy(value: boolean) {
            chooseButton.disabled = value;
            playButton.disabled = value;
            pauseButton.disabled = value;
            stopButton.disabled = value;
            speedInput.disabled = value;
            syncButtonDisabledState(chooseButton);
            syncButtonDisabledState(playButton);
            syncButtonDisabledState(pauseButton);
            syncButtonDisabledState(stopButton);
            dropZone.style.opacity = value ? '0.82' : '1';
        },
        setStatus(next: string, tone: 'neutral' | 'success' | 'error' = 'neutral') {
            status.textContent = next;
            status.style.color =
                tone === 'error'
                    ? '#fca5a5'
                    : tone === 'success'
                      ? '#bbf7d0'
                      : '#cbd5e1';
        },
        setSummary(next: string) {
            summary.textContent = next;
        },
        setFileLabel(next: string) {
            fileLabel.textContent = next;
        },
        setSelectedClip(next: string | null) {
            selectedClip.textContent = `Selected clip: ${next ?? 'none'}`;
        },
        setSpeed(next: number) {
            speedInput.value = String(next);
            speedValue.textContent = `${next.toFixed(2)}x`;
        },
        setClipEntries(clips, selectedClipId, onSelect) {
            clipList.replaceChildren();

            if (clips.length === 0) {
                clipList.appendChild(placeholder);
                return;
            }

            for (const clip of clips) {
                const button = document.createElement('button');
                button.type = 'button';
                Object.assign(button.style, {
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '11px 12px',
                    borderRadius: '12px',
                    border: clip.id === selectedClipId
                        ? '1px solid rgba(56, 189, 248, 0.65)'
                        : '1px solid rgba(148, 163, 184, 0.18)',
                    background: clip.id === selectedClipId
                        ? 'rgba(8, 47, 73, 0.86)'
                        : 'rgba(15, 23, 42, 0.46)',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                } satisfies Partial<CSSStyleDeclaration>);

                const name = document.createElement('span');
                name.textContent = clip.id;
                Object.assign(name.style, {
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#f8fafc',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                } satisfies Partial<CSSStyleDeclaration>);

                const duration = document.createElement('span');
                duration.textContent =
                    clip.duration === null ? '--' : `${clip.duration.toFixed(2)}s`;
                Object.assign(duration.style, {
                    fontSize: '11px',
                    color: '#7dd3fc',
                } satisfies Partial<CSSStyleDeclaration>);

                const count = document.createElement('span');
                count.textContent = `${clip.animatorCount}x`;
                Object.assign(count.style, {
                    fontSize: '11px',
                    color: '#94a3b8',
                } satisfies Partial<CSSStyleDeclaration>);

                button.appendChild(name);
                button.appendChild(duration);
                button.appendChild(count);
                button.addEventListener('click', () => onSelect(clip.id));
                clipList.appendChild(button);
            }
        },
        dispose() {
            panel.remove();
        },
    };
};

const extractAnimatorClipEntries = (animator: Animator): readonly { id: string; duration: number | null }[] => {
    const serialized = animator.serialize() as {
        clips?: readonly { id?: unknown; duration?: unknown }[];
    };

    return (serialized.clips ?? [])
        .map((clip) => ({
            id: typeof clip.id === 'string' ? clip.id : null,
            duration:
                typeof clip.duration === 'number' && Number.isFinite(clip.duration)
                    ? clip.duration
                    : null,
        }))
        .filter((clip): clip is { id: string; duration: number | null } => clip.id !== null);
};

const collectAnimatorRuntimes = (
    actors: readonly SceneActor[]
): readonly AnimatorRuntime[] =>
    actors
        .map((actor) => actor.getComponent(Animator))
        .filter((animator): animator is Animator => animator !== undefined)
        .map((animator) => {
            const clipIds = new Set(extractAnimatorClipEntries(animator).map((clip) => clip.id));
            return {
                animator,
                clipIds,
            } satisfies AnimatorRuntime;
        });

const collectClipEntries = (
    animators: readonly AnimatorRuntime[]
): readonly ClipEntry[] => {
    const entries = new Map<string, ClipEntry>();

    for (const runtime of animators) {
        for (const clip of extractAnimatorClipEntries(runtime.animator)) {
            const existing = entries.get(clip.id);
            if (existing) {
                entries.set(clip.id, {
                    id: clip.id,
                    duration: existing.duration ?? clip.duration,
                    animatorCount: existing.animatorCount + 1,
                });
                continue;
            }

            entries.set(clip.id, {
                id: clip.id,
                duration: clip.duration,
                animatorCount: 1,
            });
        }
    }

    return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
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
    actors: readonly SceneActor[]
): SceneActor => {
    const container = scene.createActor({ name: 'UploadedModelRoot' });
    const containerTransform = container.requireComponent(Transform);

    for (const rootTransform of collectImportedRootTransforms(actors)) {
        rootTransform.parent = containerTransform;
    }

    return container;
};

const fitImportedModelToViewer = (
    actors: readonly SceneActor[],
    container: SceneActor,
    database: AssetDatabase<GltfAssetSchemaLike>
): SceneBounds | null => {
    const containerTransform = container.requireComponent(Transform);
    const initialBounds = computeActorsBounds(actors, database);

    if (!initialBounds) {
        containerTransform.position = Vec3.ZERO.clone();
        return null;
    }

    if (initialBounds.size.y > 1e-5) {
        const scale = 3.2 / initialBounds.size.y;
        containerTransform.scale = new Vec3(scale, scale, scale);
    }

    const scaledBounds = computeActorsBounds(actors, database);
    if (!scaledBounds) {
        return null;
    }

    containerTransform.position = new Vec3(
        -scaledBounds.center.x,
        -scaledBounds.min.y,
        -scaledBounds.center.z
    );

    return computeActorsBounds(actors, database);
};

const registerGroundAssets = (scene: Scene): void => {
    scene.registerShader({
        id: LOCAL_GLTF_GROUND_SHADER_ID,
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
    vec2 gridUv = v_UV0 * 18.0;
    vec2 cell = abs(fract(gridUv - 0.5) - 0.5) / fwidth(gridUv);
    float line = 1.0 - min(min(cell.x, cell.y), 1.0);
    float radial = clamp(length(v_UV0 - 0.5) * 1.45, 0.0, 1.0);
    float diffuse = max(dot(normalize(v_WorldNormal), normalize(-u_LightDirection)), 0.0);
    vec3 base = mix(mix(u_BaseColor, u_LineColor, line * 0.55), u_FadeColor, radial * 0.45);
    vec3 lit = base * (0.42 + diffuse * 0.58);
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

    scene.createPlaneMesh(LOCAL_GLTF_GROUND_MESH_ID, 36, 36);
    scene.createMaterial({
        id: LOCAL_GLTF_GROUND_MATERIAL_ID,
        shaderId: LOCAL_GLTF_GROUND_SHADER_ID,
        uniforms: {
            u_LightDirection: [-0.45, -0.9, -0.24],
            u_BaseColor: [0.11, 0.13, 0.16],
            u_LineColor: [0.76, 0.83, 0.92],
            u_FadeColor: [0.04, 0.06, 0.08],
        },
    });
};

const createGround = (scene: Scene): void => {
    registerGroundAssets(scene);
    const ground = scene.createRenderableActor(
        { name: 'GroundPlane' },
        {
            meshId: LOCAL_GLTF_GROUND_MESH_ID,
            materialId: LOCAL_GLTF_GROUND_MATERIAL_ID,
        }
    );
    ground.requireComponent(Transform).position = new Vec3(0, -0.01, 0);
};

const createLighting = (scene: Scene): void => {
    const keyLight = scene.createActor({ name: 'ViewerKeyLight' });
    keyLight.addComponent(DirectionalLight, {
        color: [1, 0.97, 0.93],
        intensity: 1.35,
        primary: true,
    });
    keyLight.requireComponent(Transform).position = new Vec3(8, 10, 6);
};

const registerViewerTextures = async (scene: Scene): Promise<void> => {
    await scene.registerTexture({
        id: LOCAL_GLTF_WHITE_TEXTURE_ID,
        source: {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [255, 255, 255, 255],
        },
        generateMipmaps: false,
    });
};

const createViewerStage = async (sceneHost: HTMLElement): Promise<ViewerStage> => {
    sceneHost.replaceChildren();

    const viewportWidth = sceneHost.clientWidth || 960;
    const viewportHeight = sceneHost.clientHeight || 540;
    const scene = new Scene({
        width: viewportWidth,
        height: viewportHeight,
        autoStart: true,
        parent: sceneHost,
        appendToDom: true,
        createCanvas: () => document.createElement('canvas'),
        clearColor: [0.02, 0.03, 0.05, 1],
        ambientLight: [0.24, 0.24, 0.26],
    });
    const cleanupResize = bindSceneToContainer(
        scene,
        sceneHost,
        viewportWidth,
        viewportHeight
    );

    const database = new AssetDatabase<GltfAssetSchemaLike>({
        importers: [
            createGltfImporter<GltfAssetSchemaLike>() as AssetImporter<GltfAssetSchemaLike>,
        ],
    });

    createGround(scene);
    createLighting(scene);
    await registerViewerTextures(scene);

    const camera = scene.createCameraActor(
        { name: 'ViewerCamera' },
        { primary: true, fieldOfView: 46, near: 0.1, far: 1000 }
    );
    const orbit = camera.addComponent(OrbitCameraController, {
        target: [0, 1.1, 0],
        distance: 6.8,
        minDistance: 1.4,
        maxDistance: 512,
        azimuth: 0.52,
        elevation: 0.22,
        autoRotateSpeed: 0.24,
    });

    return {
        scene,
        database,
        orbit,
        dispose() {
            cleanupResize();
            database.dispose();
            scene.dispose();
            sceneHost.replaceChildren();
        },
    };
};

const neutralizeImportedMaterials = (
    scene: Scene,
    load: LoadGltfSceneIntoSceneResult
): void => {
    for (const materialKey of load.prefab.data.materialKeys) {
        scene.setMaterialUniform(materialKey, '_BaseColorFactor', [0.84, 0.84, 0.86, 1]);
        scene.setMaterialUniform(materialKey, '_MetallicFactor', 0.04);
        scene.setMaterialUniform(materialKey, '_RoughnessFactor', 0.94);
        scene.setMaterialUniform(materialKey, '_EmissiveFactor', [0, 0, 0]);

        const material = scene.getMaterial(materialKey);
        if (material?.textureBindings.includes('_BaseColorTexture')) {
            scene.setMaterialTexture(materialKey, '_BaseColorTexture', LOCAL_GLTF_WHITE_TEXTURE_ID);
        }
    }
};

const frameImportedScene = (
    stage: ViewerStage,
    load: LoadGltfSceneIntoSceneResult
): SceneBounds | null => {
    const container = createImportedModelContainer(stage.scene, load.actors as readonly SceneActor[]);
    const fittedBounds = fitImportedModelToViewer(
        load.actors as readonly SceneActor[],
        container,
        stage.database
    );

    if (!fittedBounds) {
        stage.orbit.target = [0, 1.1, 0];
        stage.orbit.distance = 6.8;
        return null;
    }

    const target = new Vec3(
        0,
        fittedBounds.center.y + Math.max(0.2, fittedBounds.size.y * 0.08),
        0
    );
    const radius = Math.max(
        0.85,
        Math.hypot(fittedBounds.size.x, fittedBounds.size.y, fittedBounds.size.z) * 0.5
    );

    stage.orbit.target = [target.x, target.y, target.z];
    stage.orbit.distance = Math.max(3.2, radius * 2.35);
    stage.orbit.azimuth = 0.56;
    stage.orbit.elevation = 0.2;

    return fittedBounds;
};

const loadFileIntoStage = async (
    stage: ViewerStage,
    file: File
): Promise<LoadedViewerState> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const receipt = await stage.database.import({
        kind: 'bytes',
        data: bytes,
        uri: file.name,
        mimeType: file.type || 'model/gltf-binary',
    });

    const load = await loadGltfSceneIntoScene(
        stage.scene,
        stage.database,
        { key: receipt.primary.key, kind: 'gltf.document' },
        { clearExisting: false, namePrefix: 'Upload ' }
    );

    for (const actor of load.actors) {
        const importedCamera = actor.getComponent(Camera);
        if (importedCamera) {
            importedCamera.primary = false;
        }
    }

    neutralizeImportedMaterials(stage.scene, load);
    frameImportedScene(stage, load);

    const animators = collectAnimatorRuntimes(load.actors as readonly SceneActor[]);
    const clips = collectClipEntries(animators);

    return {
        load,
        animators,
        clips,
    };
};

const applyClipSelection = (
    animators: readonly AnimatorRuntime[],
    clipId: string,
    speed: number,
    autoplay: boolean
): void => {
    for (const runtime of animators) {
        if (!runtime.clipIds.has(clipId)) {
            continue;
        }

        runtime.animator.loop = true;
        runtime.animator.speed = speed;
        runtime.animator.clipId = clipId;

        if (autoplay) {
            runtime.animator.play(clipId);
            continue;
        }

        runtime.animator.stop(true);
    }
};

const summarizeDiagnostics = (diagnostics: readonly { level: string; code: string }[]): string => {
    const compact = diagnostics.slice(0, 3).map((entry) => `${entry.level.toUpperCase()} ${entry.code}`);
    return compact.length > 0 ? `\n${compact.join('\n')}` : '';
};

const localGlbViewerExample: SceneExample = {
    id: 'scene-local-glb-viewer',
    title: 'Scene Local GLB Viewer',
    description: 'Loads a local GLB, recenters it over a ground plane, applies neutral default shading, and lets you preview animation clips with an orbiting camera.',
    tags: ['scene', 'gltf', 'glb', 'animation', 'local', 'viewer'],
    order: 11,
    async mount({ container }: ExampleContext) {
        container.replaceChildren();

        const shell = document.createElement('div');
        Object.assign(shell.style, {
            position: 'relative',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
        } satisfies Partial<CSSStyleDeclaration>);

        const sceneHost = document.createElement('div');
        Object.assign(sceneHost.style, {
            width: '100%',
            height: '100%',
        } satisfies Partial<CSSStyleDeclaration>);

        shell.appendChild(sceneHost);
        container.appendChild(shell);

        const panel = createViewerPanel(shell);
        let destroyed = false;
        let loadToken = 0;
        let stage: ViewerStage | null = null;
        let animators: readonly AnimatorRuntime[] = [];
        let selectedClipId: string | null = null;
        let currentSpeed = 1;

        const syncClipUi = (clips: readonly ClipEntry[]) => {
            panel.setClipEntries(clips, selectedClipId, (clipId) => {
                selectedClipId = clipId;
                panel.setSelectedClip(selectedClipId);
                applyClipSelection(animators, clipId, currentSpeed, true);
                panel.setStatus(`Playing '${clipId}' on ${animators.filter((entry) => entry.clipIds.has(clipId)).length} animator(s).`, 'success');
                syncClipUi(clips);
            });

            panel.playButton.disabled = selectedClipId === null || animators.length === 0;
            panel.pauseButton.disabled = animators.length === 0;
            panel.stopButton.disabled = animators.length === 0;
            syncButtonDisabledState(panel.playButton);
            syncButtonDisabledState(panel.pauseButton);
            syncButtonDisabledState(panel.stopButton);
        };

        const rebuildStage = async (file: File | null): Promise<void> => {
            const token = ++loadToken;
            panel.setBusy(true);
            selectedClipId = null;
            animators = [];
            panel.setSelectedClip(null);
            panel.setSummary(file ? 'Preparing fresh viewer stage...' : 'Viewer ready.');
            syncClipUi([]);

            const previousStage = stage;
            stage = null;
            previousStage?.dispose();

            const nextStage = await createViewerStage(sceneHost);
            if (destroyed || token !== loadToken) {
                nextStage.dispose();
                return;
            }

            stage = nextStage;

            if (!file) {
                panel.setBusy(false);
                panel.setStatus('Ready. Load a local GLB to inspect clips and preview animation.', 'neutral');
                panel.setSummary('Auto-orbit camera is active over the empty ground stage.');
                panel.setFileLabel('No file loaded yet.');
                return;
            }

            panel.setStatus(`Loading ${file.name}...`, 'neutral');
            panel.setSummary('Importing local bytes through the Axrone glTF pipeline.');
            panel.setFileLabel(`${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`);

            try {
                const loaded = await loadFileIntoStage(nextStage, file);
                if (destroyed || token !== loadToken) {
                    return;
                }

                animators = loaded.animators;
                currentSpeed = Number(panel.speedInput.value) || 1;

                if (loaded.clips.length > 0) {
                    selectedClipId = loaded.clips[0]!.id;
                    applyClipSelection(animators, selectedClipId, currentSpeed, false);
                }

                syncClipUi(loaded.clips);
                panel.setSelectedClip(selectedClipId);
                panel.setSummary(
                    `Loaded ${loaded.load.actors.length} actors, ${loaded.load.prefab.data.materialKeys.length} material(s), and ${loaded.clips.length} clip(s).`
                );
                panel.setStatus(
                    loaded.clips.length > 0
                        ? `Imported successfully. Pick a clip or press Play to start.${summarizeDiagnostics(loaded.load.diagnostics)}`
                        : `Imported successfully, but this file does not expose animation clips.${summarizeDiagnostics(loaded.load.diagnostics)}`,
                    'success'
                );
            } catch (error) {
                if (destroyed || token !== loadToken) {
                    return;
                }

                const message = error instanceof Error ? error.message : String(error);
                panel.setStatus(`Local GLB load failed.\n${message}`, 'error');
                panel.setSummary('The viewer stage is still alive; choose another file to retry.');
                panel.setSelectedClip(null);
                syncClipUi([]);
            } finally {
                if (!destroyed && token === loadToken) {
                    panel.setBusy(false);
                    panel.setSpeed(currentSpeed);
                }
            }
        };

        const handleFile = async (file: File | null | undefined) => {
            if (!file) {
                return;
            }

            const normalizedName = file.name.trim().toLowerCase();
            if (!normalizedName.endsWith('.glb')) {
                panel.setStatus('Only local .glb files are enabled in this viewer for now.', 'error');
                return;
            }

            await rebuildStage(file);
        };

        panel.fileInput.addEventListener('change', async () => {
            const file = panel.fileInput.files?.[0];
            panel.fileInput.value = '';
            await handleFile(file);
        });

        const setDropActive = (active: boolean) => {
            panel.dropZone.style.borderColor = active
                ? 'rgba(56, 189, 248, 0.72)'
                : 'rgba(125, 211, 252, 0.35)';
            panel.dropZone.style.background = active
                ? 'rgba(8, 47, 73, 0.58)'
                : 'rgba(15, 23, 42, 0.54)';
        };

        panel.dropZone.addEventListener('dragover', (event) => {
            event.preventDefault();
            setDropActive(true);
        });
        panel.dropZone.addEventListener('dragenter', (event) => {
            event.preventDefault();
            setDropActive(true);
        });
        panel.dropZone.addEventListener('dragleave', (event) => {
            if (!panel.dropZone.contains(event.relatedTarget as Node | null)) {
                setDropActive(false);
            }
        });
        panel.dropZone.addEventListener('drop', async (event) => {
            event.preventDefault();
            setDropActive(false);
            await handleFile(event.dataTransfer?.files?.[0]);
        });

        panel.playButton.addEventListener('click', () => {
            if (!selectedClipId) {
                return;
            }

            applyClipSelection(animators, selectedClipId, currentSpeed, true);
            panel.setStatus(`Playing '${selectedClipId}'.`, 'success');
        });

        panel.pauseButton.addEventListener('click', () => {
            for (const runtime of animators) {
                runtime.animator.pause();
            }

            panel.setStatus('Playback paused.', 'neutral');
        });

        panel.stopButton.addEventListener('click', () => {
            for (const runtime of animators) {
                runtime.animator.stop(true);
            }

            panel.setStatus('Playback stopped and rewound to frame 0.', 'neutral');
        });

        panel.speedInput.addEventListener('input', () => {
            currentSpeed = Number(panel.speedInput.value) || 1;
            panel.setSpeed(currentSpeed);

            for (const runtime of animators) {
                runtime.animator.speed = currentSpeed;
            }
        });

        panel.setSpeed(currentSpeed);
        await rebuildStage(null);

        return {
            dispose() {
                destroyed = true;
                stage?.dispose();
                panel.dispose();
                container.replaceChildren();
            },
        };
    },
};

export default localGlbViewerExample;