import {
    GameLoopConfigurationError,
    GameLoopDisposedError,
    GameLoopSchedulerError,
    GameLoopSnapshotError,
} from './errors';
import {
    GameLoopSystemRunner,
    type GameLoopSystemRunnerRuntime,
} from './game-loop-system-runner';
import { createAnimationFrameScheduler, isGameLoopScheduler } from './scheduler';
import type { DeepReadonly } from '@axrone/utility';
import type {
    AfterFrameContext,
    BeforeUpdateContext,
    FixedUpdateContext,
    GameLoopContextBase,
    GameLoopController,
    GameLoopErrorPolicy,
    GameLoopFramePhase,
    GameLoopMessageDescriptor,
    GameLoopMessageResolver,
    GameLoopOptions,
    GameLoopPhaseContext,
    GameLoopScheduler,
    GameLoopSnapshot,
    GameLoopStateSerializer,
    GameLoopStatus,
    GameLoopSystem,
    RenderContext,
    UpdateContext,
} from './types';

const DEFAULT_FIXED_DELTA = 1000 / 60;
const DEFAULT_MAX_DELTA = 250;
const DEFAULT_MAX_SUB_STEPS = 8;
const DEFAULT_TIME_SCALE = 1;
const DEFAULT_RETRY_ATTEMPTS = 0;
const DEFAULT_ERROR_POLICY: GameLoopErrorPolicy = 'continue';
const DEFAULT_LOCALE = 'en';
const EPSILON = 1e-7;
const SNAPSHOT_VERSION = 1 as const;

type Mutable<T> = {
    -readonly [TKey in keyof T]: T[TKey];
};

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
    isFiniteNumber(value) && value >= 0;

const isPositiveFiniteNumber = (value: unknown): value is number =>
    isFiniteNumber(value) && value > 0;

const isSafeNonNegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const stringifyUnknown = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }

    return String(value);
};

const normalizeAlpha = (value: number): number => {
    if (value <= 0) {
        return 0;
    }

    if (value >= 1) {
        return 1;
    }

    return value;
};

const defaultMessageResolver = (descriptor: GameLoopMessageDescriptor): string => {
    switch (descriptor.code) {
        case 'loop.invalid-fixed-delta':
            return `Expected fixedDelta to be a finite number greater than 0, received ${String(
                descriptor.value
            )}`;
        case 'loop.invalid-max-delta':
            return `Expected maxDelta to be a finite number greater than 0, received ${String(
                descriptor.value
            )}`;
        case 'loop.invalid-max-sub-steps':
            return `Expected maxSubSteps to be a safe integer greater than 0, received ${String(
                descriptor.value
            )}`;
        case 'loop.invalid-retry-attempts':
            return `Expected retry attempts to be a safe integer greater than or equal to 0, received ${String(
                descriptor.value
            )}`;
        case 'loop.invalid-scheduler':
            return `Expected scheduler to expose kind, now, request, and cancel members, received ${String(
                descriptor.value
            )}`;
        case 'loop.invalid-system':
            return descriptor.reason;
        case 'loop.invalid-time-scale':
            return `Expected timeScale to be a finite number greater than or equal to 0, received ${String(
                descriptor.value
            )}`;
        case 'loop.invalid-timestamp':
            return `Expected timestamp to be a finite number greater than or equal to 0, received ${String(
                descriptor.value
            )}`;
        case 'loop.duplicate-system':
            return `A system with id "${descriptor.systemId}" is already registered`;
        case 'loop.disposed':
            return 'The game loop has already been disposed';
        case 'loop.scheduler.request-failed':
            return `The scheduler failed to request a frame: ${stringifyUnknown(descriptor.reason)}`;
        case 'loop.scheduler.cancel-failed':
            return `The scheduler failed to cancel a frame: ${stringifyUnknown(descriptor.reason)}`;
        case 'loop.snapshot.invalid':
            return descriptor.reason;
        case 'loop.system.failed':
            return `System "${descriptor.systemId}" failed during ${descriptor.phase} on attempt ${descriptor.attempt}: ${stringifyUnknown(
                descriptor.error
            )}`;
    }
};

export const isGameLoopSnapshot = (value: unknown): value is GameLoopSnapshot<unknown> => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const version = Reflect.get(value, 'version');
    const status = Reflect.get(value, 'status');
    const frame = Reflect.get(value, 'frame');
    const elapsed = Reflect.get(value, 'elapsed');
    const accumulator = Reflect.get(value, 'accumulator');
    const fixedDelta = Reflect.get(value, 'fixedDelta');
    const maxDelta = Reflect.get(value, 'maxDelta');
    const maxSubSteps = Reflect.get(value, 'maxSubSteps');
    const timeScale = Reflect.get(value, 'timeScale');
    const capturedAtEpochMs = Reflect.get(value, 'capturedAtEpochMs');

    return (
        version === SNAPSHOT_VERSION &&
        (status === 'idle' ||
            status === 'running' ||
            status === 'paused' ||
            status === 'stopped') &&
        isSafeNonNegativeInteger(frame) &&
        isNonNegativeFiniteNumber(elapsed) &&
        isNonNegativeFiniteNumber(accumulator) &&
        isPositiveFiniteNumber(fixedDelta) &&
        isPositiveFiniteNumber(maxDelta) &&
        isPositiveSafeInteger(maxSubSteps) &&
        isNonNegativeFiniteNumber(timeScale) &&
        isSafeNonNegativeInteger(capturedAtEpochMs)
    );
};

export class GameLoop<TState> implements GameLoopController<TState> {
    private _state: TState;
    private readonly _scheduler: GameLoopScheduler;
    private readonly _locale: string;
    private readonly _messageResolver?: GameLoopMessageResolver;
    private readonly _systemRunner: GameLoopSystemRunner<TState>;
    private readonly _systemRunnerRuntime: GameLoopSystemRunnerRuntime<TState>;
    private _status: GameLoopStatus = 'idle';
    private _frame = 0;
    private _elapsed = 0;
    private _accumulator = 0;
    private _lastTimestamp: number | null = null;
    private _scheduledFrame: unknown = undefined;
    private _fixedDelta: number;
    private _maxDelta: number;
    private _maxSubSteps: number;
    private _timeScale: number;
    private _disposed = false;
    private readonly _beforeUpdateContext: Mutable<BeforeUpdateContext<TState>>;
    private readonly _fixedUpdateContext: Mutable<FixedUpdateContext<TState>>;
    private readonly _updateContext: Mutable<UpdateContext<TState>>;
    private readonly _renderContext: Mutable<RenderContext<TState>>;
    private readonly _afterFrameContext: Mutable<AfterFrameContext<TState>>;

    constructor(options: GameLoopOptions<TState>) {
        this._state = options.state;
        this._fixedDelta = this._assertPositiveFiniteNumber(
            options.fixedDelta ?? DEFAULT_FIXED_DELTA,
            'loop.invalid-fixed-delta'
        );
        this._maxDelta = this._assertPositiveFiniteNumber(
            options.maxDelta ?? DEFAULT_MAX_DELTA,
            'loop.invalid-max-delta'
        );
        this._maxSubSteps = this._assertPositiveSafeInteger(
            options.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS,
            'loop.invalid-max-sub-steps'
        );
        this._timeScale = this._assertNonNegativeFiniteNumber(
            options.timeScale ?? DEFAULT_TIME_SCALE,
            'loop.invalid-time-scale'
        );
        const retryAttempts = this._assertSafeNonNegativeInteger(
            options.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS,
            'loop.invalid-retry-attempts'
        );
        this._locale = options.locale ?? DEFAULT_LOCALE;
        this._messageResolver = options.messageResolver;

        const scheduler = options.scheduler ?? createAnimationFrameScheduler();

        if (!isGameLoopScheduler(scheduler)) {
            throw new GameLoopConfigurationError(
                'loop.invalid-scheduler',
                this._resolveMessage({
                    code: 'loop.invalid-scheduler',
                    value: scheduler,
                })
            );
        }

        this._scheduler = scheduler;
        this._systemRunner = new GameLoopSystemRunner({
            errorPolicy: options.errorPolicy ?? DEFAULT_ERROR_POLICY,
            retryAttempts,
            resolveMessage: (descriptor) => this._resolveMessage(descriptor),
            onError: options.onError,
            shouldRetry: options.retry?.shouldRetry,
        });
        this._systemRunnerRuntime = {
            getState: () => this._state,
            getFrame: () => this._frame,
            getElapsed: () => this._elapsed,
            isRunning: () => this._status === 'running',
            pause: () => this.pause(),
            stop: () => this.stop(),
            safeNow: () => this._safeNow(),
        };

        this._beforeUpdateContext = {
            phase: 'before-update',
            loop: this,
            state: this._state,
            frame: 0,
            now: 0,
            elapsed: 0,
            delta: 0,
            unscaledDelta: 0,
            accumulator: 0,
            fixedDelta: this._fixedDelta,
            timeScale: this._timeScale,
        };

        this._fixedUpdateContext = {
            phase: 'fixed-update',
            loop: this,
            state: this._state,
            frame: 0,
            now: 0,
            elapsed: 0,
            delta: this._fixedDelta,
            unscaledDelta: this._fixedDelta,
            accumulator: 0,
            fixedDelta: this._fixedDelta,
            timeScale: this._timeScale,
            step: 0,
            maxSteps: this._maxSubSteps,
        };

        this._updateContext = {
            phase: 'update',
            loop: this,
            state: this._state,
            frame: 0,
            now: 0,
            elapsed: 0,
            delta: 0,
            unscaledDelta: 0,
            accumulator: 0,
            fixedDelta: this._fixedDelta,
            timeScale: this._timeScale,
        };

        this._renderContext = {
            phase: 'render',
            loop: this,
            state: this._state,
            frame: 0,
            now: 0,
            elapsed: 0,
            delta: 0,
            unscaledDelta: 0,
            accumulator: 0,
            fixedDelta: this._fixedDelta,
            timeScale: this._timeScale,
            alpha: 0,
        };

        this._afterFrameContext = {
            phase: 'after-frame',
            loop: this,
            state: this._state,
            frame: 0,
            now: 0,
            elapsed: 0,
            delta: 0,
            unscaledDelta: 0,
            accumulator: 0,
            fixedDelta: this._fixedDelta,
            timeScale: this._timeScale,
            alpha: 0,
            fixedSteps: 0,
            droppedDelta: 0,
        };

        if (options.systems !== undefined) {
            for (const system of options.systems) {
                this.addSystem(system);
            }
        }

        if (options.autoStart) {
            this.start();
        }
    }

    get state(): TState {
        return this._state;
    }

    get status(): GameLoopStatus {
        return this._status;
    }

    get frame(): number {
        return this._frame;
    }

    get elapsed(): number {
        return this._elapsed;
    }

    get fixedDelta(): number {
        return this._fixedDelta;
    }

    get maxDelta(): number {
        return this._maxDelta;
    }

    get maxSubSteps(): number {
        return this._maxSubSteps;
    }

    get timeScale(): number {
        return this._timeScale;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get systemCount(): number {
        return this._systemRunner.systemCount;
    }

    addSystem(system: GameLoopSystem<TState>): this {
        this._assertNotDisposed();
        this._systemRunner.addSystem(system);

        return this;
    }

    hasSystem(systemId: string): boolean {
        return this._systemRunner.hasSystem(systemId);
    }

    getSystem(systemId: string): GameLoopSystem<TState> | undefined {
        return this._systemRunner.getSystem(systemId);
    }

    removeSystem(systemOrId: string | GameLoopSystem<TState>): boolean {
        this._assertNotDisposed();
        return this._systemRunner.removeSystem(systemOrId, this._systemRunnerRuntime);
    }

    clearSystems(): void {
        this._assertNotDisposed();
        this._systemRunner.clearSystems(this._systemRunnerRuntime);
    }

    replaceState(nextState: TState): void {
        this._assertNotDisposed();
        this._state = nextState;
    }

    setTimeScale(value: number): void {
        this._assertNotDisposed();
        this._timeScale = this._assertNonNegativeFiniteNumber(value, 'loop.invalid-time-scale');
    }

    start(now: number = this._scheduler.now()): this {
        this._assertNotDisposed();

        if (this._status === 'running') {
            return this;
        }

        if (this._status === 'paused') {
            return this.resume(now);
        }

        this._status = 'running';
        this._lastTimestamp = this._assertNonNegativeFiniteNumber(now, 'loop.invalid-timestamp');
        this._scheduleNextFrame();

        return this;
    }

    pause(): void {
        this._assertNotDisposed();

        if (this._status !== 'running') {
            return;
        }

        this._status = 'paused';
        this._lastTimestamp = null;
        this._cancelScheduledFrame();
    }

    resume(now: number = this._scheduler.now()): this {
        this._assertNotDisposed();

        if (this._status === 'running') {
            return this;
        }

        if (this._status !== 'paused') {
            return this.start(now);
        }

        this._status = 'running';
        this._lastTimestamp = this._assertNonNegativeFiniteNumber(now, 'loop.invalid-timestamp');
        this._scheduleNextFrame();

        return this;
    }

    stop(): void {
        this._assertNotDisposed();

        if (this._status === 'stopped') {
            return;
        }

        this._status = 'stopped';
        this._lastTimestamp = null;
        this._accumulator = 0;
        this._cancelScheduledFrame();
    }

    snapshot(): GameLoopSnapshot<TState> {
        this._assertNotDisposed();
        return this._createSnapshot(this._state);
    }

    snapshotSerialized<TSerialized>(
        serializer: GameLoopStateSerializer<TState, TSerialized>
    ): GameLoopSnapshot<TSerialized> {
        this._assertNotDisposed();
        return this._createSnapshot(serializer.serialize(this._state as DeepReadonly<TState>));
    }

    restore(snapshot: GameLoopSnapshot<TState>): this {
        return this._restoreInternal(snapshot, snapshot.state);
    }

    restoreSerialized<TSerialized>(
        snapshot: GameLoopSnapshot<TSerialized>,
        serializer: GameLoopStateSerializer<TState, TSerialized>
    ): this {
        return this._restoreInternal(snapshot, serializer.deserialize(snapshot.state));
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        let firstError: Error | undefined;

        try {
            this._cancelScheduledFrame();
        } catch (error) {
            if (firstError === undefined && error instanceof Error) {
                firstError = error;
            }
        }

        const systemDisposalError = this._systemRunner.disposeAllSystems(this._systemRunnerRuntime);

        if (firstError === undefined && systemDisposalError !== undefined) {
            firstError = systemDisposalError;
        }

        this._status = 'disposed';
        this._disposed = true;
        this._lastTimestamp = null;
        this._accumulator = 0;

        if (firstError !== undefined) {
            throw firstError;
        }
    }

    private readonly _handleFrame = (now: number): void => {
        this._scheduledFrame = undefined;

        if (this._status !== 'running') {
            return;
        }

        try {
            this._processFrame(now);
        } catch (error) {
            this._status = 'stopped';
            this._lastTimestamp = null;
            this._accumulator = 0;
            throw error;
        }

        if (this._status === 'running' && this._scheduledFrame === undefined) {
            this._scheduleNextFrame();
        }
    };

    private _processFrame(now: number): void {
        const timestamp = this._assertNonNegativeFiniteNumber(now, 'loop.invalid-timestamp');
        const previousTimestamp = this._lastTimestamp ?? timestamp;
        const rawDelta = Math.max(0, timestamp - previousTimestamp);
        const unscaledDelta = rawDelta > this._maxDelta ? this._maxDelta : rawDelta;
        const scaledDelta = unscaledDelta * this._timeScale;

        this._lastTimestamp = timestamp;
        this._frame += 1;
        this._elapsed += scaledDelta;
        this._accumulator += scaledDelta;

        this._syncBaseContext(
            this._beforeUpdateContext,
            timestamp,
            scaledDelta,
            unscaledDelta,
            this._accumulator
        );
        this._invokePhase('before-update', this._beforeUpdateContext);

        if (this._status !== 'running') {
            return;
        }

        let fixedSteps = 0;

        while (
            this._status === 'running' &&
            this._accumulator + EPSILON >= this._fixedDelta &&
            fixedSteps < this._maxSubSteps
        ) {
            this._accumulator = Math.max(0, this._accumulator - this._fixedDelta);
            fixedSteps += 1;
            this._syncBaseContext(
                this._fixedUpdateContext,
                timestamp,
                this._fixedDelta,
                this._timeScale > 0 ? this._fixedDelta / this._timeScale : 0,
                this._accumulator
            );
            this._fixedUpdateContext.step = fixedSteps;
            this._fixedUpdateContext.maxSteps = this._maxSubSteps;
            this._invokePhase('fixed-update', this._fixedUpdateContext);
        }

        if (this._status !== 'running') {
            return;
        }

        let droppedDelta = 0;

        if (this._accumulator + EPSILON >= this._fixedDelta) {
            const remainder = this._accumulator % this._fixedDelta;
            droppedDelta = this._accumulator - remainder;
            this._accumulator = remainder;
        }

        this._syncBaseContext(
            this._updateContext,
            timestamp,
            scaledDelta,
            unscaledDelta,
            this._accumulator
        );
        this._invokePhase('update', this._updateContext);

        if (this._status !== 'running') {
            return;
        }

        const alpha = normalizeAlpha(this._accumulator / this._fixedDelta);
        this._syncBaseContext(
            this._renderContext,
            timestamp,
            scaledDelta,
            unscaledDelta,
            this._accumulator
        );
        this._renderContext.alpha = alpha;
        this._invokePhase('render', this._renderContext);

        if (this._status !== 'running') {
            return;
        }

        this._syncBaseContext(
            this._afterFrameContext,
            timestamp,
            scaledDelta,
            unscaledDelta,
            this._accumulator
        );
        this._afterFrameContext.alpha = alpha;
        this._afterFrameContext.fixedSteps = fixedSteps;
        this._afterFrameContext.droppedDelta = droppedDelta;
        this._invokePhase('after-frame', this._afterFrameContext);
    }

    private _invokePhase<TPhase extends GameLoopFramePhase>(
        phase: TPhase,
        context: GameLoopPhaseContext<TState, TPhase>
    ): void {
        this._systemRunner.invokePhase(phase, context, this._systemRunnerRuntime);
    }

    private _createSnapshot<TSnapshotState>(
        state: TSnapshotState
    ): GameLoopSnapshot<TSnapshotState> {
        return {
            version: SNAPSHOT_VERSION,
            status: this._status === 'disposed' ? 'stopped' : this._status,
            state,
            frame: this._frame,
            elapsed: this._elapsed,
            accumulator: this._accumulator,
            fixedDelta: this._fixedDelta,
            maxDelta: this._maxDelta,
            maxSubSteps: this._maxSubSteps,
            timeScale: this._timeScale,
            capturedAtEpochMs: Date.now(),
        };
    }

    private _restoreInternal<TSnapshotState>(
        snapshot: GameLoopSnapshot<TSnapshotState>,
        state: TState
    ): this {
        this._assertNotDisposed();

        if (!isGameLoopSnapshot(snapshot)) {
            throw new GameLoopSnapshotError(
                this._resolveMessage({
                    code: 'loop.snapshot.invalid',
                    reason: 'A game loop snapshot must include a supported version, valid status, finite timings, and positive step configuration values',
                })
            );
        }

        this._cancelScheduledFrame();
        this._state = state;
        this._frame = snapshot.frame;
        this._elapsed = snapshot.elapsed;
        this._accumulator = snapshot.accumulator;
        this._fixedDelta = this._assertPositiveFiniteNumber(
            snapshot.fixedDelta,
            'loop.invalid-fixed-delta'
        );
        this._maxDelta = this._assertPositiveFiniteNumber(
            snapshot.maxDelta,
            'loop.invalid-max-delta'
        );
        this._maxSubSteps = this._assertPositiveSafeInteger(
            snapshot.maxSubSteps,
            'loop.invalid-max-sub-steps'
        );
        this._timeScale = this._assertNonNegativeFiniteNumber(
            snapshot.timeScale,
            'loop.invalid-time-scale'
        );
        this._lastTimestamp = null;
        this._status = snapshot.status;

        if (snapshot.status === 'running') {
            this._lastTimestamp = this._assertNonNegativeFiniteNumber(
                this._scheduler.now(),
                'loop.invalid-timestamp'
            );
            this._scheduleNextFrame();
        }

        return this;
    }

    private _syncBaseContext<TPhase extends GameLoopFramePhase>(
        target: Mutable<GameLoopContextBase<TState, TPhase>>,
        now: number,
        delta: number,
        unscaledDelta: number,
        accumulator: number
    ): void {
        target.loop = this;
        target.state = this._state;
        target.frame = this._frame;
        target.now = now;
        target.elapsed = this._elapsed;
        target.delta = delta;
        target.unscaledDelta = unscaledDelta;
        target.accumulator = accumulator;
        target.fixedDelta = this._fixedDelta;
        target.timeScale = this._timeScale;
    }

    private _scheduleNextFrame(): void {
        if (this._status !== 'running' || this._scheduledFrame !== undefined) {
            return;
        }

        try {
            this._scheduledFrame = this._scheduler.request(this._handleFrame);
        } catch (error) {
            throw new GameLoopSchedulerError(
                'loop.scheduler.request-failed',
                this._resolveMessage({
                    code: 'loop.scheduler.request-failed',
                    reason: error,
                }),
                { cause: error }
            );
        }
    }

    private _cancelScheduledFrame(): void {
        if (this._scheduledFrame === undefined) {
            return;
        }

        const scheduledFrame = this._scheduledFrame;
        this._scheduledFrame = undefined;

        try {
            this._scheduler.cancel(scheduledFrame);
        } catch (error) {
            throw new GameLoopSchedulerError(
                'loop.scheduler.cancel-failed',
                this._resolveMessage({
                    code: 'loop.scheduler.cancel-failed',
                    reason: error,
                }),
                { cause: error }
            );
        }
    }

    private _safeNow(): number {
        try {
            return this._assertNonNegativeFiniteNumber(
                this._scheduler.now(),
                'loop.invalid-timestamp'
            );
        } catch {
            return Date.now();
        }
    }

    private _assertNotDisposed(): void {
        if (!this._disposed) {
            return;
        }

        throw new GameLoopDisposedError(
            this._resolveMessage({
                code: 'loop.disposed',
            })
        );
    }

    private _assertPositiveFiniteNumber(
        value: unknown,
        code: 'loop.invalid-fixed-delta' | 'loop.invalid-max-delta'
    ): number {
        if (isPositiveFiniteNumber(value)) {
            return value;
        }

        throw new GameLoopConfigurationError(
            code,
            this._resolveMessage({
                code,
                value,
            })
        );
    }

    private _assertPositiveSafeInteger(value: unknown, code: 'loop.invalid-max-sub-steps'): number {
        if (isPositiveSafeInteger(value)) {
            return value;
        }

        throw new GameLoopConfigurationError(
            code,
            this._resolveMessage({
                code,
                value,
            })
        );
    }

    private _assertSafeNonNegativeInteger(
        value: unknown,
        code: 'loop.invalid-retry-attempts'
    ): number {
        if (isSafeNonNegativeInteger(value)) {
            return value;
        }

        throw new GameLoopConfigurationError(
            code,
            this._resolveMessage({
                code,
                value,
            })
        );
    }

    private _assertNonNegativeFiniteNumber(
        value: unknown,
        code: 'loop.invalid-time-scale' | 'loop.invalid-timestamp'
    ): number {
        if (isNonNegativeFiniteNumber(value)) {
            return value;
        }

        throw new GameLoopConfigurationError(
            code,
            this._resolveMessage({
                code,
                value,
            })
        );
    }

    private _resolveMessage(descriptor: GameLoopMessageDescriptor): string {
        return (
            this._messageResolver?.(descriptor, this._locale) ?? defaultMessageResolver(descriptor)
        );
    }
}

export { isGameLoopSystem } from './game-loop-system-runner';

export const createGameLoop = <TState>(options: GameLoopOptions<TState>): GameLoop<TState> =>
    new GameLoop(options);
