import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { Color, Scene2D, SpriteRenderer, createSpriteAtlas } from '@axrone/scene-2d';
import type { ExampleContext, SceneExample } from './example-types';

const bindScene2DToContainer = (
    scene: Pick<Scene2D, 'resize'>,
    container: HTMLElement,
    fallbackWidth: number,
    fallbackHeight: number
): (() => void) => {
    const resize = () => {
        const rect = container.getBoundingClientRect();
        scene.resize(
            Math.max(1, Math.floor(rect.width || fallbackWidth)),
            Math.max(1, Math.floor(rect.height || fallbackHeight))
        );
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

const setPixel = (
    data: Uint8Array,
    width: number,
    x: number,
    y: number,
    rgba: readonly [number, number, number, number]
): void => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
};

const createNineSliceAtlasTexture = (): number[] => {
    const width = 36;
    const height = 18;
    const data = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const frameOffset = x < 18 ? 0 : 18;
            const localX = x - frameOffset;
            const border = localX < 3 || localX >= 15 || y < 3 || y >= 15;
            const corner = (localX < 3 || localX >= 15) && (y < 3 || y >= 15);
            const warm = frameOffset === 0;

            let pixel: readonly [number, number, number, number];
            if (corner) {
                pixel = warm ? [255, 214, 102, 255] : [125, 211, 252, 255];
            } else if (border) {
                pixel = warm ? [166, 95, 46, 240] : [30, 64, 175, 240];
            } else {
                pixel = warm ? [52, 24, 12, 210] : [15, 23, 42, 210];
            }

            setPixel(data, width, x, y, pixel);
        }
    }

    return Array.from(data);
};

const scene2DNineSliceExample: SceneExample = {
    id: 'scene-2d-nine-slice',
    title: 'Scene 2D Nine Slice Panels',
    description:
        'Demonstrates slice-border metadata flowing from atlas frames into live nine-slice panel scaling in the new 2D renderer.',
    tags: ['scene-2d', 'nine-slice', 'ui-panel', 'sprite'],
    order: 7,
    async mount({ container }: ExampleContext) {
        container.replaceChildren();

        const scene = new Scene2D({
            width: container.clientWidth || 960,
            height: container.clientHeight || 540,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
        });

        const cleanupResize = bindScene2DToContainer(scene, container, 960, 540);

        await scene.registerTexture({
            id: 'scene2d.panel-atlas',
            source: {
                kind: 'data',
                width: 36,
                height: 18,
                channels: 4,
                data: createNineSliceAtlasTexture(),
            },
            generateMipmaps: false,
        });

        const atlas = createSpriteAtlas({
            id: 'scene2d.panel',
            textureId: 'scene2d.panel-atlas',
            textureSize: { width: 36, height: 18 },
            frames: [
                {
                    id: 'panel/warm',
                    region: { x: 0, y: 0, width: 18, height: 18 },
                    sourceSize: { width: 3, height: 3 },
                    sliceBorder: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
                },
                {
                    id: 'panel/cool',
                    region: { x: 18, y: 0, width: 18, height: 18 },
                    sourceSize: { width: 3, height: 3 },
                    sliceBorder: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
                },
            ],
        });

        scene.createCameraActor(
            { name: 'Scene2DCamera' },
            {
                primary: true,
                orthographic: true,
                orthographicSize: 5.5,
                clearColor: [0.04, 0.05, 0.08, 1],
            }
        );

        const warmPanel = scene.createSpriteActor(
            { name: 'WarmPanel' },
            {
                frame: atlas.getFrame('panel/warm')!,
                size: [4.2, 2.8],
                color: Color.fromHex('#ffd166ff'),
            }
        );
        warmPanel.getComponent(Transform)!.position = new Vec3(-3.2, 0.8, 0);

        const coolPanel = scene.createSpriteActor(
            { name: 'CoolPanel' },
            {
                frame: atlas.getFrame('panel/cool')!,
                size: [5.6, 3.4],
                color: Color.fromHex('#8ecae6ff'),
            }
        );
        coolPanel.getComponent(Transform)!.position = new Vec3(0, -0.1, 0);

        const accentPanel = scene.createSpriteActor(
            { name: 'AccentPanel' },
            {
                frame: atlas.getFrame('panel/warm')!,
                size: [3.4, 2.2],
                color: Color.fromHex('#ef476fff'),
            }
        );
        accentPanel.getComponent(Transform)!.position = new Vec3(3.2, 1.1, 0);

        const panels = [
            warmPanel.getComponent(SpriteRenderer)!,
            coolPanel.getComponent(SpriteRenderer)!,
            accentPanel.getComponent(SpriteRenderer)!,
        ];

        let frameHandle = 0;
        const startTime = performance.now();
        const animate = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            panels[0]!.setSize(4.2 + Math.sin(elapsed * 1.2) * 1.8, 2.8 + Math.cos(elapsed * 1.6) * 0.5);
            panels[1]!.setSize(5.6 + Math.cos(elapsed * 0.9) * 2.2, 3.4 + Math.sin(elapsed * 1.4) * 0.9);
            panels[2]!.setSize(3.4 + Math.sin(elapsed * 1.8) * 1.1, 2.2 + Math.cos(elapsed * 1.3) * 0.4);
            frameHandle = globalThis.requestAnimationFrame(animate);
        };

        frameHandle = globalThis.requestAnimationFrame(animate);

        return {
            dispose() {
                globalThis.cancelAnimationFrame(frameHandle);
                cleanupResize();
                scene.dispose();
            },
        };
    },
};

export default scene2DNineSliceExample;