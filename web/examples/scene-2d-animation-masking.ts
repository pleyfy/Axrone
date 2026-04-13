import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { Color, Scene2D, createSpriteAtlas } from '@axrone/scene-2d';
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

const createHeroAtlasTexture = (): number[] => {
    const width = 64;
    const height = 32;
    const data = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const frameIndex = x < 32 ? 0 : 1;
            const localX = x % 32;
            const localY = y;
            const insideBody = localX >= 6 && localX <= 25 && localY >= 5 && localY <= 27;
            const insideFace = localX >= 9 && localX <= 22 && localY >= 8 && localY <= 19;
            const leftEye = localX >= (frameIndex === 0 ? 12 : 11) && localX <= (frameIndex === 0 ? 14 : 13) && localY >= 12 && localY <= 14;
            const rightEye = localX >= (frameIndex === 0 ? 18 : 19) && localX <= (frameIndex === 0 ? 20 : 21) && localY >= 12 && localY <= 14;
            const mouth = localY >= 18 && localY <= 19 && localX >= 12 && localX <= 19;

            let pixel: readonly [number, number, number, number] = [0, 0, 0, 0];
            if (insideBody) {
                pixel = frameIndex === 0 ? [255, 148, 78, 255] : [72, 198, 255, 255];
            }
            if (insideFace) {
                pixel = frameIndex === 0 ? [255, 223, 182, 255] : [214, 241, 255, 255];
            }
            if (leftEye || rightEye) {
                pixel = [15, 23, 42, 255];
            }
            if (mouth) {
                pixel = frameIndex === 0 ? [120, 53, 15, 255] : [8, 47, 73, 255];
            }

            setPixel(data, width, x, y, pixel);
        }
    }

    return Array.from(data);
};

const scene2DAnimationMaskingExample: SceneExample = {
    id: 'scene-2d-animation-masking',
    title: 'Scene 2D Animation + Masking',
    description:
        'Uses the new atlas animator and inherited sprite masks to stage moving 2D character lanes with shared batching.',
    tags: ['scene-2d', 'animation', 'masking', 'sprite'],
    order: 6,
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
            id: 'scene2d.hero-atlas',
            source: {
                kind: 'data',
                width: 64,
                height: 32,
                channels: 4,
                data: createHeroAtlasTexture(),
            },
            generateMipmaps: false,
        });

        const atlas = createSpriteAtlas({
            id: 'scene2d.hero',
            textureId: 'scene2d.hero-atlas',
            textureSize: { width: 64, height: 32 },
            frames: [
                {
                    id: 'hero/idle-0',
                    region: { x: 0, y: 0, width: 32, height: 32 },
                    sourceSize: { width: 1.6, height: 1.6 },
                },
                {
                    id: 'hero/idle-1',
                    region: { x: 32, y: 0, width: 32, height: 32 },
                    sourceSize: { width: 1.6, height: 1.6 },
                },
            ],
            animations: [
                {
                    id: 'idle',
                    frames: [
                        { frameId: 'hero/idle-0', durationMs: 120 },
                        { frameId: 'hero/idle-1', durationMs: 120 },
                    ],
                },
            ],
        });

        const camera = scene.createCameraActor(
            { name: 'Scene2DCamera' },
            {
                primary: true,
                orthographic: true,
                orthographicSize: 5.5,
                clearColor: [0.05, 0.07, 0.11, 1],
            }
        );

        const leftMask = scene.createMaskActor(
            { name: 'LeftLaneMask' },
            { size: [4.1, 4.6], shape: 'rounded-rect', cornerRadius: 0.48 }
        );
        leftMask.getComponent(Transform)!.position = new Vec3(-2.6, 0, 0);
        const rightMask = scene.createMaskActor(
            { name: 'RightLaneMask' },
            { size: [4.1, 4.6], shape: 'circle' }
        );
        rightMask.getComponent(Transform)!.position = new Vec3(2.6, 0, 0);

        const animatedTransforms: Transform[] = [];
        const laneDefinitions = [
            { parent: leftMask, color: Color.fromHex('#ff9d4dff'), phase: 0 },
            { parent: rightMask, color: Color.fromHex('#7dd3fcff'), phase: Math.PI * 0.5 },
        ] as const;

        for (const lane of laneDefinitions) {
            for (let index = 0; index < 5; index += 1) {
                const actor = scene.createAnimatedSpriteActor(
                    { name: `${lane.parent.name}-sprite-${index}` },
                    {
                        color: lane.color,
                    },
                    {
                        atlas,
                        clipId: 'idle',
                        speed: 0.9 + index * 0.12,
                    }
                );

                actor.setParent(lane.parent);
                const transform = actor.getComponent(Transform)!;
                transform.position = new Vec3(-1.8 + index * 0.9, 1.4 - index * 0.7, 0);
                animatedTransforms.push(transform);
            }
        }

        let frameHandle = 0;
        const startTime = performance.now();
        const animate = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            for (let index = 0; index < animatedTransforms.length; index += 1) {
                const transform = animatedTransforms[index]!;
                const lanePhase = index < 5 ? 0 : Math.PI * 0.5;
                const localIndex = index % 5;
                transform.position = new Vec3(
                    Math.sin(elapsed * 1.5 + lanePhase + localIndex * 0.45) * 1.7,
                    1.4 - localIndex * 0.7,
                    0
                );
            }

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

export default scene2DAnimationMaskingExample;