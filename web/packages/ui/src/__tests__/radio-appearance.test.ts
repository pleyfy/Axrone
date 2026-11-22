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

const buildRadioAsset = (extraProps: Record<string, unknown> = {}): UIAsset =>
    ({
        id: 'test-radio-appearance',
        name: 'test-radio-appearance',
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
                        dotPrefix: 'rad-1-radio-',
                        circlePrefix: 'rad-1-radio-',
                        ...extraProps,
                    },
                    layout: { width: 'content', height: 'content', direction: 'column', gap: 8 },
                    children: [radioItem('rad-1', 0, 'Radio 1'), radioItem('rad-1', 1, 'Radio 2'), radioItem('rad-1', 2, 'Radio 3')],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = (extraProps: Record<string, unknown> = {}) => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(radioGroupController);
    runtime.loadFromAsset(buildRadioAsset(extraProps));
    runtime.commit();
    return runtime;
};

const boxOf = (runtime: UIRuntime, key: string) => {
    const id = runtime.getBoundWidget(key);
    if (id === null) throw new Error(key);
    return runtime.getLayoutBox(id);
};

const styleOf = (runtime: UIRuntime, key: string) =>
    runtime.getWidgetStyleInput(runtime.getBoundWidget(key)!);

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('radio-group appearance props', () => {
    it('applies radioSize to circle layout and keeps authored size when absent', () => {
        const sized = prepareRuntime({ radioSize: 24 });
        expect(boxOf(sized, 'rad-1-radio-0-circle').width).toBeCloseTo(24, 5);
        expect(boxOf(sized, 'rad-1-radio-0-circle').height).toBeCloseTo(24, 5);
        const plain = prepareRuntime();
        expect(boxOf(plain, 'rad-1-radio-0-circle').width).toBeCloseTo(18, 5);
        expect(boxOf(plain, 'rad-1-radio-0-circle').height).toBeCloseTo(18, 5);
    });

    it('applies borderWidth to circle style and keeps authored width when absent', () => {
        const sized = prepareRuntime({ borderWidth: 3 });
        expect(styleOf(sized, 'rad-1-radio-0-circle')?.borderWidth).toBe(3);
        const plain = prepareRuntime();
        expect(styleOf(plain, 'rad-1-radio-0-circle')?.borderWidth).toBe(2);
    });

    it('maps shape to circle radius and keeps authored radius when absent', () => {
        expect(styleOf(prepareRuntime({ shape: 'circle' }), 'rad-1-radio-0-circle')?.radius).toBe(999);
        expect(styleOf(prepareRuntime({ shape: 'rounded' }), 'rad-1-radio-0-circle')?.radius).toBe(8);
        expect(styleOf(prepareRuntime({ shape: 'square' }), 'rad-1-radio-0-circle')?.radius).toBe(0);
        expect(styleOf(prepareRuntime(), 'rad-1-radio-0-circle')?.radius).toBe(999);
    });

    it('scales dots from dotScale with a 4px floor and keeps authored dots when absent', () => {
        const half = prepareRuntime({ dotScale: 50 });
        expect(boxOf(half, 'rad-1-radio-0-dot').width).toBeCloseTo(9, 5);
        expect(boxOf(half, 'rad-1-radio-0-dot').height).toBeCloseTo(9, 5);
        const tiny = prepareRuntime({ dotScale: 5 });
        expect(boxOf(tiny, 'rad-1-radio-0-dot').width).toBeCloseTo(4, 5);
        expect(boxOf(tiny, 'rad-1-radio-0-dot').height).toBeCloseTo(4, 5);
        const plain = prepareRuntime();
        expect(boxOf(plain, 'rad-1-radio-0-dot').width).toBeCloseTo(8, 5);
        expect(boxOf(plain, 'rad-1-radio-0-dot').height).toBeCloseTo(8, 5);
    });

    it('applies direction and itemSpacing to the root layout', () => {
        const horizontal = prepareRuntime({ direction: 'horizontal', itemSpacing: 20 });
        const h0 = boxOf(horizontal, 'rad-1-radio-0');
        const h1 = boxOf(horizontal, 'rad-1-radio-1');
        expect(h1.x - (h0.x + h0.width)).toBeCloseTo(20, 0);
        expect(h1.y).toBeCloseTo(h0.y, 0);
        const vertical = prepareRuntime({ direction: 'vertical', itemSpacing: 20 });
        const v0 = boxOf(vertical, 'rad-1-radio-0');
        const v1 = boxOf(vertical, 'rad-1-radio-1');
        expect(v1.y - (v0.y + v0.height)).toBeCloseTo(20, 0);
        expect(v1.x).toBeCloseTo(v0.x, 0);
    });
});

describe('radio-group behavior props', () => {
    it('deselects the selected row when allowDeselect is on and keeps it otherwise', () => {
        const free = prepareRuntime({ allowDeselect: true });
        const freeGroup = free.getBoundWidget('rad-1')!;
        const freeCircle = free.getBoundWidget('rad-1-radio-0-circle')!;
        const freeAt = centerOf(free, freeCircle);
        free.dispatchInput({ type: 'pointer', phase: 'down', x: freeAt.x, y: freeAt.y });
        free.commit();
        expect(getRadioGroupSelectedIndex(free, freeGroup)).toBe(-1);
        expect(styleOf(free, 'rad-1-radio-0-dot')?.visible).toBe(false);
        free.dispatchInput({ type: 'pointer', phase: 'down', x: freeAt.x, y: freeAt.y });
        free.commit();
        expect(getRadioGroupSelectedIndex(free, freeGroup)).toBe(0);

        const locked = prepareRuntime();
        const lockedGroup = locked.getBoundWidget('rad-1')!;
        const lockedCircle = locked.getBoundWidget('rad-1-radio-0-circle')!;
        const lockedAt = centerOf(locked, lockedCircle);
        locked.dispatchInput({ type: 'pointer', phase: 'down', x: lockedAt.x, y: lockedAt.y });
        locked.commit();
        expect(getRadioGroupSelectedIndex(locked, lockedGroup)).toBe(0);
    });

    it('only clamps an authored -1 when allowDeselect is on', () => {
        const free = prepareRuntime({ allowDeselect: true });
        const freeGroup = free.getBoundWidget('rad-1')!;
        free.updateWidget(freeGroup, { props: { selectedIndex: -1 } });
        expect(getRadioGroupSelectedIndex(free, freeGroup)).toBe(-1);
        const locked = prepareRuntime({ allowDeselect: false });
        const lockedGroup = locked.getBoundWidget('rad-1')!;
        locked.updateWidget(lockedGroup, { props: { selectedIndex: -1 } });
        expect(getRadioGroupSelectedIndex(locked, lockedGroup)).toBe(0);
    });

    it('selects on hover move only when selectOnHover is on', () => {
        const hover = prepareRuntime({ selectOnHover: true });
        const hoverGroup = hover.getBoundWidget('rad-1')!;
        const hoverCircle = hover.getBoundWidget('rad-1-radio-1-circle')!;
        const hoverAt = centerOf(hover, hoverCircle);
        hover.dispatchInput({ type: 'pointer', phase: 'move', x: hoverAt.x, y: hoverAt.y });
        hover.commit();
        expect(getRadioGroupSelectedIndex(hover, hoverGroup)).toBe(1);

        const plain = prepareRuntime();
        const plainGroup = plain.getBoundWidget('rad-1')!;
        const plainCircle = plain.getBoundWidget('rad-1-radio-1-circle')!;
        const plainAt = centerOf(plain, plainCircle);
        plain.dispatchInput({ type: 'pointer', phase: 'move', x: plainAt.x, y: plainAt.y });
        plain.commit();
        expect(getRadioGroupSelectedIndex(plain, plainGroup)).toBe(0);
    });

    it('ignores arrow keys when keyboardNav is off', () => {
        const locked = prepareRuntime({ keyboardNav: false });
        const lockedGroup = locked.getBoundWidget('rad-1')!;
        expect(locked.setFocus(lockedGroup)).toBe(true);
        locked.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowDown' });
        expect(getRadioGroupSelectedIndex(locked, lockedGroup)).toBe(0);
        const free = prepareRuntime({ keyboardNav: true });
        const freeGroup = free.getBoundWidget('rad-1')!;
        expect(free.setFocus(freeGroup)).toBe(true);
        free.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowDown' });
        expect(getRadioGroupSelectedIndex(free, freeGroup)).toBe(1);
    });
});
