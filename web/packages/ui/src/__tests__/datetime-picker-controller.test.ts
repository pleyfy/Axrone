import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getDateTimePickerValue, isDateTimePickerEditing } from '../index';
import { dateTimePickerController } from '../controls/datetime-picker-controller';
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

const buildDateTimeAsset = (props: Record<string, unknown>): UIAsset =>
    ({
        id: 'test-datetime-picker',
        name: 'test-datetime-picker',
        version: 1,
        canvas: { referenceWidth: 800, referenceHeight: 600, scaleMode: 'match-width-or-height', matchBias: 0.5 },
        bindings: {
            root: 'root',
            'dt-1': 'dt-1',
            'dt-1-display': 'dt-1-display',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:datetime-picker',
                    key: 'dt-1',
                    enabled: true,
                    interactive: true,
                    controller: 'datetime-picker',
                    props: {
                        value: '2026-09-21T10:30',
                        displayKey: 'dt-1-display',
                        onCommit: 'committed',
                        ...props,
                    },
                    layout: {
                        position: 'absolute',
                        inset: { left: 10, top: 10 },
                        width: 220,
                        height: 40,
                    },
                    children: [
                        {
                            role: 'text',
                            key: 'dt-1-display',
                            enabled: true,
                            interactive: false,
                            layout: { width: '100%', height: '100%' },
                            style: { color: '#e2e8f0ff' },
                            text: textBlock(''),
                            children: [],
                        },
                    ],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = (props: Record<string, unknown> = {}) => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(dateTimePickerController);
    runtime.loadFromAsset(buildDateTimeAsset(props));
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const frameTexts = (runtime: UIRuntime) =>
    runtime
        .commit()
        .commands.filter((c) => c.kind === 'text')
        .map((c) => (c.kind === 'text' ? c.layout.text : ''));

const pointerDown = (runtime: UIRuntime, widget: WidgetId) => {
    const at = centerOf(runtime, widget);
    runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });
};

const typeText = (runtime: UIRuntime, text: string) => {
    for (const char of text) {
        runtime.dispatchInput({ type: 'key', phase: 'down', key: char });
    }
};

describe('datetime-picker editing', () => {
    it('enters editing on pointer down and shows typed text in the display', () => {
        const runtime = prepareRuntime({ value: '' });
        const picker = runtime.getBoundWidget('dt-1')!;
        pointerDown(runtime, picker);
        expect(isDateTimePickerEditing(runtime, picker)).toBe(true);
        expect(runtime.getFocused()).toBe(picker);
        typeText(runtime, '2026');
        expect(frameTexts(runtime)).toContain('2026');
        expect(getDateTimePickerValue(runtime, picker)).toBe('');
    });

    it('deletes the last character on Backspace', () => {
        const runtime = prepareRuntime({ value: '' });
        const picker = runtime.getBoundWidget('dt-1')!;
        pointerDown(runtime, picker);
        typeText(runtime, '2026');
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'Backspace' });
        expect(frameTexts(runtime)).toContain('202');
        expect(getDateTimePickerValue(runtime, picker)).toBe('');
    });

    it('caps typed text at 16 characters', () => {
        const runtime = prepareRuntime({ value: '' });
        const picker = runtime.getBoundWidget('dt-1')!;
        pointerDown(runtime, picker);
        typeText(runtime, '2026-09-21T10:30XX');
        expect(frameTexts(runtime)).toContain('2026-09-21T10:30');
        expect(frameTexts(runtime)).not.toContain('2026-09-21T10:30XX');
    });

    it('ignores typing when not editing', () => {
        const runtime = prepareRuntime({ value: '' });
        const picker = runtime.getBoundWidget('dt-1')!;
        runtime.dispatchInput({ type: 'key', phase: 'down', key: '2' });
        expect(frameTexts(runtime)).not.toContain('2');
    });
});

describe('datetime-picker commit and cancel', () => {
    it('commits the draft on Enter and emits onCommit', () => {
        const runtime = prepareRuntime({ value: '' });
        const picker = runtime.getBoundWidget('dt-1')!;
        const onCommit = vi.fn();
        runtime.onControllerEvent(picker, 'committed', onCommit);
        pointerDown(runtime, picker);
        typeText(runtime, '2026-09-21T10:30');
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'Enter' });
        expect(getDateTimePickerValue(runtime, picker)).toBe('2026-09-21T10:30');
        expect(isDateTimePickerEditing(runtime, picker)).toBe(false);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit.mock.calls[0]![0]).toEqual({ value: '2026-09-21T10:30' });
    });

    it('cancels editing on Escape and restores the display', () => {
        const runtime = prepareRuntime();
        const picker = runtime.getBoundWidget('dt-1')!;
        const onCommit = vi.fn();
        runtime.onControllerEvent(picker, 'committed', onCommit);
        pointerDown(runtime, picker);
        typeText(runtime, '1999');
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'Escape' });
        expect(getDateTimePickerValue(runtime, picker)).toBe('2026-09-21T10:30');
        expect(isDateTimePickerEditing(runtime, picker)).toBe(false);
        expect(frameTexts(runtime)).toContain('2026-09-21T10:30');
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('datetime-picker external commit', () => {
    it('applies an externally committed value to the display', () => {
        const runtime = prepareRuntime();
        const picker = runtime.getBoundWidget('dt-1')!;
        runtime.updateWidget(picker, { props: { value: '2027-01-01T00:00' } });
        expect(getDateTimePickerValue(runtime, picker)).toBe('2027-01-01T00:00');
        expect(frameTexts(runtime)).toContain('2027-01-01T00:00');
    });
});
