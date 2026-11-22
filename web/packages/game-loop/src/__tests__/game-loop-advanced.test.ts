import {
    createGameLoop,
    GameLoopConfigurationError,
    GameLoopDisposedError,
    GameLoopSchedulerError,
    GameLoopSnapshotError,
    isGameLoopSnapshot,
    type GameLoopScheduler,
    type GameLoopStateSerializer,
} from '@axrone/game-loop';

class ManualScheduler implements GameLoopScheduler<number> {
    readonly kind = 'manual';
    private _now = 0;
    private _nextHandle = 1;
    private readonly _pending = new Map<number, (timestamp: number) => void>();

    now(): number {
        return this._now;
    }

    request(callback: (timestamp: number) => void): number {
        const handle = this._nextHandle++;
        this._pending.set(handle, callback);
        return handle;
    }

    cancel(handle: number): void {
        this._pending.delete(handle);
    }

    hasPending(): boolean {
        return this._pending.size > 0;
    }

    flush(time: number): void {
        this._now = time;
        const pending = [...this._pending.entries()].sort((a, b) => a[0] - b[0]);
        this._pending.clear();

        for (const [, callback] of pending) {
            callback(time);
        }
    }
}

class ThrowingScheduler implements GameLoopScheduler<number> {
    readonly kind = 'throwing';
    private _now = 0;

    now(): number { return this._now; }

    request(_callback: (timestamp: number) => void): number {
        throw new Error('request boom');
    }

    cancel(_handle: number): void {
        throw new Error('cancel boom');
    }
}

describe('GameLoop - Configuration Validation', () => {
    const validScheduler = new ManualScheduler();

    it('rejects invalid fixedDelta values', () => {
        for (const bad of [0, -1, NaN, Infinity, '10' as any]) {
            expect(() => createGameLoop({ state: {}, scheduler: validScheduler, fixedDelta: bad })).toThrow(
                GameLoopConfigurationError
            );
        }
    });

    it('rejects invalid maxDelta values', () => {
        for (const bad of [0, -1, NaN, Infinity]) {
            expect(() => createGameLoop({ state: {}, scheduler: validScheduler, maxDelta: bad })).toThrow(
                GameLoopConfigurationError
            );
        }
    });

    it('rejects invalid maxSubSteps values', () => {
        for (const bad of [0, -1, 1.5, NaN]) {
            expect(() => createGameLoop({ state: {}, scheduler: validScheduler, maxSubSteps: bad })).toThrow(
                GameLoopConfigurationError
            );
        }
    });

    it('rejects invalid timeScale values', () => {
        for (const bad of [-1, NaN, Infinity]) {
            expect(() => createGameLoop({ state: {}, scheduler: validScheduler, timeScale: bad })).toThrow(
                GameLoopConfigurationError
            );
        }
    });

    it('accepts timeScale = 0', () => {
        const loop = createGameLoop({ state: {}, scheduler: validScheduler, timeScale: 0 });
        expect(loop.timeScale).toBe(0);
    });

    it('rejects invalid retry.attempts values', () => {
        for (const bad of [-1, 1.5, NaN]) {
            expect(() =>
                createGameLoop({ state: {}, scheduler: validScheduler, retry: { attempts: bad } })
            ).toThrow(GameLoopConfigurationError);
        }
    });

    it('rejects invalid scheduler', () => {
        expect(() =>
            createGameLoop({ state: {}, scheduler: {} as any })
        ).toThrow(GameLoopConfigurationError);
    });
});

describe('GameLoop - Lifecycle State Machine', () => {
    it('start() from idle transitions to running and schedules frame', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        const result = loop.start(0);

        expect(loop.status).toBe('running');
        expect(result).toBe(loop);
        expect(scheduler.hasPending()).toBe(true);
    });

    it('start() from running is a no-op', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        const result = loop.start(10);

        expect(loop.status).toBe('running');
        expect(result).toBe(loop);
    });

    it('start() from paused delegates to resume', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.pause();
        expect(loop.status).toBe('paused');

        loop.start(50);
        expect(loop.status).toBe('running');
        expect(scheduler.hasPending()).toBe(true);
    });

    it('start() from stopped restarts', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.stop();
        expect(loop.status).toBe('stopped');

        loop.start(100);
        expect(loop.status).toBe('running');
        expect(scheduler.hasPending()).toBe(true);
    });

    it('pause() from running transitions to paused', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.pause();

        expect(loop.status).toBe('paused');
        expect(scheduler.hasPending()).toBe(false);
    });

    it('pause() from non-running states is a no-op', () => {
        const scheduler = new ManualScheduler();

        // idle
        const loopIdle = createGameLoop({ state: {}, scheduler });
        loopIdle.pause();
        expect(loopIdle.status).toBe('idle');

        // stopped
        const loopStopped = createGameLoop({ state: {}, scheduler });
        loopStopped.start(0);
        loopStopped.stop();
        loopStopped.pause();
        expect(loopStopped.status).toBe('stopped');

        // paused (already paused)
        const loopPaused = createGameLoop({ state: {}, scheduler });
        loopPaused.start(0);
        loopPaused.pause();
        loopPaused.pause();
        expect(loopPaused.status).toBe('paused');
    });

    it('resume() from paused transitions to running', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.pause();
        const result = loop.resume(50);

        expect(loop.status).toBe('running');
        expect(result).toBe(loop);
        expect(scheduler.hasPending()).toBe(true);
    });

    it('resume() from idle delegates to start', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.resume(0);
        expect(loop.status).toBe('running');
    });

    it('resume() from running is a no-op', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.resume(50);
        expect(loop.status).toBe('running');
    });

    it('stop() transitions to stopped and cancels schedule', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.stop();

        expect(loop.status).toBe('stopped');
        expect(scheduler.hasPending()).toBe(false);
    });

    it('stop() from stopped is a no-op', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.stop();
        loop.stop();
        expect(loop.status).toBe('stopped');
    });

    it('all lifecycle methods throw GameLoopDisposedError after dispose', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });
        loop.dispose();

        expect(() => loop.start()).toThrow(GameLoopDisposedError);
        expect(() => loop.pause()).toThrow(GameLoopDisposedError);
        expect(() => loop.resume()).toThrow(GameLoopDisposedError);
        expect(() => loop.stop()).toThrow(GameLoopDisposedError);
    });
});

describe('GameLoop - Frame Processing', () => {
    it('phases stop executing when loop is paused mid-phase', () => {
        const scheduler = new ManualScheduler();
        const calls: string[] = [];

        createGameLoop({
            state: {},
            scheduler,
            systems: [
                {
                    id: 'pauser',
                    priority: 10,
                    beforeUpdate() { calls.push('beforeUpdate'); },
                    update() { calls.push('update'); },
                },
                {
                    id: 'pauser-trigger',
                    priority: 5,
                    beforeUpdate(ctx) {
                        calls.push('beforeUpdate:pause');
                        ctx.loop.pause();
                    },
                    update() { calls.push('should-not-run'); },
                },
                {
                    id: 'after-pause',
                    priority: 1,
                    beforeUpdate() { calls.push('should-not-run'); },
                    update() { calls.push('should-not-run'); },
                },
            ],
        }).start(0);

        scheduler.flush(16);

        expect(calls).toContain('beforeUpdate');
        expect(calls).toContain('beforeUpdate:pause');
        expect(calls).not.toContain('should-not-run');
    });

    it('phases stop executing when loop is stopped mid-phase', () => {
        const scheduler = new ManualScheduler();
        const calls: string[] = [];

        createGameLoop({
            state: {},
            scheduler,
            systems: [
                {
                    id: 'stopper',
                    priority: 10,
                    update(ctx) {
                        calls.push('update:stop');
                        ctx.loop.stop();
                    },
                },
                {
                    id: 'after-stop',
                    priority: 1,
                    update() { calls.push('should-not-run'); },
                },
            ],
        }).start(0);

        scheduler.flush(16);

        expect(calls).toContain('update:stop');
        expect(calls).not.toContain('should-not-run');
    });

    it('timeScale = 0 produces zero scaled delta and no fixed steps', () => {
        const scheduler = new ManualScheduler();
        let captured: { delta: number; fixedSteps: number } | undefined;

        createGameLoop({
            state: {},
            scheduler,
            timeScale: 0,
            fixedDelta: 10,
            systems: [
                {
                    id: 'observer',
                    update(ctx) {
                        captured = { delta: ctx.delta, fixedSteps: 0 };
                    },
                    afterFrame(ctx) {
                        captured = { ...captured!, fixedSteps: ctx.fixedSteps };
                    },
                },
            ],
        }).start(0);

        scheduler.flush(100);

        expect(captured!.delta).toBe(0);
        expect(captured!.fixedSteps).toBe(0);
    });

    it('timeScale = 2 doubles the scaled delta', () => {
        const scheduler = new ManualScheduler();
        let capturedDelta = 0;

        createGameLoop({
            state: {},
            scheduler,
            timeScale: 2,
            systems: [
                {
                    id: 'observer',
                    update(ctx) {
                        capturedDelta = ctx.delta;
                    },
                },
            ],
        }).start(0);

        scheduler.flush(16);

        expect(capturedDelta).toBe(32); // 16 * 2
    });

    it('frame counter increments per frame', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        expect(loop.frame).toBe(0);

        loop.start(0);
        scheduler.flush(16);
        expect(loop.frame).toBe(1);

        scheduler.flush(32);
        expect(loop.frame).toBe(2);
    });

    it('elapsed accumulates scaled delta', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler, timeScale: 2 });

        loop.start(0);
        scheduler.flush(16);

        expect(loop.elapsed).toBe(32); // 16 * 2
    });
});

describe('GameLoop - Context Field Correctness', () => {
    it('provides correct context fields during each phase', () => {
        const scheduler = new ManualScheduler();
        const captured: Record<string, any> = {};

        createGameLoop({
            state: { score: 42 },
            scheduler,
            fixedDelta: 10,
            systems: [
                {
                    id: 'inspector',
                    beforeUpdate(ctx) {
                        captured.beforeUpdate = {
                            phase: ctx.phase,
                            state: ctx.state,
                            frame: ctx.frame,
                            now: ctx.now,
                            delta: ctx.delta,
                            unscaledDelta: ctx.unscaledDelta,
                            accumulator: ctx.accumulator,
                            fixedDelta: ctx.fixedDelta,
                            timeScale: ctx.timeScale,
                            loopRef: ctx.loop,
                        };
                    },
                    fixedUpdate(ctx) {
                        captured.fixedUpdate = {
                            phase: ctx.phase,
                            step: ctx.step,
                            maxSteps: ctx.maxSteps,
                        };
                    },
                    update(ctx) {
                        captured.update = { phase: ctx.phase, elapsed: ctx.elapsed };
                    },
                    render(ctx) {
                        captured.render = { phase: ctx.phase, alpha: ctx.alpha };
                    },
                    afterFrame(ctx) {
                        captured.afterFrame = {
                            phase: ctx.phase,
                            alpha: ctx.alpha,
                            fixedSteps: ctx.fixedSteps,
                            droppedDelta: ctx.droppedDelta,
                        };
                    },
                },
            ],
        }).start(0);

        scheduler.flush(16);

        // before-update
        expect(captured.beforeUpdate.phase).toBe('before-update');
        expect(captured.beforeUpdate.state).toEqual({ score: 42 });
        expect(captured.beforeUpdate.frame).toBe(1);
        expect(captured.beforeUpdate.now).toBe(16);
        expect(captured.beforeUpdate.fixedDelta).toBe(10);
        expect(captured.beforeUpdate.timeScale).toBe(1);
        expect(captured.beforeUpdate.loopRef).toBeDefined();

        // fixed-update
        expect(captured.fixedUpdate.phase).toBe('fixed-update');
        expect(captured.fixedUpdate.step).toBe(1);
        expect(captured.fixedUpdate.maxSteps).toBe(8);

        // update
        expect(captured.update.phase).toBe('update');

        // render
        expect(captured.render.phase).toBe('render');
        expect(typeof captured.render.alpha).toBe('number');
        expect(captured.render.alpha).toBeGreaterThanOrEqual(0);
        expect(captured.render.alpha).toBeLessThanOrEqual(1);

        // after-frame
        expect(captured.afterFrame.phase).toBe('after-frame');
        expect(typeof captured.afterFrame.fixedSteps).toBe('number');
        expect(typeof captured.afterFrame.droppedDelta).toBe('number');
    });

    it('context.loop exposes the controller interface', () => {
        const scheduler = new ManualScheduler();
        let controllerRef: any;

        const loop = createGameLoop({
            state: { value: 1 },
            scheduler,
            systems: [
                {
                    id: 'ctrl-check',
                    update(ctx) {
                        controllerRef = ctx.loop;
                    },
                },
            ],
        });

        loop.start(0);
        scheduler.flush(16);

        expect(controllerRef.status).toBe('running');
        expect(controllerRef.frame).toBe(1);
        expect(controllerRef.state).toEqual({ value: 1 });
        expect(typeof controllerRef.pause).toBe('function');
        expect(typeof controllerRef.stop).toBe('function');
        expect(typeof controllerRef.replaceState).toBe('function');
        expect(typeof controllerRef.setTimeScale).toBe('function');
    });
});

describe('GameLoop - Snapshot and Restore', () => {
    describe('isGameLoopSnapshot', () => {
        it('returns false for invalid values', () => {
            expect(isGameLoopSnapshot(null)).toBe(false);
            expect(isGameLoopSnapshot(undefined)).toBe(false);
            expect(isGameLoopSnapshot({})).toBe(false);
            expect(isGameLoopSnapshot({ version: 2 })).toBe(false);
        });

        it('returns false for invalid status', () => {
            expect(
                isGameLoopSnapshot({
                    version: 1,
                    status: 'disposed',
                    state: {},
                    frame: 0,
                    elapsed: 0,
                    accumulator: 0,
                    fixedDelta: 16.67,
                    maxDelta: 250,
                    maxSubSteps: 8,
                    timeScale: 1,
                    capturedAtEpochMs: Date.now(),
                })
            ).toBe(false);
        });

        it('returns false for negative frame or NaN elapsed', () => {
            expect(
                isGameLoopSnapshot({
                    version: 1,
                    status: 'idle',
                    state: {},
                    frame: -1,
                    elapsed: 0,
                    accumulator: 0,
                    fixedDelta: 16.67,
                    maxDelta: 250,
                    maxSubSteps: 8,
                    timeScale: 1,
                    capturedAtEpochMs: Date.now(),
                })
            ).toBe(false);

            expect(
                isGameLoopSnapshot({
                    version: 1,
                    status: 'idle',
                    state: {},
                    frame: 0,
                    elapsed: NaN,
                    accumulator: 0,
                    fixedDelta: 16.67,
                    maxDelta: 250,
                    maxSubSteps: 8,
                    timeScale: 1,
                    capturedAtEpochMs: Date.now(),
                })
            ).toBe(false);
        });

        it('returns true for a valid snapshot', () => {
            const scheduler = new ManualScheduler();
            const loop = createGameLoop({ state: { x: 1 }, scheduler });
            loop.start(0);
            scheduler.flush(16);

            expect(isGameLoopSnapshot(loop.snapshot())).toBe(true);
        });
    });

    it('snapshot() captures all loop parameters', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: { score: 10 },
            scheduler,
            fixedDelta: 20,
            maxDelta: 500,
            maxSubSteps: 4,
            timeScale: 2,
        });

        loop.start(0);
        scheduler.flush(16);

        const snap = loop.snapshot();

        expect(snap.version).toBe(1);
        expect(snap.status).toBe('running');
        expect(snap.state).toEqual({ score: 10 });
        expect(snap.frame).toBe(1);
        expect(snap.fixedDelta).toBe(20);
        expect(snap.maxDelta).toBe(500);
        expect(snap.maxSubSteps).toBe(4);
        expect(snap.timeScale).toBe(2);
        expect(typeof snap.capturedAtEpochMs).toBe('number');
    });

    it('restore() with invalid snapshot throws GameLoopSnapshotError', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        expect(() => loop.restore({} as any)).toThrow(GameLoopSnapshotError);
    });

    it('restore() with running status auto-schedules next frame', () => {
        const sourceScheduler = new ManualScheduler();
        const targetScheduler = new ManualScheduler();

        const sourceLoop = createGameLoop({ state: { v: 1 }, scheduler: sourceScheduler });
        sourceLoop.start(0);
        sourceScheduler.flush(16);

        const snapshot = sourceLoop.snapshot();
        const targetLoop = createGameLoop({ state: { v: 0 }, scheduler: targetScheduler });

        targetLoop.restore(snapshot);

        expect(targetLoop.status).toBe('running');
        expect(targetScheduler.hasPending()).toBe(true);
    });

    it('restore() with paused status does not schedule', () => {
        const sourceScheduler = new ManualScheduler();
        const targetScheduler = new ManualScheduler();

        const sourceLoop = createGameLoop({ state: { v: 1 }, scheduler: sourceScheduler });
        sourceLoop.start(0);
        sourceScheduler.flush(16);
        sourceLoop.pause();

        const snapshot = sourceLoop.snapshot();
        expect(snapshot.status).toBe('paused');

        const targetLoop = createGameLoop({ state: { v: 0 }, scheduler: targetScheduler });
        targetLoop.restore(snapshot);

        expect(targetLoop.status).toBe('paused');
        expect(targetScheduler.hasPending()).toBe(false);
    });

    it('restore() with stopped status does not schedule', () => {
        const sourceScheduler = new ManualScheduler();
        const targetScheduler = new ManualScheduler();

        const sourceLoop = createGameLoop({ state: { v: 1 }, scheduler: sourceScheduler });
        sourceLoop.start(0);
        sourceScheduler.flush(16);
        sourceLoop.stop();

        const snapshot = sourceLoop.snapshot();
        expect(snapshot.status).toBe('stopped');

        const targetLoop = createGameLoop({ state: { v: 0 }, scheduler: targetScheduler });
        targetLoop.restore(snapshot);

        expect(targetLoop.status).toBe('stopped');
        expect(targetScheduler.hasPending()).toBe(false);
    });

    it('snapshotSerialized / restoreSerialized round-trip', () => {
        const serializer: GameLoopStateSerializer<{ score: number }, { s: number }> = {
            serialize: (state) => ({ s: state.score }),
            deserialize: (data) => ({ score: data.s }),
        };

        const sourceScheduler = new ManualScheduler();
        const sourceLoop = createGameLoop({
            state: { score: 0 },
            scheduler: sourceScheduler,
            fixedDelta: 10,
            systems: [{ id: 'scorer', fixedUpdate(ctx) { ctx.state.score += 5; } }],
        });

        sourceLoop.start(0);
        sourceScheduler.flush(25);

        const serializedSnapshot = sourceLoop.snapshotSerialized(serializer);
        expect(serializedSnapshot.state).toEqual({ s: 10 });

        const targetScheduler = new ManualScheduler();
        const targetLoop = createGameLoop({ state: { score: -1 }, scheduler: targetScheduler });
        targetLoop.restoreSerialized(serializedSnapshot, serializer);

        expect(targetLoop.state).toEqual({ score: 10 });
        expect(targetLoop.frame).toBe(1);
    });
});

describe('GameLoop - Scheduler Error Handling', () => {
    it('scheduler.request() failure wraps in GameLoopSchedulerError', () => {
        const scheduler = new ThrowingScheduler();

        expect(() => createGameLoop({ state: {}, scheduler }).start(0)).toThrow(
            GameLoopSchedulerError
        );
    });

    it('scheduler.cancel() failure wraps in GameLoopSchedulerError', () => {
        const scheduler = new ThrowingScheduler();

        // Override request to succeed, but cancel will fail
        const schedulerWithCancel: GameLoopScheduler<number> = {
            kind: 'test',
            now: () => 0,
            request: () => 1,
            cancel: () => { throw new Error('cancel boom'); },
        };

        const loop = createGameLoop({ state: {}, scheduler: schedulerWithCancel });
        loop.start(0);

        expect(() => loop.pause()).toThrow(GameLoopSchedulerError);
    });
});

describe('GameLoop - Visibility Change', () => {
    it('auto-pauses when document becomes hidden while running', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);
        expect(loop.status).toBe('running');

        // Simulate visibility change
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(loop.status).toBe('paused');

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });

    it('auto-resumes when document becomes visible while paused', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);

        // Pause via visibility
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(loop.status).toBe('paused');

        // Resume via visibility
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(loop.status).toBe('running');

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });

    it('does not auto-pause when pauseWhenHidden is not set', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);

        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(loop.status).toBe('running');

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });

    it('removes visibility handler on dispose', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);
        loop.dispose();

        // After dispose, visibility change should not affect the disposed loop
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        // Should not throw
        expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });
});

describe('GameLoop - Page Lifecycle', () => {
    it('pauses a running loop when pagehide fires even while document stays visible', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);
        expect(loop.status).toBe('running');

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('pagehide'));

        expect(loop.status).toBe('paused');
        expect(scheduler.hasPending()).toBe(false);
    });

    it('resumes a paused loop when pageshow fires even while document stays hidden', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);
        loop.pause();
        expect(loop.status).toBe('paused');

        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('pageshow'));

        expect(loop.status).toBe('running');
        expect(scheduler.hasPending()).toBe(true);

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });

    it('round-trips running through pagehide then pageshow', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);
        document.dispatchEvent(new Event('pagehide'));
        expect(loop.status).toBe('paused');

        document.dispatchEvent(new Event('pageshow'));
        expect(loop.status).toBe('running');
        expect(scheduler.hasPending()).toBe(true);
    });

    it('ignores pagehide when pauseWhenHidden is not set', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);

        document.dispatchEvent(new Event('pagehide'));

        expect(loop.status).toBe('running');
        expect(scheduler.hasPending()).toBe(true);
    });

    it('ignores pageshow when pauseWhenHidden is not set', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        loop.pause();
        expect(loop.status).toBe('paused');

        document.dispatchEvent(new Event('pageshow'));

        expect(loop.status).toBe('paused');
        expect(scheduler.hasPending()).toBe(false);
    });

    it('removes pagehide and pageshow listeners on dispose', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        const addedTypes = addEventListenerSpy.mock.calls.map(([type]) => type);
        expect(addedTypes).toContain('pagehide');
        expect(addedTypes).toContain('pageshow');

        const addedPageHideHandler = addEventListenerSpy.mock.calls.find(
            ([type]) => type === 'pagehide'
        )?.[1];
        const addedPageShowHandler = addEventListenerSpy.mock.calls.find(
            ([type]) => type === 'pageshow'
        )?.[1];
        const addedVisibilityHandler = addEventListenerSpy.mock.calls.find(
            ([type]) => type === 'visibilitychange'
        )?.[1];

        loop.dispose();

        const removedCalls = removeEventListenerSpy.mock.calls;
        expect(removedCalls.map(([type]) => type)).toContain('pagehide');
        expect(removedCalls.map(([type]) => type)).toContain('pageshow');
        expect(removedCalls.find(([type]) => type === 'pagehide')?.[1]).toBe(addedPageHideHandler);
        expect(removedCalls.find(([type]) => type === 'pageshow')?.[1]).toBe(addedPageShowHandler);
        expect(removedCalls.find(([type]) => type === 'visibilitychange')?.[1]).toBe(
            addedVisibilityHandler
        );

        addEventListenerSpy.mockRestore();
        removeEventListenerSpy.mockRestore();
    });

    it('leaves the loop untouched when pagehide or pageshow fire after dispose', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            pauseWhenHidden: true,
        });

        loop.start(0);
        loop.dispose();

        expect(() => document.dispatchEvent(new Event('pagehide'))).not.toThrow();
        expect(() => document.dispatchEvent(new Event('pageshow'))).not.toThrow();
        expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();

        expect(loop.isDisposed).toBe(true);
        expect(loop.status).toBe('disposed');
        expect(scheduler.hasPending()).toBe(false);
    });
});

describe('GameLoop - System Management', () => {
    it('addSystem returns this for chaining', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        const result = loop.addSystem({ id: 'chain-a' });
        expect(result).toBe(loop);
    });

    it('hasSystem / getSystem delegate correctly', () => {
        const scheduler = new ManualScheduler();
        const system = { id: 'tracked' };
        const loop = createGameLoop({ state: {}, scheduler, systems: [system] });

        expect(loop.hasSystem('tracked')).toBe(true);
        expect(loop.hasSystem('unknown')).toBe(false);
        expect(loop.getSystem('tracked')).toBe(system);
        expect(loop.getSystem('unknown')).toBeUndefined();
    });

    it('removeSystem by id and by object reference', () => {
        const scheduler = new ManualScheduler();
        const sysA = { id: 'a' };
        const sysB = { id: 'b' };
        const loop = createGameLoop({ state: {}, scheduler, systems: [sysA, sysB] });

        expect(loop.removeSystem('a')).toBe(true);
        expect(loop.hasSystem('a')).toBe(false);

        expect(loop.removeSystem(sysB)).toBe(true);
        expect(loop.hasSystem('b')).toBe(false);
    });

    it('clearSystems removes all systems', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: {},
            scheduler,
            systems: [{ id: 'x' }, { id: 'y' }],
        });

        expect(loop.systemCount).toBe(2);
        loop.clearSystems();
        expect(loop.systemCount).toBe(0);
    });

    it('system management methods throw after dispose', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });
        loop.dispose();

        expect(() => loop.addSystem({ id: 'x' })).toThrow(GameLoopDisposedError);
        expect(() => loop.removeSystem('x')).toThrow(GameLoopDisposedError);
        expect(() => loop.clearSystems()).toThrow(GameLoopDisposedError);
    });
});

describe('GameLoop - replaceState / setTimeScale', () => {
    it('replaceState updates the state', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: { value: 1 }, scheduler });

        loop.replaceState({ value: 99 });
        expect(loop.state).toEqual({ value: 99 });
    });

    it('systems see the replaced state', () => {
        const scheduler = new ManualScheduler();
        let capturedState: any;

        const loop = createGameLoop({
            state: { value: 1 },
            scheduler,
            systems: [
                {
                    id: 'reader',
                    update(ctx) { capturedState = ctx.state; },
                },
            ],
        });

        loop.replaceState({ value: 42 });
        loop.start(0);
        scheduler.flush(16);

        expect(capturedState).toEqual({ value: 42 });
    });

    it('setTimeScale(0) is valid', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.setTimeScale(0);
        expect(loop.timeScale).toBe(0);
    });

    it('setTimeScale with negative value throws', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        expect(() => loop.setTimeScale(-1)).toThrow(GameLoopConfigurationError);
    });

    it('replaceState and setTimeScale throw after dispose', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });
        loop.dispose();

        expect(() => loop.replaceState({})).toThrow(GameLoopDisposedError);
        expect(() => loop.setTimeScale(1)).toThrow(GameLoopDisposedError);
    });
});

describe('GameLoop - Custom messageResolver', () => {
    it('is called with descriptor and locale for runtime errors', () => {
        const throwingScheduler: GameLoopScheduler<number> = {
            kind: 'throwing',
            now: () => 0,
            request: () => { throw new Error('req boom'); },
            cancel: () => {},
        };
        const resolver = vi.fn(() => 'custom scheduler message');

        expect(() =>
            createGameLoop({
                state: {},
                scheduler: throwingScheduler,
                locale: 'fr',
                messageResolver: resolver,
            }).start(0)
        ).toThrow();

        expect(resolver).toHaveBeenCalledOnce();
        const [descriptor, locale] = resolver.mock.calls[0];
        expect(descriptor.code).toBe('loop.scheduler.request-failed');
        expect(locale).toBe('fr');
    });

    it('return value overrides default message for runtime errors', () => {
        const throwingScheduler: GameLoopScheduler<number> = {
            kind: 'throwing',
            now: () => 0,
            request: () => { throw new Error('req boom'); },
            cancel: () => {},
        };

        expect(() =>
            createGameLoop({
                state: {},
                scheduler: throwingScheduler,
                messageResolver: () => 'mon message personnalise',
            }).start(0)
        ).toThrow('mon message personnalise');
    });

    it('returning undefined falls back to default message for runtime errors', () => {
        const throwingScheduler: GameLoopScheduler<number> = {
            kind: 'throwing',
            now: () => 0,
            request: () => { throw new Error('req boom'); },
            cancel: () => {},
        };

        expect(() =>
            createGameLoop({
                state: {},
                scheduler: throwingScheduler,
                messageResolver: () => undefined,
            }).start(0)
        ).toThrow(/scheduler failed/);
    });
});

describe('GameLoop - Default Getters', () => {
    it('exposes correct default values', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: { x: 1 }, scheduler });

        expect(loop.state).toEqual({ x: 1 });
        expect(loop.status).toBe('idle');
        expect(loop.frame).toBe(0);
        expect(loop.elapsed).toBe(0);
        expect(loop.isDisposed).toBe(false);
        expect(loop.systemCount).toBe(0);
        expect(typeof loop.fixedDelta).toBe('number');
        expect(loop.fixedDelta).toBeGreaterThan(0);
        expect(typeof loop.maxDelta).toBe('number');
        expect(loop.maxDelta).toBeGreaterThan(0);
        expect(typeof loop.maxSubSteps).toBe('number');
        expect(loop.maxSubSteps).toBeGreaterThan(0);
        expect(loop.timeScale).toBe(1);
    });
});

describe('GameLoop - Dispose', () => {
    it('dispose is idempotent', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.dispose();
        expect(() => loop.dispose()).not.toThrow();
        expect(loop.isDisposed).toBe(true);
    });

    it('dispose cancels scheduled frames', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler });

        loop.start(0);
        expect(scheduler.hasPending()).toBe(true);

        loop.dispose();
        expect(scheduler.hasPending()).toBe(false);
    });

    it('dispose calls system dispose methods', () => {
        const scheduler = new ManualScheduler();
        const disposeA = vi.fn();
        const disposeB = vi.fn();

        const loop = createGameLoop({
            state: {},
            scheduler,
            systems: [
                { id: 'a', dispose: disposeA },
                { id: 'b', dispose: disposeB },
            ],
        });

        loop.dispose();

        expect(disposeA).toHaveBeenCalledOnce();
        expect(disposeB).toHaveBeenCalledOnce();
    });
});

describe('GameLoop - autoStart', () => {
    it('starts automatically when autoStart is true', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({ state: {}, scheduler, autoStart: true });

        expect(loop.status).toBe('running');
        expect(scheduler.hasPending()).toBe(true);
    });
});
