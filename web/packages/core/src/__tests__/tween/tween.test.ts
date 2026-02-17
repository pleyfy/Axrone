import {
    tween,
    to,
    from,
    fromTo,
    TWEEN,
    chain,
    group,
    timeline,
    spring,
    delay,
    waitFor,
} from '../../tween';
import { Easing } from '../../tween/easing-functions';
import { Interpolation } from '../../tween/interpolation';

describe('Tween System', () => {
    beforeEach(() => {
        if ((TWEEN as any)._animFrameId) {
            cancelAnimationFrame((TWEEN as any)._animFrameId);
            (TWEEN as any)._animFrameId = undefined;
        }
        (TWEEN as any)._running = false;
        (TWEEN as any)._tweens.clear?.();
        (TWEEN as any)._tweensToAdd.clear?.();
        (TWEEN as any)._tweensToRemove.clear?.();
    });

    afterEach(() => {
        if ((TWEEN as any)._animFrameId) {
            cancelAnimationFrame((TWEEN as any)._animFrameId);
            (TWEEN as any)._animFrameId = undefined;
        }
        (TWEEN as any)._running = false;
        (TWEEN as any)._tweens.clear?.();
        (TWEEN as any)._tweensToAdd.clear?.();
        (TWEEN as any)._tweensToRemove.clear?.();
    });

    describe('Basic Tweening', () => {
        test('basic number tween', () => {
            let obj = { x: 0 };
            const tw = tween(obj, { to: { x: 10 }, duration: 100 });
            tw.start(0);
            tw.update(0);
            expect(obj.x).toBe(0);
            tw.update(50);
            expect(obj.x).toBeCloseTo(5, 1);
            tw.update(100);
            expect(obj.x).toBe(10);
        });

        test('to() helper function', () => {
            let obj = { x: 0, y: 0 };
            const tw = to(obj, { x: 10, y: 20 }, 100);
            tw.start(0);
            tw.update(50);
            expect(obj.x).toBeCloseTo(5, 1);
            expect(obj.y).toBeCloseTo(10, 1);
            tw.update(100);
            expect(obj.x).toBe(10);
            expect(obj.y).toBe(20);
        });

        test('from() helper function', () => {
            let obj = { x: 10, y: 20 };
            const tw = from(obj, { x: 0, y: 0 }, 100);
            tw.start(0);
            tw.update(0);
            expect(obj.x).toBe(0);
            expect(obj.y).toBe(0);
            tw.update(50);
            expect(obj.x).toBeCloseTo(5, 1);
            expect(obj.y).toBeCloseTo(10, 1);
            tw.update(100);
            expect(obj.x).toBe(10);
            expect(obj.y).toBe(20);
        });

        test('fromTo() helper function', () => {
            let obj = { y: 0 };
            const tw = fromTo(obj, { y: 5 }, { y: 15 }, 100);
            tw.start(0);
            tw.update(0);
            expect(obj.y).toBe(5);
            tw.update(50);
            expect(obj.y).toBeCloseTo(10, 1);
            tw.update(100);
            expect(obj.y).toBe(15);
        });

        test('nested object tweening', () => {
            let obj = {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
            };
            const tw = to(
                obj,
                {
                    position: { x: 100, y: 50 },
                    scale: { x: 2, y: 1.5 },
                },
                100
            );

            tw.start(0);
            tw.update(50);
            expect(obj.position.x).toBeCloseTo(50, 1);
            expect(obj.position.y).toBeCloseTo(25, 1);
            expect(obj.scale.x).toBeCloseTo(1.5, 1);
            expect(obj.scale.y).toBeCloseTo(1.25, 1);
        });

        test('array tweening', () => {
            let obj = { colors: [0, 0, 0] };
            const tw = to(obj, { colors: [255, 128, 64] }, 100);
            tw.start(0);
            tw.update(50);
            expect(obj.colors[0]).toBeCloseTo(127.5, 0);
            expect(obj.colors[1]).toBeCloseTo(64, 0);
            expect(obj.colors[2]).toBeCloseTo(32, 0);
        });
    });

    describe('Tween Control', () => {
        test('start, stop, pause, resume', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);

            expect(tw.isPlaying()).toBe(false);
            expect(tw.getStatus()).toBe('idle');

            tw.start(0);
            expect(tw.isPlaying()).toBe(true);
            expect(tw.getStatus()).toBe('running');

            tw.pause();
            expect(tw.isPlaying()).toBe(false);
            expect(tw.getStatus()).toBe('paused');

            tw.resume();
            expect(tw.isPlaying()).toBe(true);
            expect(tw.getStatus()).toBe('running');

            tw.stop();
            expect(tw.isPlaying()).toBe(false);
            expect(tw.getStatus()).toBe('idle');
        });

        test('end() method completes tween immediately', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            tw.start(0);
            tw.update(25);
            expect(obj.x).toBeCloseTo(25, 1);

            tw.end();
            expect(obj.x).toBe(100);
            expect(tw.getStatus()).toBe('completed');
        });

        test('delay functionality', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).delay(50);
            tw.start(0);

            tw.update(25);
            expect(obj.x).toBe(0);

            tw.update(75);
            expect(obj.x).toBeCloseTo(25, 1);

            tw.update(150);
            expect(obj.x).toBe(100);
        });
    });

    describe('Easing Functions', () => {
        test('linear easing', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).easing(Easing.Linear.None);
            tw.start(0);
            tw.update(25);
            expect(obj.x).toBeCloseTo(25, 1);
            tw.update(50);
            expect(obj.x).toBeCloseTo(50, 1);
            tw.update(75);
            expect(obj.x).toBeCloseTo(75, 1);
        });

        test('quadratic easing in', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).easing(Easing.Quadratic.In);
            tw.start(0);
            tw.update(50);

            expect(obj.x).toBeCloseTo(25, 1);
        });

        test('quadratic easing out', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).easing(Easing.Quadratic.Out);
            tw.start(0);
            tw.update(50);

            expect(obj.x).toBeCloseTo(75, 1);
        });

        test('elastic easing', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).easing(Easing.Elastic.Out);
            tw.start(0);
            tw.update(100);
            expect(obj.x).toBeCloseTo(100, 1);
        });
    });

    describe('Repeat and Yoyo', () => {
        test('repeat functionality', () => {
            let obj = { x: 0 };
            let completionCount = 0;
            const tw = to(obj, { x: 100 }, 100)
                .repeat(2)
                .on('complete', () => completionCount++);

            tw.start(0);

            tw.update(100);
            expect(obj.x).toBe(100);

            tw.update(101);
            expect(obj.x).toBe(0);

            tw.update(200);
            expect(obj.x).toBe(100);

            tw.update(201);
            expect(obj.x).toBe(0);

            tw.update(300);
            expect(obj.x).toBe(100);
            expect(completionCount).toBe(1);
        });

        test('yoyo functionality', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).repeat(1).yoyo(true);

            tw.start(0);

            tw.update(100);
            expect(obj.x).toBe(100);

            tw.update(101);
            tw.update(150);
            expect(obj.x).toBeCloseTo(50, 1);

            tw.update(200);
            expect(obj.x).toBe(0);
        });

        test('repeat with delay', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).repeat(1).repeatDelay(50);

            tw.start(0);
            tw.update(100);
            expect(obj.x).toBe(100);

            tw.update(125);
            expect(obj.x).toBe(100);

            tw.update(151);
            expect(obj.x).toBe(0);
        });
    });

    describe('Events', () => {
        test('start event', () => {
            let obj = { x: 0 };
            let startCalled = false;
            const tw = to(obj, { x: 100 }, 100).on('start', () => (startCalled = true));

            tw.start(0);
            expect(startCalled).toBe(true);
        });

        test('update event', () => {
            let obj = { x: 0 };
            let updateCount = 0;
            const tw = to(obj, { x: 100 }, 100).on('update', () => updateCount++);

            tw.start(0);
            tw.update(25);
            tw.update(50);
            tw.update(75);
            expect(updateCount).toBe(3);
        });

        test('complete event', () => {
            let obj = { x: 0 };
            let completeCalled = false;
            const tw = to(obj, { x: 100 }, 100).on('complete', () => (completeCalled = true));

            tw.start(0);
            tw.update(100);
            expect(completeCalled).toBe(true);
        });

        test('event removal', () => {
            let obj = { x: 0 };
            let callCount = 0;
            const callback = () => callCount++;
            const tw = to(obj, { x: 100 }, 100).on('update', callback);

            tw.start(0);
            tw.update(25);
            expect(callCount).toBe(1);

            tw.off('update', callback);
            tw.update(50);
            expect(callCount).toBe(1);
        });
    });

    describe('Chaining', () => {
        test('tween chaining with chain()', () => {
            let obj = { x: 0 };
            const tw1 = to(obj, { x: 50 }, 50);
            const tw2 = to(obj, { x: 100 }, 50);
            tw1.chain(tw2);

            tw1.start(0);
            tw1.update(50);
            expect(obj.x).toBe(50);

            tw2.update(51);
            tw2.update(100);
            expect(obj.x).toBe(100);
        });

        test('chain tweens with TweenChain', () => {
            let obj = { z: 0 };
            const tw1 = to(obj, { z: 5 }, 50);
            const tw2 = to(obj, { z: 10 }, 50);
            const ch = chain().add(tw1).add(tw2);
            ch.start(0);
            tw1.update(0);
            expect(obj.z).toBe(0);
            tw1.update(50);
            expect(obj.z).toBe(5);

            tw1.update(51);
            tw2.update(51);
            tw2.update(100);
            expect(obj.z).toBe(10);
        });
    });

    describe('Grouping', () => {
        test('group tweens', () => {
            let obj1 = { a: 0 };
            let obj2 = { b: 0 };
            const tw1 = to(obj1, { a: 1 }, 100);
            const tw2 = to(obj2, { b: 2 }, 100);
            const grp = group().add(tw1).add(tw2);
            grp.start(0);
            tw1.update(50);
            tw2.update(50);
            expect(obj1.a).toBeCloseTo(0.5, 1);
            expect(obj2.b).toBeCloseTo(1, 1);
            tw1.update(100);
            tw2.update(100);
            expect(obj1.a).toBe(1);
            expect(obj2.b).toBe(2);
        });

        test('group control methods', () => {
            let obj1 = { a: 0 };
            let obj2 = { b: 0 };
            const tw1 = to(obj1, { a: 1 }, 100);
            const tw2 = to(obj2, { b: 1 }, 100);
            const grp = group().add(tw1).add(tw2);

            grp.start(0);
            expect(tw1.isPlaying()).toBe(true);
            expect(tw2.isPlaying()).toBe(true);

            grp.pause();
            expect(tw1.getStatus()).toBe('paused');
            expect(tw2.getStatus()).toBe('paused');

            grp.resume();
            expect(tw1.isPlaying()).toBe(true);
            expect(tw2.isPlaying()).toBe(true);

            grp.stop();
            expect(tw1.isPlaying()).toBe(false);
            expect(tw2.isPlaying()).toBe(false);
        });
    });

    describe('Timeline', () => {
        test('timeline tweens', () => {
            let obj1 = { a: 0 };
            let obj2 = { b: 0 };
            const tw1 = to(obj1, { a: 1 }, 50);
            const tw2 = to(obj2, { b: 1 }, 50);
            const tl = timeline().add(tw1).add(tw2, { position: 25 });

            tl.start(0);
            tl.update(25);
            expect(obj1.a).toBeCloseTo(0.5, 1);
            expect(obj2.b).toBeCloseTo(0, 1);

            tl.update(50);
            expect(obj1.a).toBe(1);
            expect(obj2.b).toBeCloseTo(0.5, 1);

            tl.update(75);
            expect(obj2.b).toBe(1);
        });

        test('timeline with offset', () => {
            let obj1 = { a: 0 };
            let obj2 = { b: 0 };
            const tw1 = to(obj1, { a: 1 }, 50);
            const tw2 = to(obj2, { b: 1 }, 50);
            const tl = timeline().add(tw1).add(tw2, { offset: 10 });

            tl.start(0);
            expect(tl.getDuration()).toBe(110);

            tl.update(60);
            expect(obj1.a).toBe(1);
            expect(obj2.b).toBeCloseTo(0, 1);

            tl.update(85);
            expect(obj2.b).toBeCloseTo(0.5, 1);
        });

        test('timeline time scale', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            const tl = timeline().add(tw).setTimeScale(2);

            tl.start(0);
            tl.update(25);
            expect(obj.x).toBeCloseTo(50, 1);
        });

        test('timeline events', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            const tl = timeline().add(tw);

            let completed = false;
            tl.onComplete(() => (completed = true));

            tl.start(0);
            tl.update(100);
            expect(completed).toBe(true);
        });
    });

    describe('Interpolation', () => {
        test('linear interpolation', () => {
            let obj = { path: [0, 50, 100] };
            const tw = to(obj, { path: [100, 150, 200] }, 100).interpolation(Interpolation.Linear);

            tw.start(0);
            tw.update(50);

            expect(obj.path[0]).toBeCloseTo(50, 1);
            expect(obj.path[1]).toBeCloseTo(100, 1);
            expect(obj.path[2]).toBeCloseTo(150, 1);
        });

        test('bezier interpolation', () => {
            let obj = { curve: [0, 25, 75, 100] };
            const tw = to(obj, { curve: [100, 125, 175, 200] }, 100).interpolation(
                Interpolation.Bezier
            );

            tw.start(0);
            tw.update(100);
            expect(obj.curve[0]).toBeCloseTo(100, 1);
            expect(obj.curve[3]).toBeCloseTo(200, 1);
        });

        test('step interpolation', () => {
            let obj = { steps: [0, 1, 2, 3] };
            const tw = to(obj, { steps: [4, 5, 6, 7] }, 100).interpolation(Interpolation.Step);

            tw.start(0);
            tw.update(25);

            expect(obj.steps[0]).toBe(4);
        });
    });

    describe('Utility Functions', () => {
        test('delay utility', async () => {
            const start = Date.now();
            await delay(50);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(45);
        });

        test('waitFor utility', async () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);
            tw.start(0);

            const promise = waitFor(tw);
            tw.update(100);

            await promise;
            expect(obj.x).toBe(100);
        });
    });

    describe('Spring Animation', () => {
        test('basic spring animation', () => {
            const spr = spring(0, { stiffness: 100, damping: 10 });
            let currentValue = 0;

            spr.onUpdate((value) => {
                currentValue = value as number;
            });

            spr.setTarget({ value: 100 } as any);
            expect(spr.getCurrent()).toBeCloseTo(0, 3);
        });

        test('spring with object', () => {
            const spr = spring({ x: 0, y: 0 }, { stiffness: 200, damping: 20 });
            let currentValue = { x: 0, y: 0 };

            spr.onUpdate((value) => {
                currentValue = value;
            });

            spr.setTarget({ x: 100, y: 50 });
            expect(spr.getCurrent().x).toBeCloseTo(0, 1);
            expect(spr.getCurrent().y).toBeCloseTo(0, 1);
        });

        test('spring events', () => {
            const spr = spring(0);
            let started = false;
            let completed = false;

            spr.onStart(() => (started = true));
            spr.onComplete(() => (completed = true));

            // Enable auto-update for this test to match legacy behavior
            spr.setAutoUpdate(true);

            spr.setTarget({ value: 100 } as any);
            expect(started).toBe(true);

            spr.stop();
            expect(completed).toBe(false);
        });
    });

    describe('Advanced Features', () => {
        test('tween with TypedArray', () => {
            let obj = { data: new Float32Array([0, 0, 0]) };
            const tw = to(obj, { data: new Float32Array([1, 2, 3]) }, 100);

            tw.start(0);
            tw.update(50);
            expect(obj.data[0]).toBeCloseTo(0.5, 1);
            expect(obj.data[1]).toBeCloseTo(1, 1);
            expect(obj.data[2]).toBeCloseTo(1.5, 1);
        });

        test('complex nested object tweening', () => {
            let obj = {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                color: { r: 0, g: 0, b: 0 },
                opacity: 0,
            };

            const tw = to(
                obj,
                {
                    position: { x: 100, y: 50, z: 25 },
                    rotation: { x: 90, y: 45, z: 180 },
                    scale: { x: 2, y: 2, z: 2 },
                    color: { r: 255, g: 128, b: 64 },
                    opacity: 1,
                },
                100
            );

            tw.start(0);
            tw.update(50);

            expect(obj.position.x).toBeCloseTo(50, 1);
            expect(obj.rotation.y).toBeCloseTo(22.5, 1);
            expect(obj.scale.z).toBeCloseTo(1.5, 1);
            expect(obj.color.r).toBeCloseTo(127.5, 1);
            expect(obj.opacity).toBeCloseTo(0.5, 1);
        });

        test('infinite repeat', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100).repeat(Infinity);

            tw.start(0);

            tw.update(100);
            expect(obj.x).toBe(100);

            tw.update(101);
            expect(obj.x).toBe(0);

            for (let i = 0; i < 10; i++) {
                tw.update(200 + i * 100);
                expect(obj.x).toBe(100);
                tw.update(201 + i * 100);
                expect(obj.x).toBe(0);
            }

            expect(tw.isPlaying()).toBe(true);
        });

        test('tween disposal and cleanup', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, 100);

            tw.start(0);
            expect(tw.isPlaying()).toBe(true);

            tw.stop();
            expect(tw.isPlaying()).toBe(false);

            tw.update(50);
            expect(obj.x).toBe(0);
        });
    });

    describe('Error Handling', () => {
        test('invalid tween target', () => {
            expect(() => {
                // @ts-ignore - Testing runtime error
                tween(null, { to: { x: 100 } });
            }).toThrow();
        });

        test('invalid duration', () => {
            let obj = { x: 0 };
            const tw = to(obj, { x: 100 }, -100);
            tw.start(0);
            tw.update(50);

            expect(obj.x).toBeDefined();
        });

        test('missing properties', () => {
            let obj = { x: 0 };

            const tw = to(obj, { y: 100 } as any, 100);
            tw.start(0);
            tw.update(50);

            expect((obj as any).y).toBeCloseTo(50, 1);
        });
    });

    describe('Performance', () => {
        test('many simultaneous tweens', () => {
            const objects = Array.from({ length: 100 }, () => ({ x: 0, y: 0 }));
            const tweens = objects.map((obj) => to(obj, { x: 100, y: 100 }, 100));

            const start = performance.now();

            tweens.forEach((tw) => tw.start(0));
            tweens.forEach((tw) => tw.update(50));

            const elapsed = performance.now() - start;

            expect(elapsed).toBeLessThan(100);

            objects.forEach((obj) => {
                expect(obj.x).toBeCloseTo(50, 1);
                expect(obj.y).toBeCloseTo(50, 1);
            });
        });

        test('deep object tweening performance', () => {
            const createDeepObject = (depth: number): any => {
                if (depth === 0) return { value: 0 };
                return { nested: createDeepObject(depth - 1), value: 0 };
            };

            const obj = createDeepObject(10);
            const target = createDeepObject(10);

            let current = target;
            for (let i = 0; i < 10; i++) {
                current.value = 100;
                current = current.nested;
            }

            const start = performance.now();
            const tw = to(obj, target, 100);
            tw.start(0);
            tw.update(50);
            const elapsed = performance.now() - start;

            expect(elapsed).toBeLessThan(50);
        });
    });
});
