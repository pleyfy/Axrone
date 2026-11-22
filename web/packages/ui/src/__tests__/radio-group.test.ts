import { describe, expect, it } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getRadioGroupSelectedIndex } from '../index';
import { radioGroupController } from '../controls/radio-group-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const textBlock = (value: string) => ({
    value,
    family: AXRONE_DEFAULT_UI_FONT_FAMILY,
    size: 14,
    weight: '400',
    style: 'normal',
    lineHeight: 18.2,
    letterSpacing: 0,
    align: 'start',
    wrap: 'word',
    overflow: 'ellipsis',
});

const radioItem = (rootKey: string, index: number, label: string) => ({
    role: 'custom:radio-item',
    key: `${rootKey}-radio-${index}`,
    enabled: true,
    interactive: false,
    layout: { display: 'stack', width: 'content', height: 'content', direction: 'row', alignItems: 'center', gap: 8 },
    children: [
        {
            role: 'custom:radio-circle',
            key: `${rootKey}-radio-${index}-circle`,
            enabled: true,
            interactive: false,
            layout: { width: 18, height: 18, display: 'overlay' },
            style: { background: '#00000000', borderColor: '#475569ff', borderWidth: 2, radius: 999 },
            children: [
                {
                    role: 'custom:radio-dot',
                    key: `${rootKey}-radio-${index}-dot`,
                    enabled: index === 0,
                    interactive: false,
                    layout: { position: 'absolute', width: 8, height: 8, anchor: { x: 0.5, y: 0.5, maxX: 0.5, maxY: 0.5, pivotX: 0.5, pivotY: 0.5 } },
                    style: { background: '#0a74daff', radius: 999 },
                    children: [],
                },
            ],
        },
        {
            role: 'text',
            key: `${rootKey}-radio-${index}-label`,
            enabled: true,
            interactive: false,
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: textBlock(label),
            children: [],
        },
    ],
});

const buildRadioAsset = (): UIAsset =>
    ({
        id: 'test-radio',
        name: 'test-radio',
        version: 1,
        canvas: { referenceWidth: 800, referenceHeight: 600, scaleMode: 'match-width-or-height', matchBias: 0.5 },
        bindings: {
            root: 'root',
            'rad-1': 'rad-1',
            'rad-1-radio-0': 'rad-1-radio-0',
            'rad-1-radio-0-circle': 'rad-1-radio-0-circle',
            'rad-1-radio-0-dot': 'rad-1-radio-0-dot',
            'rad-1-radio-0-label': 'rad-1-radio-0-label',
            'rad-1-radio-1': 'rad-1-radio-1',
            'rad-1-radio-1-circle': 'rad-1-radio-1-circle',
            'rad-1-radio-1-dot': 'rad-1-radio-1-dot',
            'rad-1-radio-1-label': 'rad-1-radio-1-label',
            'rad-1-radio-2': 'rad-1-radio-2',
            'rad-1-radio-2-circle': 'rad-1-radio-2-circle',
            'rad-1-radio-2-dot': 'rad-1-radio-2-dot',
            'rad-1-radio-2-label': 'rad-1-radio-2-label',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:radio-group',
                    key: 'rad-1',
                    enabled: true,
                    interactive: true,
                    controller: 'radio-group',
                    props: {
                        selectedIndex: 0,
                        itemCount: 3,
                        options: ['Radio 1', 'Radio 2', 'Radio 3'],
                        dotPrefix: 'rad-1-radio-',
                        circlePrefix: 'rad-1-radio-',
                    },
                    layout: { width: 'content', height: 'content', direction: 'column', gap: 8 },
                    children: [radioItem('rad-1', 0, 'Radio 1'), radioItem('rad-1', 1, 'Radio 2'), radioItem('rad-1', 2, 'Radio 3')],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(radioGroupController);
    runtime.loadFromAsset(buildRadioAsset());
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('radio-group selection visuals', () => {
    it('shows only the selected dot after mount', () => {
        const runtime = prepareRuntime();
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-0-dot')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-1-dot')!)?.visible).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-2-dot')!)?.visible).toBe(false);
    });

    it('selects the pressed circle and flips dot visibility', () => {
        const runtime = prepareRuntime();
        const group = runtime.getBoundWidget('rad-1')!;
        const circle1 = runtime.getBoundWidget('rad-1-radio-1-circle')!;
        const at = centerOf(runtime, circle1);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });

        expect(getRadioGroupSelectedIndex(runtime, group)).toBe(1);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-1-dot')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-0-dot')!)?.visible).toBe(false);
    });

    it('cycles selection with arrow keys', () => {
        const runtime = prepareRuntime();
        const group = runtime.getBoundWidget('rad-1')!;
        expect(runtime.setFocus(group)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowDown' });
        expect(getRadioGroupSelectedIndex(runtime, group)).toBe(1);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowUp' });
        expect(getRadioGroupSelectedIndex(runtime, group)).toBe(0);
    });

    it('applies an externally committed selectedIndex', () => {
        const runtime = prepareRuntime();
        const group = runtime.getBoundWidget('rad-1')!;
        runtime.updateWidget(group, { props: { selectedIndex: 2 } });
        expect(getRadioGroupSelectedIndex(runtime, group)).toBe(2);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-2-dot')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('rad-1-radio-0-dot')!)?.visible).toBe(false);
    });
});
