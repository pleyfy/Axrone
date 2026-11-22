import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, getModalOpen } from '../index';
import { modalController } from '../controls/modal-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset, WidgetId } from '../types';

const buildModalAsset = (): UIAsset =>
    ({
        id: 'test-modal',
        name: 'test-modal',
        version: 1,
        canvas: { referenceWidth: 800, referenceHeight: 600, scaleMode: 'match-width-or-height', matchBias: 0.5 },
        bindings: {
            root: 'root',
            'mdl-1': 'mdl-1',
            'mdl-backdrop': 'mdl-backdrop',
            'mdl-panel': 'mdl-panel',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: 800, height: 600 },
            children: [
                {
                    role: 'custom:modal',
                    key: 'mdl-1',
                    enabled: true,
                    interactive: true,
                    controller: 'modal',
                    props: {
                        open: false,
                        backdropKey: 'mdl-backdrop',
                        panelKey: 'mdl-panel',
                        dismissOnOutside: true,
                        onClose: 'onClose',
                    },
                    layout: { position: 'absolute', inset: { left: 0, top: 0 }, width: 800, height: 600 },
                    children: [
                        {
                            role: 'container',
                            key: 'mdl-backdrop',
                            enabled: true,
                            interactive: true,
                            layout: { position: 'absolute', inset: { left: 0, top: 0 }, width: 800, height: 600 },
                            style: { background: '#00000088' },
                            children: [],
                        },
                        {
                            role: 'container',
                            key: 'mdl-panel',
                            enabled: true,
                            interactive: true,
                            layout: { position: 'absolute', inset: { left: 250, top: 200 }, width: 300, height: 200 },
                            style: { background: '#ffffffff' },
                            children: [],
                        },
                    ],
                },
            ],
        },
    }) as unknown as UIAsset;

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 800, height: 600 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(modalController);
    runtime.loadFromAsset(buildModalAsset());
    runtime.commit();
    return runtime;
};

const modalWidget = (runtime: UIRuntime): WidgetId => runtime.getBoundWidget('mdl-1')!;

describe('modal controller', () => {
    it('keeps panel and backdrop hidden while closed after mount', () => {
        const runtime = prepareRuntime();
        expect(getModalOpen(runtime, modalWidget(runtime))).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('mdl-backdrop')!)?.visible).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('mdl-panel')!)?.visible).toBe(false);
    });

    it('shows panel and backdrop after an external open commit', () => {
        const runtime = prepareRuntime();
        runtime.updateWidget(modalWidget(runtime), { props: { open: true } });
        expect(getModalOpen(runtime, modalWidget(runtime))).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('mdl-backdrop')!)?.visible).toBe(true);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('mdl-panel')!)?.visible).toBe(true);
    });

    it('closes and emits onClose when pressing outside the panel', () => {
        const runtime = prepareRuntime();
        const modal = modalWidget(runtime);
        runtime.updateWidget(modal, { props: { open: true } });
        const handler = vi.fn();
        runtime.onControllerEvent(modal, 'onClose', handler);
        const handled = runtime.dispatchInput({ type: 'pointer', phase: 'down', x: 10, y: 10 });
        expect(handled).toBe(true);
        expect(getModalOpen(runtime, modal)).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('mdl-backdrop')!)?.visible).toBe(false);
        expect(runtime.getWidgetStyleInput(runtime.getBoundWidget('mdl-panel')!)?.visible).toBe(false);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0]![0]).toEqual({ dismissed: true });
    });

    it('ignores presses inside the panel', () => {
        const runtime = prepareRuntime();
        const modal = modalWidget(runtime);
        runtime.updateWidget(modal, { props: { open: true } });
        runtime.commit();
        const handler = vi.fn();
        runtime.onControllerEvent(modal, 'onClose', handler);
        const panel = runtime.getBoundWidget('mdl-panel')!;
        const box = runtime.getLayoutBox(panel);
        const handled = runtime.dispatchInput({
            type: 'pointer',
            phase: 'down',
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        });
        expect(handled).toBe(false);
        expect(getModalOpen(runtime, modal)).toBe(true);
        expect(handler).not.toHaveBeenCalled();
        expect(runtime.getWidgetStyleInput(panel)?.visible).toBe(true);
    });
});
