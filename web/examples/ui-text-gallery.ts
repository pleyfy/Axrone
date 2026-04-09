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

        const panel = createDemoPanel(runtime, { width: 676, height: 376, gap: 16 });
        const title = createDemoText(runtime, 'TEXT SYSTEM', 20, {
            color: '#f8fafcff',
            layout: { height: 28 },
        });
        const subtitle = createDemoText(runtime, 'ALIGN JUSTIFY DECORATIONS CARET', 12, {
            color: '#93c5fdff',
            layout: { width: '100%', height: 16 },
            text: { wrap: 'none' },
        });

        const topRow = runtime.createWidget({ layout: { display: 'stack', direction: 'row', gap: 12, width: '100%', height: 132 } });
        const leftCard = runtime.createWidget({
            layout: { width: 176, padding: 12, display: 'stack', direction: 'column', gap: 8, height: 132 },
            style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });
        const rightCard = runtime.createWidget({
            layout: { grow: 1, padding: 14, display: 'stack', direction: 'column', gap: 10, height: 132 },
            style: { background: '#101826ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });

        runtime.appendChild(leftCard, createDemoText(runtime, 'START ALIGN', 16, { color: '#f8fafcff', layout: { width: '100%', height: 20 }, text: { wrap: 'none' } }));
        runtime.appendChild(leftCard, createDemoText(runtime, 'CENTER ALIGN', 14, { color: '#7dd3fcff', layout: { width: '100%', height: 18 }, text: { align: 'center', wrap: 'none' } }));
        runtime.appendChild(leftCard, createDemoText(runtime, 'END ALIGN', 14, { color: '#c4b5fdff', layout: { width: '100%', height: 18 }, text: { align: 'end', letterSpacing: 0.4, wrap: 'none' } }));

        runtime.appendChild(rightCard, createDemoText(runtime, 'JUSTIFY SAMPLE', 14, { color: '#f8fafcff', layout: { width: '100%', height: 18 }, text: { wrap: 'none' } }));
        runtime.appendChild(rightCard, createDemoText(runtime, 'JUSTIFY NOW DISTRIBUTES WORD GAPS INSIDE A CARD THAT ACTUALLY HAS ROOM TO BALANCE THE LINE.', 12, {
            color: '#cbd5e1ff',
            layout: { width: '100%', height: 54 },
            text: { wrap: 'word', align: 'justify', maxLines: 3 },
        }));

        const effectsCard = runtime.createWidget({
            layout: { padding: 14, display: 'stack', direction: 'column', gap: 8, width: '100%', height: 144 },
            style: { background: '#111827ff', borderColor: '#334155ff', borderWidth: 1, radius: 14 },
        });
        runtime.appendChild(effectsCard, createDemoText(runtime, 'SHADOW PASS', 16, {
            color: '#f8fafcff',
            layout: { width: '100%', height: 22 },
            text: {
                shadowColor: '#020617cc',
                shadowOffsetX: 2,
                shadowOffsetY: 2,
                wrap: 'none',
            },
        }));
        runtime.appendChild(effectsCard, createDemoText(runtime, 'UNDERLINE ACTIVE', 14, {
            color: '#7dd3fcff',
            layout: { width: '100%', height: 18 },
            text: {
                underline: true,
                underlineColor: '#38bdf8ff',
                underlineThickness: 2,
                underlineOffset: 2,
                wrap: 'none',
            },
        }));
        runtime.appendChild(effectsCard, createDemoText(runtime, 'STRIKE ACTIVE', 14, {
            color: '#f8fafcff',
            layout: { width: '100%', height: 18 },
            text: {
                strikeThrough: true,
                strikeThroughColor: '#f97316ff',
                strikeThroughThickness: 2,
                wrap: 'none',
            },
        }));
        runtime.appendChild(effectsCard, createDemoText(runtime, 'SCENE UI RANGE', 16, {
            color: '#e2e8f0ff',
            layout: { width: '100%', height: 24 },
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
                wrap: 'none',
            },
        }));
        runtime.appendChild(effectsCard, createDemoText(runtime, 'LETTER SPACING 1 2 3', 12, {
            color: '#7dd3fcff',
            layout: { width: '100%', height: 16 },
            text: { letterSpacing: 1.2, wrap: 'none' },
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