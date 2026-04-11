import { GameLoopConfigurationError, GameLoopSystemError } from './errors';
import type {
    GameLoopErrorPolicy,
    GameLoopFailureContext,
    GameLoopFramePhase,
    GameLoopMessageDescriptor,
    GameLoopOptions,
    GameLoopPhaseContext,
    GameLoopPhaseHandler,
    GameLoopPhaseMethodName,
    GameLoopRetryPolicy,
    GameLoopSystem,
} from './types';

const PHASE_TO_METHOD = {
    'before-update': 'beforeUpdate',
    'fixed-update': 'fixedUpdate',
    update: 'update',
    render: 'render',
    'after-frame': 'afterFrame',
} as const satisfies {
    readonly [TPhase in GameLoopFramePhase]: GameLoopPhaseMethodName<TPhase>;
};

const SYSTEM_METHOD_NAMES = [
    'beforeUpdate',
    'fixedUpdate',
    'update',
    'render',
    'afterFrame',
    'dispose',
] as const;

interface RegisteredSystem<TState> {
    readonly system: GameLoopSystem<TState>;
    readonly order: number;
}

export interface GameLoopSystemRunnerRuntime<TState> {
    getState(): TState;
    getFrame(): number;
    getElapsed(): number;
    isRunning(): boolean;
    pause(): void;
    stop(): void;
    safeNow(): number;
}

interface GameLoopSystemRunnerOptions<TState> {
    readonly errorPolicy: GameLoopErrorPolicy;
    readonly retryAttempts: number;
    readonly resolveMessage: (descriptor: GameLoopMessageDescriptor) => string;
    readonly onError?: GameLoopOptions<TState>['onError'];
    readonly shouldRetry?: GameLoopRetryPolicy<TState>['shouldRetry'];
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isErrorPolicy = (value: unknown): value is GameLoopErrorPolicy =>
    value === 'throw' || value === 'pause' || value === 'stop' || value === 'continue';

export const isGameLoopSystem = (value: unknown): value is GameLoopSystem<unknown> => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const id = Reflect.get(value, 'id');
    const priority = Reflect.get(value, 'priority');
    const enabled = Reflect.get(value, 'enabled');

    if (typeof id !== 'string' || id.trim().length === 0) {
        return false;
    }

    if (priority !== undefined && !isFiniteNumber(priority)) {
        return false;
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
        return false;
    }

    return SYSTEM_METHOD_NAMES.every((methodName) => {
        const method = Reflect.get(value, methodName);
        return method === undefined || typeof method === 'function';
    });
};

export class GameLoopSystemRunner<TState> {
    private readonly _systems = new Map<string, RegisteredSystem<TState>>();
    private _sortedSystems: readonly RegisteredSystem<TState>[] = [];
    private _systemsDirty = false;
    private _nextSystemOrder = 0;
    private readonly _errorPolicy: GameLoopErrorPolicy;
    private readonly _retryAttempts: number;
    private readonly _resolveMessage: (descriptor: GameLoopMessageDescriptor) => string;
    private readonly _onError?: GameLoopOptions<TState>['onError'];
    private readonly _shouldRetry?: GameLoopRetryPolicy<TState>['shouldRetry'];

    constructor(options: GameLoopSystemRunnerOptions<TState>) {
        this._errorPolicy = options.errorPolicy;
        this._retryAttempts = options.retryAttempts;
        this._resolveMessage = options.resolveMessage;
        this._onError = options.onError;
        this._shouldRetry = options.shouldRetry;
    }

    get systemCount(): number {
        return this._systems.size;
    }

    addSystem(system: GameLoopSystem<TState>): void {
        if (!isGameLoopSystem(system)) {
            throw new GameLoopConfigurationError(
                'loop.invalid-system',
                this._resolveMessage({
                    code: 'loop.invalid-system',
                    reason: 'A game loop system must define a non-empty id, optional numeric priority, optional boolean enabled flag, and function hooks when provided',
                })
            );
        }

        if (this._systems.has(system.id)) {
            throw new GameLoopConfigurationError(
                'loop.duplicate-system',
                this._resolveMessage({
                    code: 'loop.duplicate-system',
                    systemId: system.id,
                })
            );
        }

        this._systems.set(system.id, {
            system,
            order: this._nextSystemOrder++,
        });
        this._systemsDirty = true;
    }

    hasSystem(systemId: string): boolean {
        return this._systems.has(systemId);
    }

    getSystem(systemId: string): GameLoopSystem<TState> | undefined {
        return this._systems.get(systemId)?.system;
    }

    removeSystem(
        systemOrId: string | GameLoopSystem<TState>,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): boolean {
        const systemId = typeof systemOrId === 'string' ? systemOrId : systemOrId.id;
        const registered = this._systems.get(systemId);

        if (registered === undefined) {
            return false;
        }

        this._systems.delete(systemId);
        this._systemsDirty = true;
        const disposalError = this._disposeSystem(registered.system, runtime);

        if (disposalError !== undefined) {
            throw disposalError;
        }

        return true;
    }

    clearSystems(runtime: GameLoopSystemRunnerRuntime<TState>): void {
        const firstError = this.disposeAllSystems(runtime);

        if (firstError !== undefined) {
            throw firstError;
        }
    }

    disposeAllSystems(
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): GameLoopSystemError | undefined {
        const registeredSystems = [...this._systems.values()];
        this._systems.clear();
        this._sortedSystems = [];
        this._systemsDirty = false;

        let firstError: GameLoopSystemError | undefined;

        for (const registered of registeredSystems) {
            const disposalError = this._disposeSystem(registered.system, runtime);

            if (firstError === undefined && disposalError !== undefined) {
                firstError = disposalError;
            }
        }

        return firstError;
    }

    invokePhase<TPhase extends GameLoopFramePhase>(
        phase: TPhase,
        context: GameLoopPhaseContext<TState, TPhase>,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): void {
        const systems = this._getSortedSystems();
        const methodName = PHASE_TO_METHOD[phase];

        for (const registered of systems) {
            if (!runtime.isRunning()) {
                return;
            }

            if (!this._systems.has(registered.system.id) || registered.system.enabled === false) {
                continue;
            }

            const hook = registered.system[methodName];

            if (hook === undefined) {
                continue;
            }

            this._invokeSystem(
                registered.system,
                phase,
                context,
                hook as GameLoopPhaseHandler<TState, TPhase>,
                runtime
            );
        }
    }

    private _invokeSystem<TPhase extends GameLoopFramePhase>(
        system: GameLoopSystem<TState>,
        phase: TPhase,
        context: GameLoopPhaseContext<TState, TPhase>,
        hook: GameLoopPhaseHandler<TState, TPhase>,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): void {
        const maxAttempts = this._retryAttempts + 1;
        let attempt = 0;

        while (attempt < maxAttempts) {
            attempt += 1;

            try {
                hook.call(system, context);
                return;
            } catch (error) {
                const failure = this._createFailureContext(system, phase, context, attempt, runtime);
                const canRetry =
                    attempt < maxAttempts && (this._shouldRetry?.(error, failure) ?? true);

                if (canRetry) {
                    continue;
                }

                this._handleSystemFailure(error, failure, runtime);
                return;
            }
        }
    }

    private _handleSystemFailure(
        error: unknown,
        failure: GameLoopFailureContext<TState>,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): void {
        const wrappedError = new GameLoopSystemError(
            this._resolveMessage({
                code: 'loop.system.failed',
                systemId: failure.system.id,
                phase: failure.phase,
                attempt: failure.attempt,
                error,
            }),
            failure.system.id,
            failure.phase,
            failure.attempt,
            { cause: error }
        );

        const override = this._onError?.(wrappedError, failure);
        const policy = isErrorPolicy(override) ? override : this._errorPolicy;

        switch (policy) {
            case 'continue':
                return;
            case 'pause':
                runtime.pause();
                return;
            case 'stop':
                runtime.stop();
                return;
            case 'throw':
                throw wrappedError;
        }
    }

    private _disposeSystem(
        system: GameLoopSystem<TState>,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): GameLoopSystemError | undefined {
        if (typeof system.dispose !== 'function') {
            return undefined;
        }

        try {
            system.dispose.call(system);
            return undefined;
        } catch (error) {
            const failure = this._createDisposeFailureContext(system, runtime);
            const wrappedError = new GameLoopSystemError(
                this._resolveMessage({
                    code: 'loop.system.failed',
                    systemId: system.id,
                    phase: 'dispose',
                    attempt: 1,
                    error,
                }),
                system.id,
                'dispose',
                1,
                { cause: error }
            );

            this._onError?.(wrappedError, failure);

            return wrappedError;
        }
    }

    private _createFailureContext<TPhase extends GameLoopFramePhase>(
        system: GameLoopSystem<TState>,
        phase: TPhase,
        context: GameLoopPhaseContext<TState, TPhase>,
        attempt: number,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): GameLoopFailureContext<TState> {
        return {
            system,
            phase,
            context,
            frame: runtime.getFrame(),
            now: context.now,
            elapsed: runtime.getElapsed(),
            attempt,
            state: runtime.getState(),
        };
    }

    private _createDisposeFailureContext(
        system: GameLoopSystem<TState>,
        runtime: GameLoopSystemRunnerRuntime<TState>
    ): GameLoopFailureContext<TState> {
        return {
            system,
            phase: 'dispose',
            context: undefined,
            frame: runtime.getFrame(),
            now: runtime.safeNow(),
            elapsed: runtime.getElapsed(),
            attempt: 1,
            state: runtime.getState(),
        };
    }

    private _getSortedSystems(): readonly RegisteredSystem<TState>[] {
        if (!this._systemsDirty) {
            return this._sortedSystems;
        }

        this._sortedSystems = [...this._systems.values()].sort((left, right) => {
            const priorityDelta = (right.system.priority ?? 0) - (left.system.priority ?? 0);

            if (priorityDelta !== 0) {
                return priorityDelta;
            }

            return left.order - right.order;
        });
        this._systemsDirty = false;

        return this._sortedSystems;
    }
}
