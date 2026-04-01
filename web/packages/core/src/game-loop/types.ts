import type { GameLoopSystemError } from './errors';

export type GameLoopStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'disposed';
export type GameLoopErrorPolicy = 'throw' | 'pause' | 'stop' | 'continue';
export type GameLoopFramePhase =
    | 'before-update'
    | 'fixed-update'
    | 'update'
    | 'render'
    | 'after-frame';
export type GameLoopFailurePhase = GameLoopFramePhase | 'dispose';

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
    readonly [key: string]: JsonValue;
}

export interface JsonArray extends ReadonlyArray<JsonValue> {}

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends JsonPrimitive
      ? T
      : T extends ReadonlyArray<infer TItem>
        ? readonly DeepReadonly<TItem>[]
        : T extends object
          ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
          : T;

export type GameLoopValidationMessageCode =
    | `loop.invalid-${
          | 'fixed-delta'
          | 'max-delta'
          | 'max-sub-steps'
          | 'retry-attempts'
          | 'scheduler'
          | 'system'
          | 'time-scale'
          | 'timestamp'}`
    | 'loop.duplicate-system';

export type GameLoopRuntimeMessageCode =
    | 'loop.disposed'
    | 'loop.scheduler.request-failed'
    | 'loop.scheduler.cancel-failed'
    | 'loop.snapshot.invalid'
    | 'loop.system.failed';

export type GameLoopMessageCode = GameLoopValidationMessageCode | GameLoopRuntimeMessageCode;

export type GameLoopMessageDescriptor =
    | {
          readonly code: 'loop.invalid-fixed-delta';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.invalid-max-delta';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.invalid-max-sub-steps';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.invalid-retry-attempts';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.invalid-scheduler';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.invalid-system';
          readonly reason: string;
      }
    | {
          readonly code: 'loop.invalid-time-scale';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.invalid-timestamp';
          readonly value: unknown;
      }
    | {
          readonly code: 'loop.duplicate-system';
          readonly systemId: string;
      }
    | {
          readonly code: 'loop.disposed';
      }
    | {
          readonly code: 'loop.scheduler.request-failed';
          readonly reason: unknown;
      }
    | {
          readonly code: 'loop.scheduler.cancel-failed';
          readonly reason: unknown;
      }
    | {
          readonly code: 'loop.snapshot.invalid';
          readonly reason: string;
      }
    | {
          readonly code: 'loop.system.failed';
          readonly systemId: string;
          readonly phase: GameLoopFailurePhase;
          readonly attempt: number;
          readonly error: unknown;
      };

export type GameLoopMessageResolver = (
    descriptor: GameLoopMessageDescriptor,
    locale: string
) => string | undefined;

export type GameLoopFrameCallback = (timestamp: number) => void;

export interface GameLoopScheduler<THandle = unknown> {
    readonly kind: string;
    now(): number;
    request(callback: GameLoopFrameCallback): THandle;
    cancel(handle: THandle): void;
}

export interface GameLoopStateSerializer<TState, TSerialized = JsonValue> {
    serialize(state: DeepReadonly<TState>): TSerialized;
    deserialize(state: TSerialized): TState;
}

export interface GameLoopController<TState> {
    readonly state: TState;
    readonly status: GameLoopStatus;
    readonly frame: number;
    readonly elapsed: number;
    readonly fixedDelta: number;
    readonly maxDelta: number;
    readonly maxSubSteps: number;
    readonly timeScale: number;
    readonly isDisposed: boolean;
    pause(): void;
    stop(): void;
    replaceState(nextState: TState): void;
    setTimeScale(value: number): void;
}

export interface GameLoopContextBase<TState, TPhase extends GameLoopFramePhase> {
    readonly phase: TPhase;
    readonly loop: GameLoopController<TState>;
    readonly state: TState;
    readonly frame: number;
    readonly now: number;
    readonly elapsed: number;
    readonly delta: number;
    readonly unscaledDelta: number;
    readonly accumulator: number;
    readonly fixedDelta: number;
    readonly timeScale: number;
}

export interface BeforeUpdateContext<TState>
    extends GameLoopContextBase<TState, 'before-update'> {}

export interface FixedUpdateContext<TState>
    extends GameLoopContextBase<TState, 'fixed-update'> {
    readonly step: number;
    readonly maxSteps: number;
}

export interface UpdateContext<TState> extends GameLoopContextBase<TState, 'update'> {}

export interface RenderContext<TState> extends GameLoopContextBase<TState, 'render'> {
    readonly alpha: number;
}

export interface AfterFrameContext<TState>
    extends GameLoopContextBase<TState, 'after-frame'> {
    readonly alpha: number;
    readonly fixedSteps: number;
    readonly droppedDelta: number;
}

export type GameLoopPhaseContext<TState, TPhase extends GameLoopFramePhase = GameLoopFramePhase> =
    TPhase extends 'before-update'
        ? BeforeUpdateContext<TState>
        : TPhase extends 'fixed-update'
          ? FixedUpdateContext<TState>
          : TPhase extends 'update'
            ? UpdateContext<TState>
            : TPhase extends 'render'
              ? RenderContext<TState>
              : AfterFrameContext<TState>;

export type GameLoopPhaseMethodName<TPhase extends GameLoopFramePhase = GameLoopFramePhase> =
    TPhase extends 'before-update'
        ? 'beforeUpdate'
        : TPhase extends 'fixed-update'
          ? 'fixedUpdate'
          : TPhase extends 'update'
            ? 'update'
            : TPhase extends 'render'
              ? 'render'
              : 'afterFrame';

export type GameLoopPhaseHandler<TState, TPhase extends GameLoopFramePhase> = (
    context: GameLoopPhaseContext<TState, TPhase>
) => void;

export type GameLoopSystemHooks<TState> = {
    readonly [TPhase in GameLoopFramePhase as GameLoopPhaseMethodName<TPhase>]?: GameLoopPhaseHandler<
        TState,
        TPhase
    >;
};

export interface GameLoopSystem<TState> extends GameLoopSystemHooks<TState> {
    readonly id: string;
    readonly priority?: number;
    readonly enabled?: boolean;
    dispose?(): void;
}

export interface GameLoopFailureContext<TState> {
    readonly system: GameLoopSystem<TState>;
    readonly phase: GameLoopFailurePhase;
    readonly context?: GameLoopPhaseContext<TState>;
    readonly frame: number;
    readonly now: number;
    readonly elapsed: number;
    readonly attempt: number;
    readonly state: TState;
}

export interface GameLoopSnapshot<TState = unknown> {
    readonly version: 1;
    readonly status: Exclude<GameLoopStatus, 'disposed'>;
    readonly state: TState;
    readonly frame: number;
    readonly elapsed: number;
    readonly accumulator: number;
    readonly fixedDelta: number;
    readonly maxDelta: number;
    readonly maxSubSteps: number;
    readonly timeScale: number;
    readonly capturedAtEpochMs: number;
}

export interface GameLoopRetryPolicy<TState> {
    readonly attempts?: number;
    readonly shouldRetry?: (
        error: unknown,
        context: Readonly<GameLoopFailureContext<TState>>
    ) => boolean;
}

export interface GameLoopOptions<TState> {
    readonly state: TState;
    readonly scheduler?: GameLoopScheduler;
    readonly systems?: readonly GameLoopSystem<TState>[];
    readonly fixedDelta?: number;
    readonly maxDelta?: number;
    readonly maxSubSteps?: number;
    readonly timeScale?: number;
    readonly autoStart?: boolean;
    readonly errorPolicy?: GameLoopErrorPolicy;
    readonly retry?: GameLoopRetryPolicy<TState>;
    readonly locale?: string;
    readonly messageResolver?: GameLoopMessageResolver;
    readonly onError?: (
        error: GameLoopSystemError,
        failure: Readonly<GameLoopFailureContext<TState>>
    ) => GameLoopErrorPolicy | void;
}