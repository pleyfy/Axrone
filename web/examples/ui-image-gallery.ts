import { createDemoPanel, createDemoText, createUIDemoTextureData, createUIExampleHost } from './ui/example-helpers';
import type { ExampleContext, SceneExample } from './example-types';

const uiImageGalleryExample: SceneExample = {
    id: 'ui-image-gallery',
    title: 'UI Image Gallery',
    description: 'Demonstrates scene texture resources, material-bound images, fit modes, and linear versus nearest sampling.',
    tags: ['ui', 'image', 'material', 'overlay'],
    order: 8,
    async mount({ container }: ExampleContext) {
        const host = await createUIExampleHost({ container });
        const { runtime, scene, overlayShaderId } = host;

        await scene.registerTexture({
            id: 'ui-image.cyan',
            source: { kind: 'data', width: 8, height: 8, channels: 4, data: createUIDemoTextureData('cyan') },
            generateMipmaps: true,
        });
        await scene.registerTexture({
            id: 'ui-image.sunset',
            source: { kind: 'data', width: 8, height: 8, channels: 4, data: createUIDemoTextureData('sunset') },
            generateMipmaps: true,
        });
        await scene.registerTexture({
            id: 'ui-image.lime',
            source: { kind: 'data', width: 8, height: 8, channels: 4, data: createUIDemoTextureData('lime') },
            generateMipmaps: true,
        });

        scene.createMaterial({
            id: 'ui-image.material.sunset',
            shaderId: overlayShaderId,
            uniforms: { u_Color: [1, 1, 1, 1] },
            textures: { u_MainTex: 'ui-image.sunset' },
        });

        const panel = createDemoPanel(runtime, { width: 644, height: 392, gap: 16 });
        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, createDemoText(runtime, 'IMAGE AND MATERIAL MODES', 20, { color: '#f8fafcff', layout: { height: 26 } }));
        runtime.appendChild(panel, createDemoText(runtime, 'TEXTURE CONTAIN COVER PIXEL MATERIAL', 12, {
            color: '#93c5fdff',
            layout: { width: '100%', height: 16 },
            text: { wrap: 'none' },
        }));

        const grid = runtime.createWidget({ layout: { display: 'stack', direction: 'column', gap: 12, width: '100%', height: 286 } });
        const topRow = runtime.createWidget({ layout: { display: 'stack', direction: 'row', gap: 12, width: '100%', height: 136 } });
        const bottomRow = runtime.createWidget({ layout: { display: 'stack', direction: 'row', gap: 12, width: '100%', height: 136 } });
        runtime.appendChild(panel, grid);
        runtime.appendChild(grid, topRow);
        runtime.appendChild(grid, bottomRow);

        const createImageCard = (
            title: string,
            image: NonNullable<Parameters<typeof runtime.createWidget>[0]['image']>,
            description: string
        ) => {
            const card = runtime.createWidget({
                layout: { grow: 1, padding: 12, display: 'stack', direction: 'column', gap: 8, height: 136 },
                style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
            });
            const frame = runtime.createWidget({
                layout: { width: '100%', height: 76 },
                style: { background: '#020617ff', borderColor: '#1e293bff', borderWidth: 1, radius: 12, clip: true },
                image,
            });
            runtime.appendChild(card, createDemoText(runtime, title, 14, {
                color: '#f8fafcff',
                layout: { width: '100%', height: 18 },
                text: { wrap: 'none' },
            }));
            runtime.appendChild(card, frame);
            runtime.appendChild(card, createDemoText(runtime, description, 12, {
                color: '#7dd3fcff',
                layout: { width: '100%', height: 28 },
                text: { wrap: 'word', maxLines: 2 },
            }));
            return card;
        };

        runtime.appendChild(
            topRow,
            createImageCard(
                'CONTAIN',
                { source: { kind: 'texture', resourceId: 'ui-image.cyan', width: 8, height: 8 }, fit: 'contain', sampling: 'linear' },
                'LINEAR CONTAIN'
            )
        );
        runtime.appendChild(
            topRow,
            createImageCard(
                'COVER',
                { source: { kind: 'texture', resourceId: 'ui-image.lime', width: 8, height: 8 }, fit: 'cover', sampling: 'linear' },
                'CROPPED COVER'
            )
        );
        runtime.appendChild(
            bottomRow,
            createImageCard(
                'NEAREST',
                { source: { kind: 'texture', resourceId: 'ui-image.cyan', width: 8, height: 8 }, fit: 'contain', sampling: 'nearest' },
                'PIXEL SHARP'
            )
        );
        runtime.appendChild(
            bottomRow,
            createImageCard(
                'MATERIAL',
                { source: { kind: 'material', materialId: 'ui-image.material.sunset', textureBinding: 'u_MainTex', width: 8, height: 8 }, fit: 'contain', sampling: 'linear' },
                'SCENE BINDING'
            )
        );

        return host;
    },
};

export default uiImageGalleryExample;