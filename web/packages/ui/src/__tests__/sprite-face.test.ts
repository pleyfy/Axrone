import { describe, expect, it } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime } from '../index';
import { buttonFeedbackController, BUTTON_FEEDBACK_CONTROLLER_TYPE } from '../controls/button-controller';
import { createTestFontAsset } from './test-font';
import type { ImageRenderCommand, QuadRenderCommand, TextRenderCommand, UIAsset } from '../types';

const BUTTON_X = 50;
const BUTTON_Y = 50;
const BUTTON_W = 120;
const BUTTON_H = 40;

const createAsset = (transition: string): UIAsset =>
    ({
        id: 'ui.sprite-face',
        name: 'sprite-face',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 200,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: { root: 'root', button: 'button', 'button-label': 'button-label' },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'button',
                    key: 'button',
                    enabled: true,
                    interactive: true,
                    controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
                    style: { background: '#0a74daff', borderColor: '#ffffffff', borderWidth: 2, radius: 8 },
                    image: {
                        source: { kind: 'texture', resourceId: 'btn_normal.png', width: 256, height: 128 },
                    },
                    props: {
                        transition,
                        states: { normal: '#0a74daff' },
                        sprites: {
                            normal: { kind: 'texture', resourceId: 'btn_normal.png', width: 256, height: 128 },
                        },
                    },
                    layout: {
                        position: 'absolute',
                        inset: { left: BUTTON_X, top: BUTTON_Y },
                        width: BUTTON_W,
                        height: BUTTON_H,
                        padding: 12,
                    },
                    children: [
                        {
                            role: 'text',
                            key: 'button-label',
                            enabled: true,
                            interactive: false,
                            layout: { width: 'content', height: 'content' },
                            style: { color: '#ffffffff' },
                            text: {
                                value: 'Button',
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

const createRuntime = (transition: string) => {
    const runtime = new UIRuntime({ width: 400, height: 200 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(buttonFeedbackController);
    runtime.loadFromAsset(createAsset(transition));
    return runtime;
};

const buttonWidget = (runtime: UIRuntime) => runtime.getBoundWidget('button')!;

describe('sprite mode draws the sprite as the button surface', () => {
    it('suppresses the fill quad and bleeds the sprite across the border box', () => {
        const runtime = createRuntime('sprite');
        const widget = buttonWidget(runtime);
        const frame = runtime.commit();

        const buttonQuads = frame.commands.filter(
            (command): command is QuadRenderCommand =>
                command.kind === 'quad' && command.widget === widget
        );
        expect(buttonQuads).toHaveLength(0);

        const image = frame.commands.find(
            (command): command is ImageRenderCommand =>
                command.kind === 'image' && command.widget === widget
        );
        expect(image).toBeDefined();
        expect(image!.x).toBeCloseTo(BUTTON_X);
        expect(image!.y).toBeCloseTo(BUTTON_Y);
        expect(image!.width).toBeCloseTo(BUTTON_W);
        expect(image!.height).toBeCloseTo(BUTTON_H);
        // The sprite keeps the authored corner radius so its silhouette matches
        // the primitive button it replaces.
        expect(image!.radius.topLeft).toBeCloseTo(8);

        runtime.dispose();
    });

    it('keeps the label rendering above the sprite', () => {
        const runtime = createRuntime('sprite');
        const frame = runtime.commit();

        const text = frame.commands.find(
            (command): command is TextRenderCommand =>
                command.kind === 'text' && command.layout.text === 'Button'
        );
        expect(text).toBeDefined();
        expect(text!.layout.glyphs.length).toBeGreaterThan(0);

        runtime.dispose();
    });

    it('restores the authored fill quad and inset image when switching to color mode', () => {
        const runtime = createRuntime('sprite');
        const widget = buttonWidget(runtime);

        runtime.updateWidget(widget, { props: { transition: 'color' } });
        const frame = runtime.commit();

        const quad = frame.commands.find(
            (command): command is QuadRenderCommand =>
                command.kind === 'quad' && command.widget === widget
        );
        expect(quad).toBeDefined();
        expect(quad!.color).toEqual({ r: 10 / 255, g: 116 / 255, b: 218 / 255, a: 1 });
        expect(quad!.borderWidth).toBeCloseTo(2);

        const image = frame.commands.find(
            (command): command is ImageRenderCommand =>
                command.kind === 'image' && command.widget === widget
        );
        expect(image).toBeDefined();
        // Back inside the padded content box.
        expect(image!.x).toBeCloseTo(BUTTON_X + 12);
        expect(image!.width).toBeCloseTo(BUTTON_W - 24);

        runtime.dispose();
    });
});
