import { describe, expect, it } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getSegmentedSelectedIndex } from '../index';
import { segmentedController } from '../controls/segmented-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const textBlock = (value: string, size = 12) => ({
    value,
    family: AXRONE_DEFAULT_UI_FONT_FAMILY,
    size,
    weight: '400',
    style: 'normal',
    lineHeight: size * 1.3,
    letterSpacing: 0,
    align: 'start',
    wrap: 'word',
    overflow: 'ellipsis',
});

const segmentItem = (index: number, label: string) => ({
    role: 'custom:segment',
    key: `seg-${index}`,
    enabled: true,
    interactive: false,
    layout: { width: 100, height: '100%' },
    style: { background: '#00000000', radius: 4 },
    children: [
        {
            role: 'text',
            key: `seg-${index}-text`,
            enabled: true,
            interactive: false,
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: textBlock(label),
            children: [],
        },
    ],
});

const buildAppearanceAsset = (props: Record<string, unknown>): UIAsset =>
    ({
        id: 'test-seg-appearance',
        name: 'test-seg-appearance',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 300,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
            host: 'host',
            'seg-0': 'seg-0',
            'seg-0-text': 'seg-0-text',
            'seg-1': 'seg-1',
            'seg-1-text': 'seg-1-text',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 400, height: 300 },
            children: [
                {
                    role: 'custom:segmented',
                    key: 'host',
                    enabled: true,
                    interactive: true,
                    controller: 'segmented-control',
                    props,
                    layout: {
                        position: 'absolute',
                        inset: { left: 0, top: 0 },
                        width: 400,
                        height: 32,
                        direction: 'row',
                        gap: 0,
                        padding: 2,
                    },
                    style: { background: '#1e293bff', radius: 6 },
                    children: [segmentItem(0, 'A'), segmentItem(1, 'B')],
                },
            ],
        },
    }) as unknown as UIAsset;

const baseProps = (): Record<string, unknown> => ({
    selectedIndex: 0,
    segmentCount: 2,
    segmentPrefix: 'seg-',
    selectedBackground: '#ff0000ff',
    unselectedBackground: '#00ff00ff',
    barHeight: 48,
    segmentSpacing: 8,
    cornerRadius: 10,
    backgroundColor: '#111111ff',
    paddingH: 12,
    idleTextColor: '#888888ff',
    activeTextColor: '#ffffffff',
});

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(segmentedController);
    return runtime;
};

const pointerAtCenter = (runtime: UIRuntime, widget: WidgetId, phase: 'down' | 'move' | 'up') => {
    const box = runtime.getLayoutBox(widget);
    return {
        type: 'pointer' as const,
        phase,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
    };
};

describe('segmented-control appearance binding', () => {
    it('applies root measure, gap, radius, background and segment text colors', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildAppearanceAsset(baseProps()));
        runtime.commit();
        const host = runtime.getBoundWidget('host') as WidgetId;
        const seg0 = runtime.getBoundWidget('seg-0') as WidgetId;
        const seg1 = runtime.getBoundWidget('seg-1') as WidgetId;
        const text0 = runtime.getBoundWidget('seg-0-text') as WidgetId;
        const text1 = runtime.getBoundWidget('seg-1-text') as WidgetId;
        expect(runtime.getLayoutBox(host).height).toBeCloseTo(48, 4);
        expect(runtime.getWidgetStyleInput(host)?.background).toBe('#111111ff');
        expect(runtime.getWidgetStyleInput(host)?.radius).toBe(10);
        const box0 = runtime.getLayoutBox(seg0);
        const box1 = runtime.getLayoutBox(seg1);
        const hostBox = runtime.getLayoutBox(host);
        expect(box0.x - hostBox.x).toBeCloseTo(12, 4);
        expect(box1.x - (box0.x + box0.width)).toBeCloseTo(8, 4);
        expect(runtime.getWidgetStyleInput(seg0)?.background).toBe('#ff0000ff');
        expect(runtime.getWidgetStyleInput(seg1)?.background).toBe('#00ff00ff');
        expect(runtime.getWidgetStyleInput(text0)?.color).toBe('#ffffffff');
        expect(runtime.getWidgetStyleInput(text1)?.color).toBe('#888888ff');
        expect(getSegmentedSelectedIndex(runtime, host)).toBe(0);
    });

    it('applies externally committed appearance props without resetting selection', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildAppearanceAsset(baseProps()));
        runtime.commit();
        const host = runtime.getBoundWidget('host') as WidgetId;
        const seg1 = runtime.getBoundWidget('seg-1') as WidgetId;
        runtime.dispatchInput(pointerAtCenter(runtime, seg1, 'down'));
        runtime.commit();
        expect(getSegmentedSelectedIndex(runtime, host)).toBe(1);
        runtime.updateWidget(host, {
            props: {
                barHeight: 56,
                segmentSpacing: 4,
                cornerRadius: 14,
                backgroundColor: '#222222ff',
                paddingH: 6,
                selectedBackground: '#00ffffff',
                activeTextColor: '#ff00ffff',
            },
        });
        runtime.commit();
        expect(getSegmentedSelectedIndex(runtime, host)).toBe(1);
        expect(runtime.getLayoutBox(host).height).toBeCloseTo(56, 4);
        expect(runtime.getWidgetStyleInput(host)?.background).toBe('#222222ff');
        expect(runtime.getWidgetStyleInput(host)?.radius).toBe(14);
        const seg0 = runtime.getBoundWidget('seg-0') as WidgetId;
        const text1 = runtime.getBoundWidget('seg-1-text') as WidgetId;
        expect(runtime.getWidgetStyleInput(seg1)?.background).toBe('#00ffffff');
        expect(runtime.getWidgetStyleInput(seg0)?.background).toBe('#00ff00ff');
        expect(runtime.getWidgetStyleInput(text1)?.color).toBe('#ff00ffff');
        const box0 = runtime.getLayoutBox(seg0);
        const box1 = runtime.getLayoutBox(seg1);
        expect(box1.x - (box0.x + box0.width)).toBeCloseTo(4, 4);
    });

    it('keeps pointer and external index selection in sync with visuals', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(buildAppearanceAsset(baseProps()));
        runtime.commit();
        const host = runtime.getBoundWidget('host') as WidgetId;
        const seg0 = runtime.getBoundWidget('seg-0') as WidgetId;
        const seg1 = runtime.getBoundWidget('seg-1') as WidgetId;
        const text0 = runtime.getBoundWidget('seg-0-text') as WidgetId;
        const text1 = runtime.getBoundWidget('seg-1-text') as WidgetId;
        runtime.updateWidget(host, { props: { selectedIndex: 1 } });
        runtime.commit();
        expect(getSegmentedSelectedIndex(runtime, host)).toBe(1);
        expect(runtime.getWidgetStyleInput(seg1)?.background).toBe('#ff0000ff');
        expect(runtime.getWidgetStyleInput(seg0)?.background).toBe('#00ff00ff');
        expect(runtime.getWidgetStyleInput(text1)?.color).toBe('#ffffffff');
        expect(runtime.getWidgetStyleInput(text0)?.color).toBe('#888888ff');
        runtime.dispatchInput(pointerAtCenter(runtime, seg0, 'down'));
        runtime.commit();
        expect(getSegmentedSelectedIndex(runtime, host)).toBe(0);
        expect(runtime.getWidgetStyleInput(seg0)?.background).toBe('#ff0000ff');
        expect(runtime.getWidgetStyleInput(seg1)?.background).toBe('#00ff00ff');
        expect(runtime.getWidgetStyleInput(text0)?.color).toBe('#ffffffff');
        expect(runtime.getWidgetStyleInput(text1)?.color).toBe('#888888ff');
    });
});
