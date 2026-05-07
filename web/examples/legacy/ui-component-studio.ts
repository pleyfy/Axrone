import {
    createUIButton,
    createUICanvas,
    createUIEditBox,
    createUILayout,
    createUIPageView,
    createUIProgressBar,
    createUIRichText,
    createUIScrollView,
    createUISlider,
    createUIToggle,
    createUIWidget,
} from '@axrone/ui';
import type { ExampleContext, SceneExample } from './example-types';
import { createUIExampleHost } from './ui/example-helpers';

const uiComponentStudioExample: SceneExample = {
    id: 'ui-component-studio',
    title: 'UI Component Studio',
    description: 'Presents the full built-in UI surface with canvas, layout, input, paging, scrolling, and authored control states.',
    tags: ['ui', 'components', 'editor-ready', 'controls'],
    order: 9,
    async mount({ container }: ExampleContext) {
        const host = await createUIExampleHost({ container, bindInput: true });
        const { runtime } = host;

        const canvas = createUICanvas(runtime, {
            style: {
                background: '#050b16b8',
            },
        });
        const workspace = createUILayout(runtime, {
            parent: canvas,
            layout: {
                position: 'absolute',
                anchor: 'stretch',
                inset: { top: 24, right: 24, bottom: 24, left: 24 },
                direction: 'row',
                gap: 18,
            },
        });
        const leftColumn = createUILayout(runtime, {
            parent: workspace,
            layout: {
                width: 332,
                gap: 14,
                padding: 18,
            },
            style: {
                background: '#0f172ae8',
                borderColor: '#67e8f988',
                borderWidth: 1,
                radius: 18,
            },
        });
        const rightColumn = createUILayout(runtime, {
            parent: workspace,
            layout: {
                grow: 1,
                gap: 14,
                padding: 18,
            },
            style: {
                background: '#0b1322e8',
                borderColor: '#60a5fa66',
                borderWidth: 1,
                radius: 18,
            },
        });

        const title = createUIRichText(runtime, {
            parent: leftColumn,
            value: 'AXRONE UI SURFACE',
            text: {
                size: 20,
                underline: true,
                underlineColor: '#67e8f9ff',
                shadowColor: '#00000099',
                shadowOffsetX: 2,
                shadowOffsetY: 1,
            },
        });
        createUIRichText(runtime, {
            parent: leftColumn,
            value: 'BUTTON CANVAS EDITBOX LAYOUT PAGEVIEW PROGRESSBAR RICHTEXT SCROLLVIEW SLIDER TOGGLE WIDGET',
            text: {
                size: 12,
                color: '#93c5fdff',
                wrap: 'word',
            },
        });

        const pageView = createUIPageView(runtime, {
            parent: rightColumn,
            layout: {
                width: '100%',
                height: 220,
            },
        });

        const pageOne = createUILayout(runtime, {
            layout: {
                anchor: 'stretch',
                width: '100%',
                height: '100%',
                padding: 18,
                gap: 10,
            },
            style: {
                background: '#111827ff',
                borderColor: '#34d39988',
                borderWidth: 1,
                radius: 16,
            },
        });
        createUIRichText(runtime, {
            parent: pageOne,
            value: 'PAGE 1  LAYOUT + WIDGET',
            text: {
                size: 16,
                color: '#f8fafcff',
            },
        });
        createUIWidget(runtime, {
            parent: pageOne,
            layout: {
                width: '100%',
                height: 92,
                padding: 14,
            },
            style: {
                background: '#0f172aff',
                borderColor: '#38bdf888',
                borderWidth: 1,
                radius: 14,
            },
            text: {
                value: 'GENERIC WIDGET SURFACE WITH TEXT, BORDER, RADIUS, AND CONTENT LAYOUT.',
                family: 'OverlayBitmap',
                size: 14,
                color: '#dbeafeff',
                wrap: 'word',
            },
        });

        const pageTwo = createUILayout(runtime, {
            layout: {
                anchor: 'stretch',
                width: '100%',
                height: '100%',
                padding: 18,
                gap: 10,
            },
            style: {
                background: '#131c30ff',
                borderColor: '#a78bfa88',
                borderWidth: 1,
                radius: 16,
            },
        });
        createUIRichText(runtime, {
            parent: pageTwo,
            value: 'PAGE 2  RICHTEXT',
            text: {
                size: 16,
                color: '#f8fafcff',
            },
        });
        createUIRichText(runtime, {
            parent: pageTwo,
            value: 'OUTLINE, SHADOW, UNDERLINE, CARET, AND SELECTION ARE PART OF THE SAME TEXT PIPELINE.',
            text: {
                size: 14,
                color: '#f5d0feff',
                outlineColor: '#7c3aedff',
                outlineWidth: 1,
                shadowColor: '#000000aa',
                shadowOffsetX: 1,
                shadowOffsetY: 1,
                underline: true,
                underlineColor: '#c084fcff',
                selectionStart: 0,
                selectionEnd: 8,
                selectionColor: '#7c3aed66',
                caretIndex: 18,
                caretColor: '#f8fafcff',
                wrap: 'word',
            },
        });

        const pageThree = createUILayout(runtime, {
            layout: {
                anchor: 'stretch',
                width: '100%',
                height: '100%',
                padding: 18,
                gap: 10,
            },
            style: {
                background: '#0f1c1fff',
                borderColor: '#22c55e88',
                borderWidth: 1,
                radius: 16,
            },
        });
        createUIRichText(runtime, {
            parent: pageThree,
            value: 'PAGE 3  PAGEVIEW',
            text: {
                size: 16,
                color: '#f8fafcff',
            },
        });
        createUIRichText(runtime, {
            parent: pageThree,
            value: 'DOT INDICATORS AND NEXT/PREV ACTIONS MAKE PAGE SWITCHING FEEL LIKE A NATIVE UI SURFACE.',
            text: {
                size: 14,
                color: '#bbf7d0ff',
                wrap: 'word',
            },
        });

        pageView.addPage(pageOne.root);
        pageView.addPage(pageTwo.root);
        pageView.addPage(pageThree.root);

        const editBox = createUIEditBox(runtime, {
            parent: leftColumn,
            placeholder: 'Name this HUD surface',
            onChange: (value) => {
                title.setText(value.trim().length > 0 ? value.toUpperCase() : 'AXRONE UI SURFACE');
            },
        });
        const progress = createUIProgressBar(runtime, {
            parent: leftColumn,
            label: 'Runtime Sync',
            min: 0,
            max: 100,
            value: 64,
        });
        const slider = createUISlider(runtime, {
            parent: leftColumn,
            label: 'Completion',
            min: 0,
            max: 100,
            step: 5,
            value: 64,
            onChange: (value) => {
                progress.setValue(value);
            },
        });
        const toggle = createUIToggle(runtime, {
            parent: leftColumn,
            label: 'Allow paging',
            checked: true,
            onChange: (checked) => {
                nextButton.setDisabled(!checked);
            },
        });
        const actions = createUILayout(runtime, {
            parent: leftColumn,
            layout: {
                direction: 'row',
                gap: 10,
                width: '100%',
            },
        });
        const nextButton = createUIButton(runtime, {
            parent: actions,
            label: 'Next Page',
            variant: 'primary',
            onPress: () => {
                pageView.next();
            },
        });
        createUIButton(runtime, {
            parent: actions,
            label: 'Reset',
            variant: 'neutral',
            onPress: () => {
                pageView.setPage(0);
                progress.setValue(64);
                slider.setValue(64);
                editBox.setValue('');
                title.setText('AXRONE UI SURFACE');
            },
        });

        const scrollView = createUIScrollView(runtime, {
            parent: rightColumn,
            layout: {
                width: '100%',
                height: 166,
            },
        });
        const feed = createUILayout(runtime, {
            parent: scrollView,
            layout: {
                width: '100%',
                gap: 8,
            },
        });

        const feedRows = [
            ['BUTTON', 'State-aware focus, hover, pressed, disabled'],
            ['EDITBOX', 'Caret, insertion, selection, submit semantics'],
            ['SLIDER', 'Keyboard and pointer-driven numeric authoring'],
            ['TOGGLE', 'Boolean state with authored visuals'],
            ['SCROLLVIEW', 'Clipped content with content offsets'],
            ['PAGEVIEW', 'Structured multi-page UI with indicators'],
        ];

        for (const [heading, body] of feedRows) {
            const card = createUILayout(runtime, {
                parent: feed,
                layout: {
                    width: '100%',
                    padding: 12,
                    gap: 6,
                },
                style: {
                    background: '#111827ff',
                    borderColor: '#334155ff',
                    borderWidth: 1,
                    radius: 14,
                },
            });
            createUIRichText(runtime, {
                parent: card,
                value: heading,
                text: {
                    size: 14,
                    color: '#f8fafcff',
                    wrap: 'none',
                },
            });
            createUIRichText(runtime, {
                parent: card,
                value: body,
                text: {
                    size: 12,
                    color: '#94a3b8ff',
                    wrap: 'word',
                },
            });
        }

        return host;
    },
};

export default uiComponentStudioExample;