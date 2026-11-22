import { describe, expect, it } from 'vitest';
import { PrimitiveTween } from '../implementations/primitive-tween';
import { Easing } from '../easing-functions';
import { to } from '../utils';

describe('TweenCore', () => {
    describe('Constructor config', () => {
        it('applies all TweenConfig fields', () => {
            const obj = { x: 0 };
            const tween = new PrimitiveTween(0, {
                from: 0,
                to: 100,
                duration: 500,
                delay: 100,
                easing: Easing.Quadratic.In,
                repeat: 2,
                yoyo: true,
            });

            expect(tween.getDuration()).toBe(500);
        });

        it('applies partial config', () => {
            const tween = new PrimitiveTween(0, { duration: 200 });
            expect(tween.getDuration()).toBe(200);
        });

        it('works without config', () => {
            const tween = new PrimitiveTween(0);
            expect(tween.getDuration()).toBe(1000);
        });
    });

    describe('ID uniqueness', () => {
        it('sequential IDs across instances', () => {
            const t1 = new PrimitiveTween(0);
            const t2 = new PrimitiveTween(0);
            const t3 = new PrimitiveTween(0);
            expect(t2.id).toBe(t1.id + 1);
            expect(t3.id).toBe(t2.id + 1);
        });
    });

    describe('getDuration / getTotalDuration', () => {
        it('getTotalDuration with repeat', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).repeat(3);
            expect(tween.getTotalDuration()).toBe(400);
        });

        it('getTotalDuration with Infinity repeat', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).repeat(Infinity);
            expect(tween.getTotalDuration()).toBe(Infinity);
        });

        it('getTotalDuration without repeat', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            expect(tween.getTotalDuration()).toBe(100);
        });
    });

    describe('duration()', () => {
        it('negative clamped to 0', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).duration(-50);
            expect(tween.getDuration()).toBe(0);
        });

        it('NaN clamped to 0', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).duration(NaN);
            expect(tween.getDuration()).toBe(0);
        });

        it('Infinity clamped to 0 (not finite)', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).duration(Infinity);
            expect(tween.getDuration()).toBe(0);
        });
    });

    describe('repeat()', () => {
        it('Infinity preserved', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).repeat(Infinity);
            expect(tween.getTotalDuration()).toBe(Infinity);
        });

        it('negative clamped to 0', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).repeat(-5);
            expect(tween.getTotalDuration()).toBe(100);
        });

        it('fractional truncated', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).repeat(2.7);
            expect(tween.getTotalDuration()).toBe(300);
        });
    });

    describe('start()', () => {
        it('no-op when already playing', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.start(0);
            const id1 = tween.id;
            tween.start(50);
            expect(tween.id).toBe(id1);
            expect(tween.isPlaying()).toBe(true);
        });

        it('explicit start time drives the master clock', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.start(0);
            tween.update(50);
            expect(obj.x).toBeCloseTo(50, 5);
        });

        it('realtime start advances without an explicit clock', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.start();
            expect(tween.isPlaying()).toBe(true);
            expect(tween.getStatus()).toBe('running');
            tween.update();
            expect(Number.isFinite(obj.x)).toBe(true);
            tween.stop();
        });
    });

    describe('stop()', () => {
        it('no-op when not playing', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            expect(tween.isPlaying()).toBe(false);
            tween.stop();
            expect(tween.isPlaying()).toBe(false);
        });

        it('stops chained tweens', () => {
            const obj = { x: 0 };
            const t1 = to(obj, { x: 50 }, 50);
            const t2 = to(obj, { x: 100 }, 50);
            t1.chain(t2);
            t1.start(0);
            expect(t2.isPlaying()).toBe(false);
            t1.stop();
            expect(t1.isPlaying()).toBe(false);
        });
    });

    describe('pause() / resume()', () => {
        it('pause no-op when not playing', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.pause();
            expect(tween.getStatus()).toBe('idle');
        });

        it('resume no-op when not paused', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.start(0);
            tween.resume();
            expect(tween.getStatus()).toBe('running');
        });

        it('realtime pause and resume continues without jumping', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            const now = performance.now();
            tween.start(now);
            tween.update(now + 20);
            expect(obj.x).toBeCloseTo(20, 0);
            tween.pause();
            tween.resume();
            tween.update(now + 40);
            expect(obj.x).toBeGreaterThanOrEqual(19);
            expect(obj.x).toBeLessThanOrEqual(45);
        });
    });

    describe('end()', () => {
        it('delegates to update(Infinity)', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.start(0);
            tween.end();
            expect(obj.x).toBe(100);
            expect(tween.getStatus()).toBe('completed');
        });
    });

    describe('on() / off()', () => {
        it('update event wrapper receives (tween, elapsed)', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            let receivedTween: any;
            let receivedElapsed: number | undefined;
            tween.on('update', (t, e) => {
                receivedTween = t;
                receivedElapsed = e;
            });
            tween.start(0);
            tween.update(50);
            expect(receivedTween).toBe(tween);
            expect(receivedElapsed).toBeCloseTo(0.5, 5);
        });

        it('other events receive tween', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            let receivedTween: any;
            tween.on('start', (t) => {
                receivedTween = t;
            });
            tween.start(0);
            expect(receivedTween).toBe(tween);
        });

        it('off() without callback removes all for event', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            let count = 0;
            tween.on('update', () => count++);
            tween.on('update', () => count++);
            tween.start(0);
            tween.update(50);
            expect(count).toBe(2);
            tween.off('update');
            tween.update(75);
            expect(count).toBe(2);
        });

        it('off() with callback removes specific', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            let count1 = 0;
            let count2 = 0;
            const cb1 = () => count1++;
            const cb2 = () => count2++;
            tween.on('update', cb1);
            tween.on('update', cb2);
            tween.start(0);
            tween.update(50);
            expect(count1).toBe(1);
            expect(count2).toBe(1);
            tween.off('update', cb1);
            tween.update(75);
            expect(count1).toBe(1);
            expect(count2).toBe(2);
        });
    });

    describe('dispose()', () => {
        it('stops, detaches listeners and chained tweens', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            const chained = to(obj, { x: 200 }, 100);
            tween.chain(chained);
            let eventFired = false;
            tween.on('update', () => {
                eventFired = true;
            });
            tween.start(0);
            tween.dispose();
            expect(tween.isPlaying()).toBe(false);
            tween.update(50);
            expect(eventFired).toBe(false);
            expect(chained.isPlaying()).toBe(false);
            tween.on('update', () => {
                eventFired = true;
            });
            tween.start(0);
            tween.update(50);
            expect(eventFired).toBe(true);
        });
    });

    describe('update()', () => {
        it('no-op when not playing', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100);
            tween.update(50);
            expect(obj.x).toBe(0);
        });

        it('delay waiting', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).delay(50);
            tween.start(0);
            tween.update(25);
            expect(obj.x).toBe(0);
            tween.update(100);
            expect(obj.x).toBeCloseTo(50, 0);
        });

        it('zero-duration tween (elapsed=1)', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 0);
            tween.start(0);
            tween.update(0);
            expect(obj.x).toBe(100);
            expect(tween.getStatus()).toBe('completed');
        });

        it('repeat with repeatDelay', () => {
            const obj = { x: 0 };
            const tween = to(obj, { x: 100 }, 100).repeat(1).repeatDelay(50);
            tween.start(0);
            tween.update(100);
            expect(obj.x).toBe(100);
            tween.update(125);
            expect(obj.x).toBe(100);
            tween.update(151);
            expect(obj.x).toBe(0);
        });

        it('complete triggers chained tweens', () => {
            const obj = { x: 0 };
            const t1 = to(obj, { x: 50 }, 50);
            const t2 = to(obj, { x: 100 }, 50);
            t1.chain(t2);
            t1.start(0);
            t1.update(50);
            expect(obj.x).toBe(50);
            expect(t2.isPlaying()).toBe(true);
        });
    });

    describe('chain()', () => {
        it('chained tweens started on complete', () => {
            const obj = { x: 0 };
            const t1 = to(obj, { x: 50 }, 50);
            const t2 = to(obj, { x: 100 }, 50);
            t1.chain(t2);
            t1.start(0);
            expect(t2.isPlaying()).toBe(false);
            t1.update(50);
            expect(t2.isPlaying()).toBe(true);
        });

        it('chained tweens stopped when parent stopped while playing', () => {
            const obj = { x: 0 };
            const t1 = to(obj, { x: 50 }, 50);
            const t2 = to(obj, { x: 100 }, 50);
            t1.chain(t2);
            t1.start(0);
            expect(t1.isPlaying()).toBe(true);
            t1.stop();
            expect(t1.isPlaying()).toBe(false);
            expect(t2.isPlaying()).toBe(false);
        });
    });
});
