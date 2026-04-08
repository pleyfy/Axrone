import { createDemoPanel, createDemoText, createUIExampleHost } from './ui/example-helpers';
import type { ExampleContext, SceneExample } from './example-types';

const uiTextGalleryExample: SceneExample = {
    id: 'ui-text-gallery',
    title: 'UI Text Gallery',
    description: 'Shows scaled bitmap text with alignment, wrapping, shadows, decorations, selection, and caret rendering.',
    tags: ['ui', 'text', 'overlay'],
    order: 7,
    async mount({ container }: ExampleContext) {
        const host = await createUIExampleHost({ container });
        const { runtime } = host;

        const panel = createDemoPanel(runtime, { width: 560, height: 340, gap: 14 });
        const title = createDemoText(runtime, 'TEXT SYSTEM', 22, {
            color: '#f8fafcff',
            layout: { height: 28 },
        });
        const subtitle = createDemoText(runtime, 'SCALED BITMAP GLYPHS WRAP ALIGN DECORATE', 12, {
            color: '#93c5fdff',
            layout: { height: 16 },
        });

        const topRow = runtime.createWidget({ layout: { display: 'stack', direction: 'row', gap: 12, height: 118 } });
        const leftCard = runtime.createWidget({
            layout: { grow: 1, padding: 12, display: 'stack', direction: 'column', gap: 8 },
            style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });
        const rightCard = runtime.createWidget({
            layout: { grow: 1, padding: 12, display: 'stack', direction: 'column', gap: 8 },
            style: { background: '#101826ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });

        runtime.appendChild(leftCard, createDemoText(runtime, 'START ALIGN', 18, { color: '#f8fafcff', layout: { height: 22 } }));
        runtime.appendChild(leftCard, createDemoText(runtime, 'CENTER ALIGN', 16, { color: '#7dd3fcff', layout: { height: 20 }, text: { align: 'center' } }));
        runtime.appendChild(leftCard, createDemoText(runtime, 'END ALIGN', 14, { color: '#c4b5fdff', layout: { height: 18 }, text: { align: 'end', letterSpacing: 0.4 } }));

        runtime.appendChild(rightCard, createDemoText(runtime, 'JUSTIFY', 14, { color: '#f8fafcff', layout: { height: 18 } }));
        runtime.appendChild(rightCard, createDemoText(runtime, 'THE TEXT ENGINE NOW SCALES BITMAP GLYPHS WITH THE SAME METRICS USED DURING LAYOUT.', 13, {
            color: '#cbd5e1ff',
            layout: { height: 72 },
            text: { wrap: 'word', align: 'justify', maxLines: 4 },
        }));

        const effectsCard = runtime.createWidget({
            layout: { padding: 14, display: 'stack', direction: 'column', gap: 10, height: 124 },
            style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });
        runtime.appendChild(effectsCard, createDemoText(runtime, 'SHADOW UNDERLINE STRIKE', 18, {
            color: '#f8fafcff',
            layout: { height: 26 },
            text: {
                shadowColor: '#020617cc',
                shadowOffsetX: 2,
                shadowOffsetY: 2,
                underline: true,
                underlineColor: '#38bdf8ff',
                underlineThickness: 2,
                underlineOffset: 2,
                strikeThrough: true,
                strikeThroughColor: '#f97316ff',
                strikeThroughThickness: 2,
            },
        }));
        runtime.appendChild(effectsCard, createDemoText(runtime, 'SCENE UI RANGE', 18, {
            color: '#e2e8f0ff',
            layout: { height: 30 },
            text: {
                selectionStart: 6,
                selectionEnd: 12,
                selectionColor: '#0ea5e966',
                caretIndex: 12,
                caretColor: '#f8fafcff',
                caretWidth: 2,
                caretInset: 1,
                shadowColor: '#020617cc',
                shadowOffsetX: 2,
                shadowOffsetY: 2,
            },
        }));
        runtime.appendChild(effectsCard, createDemoText(runtime, 'LETTER SPACING  1  2', 14, {
            color: '#7dd3fcff',
            layout: { height: 18 },
            text: { letterSpacing: 1.2 },
        }));

        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, title);
        runtime.appendChild(panel, subtitle);
        runtime.appendChild(panel, topRow);
        runtime.appendChild(panel, effectsCard);
        runtime.appendChild(topRow, leftCard);
        runtime.appendChild(topRow, rightCard);

        return host;
    },
};

export default uiTextGalleryExample;