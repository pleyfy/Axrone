import { describe, expect, it, vi, afterEach } from 'vitest';
import { TweenSystem } from '../system';
import { to } from '../utils';

describe('TweenSystem', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('add / remove', () => {
        it('basic add and remove', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            expect(system.getActiveTweenCount()).toBe(1);
            system.remove(tw);
            expect(system.getActiveTweenCount()).toBe(0);
        });
    });

    describe('Deferred add during update', () => {
        it('add() inside update callback queued, flushed after', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw1 = to(obj, { x: 100 }, 100);
            const tw2 = to(obj, { x: 200 }, 100);

            tw1.on('update', () => {
                system.add(tw2);
            });

            system.add(tw1);
            tw1.start(0);

            system.update(0);
            expect(system.getActiveTweenCount()).toBe(2);
        });
    });

    describe('Deferred remove during update', () => {
        it('remove() during update queued, flushed after', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw1 = to(obj, { x: 100 }, 100);
            const tw2 = to(obj, { x: 200 }, 100);

            system.add(tw1);
            system.add(tw2);
            tw1.start(0);
            tw2.start(0);

            tw1.on('update', () => {
                system.remove(tw2);
            });

            system.update(50);
            expect(system.getActiveTweenCount()).toBe(1);
        });
    });

    describe('update() return value', () => {
        it('false when empty', () => {
            const system = new TweenSystem();
            expect(system.update(0)).toBe(false);
        });

        it('true when active tweens remain', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            tw.start(0);
            expect(system.update(50)).toBe(true);
        });

        it('false after all tweens complete', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            tw.start(0);
            system.update(100);
            expect(system.update(101)).toBe(false);
        });
    });

    describe('Auto-prune', () => {
        it('completed tweens removed after update', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            tw.start(0);
            expect(system.getActiveTweenCount()).toBe(1);
            system.update(100);
            expect(system.getActiveTweenCount()).toBe(0);
        });
    });

    describe('clear()', () => {
        it('stops all tweens, clears all sets, cancels rAF', () => {
            const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw1 = to(obj, { x: 100 }, 100);
            const tw2 = to(obj, { x: 200 }, 100);
            system.add(tw1);
            system.add(tw2);
            tw1.start(0);
            tw2.start(0);

            system.clear();
            expect(system.getActiveTweenCount()).toBe(0);
            expect(tw1.isPlaying()).toBe(false);
            expect(tw2.isPlaying()).toBe(false);
        });
    });

    describe('getActiveTweenCount()', () => {
        it('accurate count after add/remove/prune', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw1 = to(obj, { x: 100 }, 100);
            const tw2 = to(obj, { x: 200 }, 100);
            const tw3 = to(obj, { x: 300 }, 100);

            system.add(tw1);
            system.add(tw2);
            system.add(tw3);
            expect(system.getActiveTweenCount()).toBe(3);

            system.remove(tw2);
            expect(system.getActiveTweenCount()).toBe(2);

            tw1.start(0);
            tw3.start(0);
            system.update(100);
            expect(system.getActiveTweenCount()).toBe(0);
        });
    });

    describe('setAutoUpdate / getAutoUpdate', () => {
        it('enables internal rAF loop', () => {
            const requestSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
            const nowSpy = vi.spyOn(globalThis.performance, 'now').mockReturnValue(1000);

            const system = new TweenSystem();
            expect(system.getAutoUpdate()).toBe(false);

            system.setAutoUpdate(true);
            expect(system.getAutoUpdate()).toBe(true);

            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            tw.start(0);

            expect(requestSpy).toHaveBeenCalled();
        });

        it('disables and cancels rAF', () => {
            const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
            const requestSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
            const nowSpy = vi.spyOn(globalThis.performance, 'now').mockReturnValue(1000);

            const system = new TweenSystem();
            system.setAutoUpdate(true);

            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            tw.start(0);

            system.setAutoUpdate(false);
            expect(system.getAutoUpdate()).toBe(false);
            expect(cancelSpy).toHaveBeenCalled();
        });
    });

    describe('_hasCompleted', () => {
        it('handles tweens with getStatus', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            system.add(tw);
            tw.start(0);
            system.update(100);
            expect(tw.getStatus()).toBe('completed');
            expect(system.getActiveTweenCount()).toBe(0);
        });

        it('keeps running tweens across updates', () => {
            const system = new TweenSystem();
            const mockTween = {
                id: 0,
                isPlaying: () => true,
                getStatus: () => 'running' as const,
                getTotalDuration: () => 100,
                start: function () { return this; },
                stop: function () { return this; },
                pause: function () { return this; },
                resume: function () { return this; },
                update: () => {},
            };
            system.add(mockTween as any);
            system.update(50);
            expect(system.getActiveTweenCount()).toBe(1);
        });
    });

    describe('maxDelta', () => {
        it('clamps timestamp jumps instead of teleporting tweens', () => {
            const system = new TweenSystem();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            tw.start(0);
            system.add(tw);
            system.setMaxDelta(10);
            expect(system.getMaxDelta()).toBe(10);
            system.update(0);
            system.update(1000);
            expect(obj.x).toBeCloseTo(10, 5);
            expect(tw.getStatus()).toBe('running');
        });

        it('defaults to pass-through without a cap', () => {
            const system = new TweenSystem();
            expect(system.getMaxDelta()).toBeUndefined();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            tw.start(0);
            system.add(tw);
            system.update(0);
            system.update(1000);
            expect(obj.x).toBe(100);
        });
    });
});
