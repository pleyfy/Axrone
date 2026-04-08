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

        const panel = createDemoPanel(runtime, { width: 592, height: 356, gap: 14 });
        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, createDemoText(runtime, 'IMAGE AND MATERIAL MODES', 20, { color: '#f8fafcff', layout: { height: 26 } }));
        runtime.appendChild(panel, createDemoText(runtime, 'TEXTURE RESOURCE FIT MODES SAMPLING MATERIAL BINDING', 12, { color: '#93c5fdff', layout: { height: 16 } }));

        const grid = runtime.createWidget({ layout: { display: 'stack', direction: 'row', gap: 12, height: 250 } });
        const leftColumn = runtime.createWidget({ layout: { grow: 1, display: 'stack', direction: 'column', gap: 12 } });
        const rightColumn = runtime.createWidget({ layout: { grow: 1, display: 'stack', direction: 'column', gap: 12 } });
        runtime.appendChild(panel, grid);
        runtime.appendChild(grid, leftColumn);
        runtime.appendChild(grid, rightColumn);

        const createImageCard = (
            title: string,
            image: NonNullable<Parameters<typeof runtime.createWidget>[0]['image']>,
            description: string
        ) => {
            const card = runtime.createWidget({
                layout: { grow: 1, padding: 12, display: 'stack', direction: 'column', gap: 8 },
                style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
            });
            const frame = runtime.createWidget({
                layout: { height: 92 },
                style: { background: '#020617ff', borderColor: '#1e293bff', borderWidth: 1, radius: 12, clip: true },
                image,
            });
            runtime.appendChild(card, createDemoText(runtime, title, 14, { color: '#f8fafcff', layout: { height: 18 } }));
            runtime.appendChild(card, frame);
            runtime.appendChild(card, createDemoText(runtime, description, 12, { color: '#7dd3fcff', layout: { height: 16 } }));
            return card;
        };

        runtime.appendChild(
            leftColumn,
            createImageCard(
                'CONTAIN',
                { source: { kind: 'texture', resourceId: 'ui-image.cyan', width: 8, height: 8 }, fit: 'contain', sampling: 'linear' },
                'LINEAR CONTAIN'
            )
        );
        runtime.appendChild(
            leftColumn,
            createImageCard(
                'NEAREST',
                { source: { kind: 'texture', resourceId: 'ui-image.cyan', width: 8, height: 8 }, fit: 'fill', sampling: 'nearest' },
                'PIXEL SHARP'
            )
        );
        runtime.appendChild(
            rightColumn,
            createImageCard(
                'COVER',
                { source: { kind: 'texture', resourceId: 'ui-image.lime', width: 8, height: 8 }, fit: 'cover', sampling: 'linear' },
                'CROPPED COVER'
            )
        );
        runtime.appendChild(
            rightColumn,
            createImageCard(
                'MATERIAL',
                { source: { kind: 'material', materialId: 'ui-image.material.sunset', textureBinding: 'u_MainTex', width: 8, height: 8 }, fit: 'scale-down', sampling: 'linear' },
                'SCENE BINDING'
            )
        );

        return host;
    },
};

export default uiImageGalleryExample;