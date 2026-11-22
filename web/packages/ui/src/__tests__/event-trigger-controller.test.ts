import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { eventTriggerController, EVENT_TRIGGER_CONTROLLER_TYPE } from '../controls/event-trigger-controller';
import type { UIAsset } from '../types/ui-asset';

const pointer = (phase: 'down' | 'up' | 'move' | 'leave' | 'enter', x: number, y: number) =>
    ({
        type: 'pointer' as const,
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
    });

const createAssetJson = (props: Record<string, unknown>): string =>
    JSON.stringify({
        id: 'ui.event-trigger-test',
        name: 'event-trigger-test',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 400,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
            trigger: 'trigger',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'custom:event-trigger',
                    key: 'trigger',
                    enabled: true,
                    interactive: true,
                    controller: EVENT_TRIGGER_CONTROLLER_TYPE,
                    props,
                    layout: {
                        position: 'absolute',
                        inset: { left: 10, top: 10 },
                        width: 100,
                        height: 100,
                    },
                    style: { background: '#0a74daff' },
                    children: [],
                },
            ],
        },
    });

const createRuntime = (props: Record<string, unknown>): UIRuntime => {
    const runtime = new UIRuntime({ width: 400, height: 400 });
    runtime.registry.register(eventTriggerController);
    runtime.loadFromAsset(deserializeUIAsset(createAssetJson(props)) as UIAsset);
    runtime.commit();
    return runtime;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('@axrone/ui event-trigger-controller', () => {
    it('fires on down-inside + up-inside for press', () => {
        const runtime = createRuntime({ triggerActive: true, eventType: 'press', onFire: 'fired' });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'fired', callback);

        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('cancels when released outside', () => {
        const runtime = createRuntime({ triggerActive: true, eventType: 'press', onFire: 'fired' });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'fired', callback);

        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 350, 350));

        expect(callback).not.toHaveBeenCalled();
    });

    it('blocks the second fire when oneShot is set', () => {
        const runtime = createRuntime({ eventType: 'press', onFire: 'fired', oneShot: true });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'fired', callback);

        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));
        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('suppresses rapid refires inside debounceMs', () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const runtime = createRuntime({ eventType: 'press', onFire: 'fired', debounceMs: 200 });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'fired', callback);

        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));
        expect(callback).toHaveBeenCalledTimes(1);

        now += 50;
        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));
        expect(callback).toHaveBeenCalledTimes(1);

        now += 200;
        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('stays silent when triggerActive is false', () => {
        const runtime = createRuntime({ triggerActive: false, eventType: 'press', onFire: 'fired' });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'fired', callback);

        runtime.dispatchInput(pointer('down', 50, 50));
        runtime.dispatchInput(pointer('up', 50, 50));
        runtime.dispatchInput(pointer('move', 50, 50));

        expect(callback).not.toHaveBeenCalled();
    });

    it('fires hover on enter phase', () => {
        const runtime = createRuntime({ eventType: 'hover', onFire: 'hovered' });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'hovered', callback);

        runtime.dispatchInput(pointer('move', 50, 50));

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('fires focus through the focus hook', () => {
        const runtime = createRuntime({ eventType: 'focus', onFire: 'focused' });
        const trigger = runtime.getBoundWidget('trigger')!;
        const callback = vi.fn();
        runtime.onControllerEvent(trigger, 'focused', callback);

        runtime.setFocus(trigger, 'api');

        expect(callback).toHaveBeenCalledTimes(1);
    });
});
