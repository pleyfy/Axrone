import type {
    InputActionEventPhase,
    InputActionEventTrigger,
    InputActionName,
    InputActionSchema,
    InputAxisState,
    InputBinding,
    InputButtonState,
    InputContextCapture,
    InputContextId,
    InputControlPath,
    InputDeviceKind,
    InputModifierKey,
    InputProcessor,
    InputRebindingHandlers,
    InputRebindingRequest,
    InputSystemSnapshot,
    InputOwnedDeviceDefinition,
    InputUserId,
    InputVector2,
    InputVector2State,
} from '../types';

export const INPUT_SNAPSHOT_VERSION = 1 as const;
export const EPSILON = 1e-6;
export const EMPTY_MODIFIERS = Object.freeze([]) as readonly InputModifierKey[];
export const EMPTY_PROCESSORS = Object.freeze([]) as readonly InputProcessor[];
const MODIFIER_ORDER = Object.freeze(['shift', 'ctrl', 'alt', 'meta'] as const);
export const MODIFIER_MASKS: Record<InputModifierKey, number> = Object.freeze({
    shift: 1,
    ctrl: 2,
    alt: 4,
    meta: 8,
});
export const TOUCH_ANY = -1;
export const TOUCH_PRIMARY = -2;
export const GAMEPAD_ANY = -1;
export const DEFAULT_HOLD_DURATION_MS = 400;
export const DEFAULT_TAP_DURATION_MS = 250;
export const DEFAULT_MULTI_TAP_COUNT = 2;
export const DEFAULT_MULTI_TAP_DELAY_MS = 300;
export const DEFAULT_REPEAT_DELAY_MS = 450;
export const DEFAULT_REPEAT_INTERVAL_MS = 60;

export interface MutableVector2 {
    x: number;
    y: number;
}

export interface ButtonStateStore {
    readonly kind: 'button';
    value: boolean;
    previousValue: boolean;
    rawValue: number;
    previousRawValue: number;
    pressed: boolean;
    released: boolean;
    active: boolean;
    changed: boolean;
    frame: number;
    timestamp: number;
    context?: InputContextId;
    heldDurationMs: number;
    tapSequenceCount: number;
    repeatCount: number;
    holdTriggered: boolean;
    tapTriggered: boolean;
    multiTapTriggered: boolean;
    repeatTriggered: boolean;
    pressStartedAt?: number;
    lastTapTimestamp?: number;
    nextRepeatAt?: number;
    holdConsumed: boolean;
}

export interface AxisStateStore {
    readonly kind: 'axis';
    value: number;
    previousValue: number;
    delta: number;
    active: boolean;
    changed: boolean;
    frame: number;
    timestamp: number;
    context?: InputContextId;
}

export interface Vector2StateStore {
    readonly kind: 'vector2';
    value: MutableVector2;
    previousValue: MutableVector2;
    delta: MutableVector2;
    magnitude: number;
    previousMagnitude: number;
    active: boolean;
    changed: boolean;
    frame: number;
    timestamp: number;
    context?: InputContextId;
}

export type InternalActionDefinition =
      | {
            readonly kind: 'button';
            readonly name: string;
            readonly consume: boolean;
            readonly pressPoint: number;
            readonly releasePoint: number;
            readonly processors: readonly InternalScalarProcessor[];
            readonly interactions: InternalButtonInteractions;
        }
    | {
            readonly kind: 'axis';
            readonly name: string;
            readonly consume: boolean;
            readonly deadzone: number;
            readonly min: number;
            readonly max: number;
            readonly combine: 'sum' | 'max-abs' | 'latest';
            readonly processors: readonly InternalScalarProcessor[];
        }
    | {
            readonly kind: 'vector2';
            readonly name: string;
            readonly consume: boolean;
            readonly deadzone: number;
            readonly normalize: boolean;
            readonly combine: 'sum' | 'latest';
            readonly processors: readonly InternalVectorProcessor[];
        };

interface ControlBase<TDevice extends InputDeviceKind, TKind extends string> {
    readonly device: TDevice;
    readonly kind: TKind;
    readonly path: InputControlPath;
    readonly signed: boolean;
}

interface KeyboardControl extends ControlBase<'keyboard', 'key'> {
    readonly code: string;
}

interface MouseButtonControl extends ControlBase<'mouse', 'button'> {
    readonly button: number;
}

interface MouseAxisControl extends ControlBase<'mouse', 'move' | 'wheel' | 'position'> {
    readonly axis: 'x' | 'y' | 'z';
}

interface TouchContactControl extends ControlBase<'touch', 'contact'> {
    readonly target: number;
}

interface TouchAxisControl extends ControlBase<'touch', 'position' | 'delta'> {
    readonly axis: 'x' | 'y';
    readonly target: number;
}

interface TouchAggregateControl extends ControlBase<'touch', 'pinch' | 'count'> {}

interface GamepadButtonControl extends ControlBase<'gamepad', 'button'> {
    readonly selector: number;
    readonly button: number;
}

interface GamepadAxisControl extends ControlBase<'gamepad', 'axis'> {
    readonly selector: number;
    readonly axis: number;
}

interface GamepadConnectionControl extends ControlBase<'gamepad', 'connected'> {
    readonly selector: number;
}

export type InternalControl =
    | KeyboardControl
    | MouseButtonControl
    | MouseAxisControl
    | TouchContactControl
    | TouchAxisControl
    | TouchAggregateControl
    | GamepadButtonControl
    | GamepadAxisControl
    | GamepadConnectionControl;

export interface InternalBindingBase<TType extends InputBinding['type']> {
    readonly type: TType;
    readonly consume: boolean;
    readonly modifierMask: number;
    readonly exactModifiers: boolean;
    readonly paths: readonly InputControlPath[];
    readonly processors: readonly InternalProcessor[];
}

export type InternalScalarProcessor =
    | {
            readonly kind: 'scalar';
            readonly type: 'scale';
            readonly value: number;
        }
    | {
            readonly kind: 'scalar';
            readonly type: 'invert';
        }
    | {
            readonly kind: 'scalar';
            readonly type: 'clamp';
            readonly min: number;
            readonly max: number;
        }
    | {
            readonly kind: 'scalar';
            readonly type: 'deadzone';
            readonly value: number;
        }
    | {
            readonly kind: 'scalar';
            readonly type: 'curve';
            readonly exponent: number;
            readonly signed: boolean;
        };

export type InternalVectorProcessor =
    | {
            readonly kind: 'vector2';
            readonly type: 'scale-vector2';
            readonly x: number;
            readonly y: number;
        }
    | {
            readonly kind: 'vector2';
            readonly type: 'invert-vector2';
            readonly x: boolean;
            readonly y: boolean;
        }
    | {
            readonly kind: 'vector2';
            readonly type: 'normalize-vector2';
        }
    | {
            readonly kind: 'vector2';
            readonly type: 'clamp-magnitude';
            readonly min: number;
            readonly max: number;
        };

export type InternalProcessor = InternalScalarProcessor | InternalVectorProcessor;

export interface InternalButtonInteractions {
    readonly press: boolean;
    readonly hold?: {
        readonly durationMs: number;
        readonly continuous: boolean;
    };
    readonly tap?: {
        readonly maxDurationMs: number;
    };
    readonly multiTap?: {
        readonly tapCount: number;
        readonly maxDelayMs: number;
        readonly maxDurationMs: number;
    };
    readonly repeat?: {
        readonly delayMs: number;
        readonly intervalMs: number;
    };
}

export interface InternalControlBinding extends InternalBindingBase<'control'> {
    readonly processors: readonly InternalScalarProcessor[];
    readonly control: InternalControl;
    readonly scale: number;
    readonly invert: boolean;
    readonly deadzone: number;
}

export interface InternalAxisCompositeBinding extends InternalBindingBase<'axis'> {
    readonly processors: readonly InternalScalarProcessor[];
    readonly negative: InternalControl;
    readonly positive: InternalControl;
    readonly scale: number;
}

export interface InternalDirectionalBinding extends InternalBindingBase<'vector2'> {
    readonly processors: readonly InternalVectorProcessor[];
    readonly up: InternalControl;
    readonly down: InternalControl;
    readonly left: InternalControl;
    readonly right: InternalControl;
    readonly normalize: boolean;
    readonly scale: number;
}

export interface InternalDualAxisBinding extends InternalBindingBase<'dual-axis'> {
    readonly processors: readonly InternalVectorProcessor[];
    readonly x: InternalControl;
    readonly y: InternalControl;
    readonly normalize: boolean;
    readonly scale: number;
    readonly deadzone: number;
}

export type InternalBinding =
    | InternalControlBinding
    | InternalAxisCompositeBinding
    | InternalDirectionalBinding
    | InternalDualAxisBinding;

export interface InternalContextAction<TSchema extends InputActionSchema> {
    readonly action: InputActionName<TSchema>;
    current: readonly InputBinding[];
    readonly defaults: readonly InputBinding[];
    compiled: readonly InternalBinding[];
}

export interface InternalContext<TSchema extends InputActionSchema> {
    readonly id: InputContextId;
    priority: number;
    enabled: boolean;
    capture: InputContextCapture;
    user?: InputUserId;
    sequence: number;
    readonly actions: Map<number, InternalContextAction<TSchema>>;
}

export interface InternalInputUser {
    readonly id: InputUserId;
    enabled: boolean;
    sequence: number;
    readonly devices: Map<string, InputOwnedDeviceDefinition>;
}

export interface MutableTouchPoint {
    readonly id: number;
    readonly order: number;
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
}

export interface MutableGamepadState {
    connected: boolean;
    buttons: Float64Array;
    axes: Float64Array;
}

export interface ActiveRebinding<TSchema extends InputActionSchema> {
    readonly token: number;
    readonly request: Readonly<InputRebindingRequest<TSchema>>;
    readonly handlers?: InputRebindingHandlers<TSchema>;
    readonly startedAtEpochMs: number;
    readonly deadlineEpochMs?: number;
}

export interface InternalActionEventDescriptor {
    readonly phase: InputActionEventPhase;
    readonly trigger: InputActionEventTrigger;
    readonly context?: InputContextId;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';

export const isEventTargetLike = (
    value: unknown
): value is Pick<EventTarget, 'addEventListener' | 'removeEventListener'> =>
    isRecord(value) &&
    typeof value.addEventListener === 'function' &&
    typeof value.removeEventListener === 'function';

export const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }

    if (value > max) {
        return max;
    }

    return value;
};

export const toFiniteNumber = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return value;
};

export const normalizeLocale = (value?: string): string => {
    if (!value) {
        return 'en-US';
    }

    try {
        const [normalized] = Intl.getCanonicalLocales(value);
        return normalized ?? value;
    } catch {
        return value;
    }
};

export const uniqueModifiers = (modifiers?: readonly InputModifierKey[]): readonly InputModifierKey[] => {
    if (!modifiers?.length) {
        return EMPTY_MODIFIERS;
    }

    const seen = new Set<InputModifierKey>();
    const result: InputModifierKey[] = [];

    for (const modifier of MODIFIER_ORDER) {
        if (modifiers.includes(modifier) && !seen.has(modifier)) {
            seen.add(modifier);
            result.push(modifier);
        }
    }

    return result.length === 0 ? EMPTY_MODIFIERS : Object.freeze(result);
};

export const modifiersToMask = (modifiers: readonly InputModifierKey[]): number => {
    let mask = 0;

    for (const modifier of modifiers) {
        mask |= MODIFIER_MASKS[modifier];
    }

    return mask;
};

export const applyDeadzone = (value: number, deadzone: number): number =>
    Math.abs(value) <= deadzone ? 0 : value;

export const magnitude = (x: number, y: number): number => Math.hypot(x, y);

export const applyScalarProcessors = (
    value: number,
    processors: readonly InternalScalarProcessor[]
): number => {
    let next = value;

    for (const processor of processors) {
        switch (processor.type) {
            case 'scale':
                next *= processor.value;
                break;
            case 'invert':
                next = -next;
                break;
            case 'clamp':
                next = clamp(next, processor.min, processor.max);
                break;
            case 'deadzone':
                next = applyDeadzone(next, processor.value);
                break;
            case 'curve': {
                const magnitudeValue = Math.abs(next);
                const curved = Math.pow(magnitudeValue, processor.exponent);
                next = processor.signed ? Math.sign(next) * curved : curved;
                break;
            }
        }
    }

    return next;
};

export const applyVectorProcessors = (
    value: MutableVector2,
    processors: readonly InternalVectorProcessor[]
): MutableVector2 => {
    let nextX = value.x;
    let nextY = value.y;

    for (const processor of processors) {
        switch (processor.type) {
            case 'scale-vector2':
                nextX *= processor.x;
                nextY *= processor.y;
                break;
            case 'invert-vector2':
                if (processor.x) {
                    nextX = -nextX;
                }

                if (processor.y) {
                    nextY = -nextY;
                }
                break;
            case 'normalize-vector2': {
                const length = magnitude(nextX, nextY);
                if (length > EPSILON) {
                    nextX /= length;
                    nextY /= length;
                }
                break;
            }
            case 'clamp-magnitude': {
                const length = magnitude(nextX, nextY);
                if (length <= EPSILON) {
                    break;
                }

                const clamped = clamp(length, processor.min, processor.max);
                if (Math.abs(clamped - length) > EPSILON) {
                    const ratio = clamped / length;
                    nextX *= ratio;
                    nextY *= ratio;
                }
                break;
            }
        }
    }

    return {
        x: nextX,
        y: nextY,
    };
};

const createVectorView = (source: MutableVector2): InputVector2 =>
    Object.freeze({
        get x(): number {
            return source.x;
        },
        get y(): number {
            return source.y;
        },
    });

export const createButtonStateStore = (): ButtonStateStore => ({
    kind: 'button',
    value: false,
    previousValue: false,
    rawValue: 0,
    previousRawValue: 0,
    active: false,
    changed: false,
    pressed: false,
    released: false,
    frame: 0,
    timestamp: 0,
    context: undefined,
    heldDurationMs: 0,
    tapSequenceCount: 0,
    repeatCount: 0,
    holdTriggered: false,
    tapTriggered: false,
    multiTapTriggered: false,
    repeatTriggered: false,
    pressStartedAt: undefined,
    lastTapTimestamp: undefined,
    nextRepeatAt: undefined,
    holdConsumed: false,
});

export const createAxisStateStore = (): AxisStateStore => ({
    kind: 'axis',
    value: 0,
    previousValue: 0,
    delta: 0,
    active: false,
    changed: false,
    frame: 0,
    timestamp: 0,
    context: undefined,
});

export const createVector2StateStore = (): Vector2StateStore => ({
    kind: 'vector2',
    value: { x: 0, y: 0 },
    previousValue: { x: 0, y: 0 },
    delta: { x: 0, y: 0 },
    magnitude: 0,
    previousMagnitude: 0,
    active: false,
    changed: false,
    frame: 0,
    timestamp: 0,
    context: undefined,
});

export const createButtonStateView = (state: ButtonStateStore): InputButtonState =>
    Object.freeze({
        get kind(): 'button' {
            return 'button';
        },
        get value(): boolean {
            return state.value;
        },
        get previousValue(): boolean {
            return state.previousValue;
        },
        get rawValue(): number {
            return state.rawValue;
        },
        get previousRawValue(): number {
            return state.previousRawValue;
        },
        get pressed(): boolean {
            return state.pressed;
        },
        get released(): boolean {
            return state.released;
        },
        get heldDurationMs(): number {
            return state.heldDurationMs;
        },
        get tapSequenceCount(): number {
            return state.tapSequenceCount;
        },
        get repeatCount(): number {
            return state.repeatCount;
        },
        get holdTriggered(): boolean {
            return state.holdTriggered;
        },
        get tapTriggered(): boolean {
            return state.tapTriggered;
        },
        get multiTapTriggered(): boolean {
            return state.multiTapTriggered;
        },
        get repeatTriggered(): boolean {
            return state.repeatTriggered;
        },
        get active(): boolean {
            return state.active;
        },
        get changed(): boolean {
            return state.changed;
        },
        get frame(): number {
            return state.frame;
        },
        get timestamp(): number {
            return state.timestamp;
        },
        get context(): InputContextId | undefined {
            return state.context;
        },
    });

export const createAxisStateView = (state: AxisStateStore): InputAxisState =>
    Object.freeze({
        get kind(): 'axis' {
            return 'axis';
        },
        get value(): number {
            return state.value;
        },
        get previousValue(): number {
            return state.previousValue;
        },
        get delta(): number {
            return state.delta;
        },
        get active(): boolean {
            return state.active;
        },
        get changed(): boolean {
            return state.changed;
        },
        get frame(): number {
            return state.frame;
        },
        get timestamp(): number {
            return state.timestamp;
        },
        get context(): InputContextId | undefined {
            return state.context;
        },
    });

export const createVector2StateView = (state: Vector2StateStore): InputVector2State => {
    const valueView = createVectorView(state.value);
    const previousValueView = createVectorView(state.previousValue);
    const deltaView = createVectorView(state.delta);

    return Object.freeze({
        get kind(): 'vector2' {
            return 'vector2';
        },
        get value(): InputVector2 {
            return valueView;
        },
        get previousValue(): InputVector2 {
            return previousValueView;
        },
        get delta(): InputVector2 {
            return deltaView;
        },
        get magnitude(): number {
            return state.magnitude;
        },
        get previousMagnitude(): number {
            return state.previousMagnitude;
        },
        get active(): boolean {
            return state.active;
        },
        get changed(): boolean {
            return state.changed;
        },
        get frame(): number {
            return state.frame;
        },
        get timestamp(): number {
            return state.timestamp;
        },
        get context(): InputContextId | undefined {
            return state.context;
        },
    });
};

export const isInputSystemSnapshot = <TSchema extends InputActionSchema = InputActionSchema>(
    value: unknown
): value is InputSystemSnapshot<TSchema> =>
    isRecord(value) &&
    value.version === INPUT_SNAPSHOT_VERSION &&
    typeof value.locale === 'string' &&
    Array.isArray(value.contexts);
