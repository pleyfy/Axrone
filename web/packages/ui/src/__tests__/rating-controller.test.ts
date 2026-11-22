import { describe, expect, it, vi } from 'vitest';
import { UIRuntime, getRatingValue } from '../index';
import { RATING_CONTROLLER_TYPE, ratingController } from '../controls/rating-controller';
import type { UIAsset, WidgetId } from '../types';

const starChild = (index: number) => ({
    role: 'custom:rating-star',
    key: `rate-star-${index}`,
    enabled: true,
    interactive: false,
    layout: { position: 'absolute', inset: { left: index * 36, top: 0 }, width: 32, height: 32 },
    style: { background: '#475569ff' },
    children: [],
});

const buildRatingAsset = (props: Record<string, unknown>): UIAsset =>
    ({
        id: 'test-rating',
        name: 'test-rating',
        version: 1,
        canvas: { referenceWidth: 400, referenceHeight: 200, scaleMode: 'fixed', matchBias: 0.5 },
        bindings: {
            root: 'root',
            rate: 'rate',
            'rate-star-0': 'rate-star-0',
            'rate-star-1': 'rate-star-1',
            'rate-star-2': 'rate-star-2',
            'rate-star-3': 'rate-star-3',
            'rate-star-4': 'rate-star-4',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'custom:rating',
                    key: 'rate',
                    enabled: true,
                    interactive: true,
                    controller: RATING_CONTROLLER_TYPE,
                    props,
                    layout: { position: 'absolute', inset: { left: 10, top: 10 }, width: 180, height: 32 },
                    children: [starChild(0), starChild(1), starChild(2), starChild(3), starChild(4)],
                },
            ],
        },
    }) as unknown as UIAsset;

const defaultProps = (): Record<string, unknown> => ({
    value: 3,
    max: 5,
    starPrefix: 'rate-star-',
    filledColor: '#fbbf24ff',
    unfilledColor: '#475569ff',
    onRate: 'rated',
});

const prepareRuntime = (props: Record<string, unknown> = {}) => {
    const runtime = new UIRuntime({ width: 400, height: 200 });
    runtime.registry.register(ratingController);
    runtime.loadFromAsset(buildRatingAsset({ ...defaultProps(), ...props }));
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const backgroundOf = (runtime: UIRuntime, key: string) =>
    runtime.getWidgetStyleInput(runtime.getBoundWidget(key)!)?.background;

describe('rating controller', () => {
    it('paints filled stars up to value on mount', () => {
        const runtime = prepareRuntime({ value: 3 });
        expect(backgroundOf(runtime, 'rate-star-0')).toBe('#fbbf24ff');
        expect(backgroundOf(runtime, 'rate-star-1')).toBe('#fbbf24ff');
        expect(backgroundOf(runtime, 'rate-star-2')).toBe('#fbbf24ff');
        expect(backgroundOf(runtime, 'rate-star-3')).toBe('#475569ff');
        expect(backgroundOf(runtime, 'rate-star-4')).toBe('#475569ff');
        expect(getRatingValue(runtime, runtime.getBoundWidget('rate')!)).toBe(3);
        runtime.dispose();
    });

    it('sets value from star press and emits onRate', () => {
        const runtime = prepareRuntime({ value: 1 });
        const rate = runtime.getBoundWidget('rate')!;
        const callback = vi.fn();
        runtime.onControllerEvent(rate, 'rated', callback);
        const target = runtime.getBoundWidget('rate-star-4')!;
        const at = centerOf(runtime, target);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y } as never);
        expect(getRatingValue(runtime, rate)).toBe(5);
        expect(backgroundOf(runtime, 'rate-star-4')).toBe('#fbbf24ff');
        expect(backgroundOf(runtime, 'rate-star-0')).toBe('#fbbf24ff');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0]![0]).toEqual({ value: 5, max: 5 });
        runtime.dispose();
    });

    it('steps value with ArrowLeft and ArrowRight', () => {
        const runtime = prepareRuntime({ value: 2 });
        const rate = runtime.getBoundWidget('rate')!;
        const callback = vi.fn();
        runtime.onControllerEvent(rate, 'rated', callback);
        expect(runtime.setFocus(rate)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' } as never);
        expect(getRatingValue(runtime, rate)).toBe(3);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowLeft' } as never);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowLeft' } as never);
        expect(getRatingValue(runtime, rate)).toBe(1);
        expect(callback).toHaveBeenCalledTimes(3);
        runtime.dispose();
    });

    it('applies an externally committed value', () => {
        const runtime = prepareRuntime({ value: 1 });
        const rate = runtime.getBoundWidget('rate')!;
        runtime.updateWidget(rate, { props: { value: 4 } });
        expect(getRatingValue(runtime, rate)).toBe(4);
        expect(backgroundOf(runtime, 'rate-star-3')).toBe('#fbbf24ff');
        expect(backgroundOf(runtime, 'rate-star-4')).toBe('#475569ff');
        runtime.dispose();
    });

    it('returns null for a widget without rating state', () => {
        const runtime = prepareRuntime();
        expect(getRatingValue(runtime, runtime.getBoundWidget('rate-star-0')!)).toBeNull();
        runtime.dispose();
    });
});
