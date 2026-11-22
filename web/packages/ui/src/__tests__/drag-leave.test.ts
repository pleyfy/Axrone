import { describe, expect, it, vi } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { dragController, isWidgetDragging } from '../controls/drag-controller';
import type { UIAsset } from '../types/ui-asset';

const pointer = (phase: 'down' | 'up' | 'move', x: number, y: number) => ({
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

const createDragAssetJson = (props: Record<string, unknown>): string =>
    JSON.stringify({
        id: 'ui.drag-leave-test',
        name: 'drag-leave-test',
        version: 1,
        canvas: {
            referenceWidth: 400,
            referenceHeight: 400,
            scaleMode: 'fixed',
            matchBias: 0.5,
        },
        bindings: {
            root: 'root',
            draggable: 'draggable',
        },
        root: {
            role: 'root',
            key: 'root',
            enabled: true,
            interactive: false,
            layout: { display: 'overlay', width: '100%', height: '100%' },
            children: [
                {
                    role: 'container',
                    key: 'draggable',
                    enabled: true,
                    interactive: true,
                    controller: 'widget-drag',
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

const createDragRuntime = (props: Record<string, unknown>): UIRuntime => {
    const runtime = new UIRuntime({ width: 400, height: 400 });
    runtime.registry.register(dragController);
    runtime.loadFromAsset(deserializeUIAsset(createDragAssetJson(props)) as UIAsset);
    runtime.commit();
    return runtime;
};

describe('drag pointer-capture on leave', () => {
    it('continues drag across leave and drops with preserved position', () => {
        const runtime = createDragRuntime({
            enabled: true,
            axis: 'both',
            onDragEnd: 'onDragEnd',
            onDrop: 'onDrop',
        });
        const draggable = runtime.getBoundWidget('draggable')!;
        const onEnd = vi.fn();
        const onDrop = vi.fn();
        runtime.onControllerEvent(draggable, 'onDragEnd', onEnd);
        runtime.onControllerEvent(draggable, 'onDrop', onDrop);
        const startBox = runtime.getLayoutBox(draggable);
        expect(startBox.x).toBe(10);
        expect(startBox.y).toBe(10);
        runtime.dispatchInput(pointer('down', 50, 50));
        expect(isWidgetDragging(runtime, draggable)).toBe(true);
        runtime.dispatchInput(pointer('move', 350, 350));
        expect(onEnd).not.toHaveBeenCalled();
        expect(isWidgetDragging(runtime, draggable)).toBe(true);
        runtime.dispatchInput(pointer('move', 80, 80));
        expect(isWidgetDragging(runtime, draggable)).toBe(true);
        runtime.commit();
        const movedBox = runtime.getLayoutBox(draggable);
        expect(movedBox.x).toBeCloseTo(40, 1);
        expect(movedBox.y).toBeCloseTo(40, 1);
        expect(movedBox.x).not.toBe(10);
        runtime.dispatchInput(pointer('up', 80, 80));
        expect(isWidgetDragging(runtime, draggable)).toBe(false);
        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onEnd).toHaveBeenCalledTimes(1);
        const dropPayload = onDrop.mock.calls[0]![0] as Record<string, unknown>;
        expect(dropPayload['x']).toBeCloseTo(40, 1);
        expect(dropPayload['y']).toBeCloseTo(40, 1);
        runtime.dispose();
    });
});
