import { Scene, Transform, Vec3 } from '@axrone/core';
import { UIRuntime } from '@axrone/ui';
import { attachUIOverlayToScene } from '@axrone/ui-webgl2';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

const createFontAsset = () => ({
    family: 'OverlaySans',
    face: 'Regular',
    style: 'normal' as const,
    weight: 400 as const,
    ascent: 800,
    descent: 200,
    lineGap: 0,
    unitsPerEm: 1000,
    defaultAdvance: 500,
    fallbackCodePoint: 63,
    glyphs: [32, 35, 45, 58, 65, 70, 79, 82, 84, 85, 97, 99, 100, 101, 102, 103, 104, 105, 108, 109, 110, 111, 112, 114, 115, 116, 117, 121].map(
        (codePoint) => ({
            codePoint,
            advance: codePoint === 32 ? 240 : 520,
            width: codePoint === 32 ? 1 : 480,
            height: codePoint === 32 ? 1 : 720,
        })
    ),
});

const sceneUiOverlayExample: SceneExample = {
    id: 'scene-ui-overlay',
    title: 'Scene UI Overlay',
    description:
        'Binds the retained UI runtime into the live Scene after-frame phase so overlays stay modular and render on top of the 3D scene.',
    tags: ['scene', 'ui', 'overlay', 'webgl2'],
    order: 5,
    mount({ container }: ExampleContext) {
        container.replaceChildren();

        const scene = new Scene({
            width: container.clientWidth || 960,
            height: container.clientHeight || 540,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
        });

        scene.createBoxMesh('overlay-demo-box');
        scene.createMaterial({
            id: 'overlay-demo-material',
            shaderId: 'scene/default',
            uniforms: {
                u_Color: [0.18, 0.58, 0.96, 1],
            },
        });

        scene.createCameraActor({ name: 'OverlayCamera' }, { primary: true, fieldOfView: 60 });

        const cube = scene.createRenderableActor(
            { name: 'OverlayCube' },
            { meshId: 'overlay-demo-box', materialId: 'overlay-demo-material' }
        );
        cube.requireComponent(Transform).position = new Vec3(0, 0, -4);

        const runtime = new UIRuntime({ width: scene.canvas.width, height: scene.canvas.height });
        runtime.fonts.registerFace(createFontAsset());

        const panel = runtime.createWidget({
            layout: {
                position: 'absolute',
                anchor: 'top-left',
                inset: { top: 24, left: 24 },
                width: 320,
                height: 132,
                padding: 18,
                display: 'stack',
                direction: 'column',
                gap: 10,
            },
            style: {
                background: '#0f172acc',
                borderColor: '#38bdf8aa',
                borderWidth: 1,
                radius: 18,
            },
        });
        const title = runtime.createWidget({
            text: {
                value: 'Axrone UI Overlay',
                family: 'OverlaySans',
                size: 22,
            },
            style: { color: '#f8fafcff' },
            layout: { height: 28 },
        });
        const caption = runtime.createWidget({
            text: {
                value: 'Scene.loop.afterFrame uzerinden ciziliyor',
                family: 'OverlaySans',
                size: 14,
            },
            style: { color: '#cbd5e1ff' },
            layout: { height: 20 },
        });
        const stats = runtime.createWidget({
            text: {
                value: 'Frame 0  Draws 0',
                family: 'OverlaySans',
                size: 14,
            },
            style: { color: '#7dd3fcff' },
            layout: { height: 20 },
        });

        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, title);
        runtime.appendChild(panel, caption);
        runtime.appendChild(panel, stats);

        const cleanupResize = bindSceneToContainer(scene, container, 960, 540);
        const overlay = attachUIOverlayToScene(scene, {
            ui: () => runtime.commit({ width: scene.canvas.width, height: scene.canvas.height }),
            priority: -1000,
        });

        scene.loop.addSystem({
            id: 'scene-ui-overlay.stats',
            priority: 100,
            enabled: true,
            update() {
                const angle = performance.now() * 0.001;
                cube.requireComponent(Transform).rotation.setFromEuler(0, angle, angle * 0.5);
            },
            afterFrame(context) {
                runtime.updateWidget(stats, {
                    text: {
                        value: `Frame ${context.frame}  Draws ${scene.renderStats.drawCalls}`,
                    },
                });
            },
        });

        const root = globalThis as { scene?: Scene; uiRuntime?: UIRuntime };
        root.scene = scene;
        root.uiRuntime = runtime;

        return {
            dispose() {
                cleanupResize();
                overlay.dispose();
                scene.loop.removeSystem('scene-ui-overlay.stats');
                if (root.scene === scene) {
                    delete root.scene;
                }
                if (root.uiRuntime === runtime) {
                    delete root.uiRuntime;
                }
                runtime.dispose();
                scene.dispose();
                container.replaceChildren();
            },
        };
    },
};

export default sceneUiOverlayExample;