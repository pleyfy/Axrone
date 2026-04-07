import type { IDisposable } from '../types';

export type InputDeviceKind = 'keyboard' | 'mouse' | 'touch' | 'gamepad';
export type InputActionKind = 'button' | 'axis' | 'vector2';
export type InputContextCapture = 'none' | 'used';
export type InputModifierKey = 'shift' | 'ctrl' | 'alt' | 'meta';

export interface InputVector2 {
    readonly x: number;
    readonly y: number;
}

export interface InputScaleProcessor {
    readonly type: 'scale';
    readonly value: number;
}

export interface InputInvertProcessor {
    readonly type: 'invert';
}

export interface InputClampProcessor {
    readonly type: 'clamp';
    readonly min: number;
    readonly max: number;
}

export interface InputDeadzoneProcessor {
    readonly type: 'deadzone';
    readonly value: number;
}

export interface InputCurveProcessor {
    readonly type: 'curve';
    readonly exponent: number;
    readonly signed?: boolean;
}

export interface InputScaleVector2Processor {
    readonly type: 'scale-vector2';
    readonly x?: number;
    readonly y?: number;
}

export interface InputInvertVector2Processor {
    readonly type: 'invert-vector2';
    readonly x?: boolean;
    readonly y?: boolean;
}

export interface InputNormalizeVector2Processor {
    readonly type: 'normalize-vector2';
}

export interface InputClampMagnitudeProcessor {
    readonly type: 'clamp-magnitude';
    readonly min?: number;
    readonly max: number;
}

export type InputScalarProcessor =
    | InputScaleProcessor
    | InputInvertProcessor
    | InputClampProcessor
    | InputDeadzoneProcessor
    | InputCurveProcessor;

export type InputVector2Processor =
    | InputScaleVector2Processor
    | InputInvertVector2Processor
    | InputNormalizeVector2Processor
    | InputClampMagnitudeProcessor;

export type InputProcessor = InputScalarProcessor | InputVector2Processor;

export interface InputActionDefinitionBase<TKind extends InputActionKind> {
    readonly kind: TKind;
    readonly consume?: boolean;
    readonly processors?: readonly InputProcessor[];
}

export interface InputButtonActionDefinition extends InputActionDefinitionBase<'button'> {
    readonly pressPoint?: number;
    readonly releasePoint?: number;
}

export interface InputAxisActionDefinition extends InputActionDefinitionBase<'axis'> {
    readonly deadzone?: number;
    readonly clamp?: readonly [min: number, max: number];
    readonly combine?: 'sum' | 'max-abs' | 'latest';
}

export interface InputVector2ActionDefinition extends InputActionDefinitionBase<'vector2'> {
    readonly deadzone?: number;
    readonly normalize?: boolean;
    readonly combine?: 'sum' | 'latest';
}

export type InputActionDefinition =
    | InputButtonActionDefinition
    | InputAxisActionDefinition
    | InputVector2ActionDefinition;

export type InputActionSchema = Readonly<Record<string, InputActionDefinition>>;
export type InputActionName<TSchema extends InputActionSchema> = Extract<keyof TSchema, string>;
export type InputContextId = string & { readonly __inputContextIdBrand: unique symbol };
export type InputControlPath = string & { readonly __inputControlPathBrand: unique symbol };

export type InputTouchSelectorToken = 'any' | 'primary' | `${number}`;
export type InputGamepadSelectorToken = 'any' | `${number}`;

export type KeyboardControlPath = `keyboard/${string}`;
export type MouseButtonControlPath = `mouse/button/${number}`;
export type MouseMotionControlPath = `mouse/move/${'x' | 'y'}`;
export type MouseWheelControlPath = `mouse/wheel/${'x' | 'y' | 'z'}`;
export type MousePositionControlPath = `mouse/position/${'x' | 'y'}`;
export type TouchContactControlPath = `touch/contact/${InputTouchSelectorToken}`;
export type TouchPositionControlPath =
    `touch/position/${'x' | 'y'}/${InputTouchSelectorToken}`;
export type TouchDeltaControlPath = `touch/delta/${'x' | 'y'}/${InputTouchSelectorToken}`;
export type TouchAggregateControlPath = 'touch/pinch' | 'touch/count';
export type GamepadButtonControlPath =
    `gamepad/${InputGamepadSelectorToken}/button/${number}`;
export type GamepadAxisControlPath = `gamepad/${InputGamepadSelectorToken}/axis/${number}`;
export type GamepadConnectionControlPath = `gamepad/${InputGamepadSelectorToken}/connected`;
export type KnownInputControlPath =
    | KeyboardControlPath
    | MouseButtonControlPath
    | MouseMotionControlPath
    | MouseWheelControlPath
    | MousePositionControlPath
    | TouchContactControlPath
    | TouchPositionControlPath
    | TouchDeltaControlPath
    | TouchAggregateControlPath
    | GamepadButtonControlPath
    | GamepadAxisControlPath
    | GamepadConnectionControlPath;

export interface ParsedKeyboardControlPath {
    readonly device: 'keyboard';
    readonly path: KeyboardControlPath & InputControlPath;
    readonly code: string;
}

export interface ParsedMouseButtonControlPath {
    readonly device: 'mouse';
    readonly kind: 'button';
    readonly path: MouseButtonControlPath & InputControlPath;
    readonly button: number;
}

export interface ParsedMouseAxisControlPath {
    readonly device: 'mouse';
    readonly kind: 'move' | 'wheel' | 'position';
    readonly path:
        | (MouseMotionControlPath & InputControlPath)
        | (MouseWheelControlPath & InputControlPath)
        | (MousePositionControlPath & InputControlPath);
    readonly axis: 'x' | 'y' | 'z';
}

export interface ParsedTouchContactControlPath {
    readonly device: 'touch';
    readonly kind: 'contact';
    readonly path: TouchContactControlPath & InputControlPath;
    readonly target: InputTouchSelectorToken;
}

export interface ParsedTouchAxisControlPath {
    readonly device: 'touch';
    readonly kind: 'position' | 'delta';
    readonly path: (TouchPositionControlPath | TouchDeltaControlPath) & InputControlPath;
    readonly axis: 'x' | 'y';
    readonly target: InputTouchSelectorToken;
}

export interface ParsedTouchAggregateControlPath {
    readonly device: 'touch';
    readonly kind: 'pinch' | 'count';
    readonly path: TouchAggregateControlPath & InputControlPath;
}

export interface ParsedGamepadButtonControlPath {
    readonly device: 'gamepad';
    readonly kind: 'button';
    readonly path: GamepadButtonControlPath & InputControlPath;
    readonly selector: InputGamepadSelectorToken;
    readonly button: number;
}

export interface ParsedGamepadAxisControlPath {
    readonly device: 'gamepad';
    readonly kind: 'axis';
    readonly path: GamepadAxisControlPath & InputControlPath;
    readonly selector: InputGamepadSelectorToken;
    readonly axis: number;
}

export interface ParsedGamepadConnectionControlPath {
    readonly device: 'gamepad';
    readonly kind: 'connected';
    readonly path: GamepadConnectionControlPath & InputControlPath;
    readonly selector: InputGamepadSelectorToken;
}

export type ParsedInputControlPath =
    | ParsedKeyboardControlPath
    | ParsedMouseButtonControlPath
    | ParsedMouseAxisControlPath
    | ParsedTouchContactControlPath
    | ParsedTouchAxisControlPath
    | ParsedTouchAggregateControlPath
    | ParsedGamepadButtonControlPath
    | ParsedGamepadAxisControlPath
    | ParsedGamepadConnectionControlPath;

export interface InputBindingBase<TType extends string> {
    readonly type: TType;
    readonly consume?: boolean;
    readonly modifiers?: readonly InputModifierKey[];
    readonly exactModifiers?: boolean;
    readonly processors?: readonly InputProcessor[];
}

export interface InputControlBinding extends InputBindingBase<'control'> {
    readonly control: KnownInputControlPath | InputControlPath;
    readonly scale?: number;
    readonly invert?: boolean;
    readonly deadzone?: number;
}

export interface InputAxisCompositeBinding extends InputBindingBase<'axis'> {
    readonly negative: KnownInputControlPath | InputControlPath;
    readonly positive: KnownInputControlPath | InputControlPath;
    readonly scale?: number;
}

export interface InputDirectionalBinding extends InputBindingBase<'vector2'> {
    readonly up: KnownInputControlPath | InputControlPath;
    readonly down: KnownInputControlPath | InputControlPath;
    readonly left: KnownInputControlPath | InputControlPath;
    readonly right: KnownInputControlPath | InputControlPath;
    readonly normalize?: boolean;
    readonly scale?: number;
}

export interface InputDualAxisBinding extends InputBindingBase<'dual-axis'> {
    readonly x: KnownInputControlPath | InputControlPath;
    readonly y: KnownInputControlPath | InputControlPath;
    readonly normalize?: boolean;
    readonly scale?: number;
    readonly deadzone?: number;
}

export type InputScalarBinding = InputControlBinding | InputAxisCompositeBinding;
export type InputVector2Binding = InputDirectionalBinding | InputDualAxisBinding;
export type InputBinding = InputScalarBinding | InputVector2Binding;

export type InputBindingSlotFor<TBinding extends InputBinding> = TBinding extends InputControlBinding
    ? 'control'
    : TBinding extends InputAxisCompositeBinding
      ? 'negative' | 'positive'
      : TBinding extends InputDirectionalBinding
        ? 'up' | 'down' | 'left' | 'right'
        : TBinding extends InputDualAxisBinding
          ? 'x' | 'y'
          : never;

export type InputBindingSlot = InputBindingSlotFor<InputBinding>;

export type InputBindingForAction<TDefinition extends InputActionDefinition> =
    TDefinition extends InputVector2ActionDefinition ? InputVector2Binding : InputScalarBinding;

export type InputActionBindings<TSchema extends InputActionSchema> = {
    readonly [TAction in InputActionName<TSchema>]?: readonly InputBindingForAction<
        TSchema[TAction]
    >[];
};

export interface InputContextDefinition<TSchema extends InputActionSchema> {
    readonly id: string;
    readonly priority?: number;
    readonly enabled?: boolean;
    readonly capture?: InputContextCapture;
    readonly bindings?: InputActionBindings<TSchema>;
}

export interface InputContextState {
    readonly id: InputContextId;
    readonly priority: number;
    readonly enabled: boolean;
    readonly capture: InputContextCapture;
}

export type InputActionValue<TDefinition extends InputActionDefinition> =
    TDefinition extends InputButtonActionDefinition
        ? boolean
        : TDefinition extends InputAxisActionDefinition
          ? number
          : InputVector2;

export interface InputActionFrameStateBase<TKind extends InputActionKind> {
    readonly kind: TKind;
    readonly active: boolean;
    readonly changed: boolean;
    readonly frame: number;
    readonly timestamp: number;
    readonly context?: InputContextId;
}

export interface InputButtonState extends InputActionFrameStateBase<'button'> {
    readonly value: boolean;
    readonly previousValue: boolean;
    readonly rawValue: number;
    readonly previousRawValue: number;
    readonly pressed: boolean;
    readonly released: boolean;
}

export interface InputAxisState extends InputActionFrameStateBase<'axis'> {
    readonly value: number;
    readonly previousValue: number;
    readonly delta: number;
}

export interface InputVector2State extends InputActionFrameStateBase<'vector2'> {
    readonly value: InputVector2;
    readonly previousValue: InputVector2;
    readonly delta: InputVector2;
    readonly magnitude: number;
    readonly previousMagnitude: number;
}

export type InputActionState = InputButtonState | InputAxisState | InputVector2State;

export type InputActionStateForDefinition<TDefinition extends InputActionDefinition> =
    TDefinition extends InputButtonActionDefinition
        ? InputButtonState
        : TDefinition extends InputAxisActionDefinition
          ? InputAxisState
          : InputVector2State;

export type InputActionValues<TSchema extends InputActionSchema> = {
    readonly [TAction in InputActionName<TSchema>]: InputActionValue<TSchema[TAction]>;
};

export type InputActionStates<TSchema extends InputActionSchema> = {
    readonly [TAction in InputActionName<TSchema>]: InputActionStateForDefinition<
        TSchema[TAction]
    >;
};

export interface InputKeyboardSourceEvent {
    readonly type: 'keyboard';
    readonly code: string;
    readonly pressed: boolean;
    readonly repeat?: boolean;
}

export interface InputMouseButtonSourceEvent {
    readonly type: 'mouse-button';
    readonly button: number;
    readonly pressed: boolean;
    readonly x?: number;
    readonly y?: number;
}

export interface InputMouseMoveSourceEvent {
    readonly type: 'mouse-move';
    readonly x: number;
    readonly y: number;
    readonly deltaX: number;
    readonly deltaY: number;
}

export interface InputMouseWheelSourceEvent {
    readonly type: 'mouse-wheel';
    readonly deltaX: number;
    readonly deltaY: number;
    readonly deltaZ?: number;
}

export interface InputTouchPoint {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly force?: number;
}

export interface InputTouchSourceEvent {
    readonly type: 'touch';
    readonly phase: 'start' | 'move' | 'end' | 'cancel';
    readonly touches: readonly InputTouchPoint[];
    readonly changed: readonly InputTouchPoint[];
}

export interface InputGamepadSnapshot {
    readonly index: number;
    readonly connected: boolean;
    readonly buttons: readonly number[];
    readonly axes: readonly number[];
}

export interface InputGamepadSourceEvent {
    readonly type: 'gamepad';
    readonly gamepads: readonly InputGamepadSnapshot[];
}

export interface InputFocusSourceEvent {
    readonly type: 'focus';
    readonly focused: boolean;
}

export type InputSourceEvent =
    | InputKeyboardSourceEvent
    | InputMouseButtonSourceEvent
    | InputMouseMoveSourceEvent
    | InputMouseWheelSourceEvent
    | InputTouchSourceEvent
    | InputGamepadSourceEvent
    | InputFocusSourceEvent;

export interface InputBindingReplaceRequest<
    TSchema extends InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> {
    readonly context: string | InputContextId;
    readonly action: TAction;
    readonly bindings: readonly InputBindingForAction<TSchema[TAction]>[];
}

export interface InputBindingControlPatchRequest<
    TSchema extends InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> {
    readonly context: string | InputContextId;
    readonly action: TAction;
    readonly index: number;
    readonly control: KnownInputControlPath | InputControlPath;
    readonly slot?: InputBindingSlot;
}

export type InputBindingMutationRequest<
    TSchema extends InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> =
    | InputBindingReplaceRequest<TSchema, TAction>
    | InputBindingControlPatchRequest<TSchema, TAction>;

export interface InputRebindingRequest<
    TSchema extends InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> {
    readonly context: string | InputContextId;
    readonly action: TAction;
    readonly index?: number;
    readonly slot?: InputBindingSlot;
    readonly timeoutMs?: number;
    readonly devices?: readonly InputDeviceKind[];
    readonly threshold?: number;
}

export type InputRebindingCancelReason =
    | 'manual'
    | 'timeout'
    | 'disposed'
    | 'replaced'
    | 'completed';

export interface InputRebindingCandidate {
    readonly control: InputControlPath;
    readonly device: InputDeviceKind;
    readonly timestamp: number;
}

export interface InputRebindingResult<
    TSchema extends InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> {
    readonly context: InputContextId;
    readonly action: TAction;
    readonly index: number;
    readonly slot: InputBindingSlot;
    readonly control: InputControlPath;
    readonly binding: InputBindingForAction<TSchema[TAction]>;
    readonly timestamp: number;
}

export interface InputRebindingHandlers<
    TSchema extends InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> {
    accept?(candidate: Readonly<InputRebindingCandidate>): boolean;
    complete?(result: Readonly<InputRebindingResult<TSchema, TAction>>): void;
    cancel?(reason: InputRebindingCancelReason): void;
}

export interface InputRebindingSession<
    TSchema extends InputActionSchema = InputActionSchema,
    TAction extends InputActionName<TSchema> = InputActionName<TSchema>,
> extends IDisposable {
    readonly request: Readonly<InputRebindingRequest<TSchema, TAction>>;
    readonly startedAtEpochMs: number;
}

export interface InputContextSnapshot<TSchema extends InputActionSchema = InputActionSchema> {
    readonly id: string;
    readonly priority: number;
    readonly enabled: boolean;
    readonly capture: InputContextCapture;
    readonly bindings: {
        readonly [TAction in InputActionName<TSchema>]?: readonly InputBindingForAction<
            TSchema[TAction]
        >[];
    };
}

export interface InputSystemSnapshot<TSchema extends InputActionSchema = InputActionSchema> {
    readonly version: 1;
    readonly locale: string;
    readonly capturedAtEpochMs: number;
    readonly contexts: readonly InputContextSnapshot<TSchema>[];
}

export interface InputRestoreOptions {
    readonly merge?: boolean;
}

export interface InputGamepadOptions {
    readonly enabled?: boolean;
    readonly autoPoll?: boolean;
    readonly provider?: Pick<Navigator, 'getGamepads'>;
}

export interface InputBrowserTarget {
    readonly window?: Window & typeof globalThis;
    readonly document?: Document;
    readonly element?: EventTarget;
    readonly capture?: boolean;
    readonly passive?: boolean;
    readonly preventDefault?: boolean;
}

export interface InputAttachment extends IDisposable {}

export interface InputSystemOptions<TSchema extends InputActionSchema> {
    readonly schema: TSchema;
    readonly contexts?: readonly InputContextDefinition<TSchema>[];
    readonly locale?: string;
    readonly gamepad?: InputGamepadOptions;
    readonly messageResolver?: InputMessageResolver;
    readonly now?: () => number;
}

export type InputValidationMessageCode =
    | `input.invalid-${'action' | 'binding' | 'context' | 'control-path' | 'priority' | 'rebind' | 'slot' | 'snapshot' | 'target'}`
    | 'input.context.conflict';

export type InputRuntimeMessageCode = 'input.disposed' | 'input.rebind.timeout';
export type InputMessageCode = InputValidationMessageCode | InputRuntimeMessageCode;

export type InputMessageDescriptor =
    | {
          readonly code: 'input.invalid-action';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-binding';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-context';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-control-path';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-priority';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-rebind';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-slot';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.invalid-snapshot';
          readonly reason: string;
      }
    | {
          readonly code: 'input.invalid-target';
          readonly value: unknown;
      }
    | {
          readonly code: 'input.context.conflict';
          readonly id: string;
      }
    | {
          readonly code: 'input.disposed';
      }
    | {
          readonly code: 'input.rebind.timeout';
          readonly action: string;
          readonly context: string;
      };

export type InputMessageResolver = (
    descriptor: Readonly<InputMessageDescriptor>,
    locale: string
) => string | undefined;
