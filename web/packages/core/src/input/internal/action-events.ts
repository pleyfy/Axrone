import { INPUT_ACTION_PHASE_MASK_ALL, INPUT_ACTION_PHASE_MASKS } from './shared';
import { InputConfigurationError } from '../errors';
import type {
    AxisStateStore,
    ButtonStateStore,
    InternalActionDefinition,
    InternalActionEventDescriptor,
    InternalActionListener,
    Vector2StateStore,
} from './shared';
import type {
    InputActionEvent,
    InputActionEventPhase,
    InputActionListener as PublicInputActionListener,
    InputActionName,
    InputActionSchema,
    InputActionState,
    InputActionStateForDefinition,
    InputActionSubscription,
    InputActionSubscriptionOptions,
    InputMessageDescriptor,
} from '../types';

export interface InputActionEventsRuntime<TSchema extends InputActionSchema = InputActionSchema> {
    _actionNames: readonly InputActionName<TSchema>[];
    _buttonStateStores: Array<ButtonStateStore | undefined>;
    _axisStateStores: Array<AxisStateStore | undefined>;
    _vectorStateStores: Array<Vector2StateStore | undefined>;
    _globalActionListeners: Set<InternalActionListener<TSchema>>;
    _scopedActionListeners: Array<Set<InternalActionListener<TSchema>> | undefined>;
    _actionListenerCount: number;
    _frame: number;
    _timestamp: number;
    _resolveMessage(descriptor: Readonly<InputMessageDescriptor>): string;
}

export const subscribeActionListener = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    actionIndex: number | undefined,
    listener: PublicInputActionListener<TSchema>,
    options: InputActionSubscriptionOptions
): InputActionSubscription => {
    if (typeof listener !== 'function') {
        throw new InputConfigurationError(
            'input.invalid-action',
            runtime._resolveMessage({
                code: 'input.invalid-action',
                value: listener,
            })
        );
    }

    const entry = Object.freeze({
        phases: actionEventPhaseMask(runtime, options.phases),
        listener: listener as PublicInputActionListener<TSchema, InputActionName<TSchema>>,
    });
    const bucket =
        typeof actionIndex === 'number'
            ? (runtime._scopedActionListeners[actionIndex] ??= new Set())
            : runtime._globalActionListeners;
    bucket.add(entry);
    runtime._actionListenerCount += 1;
    let disposed = false;

    return {
        get isDisposed(): boolean {
            return disposed;
        },
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;
            if (!bucket.delete(entry)) {
                return;
            }

            runtime._actionListenerCount = Math.max(0, runtime._actionListenerCount - 1);

            if (typeof actionIndex === 'number' && bucket.size === 0) {
                runtime._scopedActionListeners[actionIndex] = undefined;
            }
        },
    };
};

export const emitActionEvents = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    index: number,
    definition: InternalActionDefinition,
    descriptors: readonly InternalActionEventDescriptor[]
): void => {
    if (runtime._actionListenerCount === 0 || descriptors.length === 0) {
        return;
    }

    const scopedListeners = runtime._scopedActionListeners[index];
    if (!scopedListeners && runtime._globalActionListeners.size === 0) {
        return;
    }

    const listeners = scopedListeners
        ? [...runtime._globalActionListeners, ...scopedListeners]
        : [...runtime._globalActionListeners];
    const action = runtime._actionNames[index]!;
    let stateSnapshot: InputActionState | undefined;

    for (const descriptor of descriptors) {
        const phaseMask = INPUT_ACTION_PHASE_MASKS[descriptor.phase];
        let event: InputActionEvent<TSchema, InputActionName<TSchema>> | undefined;

        for (const entry of listeners) {
            if ((entry.phases & phaseMask) === 0) {
                continue;
            }

            event ??= Object.freeze({
                action,
                kind: definition.kind,
                phase: descriptor.phase,
                trigger: descriptor.trigger,
                frame: runtime._frame,
                timestamp: runtime._timestamp,
                context: descriptor.context,
                state:
                    (stateSnapshot ??= snapshotActionState(runtime, index, definition)) as InputActionStateForDefinition<
                        TSchema[InputActionName<TSchema>]
                    >,
            }) as InputActionEvent<TSchema, InputActionName<TSchema>>;
            entry.listener(event);
        }
    }
};

const actionEventPhaseMask = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    phases?: readonly InputActionEventPhase[]
): number => {
    if (!phases?.length) {
        return INPUT_ACTION_PHASE_MASK_ALL;
    }

    let mask = 0;

    for (const phase of phases) {
        const phaseMask = INPUT_ACTION_PHASE_MASKS[phase];

        if (!phaseMask) {
            throw new InputConfigurationError(
                'input.invalid-action',
                runtime._resolveMessage({
                    code: 'input.invalid-action',
                    value: phase,
                })
            );
        }

        mask |= phaseMask;
    }

    return mask;
};

const snapshotActionState = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    index: number,
    definition: InternalActionDefinition
): InputActionState => {
    switch (definition.kind) {
        case 'button': {
            const state = runtime._buttonStateStores[index]!;
            return Object.freeze({
                kind: 'button',
                value: state.value,
                previousValue: state.previousValue,
                rawValue: state.rawValue,
                previousRawValue: state.previousRawValue,
                pressed: state.pressed,
                released: state.released,
                heldDurationMs: state.heldDurationMs,
                tapSequenceCount: state.tapSequenceCount,
                repeatCount: state.repeatCount,
                holdTriggered: state.holdTriggered,
                tapTriggered: state.tapTriggered,
                multiTapTriggered: state.multiTapTriggered,
                repeatTriggered: state.repeatTriggered,
                active: state.active,
                changed: state.changed,
                frame: state.frame,
                timestamp: state.timestamp,
                context: state.context,
            });
        }
        case 'axis': {
            const state = runtime._axisStateStores[index]!;
            return Object.freeze({
                kind: 'axis',
                value: state.value,
                previousValue: state.previousValue,
                delta: state.delta,
                active: state.active,
                changed: state.changed,
                frame: state.frame,
                timestamp: state.timestamp,
                context: state.context,
            });
        }
        case 'vector2': {
            const state = runtime._vectorStateStores[index]!;
            return Object.freeze({
                kind: 'vector2',
                value: Object.freeze({
                    x: state.value.x,
                    y: state.value.y,
                }),
                previousValue: Object.freeze({
                    x: state.previousValue.x,
                    y: state.previousValue.y,
                }),
                delta: Object.freeze({
                    x: state.delta.x,
                    y: state.delta.y,
                }),
                magnitude: state.magnitude,
                previousMagnitude: state.previousMagnitude,
                active: state.active,
                changed: state.changed,
                frame: state.frame,
                timestamp: state.timestamp,
                context: state.context,
            });
        }
    }
};