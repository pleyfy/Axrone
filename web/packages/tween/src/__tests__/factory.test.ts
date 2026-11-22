import { describe, expect, it } from 'vitest';
import { TweenFactory } from '../factory';
import { PrimitiveTween } from '../implementations/primitive-tween';
import { ArrayTween } from '../implementations/array-tween';
import { ObjectTween } from '../implementations/object-tween';

describe('TweenFactory', () => {
    describe('Type dispatch', () => {
        it('number -> PrimitiveTween', () => {
            const tween = TweenFactory.create(42);
            expect(tween).toBeInstanceOf(PrimitiveTween);
        });

        it('Array -> ArrayTween', () => {
            const tween = TweenFactory.create([1, 2, 3]);
            expect(tween).toBeInstanceOf(ArrayTween);
        });

        it('TypedArray -> ArrayTween', () => {
            const tween = TweenFactory.create(new Float32Array([1, 2, 3]));
            expect(tween).toBeInstanceOf(ArrayTween);
        });

        it('object -> ObjectTween', () => {
            const tween = TweenFactory.create({ x: 0, y: 0 });
            expect(tween).toBeInstanceOf(ObjectTween);
        });
    });

    describe('Error handling', () => {
        it('unsupported type (string) throws', () => {
            expect(() => TweenFactory.create('hello' as any)).toThrow();
        });

        it('unsupported type (boolean) throws', () => {
            expect(() => TweenFactory.create(true as any)).toThrow();
        });

        it('null throws', () => {
            expect(() => TweenFactory.create(null as any)).toThrow();
        });

        it('undefined throws', () => {
            expect(() => TweenFactory.create(undefined as any)).toThrow();
        });
    });

    describe('autoStart config', () => {
        it('tween.start() called when config.autoStart=true', () => {
            const tween = TweenFactory.create({ x: 0 }, { autoStart: true });
            expect(tween.isPlaying()).toBe(true);
        });

        it('tween not started when config.autoStart=false', () => {
            const tween = TweenFactory.create({ x: 0 }, { autoStart: false });
            expect(tween.isPlaying()).toBe(false);
        });

        it('tween not started when config.autoStart undefined', () => {
            const tween = TweenFactory.create({ x: 0 });
            expect(tween.isPlaying()).toBe(false);
        });
    });

    describe('Config passthrough', () => {
        it('duration forwarded correctly', () => {
            const tween = TweenFactory.create({ x: 0 }, { duration: 500 });
            expect(tween.getDuration()).toBe(500);
        });

        it('easing forwarded correctly', () => {
            const obj = { x: 0 };
            const easing = (t: number) => t * t;
            const tween = TweenFactory.create(obj, { to: { x: 100 }, duration: 100, easing });
            tween.start(0);
            tween.update(50);
            expect(obj.x).toBeCloseTo(25, 5);
        });
    });
});
