import { describe, expect, it, vi } from 'vitest';
import {
    compileWidgetFocus,
    compileWidgetImage,
    compileWidgetStyle,
    compileWidgetText,
    normalizeWidgetRecord,
} from '../runtime/records';

describe('@axrone/ui runtime record compiler', () => {
    it('normalizes widget config into immutable-by-contract runtime records', () => {
        const pointerDown = vi.fn();
        const source = {
            props: { label: 'Play' },
            layout: { width: 120, anchor: { x: 0.5 } },
            style: { background: '#112233ff' },
            handlers: { pointerDown },
        };

        const record = normalizeWidgetRecord(source);

        expect(record.role).toBe('container');
        expect(record.controller).toBeNull();
        expect(record.enabled).toBe(true);
        expect(record.interactive).toBe(false);
        expect(record.props).toEqual({ label: 'Play' });
        expect(record.layoutInput).toEqual({ width: 120, anchor: { x: 0.5 } });
        expect(record.styleInput).toEqual({ background: '#112233ff' });
        expect(record.handlers?.pointerDown).toBe(pointerDown);
        expect(record.props).not.toBe(source.props);
        expect(record.layoutInput).not.toBe(source.layout);
    });

    it('compiles style, text, image, and focus inputs with clamped runtime defaults', () => {
        const style = compileWidgetStyle({
            opacity: 2,
            borderWidth: -4,
            color: '#336699cc',
            radius: 6,
        });
        const text = compileWidgetText(
            {
                value: 'Axrone',
                size: 0,
                weight: 'bold',
                maxLines: 0,
                caretIndex: 4.8,
                selectionStart: Number.POSITIVE_INFINITY,
            },
            {
                defaultFamily: 'Inter',
                locale: 'tr',
                fallbackColor: style.color,
            }
        );
        const image = compileWidgetImage({
            source: { kind: 'texture', resourceId: 'hero', width: 0, height: -5 },
            alignX: 4,
            alignY: -2,
            uvRect: { x: 0.25, y: 0.25, width: 1, height: 1 },
        });
        const focus = compileWidgetFocus({}, true);

        expect(style.opacity).toBe(1);
        expect(style.borderWidth).toBe(0);
        expect(style.radius.topLeft).toBe(6);
        expect(text?.family).toBe('Inter');
        expect(text?.locale).toBe('tr');
        expect(text?.size).toBe(1);
        expect(text?.weight).toBe(700);
        expect(text?.maxLines).toBe(1);
        expect(text?.caretIndex).toBe(4);
        expect(text?.selectionStart).toBeNull();
        expect(image?.source.width).toBe(1);
        expect(image?.source.height).toBe(1);
        expect(image?.alignX).toBe(1);
        expect(image?.alignY).toBe(0);
        expect(image?.uvRect.width).toBe(0.75);
        expect(image?.uvRect.height).toBe(0.75);
        expect(focus.focusable).toBe(true);
    });
});
