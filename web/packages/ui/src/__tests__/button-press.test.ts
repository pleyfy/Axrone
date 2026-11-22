import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime } from '../index';
import { buttonFeedbackController } from '../controls/button-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const buildButtonAsset = (enabled: boolean): UIAsset =>
    ({
        id: 'test-btn-press',
        name: 'test-btn-press',
        version: 1,
        canvas: {
            referenceWidth: 800,
            referenceHeight: 600,
            scaleMode: 'match-width-or-height',
            matchBias: 0.5,
        },
        bindings: { root: 'root', 'btn-1': 'btn-1', 'btn-1-label': 'btn-1-label' },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'button',
                    key: 'btn-1',
                    enabled,
                    interactive: true,
                    controller: 'button-feedback',
                    props: {
                        states: {
                            normal: '#0a74daff',
                            hover: '#1b85ebff',
                            pressed: '#085bb5ff',
                            disabled: '#3a3a3aff',
                        },
                        transition: 'color',
                        onPress: 'tapped',
                    },
                    layout: {
                        width: 'content',
                        height: 'content',
                        padding: 12,
                        direction: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                    },
                    style: { background: '#0a74daff', radius: 8 },
                    children: [
                        {
                            role: 'text',
                            key: 'btn-1-label',
                            enabled: true,
                            interactive: false,
                            layout: { width: 'content', height: 'content' },
                            style: { color: '#ffffffff' },
                            text: {
                                value: 'Press me',
                                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                                size: 16,
                                weight: '600',
                                style: 'normal',
                                lineHeight: 20.8,
                                letterSpacing: 0,
                                align: 'center',
                                wrap: 'none',
                                overflow: 'ellipsis',
                            },
                            children: [],
                        },
                    ],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = (enabled: boolean) => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(buttonFeedbackController);
    runtime.loadFromAsset(buildButtonAsset(enabled));
    runtime.commit();
    return runtime;
};

const centerOf = (runtime: UIRuntime, widget: WidgetId) => {
    const box = runtime.getLayoutBox(widget);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('button-feedback press events', () => {
    it('emits onPress on down-inside + up-inside', () => {
        const runtime = prepareRuntime(true);
        const button = runtime.getBoundWidget('btn-1')!;
        const onPress = vi.fn();
        runtime.onControllerEvent(button, 'tapped', onPress);

        const at = centerOf(runtime, button);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });
        runtime.dispatchInput({ type: 'pointer', phase: 'up', x: at.x, y: at.y });

        expect(onPress).toHaveBeenCalledTimes(1);
        const payload = onPress.mock.calls[0]![0] as Record<string, unknown>;
        expect(typeof payload.x).toBe('number');
        expect(payload.pointerX).toBeCloseTo(at.x, 5);
        expect(payload.pointerY).toBeCloseTo(at.y, 5);
    });

    it('cancels silently when released outside', () => {
        const runtime = prepareRuntime(true);
        const button = runtime.getBoundWidget('btn-1')!;
        const onPress = vi.fn();
        runtime.onControllerEvent(button, 'tapped', onPress);

        const at = centerOf(runtime, button);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });
        runtime.dispatchInput({ type: 'pointer', phase: 'move', x: 700, y: 500 });
        runtime.dispatchInput({ type: 'pointer', phase: 'up', x: 700, y: 500 });

        expect(onPress).not.toHaveBeenCalled();
    });

    it('fires on Enter/Space for the focused button', () => {
        const runtime = prepareRuntime(true);
        const button = runtime.getBoundWidget('btn-1')!;
        const onPress = vi.fn();
        runtime.onControllerEvent(button, 'tapped', onPress);

        expect(runtime.setFocus(button)).toBe(true);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'Enter' });
        runtime.dispatchInput({ type: 'key', phase: 'down', key: ' ', repeat: true });

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('stays silent and renders disabled visuals when disabled', () => {
        const runtime = prepareRuntime(false);
        const button = runtime.getBoundWidget('btn-1')!;
        const onPress = vi.fn();
        runtime.onControllerEvent(button, 'tapped', onPress);

        const at = centerOf(runtime, button);
        runtime.dispatchInput({ type: 'pointer', phase: 'down', x: at.x, y: at.y });
        runtime.dispatchInput({ type: 'pointer', phase: 'up', x: at.x, y: at.y });

        expect(onPress).not.toHaveBeenCalled();
        expect(runtime.getWidgetStyleInput(button)?.background).toBe('#3a3a3aff');
    });

    it('paints the authored normal state on mount', () => {
        const runtime = prepareRuntime(true);
        const button = runtime.getBoundWidget('btn-1')!;
        expect(runtime.getWidgetStyleInput(button)?.background).toBe('#0a74daff');
    });
});
