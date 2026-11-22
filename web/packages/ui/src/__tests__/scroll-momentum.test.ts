import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, createUIScrollView } from '../index';
import { createTestFontAsset } from './test-font';

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 480, height: 240 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    return runtime;
};

describe('scroll-view wheel momentum', () => {
    it('preserves wheel velocity and advances scroll after wheel stops', () => {
        vi.useFakeTimers();
        const rafQueue: Array<(time: number) => void> = [];
        const originalRaf = (globalThis as unknown as Record<string, unknown>)['requestAnimationFrame'];
        const originalCaf = (globalThis as unknown as Record<string, unknown>)['cancelAnimationFrame'];
        (globalThis as unknown as Record<string, unknown>)['requestAnimationFrame'] = ((cb: (time: number) => void) => {
            rafQueue.push(cb);
            return rafQueue.length;
        }) as unknown;
        (globalThis as unknown as Record<string, unknown>)['cancelAnimationFrame'] = (() => {}) as unknown;
        try {
            const runtime = prepareRuntime();
            const scroll = createUIScrollView(runtime, {
                layout: { width: 200, height: 100 },
            });
            runtime.commit();
            const rootBox = runtime.getLayoutBox(scroll.root);
            const centerX = rootBox.x + rootBox.width / 2;
            const centerY = rootBox.y + rootBox.height / 2;
            const before = scroll.getScroll();
            runtime.dispatchInput({
                type: 'pointer',
                phase: 'wheel',
                x: centerX,
                y: centerY,
                deltaX: 0,
                deltaY: 20,
            } as never);
            const immediate = scroll.getScroll();
            expect(immediate.y).toBeGreaterThan(before.y);
            expect(immediate.y).toBeCloseTo(before.y + 20, 5);
            vi.advanceTimersByTime(120);
            expect(rafQueue.length).toBeGreaterThan(0);
            const beforeMomentum = scroll.getScroll().y;
            let guard = 0;
            while (rafQueue.length > 0 && guard < 5) {
                const cb = rafQueue.shift()!;
                cb(16);
                guard += 1;
            }
            const afterMomentum = scroll.getScroll().y;
            expect(afterMomentum).toBeGreaterThan(beforeMomentum);
            scroll.dispose();
            runtime.dispose();
        } finally {
            (globalThis as unknown as Record<string, unknown>)['requestAnimationFrame'] = originalRaf as unknown;
            (globalThis as unknown as Record<string, unknown>)['cancelAnimationFrame'] = originalCaf as unknown;
            vi.useRealTimers();
        }
    });
});
