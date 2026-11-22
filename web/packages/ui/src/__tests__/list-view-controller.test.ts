import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getListViewSelectedIndex, getListViewStartIndex } from '../index';
import { listViewController } from '../controls/list-view-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const LABELS = Array.from({ length: 20 }, (_, i) => `Item ${i}`);

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

const rowWidget = (index: number) => ({
    role: 'text',
    key: `lst-${index}`,
    enabled: true,
    interactive: true,
    layout: { width: 200, height: 32 },
    style: { background: '#00000000' },
    text: textBlock(''),
    children: [],
});

const buildListAsset = (): UIAsset =>
    ({
        id: 'test-list-view',
        name: 'test-list-view',
        version: 1,
        canvas: { referenceWidth: 800, referenceHeight: 600, scaleMode: 'match-width-or-height', matchBias: 0.5 },
        bindings: {
            root: 'root',
            lst: 'lst',
            'lst-0': 'lst-0',
            'lst-1': 'lst-1',
            'lst-2': 'lst-2',
            'lst-3': 'lst-3',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:list-view',
                    key: 'lst',
                    enabled: true,
                    interactive: true,
                    controller: 'list-view',
                    props: {
                        itemCount: 20,
                        itemHeight: 32,
                        itemPrefix: 'lst-',
                        selectedIndex: -1,
                        labels: [...LABELS],
                        startIndex: 0,
                        virtual: true,
                        onSelect: 'onSelect',
                        onScrollIndex: 'onScrollIndex',
                    },
                    layout: { position: 'absolute', inset: { left: 50, top: 50 }, width: 200, height: 128 },
                    children: [rowWidget(0), rowWidget(1), rowWidget(2), rowWidget(3)],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(listViewController);
    runtime.loadFromAsset(buildListAsset());
    runtime.commit();
    return runtime;
};

const listWidget = (runtime: UIRuntime): WidgetId => runtime.getBoundWidget('lst')!;

const frameTexts = (runtime: UIRuntime) =>
    runtime
        .commit()
        .commands.filter((c) => c.kind === 'text')
        .map((c) => (c.kind === 'text' ? c.layout.text : ''));

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('list-view controller with virtual pool', () => {
    it('places the pool window at startIndex 0 after mount', () => {
        const runtime = prepareRuntime();
        const texts = frameTexts(runtime);
        expect(texts).toContain('Item 0');
        expect(texts).toContain('Item 3');
        expect(texts).not.toContain('Item 4');
        const y0 = runtime.getLayoutBox(runtime.getBoundWidget('lst-0')!).y;
        const y1 = runtime.getLayoutBox(runtime.getBoundWidget('lst-1')!).y;
        const y2 = runtime.getLayoutBox(runtime.getBoundWidget('lst-2')!).y;
        const y3 = runtime.getLayoutBox(runtime.getBoundWidget('lst-3')!).y;
        expect(y1 - y0).toBeCloseTo(32, 5);
        expect(y2 - y1).toBeCloseTo(32, 5);
        expect(y3 - y2).toBeCloseTo(32, 5);
        expect(getListViewStartIndex(runtime, listWidget(runtime))).toBe(0);
        expect(getListViewSelectedIndex(runtime, listWidget(runtime))).toBe(-1);
    });

    it('shifts visible labels and boxes on wheel scroll and emits onScrollIndex', () => {
        const runtime = prepareRuntime();
        const list = listWidget(runtime);
        const handler = vi.fn();
        runtime.onControllerEvent(list, 'onScrollIndex', handler);
        const row = runtime.getBoundWidget('lst-1')!;
        const at = centerOf(runtime, row);
        const handled = runtime.dispatchInput({ type: 'pointer', phase: 'wheel', x: at.x, y: at.y, deltaY: 120 });
        expect(handled).toBe(true);
        expect(getListViewStartIndex(runtime, list)).toBe(1);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0]![0]).toEqual({ startIndex: 1 });
        const texts = frameTexts(runtime);
        expect(texts).toContain('Item 1');
        expect(texts).toContain('Item 4');
        expect(texts).not.toContain('Item 0');
        const y0 = runtime.getLayoutBox(runtime.getBoundWidget('lst-0')!).y;
        const y1 = runtime.getLayoutBox(runtime.getBoundWidget('lst-1')!).y;
        expect(y1 - y0).toBeCloseTo(32, 5);
    });

    it('selects the virtual index on pointer down and emits onSelect', () => {
        const runtime = prepareRuntime();
        const list = listWidget(runtime);
        const selectHandler = vi.fn();
        runtime.onControllerEvent(list, 'onSelect', selectHandler);
        const row1 = runtime.getBoundWidget('lst-1')!;
        const at1 = centerOf(runtime, row1);
        runtime.dispatchInput({ type: 'pointer', phase: 'wheel', x: at1.x, y: at1.y, deltaY: 120 });
        const row2 = runtime.getBoundWidget('lst-2')!;
        const at2 = centerOf(runtime, row2);
        const handled = runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at2.x, y: at2.y });
        expect(handled).toBe(true);
        expect(getListViewSelectedIndex(runtime, list)).toBe(3);
        expect(selectHandler).toHaveBeenCalledTimes(1);
        expect(selectHandler.mock.calls[0]![0]).toEqual({ index: 3 });
        expect(runtime.getWidgetStyleInput(row2)?.background).toBe('#8b5cf633');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('lst-0')!)?.background).toBe('#00000000');
    });

    it('applies externally committed selectedIndex and startIndex', () => {
        const runtime = prepareRuntime();
        const list = listWidget(runtime);
        runtime.updateWidget(list, { props: { startIndex: 5, selectedIndex: 5 } });
        expect(getListViewStartIndex(runtime, list)).toBe(5);
        expect(getListViewSelectedIndex(runtime, list)).toBe(5);
        const texts = frameTexts(runtime);
        expect(texts).toContain('Item 5');
        expect(texts).toContain('Item 8');
        expect(texts).not.toContain('Item 0');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('lst-0')!)?.background).toBe('#8b5cf633');
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('lst-1')!)?.background).toBe('#00000000');
    });
});
