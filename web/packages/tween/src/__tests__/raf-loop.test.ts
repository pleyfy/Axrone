import { describe, expect, it, vi, afterEach } from 'vitest';
import { RafLoop } from '../raf-loop';

describe('RafLoop', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('schedules one frame per start and stops when the step ends', () => {
        const queued: Array<() => void> = [];
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: any) => {
            queued.push(cb);
            return queued.length;
        });

        let calls = 0;
        const loop = new RafLoop(() => {
            calls++;
            return calls < 2;
        });

        loop.start();
        loop.start();
        expect(queued.length).toBe(1);

        queued[0]!();
        expect(calls).toBe(1);
        expect(queued.length).toBe(2);

        queued[1]!();
        expect(calls).toBe(2);
        expect(loop.isRunning).toBe(false);
    });

    it('stop cancels the pending frame', () => {
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 7);

        const loop = new RafLoop(() => true);
        loop.start();
        loop.stop();
        expect(cancelSpy).toHaveBeenCalled();
        expect(loop.isRunning).toBe(false);
    });

    it('immediate mode steps synchronously on start', () => {
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
        let calls = 0;
        const loop = new RafLoop(() => {
            calls++;
            return true;
        }, true);

        loop.start();
        expect(calls).toBe(1);
        expect(loop.isRunning).toBe(true);
        loop.stop();
    });
});
