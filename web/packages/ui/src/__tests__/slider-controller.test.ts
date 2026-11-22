import { describe, expect, it } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import {
    SLIDER_CONTROLLER_TYPE,
    getSliderValue,
    sliderController,
} from '../controls/slider-controller';
import type { WidgetId } from '../types';

/**
 * Declarative slider authored the way the UI Editor's preset writes it: the
 * slider surface carries the controller and names its fill/handle children
 * through props, and every key is exposed through bindings.
 */
const createSliderAssetJson = (props: Record<string, unknown>): string =>
    JSON.stringify({
        id: 'ui.slider',
        name: 'slider',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 200,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
            slider: 'slider',
            'slider-track': 'slider-track',
            'slider-fill': 'slider-fill',
            'slider-handle': 'slider-handle',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'custom:slider',
                    key: 'slider',
                    enabled: true,
                    interactive: true,
                    controller: SLIDER_CONTROLLER_TYPE,
                    props,
                    layout: {
                        display: 'overlay',
                        position: 'absolute',
                        inset: { left: 0, top: 0 },
                        width: 200,
                        height: 20,
                    },
                    children: [
                        {
                            role: 'custom:slider-track',
                            key: 'slider-track',
                            enabled: true,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                anchor: { x: 0, y: 0.5, maxX: 1, maxY: 0.5, pivotY: 0.5 },
                                height: 6,
                            },
                            style: { background: '#334155ff', radius: 999 },
                            children: [],
                        },
                        {
                            role: 'custom:slider-fill',
                            key: 'slider-fill',
                            enabled: true,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                anchor: { x: 0, y: 0.5, pivotY: 0.5 },
                                inset: { left: 0 },
                                width: '0%',
                                height: 6,
                            },
                            style: { background: '#0a74daff', radius: 999 },
                            children: [],
                        },
                        {
                            role: 'custom:slider-handle',
                            key: 'slider-handle',
                            enabled: true,
                            interactive: false,
                            layout: {
                                position: 'absolute',
                                width: 16,
                                height: 16,
                                anchor: { x: 0, y: 0.5, pivotX: 0.5, pivotY: 0.5 },
                            },
                            style: { background: '#e2e8f0ff', radius: 999 },
                            children: [],
                        },
                    ],
                },
            ],
        },
    });

const createSliderRuntime = (props: Record<string, unknown> = {}) => {
    const runtime = new UIRuntime();
    runtime.registry.register(sliderController);
    runtime.loadFromAsset(
        deserializeUIAsset(
            createSliderAssetJson({
                min: 0,
                max: 100,
                value: 50,
                fillKey: 'slider-fill',
                handleKey: 'slider-handle',
                ...props,
            })
        )
    );
    runtime.commit();
    return runtime;
};

const sliderWidget = (runtime: UIRuntime): WidgetId => runtime.getBoundWidget('slider')!;

/** Pointer event on the slider surface, in canvas reference coordinates. */
const pointer = (phase: 'down' | 'move' | 'up', x: number, y = 10) =>
    ({
        type: 'pointer',
        phase,
        x,
        y,
        pointerId: 1,
        button: 0,
        buttons: phase === 'up' ? 0 : 1,
        deltaX: 0,
        deltaY: 0,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
    }) as never;

describe('slider-drag controller', () => {
    it('applies the authored value to the fill width', () => {
        const runtime = createSliderRuntime({ value: 25 });
        // Value 25 of 0..100 fills a quarter of the track.
        const fill = runtime.getBoundWidget('slider-fill')!;
        const fillBox = runtime.getLayoutBox(fill);
        const sliderBox = runtime.getLayoutBox(sliderWidget(runtime));

        expect(getSliderValue(runtime, sliderWidget(runtime))).toBe(25);
        expect(fillBox.width / sliderBox.width).toBeCloseTo(0.25, 2);

        runtime.dispose();
    });

    it('positions the handle along the track at the value', () => {
        const runtime = createSliderRuntime({ value: 100 });
        const handle = runtime.getBoundWidget('slider-handle')!;
        const handleBox = runtime.getLayoutBox(handle);
        const sliderBox = runtime.getLayoutBox(sliderWidget(runtime));

        // Fully right: the handle centre sits on the track's right edge.
        const handleCenter = handleBox.x + handleBox.width / 2;
        expect(handleCenter).toBeCloseTo(sliderBox.x + sliderBox.width, 1);

        runtime.dispose();
    });

    it('sets the value from a pointer press and follows the drag', () => {
        const runtime = createSliderRuntime({ value: 0 });
        const slider = sliderWidget(runtime);
        const box = runtime.getLayoutBox(slider);

        // Press at the midpoint of the surface.
        runtime.dispatchInput(pointer('down', box.x + box.width / 2));
        expect(getSliderValue(runtime, slider)).toBeCloseTo(50, 1);

        // Drag towards the right edge.
        runtime.dispatchInput(pointer('move', box.x + box.width * 0.9));
        expect(getSliderValue(runtime, slider)).toBeCloseTo(90, 1);

        // Release outside the widget still clamps into range.
        runtime.dispatchInput(pointer('up', box.x + box.width * 2));
        expect(getSliderValue(runtime, slider)).toBe(100);

        runtime.commit();
        const fill = runtime.getBoundWidget('slider-fill')!;
        expect(runtime.getLayoutBox(fill).width / box.width).toBeCloseTo(1, 2);

        runtime.dispose();
    });

    it('ignores pointer movement that did not start with a press', () => {
        const runtime = createSliderRuntime({ value: 10 });
        const slider = sliderWidget(runtime);
        const box = runtime.getLayoutBox(slider);

        runtime.dispatchInput(pointer('move', box.x + box.width * 0.8));

        expect(getSliderValue(runtime, slider)).toBe(10);

        runtime.dispose();
    });

    it('quantizes to the authored step', () => {
        const runtime = createSliderRuntime({ value: 0, step: 25 });
        const slider = sliderWidget(runtime);
        const box = runtime.getLayoutBox(slider);

        // 40% of 0..100 snaps to the nearest multiple of 25.
        runtime.dispatchInput(pointer('down', box.x + box.width * 0.4));

        expect(getSliderValue(runtime, slider)).toBe(50);

        runtime.dispose();
    });

    it('respects an inverted authored range', () => {
        const runtime = createSliderRuntime({ min: 100, max: 0, value: 30 });
        const slider = sliderWidget(runtime);

        // normalizeRange flips the bounds, so 30 stays inside 0..100.
        expect(getSliderValue(runtime, slider)).toBe(30);

        runtime.dispose();
    });

    it('clamps an out-of-range authored value', () => {
        const runtime = createSliderRuntime({ min: 0, max: 10, value: 999 });

        expect(getSliderValue(runtime, sliderWidget(runtime))).toBe(10);

        runtime.dispose();
    });

    it('steps with the arrow keys and jumps with Home/End', () => {
        const runtime = createSliderRuntime({ value: 50, step: 5 });
        const slider = sliderWidget(runtime);
        runtime.setFocus(slider, 'api');

        const key = (keyName: string) =>
            ({ type: 'key', phase: 'down', key: keyName, code: keyName, repeat: false }) as never;

        runtime.dispatchInput(key('ArrowRight'));
        expect(getSliderValue(runtime, slider)).toBe(55);

        runtime.dispatchInput(key('ArrowLeft'));
        expect(getSliderValue(runtime, slider)).toBe(50);

        runtime.dispatchInput(key('PageUp'));
        expect(getSliderValue(runtime, slider)).toBe(100);

        runtime.dispatchInput(key('Home'));
        expect(getSliderValue(runtime, slider)).toBe(0);

        runtime.dispatchInput(key('End'));
        expect(getSliderValue(runtime, slider)).toBe(100);

        runtime.dispose();
    });

    it('drives height instead of width when vertical', () => {
        const runtime = createSliderRuntime({ value: 50, orientation: 'vertical' });
        const fill = runtime.getBoundWidget('slider-fill')!;
        const slider = sliderWidget(runtime);
        const sliderBox = runtime.getLayoutBox(slider);

        expect(runtime.getLayoutBox(fill).height / sliderBox.height).toBeCloseTo(0.5, 1);

        runtime.dispose();
    });

    it('works without a fill or handle key', () => {
        const runtime = createSliderRuntime({ fillKey: '', handleKey: '', value: 20 });
        const slider = sliderWidget(runtime);
        const box = runtime.getLayoutBox(slider);

        expect(getSliderValue(runtime, slider)).toBe(20);
        // Interaction still tracks the value even with nothing to visualise.
        runtime.dispatchInput(pointer('down', box.x + box.width * 0.75));
        expect(getSliderValue(runtime, slider)).toBeCloseTo(75, 1);

        runtime.dispose();
    });

    it('returns null for a widget without slider state', () => {
        const runtime = createSliderRuntime();
        expect(getSliderValue(runtime, runtime.getBoundWidget('slider-track')!)).toBeNull();
        runtime.dispose();
    });

    it('places vertical min at bottom and max at top', () => {
        const minRuntime = createSliderRuntime({ value: 0, orientation: 'vertical' });
        const minSlider = sliderWidget(minRuntime);
        const minBox = minRuntime.getLayoutBox(minSlider);
        const minHandle = minRuntime.getBoundWidget('slider-handle')!;
        const minHandleBox = minRuntime.getLayoutBox(minHandle);
        expect(minHandleBox.y + minHandleBox.height / 2).toBeCloseTo(minBox.y + minBox.height, 0);
        minRuntime.dispose();
        const maxRuntime = createSliderRuntime({ value: 100, orientation: 'vertical' });
        const maxSlider = sliderWidget(maxRuntime);
        const maxBox = maxRuntime.getLayoutBox(maxSlider);
        const maxHandle = maxRuntime.getBoundWidget('slider-handle')!;
        const maxHandleBox = maxRuntime.getLayoutBox(maxHandle);
        expect(maxHandleBox.y + maxHandleBox.height / 2).toBeCloseTo(maxBox.y, 0);
        maxRuntime.dispose();
    });

    it('maps vertical pointer top to max and bottom to min', () => {
        const runtime = createSliderRuntime({ value: 50, orientation: 'vertical' });
        const slider = sliderWidget(runtime);
        const box = runtime.getLayoutBox(slider);
        runtime.dispatchInput(pointer('down', box.x + box.width / 2, box.y));
        expect(getSliderValue(runtime, slider)).toBe(100);
        runtime.dispatchInput(pointer('up', box.x + box.width / 2, box.y));
        runtime.dispatchInput(pointer('down', box.x + box.width / 2, box.y + box.height));
        expect(getSliderValue(runtime, slider)).toBe(0);
        runtime.dispose();
    });

    it('anchors vertical fill to the bottom', () => {
        const runtime = createSliderRuntime({ value: 50, orientation: 'vertical' });
        const fill = runtime.getBoundWidget('slider-fill')!;
        const slider = sliderWidget(runtime);
        const sliderBox = runtime.getLayoutBox(slider);
        const fillBox = runtime.getLayoutBox(fill);
        expect(fillBox.y + fillBox.height).toBeCloseTo(sliderBox.y + sliderBox.height, 0);
        runtime.dispose();
    });
});
