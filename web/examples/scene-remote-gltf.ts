import {
    AssetDatabase,
    Camera,
    DirectionalLight,
    MeshRenderer,
    OrbitCameraController,
    Scene,
    Transform,
    createGltfImporter,
    loadGltfSceneIntoScene,
    type AssetImporter,
    type GltfAssetSchemaLike,
} from '@axrone/core';
import { Vec3 } from '@axrone/numeric';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

const REMOTE_GLTF_URL =
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb';

const createStatusPanel = (container: HTMLElement) => {
    const panel = document.createElement('div');
    panel.style.position = 'absolute';
    panel.style.top = '24px';
    panel.style.left = '24px';
    panel.style.width = '360px';
    panel.style.padding = '16px 18px';
    panel.style.borderRadius = '18px';
    panel.style.border = '1px solid rgba(56, 189, 248, 0.45)';
    panel.style.background = 'rgba(15, 23, 42, 0.82)';
    panel.style.backdropFilter = 'blur(10px)';
    panel.style.color = '#e2e8f0';
    panel.style.fontFamily = 'ui-monospace, SFMono-Regular, Consolas, monospace';
    panel.style.pointerEvents = 'none';

    const title = document.createElement('div');
    title.textContent = 'REMOTE GLTF';
    title.style.fontSize = '18px';
    title.style.fontWeight = '700';
    title.style.letterSpacing = '0.08em';
    title.style.marginBottom = '10px';

    const url = document.createElement('div');
    url.textContent = REMOTE_GLTF_URL;
    url.style.fontSize = '11px';
    url.style.lineHeight = '1.45';
    url.style.color = '#7dd3fc';
    url.style.marginBottom = '10px';
    url.style.wordBreak = 'break-word';

    const status = document.createElement('div');
    status.style.fontSize = '12px';
    status.style.lineHeight = '1.5';
    status.style.whiteSpace = 'pre-wrap';
    status.textContent = 'Fetching remote GLB...';

    panel.appendChild(title);
    panel.appendChild(url);
    panel.appendChild(status);
    container.appendChild(panel);

    return {
        setStatus(next: string, color = '#cbd5e1') {
            status.textContent = next;
            status.style.color = color;
        },
        dispose() {
            panel.remove();
        },
    };
};

const sceneRemoteGltfExample: SceneExample = {
    id: 'scene-remote-gltf',
    title: 'Scene Remote GLTF',
    description: 'Fetches a remote GLB over HTTP, imports it through Axrone glTF pipeline, and instantiates it into the live scene.',
    tags: ['scene', 'gltf', 'remote', 'asset'],
    order: 10,
    async mount({ container }: ExampleContext) {
        container.replaceChildren();

        const shell = document.createElement('div');
        shell.style.position = 'relative';
        shell.style.width = '100%';
        shell.style.height = '100%';

        const sceneHost = document.createElement('div');
        sceneHost.style.width = '100%';
        sceneHost.style.height = '100%';

        const viewportWidth = sceneHost.clientWidth || 960;
        const viewportHeight = sceneHost.clientHeight || 540;

        shell.appendChild(sceneHost);
        container.appendChild(shell);

        const overlay = createStatusPanel(shell);
        const scene = new Scene({
            width: viewportWidth,
            height: viewportHeight,
            autoStart: true,
            parent: sceneHost,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
            clearColor: [0.03, 0.04, 0.07, 1],
            ambientLight: [0.22, 0.22, 0.24],
        });
        const cleanupResize = bindSceneToContainer(scene, sceneHost, viewportWidth, viewportHeight);
        const database = new AssetDatabase<GltfAssetSchemaLike>({
            importers: [
                createGltfImporter<GltfAssetSchemaLike>() as AssetImporter<GltfAssetSchemaLike>,
            ],
        });

        try {
            const response = await fetch(REMOTE_GLTF_URL, { mode: 'cors' });
            if (!response.ok) {
                throw new Error(`Remote fetch failed with status ${response.status}`);
            }

            const bytes = new Uint8Array(await response.arrayBuffer());
            overlay.setStatus(`Downloaded ${bytes.byteLength} bytes. Importing GLB...`, '#cbd5e1');

            const receipt = await database.import({
                kind: 'bytes',
                data: bytes,
                uri: REMOTE_GLTF_URL,
                mimeType: 'model/gltf-binary',
            });

            const load = await loadGltfSceneIntoScene(
                scene,
                database,
                { key: receipt.primary.key, kind: 'gltf.document' },
                {
                    namePrefix: 'Remote ',
                }
            );

            for (const actor of load.actors) {
                const importedCamera = actor.getComponent(Camera);
                if (importedCamera) {
                    importedCamera.primary = false;
                }
            }

            const computeSceneBounds = () => {
                let minX = Number.POSITIVE_INFINITY;
                let minY = Number.POSITIVE_INFINITY;
                let minZ = Number.POSITIVE_INFINITY;
                let maxX = Number.NEGATIVE_INFINITY;
                let maxY = Number.NEGATIVE_INFINITY;
                let maxZ = Number.NEGATIVE_INFINITY;
                let found = false;

                for (const actor of load.actors) {
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

            const bounds = computeSceneBounds();
            const fieldOfView = 48;
            const aspect = Math.max(0.1, viewportWidth / Math.max(1, viewportHeight));
            const verticalHalfFov = (fieldOfView * Math.PI) / 360;
            const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
            const framingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
            const target = bounds
                ? new Vec3(
                      bounds.center.x,
                      bounds.min.y + bounds.size.y * 0.45,
                      bounds.center.z
                  )
                : new Vec3(0, 0.45, 0);
            const radius = bounds
                ? Math.max(0.8, Math.hypot(bounds.size.x, bounds.size.y, bounds.size.z) * 0.5)
                : 1.2;
            const distance = bounds
                ? (radius / Math.sin(framingHalfFov)) * 1.15
                : 4.2;
            const near = Math.max(0.1, radius * 0.02);
            const far = Math.max(1000, distance + radius * 8);

            const camera = scene.createCameraActor(
                { name: 'RemoteCamera' },
                { primary: true, fieldOfView, near, far }
            );
            camera.addComponent(OrbitCameraController, {
                target: [target.x, target.y, target.z],
                distance,
                minDistance: Math.max(1, radius * 0.35),
                maxDistance: Math.max(64, distance * 1.8),
                azimuth: 0.52,
                elevation: 0.16,
                autoRotateSpeed: 0,
            });

            const sun = scene.createActor({ name: 'RemoteSun' });
            sun.addComponent(DirectionalLight, {
                color: [1, 0.97, 0.92],
                intensity: 1.2,
                primary: true,
            });
            sun.requireComponent(Transform).position = new Vec3(2.5, 4.5, 1.5);

            const diagnostics = load.diagnostics
                .slice(0, 4)
                .map((entry) => `${entry.level.toUpperCase()} ${entry.code}`)
                .join('\n');
            const suffix = diagnostics.length > 0 ? `\n${diagnostics}` : '\nNo importer warnings.';

            overlay.setStatus(
                `Loaded ${load.actors.length} actors from remote GLB.\nYou can feed Axrone a direct internet .glb URL as long as the host allows CORS.${suffix}`,
                '#e2e8f0'
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            overlay.setStatus(
                `Remote glTF load failed.\n${message}\nThis path works for direct .glb URLs when the remote host allows CORS.`,
                '#fca5a5'
            );
        }

        return {
            dispose() {
                cleanupResize();
                overlay.dispose();
                database.dispose();
                scene.dispose();
                container.replaceChildren();
            },
        };
    },
};

export default sceneRemoteGltfExample;