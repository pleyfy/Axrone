import {
    createGameLoop,
    GameLoopDisposedError,
    type GameLoopScheduler,
    type GameLoopStateSerializer,
} from '../../game-loop';

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
        const pending = [...this._pending.entries()].sort((left, right) => left[0] - right[0]);
        this._pending.clear();

        for (const [, callback] of pending) {
            callback(time);
        }
    }
}

describe('GameLoop', () => {
    test('runs systems in priority order across frame phases', () => {
        const scheduler = new ManualScheduler();
        const calls: string[] = [];
        const state = { value: 0 };

        const loop = createGameLoop({
            state,
            scheduler,
            fixedDelta: 10,
            systems: [
                {
                    id: 'low',
                    priority: 1,
                    beforeUpdate(context) {
                        calls.push(`before:low:${context.delta}`);
                    },
                    fixedUpdate(context) {
                        calls.push(`fixed:low:${context.step}`);
                        context.state.value += 1;
                    },
                    update(context) {
                        calls.push(`update:low:${context.delta}`);
                    },
                    render(context) {
                        calls.push(`render:low:${context.alpha.toFixed(2)}:${context.state.value}`);
                    },
                    afterFrame(context) {
                        calls.push(`after:low:${context.fixedSteps}:${context.droppedDelta}`);
                    },
                },
                {
                    id: 'high',
                    priority: 10,
                    beforeUpdate() {
                        calls.push('before:high');
                    },
                    fixedUpdate() {
                        calls.push('fixed:high');
                    },
                    update() {
                        calls.push('update:high');
                    },
                    render() {
                        calls.push('render:high');
                    },
                    afterFrame() {
                        calls.push('after:high');
                    },
                },
            ],
        });

        loop.start(0);
        scheduler.flush(16);

        expect(calls).toEqual([
            'before:high',
            'before:low:16',
            'fixed:high',
            'fixed:low:1',
            'update:high',
            'update:low:16',
            'render:high',
            'render:low:0.60:1',
            'after:high',
            'after:low:1:0',
        ]);
        expect(state.value).toBe(1);
    });

    test('retries failing systems and pauses when retries are exhausted', () => {
        const scheduler = new ManualScheduler();
        let attempts = 0;
        const failures: Array<{ phase: string; attempt: number }> = [];

        const loop = createGameLoop({
            state: { failures: 0 },
            scheduler,
            retry: {
                attempts: 1,
            },
            errorPolicy: 'pause',
            onError(error, failure) {
                failures.push({ phase: failure.phase, attempt: failure.attempt });
                expect(error.systemId).toBe('unstable');
                return 'pause';
            },
            systems: [
                {
                    id: 'unstable',
                    update() {
                        attempts += 1;
                        throw new Error('boom');
                    },
                },
            ],
        });

        loop.start(0);
        scheduler.flush(16);

        expect(attempts).toBe(2);
        expect(failures).toEqual([{ phase: 'update', attempt: 2 }]);
        expect(loop.status).toBe('paused');
        expect(scheduler.hasPending()).toBe(false);
    });

    test('drops excess fixed steps when the frame budget is exceeded', () => {
        const scheduler = new ManualScheduler();
        let summary: { fixedSteps: number; droppedDelta: number; alpha: number } | undefined;

        const loop = createGameLoop({
            state: {},
            scheduler,
            fixedDelta: 10,
            maxSubSteps: 3,
            systems: [
                {
                    id: 'summary',
                    afterFrame(context) {
                        summary = {
                            fixedSteps: context.fixedSteps,
                            droppedDelta: context.droppedDelta,
                            alpha: context.alpha,
                        };
                    },
                },
            ],
        });

        loop.start(0);
        scheduler.flush(100);

        expect(summary).toEqual({ fixedSteps: 3, droppedDelta: 70, alpha: 0 });
    });

    test('serializes and restores loop state with a serializer', () => {
        const sourceScheduler = new ManualScheduler();
        const serializer: GameLoopStateSerializer<{ score: number }, { score: number }> = {
            serialize: (state) => ({ score: state.score }),
            deserialize: (state) => ({ score: state.score }),
        };

        const sourceLoop = createGameLoop({
            state: { score: 0 },
            scheduler: sourceScheduler,
            fixedDelta: 10,
            systems: [
                {
                    id: 'score',
                    fixedUpdate(context) {
                        context.state.score += 1;
                    },
                },
            ],
        });

        sourceLoop.start(0);
        sourceScheduler.flush(25);

        const snapshot = sourceLoop.snapshotSerialized(serializer);
        const targetScheduler = new ManualScheduler();
        const targetLoop = createGameLoop({
            state: { score: -1 },
            scheduler: targetScheduler,
        });

        targetLoop.restoreSerialized(snapshot, serializer);

        expect(targetLoop.state).toEqual({ score: 2 });
        expect(targetLoop.frame).toBe(1);
        expect(targetLoop.elapsed).toBe(25);
        expect(targetLoop.status).toBe('running');
        expect(targetScheduler.hasPending()).toBe(true);

        targetLoop.pause();
    });

    test('disposes scheduled work and rejects further use', () => {
        const scheduler = new ManualScheduler();
        const loop = createGameLoop({
            state: { value: 0 },
            scheduler,
        });

        loop.start(0);
        expect(scheduler.hasPending()).toBe(true);

        loop.dispose();

        expect(loop.isDisposed).toBe(true);
        expect(loop.status).toBe('disposed');
        expect(scheduler.hasPending()).toBe(false);
        expect(() => loop.start()).toThrow(GameLoopDisposedError);
    });
});