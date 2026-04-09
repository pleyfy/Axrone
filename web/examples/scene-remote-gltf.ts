import {
    AssetDatabase,
    Camera,
    DirectionalLight,
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

        shell.appendChild(sceneHost);
        container.appendChild(shell);

        const overlay = createStatusPanel(shell);
        const scene = new Scene({
            width: sceneHost.clientWidth || 960,
            height: sceneHost.clientHeight || 540,
            autoStart: true,
            parent: sceneHost,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
            clearColor: [0.03, 0.04, 0.07, 1],
            ambientLight: [0.22, 0.22, 0.24],
        });
        const cleanupResize = bindSceneToContainer(scene, sceneHost, 960, 540);
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

            const camera = scene.createCameraActor({ name: 'RemoteCamera' }, { primary: true, fieldOfView: 48 });
            camera.addComponent(OrbitCameraController, {
                target: [0, 0.45, 0],
                distance: 4.2,
                azimuth: 0.35,
                elevation: 0.28,
                autoRotateSpeed: 0.18,
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