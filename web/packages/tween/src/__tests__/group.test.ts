import { describe, expect, it } from 'vitest';
import { TweenGroup } from '../group';
import { to } from '../utils';

describe('TweenGroup', () => {
    describe('add / remove', () => {
        it('add tween', () => {
            const group = new TweenGroup();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            group.add(tw);
            expect(group).toBeDefined();
        });

        it('remove tween', () => {
            const group = new TweenGroup();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            group.add(tw);
            group.remove(tw);
            expect(group).toBeDefined();
        });
    });

    describe('start()', () => {
        it('starts all tweens with optional time', () => {
            const group = new TweenGroup();
            const obj1 = { x: 0 };
            const obj2 = { y: 0 };
            const tw1 = to(obj1, { x: 100 }, 100);
            const tw2 = to(obj2, { y: 100 }, 100);
            group.add(tw1).add(tw2);
            group.start(0);
            expect(tw1.isPlaying()).toBe(true);
            expect(tw2.isPlaying()).toBe(true);
        });
    });

    describe('stop()', () => {
        it('stops all, clears paused set', () => {
            const group = new TweenGroup();
            const obj1 = { x: 0 };
            const obj2 = { y: 0 };
            const tw1 = to(obj1, { x: 100 }, 100);
            const tw2 = to(obj2, { y: 100 }, 100);
            group.add(tw1).add(tw2);
            group.start(0);
            group.stop();
            expect(tw1.isPlaying()).toBe(false);
            expect(tw2.isPlaying()).toBe(false);
        });
    });

    describe('pause()', () => {
        it('only pauses playing tweens, tracks paused set', () => {
            const group = new TweenGroup();
            const obj1 = { x: 0 };
            const obj2 = { y: 0 };
            const tw1 = to(obj1, { x: 100 }, 100);
            const tw2 = to(obj2, { y: 100 }, 100);
            group.add(tw1).add(tw2);
            group.start(0);
            tw2.stop();
            group.pause();
            expect(tw1.getStatus()).toBe('paused');
            expect(tw2.getStatus()).toBe('idle');
        });
    });

    describe('resume()', () => {
        it('resumes only previously paused tweens', () => {
            const group = new TweenGroup();
            const obj1 = { x: 0 };
            const obj2 = { y: 0 };
            const tw1 = to(obj1, { x: 100 }, 100);
            const tw2 = to(obj2, { y: 100 }, 100);
            group.add(tw1).add(tw2);
            group.start(0);
            group.pause();
            group.resume();
            expect(tw1.getStatus()).toBe('running');
            expect(tw2.getStatus()).toBe('running');
        });
    });

    describe('update()', () => {
        it('updates all tweens', () => {
            const group = new TweenGroup();
            const obj1 = { x: 0 };
            const obj2 = { y: 0 };
            const tw1 = to(obj1, { x: 100 }, 100);
            const tw2 = to(obj2, { y: 100 }, 100);
            group.add(tw1).add(tw2);
            group.start(0);
            group.update(50);
            expect(obj1.x).toBeCloseTo(50, 0);
            expect(obj2.y).toBeCloseTo(50, 0);
        });

        it('retains completed members for restart', () => {
            const group = new TweenGroup();
            const obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            group.add(tw);
            group.start(0);
            group.update(100);
            expect(tw.getStatus()).toBe('completed');
            expect(group.getSize()).toBe(1);
            group.start(0);
            group.update(50);
            expect(obj.x).toBeCloseTo(50, 0);
        });
    });

    describe('dispose()', () => {
        it('stops all, clears all sets', () => {
            const group = new TweenGroup();
            const obj1 = { x: 0 };
            const obj2 = { y: 0 };
            const tw1 = to(obj1, { x: 100 }, 100);
            const tw2 = to(obj2, { y: 100 }, 100);
            group.add(tw1).add(tw2);
            group.start(0);
            group.dispose();
            expect(tw1.isPlaying()).toBe(false);
            expect(tw2.isPlaying()).toBe(false);
        });
    });
});
