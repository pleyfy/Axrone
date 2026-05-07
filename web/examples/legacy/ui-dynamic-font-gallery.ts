import type { TextBlockInput, UIRuntime, WidgetId, WidgetLayoutInput, WidgetStyleInput } from '@axrone/ui';
import type { ExampleContext, SceneExample } from './example-types';
import { createDemoPanel, createUIExampleHost, resolveExampleAssetUrl } from './ui/example-helpers';

const DYNAMIC_FONT_FAMILY = 'Kenney Pixel Dynamic';
const DYNAMIC_FONT_URL = 'fonts/kenpixel.ttf';
const PULSE_LABEL = 'AXRONE 88';

const createDynamicText = (
    runtime: UIRuntime,
    value: string,
    size: number,
    options: {
        readonly color?: string;
        readonly layout?: WidgetLayoutInput;
        readonly style?: WidgetStyleInput;
        readonly text?: Partial<TextBlockInput>;
    } = {}
): WidgetId =>
    runtime.createWidget({
        role: 'text',
        layout: options.layout,
        style: options.style,
        text: {
            value,
            family: DYNAMIC_FONT_FAMILY,
            size,
            color: options.color ?? '#f8fafcff',
            ...(options.text ?? {}),
        },
    });

const formatSize = (value: number): string => value.toString().padStart(2, '0');

const uiDynamicFontGalleryExample: SceneExample = {
    id: 'ui-dynamic-font-gallery',
    title: 'UI Dynamic Font Gallery',
    description:
        'Loads a real TTF file through the WebGL2 UI font runtime, then shows the same glyphs across multiple raster sizes and an animated pulse line.',
    tags: ['ui', 'text', 'font', 'webgl2'],
    order: 8,
    async mount({ container }: ExampleContext) {
        const host = await createUIExampleHost({
            container,
            clearColor: [0.02, 0.03, 0.06, 1],
            cubeColor: [0.14, 0.46, 0.82, 1],
            atlasFilter: 'linear',
        });
        const { runtime, scene } = host;

        const fontUrl = resolveExampleAssetUrl(DYNAMIC_FONT_URL);
        const faceId = await runtime.fonts.load({
            kind: 'url',
            url: fontUrl,
            contentType: 'font/ttf',
            family: DYNAMIC_FONT_FAMILY,
            face: 'Regular',
            weight: 400,
            style: 'normal',
            cacheKey: 'examples:ui-dynamic-font-gallery:kenpixel',
        });
        const faceInfo = runtime.fonts.getFaceInfo(faceId);

        const panel = createDemoPanel(runtime, {
            width: 724,
            height: 388,
            gap: 14,
        }, {
            background: '#08111dcc',
            borderColor: '#60a5faaa',
        });
        const title = createDynamicText(runtime, 'DYNAMIC FONT RUNTIME', 24, {
            layout: { width: '100%', height: 30 },
            text: { wrap: 'none' },
        });
        const subtitle = createDynamicText(runtime, 'REAL TTF URL SOURCE   LIVE RASTER CACHE   WEBGL2 ATLAS', 12, {
            color: '#93c5fdff',
            layout: { width: '100%', height: 16 },
            text: { wrap: 'none', letterSpacing: 0.8 },
        });

        const content = runtime.createWidget({
            layout: {
                width: '100%',
                height: 286,
                display: 'stack',
                direction: 'row',
                gap: 12,
            },
        });
        const leftCard = runtime.createWidget({
            layout: {
                grow: 1,
                height: '100%',
                padding: 14,
                display: 'stack',
                direction: 'column',
                gap: 10,
            },
            style: {
                background: '#0f172aff',
                borderColor: '#1e3a5fff',
                borderWidth: 1,
                radius: 16,
            },
        });
        const rightCard = runtime.createWidget({
            layout: {
                width: 244,
                height: '100%',
                padding: 14,
                display: 'stack',
                direction: 'column',
                gap: 10,
            },
            style: {
                background: '#101827ff',
                borderColor: '#1e293bff',
                borderWidth: 1,
                radius: 16,
            },
        });

        const pulseSize = createDynamicText(runtime, 'PULSE SIZE 00 PX', 14, {
            color: '#7dd3fcff',
            layout: { width: '100%', height: 18 },
            text: { wrap: 'none' },
        });
        const pulseHero = createDynamicText(runtime, PULSE_LABEL, 46, {
            layout: { width: '100%', height: 72 },
            text: {
                wrap: 'none',
                shadowColor: '#020617dd',
                shadowOffsetX: 2,
                shadowOffsetY: 2,
            },
        });
        const pulseCopy = createDynamicText(runtime, 'SAME CODEPOINTS MOVING THROUGH MULTIPLE RASTER SIZES', 12, {
            color: '#cbd5e1ff',
            layout: { width: '100%', height: 16 },
            text: { wrap: 'none', letterSpacing: 0.5 },
        });

        const staticLabel = createDynamicText(runtime, 'STATIC SCALE CHECK', 14, {
            color: '#e2e8f0ff',
            layout: { width: '100%', height: 18 },
            text: { wrap: 'none' },
        });
        const smallLine = createDynamicText(runtime, PULSE_LABEL, 18, {
            color: '#bfdbfeff',
            layout: { width: '100%', height: 24 },
            text: { wrap: 'none' },
        });
        const mediumLine = createDynamicText(runtime, PULSE_LABEL, 28, {
            color: '#dbeafeff',
            layout: { width: '100%', height: 34 },
            text: { wrap: 'none' },
        });
        const largeLine = createDynamicText(runtime, PULSE_LABEL, 40, {
            color: '#f8fafcff',
            layout: { width: '100%', height: 48 },
            text: { wrap: 'none' },
        });
        const kerningLine = createDynamicText(runtime, 'AV WA TO LT 112233', 24, {
            color: '#fde68aff',
            layout: { width: '100%', height: 28 },
            text: {
                wrap: 'none',
                shadowColor: '#111827cc',
                shadowOffsetX: 2,
                shadowOffsetY: 2,
            },
        });

        const sourceCard = createDynamicText(runtime, 'BINARY FONT SOURCE', 14, {
            color: '#f8fafcff',
            layout: { width: '100%', height: 18 },
            text: { wrap: 'none' },
        });
        const sourceValue = createDynamicText(runtime, DYNAMIC_FONT_URL.toUpperCase(), 12, {
            color: '#7dd3fcff',
            layout: { width: '100%', height: 34 },
            text: { wrap: 'word', maxLines: 2 },
        });
        const faceValue = createDynamicText(
            runtime,
            `FACE ${faceInfo?.face?.toUpperCase() ?? 'REGULAR'}  UPM ${faceInfo?.unitsPerEm ?? 0}`,
            12,
            {
                color: '#cbd5e1ff',
                layout: { width: '100%', height: 18 },
                text: { wrap: 'none' },
            }
        );
        const metricsValue = createDynamicText(
            runtime,
            `ASC ${faceInfo?.ascent ?? 0}  DESC ${faceInfo?.descent ?? 0}  GAP ${faceInfo?.lineGap ?? 0}`,
            12,
            {
                color: '#cbd5e1ff',
                layout: { width: '100%', height: 18 },
                text: { wrap: 'none' },
            }
        );
        const atlasValue = createDynamicText(runtime, 'ATLAS FILTER LINEAR', 12, {
            color: '#a5f3fcff',
            layout: { width: '100%', height: 18 },
            text: { wrap: 'none' },
        });
        const cacheValue = createDynamicText(runtime, 'CACHE KEY = CODEPOINT + RASTER SIZE', 12, {
            color: '#fca5a5ff',
            layout: { width: '100%', height: 34 },
            text: { wrap: 'word', maxLines: 2 },
        });

        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, title);
        runtime.appendChild(panel, subtitle);
        runtime.appendChild(panel, content);
        runtime.appendChild(content, leftCard);
        runtime.appendChild(content, rightCard);

        runtime.appendChild(leftCard, pulseSize);
        runtime.appendChild(leftCard, pulseHero);
        runtime.appendChild(leftCard, pulseCopy);
        runtime.appendChild(leftCard, staticLabel);
        runtime.appendChild(leftCard, smallLine);
        runtime.appendChild(leftCard, mediumLine);
        runtime.appendChild(leftCard, largeLine);
        runtime.appendChild(leftCard, kerningLine);

        runtime.appendChild(rightCard, sourceCard);
        runtime.appendChild(rightCard, sourceValue);
        runtime.appendChild(rightCard, faceValue);
        runtime.appendChild(rightCard, metricsValue);
        runtime.appendChild(rightCard, atlasValue);
        runtime.appendChild(rightCard, cacheValue);

        const animationSystemId = 'ui-dynamic-font-gallery.animate';
        scene.loop.addSystem({
            id: animationSystemId,
            priority: 140,
            enabled: true,
            update(context) {
                const animatedSize = 24 + Math.round((Math.sin(context.elapsed * 0.0022) * 0.5 + 0.5) * 30);
                runtime.updateWidget(pulseHero, {
                    text: {
                        size: animatedSize,
                    },
                    layout: {
                        height: Math.max(72, animatedSize + 24),
                    },
                });
                runtime.updateWidget(pulseSize, {
                    text: {
                        value: `PULSE SIZE ${formatSize(animatedSize)} PX`,
                    },
                });
            },
        });

        return {
            dispose() {
                scene.loop.removeSystem(animationSystemId);
                host.dispose();
            },
        };
    },
};

export default uiDynamicFontGalleryExample;
