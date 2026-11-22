import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getStepperValue } from '../index';
import { STEPPER_CONTROLLER_TYPE, stepperController } from '../controls/stepper-controller';
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

const buildStepperAsset = (props: Record<string, unknown>): UIAsset =>
    ({
        id: 'test-stepper',
        name: 'test-stepper',
        version: 1,
        canvas: { referenceWidth: 400, referenceHeight: 200, scaleMode: 'fixed', matchBias: 0.5 },
        bindings: {
            root: 'root',
            stepper: 'stepper',
            'stepper-minus': 'stepper-minus',
            'stepper-value': 'stepper-value',
            'stepper-plus': 'stepper-plus',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'custom:stepper',
                    key: 'stepper',
                    enabled: true,
                    interactive: true,
                    controller: STEPPER_CONTROLLER_TYPE,
                    props,
                    layout: { position: 'absolute', inset: { left: 10, top: 10 }, width: 180, height: 40 },
                    children: [
                        {
                            role: 'custom:stepper-minus',
                            key: 'stepper-minus',
                            enabled: true,
                            interactive: false,
                            layout: { position: 'absolute', inset: { left: 0, top: 0 }, width: 40, height: 40 },
                            style: { background: '#334155ff' },
                            children: [],
                        },
                        {
                            role: 'text',
                            key: 'stepper-value',
                            enabled: true,
                            interactive: false,
                            layout: { position: 'absolute', inset: { left: 40, top: 0 }, width: 100, height: 40 },
                            style: { color: '#e2e8f0ff' },
                            text: textBlock('5'),
                            children: [],
                        },
                        {
                            role: 'custom:stepper-plus',
                            key: 'stepper-plus',
                            enabled: true,
                            interactive: false,
                            layout: { position: 'absolute', inset: { left: 140, top: 0 }, width: 40, height: 40 },
                            style: { background: '#334155ff' },
                            children: [],
                        },
                    ],
                },
            ],
        },
    }) as unknown as UIAsset;

const defaultProps = (): Record<string, unknown> => ({
    value: 5,
    min: 0,
    max: 10,
    step: 1,
    minusKey: 'stepper-minus',
    plusKey: 'stepper-plus',
    valueKey: 'stepper-value',
    onChange: 'changed',
});

const prepareRuntime = (props: Record<string, unknown> = {}) => {
    const runtime = new UIRuntime({ width: 400, height: 200 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(stepperController);
    runtime.loadFromAsset(buildStepperAsset({ ...defaultProps(), ...props }));
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

const opacityOf = (runtime: UIRuntime, key: string) =>
    runtime.getWidgetStyleInput(runtime.getBoundWidget(key)!)?.opacity;

describe('stepper controller', () => {
    it('writes the value text on mount', () => {
        const runtime = prepareRuntime({ value: 5 });
        const stepper = runtime.getBoundWidget('stepper')!;
        expect(getStepperValue(runtime, stepper)).toBe(5);
        expect(frameTexts(runtime)).toContain('5');
        runtime.dispose();
    });

    it('increments on plus press and emits onChange', () => {
        const runtime = prepareRuntime({ value: 5 });
        const stepper = runtime.getBoundWidget('stepper')!;
        const callback = vi.fn();
        runtime.onControllerEvent(stepper, 'changed', callback);
        const plus = runtime.getBoundWidget('stepper-plus')!;
        const at = centerOf(runtime, plus);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y } as never);
        expect(getStepperValue(runtime, stepper)).toBe(6);
        expect(frameTexts(runtime)).toContain('6');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0]![0]).toEqual({ value: 6 });
        runtime.dispose();
    });

    it('decrements on minus press', () => {
        const runtime = prepareRuntime({ value: 5 });
        const stepper = runtime.getBoundWidget('stepper')!;
        const minus = runtime.getBoundWidget('stepper-minus')!;
        const at = centerOf(runtime, minus);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y } as never);
        expect(getStepperValue(runtime, stepper)).toBe(4);
        expect(frameTexts(runtime)).toContain('4');
        runtime.dispose();
    });

    it('clamps at bounds and dims the exhausted button', () => {
        const runtime = prepareRuntime({ value: 10 });
        const stepper = runtime.getBoundWidget('stepper')!;
        expect(opacityOf(runtime, 'stepper-plus')).toBe(0.45);
        expect(opacityOf(runtime, 'stepper-minus')).toBe(1);
        const plus = runtime.getBoundWidget('stepper-plus')!;
        const atPlus = centerOf(runtime, plus);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: atPlus.x, y: atPlus.y } as never);
        expect(getStepperValue(runtime, stepper)).toBe(10);
        runtime.updateWidget(stepper, { props: { value: 0 } });
        expect(getStepperValue(runtime, stepper)).toBe(0);
        expect(opacityOf(runtime, 'stepper-minus')).toBe(0.45);
        expect(opacityOf(runtime, 'stepper-plus')).toBe(1);
        const minus = runtime.getBoundWidget('stepper-minus')!;
        const atMinus = centerOf(runtime, minus);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: atMinus.x, y: atMinus.y } as never);
        expect(getStepperValue(runtime, stepper)).toBe(0);
        runtime.dispose();
    });

    it('steps with ArrowLeft and ArrowRight', () => {
        const runtime = prepareRuntime({ value: 5, step: 2 });
        const stepper = runtime.getBoundWidget('stepper')!;
        expect(runtime.setFocus(stepper)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' } as never);
        expect(getStepperValue(runtime, stepper)).toBe(7);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowLeft' } as never);
        expect(getStepperValue(runtime, stepper)).toBe(5);
        runtime.dispose();
    });

    it('applies an externally committed value to text and dim', () => {
        const runtime = prepareRuntime({ value: 5 });
        const stepper = runtime.getBoundWidget('stepper')!;
        runtime.updateWidget(stepper, { props: { value: 9 } });
        expect(getStepperValue(runtime, stepper)).toBe(9);
        expect(frameTexts(runtime)).toContain('9');
        expect(opacityOf(runtime, 'stepper-plus')).toBe(1);
        runtime.updateWidget(stepper, { props: { value: 10 } });
        expect(opacityOf(runtime, 'stepper-plus')).toBe(0.45);
        runtime.dispose();
    });

    it('returns null for a widget without stepper state', () => {
        const runtime = prepareRuntime();
        expect(getStepperValue(runtime, runtime.getBoundWidget('stepper-minus')!)).toBeNull();
        runtime.dispose();
    });
});
