import {
    InputConfigurationError,
    InputContextError,
    InputDisposedError,
    InputRebindingError,
    InputSnapshotError,
    resolveInputMessage,
} from './errors';
import { normalizeInputContextId, normalizeInputControlPath, parseInputControlPath } from './reference';
import type {
    InputActionBindings,
    InputActionDefinition,
    InputActionKind,
    InputActionName,
    InputActionSchema,
    InputActionState,
    InputActionStateForDefinition,
    InputAttachment,
    InputAxisActionDefinition,
    InputAxisCompositeBinding,
    InputAxisState,
    InputBinding,
    InputBindingControlPatchRequest,
    InputBindingForAction,
    InputBindingMutationRequest,
    InputBindingReplaceRequest,
    InputBindingSlot,
    InputBrowserTarget,
    InputButtonActionDefinition,
    InputButtonState,
    InputContextCapture,
    InputContextDefinition,
    InputContextId,
    InputContextSnapshot,
    InputContextState,
    InputControlBinding,
    InputControlPath,
    InputDeviceKind,
    InputDirectionalBinding,
    InputDualAxisBinding,
    InputFocusSourceEvent,
    InputGamepadOptions,
    InputGamepadSnapshot,
    InputMessageDescriptor,
    InputMessageResolver,
    InputModifierKey,
    InputMouseButtonSourceEvent,
    InputMouseMoveSourceEvent,
    InputMouseWheelSourceEvent,
    InputRebindingCandidate,
    InputRebindingHandlers,
    InputRebindingRequest,
    InputRebindingResult,
    InputRebindingSession,
    InputRestoreOptions,
    InputSourceEvent,
    InputSystemOptions,
    InputSystemSnapshot,
    InputTouchPoint,
    InputTouchSourceEvent,
    InputVector2,
    InputVector2ActionDefinition,
    InputVector2State,
} from './types';

const INPUT_SNAPSHOT_VERSION = 1 as const;
const EPSILON = 1e-6;
const EMPTY_MODIFIERS = Object.freeze([]) as readonly InputModifierKey[];
const MODIFIER_ORDER = Object.freeze(['shift', 'ctrl', 'alt', 'meta'] as const);
const MODIFIER_MASKS: Record<InputModifierKey, number> = Object.freeze({
    shift: 1,
    ctrl: 2,
    alt: 4,
    meta: 8,
});
const TOUCH_ANY = -1;
const TOUCH_PRIMARY = -2;
const GAMEPAD_ANY = -1;

interface MutableVector2 {
    x: number;
    y: number;
}

interface ButtonStateStore {
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
}

interface AxisStateStore {
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

interface Vector2StateStore {
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

type InternalActionDefinition =
    | {
          readonly kind: 'button';
          readonly name: string;
          readonly consume: boolean;
          readonly pressPoint: number;
          readonly releasePoint: number;
      }
    | {
          readonly kind: 'axis';
          readonly name: string;
          readonly consume: boolean;
          readonly deadzone: number;
          readonly min: number;
          readonly max: number;
          readonly combine: 'sum' | 'max-abs' | 'latest';
      }
    | {
          readonly kind: 'vector2';
          readonly name: string;
          readonly consume: boolean;
          readonly deadzone: number;
          readonly normalize: boolean;
          readonly combine: 'sum' | 'latest';
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

type InternalControl =
    | KeyboardControl
    | MouseButtonControl
    | MouseAxisControl
    | TouchContactControl
    | TouchAxisControl
    | TouchAggregateControl
    | GamepadButtonControl
    | GamepadAxisControl
    | GamepadConnectionControl;

interface InternalBindingBase<TType extends InputBinding['type']> {
    readonly type: TType;
    readonly consume: boolean;
    readonly modifierMask: number;
    readonly exactModifiers: boolean;
    readonly paths: readonly InputControlPath[];
}

interface InternalControlBinding extends InternalBindingBase<'control'> {
    readonly control: InternalControl;
    readonly scale: number;
    readonly invert: boolean;
    readonly deadzone: number;
}

interface InternalAxisCompositeBinding extends InternalBindingBase<'axis'> {
    readonly negative: InternalControl;
    readonly positive: InternalControl;
    readonly scale: number;
}

interface InternalDirectionalBinding extends InternalBindingBase<'vector2'> {
    readonly up: InternalControl;
    readonly down: InternalControl;
    readonly left: InternalControl;
    readonly right: InternalControl;
    readonly normalize: boolean;
    readonly scale: number;
}

interface InternalDualAxisBinding extends InternalBindingBase<'dual-axis'> {
    readonly x: InternalControl;
    readonly y: InternalControl;
    readonly normalize: boolean;
    readonly scale: number;
    readonly deadzone: number;
}

type InternalBinding =
    | InternalControlBinding
    | InternalAxisCompositeBinding
    | InternalDirectionalBinding
    | InternalDualAxisBinding;

interface InternalContextAction<TSchema extends InputActionSchema> {
    readonly action: InputActionName<TSchema>;
    current: readonly InputBinding[];
    readonly defaults: readonly InputBinding[];
    compiled: readonly InternalBinding[];
}

interface InternalContext<TSchema extends InputActionSchema> {
    readonly id: InputContextId;
    priority: number;
    enabled: boolean;
    capture: InputContextCapture;
    sequence: number;
    readonly actions: Map<number, InternalContextAction<TSchema>>;
}

interface MutableTouchPoint {
    readonly id: number;
    readonly order: number;
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
}

interface MutableGamepadState {
    connected: boolean;
    buttons: Float64Array;
    axes: Float64Array;
}

interface ActiveRebinding<TSchema extends InputActionSchema> {
    readonly token: number;
    readonly request: Readonly<InputRebindingRequest<TSchema>>;
    readonly handlers?: InputRebindingHandlers<TSchema>;
    readonly startedAtEpochMs: number;
    readonly deadlineEpochMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';

const isEventTargetLike = (
    value: unknown
): value is Pick<EventTarget, 'addEventListener' | 'removeEventListener'> =>
    isRecord(value) &&
    typeof value.addEventListener === 'function' &&
    typeof value.removeEventListener === 'function';

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }

    if (value > max) {
        return max;
    }

    return value;
};

const toFiniteNumber = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return value;
};

const normalizeLocale = (value?: string): string => {
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

const uniqueModifiers = (modifiers?: readonly InputModifierKey[]): readonly InputModifierKey[] => {
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

const modifiersToMask = (modifiers: readonly InputModifierKey[]): number => {
    let mask = 0;

    for (const modifier of modifiers) {
        mask |= MODIFIER_MASKS[modifier];
    }

    return mask;
};

const applyDeadzone = (value: number, deadzone: number): number =>
    Math.abs(value) <= deadzone ? 0 : value;

const magnitude = (x: number, y: number): number => Math.hypot(x, y);

const createVectorView = (source: MutableVector2): InputVector2 =>
    Object.freeze({
        get x(): number {
            return source.x;
        },
        get y(): number {
            return source.y;
        },
    });

const createButtonStateStore = (): ButtonStateStore => ({
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
});

const createAxisStateStore = (): AxisStateStore => ({
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

const createVector2StateStore = (): Vector2StateStore => ({
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

const createButtonStateView = (state: ButtonStateStore): InputButtonState =>
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

const createAxisStateView = (state: AxisStateStore): InputAxisState =>
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

const createVector2StateView = (state: Vector2StateStore): InputVector2State => {
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

export class InputSystem<TSchema extends InputActionSchema = InputActionSchema> {
    private readonly _actionNames: readonly InputActionName<TSchema>[];
    private readonly _actionIndices: ReadonlyMap<string, number>;
    private readonly _actionDefinitions: readonly InternalActionDefinition[];
    private readonly _buttonStateStores: Array<ButtonStateStore | undefined>;
    private readonly _axisStateStores: Array<AxisStateStore | undefined>;
    private readonly _vectorStateStores: Array<Vector2StateStore | undefined>;
    private readonly _buttonStates: Array<InputButtonState | undefined>;
    private readonly _axisStates: Array<InputAxisState | undefined>;
    private readonly _vectorStates: Array<InputVector2State | undefined>;
    private readonly _contexts = new Map<string, InternalContext<TSchema>>();
    private readonly _keysDown = new Set<string>();
    private readonly _touches = new Map<number, MutableTouchPoint>();
    private readonly _gamepads = new Map<number, MutableGamepadState>();
    private readonly _consumedPaths = new Set<InputControlPath>();
    private readonly _accumulatorX: Float64Array;
    private readonly _accumulatorY: Float64Array;
    private readonly _assigned: Uint8Array;
    private readonly _sourceContexts: Array<InputContextId | undefined>;
    private readonly _attachments = new Set<InputAttachment>();
    private readonly _gamepadSeen = new Set<number>();
    private readonly _locale: string;
    private readonly _messageResolver?: InputMessageResolver;
    private readonly _now: () => number;
    private readonly _gamepad: Required<Pick<InputGamepadOptions, 'enabled' | 'autoPoll'>> &
        Pick<InputGamepadOptions, 'provider'>;
    private _mouseButtons = 0;
    private _mouseX = 0;
    private _mouseY = 0;
    private _mouseDeltaX = 0;
    private _mouseDeltaY = 0;
    private _mouseWheelX = 0;
    private _mouseWheelY = 0;
    private _mouseWheelZ = 0;
    private _touchOrder = 0;
    private _touchPinchDistance = 0;
    private _touchPinchDelta = 0;
    private _primaryTouchId: number | undefined;
    private _frame = 0;
    private _timestamp = 0;
    private _contextOrderDirty = true;
    private _orderedContexts: InternalContext<TSchema>[] = [];
    private _sequence = 0;
    private _disposed = false;
    private _rebindToken = 0;
    private _activeRebinding?: ActiveRebinding<TSchema>;

    constructor(options: InputSystemOptions<TSchema>) {
        if (!isRecord(options) || !isRecord(options.schema)) {
            throw new InputConfigurationError(
                'input.invalid-action',
                resolveInputMessage(
                    {
                        code: 'input.invalid-action',
                        value: options,
                    },
                    'en-US'
                )
            );
        }

        this._locale = normalizeLocale(options.locale);
        this._messageResolver = options.messageResolver;
        this._now = options.now ?? Date.now;
        this._timestamp = this._now();
        this._gamepad = Object.freeze({
            enabled: options.gamepad?.enabled ?? true,
            autoPoll: options.gamepad?.autoPoll ?? true,
            provider: options.gamepad?.provider,
        });

        const actionNames: InputActionName<TSchema>[] = [];
        const actionIndices = new Map<string, number>();
        const actionDefinitions: InternalActionDefinition[] = [];
        const buttonStateStores: Array<ButtonStateStore | undefined> = [];
        const axisStateStores: Array<AxisStateStore | undefined> = [];
        const vectorStateStores: Array<Vector2StateStore | undefined> = [];
        const buttonStates: Array<InputButtonState | undefined> = [];
        const axisStates: Array<InputAxisState | undefined> = [];
        const vectorStates: Array<InputVector2State | undefined> = [];

        for (const [rawName, rawDefinition] of Object.entries(options.schema) as Array<
            [InputActionName<TSchema>, InputActionDefinition]
        >) {
            const name = rawName.trim() as InputActionName<TSchema>;
            if (!name || actionIndices.has(name)) {
                throw new InputConfigurationError(
                    'input.invalid-action',
                    this._resolveMessage({
                        code: 'input.invalid-action',
                        value: rawName,
                    })
                );
            }

            const definition = this._normalizeActionDefinition(name, rawDefinition);
            const index = actionDefinitions.length;
            actionNames.push(name);
            actionIndices.set(name, index);
            actionDefinitions.push(definition);

            switch (definition.kind) {
                case 'button':
                    buttonStateStores[index] = createButtonStateStore();
                    buttonStates[index] = createButtonStateView(buttonStateStores[index]!);
                    break;
                case 'axis':
                    axisStateStores[index] = createAxisStateStore();
                    axisStates[index] = createAxisStateView(axisStateStores[index]!);
                    break;
                case 'vector2':
                    vectorStateStores[index] = createVector2StateStore();
                    vectorStates[index] = createVector2StateView(vectorStateStores[index]!);
                    break;
            }
        }

        this._actionNames = Object.freeze(actionNames);
        this._actionIndices = actionIndices;
        this._actionDefinitions = Object.freeze(actionDefinitions);
        this._buttonStateStores = buttonStateStores;
        this._axisStateStores = axisStateStores;
        this._vectorStateStores = vectorStateStores;
        this._buttonStates = buttonStates;
        this._axisStates = axisStates;
        this._vectorStates = vectorStates;
        this._accumulatorX = new Float64Array(actionDefinitions.length);
        this._accumulatorY = new Float64Array(actionDefinitions.length);
        this._assigned = new Uint8Array(actionDefinitions.length);
        this._sourceContexts = new Array<InputContextId | undefined>(actionDefinitions.length);

        for (const context of options.contexts ?? []) {
            this.registerContext(context);
        }
    }

    get frame(): number {
        return this._frame;
    }

    get timestamp(): number {
        return this._timestamp;
    }

    get locale(): string {
        return this._locale;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    update(now = this._now()): number {
        this._assertNotDisposed();
        this._timestamp = Number.isFinite(now) ? now : this._now();
        this._expireRebindingIfNeeded(this._timestamp);
        this._pollGamepads();
        this._frame += 1;
        this._evaluate();
        this._clearTransients();
        return this._frame;
    }

    dispatch(event: Readonly<InputSourceEvent>): void {
        this._assertNotDisposed();

        switch (event.type) {
            case 'keyboard':
                this._handleKeyboardEvent(event);
                break;
            case 'mouse-button':
                this._handleMouseButtonEvent(event);
                break;
            case 'mouse-move':
                this._handleMouseMoveEvent(event);
                break;
            case 'mouse-wheel':
                this._handleMouseWheelEvent(event);
                break;
            case 'touch':
                this._handleTouchEvent(event);
                break;
            case 'gamepad':
                this._ingestGamepadSnapshots(event.gamepads);
                this._captureGamepadCandidate(this._timestamp);
                break;
            case 'focus':
                this._handleFocusEvent(event);
                break;
        }
    }

    attach(target: InputBrowserTarget = {}): InputAttachment {
        this._assertNotDisposed();

        const resolvedWindow =
            target.window ??
            (typeof window !== 'undefined' ? (window as Window & typeof globalThis) : undefined);
        const resolvedDocument = target.document ?? resolvedWindow?.document;
        const keyboardTarget = resolvedDocument ?? resolvedWindow ?? target.element;
        const pointerTarget = target.element ?? resolvedWindow ?? resolvedDocument;

        if (!isEventTargetLike(keyboardTarget) || !isEventTargetLike(pointerTarget)) {
            throw new InputConfigurationError(
                'input.invalid-target',
                this._resolveMessage({
                    code: 'input.invalid-target',
                    value: target,
                })
            );
        }

        const removers: Array<() => void> = [];
        let disposed = false;
        const capture = target.capture ?? false;
        const passive = target.passive ?? false;
        const listenerOptions = { capture, passive };

        const add = <TEvent extends Event>(
            source: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
            type: string,
            handler: (event: TEvent) => void,
            options?: AddEventListenerOptions | boolean
        ): void => {
            const listener = handler as EventListener;
            source.addEventListener(type, listener, options);
            removers.push(() => {
                source.removeEventListener(type, listener, options);
            });
        };

        const preventIfNeeded = (event: Event): void => {
            if (target.preventDefault) {
                event.preventDefault();
            }
        };

        add<KeyboardEvent>(keyboardTarget, 'keydown', (event) => {
            preventIfNeeded(event);
            this.dispatch({
                type: 'keyboard',
                code: event.code,
                pressed: true,
                repeat: event.repeat,
            });
        });

        add<KeyboardEvent>(keyboardTarget, 'keyup', (event) => {
            preventIfNeeded(event);
            this.dispatch({
                type: 'keyboard',
                code: event.code,
                pressed: false,
                repeat: event.repeat,
            });
        });

        add<MouseEvent>(
            pointerTarget,
            'mousedown',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'mouse-button',
                    button: event.button,
                    pressed: true,
                    x: event.clientX,
                    y: event.clientY,
                });
            },
            listenerOptions
        );

        add<MouseEvent>(
            pointerTarget,
            'mouseup',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'mouse-button',
                    button: event.button,
                    pressed: false,
                    x: event.clientX,
                    y: event.clientY,
                });
            },
            listenerOptions
        );

        add<MouseEvent>(
            pointerTarget,
            'mousemove',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'mouse-move',
                    x: event.clientX,
                    y: event.clientY,
                    deltaX:
                        typeof event.movementX === 'number'
                            ? event.movementX
                            : event.clientX - this._mouseX,
                    deltaY:
                        typeof event.movementY === 'number'
                            ? event.movementY
                            : event.clientY - this._mouseY,
                });
            },
            listenerOptions
        );

        add<WheelEvent>(
            pointerTarget,
            'wheel',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'mouse-wheel',
                    deltaX: event.deltaX,
                    deltaY: event.deltaY,
                    deltaZ: event.deltaZ,
                });
            },
            { capture, passive: false }
        );

        const toTouchPoints = (touches: TouchList): InputTouchPoint[] => {
            const result: InputTouchPoint[] = [];

            for (let index = 0; index < touches.length; index += 1) {
                const touch = touches.item(index);
                if (!touch) {
                    continue;
                }

                result.push({
                    id: touch.identifier,
                    x: touch.clientX,
                    y: touch.clientY,
                    force: typeof touch.force === 'number' ? touch.force : undefined,
                });
            }

            return result;
        };

        add<TouchEvent>(
            pointerTarget,
            'touchstart',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'touch',
                    phase: 'start',
                    touches: toTouchPoints(event.touches),
                    changed: toTouchPoints(event.changedTouches),
                });
            },
            listenerOptions
        );

        add<TouchEvent>(
            pointerTarget,
            'touchmove',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'touch',
                    phase: 'move',
                    touches: toTouchPoints(event.touches),
                    changed: toTouchPoints(event.changedTouches),
                });
            },
            listenerOptions
        );

        add<TouchEvent>(
            pointerTarget,
            'touchend',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'touch',
                    phase: 'end',
                    touches: toTouchPoints(event.touches),
                    changed: toTouchPoints(event.changedTouches),
                });
            },
            listenerOptions
        );

        add<TouchEvent>(
            pointerTarget,
            'touchcancel',
            (event) => {
                preventIfNeeded(event);
                this.dispatch({
                    type: 'touch',
                    phase: 'cancel',
                    touches: toTouchPoints(event.touches),
                    changed: toTouchPoints(event.changedTouches),
                });
            },
            listenerOptions
        );

        if (isEventTargetLike(resolvedWindow)) {
            add<Event>(resolvedWindow, 'blur', () => {
                this.dispatch({
                    type: 'focus',
                    focused: false,
                });
            });
        }

        const attachment: InputAttachment = {
            get isDisposed(): boolean {
                return disposed;
            },
            dispose: () => {
                if (disposed) {
                    return;
                }

                disposed = true;

                for (const remove of removers.splice(0, removers.length)) {
                    remove();
                }

                this._attachments.delete(attachment);
            },
        };

        this._attachments.add(attachment);
        return attachment;
    }

    registerContext(definition: InputContextDefinition<TSchema>): InputContextState {
        this._assertNotDisposed();
        return this._upsertContext(definition, false);
    }

    upsertContext(definition: InputContextDefinition<TSchema>): InputContextState {
        this._assertNotDisposed();
        return this._upsertContext(definition, true);
    }

    removeContext(id: string | InputContextId): boolean {
        this._assertNotDisposed();
        const normalized = this._requireContextId(id);
        const removed = this._contexts.delete(normalized);

        if (removed) {
            this._contextOrderDirty = true;

            if (this._activeRebinding?.request.context === normalized) {
                this._cancelRebinding('replaced');
            }
        }

        return removed;
    }

    hasContext(id: string | InputContextId): boolean {
        const normalized = normalizeInputContextId(String(id));
        return !!normalized && this._contexts.has(normalized);
    }

    context(id: string | InputContextId): InputContextState | undefined {
        const normalized = normalizeInputContextId(String(id));
        if (!normalized) {
            return undefined;
        }

        const context = this._contexts.get(normalized);
        return context ? this._snapshotContextState(context) : undefined;
    }

    contexts(): readonly InputContextState[] {
        return Object.freeze(
            this._getOrderedContexts().map((context) => this._snapshotContextState(context))
        );
    }

    activateContext(id: string | InputContextId): InputContextState {
        this._assertNotDisposed();
        const context = this._requireContext(id);
        context.enabled = true;
        context.sequence = ++this._sequence;
        this._contextOrderDirty = true;
        return this._snapshotContextState(context);
    }

    deactivateContext(id: string | InputContextId): InputContextState {
        this._assertNotDisposed();
        const context = this._requireContext(id);
        context.enabled = false;
        this._contextOrderDirty = true;
        return this._snapshotContextState(context);
    }

    setContextPriority(id: string | InputContextId, priority: number): InputContextState {
        this._assertNotDisposed();
        const context = this._requireContext(id);
        context.priority = this._normalizePriority(priority);
        this._contextOrderDirty = true;
        return this._snapshotContextState(context);
    }

    bindings<TAction extends InputActionName<TSchema>>(
        context: string | InputContextId,
        action: TAction
    ): readonly InputBindingForAction<TSchema[TAction]>[] {
        this._assertNotDisposed();
        const entry = this._requireContextAction(context, action);
        return entry.current as readonly InputBindingForAction<TSchema[TAction]>[];
    }

    resetBindings<TAction extends InputActionName<TSchema>>(
        context: string | InputContextId,
        action?: TAction
    ): void {
        this._assertNotDisposed();
        const storedContext = this._requireContext(context);

        if (typeof action === 'undefined') {
            for (const [, actionEntry] of storedContext.actions) {
                actionEntry.current = actionEntry.defaults;
                actionEntry.compiled = this._compileBindings(actionEntry.current);
            }
            return;
        }

        const actionEntry = this._requireContextAction(context, action);
        actionEntry.current = actionEntry.defaults;
        actionEntry.compiled = this._compileBindings(actionEntry.current);
    }

    rebind<TAction extends InputActionName<TSchema>>(
        request: Readonly<InputBindingMutationRequest<TSchema, TAction>>
    ): readonly InputBindingForAction<TSchema[TAction]>[] {
        this._assertNotDisposed();

        if ('bindings' in request) {
            const replaceRequest = request as InputBindingReplaceRequest<TSchema, TAction>;
            const entry = this._requireContextAction(replaceRequest.context, replaceRequest.action);
            const normalized = this._normalizeBindingList(
                replaceRequest.action,
                replaceRequest.bindings
            );
            entry.current = normalized as readonly InputBinding[];
            entry.compiled = this._compileBindings(entry.current);
            return entry.current as readonly InputBindingForAction<TSchema[TAction]>[];
        }

        const patchRequest = request as InputBindingControlPatchRequest<TSchema, TAction>;
        const { entry, index, slot, control } = this._resolveControlPatch(patchRequest);
        const nextBindings = [...entry.current];

        if (index >= nextBindings.length) {
            nextBindings.push(
                Object.freeze({
                    type: 'control',
                    control,
                    scale: 1,
                    invert: false,
                    deadzone: 0,
                    consume: false,
                    modifiers: EMPTY_MODIFIERS,
                    exactModifiers: false,
                }) as InputControlBinding
            );
        } else {
            nextBindings[index] = this._patchBindingControl(nextBindings[index]!, slot, control);
        }

        const normalized = this._normalizeBindingList(patchRequest.action, nextBindings);
        entry.current = normalized as readonly InputBinding[];
        entry.compiled = this._compileBindings(entry.current);
        return entry.current as readonly InputBindingForAction<TSchema[TAction]>[];
    }

    beginRebinding<TAction extends InputActionName<TSchema>>(
        request: Readonly<InputRebindingRequest<TSchema, TAction>>,
        handlers?: InputRebindingHandlers<TSchema, TAction>
    ): InputRebindingSession<TSchema, TAction> {
        this._assertNotDisposed();
        this._resolveBindingTarget(request.context, request.action, request.index, request.slot);

        if (this._activeRebinding) {
            this._cancelRebinding('replaced');
        }

        const token = ++this._rebindToken;
        const startedAtEpochMs = this._now();
        const timeoutMs =
            typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs)
                ? Math.max(0, request.timeoutMs)
                : undefined;

        this._activeRebinding = {
            token,
            request,
            handlers,
            startedAtEpochMs,
            deadlineEpochMs:
                typeof timeoutMs === 'number' ? startedAtEpochMs + timeoutMs : undefined,
        };

        let disposed = false;

        return {
            request,
            startedAtEpochMs,
            get isDisposed(): boolean {
                return disposed;
            },
            dispose: () => {
                if (disposed) {
                    return;
                }

                disposed = true;
                if (this._activeRebinding?.token === token) {
                    this._cancelRebinding('manual');
                }
            },
        };
    }

    snapshot(): InputSystemSnapshot<TSchema> {
        this._assertNotDisposed();

        const contexts = this._getOrderedContexts().map<InputContextSnapshot<TSchema>>((context) => {
            const bindings: Partial<InputActionBindings<TSchema>> = {};

            for (const [actionIndex, actionEntry] of context.actions) {
                const actionName = this._actionNames[actionIndex]!;
                bindings[actionName] =
                    actionEntry.current as readonly InputBindingForAction<TSchema[typeof actionName]>[];
            }

            return Object.freeze({
                id: context.id,
                priority: context.priority,
                enabled: context.enabled,
                capture: context.capture,
                bindings: Object.freeze(bindings) as InputContextSnapshot<TSchema>['bindings'],
            });
        });

        return Object.freeze({
            version: INPUT_SNAPSHOT_VERSION,
            locale: this._locale,
            capturedAtEpochMs: this._now(),
            contexts: Object.freeze(contexts),
        });
    }

    restore(snapshot: Readonly<InputSystemSnapshot<TSchema>>, options: InputRestoreOptions = {}): void {
        this._assertNotDisposed();

        if (!isInputSystemSnapshot(snapshot)) {
            throw new InputSnapshotError(
                this._resolveMessage({
                    code: 'input.invalid-snapshot',
                    reason: 'snapshot shape is invalid',
                })
            );
        }

        if (!options.merge) {
            this._contexts.clear();
            this._contextOrderDirty = true;
        }

        for (const contextSnapshot of snapshot.contexts) {
            if (!isRecord(contextSnapshot) || typeof contextSnapshot.id !== 'string') {
                throw new InputSnapshotError(
                    this._resolveMessage({
                        code: 'input.invalid-snapshot',
                        reason: 'context entry is invalid',
                    })
                );
            }

            this._upsertContext({
                id: contextSnapshot.id,
                priority: contextSnapshot.priority,
                enabled: contextSnapshot.enabled,
                capture: contextSnapshot.capture,
                bindings: contextSnapshot.bindings,
            }, true);
        }
    }

    state<TAction extends InputActionName<TSchema>>(
        action: TAction
    ): InputActionStateForDefinition<TSchema[TAction]> {
        const index = this._requireActionIndex(action);
        const definition = this._actionDefinitions[index]!;

        switch (definition.kind) {
            case 'button':
                return this._buttonStates[index]! as InputActionStateForDefinition<TSchema[TAction]>;
            case 'axis':
                return this._axisStates[index]! as InputActionStateForDefinition<TSchema[TAction]>;
            case 'vector2':
                return this._vectorStates[index]! as InputActionStateForDefinition<TSchema[TAction]>;
        }
    }

    read<TAction extends InputActionName<TSchema>>(action: TAction): TSchema[TAction] extends InputButtonActionDefinition
        ? boolean
        : TSchema[TAction] extends InputAxisActionDefinition
          ? number
          : InputVector2 {
        const state = this.state(action) as InputActionState;

        switch (state.kind) {
            case 'button':
                return state.value as never;
            case 'axis':
                return state.value as never;
            case 'vector2':
                return state.value as never;
        }
    }

    isActive<TAction extends InputActionName<TSchema>>(action: TAction): boolean {
        return this.state(action).active;
    }

    isPressed<TAction extends InputActionName<TSchema>>(action: TAction): boolean {
        const state = this.state(action) as InputActionState;
        return state.kind === 'button' ? state.pressed : false;
    }

    isReleased<TAction extends InputActionName<TSchema>>(action: TAction): boolean {
        const state = this.state(action) as InputActionState;
        return state.kind === 'button' ? state.released : false;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._cancelRebinding('disposed');

        for (const attachment of [...this._attachments]) {
            attachment.dispose();
        }

        this._attachments.clear();
        this._contexts.clear();
        this._consumedPaths.clear();
        this._clearDeviceState(true);
        this._gamepads.clear();
    }

    private _normalizeActionDefinition(
        name: string,
        definition: InputActionDefinition
    ): InternalActionDefinition {
        if (!isRecord(definition) || typeof definition.kind !== 'string') {
            throw new InputConfigurationError(
                'input.invalid-action',
                this._resolveMessage({
                    code: 'input.invalid-action',
                    value: { name, definition },
                })
            );
        }

        const consume = !!definition.consume;

        switch (definition.kind) {
            case 'button': {
                const buttonDefinition = definition as InputButtonActionDefinition;
                const pressPoint = clamp(toFiniteNumber(buttonDefinition.pressPoint, 0.5), 0, 1);
                const releasePoint = clamp(
                    toFiniteNumber(buttonDefinition.releasePoint, pressPoint * 0.5),
                    0,
                    pressPoint
                );
                return Object.freeze({
                    kind: 'button',
                    name,
                    consume,
                    pressPoint,
                    releasePoint,
                });
            }
            case 'axis': {
                const axisDefinition = definition as InputAxisActionDefinition;
                const rawClamp = axisDefinition.clamp;
                const min = Array.isArray(rawClamp)
                    ? toFiniteNumber(rawClamp[0], -Infinity)
                    : -Infinity;
                const max = Array.isArray(rawClamp)
                    ? toFiniteNumber(rawClamp[1], Infinity)
                    : Infinity;
                return Object.freeze({
                    kind: 'axis',
                    name,
                    consume,
                    deadzone: Math.max(0, toFiniteNumber(axisDefinition.deadzone, 0)),
                    min: Math.min(min, max),
                    max: Math.max(min, max),
                    combine:
                        axisDefinition.combine === 'max-abs' || axisDefinition.combine === 'latest'
                            ? axisDefinition.combine
                            : 'sum',
                });
            }
            case 'vector2': {
                const vectorDefinition = definition as InputVector2ActionDefinition;
                return Object.freeze({
                    kind: 'vector2',
                    name,
                    consume,
                    deadzone: Math.max(0, toFiniteNumber(vectorDefinition.deadzone, 0)),
                    normalize: !!vectorDefinition.normalize,
                    combine: vectorDefinition.combine === 'latest' ? 'latest' : 'sum',
                });
            }
            default:
                throw new InputConfigurationError(
                    'input.invalid-action',
                    this._resolveMessage({
                        code: 'input.invalid-action',
                        value: { name, definition },
                    })
                );
        }
    }

    private _upsertContext(
        definition: InputContextDefinition<TSchema>,
        allowReplace: boolean
    ): InputContextState {
        const id = this._requireContextId(definition.id);
        const priority = this._normalizePriority(definition.priority ?? 0);
        const capture = definition.capture === 'used' ? 'used' : 'none';
        const enabled = definition.enabled ?? true;
        const bindings = definition.bindings ?? {};
        const actions = new Map<number, InternalContextAction<TSchema>>();

        for (const [rawAction, rawBindings] of Object.entries(bindings) as Array<
            [InputActionName<TSchema>, readonly InputBinding[] | undefined]
        >) {
            if (typeof rawBindings === 'undefined') {
                continue;
            }

            const actionIndex = this._requireActionIndex(rawAction);
            const normalizedBindings = this._normalizeBindingList(rawAction, rawBindings);
            actions.set(actionIndex, {
                action: rawAction,
                current: normalizedBindings,
                defaults: normalizedBindings,
                compiled: this._compileBindings(normalizedBindings),
            });
        }

        const existing = this._contexts.get(id);

        if (existing) {
            if (!allowReplace) {
                throw new InputContextError(
                    'input.context.conflict',
                    String(id),
                    this._resolveMessage({
                        code: 'input.context.conflict',
                        id: String(id),
                    })
                );
            }

            existing.priority = priority;
            existing.enabled = enabled;
            existing.capture = capture;
            existing.sequence = ++this._sequence;
            existing.actions.clear();

            for (const [actionIndex, actionEntry] of actions) {
                existing.actions.set(actionIndex, actionEntry);
            }

            this._contextOrderDirty = true;
            return this._snapshotContextState(existing);
        }

        const context: InternalContext<TSchema> = {
            id,
            priority,
            enabled,
            capture,
            sequence: ++this._sequence,
            actions,
        };

        this._contexts.set(id, context);
        this._contextOrderDirty = true;
        return this._snapshotContextState(context);
    }

    private _normalizeBindingList<TAction extends InputActionName<TSchema>>(
        action: TAction,
        bindings: readonly InputBindingForAction<TSchema[TAction]>[] | readonly InputBinding[]
    ): readonly InputBinding[] {
        const index = this._requireActionIndex(action);
        const actionDefinition = this._actionDefinitions[index]!;
        const normalized: InputBinding[] = [];

        for (const binding of bindings) {
            normalized.push(this._normalizeBinding(actionDefinition.kind, binding));
        }

        return Object.freeze(normalized);
    }

    private _normalizeBinding(actionKind: InputActionKind, binding: InputBinding): InputBinding {
        if (!isRecord(binding) || typeof binding.type !== 'string') {
            throw new InputConfigurationError(
                'input.invalid-binding',
                this._resolveMessage({
                    code: 'input.invalid-binding',
                    value: binding,
                })
            );
        }

        const modifiers = uniqueModifiers(binding.modifiers);
        const exactModifiers = !!binding.exactModifiers;
        const consume = !!binding.consume;

        switch (binding.type) {
            case 'control': {
                if (actionKind === 'vector2') {
                    break;
                }

                const control = this._requireControlPath((binding as InputControlBinding).control);
                return Object.freeze({
                    type: 'control',
                    control,
                    scale: toFiniteNumber((binding as InputControlBinding).scale, 1),
                    invert: !!(binding as InputControlBinding).invert,
                    deadzone: Math.max(
                        0,
                        toFiniteNumber((binding as InputControlBinding).deadzone, 0)
                    ),
                    consume,
                    modifiers,
                    exactModifiers,
                });
            }
            case 'axis': {
                if (actionKind === 'vector2') {
                    break;
                }

                const axisBinding = binding as InputAxisCompositeBinding;
                return Object.freeze({
                    type: 'axis',
                    negative: this._requireControlPath(axisBinding.negative),
                    positive: this._requireControlPath(axisBinding.positive),
                    scale: toFiniteNumber(axisBinding.scale, 1),
                    consume,
                    modifiers,
                    exactModifiers,
                });
            }
            case 'vector2': {
                if (actionKind !== 'vector2') {
                    break;
                }

                const vectorBinding = binding as InputDirectionalBinding;
                return Object.freeze({
                    type: 'vector2',
                    up: this._requireControlPath(vectorBinding.up),
                    down: this._requireControlPath(vectorBinding.down),
                    left: this._requireControlPath(vectorBinding.left),
                    right: this._requireControlPath(vectorBinding.right),
                    normalize: !!vectorBinding.normalize,
                    scale: toFiniteNumber(vectorBinding.scale, 1),
                    consume,
                    modifiers,
                    exactModifiers,
                });
            }
            case 'dual-axis': {
                if (actionKind !== 'vector2') {
                    break;
                }

                const dualAxisBinding = binding as InputDualAxisBinding;
                return Object.freeze({
                    type: 'dual-axis',
                    x: this._requireControlPath(dualAxisBinding.x),
                    y: this._requireControlPath(dualAxisBinding.y),
                    normalize: !!dualAxisBinding.normalize,
                    scale: toFiniteNumber(dualAxisBinding.scale, 1),
                    deadzone: Math.max(0, toFiniteNumber(dualAxisBinding.deadzone, 0)),
                    consume,
                    modifiers,
                    exactModifiers,
                });
            }
        }

        throw new InputConfigurationError(
            'input.invalid-binding',
            this._resolveMessage({
                code: 'input.invalid-binding',
                value: binding,
            })
        );
    }

    private _compileBindings(bindings: readonly InputBinding[]): readonly InternalBinding[] {
        const compiled: InternalBinding[] = [];

        for (const binding of bindings) {
            const modifiers = uniqueModifiers(binding.modifiers);
            const modifierMask = modifiersToMask(modifiers);
            const exactModifiers = !!binding.exactModifiers;
            const consume = !!binding.consume;

            switch (binding.type) {
                case 'control': {
                    const control = this._compileControl(this._requireControlPath(String(binding.control)));
                    compiled.push(
                        Object.freeze({
                            type: 'control',
                            control,
                            scale: binding.scale ?? 1,
                            invert: !!binding.invert,
                            deadzone: binding.deadzone ?? 0,
                            consume,
                            modifierMask,
                            exactModifiers,
                            paths: Object.freeze([control.path]),
                        })
                    );
                    break;
                }
                case 'axis': {
                    const negative = this._compileControl(
                        this._requireControlPath(String(binding.negative))
                    );
                    const positive = this._compileControl(
                        this._requireControlPath(String(binding.positive))
                    );
                    compiled.push(
                        Object.freeze({
                            type: 'axis',
                            negative,
                            positive,
                            scale: binding.scale ?? 1,
                            consume,
                            modifierMask,
                            exactModifiers,
                            paths: Object.freeze([negative.path, positive.path]),
                        })
                    );
                    break;
                }
                case 'vector2': {
                    const up = this._compileControl(this._requireControlPath(String(binding.up)));
                    const down = this._compileControl(
                        this._requireControlPath(String(binding.down))
                    );
                    const left = this._compileControl(
                        this._requireControlPath(String(binding.left))
                    );
                    const right = this._compileControl(
                        this._requireControlPath(String(binding.right))
                    );
                    compiled.push(
                        Object.freeze({
                            type: 'vector2',
                            up,
                            down,
                            left,
                            right,
                            normalize: !!binding.normalize,
                            scale: binding.scale ?? 1,
                            consume,
                            modifierMask,
                            exactModifiers,
                            paths: Object.freeze([up.path, down.path, left.path, right.path]),
                        })
                    );
                    break;
                }
                case 'dual-axis': {
                    const x = this._compileControl(this._requireControlPath(String(binding.x)));
                    const y = this._compileControl(this._requireControlPath(String(binding.y)));
                    compiled.push(
                        Object.freeze({
                            type: 'dual-axis',
                            x,
                            y,
                            normalize: !!binding.normalize,
                            scale: binding.scale ?? 1,
                            deadzone: binding.deadzone ?? 0,
                            consume,
                            modifierMask,
                            exactModifiers,
                            paths: Object.freeze([x.path, y.path]),
                        })
                    );
                    break;
                }
            }
        }

        return Object.freeze(compiled);
    }

    private _compileControl(path: InputControlPath): InternalControl {
        const parsed = parseInputControlPath(path);

        if (!parsed) {
            throw new InputConfigurationError(
                'input.invalid-control-path',
                this._resolveMessage({
                    code: 'input.invalid-control-path',
                    value: path,
                })
            );
        }

        switch (parsed.device) {
            case 'keyboard':
                return Object.freeze({
                    device: 'keyboard',
                    kind: 'key',
                    path: parsed.path,
                    code: parsed.code,
                    signed: false,
                });
            case 'mouse':
                if (parsed.kind === 'button') {
                    return Object.freeze({
                        device: 'mouse',
                        kind: 'button',
                        path: parsed.path,
                        button: parsed.button,
                        signed: false,
                    });
                }

                return Object.freeze({
                    device: 'mouse',
                    kind: parsed.kind,
                    path: parsed.path,
                    axis: parsed.axis,
                    signed: parsed.kind !== 'position',
                });
            case 'touch':
                if (parsed.kind === 'contact') {
                    return Object.freeze({
                        device: 'touch',
                        kind: 'contact',
                        path: parsed.path,
                        target: this._compileTouchSelector(parsed.target),
                        signed: false,
                    });
                }

                if (parsed.kind === 'position' || parsed.kind === 'delta') {
                    return Object.freeze({
                        device: 'touch',
                        kind: parsed.kind,
                        path: parsed.path,
                        axis: parsed.axis,
                        target: this._compileTouchSelector(parsed.target),
                        signed: parsed.kind === 'delta',
                    });
                }

                return Object.freeze({
                    device: 'touch',
                    kind: parsed.kind,
                    path: parsed.path,
                    signed: parsed.kind === 'pinch',
                });
            case 'gamepad':
                if (parsed.kind === 'button') {
                    return Object.freeze({
                        device: 'gamepad',
                        kind: 'button',
                        path: parsed.path,
                        selector: this._compileGamepadSelector(parsed.selector),
                        button: parsed.button,
                        signed: false,
                    });
                }

                if (parsed.kind === 'axis') {
                    return Object.freeze({
                        device: 'gamepad',
                        kind: 'axis',
                        path: parsed.path,
                        selector: this._compileGamepadSelector(parsed.selector),
                        axis: parsed.axis,
                        signed: true,
                    });
                }

                return Object.freeze({
                    device: 'gamepad',
                    kind: 'connected',
                    path: parsed.path,
                    selector: this._compileGamepadSelector(parsed.selector),
                    signed: false,
                });
        }
    }

    private _compileTouchSelector(token: string): number {
        if (token === 'any') {
            return TOUCH_ANY;
        }

        if (token === 'primary') {
            return TOUCH_PRIMARY;
        }

        return Number(token);
    }

    private _compileGamepadSelector(token: string): number {
        return token === 'any' ? GAMEPAD_ANY : Number(token);
    }

    private _resolveBindingTarget<TAction extends InputActionName<TSchema>>(
        contextValue: string | InputContextId,
        action: TAction,
        indexValue: number | undefined,
        slotValue?: InputBindingSlot
    ): {
        readonly entry: InternalContextAction<TSchema>;
        readonly index: number;
        readonly slot: InputBindingSlot;
        readonly context: InternalContext<TSchema>;
    } {
        const context = this._requireContext(contextValue);
        const entry = this._requireContextAction(context.id, action);
        const actionIndex = this._requireActionIndex(action);
        const actionDefinition = this._actionDefinitions[actionIndex]!;

        if (typeof indexValue !== 'number' || !Number.isInteger(indexValue) || indexValue < 0) {
            if (actionDefinition.kind === 'vector2') {
                throw new InputRebindingError(
                    'input.invalid-rebind',
                    this._resolveMessage({
                        code: 'input.invalid-rebind',
                        value: { context: contextValue, action, index: indexValue, slot: slotValue },
                    })
                );
            }

            return {
                entry,
                index: entry.current.length,
                slot: 'control',
                context,
            };
        }

        const binding = entry.current[indexValue];
        if (!binding) {
            throw new InputRebindingError(
                'input.invalid-rebind',
                this._resolveMessage({
                    code: 'input.invalid-rebind',
                    value: { context: contextValue, action, index: indexValue, slot: slotValue },
                })
            );
        }

        const slot = this._resolveBindingSlot(binding, slotValue);
        return {
            entry,
            index: indexValue,
            slot,
            context,
        };
    }

    private _resolveControlPatch<TAction extends InputActionName<TSchema>>(
        request: Readonly<InputBindingControlPatchRequest<TSchema, TAction>>
    ): {
        readonly entry: InternalContextAction<TSchema>;
        readonly index: number;
        readonly slot: InputBindingSlot;
        readonly control: InputControlPath;
        readonly context: InternalContext<TSchema>;
    } {
        if (!isRecord(request)) {
            throw new InputRebindingError(
                'input.invalid-rebind',
                this._resolveMessage({
                    code: 'input.invalid-rebind',
                    value: request,
                })
            );
        }

        return {
            ...this._resolveBindingTarget(request.context, request.action, request.index, request.slot),
            control: this._requireControlPath(request.control),
        };
    }

    private _resolveBindingSlot(binding: InputBinding, slot?: InputBindingSlot): InputBindingSlot {
        if (binding.type === 'control') {
            return 'control';
        }

        if (slot) {
            switch (binding.type) {
                case 'axis':
                    if (slot === 'negative' || slot === 'positive') {
                        return slot;
                    }
                    break;
                case 'vector2':
                    if (slot === 'up' || slot === 'down' || slot === 'left' || slot === 'right') {
                        return slot;
                    }
                    break;
                case 'dual-axis':
                    if (slot === 'x' || slot === 'y') {
                        return slot;
                    }
                    break;
            }
        }

        throw new InputRebindingError(
            'input.invalid-slot',
            this._resolveMessage({
                code: 'input.invalid-slot',
                value: slot ?? binding.type,
            })
        );
    }

    private _patchBindingControl(
        binding: InputBinding,
        slot: InputBindingSlot,
        control: InputControlPath
    ): InputBinding {
        switch (binding.type) {
            case 'control':
                return Object.freeze({
                    ...binding,
                    control,
                });
            case 'axis':
                if (slot === 'negative' || slot === 'positive') {
                    return Object.freeze({
                        ...binding,
                        [slot]: control,
                    });
                }
                break;
            case 'vector2':
                if (slot === 'up' || slot === 'down' || slot === 'left' || slot === 'right') {
                    return Object.freeze({
                        ...binding,
                        [slot]: control,
                    });
                }
                break;
            case 'dual-axis':
                if (slot === 'x' || slot === 'y') {
                    return Object.freeze({
                        ...binding,
                        [slot]: control,
                    });
                }
                break;
        }

        throw new InputRebindingError(
            'input.invalid-slot',
            this._resolveMessage({
                code: 'input.invalid-slot',
                value: slot,
            })
        );
    }

    private _handleKeyboardEvent(
        event: Readonly<Extract<InputSourceEvent, { type: 'keyboard' }>>
    ): void {
        const code = event.code.trim();
        if (!code) {
            return;
        }

        if (event.pressed) {
            this._keysDown.add(code);
            if (!event.repeat) {
                this._captureRebinding(
                    this._requireControlPath(`keyboard/${code}`),
                    'keyboard',
                    this._timestamp
                );
            }
        } else {
            this._keysDown.delete(code);
        }
    }

    private _handleMouseButtonEvent(event: Readonly<InputMouseButtonSourceEvent>): void {
        if (Number.isFinite(event.x)) {
            this._mouseX = event.x!;
        }

        if (Number.isFinite(event.y)) {
            this._mouseY = event.y!;
        }

        if (!Number.isInteger(event.button) || event.button < 0 || event.button > 30) {
            return;
        }

        const mask = 1 << event.button;
        if (event.pressed) {
            this._mouseButtons |= mask;
            this._captureRebinding(
                this._requireControlPath(`mouse/button/${event.button}`),
                'mouse',
                this._timestamp
            );
        } else {
            this._mouseButtons &= ~mask;
        }
    }

    private _handleMouseMoveEvent(event: Readonly<InputMouseMoveSourceEvent>): void {
        this._mouseX = event.x;
        this._mouseY = event.y;
        this._mouseDeltaX += event.deltaX;
        this._mouseDeltaY += event.deltaY;

        const axis =
            Math.abs(event.deltaX) >= Math.abs(event.deltaY)
                ? event.deltaX !== 0
                    ? 'x'
                    : undefined
                : event.deltaY !== 0
                  ? 'y'
                  : undefined;

        if (axis) {
            this._captureRebinding(
                this._requireControlPath(`mouse/move/${axis}`),
                'mouse',
                this._timestamp,
                Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY))
            );
        }
    }

    private _handleMouseWheelEvent(event: Readonly<InputMouseWheelSourceEvent>): void {
        this._mouseWheelX += event.deltaX;
        this._mouseWheelY += event.deltaY;
        this._mouseWheelZ += event.deltaZ ?? 0;

        const absX = Math.abs(event.deltaX);
        const absY = Math.abs(event.deltaY);
        const absZ = Math.abs(event.deltaZ ?? 0);
        const dominant = Math.max(absX, absY, absZ);

        if (dominant <= 0) {
            return;
        }

        const axis = dominant === absX ? 'x' : dominant === absY ? 'y' : 'z';
        this._captureRebinding(
            this._requireControlPath(`mouse/wheel/${axis}`),
            'mouse',
            this._timestamp,
            dominant
        );
    }

    private _handleTouchEvent(event: Readonly<InputTouchSourceEvent>): void {
        const changedIds = new Set<number>();

        for (const point of event.changed) {
            changedIds.add(point.id);
            const existing = this._touches.get(point.id);

            if (event.phase === 'end' || event.phase === 'cancel') {
                if (existing) {
                    existing.deltaX += point.x - existing.x;
                    existing.deltaY += point.y - existing.y;
                    existing.x = point.x;
                    existing.y = point.y;
                }

                this._touches.delete(point.id);
                continue;
            }

            if (existing) {
                existing.deltaX += point.x - existing.x;
                existing.deltaY += point.y - existing.y;
                existing.x = point.x;
                existing.y = point.y;
            } else {
                this._touches.set(point.id, {
                    id: point.id,
                    order: ++this._touchOrder,
                    x: point.x,
                    y: point.y,
                    deltaX: 0,
                    deltaY: 0,
                });
            }
        }

        if (event.phase === 'start' || event.phase === 'move') {
            for (const point of event.touches) {
                if (changedIds.has(point.id)) {
                    continue;
                }

                const existing = this._touches.get(point.id);
                if (!existing) {
                    this._touches.set(point.id, {
                        id: point.id,
                        order: ++this._touchOrder,
                        x: point.x,
                        y: point.y,
                        deltaX: 0,
                        deltaY: 0,
                    });
                    continue;
                }

                existing.x = point.x;
                existing.y = point.y;
            }
        }

        this._refreshPrimaryTouch();
        this._updateTouchPinch();

        if (event.phase === 'start' && event.changed.length > 0) {
            this._captureRebinding(
                this._requireControlPath('touch/contact/primary'),
                'touch',
                this._timestamp
            );
        } else if (event.phase === 'move' && Math.abs(this._touchPinchDelta) > 0) {
            this._captureRebinding(
                this._requireControlPath('touch/pinch'),
                'touch',
                this._timestamp,
                Math.abs(this._touchPinchDelta)
            );
        }
    }

    private _handleFocusEvent(event: Readonly<InputFocusSourceEvent>): void {
        if (event.focused) {
            return;
        }

        this._clearDeviceState(true);
    }

    private _ingestGamepadSnapshots(gamepads: readonly InputGamepadSnapshot[]): void {
        this._gamepadSeen.clear();

        for (const snapshot of gamepads) {
            if (!Number.isInteger(snapshot.index) || snapshot.index < 0) {
                continue;
            }

            this._gamepadSeen.add(snapshot.index);
            const state = this._ensureGamepadState(
                snapshot.index,
                snapshot.buttons.length,
                snapshot.axes.length
            );
            state.connected = snapshot.connected;

            for (let index = 0; index < state.buttons.length; index += 1) {
                state.buttons[index] = snapshot.buttons[index] ?? 0;
            }

            for (let index = 0; index < state.axes.length; index += 1) {
                state.axes[index] = snapshot.axes[index] ?? 0;
            }
        }

        for (const [index, state] of this._gamepads) {
            if (!this._gamepadSeen.has(index)) {
                state.connected = false;
                state.buttons.fill(0);
                state.axes.fill(0);
            }
        }
    }

    private _pollGamepads(): void {
        if (!this._gamepad.enabled || !this._gamepad.autoPoll) {
            return;
        }

        const provider =
            this._gamepad.provider ??
            (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
                ? navigator
                : undefined);

        if (!provider) {
            return;
        }

        const rawGamepads = provider.getGamepads();
        if (!rawGamepads) {
            return;
        }

        const snapshots: InputGamepadSnapshot[] = [];

        for (const rawGamepad of rawGamepads) {
            if (!rawGamepad) {
                continue;
            }

            snapshots.push({
                index: rawGamepad.index,
                connected: rawGamepad.connected,
                buttons: rawGamepad.buttons.map((button) => button.value),
                axes: [...rawGamepad.axes],
            });
        }

        this._ingestGamepadSnapshots(snapshots);
        this._captureGamepadCandidate(this._timestamp);
    }

    private _captureGamepadCandidate(timestamp: number): void {
        const active = this._activeRebinding;
        if (!active || (active.request.devices?.length && !active.request.devices.includes('gamepad'))) {
            return;
        }

        const threshold = Math.max(0, toFiniteNumber(active.request.threshold, 0.5));

        for (const [index, state] of this._gamepads) {
            if (!state.connected) {
                continue;
            }

            for (let button = 0; button < state.buttons.length; button += 1) {
                const value = state.buttons[button] ?? 0;
                if (value >= threshold) {
                    this._captureRebinding(
                        this._requireControlPath(`gamepad/${index}/button/${button}`),
                        'gamepad',
                        timestamp,
                        value
                    );
                    return;
                }
            }

            for (let axis = 0; axis < state.axes.length; axis += 1) {
                const value = state.axes[axis] ?? 0;
                if (Math.abs(value) >= threshold) {
                    this._captureRebinding(
                        this._requireControlPath(`gamepad/${index}/axis/${axis}`),
                        'gamepad',
                        timestamp,
                        Math.abs(value)
                    );
                    return;
                }
            }
        }
    }

    private _captureRebinding(
        control: InputControlPath,
        device: InputDeviceKind,
        timestamp: number,
        magnitudeValue = 1
    ): void {
        const active = this._activeRebinding;
        if (!active) {
            return;
        }

        if (active.request.devices?.length && !active.request.devices.includes(device)) {
            return;
        }

        const threshold = Math.max(0, toFiniteNumber(active.request.threshold, 0.5));
        if (magnitudeValue < threshold) {
            return;
        }

        const candidate: InputRebindingCandidate = Object.freeze({
            control,
            device,
            timestamp,
        });

        if (active.handlers?.accept?.(candidate) === false) {
            return;
        }

        const nextBindings = this.rebind({
            context: active.request.context,
            action: active.request.action,
            index: active.request.index,
            slot: active.request.slot,
            control,
        } as InputBindingControlPatchRequest<TSchema>);
        const resolved = this._resolveBindingTarget(
            active.request.context,
            active.request.action,
            active.request.index,
            active.request.slot
        );
        const binding = nextBindings[resolved.index]!;
        const handlers = active.handlers;
        this._activeRebinding = undefined;

        const result: InputRebindingResult<TSchema> = Object.freeze({
            context: resolved.context.id,
            action: active.request.action,
            index: resolved.index,
            slot: resolved.slot,
            control,
            binding,
            timestamp,
        });

        handlers?.complete?.(result);
    }

    private _cancelRebinding(reason: 'manual' | 'timeout' | 'disposed' | 'replaced' | 'completed'): void {
        const active = this._activeRebinding;
        if (!active) {
            return;
        }

        this._activeRebinding = undefined;
        active.handlers?.cancel?.(reason);
    }

    private _expireRebindingIfNeeded(now: number): void {
        const active = this._activeRebinding;
        if (!active || typeof active.deadlineEpochMs !== 'number' || now < active.deadlineEpochMs) {
            return;
        }

        const message = this._resolveMessage({
            code: 'input.rebind.timeout',
            action: String(active.request.action),
            context: String(active.request.context),
        });
        const handlers = active.handlers;
        this._activeRebinding = undefined;
        handlers?.cancel?.('timeout');
    }

    private _clearDeviceState(resetGamepads: boolean): void {
        this._keysDown.clear();
        this._mouseButtons = 0;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;
        this._mouseWheelX = 0;
        this._mouseWheelY = 0;
        this._mouseWheelZ = 0;
        this._touches.clear();
        this._primaryTouchId = undefined;
        this._touchPinchDistance = 0;
        this._touchPinchDelta = 0;

        if (!resetGamepads) {
            return;
        }

        for (const [, state] of this._gamepads) {
            state.connected = false;
            state.buttons.fill(0);
            state.axes.fill(0);
        }
    }

    private _evaluate(): void {
        this._accumulatorX.fill(0);
        this._accumulatorY.fill(0);
        this._assigned.fill(0);
        this._sourceContexts.fill(undefined);
        this._consumedPaths.clear();

        for (const context of this._getOrderedContexts()) {
            if (!context.enabled) {
                continue;
            }

            for (const [actionIndex, actionEntry] of context.actions) {
                const definition = this._actionDefinitions[actionIndex]!;

                if (definition.kind === 'vector2') {
                    this._evaluateVectorAction(actionIndex, definition, context, actionEntry.compiled);
                    continue;
                }

                this._evaluateScalarAction(actionIndex, definition, context, actionEntry.compiled);
            }
        }

        for (let index = 0; index < this._actionDefinitions.length; index += 1) {
            const definition = this._actionDefinitions[index]!;

            switch (definition.kind) {
                case 'button':
                    this._commitButtonState(index, definition);
                    break;
                case 'axis':
                    this._commitAxisState(index, definition);
                    break;
                case 'vector2':
                    this._commitVectorState(index, definition);
                    break;
            }
        }
    }

    private _evaluateScalarAction(
        actionIndex: number,
        definition: Extract<InternalActionDefinition, { kind: 'button' | 'axis' }>,
        context: InternalContext<TSchema>,
        bindings: readonly InternalBinding[]
    ): void {
        for (const binding of bindings) {
            if (binding.type !== 'control' && binding.type !== 'axis') {
                continue;
            }

            if (!this._matchesModifiers(binding) || this._isBindingConsumed(binding)) {
                continue;
            }

            const value =
                binding.type === 'control'
                    ? this._evaluateControlBinding(binding)
                    : this._evaluateAxisCompositeBinding(binding);

            if (Math.abs(value) <= EPSILON) {
                continue;
            }

            if (!this._sourceContexts[actionIndex]) {
                this._sourceContexts[actionIndex] = context.id;
            }

            if (definition.kind === 'button') {
                this._accumulatorX[actionIndex] = Math.max(
                    this._accumulatorX[actionIndex]!,
                    Math.abs(value)
                );
            } else if (definition.combine === 'latest') {
                if (this._assigned[actionIndex] === 0) {
                    this._assigned[actionIndex] = 1;
                    this._accumulatorX[actionIndex] = value;
                }
            } else if (definition.combine === 'max-abs') {
                if (Math.abs(value) > Math.abs(this._accumulatorX[actionIndex]!)) {
                    this._accumulatorX[actionIndex] = value;
                }
            } else {
                this._accumulatorX[actionIndex] += value;
            }

            if (context.capture === 'used' || definition.consume || binding.consume) {
                this._consumeBinding(binding);
            }
        }
    }

    private _evaluateVectorAction(
        actionIndex: number,
        definition: Extract<InternalActionDefinition, { kind: 'vector2' }>,
        context: InternalContext<TSchema>,
        bindings: readonly InternalBinding[]
    ): void {
        for (const binding of bindings) {
            if (binding.type !== 'vector2' && binding.type !== 'dual-axis') {
                continue;
            }

            if (!this._matchesModifiers(binding) || this._isBindingConsumed(binding)) {
                continue;
            }

            const vector =
                binding.type === 'vector2'
                    ? this._evaluateDirectionalBinding(binding)
                    : this._evaluateDualAxisBinding(binding);

            if (Math.abs(vector.x) <= EPSILON && Math.abs(vector.y) <= EPSILON) {
                continue;
            }

            if (!this._sourceContexts[actionIndex]) {
                this._sourceContexts[actionIndex] = context.id;
            }

            if (definition.combine === 'latest') {
                if (this._assigned[actionIndex] === 0) {
                    this._assigned[actionIndex] = 1;
                    this._accumulatorX[actionIndex] = vector.x;
                    this._accumulatorY[actionIndex] = vector.y;
                }
            } else {
                this._accumulatorX[actionIndex] += vector.x;
                this._accumulatorY[actionIndex] += vector.y;
            }

            if (context.capture === 'used' || definition.consume || binding.consume) {
                this._consumeBinding(binding);
            }
        }
    }

    private _evaluateControlBinding(binding: InternalControlBinding): number {
        let value = this._sampleControl(binding.control);

        if (binding.invert) {
            value = -value;
        }

        value = applyDeadzone(value, binding.deadzone);
        return value * binding.scale;
    }

    private _evaluateAxisCompositeBinding(binding: InternalAxisCompositeBinding): number {
        const positive = this._sampleDirectional(binding.positive, 'positive');
        const negative = this._sampleDirectional(binding.negative, 'negative');
        return (positive - negative) * binding.scale;
    }

    private _evaluateDirectionalBinding(binding: InternalDirectionalBinding): MutableVector2 {
        let x =
            this._sampleDirectional(binding.right, 'positive') -
            this._sampleDirectional(binding.left, 'negative');
        let y =
            this._sampleDirectional(binding.up, 'positive') -
            this._sampleDirectional(binding.down, 'negative');

        x *= binding.scale;
        y *= binding.scale;

        if (binding.normalize) {
            const length = magnitude(x, y);
            if (length > 1) {
                x /= length;
                y /= length;
            }
        }

        return {
            x,
            y,
        };
    }

    private _evaluateDualAxisBinding(binding: InternalDualAxisBinding): MutableVector2 {
        let x = this._sampleControl(binding.x) * binding.scale;
        let y = this._sampleControl(binding.y) * binding.scale;
        const length = magnitude(x, y);

        if (length <= binding.deadzone) {
            x = 0;
            y = 0;
        } else if (binding.normalize && length > 1) {
            x /= length;
            y /= length;
        }

        return {
            x,
            y,
        };
    }

    private _sampleControl(control: InternalControl): number {
        switch (control.device) {
            case 'keyboard':
                return this._keysDown.has(control.code) ? 1 : 0;
            case 'mouse':
                switch (control.kind) {
                    case 'button':
                        return (this._mouseButtons & (1 << control.button)) !== 0 ? 1 : 0;
                    case 'move':
                        return control.axis === 'x' ? this._mouseDeltaX : this._mouseDeltaY;
                    case 'wheel':
                        if (control.axis === 'x') {
                            return this._mouseWheelX;
                        }

                        if (control.axis === 'y') {
                            return this._mouseWheelY;
                        }

                        return this._mouseWheelZ;
                    case 'position':
                        return control.axis === 'x' ? this._mouseX : this._mouseY;
                }
                return 0;
            case 'touch':
                switch (control.kind) {
                    case 'contact':
                        if (control.target === TOUCH_ANY) {
                            return this._touches.size > 0 ? 1 : 0;
                        }
                        return this._resolveTouch(control.target) ? 1 : 0;
                    case 'position': {
                        const touch = this._resolveTouch(control.target);
                        if (!touch) {
                            return 0;
                        }
                        return control.axis === 'x' ? touch.x : touch.y;
                    }
                    case 'delta': {
                        const touch = this._resolveTouch(control.target);
                        if (!touch) {
                            return 0;
                        }
                        return control.axis === 'x' ? touch.deltaX : touch.deltaY;
                    }
                    case 'pinch':
                        return this._touchPinchDelta;
                    case 'count':
                        return this._touches.size;
                }
                return 0;
            case 'gamepad':
                switch (control.kind) {
                    case 'connected':
                        return this._sampleGamepadConnected(control.selector);
                    case 'button':
                        return this._sampleGamepadButton(control.selector, control.button);
                    case 'axis':
                        return this._sampleGamepadAxis(control.selector, control.axis);
                }
                return 0;
        }
    }

    private _sampleDirectional(control: InternalControl, direction: 'positive' | 'negative'): number {
        const raw = this._sampleControl(control);

        if (!control.signed) {
            return raw > 0 ? raw : 0;
        }

        return direction === 'positive' ? Math.max(raw, 0) : Math.max(-raw, 0);
    }

    private _resolveTouch(target: number): MutableTouchPoint | undefined {
        if (target === TOUCH_ANY) {
            return this._primaryTouchId !== undefined
                ? this._touches.get(this._primaryTouchId)
                : this._touches.values().next().value;
        }

        if (target === TOUCH_PRIMARY) {
            return this._primaryTouchId !== undefined
                ? this._touches.get(this._primaryTouchId)
                : undefined;
        }

        return this._touches.get(target);
    }

    private _sampleGamepadConnected(selector: number): number {
        if (selector === GAMEPAD_ANY) {
            for (const [, state] of this._gamepads) {
                if (state.connected) {
                    return 1;
                }
            }
            return 0;
        }

        return this._gamepads.get(selector)?.connected ? 1 : 0;
    }

    private _sampleGamepadButton(selector: number, button: number): number {
        if (selector === GAMEPAD_ANY) {
            let maxValue = 0;

            for (const [, state] of this._gamepads) {
                if (!state.connected) {
                    continue;
                }

                maxValue = Math.max(maxValue, state.buttons[button] ?? 0);
            }

            return maxValue;
        }

        const state = this._gamepads.get(selector);
        return state?.connected ? state.buttons[button] ?? 0 : 0;
    }

    private _sampleGamepadAxis(selector: number, axis: number): number {
        if (selector === GAMEPAD_ANY) {
            let best = 0;

            for (const [, state] of this._gamepads) {
                if (!state.connected) {
                    continue;
                }

                const value = state.axes[axis] ?? 0;
                if (Math.abs(value) > Math.abs(best)) {
                    best = value;
                }
            }

            return best;
        }

        const state = this._gamepads.get(selector);
        return state?.connected ? state.axes[axis] ?? 0 : 0;
    }

    private _matchesModifiers(binding: InternalBindingBase<InputBinding['type']>): boolean {
        if (binding.modifierMask === 0) {
            return true;
        }

        const currentMask = this._currentModifierMask();
        if (binding.exactModifiers) {
            return currentMask === binding.modifierMask;
        }

        return (currentMask & binding.modifierMask) === binding.modifierMask;
    }

    private _currentModifierMask(): number {
        let mask = 0;

        if (this._keysDown.has('ShiftLeft') || this._keysDown.has('ShiftRight')) {
            mask |= MODIFIER_MASKS.shift;
        }

        if (this._keysDown.has('ControlLeft') || this._keysDown.has('ControlRight')) {
            mask |= MODIFIER_MASKS.ctrl;
        }

        if (this._keysDown.has('AltLeft') || this._keysDown.has('AltRight')) {
            mask |= MODIFIER_MASKS.alt;
        }

        if (this._keysDown.has('MetaLeft') || this._keysDown.has('MetaRight')) {
            mask |= MODIFIER_MASKS.meta;
        }

        return mask;
    }

    private _isBindingConsumed(binding: InternalBindingBase<InputBinding['type']>): boolean {
        for (const path of binding.paths) {
            if (this._consumedPaths.has(path)) {
                return true;
            }
        }

        return false;
    }

    private _consumeBinding(binding: InternalBindingBase<InputBinding['type']>): void {
        for (const path of binding.paths) {
            this._consumedPaths.add(path);
        }
    }

    private _commitButtonState(
        index: number,
        definition: Extract<InternalActionDefinition, { kind: 'button' }>
    ): void {
        const state = this._buttonStateStores[index]!;
        const previousValue = state.value;
        const previousRawValue = state.rawValue;
        const rawValue = this._accumulatorX[index]!;
        const nextValue = previousValue
            ? rawValue > definition.releasePoint + EPSILON
            : rawValue >= definition.pressPoint - EPSILON;

        state.previousValue = previousValue;
        state.previousRawValue = previousRawValue;
        state.value = nextValue;
        state.rawValue = rawValue;
        state.pressed = !previousValue && nextValue;
        state.released = previousValue && !nextValue;
        state.active = nextValue;
        state.changed =
            state.pressed ||
            state.released ||
            Math.abs(rawValue - previousRawValue) > EPSILON;
        state.frame = this._frame;
        state.timestamp = this._timestamp;
        state.context = this._sourceContexts[index];
    }

    private _commitAxisState(
        index: number,
        definition: Extract<InternalActionDefinition, { kind: 'axis' }>
    ): void {
        const state = this._axisStateStores[index]!;
        const previousValue = state.value;
        const unclamped = applyDeadzone(this._accumulatorX[index]!, definition.deadzone);
        const value = clamp(unclamped, definition.min, definition.max);

        state.previousValue = previousValue;
        state.value = value;
        state.delta = value - previousValue;
        state.active = Math.abs(value) > EPSILON;
        state.changed = Math.abs(state.delta) > EPSILON;
        state.frame = this._frame;
        state.timestamp = this._timestamp;
        state.context = this._sourceContexts[index];
    }

    private _commitVectorState(
        index: number,
        definition: Extract<InternalActionDefinition, { kind: 'vector2' }>
    ): void {
        const state = this._vectorStateStores[index]!;
        let x = this._accumulatorX[index]!;
        let y = this._accumulatorY[index]!;
        let length = magnitude(x, y);

        if (length <= definition.deadzone) {
            x = 0;
            y = 0;
            length = 0;
        } else if (definition.normalize && length > 1) {
            x /= length;
            y /= length;
            length = 1;
        }

        const previousX = state.value.x;
        const previousY = state.value.y;
        const previousMagnitude = state.magnitude;

        state.previousValue.x = previousX;
        state.previousValue.y = previousY;
        state.value.x = x;
        state.value.y = y;
        state.delta.x = x - previousX;
        state.delta.y = y - previousY;
        state.previousMagnitude = previousMagnitude;
        state.magnitude = length;
        state.active = length > EPSILON;
        state.changed = Math.abs(state.delta.x) > EPSILON || Math.abs(state.delta.y) > EPSILON;
        state.frame = this._frame;
        state.timestamp = this._timestamp;
        state.context = this._sourceContexts[index];
    }

    private _clearTransients(): void {
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;
        this._mouseWheelX = 0;
        this._mouseWheelY = 0;
        this._mouseWheelZ = 0;
        this._touchPinchDelta = 0;

        for (const [, touch] of this._touches) {
            touch.deltaX = 0;
            touch.deltaY = 0;
        }
    }

    private _refreshPrimaryTouch(): void {
        let selected: MutableTouchPoint | undefined;

        for (const [, touch] of this._touches) {
            if (!selected || touch.order < selected.order) {
                selected = touch;
            }
        }

        this._primaryTouchId = selected?.id;
    }

    private _updateTouchPinch(): void {
        const activeTouches = [...this._touches.values()].sort(
            (left, right) => left.order - right.order
        );

        if (activeTouches.length < 2) {
            this._touchPinchDistance = 0;
            this._touchPinchDelta = 0;
            return;
        }

        const [first, second] = activeTouches;
        const distance = Math.hypot(second!.x - first!.x, second!.y - first!.y);

        if (this._touchPinchDistance > 0) {
            this._touchPinchDelta += distance - this._touchPinchDistance;
        }

        this._touchPinchDistance = distance;
    }

    private _ensureGamepadState(index: number, buttonCount: number, axisCount: number): MutableGamepadState {
        const existing = this._gamepads.get(index);

        if (existing) {
            if (existing.buttons.length !== buttonCount) {
                const nextButtons = new Float64Array(buttonCount);
                nextButtons.set(
                    existing.buttons.subarray(0, Math.min(buttonCount, existing.buttons.length))
                );
                existing.buttons = nextButtons;
            }

            if (existing.axes.length !== axisCount) {
                const nextAxes = new Float64Array(axisCount);
                nextAxes.set(existing.axes.subarray(0, Math.min(axisCount, existing.axes.length)));
                existing.axes = nextAxes;
            }

            return existing;
        }

        const created: MutableGamepadState = {
            connected: false,
            buttons: new Float64Array(buttonCount),
            axes: new Float64Array(axisCount),
        };

        this._gamepads.set(index, created);
        return created;
    }

    private _getOrderedContexts(): readonly InternalContext<TSchema>[] {
        if (!this._contextOrderDirty) {
            return this._orderedContexts;
        }

        this._orderedContexts = [...this._contexts.values()].sort((left, right) => {
            if (right.priority !== left.priority) {
                return right.priority - left.priority;
            }

            return right.sequence - left.sequence;
        });
        this._contextOrderDirty = false;
        return this._orderedContexts;
    }

    private _snapshotContextState(context: InternalContext<TSchema>): InputContextState {
        return Object.freeze({
            id: context.id,
            priority: context.priority,
            enabled: context.enabled,
            capture: context.capture,
        });
    }

    private _requireActionIndex(action: string): number {
        const index = this._actionIndices.get(action);
        if (typeof index === 'number') {
            return index;
        }

        throw new InputConfigurationError(
            'input.invalid-action',
            this._resolveMessage({
                code: 'input.invalid-action',
                value: action,
            })
        );
    }

    private _requireContextId(value: string | InputContextId): InputContextId {
        const normalized = normalizeInputContextId(String(value));
        if (normalized) {
            return normalized;
        }

        throw new InputContextError(
            'input.invalid-context',
            String(value),
            this._resolveMessage({
                code: 'input.invalid-context',
                value,
            })
        );
    }

    private _requireContext(value: string | InputContextId): InternalContext<TSchema> {
        const id = this._requireContextId(value);
        const context = this._contexts.get(id);

        if (context) {
            return context;
        }

        throw new InputContextError(
            'input.invalid-context',
            String(id),
            this._resolveMessage({
                code: 'input.invalid-context',
                value,
            })
        );
    }

    private _requireContextAction<TAction extends InputActionName<TSchema>>(
        context: string | InputContextId,
        action: TAction
    ): InternalContextAction<TSchema> {
        const storedContext = this._requireContext(context);
        const actionIndex = this._requireActionIndex(action);
        const entry = storedContext.actions.get(actionIndex);

        if (entry) {
            return entry;
        }

        const normalized = this._normalizeBindingList(action, []);
        const created: InternalContextAction<TSchema> = {
            action,
            current: normalized,
            defaults: normalized,
            compiled: this._compileBindings(normalized),
        };
        storedContext.actions.set(actionIndex, created);
        return created;
    }

    private _normalizePriority(value: number): number {
        if (!Number.isFinite(value)) {
            throw new InputConfigurationError(
                'input.invalid-priority',
                this._resolveMessage({
                    code: 'input.invalid-priority',
                    value,
                })
            );
        }

        return Math.trunc(value);
    }

    private _requireControlPath(value: string): InputControlPath {
        const normalized = normalizeInputControlPath(value);
        if (normalized) {
            return normalized;
        }

        throw new InputConfigurationError(
            'input.invalid-control-path',
            this._resolveMessage({
                code: 'input.invalid-control-path',
                value,
            })
        );
    }

    private _resolveMessage(descriptor: Readonly<InputMessageDescriptor>): string {
        return resolveInputMessage(descriptor, this._locale, this._messageResolver);
    }

    private _assertNotDisposed(): void {
        if (!this._disposed) {
            return;
        }

        throw new InputDisposedError(
            this._resolveMessage({
                code: 'input.disposed',
            })
        );
    }
}

export const createInputSystem = <TSchema extends InputActionSchema>(
    options: InputSystemOptions<TSchema>
): InputSystem<TSchema> => new InputSystem(options);
