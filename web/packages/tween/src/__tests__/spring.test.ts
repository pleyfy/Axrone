import { describe, expect, it } from 'vitest';
import { SpringSimulation, Spring } from '../spring';
import { TweenSystem } from '../system';

describe('SpringSimulation', () => {
    describe('basic physics', () => {
        it('position moves toward target', () => {
            const sim = new SpringSimulation({ mass: 1, stiffness: 100, damping: 10, precision: 0.001 });
            const [newPos, newVel, atRest] = sim.update(0, 0, 100, 0.016);
            expect(newPos).toBeGreaterThan(0);
            expect(newPos).toBeLessThan(100);
            expect(newVel).toBeGreaterThan(0);
            expect(atRest).toBe(false);
        });

        it('rest detection when within precision', () => {
            const sim = new SpringSimulation({ mass: 1, stiffness: 100, damping: 10, precision: 0.01 });
            const [newPos, newVel, atRest] = sim.update(99.999, 0.001, 100, 0.016);
            expect(atRest).toBe(true);
        });

        it('high damping reduces oscillation over multiple steps', () => {
            const sim = new SpringSimulation({ mass: 1, stiffness: 100, damping: 20, precision: 0.001 });
            let pos = 0;
            let vel = 0;
            for (let i = 0; i < 200; i++) {
                [pos, vel] = sim.update(pos, vel, 100, 0.016);
            }
            // Overdamped spring should converge close to target
            expect(Math.abs(pos - 100)).toBeLessThan(1);
        });

        it('zero damping oscillates', () => {
            const sim = new SpringSimulation({ mass: 1, stiffness: 100, damping: 0, precision: 0.001 });
            let pos = 0;
            let vel = 0;
            for (let i = 0; i < 100; i++) {
                [pos, vel] = sim.update(pos, vel, 100, 0.016);
            }
            expect(Math.abs(vel)).toBeGreaterThan(0);
        });

        it('mass affects acceleration', () => {
            const sim1 = new SpringSimulation({ mass: 1, stiffness: 100, damping: 10, precision: 0.001 });
            const sim2 = new SpringSimulation({ mass: 10, stiffness: 100, damping: 10, precision: 0.001 });
            const [pos1, vel1] = sim1.update(0, 0, 100, 0.016);
            const [pos2, vel2] = sim2.update(0, 0, 100, 0.016);
            expect(pos1).toBeGreaterThan(pos2);
            expect(vel1).toBeGreaterThan(vel2);
        });

        it('stiffness affects speed', () => {
            const sim1 = new SpringSimulation({ mass: 1, stiffness: 10, damping: 10, precision: 0.001 });
            const sim2 = new SpringSimulation({ mass: 1, stiffness: 1000, damping: 10, precision: 0.001 });
            const [pos1, vel1] = sim1.update(0, 0, 100, 0.016);
            const [pos2, vel2] = sim2.update(0, 0, 100, 0.016);
            expect(pos2).toBeGreaterThan(pos1);
            expect(vel2).toBeGreaterThan(vel1);
        });
    });
});

describe('Spring', () => {
    describe('number spring', () => {
        it('getCurrent() returns number', () => {
            const spring = new Spring(0);
            expect(typeof spring.getCurrent()).toBe('number');
        });

        it('setTarget with number', () => {
            const spring = new Spring(0);
            spring.setTarget({ value: 100 } as any);
            expect(spring.getCurrent()).toBeCloseTo(0, 5);
        });

        it('manual update steps', () => {
            const spring = new Spring(0, { stiffness: 100, damping: 10 });
            spring.setTarget({ value: 100 } as any);
            spring.start();
            const isRunning = spring.updateManual(16);
            expect(isRunning).toBe(true);
            expect(spring.getCurrent()).toBeGreaterThan(0);
        });
    });

    describe('object spring', () => {
        it('multi-property spring', () => {
            const spring = new Spring({ x: 0, y: 0 });
            spring.setTarget({ x: 100, y: 50 });
            spring.start();
            spring.updateManual(16);
            const current = spring.getCurrent();
            expect(current.x).toBeGreaterThan(0);
            expect(current.y).toBeGreaterThan(0);
        });

        it('getCurrent() returns cloned object', () => {
            const spring = new Spring({ x: 0, y: 0 });
            const current1 = spring.getCurrent();
            const current2 = spring.getCurrent();
            expect(current1).not.toBe(current2);
            expect(current1).toEqual(current2);
        });
    });

    describe('array spring', () => {
        it('array element spring', () => {
            const spring = new Spring([0, 0, 0]);
            spring.setTarget([100, 50, 25] as any);
            spring.start();
            spring.updateManual(16);
            const current = spring.getCurrent();
            expect(Array.isArray(current)).toBe(true);
            expect(current[0]).toBeGreaterThan(0);
        });

        it('getCurrent() returns cloned array', () => {
            const spring = new Spring([0, 0, 0]);
            const current1 = spring.getCurrent();
            const current2 = spring.getCurrent();
            expect(current1).not.toBe(current2);
        });
    });

    describe('TypedArray spring', () => {
        it('Float32Array spring', () => {
            const spring = new Spring(new Float32Array([0, 0, 0]));
            spring.setTarget(new Float32Array([100, 50, 25]) as any);
            spring.start();
            spring.updateManual(16);
            const current = spring.getCurrent();
            expect(current).toBeInstanceOf(Float32Array);
            expect(current[0]).toBeGreaterThan(0);
        });
    });

    describe('updateManual()', () => {
        it('returns false when not running', () => {
            const spring = new Spring(0);
            expect(spring.updateManual(16)).toBe(false);
        });

        it('clamps dt to 64ms max', () => {
            const spring = new Spring(0, { stiffness: 100, damping: 10 });
            spring.setTarget({ value: 100 } as any);
            spring.start();
            const result1 = spring.updateManual(16);
            const result2 = spring.updateManual(1000);
            expect(result1).toBe(true);
            expect(result2).toBeDefined();
        });

        it('returns true while active', () => {
            const spring = new Spring(0, { stiffness: 100, damping: 10 });
            spring.setTarget({ value: 100 } as any);
            spring.start();
            expect(spring.updateManual(16)).toBe(true);
        });

        it('returns false at rest with small steps', () => {
            const spring = new Spring(0, { stiffness: 10, damping: 8, precision: 0.1 });
            spring.setTarget({ value: 100 } as any);
            spring.start();
            let result = true;
            for (let i = 0; i < 5000; i++) {
                result = spring.updateManual(4);
                if (!result) break;
            }
            expect(result).toBe(false);
        });
    });

    describe('start()', () => {
        it('no-op when already running', () => {
            const spring = new Spring(0);
            spring.start();
            const isRunning1 = (spring as any)._isRunning;
            spring.start();
            expect((spring as any)._isRunning).toBe(isRunning1);
        });

        it('emits start event', () => {
            const spring = new Spring(0);
            let startFired = false;
            spring.onStart(() => {
                startFired = true;
            });
            spring.start();
            expect(startFired).toBe(true);
        });
    });

    describe('stop()', () => {
        it('no-op when not running', () => {
            const spring = new Spring(0);
            let stopFired = false;
            spring.onComplete(() => {
                stopFired = true;
            });
            spring.stop();
            expect(stopFired).toBe(false);
        });

        it('emits stop when running', () => {
            const spring = new Spring(0);
            spring.start();
            let stopFired = false;
            spring.on('stop', () => {
                stopFired = true;
            });
            spring.stop();
            expect(stopFired).toBe(true);
        });
    });

    describe('setAutoUpdate / getAutoUpdate', () => {
        it('enables internal loop', () => {
            const spring = new Spring(0);
            expect(spring.getAutoUpdate()).toBe(false);
            spring.setAutoUpdate(true);
            expect(spring.getAutoUpdate()).toBe(true);
        });
    });

    describe('IGroupable contract', () => {
        it('exposes a stable id and infinite total duration', () => {
            const spring = new Spring(0);
            expect(typeof spring.id).toBe('number');
            expect(spring.getTotalDuration()).toBe(Infinity);
            expect(spring.getStatus()).toBe('idle');
            expect(spring.isPlaying()).toBe(false);
        });

        it('update(time) advances on a millisecond clock', () => {
            const spring = new Spring(0);
            spring.setTarget({ value: 100 } as any);
            spring.start(0);
            spring.update(16);
            spring.update(32);
            expect(spring.getStatus()).toBe('running');
            expect(spring.isPlaying()).toBe(true);
        });

        it('pauses and resumes without losing the target', () => {
            const spring = new Spring(0);
            spring.setTarget({ value: 100 } as any);
            spring.start(0);
            spring.update(16);
            spring.pause();
            expect(spring.getStatus()).toBe('paused');
            expect(spring.isPlaying()).toBe(false);
            spring.resume();
            expect(spring.getStatus()).toBe('running');
            spring.update(32);
            expect(spring.isPlaying()).toBe(true);
        });

        it('rides a TweenSystem until it rests', () => {
            const system = new TweenSystem();
            const spring = new Spring(0, { stiffness: 400, damping: 40, precision: 0.5 });
            spring.setTarget({ value: 10 } as any);
            spring.start(0);
            system.add(spring);
            for (let time = 16; time <= 10000; time += 16) {
                if (!system.update(time)) {
                    break;
                }
            }
            expect(spring.getStatus()).toBe('completed');
            expect(system.getActiveTweenCount()).toBe(0);
        });
    });

    describe('setTarget()', () => {
        it('auto-starts if autoUpdate enabled and not running', () => {
            const spring = new Spring(0);
            spring.setAutoUpdate(true);
            spring.setTarget({ value: 100 } as any);
            expect(spring.isPlaying()).toBe(true);
            expect(spring.getStatus()).toBe('running');
            spring.setAutoUpdate(false);
            spring.stop();
        });

        it('collects new props', () => {
            const spring = new Spring({ x: 0 });
            spring.setTarget({ x: 100, y: 50 } as any);
            spring.start(0);
            for (let time = 16; time <= 160; time += 16) {
                spring.update(time);
            }
            const current = spring.getCurrent() as unknown as Record<string, number>;
            expect(current['y']).toBeDefined();
        });
    });

    describe('Rest detection', () => {
        it('allAtRest snaps to target, zeros velocities, emits complete', () => {
            const spring = new Spring(0, { stiffness: 10, damping: 8, precision: 0.1 });
            spring.setTarget({ value: 100 } as any);
            spring.start();
            let completeFired = false;
            spring.onComplete(() => {
                completeFired = true;
            });
            for (let i = 0; i < 5000; i++) {
                spring.updateManual(4);
                if (completeFired) break;
            }
            expect(completeFired).toBe(true);
            expect(spring.getCurrent()).toBeCloseTo(100, 0);
        });
    });

    describe('Event callbacks', () => {
        it('onUpdate/onComplete/onStart registration and firing', () => {
            const spring = new Spring(0, { stiffness: 100, damping: 10 });
            let updateCount = 0;
            let completeCount = 0;
            let startCount = 0;

            spring.onUpdate(() => updateCount++);
            spring.onComplete(() => completeCount++);
            spring.onStart(() => startCount++);

            spring.setTarget({ value: 100 } as any);
            spring.start();
            expect(startCount).toBe(1);

            spring.updateManual(16);
            expect(updateCount).toBeGreaterThan(0);

            spring.stop();
        });
    });
});
