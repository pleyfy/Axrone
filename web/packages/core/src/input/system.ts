import {
    InputConfigurationError,
    InputContextError,
    InputDisposedError,
    resolveInputMessage,
} from './errors';
import { normalizeInputContextId, normalizeInputControlPath } from './reference';
import { attachInputBrowserTarget } from './internal/attachment';
import { createInputCompiler } from './internal/compiler';
import {
    collectActionInputs,
    isButtonInteractionInterrupted,
} from './internal/evaluator';
import {
    emitActionEvents,
    subscribeActionListener,
} from './internal/action-events';
import {
    captureGamepadCandidate,
    clearDeviceState,
    clearTransients,
    handleFocusEvent,
    handleKeyboardEvent,
    handleMouseButtonEvent,
    handleMouseMoveEvent,
    handleMouseWheelEvent,
    handleTouchEvent,
    ingestGamepadSnapshots,
    pollGamepads,
} from './internal/source-state';
import {
    applyBindingMutation,
    beginRebindingSession,
    cancelRebindingSession,
    captureRebindingCandidate,
    createInputSnapshot,
    expireRebindingSessionIfNeeded,
    restoreInputSnapshot,
} from './internal/rebinding';
import {
    commitAxisState,
    commitButtonState,
    commitVectorState,
} from './internal/state-commit';
import {
    applyDeadzone,
    applyScalarProcessors,
    applyVectorProcessors,
    clamp,
    createAxisStateStore,
    createAxisStateView,
    createButtonStateStore,
    createButtonStateView,
    createVector2StateStore,
    createVector2StateView,
    EPSILON,
    isEventTargetLike,
    isInputSystemSnapshot,
    isRecord,
    magnitude,
    normalizeLocale,
} from './internal/shared';
import type {
    ActiveRebinding,
    AxisStateStore,
    ButtonStateStore,
    InternalActionDefinition,
    InternalActionEventDescriptor,
    InternalActionListener,
    InternalContext,
    InternalContextAction,
    MutableGamepadState,
    MutableTouchPoint,
    Vector2StateStore,
} from './internal/shared';
import type { InputCompiler } from './internal/compiler';
import type { InputActionEventsRuntime } from './internal/action-events';
import type { InputEvaluationRuntime } from './internal/evaluator';
import type { InputRebindingRuntime } from './internal/rebinding';
import type { InputSourceRuntime } from './internal/source-state';
import type { InputCommitRuntime } from './internal/state-commit';
import type {
    InputActionDefinition,
    InputActionListener,
    InputActionName,
    InputActionSchema,
    InputActionState,
    InputActionStateForDefinition,
    InputActionSubscription,
    InputActionSubscriptionOptions,
    InputAttachment,
    InputAxisActionDefinition,
    InputAxisState,
    InputBinding,
    InputBindingForAction,
    InputBindingMutationRequest,
    InputBindingSlot,
    InputBrowserTarget,
    InputButtonActionDefinition,
    InputButtonState,
    InputContextCapture,
    InputContextDefinition,
    InputContextId,
    InputContextState,
    InputControlPath,
    InputDeviceKind,
    InputFocusSourceEvent,
    InputGamepadOptions,
    InputGamepadSnapshot,
    InputMessageDescriptor,
    InputMessageResolver,
    InputMouseButtonSourceEvent,
    InputMouseMoveSourceEvent,
    InputMouseWheelSourceEvent,
    InputProcessor,
    InputRebindingHandlers,
    InputRebindingRequest,
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
    private readonly _compiler: InputCompiler<TSchema>;
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
    private readonly _globalActionListeners = new Set<InternalActionListener<TSchema>>();
    private readonly _scopedActionListeners: Array<Set<InternalActionListener<TSchema>> | undefined>;
    private _actionListenerCount = 0;
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
        this._compiler = createInputCompiler({
            getActionKind: (action) => this._actionDefinitions[this._requireActionIndex(action)]!.kind,
            requireControlPath: (value) => this._requireControlPath(value),
            resolveMessage: (descriptor) => this._resolveMessage(descriptor),
        });
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

            const definition = this._compiler.normalizeActionDefinition(name, rawDefinition);
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
        this._scopedActionListeners = new Array(actionDefinitions.length);

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
        pollGamepads(this as unknown as InputSourceRuntime<TSchema>);
        this._frame += 1;
        this._evaluate();
        clearTransients(this as unknown as InputSourceRuntime<TSchema>);
        return this._frame;
    }

    dispatch(event: Readonly<InputSourceEvent>): void {
        this._assertNotDisposed();

        switch (event.type) {
            case 'keyboard':
                handleKeyboardEvent(this as unknown as InputSourceRuntime<TSchema>, event);
                break;
            case 'mouse-button':
                handleMouseButtonEvent(this as unknown as InputSourceRuntime<TSchema>, event);
                break;
            case 'mouse-move':
                handleMouseMoveEvent(this as unknown as InputSourceRuntime<TSchema>, event);
                break;
            case 'mouse-wheel':
                handleMouseWheelEvent(this as unknown as InputSourceRuntime<TSchema>, event);
                break;
            case 'touch':
                handleTouchEvent(this as unknown as InputSourceRuntime<TSchema>, event);
                break;
            case 'gamepad':
                ingestGamepadSnapshots(this as unknown as InputSourceRuntime<TSchema>, event.gamepads);
                captureGamepadCandidate(this as unknown as InputSourceRuntime<TSchema>, this._timestamp);
                break;
            case 'focus':
                handleFocusEvent(this as unknown as InputSourceRuntime<TSchema>, event);
                break;
        }
    }

    attach(target: InputBrowserTarget = {}): InputAttachment {
        this._assertNotDisposed();
        const attachedTarget = attachInputBrowserTarget(
            {
                dispatch: (event) => {
                    this.dispatch(event);
                },
                getMousePosition: () => ({
                    x: this._mouseX,
                    y: this._mouseY,
                }),
                resolveMessage: (descriptor) => this._resolveMessage(descriptor),
            },
            target
        );

        const attachment: InputAttachment = {
            get isDisposed(): boolean {
                return attachedTarget.isDisposed;
            },
            dispose: () => {
                if (attachedTarget.isDisposed) {
                    return;
                }

                attachedTarget.dispose();
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
                actionEntry.compiled = this._compiler.compileBindings(actionEntry.current);
            }
            return;
        }

        const actionEntry = this._requireContextAction(context, action);
        actionEntry.current = actionEntry.defaults;
        actionEntry.compiled = this._compiler.compileBindings(actionEntry.current);
    }

    rebind<TAction extends InputActionName<TSchema>>(
        request: Readonly<InputBindingMutationRequest<TSchema, TAction>>
    ): readonly InputBindingForAction<TSchema[TAction]>[] {
        this._assertNotDisposed();
        return applyBindingMutation(this as unknown as InputRebindingRuntime<TSchema>, request);
    }

    beginRebinding<TAction extends InputActionName<TSchema>>(
        request: Readonly<InputRebindingRequest<TSchema, TAction>>,
        handlers?: InputRebindingHandlers<TSchema, TAction>
    ): InputRebindingSession<TSchema, TAction> {
        this._assertNotDisposed();
        return beginRebindingSession(
            this as unknown as InputRebindingRuntime<TSchema>,
            request,
            handlers
        );
    }

    snapshot(): InputSystemSnapshot<TSchema> {
        this._assertNotDisposed();
        return createInputSnapshot(this as unknown as InputRebindingRuntime<TSchema>);
    }

    restore(snapshot: Readonly<InputSystemSnapshot<TSchema>>, options: InputRestoreOptions = {}): void {
        this._assertNotDisposed();
        restoreInputSnapshot(
            this as unknown as InputRebindingRuntime<TSchema>,
            snapshot,
            options,
            isInputSystemSnapshot
        );
    }

    subscribe(
        listener: InputActionListener<TSchema>,
        options: InputActionSubscriptionOptions = {}
    ): InputActionSubscription {
        this._assertNotDisposed();
        return subscribeActionListener(
            this as unknown as InputActionEventsRuntime<TSchema>,
            undefined,
            listener,
            options
        );
    }

    subscribeAction<TAction extends InputActionName<TSchema>>(
        action: TAction,
        listener: InputActionListener<TSchema, TAction>,
        options: InputActionSubscriptionOptions = {}
    ): InputActionSubscription {
        this._assertNotDisposed();
        return subscribeActionListener(
            this as unknown as InputActionEventsRuntime<TSchema>,
            this._requireActionIndex(action),
            listener as InputActionListener<TSchema>,
            options
        );
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
        this._globalActionListeners.clear();
        this._scopedActionListeners.fill(undefined);
        this._actionListenerCount = 0;
        this._contexts.clear();
        this._consumedPaths.clear();
        clearDeviceState(this as unknown as InputSourceRuntime<TSchema>, true);
        this._gamepads.clear();
    }

    private _emitActionEvents(
        index: number,
        definition: InternalActionDefinition,
        descriptors: readonly InternalActionEventDescriptor[]
    ): void {
        emitActionEvents(
            this as unknown as InputActionEventsRuntime<TSchema>,
            index,
            definition,
            descriptors
        );
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
            const normalizedBindings = this._compiler.normalizeBindingList(rawAction, rawBindings);
            actions.set(actionIndex, {
                action: rawAction,
                current: normalizedBindings,
                defaults: normalizedBindings,
                compiled: this._compiler.compileBindings(normalizedBindings),
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

    private _captureRebinding(
        control: InputControlPath,
        device: InputDeviceKind,
        timestamp: number,
        magnitudeValue = 1
    ): void {
        captureRebindingCandidate(
            this as unknown as InputRebindingRuntime<TSchema>,
            control,
            device,
            timestamp,
            magnitudeValue
        );
    }

    private _cancelRebinding(reason: 'manual' | 'timeout' | 'disposed' | 'replaced' | 'completed'): void {
        cancelRebindingSession(this as unknown as InputRebindingRuntime<TSchema>, reason);
    }

    private _expireRebindingIfNeeded(now: number): void {
        expireRebindingSessionIfNeeded(this as unknown as InputRebindingRuntime<TSchema>, now);
    }

    private _evaluate(): void {
        collectActionInputs(this as unknown as InputEvaluationRuntime<TSchema>);

        for (let index = 0; index < this._actionDefinitions.length; index += 1) {
            const definition = this._actionDefinitions[index]!;

            switch (definition.kind) {
                case 'button':
                    commitButtonState(this as unknown as InputCommitRuntime<TSchema>, index, definition);
                    break;
                case 'axis':
                    commitAxisState(this as unknown as InputCommitRuntime<TSchema>, index, definition);
                    break;
                case 'vector2':
                    commitVectorState(this as unknown as InputCommitRuntime<TSchema>, index, definition);
                    break;
            }
        }
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

        const normalized = this._compiler.normalizeBindingList(action, []);
        const created: InternalContextAction<TSchema> = {
            action,
            current: normalized,
            defaults: normalized,
            compiled: this._compiler.compileBindings(normalized),
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
