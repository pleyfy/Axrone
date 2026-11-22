import { describe, expect, it, vi } from 'vitest';
import { group, to } from '../utils';
import { Timeline } from '../timeline';
import { TweenChain } from '../chain';
import { waitFor } from '../utils';
import { TweenDispatcher } from '../dispatcher';

describe('hybrid regression coverage', () => {
    it('timeline fires item completion exactly once across frames', () => {
        const obj = { x: 0 };
        const t1 = to(obj, { x: 100 }, 50);
        let completions = 0;
        t1.on('complete', () => {
            completions++;
        });
        const tl = new Timeline().add(t1);
        tl.start(0);
        for (let time = 0; time <= 300; time += 10) {
            tl.update(time);
        }
        expect(obj.x).toBe(100);
        expect(completions).toBe(1);
        expect(tl.getStatus()).toBe('completed');
    });

    it('end() on a repeating tween completes with the final value', () => {
        const obj = { x: 0 };
        const tw = to(obj, { x: 100 }, 100).repeat(3);
        tw.start(0);
        tw.update(50);
        tw.end();
        expect(obj.x).toBe(100);
        expect(tw.getStatus()).toBe('completed');
        tw.update(100000);
        expect(tw.getStatus()).toBe('completed');
    });

    it('chain occupies non-overlapping windows on a master clock', () => {
        const obj = { x: 0 };
        const t1 = to(obj, { x: 10 }, 10);
        const t2 = to(obj, { x: 20 }, 10);
        const ch = new TweenChain().add(t1).add(t2);
        ch.start(0);
        for (let time = 0; time <= 10; time += 1) {
            ch.update(time);
        }
        expect(obj.x).toBeCloseTo(10, 5);
        for (let time = 11; time <= 30; time += 1) {
            ch.update(time);
        }
        expect(obj.x).toBeCloseTo(20, 5);
        expect(ch.getStatus()).toBe('completed');
    });

    it('total duration accounts for repeat delay', () => {
        const obj = { x: 0 };
        const tw = to(obj, { x: 100 }, 100).repeat(2).repeatDelay(50);
        expect(tw.getTotalDuration()).toBe(400);
    });

    it('waitFor settles on stop instead of hanging', async () => {
        const obj = { x: 0 };
        const tw = to(obj, { x: 100 }, 10000);
        tw.start(0);
        const pending = waitFor(tw);
        tw.stop();
        await expect(pending).resolves.toBeUndefined();
    });

    it('manual pause and resume with explicit time does not jump', () => {
        const obj = { x: 0 };
        const tw = to(obj, { x: 100 }, 100);
        tw.start(0);
        tw.update(40);
        tw.pause();
        tw.resume(140);
        tw.update(150);
        expect(obj.x).toBeCloseTo(50, 5);
    });

    it('listener-less updates never reach the emit path', () => {
        const spy = vi.spyOn(TweenDispatcher.prototype, 'emitUpdate');
        try {
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            tw.start(0);
            for (let time = 10; time <= 100; time += 10) {
                tw.update(time);
            }
            expect(spy).not.toHaveBeenCalled();
            expect(obj.x).toBe(100);
        } finally {
            spy.mockRestore();
        }
    });

    it('update listeners receive positional args without a payload box', () => {
        const obj = { x: 0 };
        const tw = to(obj, { x: 100 }, 100);
        const seen: Array<{ tween: unknown; elapsed: unknown }> = [];
        tw.on('update', (tween, elapsed) => {
            seen.push({ tween, elapsed });
        });
        tw.start(0);
        tw.update(50);
        expect(seen.length).toBe(1);
        expect(seen[0]!.tween).toBe(tw);
        expect(typeof seen[0]!.elapsed).toBe('number');
        expect(seen[0]!.elapsed).toBeCloseTo(0.5, 5);
    });

    it('tween-level interpolation blends the resolved start/end pair', () => {
        const obj = { arr: [0, 0] };
        const received: number[][] = [];
        const tw = to(obj, { arr: [100, 200] }, 100).interpolation((pair, k) => {
            received.push([pair[0]!, pair[1]!]);
            return pair[0]! + (pair[1]! - pair[0]!) * k;
        });
        tw.start(0);
        tw.update(50);
        expect(received.length).toBeGreaterThan(0);
        expect(received[0]).toEqual([0, 100]);
        expect(obj.arr[0]).toBeCloseTo(50, 5);
        expect(obj.arr[1]).toBeCloseTo(100, 5);
    });

    it('adding a tween from a completion callback does not loop', () => {
        const obj1 = { x: 0 };
        const obj2 = { y: 0 };
        const g = group();
        const tw1 = to(obj1, { x: 100 }, 50);
        tw1.on('complete', () => {
            g.add(to(obj2, { y: 100 }, 50));
        });
        g.add(tw1);
        g.start(0);
        for (let time = 10; time <= 200; time += 10) {
            g.update(time);
        }
        expect(obj1.x).toBe(100);
        expect(obj2.y).toBe(0);
        expect(g.getSize()).toBe(2);
    });
});
