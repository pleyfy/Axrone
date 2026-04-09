import { createDemoPanel, createDemoText, createUIExampleHost } from './ui/example-helpers';
import type { ExampleContext, SceneExample } from './example-types';

const uiLayoutGalleryExample: SceneExample = {
    id: 'ui-layout-gallery',
    title: 'UI Layout Gallery',
    description: 'Showcases stack flow, grow, absolute anchors, stretch panels, and layered layout composition.',
    tags: ['ui', 'layout', 'anchors', 'overlay'],
    order: 6,
    async mount({ container }: ExampleContext) {
        const host = await createUIExampleHost({ container });
        const { runtime } = host;

        const panel = createDemoPanel(runtime, { width: 544, height: 332, gap: 14 });
        const title = createDemoText(runtime, 'LAYOUT AND ANCHORS', 20, {
            color: '#f8fafcff',
            layout: { height: 26 },
        });
        const subtitle = createDemoText(runtime, 'STACK FLOW GROW ABSOLUTE STRETCH', 12, {
            color: '#93c5fdff',
            layout: { width: '100%', height: 16 },
            text: { wrap: 'none' },
        });
        const body = runtime.createWidget({
            layout: { display: 'stack', direction: 'row', gap: 12, width: '100%', height: 188 },
        });
        const navigation = runtime.createWidget({
            layout: { width: 118, display: 'stack', direction: 'column', gap: 8, padding: 10 },
            style: { background: '#111827ff', radius: 14 },
        });
        const navigationItems = ['NAV', 'BUILD', 'TOOLS'];
        for (const item of navigationItems) {
            const entry = runtime.createWidget({
                layout: { height: 34, padding: 10 },
                style: { background: '#172554ff', borderColor: '#1d4ed8ff', borderWidth: 1, radius: 10 },
                text: {
                    value: item,
                    family: 'OverlayBitmap',
                    size: 14,
                    color: '#dbeafeff',
                },
            });
            runtime.appendChild(navigation, entry);
        }

        const content = runtime.createWidget({
            layout: { grow: 1, display: 'stack', direction: 'column', gap: 10, width: '100%' },
        });
        const metrics = runtime.createWidget({
            layout: { display: 'stack', direction: 'row', justifyContent: 'space-between', gap: 10, width: '100%', height: 30 },
        });
        const metricsLeft = runtime.createWidget({
            layout: { width: 'content', height: 28, padding: [8, 10] },
            style: { background: '#082f49ff', radius: 999, borderColor: '#22d3eeaa', borderWidth: 1 },
            text: { value: 'FLOW ROW', family: 'OverlayBitmap', size: 12, color: '#cffafeff' },
        });
        const metricsRight = runtime.createWidget({
            layout: { width: 'content', height: 28, padding: [8, 10] },
            style: { background: '#052e16ff', radius: 999, borderColor: '#4ade80aa', borderWidth: 1 },
            text: { value: 'GROW 2X', family: 'OverlayBitmap', size: 12, color: '#dcfce7ff' },
        });
        runtime.appendChild(metrics, metricsLeft);
        runtime.appendChild(metrics, metricsRight);

        const cards = runtime.createWidget({
            layout: { display: 'stack', direction: 'row', gap: 10, width: '100%', height: 98 },
        });
        const primaryCard = runtime.createWidget({
            layout: { grow: 1, padding: 12, display: 'stack', direction: 'column', gap: 6, height: 98 },
            style: { background: '#111827ff', radius: 14, borderColor: '#334155ff', borderWidth: 1 },
        });
        const secondaryCard = runtime.createWidget({
            layout: { width: 128, padding: 12, display: 'stack', direction: 'column', gap: 6, height: 98 },
            style: { background: '#131c30ff', radius: 14, borderColor: '#334155ff', borderWidth: 1 },
        });
        runtime.appendChild(primaryCard, createDemoText(runtime, 'PRIMARY SURFACE', 14, { color: '#f8fafcff', layout: { width: '100%', height: 18 }, text: { wrap: 'none' } }));
        runtime.appendChild(primaryCard, createDemoText(runtime, 'STRETCH CHILDREN KEEP THE GRID TIGHT', 12, { color: '#94a3b8ff', layout: { width: '100%', height: 34 }, text: { wrap: 'word', maxLines: 2 } }));
        runtime.appendChild(secondaryCard, createDemoText(runtime, 'SIDE CARD', 14, { color: '#f8fafcff', layout: { width: '100%', height: 18 }, text: { wrap: 'none' } }));
        runtime.appendChild(secondaryCard, createDemoText(runtime, 'CONTENT WIDTH', 12, { color: '#7dd3fcff', layout: { width: '100%', height: 16 }, text: { wrap: 'word' } }));
        runtime.appendChild(cards, primaryCard);
        runtime.appendChild(cards, secondaryCard);

        const stretchBar = runtime.createWidget({
            layout: {
                position: 'absolute',
                anchor: 'stretch',
                inset: { left: 24, right: 24, bottom: 24 },
                height: 34,
                padding: [8, 14],
                display: 'stack',
                direction: 'row',
                justifyContent: 'space-between',
            },
            style: { background: '#020617dd', borderColor: '#0ea5e9aa', borderWidth: 1, radius: 12 },
        });
        runtime.appendChild(stretchBar, createDemoText(runtime, 'STRETCH ANCHOR', 12, { color: '#e0f2feff', layout: { width: 'content', height: 16 } }));
        runtime.appendChild(stretchBar, createDemoText(runtime, 'LEFT RIGHT INSETS', 12, { color: '#7dd3fcff', layout: { width: 'content', height: 16 } }));

        const topRight = runtime.createWidget({
            layout: { position: 'absolute', anchor: 'top-right', inset: { top: 28, right: 28 }, width: 'content', height: 28, padding: [8, 12] },
            style: { background: '#082f49ff', borderColor: '#38bdf8aa', borderWidth: 1, radius: 999 },
            text: { value: 'TOP RIGHT', family: 'OverlayBitmap', size: 12, color: '#e0f2feff' },
        });
        const bottomLeft = runtime.createWidget({
            layout: { position: 'absolute', anchor: 'bottom-left', inset: { left: 28, bottom: 68 }, width: 'content', height: 28, padding: [8, 12] },
            style: { background: '#1f2937ff', borderColor: '#818cf8aa', borderWidth: 1, radius: 999 },
            text: { value: 'BOTTOM LEFT', family: 'OverlayBitmap', size: 12, color: '#e9d5ffff' },
        });

        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(runtime.root, stretchBar);
        runtime.appendChild(runtime.root, topRight);
        runtime.appendChild(runtime.root, bottomLeft);
        runtime.appendChild(panel, title);
        runtime.appendChild(panel, subtitle);
        runtime.appendChild(panel, body);
        runtime.appendChild(body, navigation);
        runtime.appendChild(body, content);
        runtime.appendChild(content, metrics);
        runtime.appendChild(content, cards);

        return host;
    },
};

export default uiLayoutGalleryExample;