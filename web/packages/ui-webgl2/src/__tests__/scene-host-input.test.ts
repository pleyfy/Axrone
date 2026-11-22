import { describe, expect, it, vi } from 'vitest';
import { __testConnectUIHostInput } from '../scene-host';

type Listener = (event: never) => void;

const createTarget = (rect: { left: number; top: number; width: number; height: number }) => {
    const listeners = new Map<string, Listener[]>();
    return {
        listeners,
        rect,
        addEventListener(type: string, listener: Listener) {
            const list = listeners.get(type) ?? [];
            list.push(listener);
            listeners.set(type, list);
        },
        removeEventListener(type: string, listener: Listener) {
            listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
        },
        getBoundingClientRect() {
            return { ...rect };
        },
        fire(type: string, event: Record<string, unknown>) {
            for (const listener of listeners.get(type) ?? []) {
                listener(event as never);
            }
        },
    };
};

const createHarness = () => {
    const target = createTarget({ left: 10, top: 20, width: 100, height: 100 });
    const dispatched: Array<{ method: string; event: Record<string, unknown> }> = [];
    const runtime = {
        getCanvasConfig: () => null,
        dispatchViewportInput: vi.fn((event: Record<string, unknown>) => {
            dispatched.push({ method: 'viewport', event });
            return true;
        }),
        dispatchInput: vi.fn((event: Record<string, unknown>) => {
            dispatched.push({ method: 'direct', event });
            return true;
        }),
    };
    const scene = {
        canvas: { width: 200, height: 200 },
        gl: { drawingBufferWidth: 200, drawingBufferHeight: 200 },
    };
    const disconnect = (__testConnectUIHostInput as unknown as (
        runtime: unknown,
        scene: unknown,
        input: unknown
    ) => () => void)(runtime, scene, { target });
    return { target, runtime, dispatched, disconnect };
};

describe('scene-host screen-overlay input wiring (preview parity)', () => {
    it('maps CSS pixels to reference pixels via dispatchInput', () => {
        const { target, runtime, disconnect } = createHarness();
        target.fire('pointerdown', { clientX: 60, clientY: 70, button: 0, pointerId: 1 });

        expect(runtime.dispatchInput).toHaveBeenCalledTimes(1);
        const event = runtime.dispatchInput.mock.calls[0][0] as Record<string, unknown>;
        // No canvas config: ((60-10)/100)*200 = 100, ((70-20)/100)*200 = 100
        expect(event.x).toBe(100);
        expect(event.y).toBe(100);
        expect(event.phase).toBe('down');
        disconnect();
    });

    it('uses a fresh bounding rect per event (no stale cache)', () => {
        const { target, runtime, disconnect } = createHarness();
        target.fire('pointermove', { clientX: 60, clientY: 70, pointerId: 1 });
        target.rect.left = 60;
        target.rect.top = 70;
        target.fire('pointermove', { clientX: 60, clientY: 70, pointerId: 1 });

        const calls = runtime.dispatchInput.mock.calls;
        expect(calls).toHaveLength(2);
        expect((calls[0][0] as Record<string, unknown>).x).toBe(100);
        // After the move the origin sits under the cursor: ((60-60)/100)*200 = 0
        expect((calls[1][0] as Record<string, unknown>).x).toBe(0);
        expect((calls[1][0] as Record<string, unknown>).y).toBe(0);
        disconnect();
    });

    it('ignores non-primary buttons on pointerdown', () => {
        const { target, runtime, disconnect } = createHarness();
        target.fire('pointerdown', { clientX: 60, clientY: 70, button: 2, pointerId: 1 });
        expect(runtime.dispatchInput).not.toHaveBeenCalled();
        disconnect();
    });

    it('treats pointercancel as pointerup so pressed state never sticks', () => {
        const { target, runtime, disconnect } = createHarness();
        target.fire('pointercancel', { clientX: 60, clientY: 70, pointerId: 1 });
        expect(runtime.dispatchInput).toHaveBeenCalledTimes(1);
        expect((runtime.dispatchInput.mock.calls[0][0] as Record<string, unknown>).phase).toBe(
            'up'
        );
        disconnect();
    });

    it('clears hover on pointerleave via an offscreen move (no dead leave phase)', () => {
        const { target, runtime, disconnect } = createHarness();
        target.fire('pointerleave', {});
        expect(runtime.dispatchInput).toHaveBeenCalledTimes(1);
        const event = runtime.dispatchInput.mock.calls[0][0] as Record<string, unknown>;
        expect(event.phase).toBe('move');
        expect(event.x).toBe(-1);
        expect(event.y).toBe(-1);
        disconnect();
    });

    it('forwards wheel with mapped coordinates', () => {
        const { target, runtime, disconnect } = createHarness();
        target.fire('wheel', { clientX: 60, clientY: 70, deltaY: 100 });
        expect(runtime.dispatchInput).toHaveBeenCalledTimes(1);
        expect((runtime.dispatchInput.mock.calls[0][0] as Record<string, unknown>).phase).toBe(
            'wheel'
        );
        disconnect();
    });

    it('disconnect removes every listener it added', () => {
        const { target, runtime, disconnect } = createHarness();
        disconnect();
        target.fire('pointerdown', { clientX: 60, clientY: 70, button: 0, pointerId: 1 });
        target.fire('pointermove', { clientX: 60, clientY: 70, pointerId: 1 });
        expect(runtime.dispatchInput).not.toHaveBeenCalled();
    });
});
