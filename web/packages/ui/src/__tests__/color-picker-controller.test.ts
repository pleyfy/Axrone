import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getColorPickerSelectedIndex, getColorPickerValue } from '../index';
import { colorPickerController } from '../controls/color-picker-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const SWATCH_COLORS = [
    '#ff0000ff',
    '#00ff00ff',
    '#0000ffff',
    '#ffff00ff',
    '#ff00ffff',
    '#ffffffff',
];

const swatchNode = (rootKey: string, index: number) => ({
    role: 'custom:color-swatch',
    key: `${rootKey}-sw-${index}`,
    enabled: true,
    interactive: false,
    layout: { width: 24, height: 24 },
    style: { background: '#00000000', borderColor: '#00000000', borderWidth: 0, radius: 4 },
    children: [],
});

const buildColorPickerAsset = (props: Record<string, unknown>): UIAsset =>
    ({
        id: 'test-color-picker',
        name: 'test-color-picker',
        version: 1,
        canvas: { referenceWidth: 800, referenceHeight: 600, scaleMode: 'match-width-or-height', matchBias: 0.5 },
        bindings: {
            root: 'root',
            'cp-1': 'cp-1',
            'cp-1-preview': 'cp-1-preview',
            'cp-1-sw-0': 'cp-1-sw-0',
            'cp-1-sw-1': 'cp-1-sw-1',
            'cp-1-sw-2': 'cp-1-sw-2',
            'cp-1-sw-3': 'cp-1-sw-3',
            'cp-1-sw-4': 'cp-1-sw-4',
            'cp-1-sw-5': 'cp-1-sw-5',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:color-picker',
                    key: 'cp-1',
                    enabled: true,
                    interactive: true,
                    controller: 'color-picker',
                    props: {
                        value: '#ffffffff',
                        swatchPrefix: 'cp-1-sw-',
                        swatchCount: 6,
                        swatchColors: SWATCH_COLORS,
                        previewKey: 'cp-1-preview',
                        onPick: 'picked',
                        ...props,
                    },
                    layout: { width: 'content', height: 'content', direction: 'row', gap: 4 },
                    children: [
                        {
                            role: 'custom:color-preview',
                            key: 'cp-1-preview',
                            enabled: true,
                            interactive: false,
                            layout: { width: 48, height: 24 },
                            style: { background: '#00000000', radius: 4 },
                            children: [],
                        },
                        swatchNode('cp-1', 0),
                        swatchNode('cp-1', 1),
                        swatchNode('cp-1', 2),
                        swatchNode('cp-1', 3),
                        swatchNode('cp-1', 4),
                        swatchNode('cp-1', 5),
                    ],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = (props: Record<string, unknown> = {}) => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(colorPickerController);
    runtime.loadFromAsset(buildColorPickerAsset(props));
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('color-picker swatch painting', () => {
    it('paints every swatch background and marks the selected swatch on mount', () => {
        const runtime = prepareRuntime();
        for (let i = 0; i < SWATCH_COLORS.length; i++) {
            const swatch = runtime.getBoundWidget(`cp-1-sw-${i}`)!;
            expect(runtime.getWidgetStyleInput(swatch)?.background).toBe(SWATCH_COLORS[i]);
        }
        expect(getColorPickerValue(runtime, runtime.getBoundWidget('cp-1')!)).toBe('#ffffffff');
        expect(getColorPickerSelectedIndex(runtime, runtime.getBoundWidget('cp-1')!)).toBe(5);
        const selected = runtime.getBoundWidget('cp-1-sw-5')!;
        expect(runtime.getWidgetStyleInput(selected)?.borderColor).toBe('#ffffffff');
        expect(runtime.getWidgetStyleInput(selected)?.borderWidth).toBe(2);
        const plain = runtime.getBoundWidget('cp-1-sw-0')!;
        expect(runtime.getWidgetStyleInput(plain)?.borderWidth).toBe(0);
        const preview = runtime.getBoundWidget('cp-1-preview')!;
        expect(runtime.getWidgetStyleInput(preview)?.background).toBe('#ffffffff');
    });

    it('falls back to the gray scale when no swatchColors are authored', () => {
        const runtime = prepareRuntime({ swatchColors: undefined, value: undefined });
        expect(getColorPickerValue(runtime, runtime.getBoundWidget('cp-1')!)).toBe('#ffffffff');
        const first = runtime.getBoundWidget('cp-1-sw-0')!;
        expect(runtime.getWidgetStyleInput(first)?.background).toBe('#000000ff');
        const last = runtime.getBoundWidget('cp-1-sw-5')!;
        expect(runtime.getWidgetStyleInput(last)?.background).toBe('#ffffffff');
    });
});

describe('color-picker pointer selection', () => {
    it('selects the hit swatch, repaints preview and emits onPick', () => {
        const runtime = prepareRuntime();
        const picker = runtime.getBoundWidget('cp-1')!;
        const onPick = vi.fn();
        runtime.onControllerEvent(picker, 'picked', onPick);

        const target = runtime.getBoundWidget('cp-1-sw-2')!;
        const at = centerOf(runtime, target);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });

        expect(getColorPickerValue(runtime, picker)).toBe('#0000ffff');
        expect(getColorPickerSelectedIndex(runtime, picker)).toBe(2);
        const preview = runtime.getBoundWidget('cp-1-preview')!;
        expect(runtime.getWidgetStyleInput(preview)?.background).toBe('#0000ffff');
        expect(runtime.getWidgetStyleInput(target)?.borderColor).toBe('#ffffffff');
        expect(runtime.getWidgetStyleInput(target)?.borderWidth).toBe(2);
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick.mock.calls[0]![0]).toEqual({ value: '#0000ffff' });
    });
});

describe('color-picker keyboard navigation', () => {
    it('moves with ArrowLeft/Right and confirms with Enter', () => {
        const runtime = prepareRuntime();
        const picker = runtime.getBoundWidget('cp-1')!;
        const onPick = vi.fn();
        runtime.onControllerEvent(picker, 'picked', onPick);

        expect(runtime.setFocus(picker)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' });
        expect(getColorPickerSelectedIndex(runtime, picker)).toBe(0);
        expect(getColorPickerValue(runtime, picker)).toBe('#ff0000ff');
        expect(onPick).not.toHaveBeenCalled();

        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowLeft' });
        expect(getColorPickerSelectedIndex(runtime, picker)).toBe(5);
        expect(getColorPickerValue(runtime, picker)).toBe('#ffffffff');

        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'Enter' });
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick.mock.calls[0]![0]).toEqual({ value: '#ffffffff' });
    });
});

describe('color-picker external commit', () => {
    it('applies an externally committed value to preview and borders', () => {
        const runtime = prepareRuntime();
        const picker = runtime.getBoundWidget('cp-1')!;
        runtime.updateWidget(picker, { props: { value: '#00ff00ff' } });
        expect(getColorPickerValue(runtime, picker)).toBe('#00ff00ff');
        expect(getColorPickerSelectedIndex(runtime, picker)).toBe(1);
        const preview = runtime.getBoundWidget('cp-1-preview')!;
        expect(runtime.getWidgetStyleInput(preview)?.background).toBe('#00ff00ff');
        const selected = runtime.getBoundWidget('cp-1-sw-1')!;
        expect(runtime.getWidgetStyleInput(selected)?.borderWidth).toBe(2);
        const former = runtime.getBoundWidget('cp-1-sw-5')!;
        expect(runtime.getWidgetStyleInput(former)?.borderWidth).toBe(0);
    });
});
