import { EventEmitter } from '@axrone/event';
import { InputConfigurationError } from '../errors';
import type {
    AxisStateStore,
    ButtonStateStore,
    InternalActionDefinition,
    InternalActionEventDescriptor,
    Vector2StateStore,
} from './shared';
import type {
    InputActionEvent,
    InputActionEventActionChannel,
    InputActionEventAllChannel,
    InputActionEventEmitter,
    InputActionEventMap,
    InputActionEventPhase,
    InputActionEventPhaseChannel,
    InputActionListener as PublicInputActionListener,
    InputActionName,
    InputActionSchema,
    InputActionState,
    InputActionSubscription,
    InputActionSubscriptionOptions,
    InputMessageDescriptor,
} from '../types';

const INPUT_ACTION_ALL_CHANNEL = 'action:*' as const satisfies InputActionEventAllChannel;

export interface InputActionEventsRuntime<TSchema extends InputActionSchema = InputActionSchema> {
    _actionNames: readonly InputActionName<TSchema>[];
    _buttonStateStores: Array<ButtonStateStore | undefined>;
    _axisStateStores: Array<AxisStateStore | undefined>;
    _vectorStateStores: Array<Vector2StateStore | undefined>;
    _actionEvents: InputActionEventEmitter<TSchema>;
    _frame: number;
    _timestamp: number;
    _resolveMessage(descriptor: Readonly<InputMessageDescriptor>): string;
}

export const createActionEventEmitter = <TSchema extends InputActionSchema>(): InputActionEventEmitter<TSchema> =>
    new EventEmitter<InputActionEventMap<TSchema>>({
        maxListeners: Infinity,
    });

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

    const phaseFilter = normalizePhaseFilter(runtime, options.phases);
    const callback =
        phaseFilter.size === 0
            ? (listener as PublicInputActionListener<TSchema, InputActionName<TSchema>>)
            : ((event: InputActionEvent<TSchema, InputActionName<TSchema>>) => {
                  if (phaseFilter.has(event.phase)) {
                      listener(event);
                  }
              });
    const channels =
        typeof actionIndex === 'number'
            ? [toActionChannel(runtime._actionNames[actionIndex]!)]
            : phaseFilter.size > 0
              ? [...phaseFilter].map((phase) => toPhaseChannel(phase))
              : [INPUT_ACTION_ALL_CHANNEL];
    const unsubscribers = channels.map((channel) => subscribeToChannel(runtime, channel, callback));
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

            for (const unsubscribe of unsubscribers) {
                unsubscribe();
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
    if (descriptors.length === 0 || runtime._actionEvents.listenerCountAll() === 0) {
        return;
    }

    const actionChannel = toActionChannel(runtime._actionNames[index]!);
    const hasAll = runtime._actionEvents.has(INPUT_ACTION_ALL_CHANNEL);
    const hasAction = runtime._actionEvents.has(actionChannel);
    let stateSnapshot: InputActionState | undefined;

    for (const descriptor of descriptors) {
        const phaseChannel = toPhaseChannel(descriptor.phase);
        const hasPhase = runtime._actionEvents.has(phaseChannel);

        if (!hasAll && !hasAction && !hasPhase) {
            continue;
        }

        const event = Object.freeze({
            action: runtime._actionNames[index]!,
            kind: definition.kind,
            phase: descriptor.phase,
            trigger: descriptor.trigger,
            frame: runtime._frame,
            timestamp: runtime._timestamp,
            context: descriptor.context,
            state: (stateSnapshot ??= snapshotActionState(runtime, index, definition)),
        }) as InputActionEvent<TSchema>;

        if (hasAll) {
            emitToChannel(runtime, INPUT_ACTION_ALL_CHANNEL, event);
        }

        if (hasAction) {
            emitToChannel(runtime, actionChannel, event);
        }

        if (hasPhase) {
            emitToChannel(runtime, phaseChannel, event);
        }
    }
};

const normalizePhaseFilter = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    phases?: readonly InputActionEventPhase[]
): ReadonlySet<InputActionEventPhase> => {
    if (!phases?.length) {
        return new Set();
    }

    const unique = new Set<InputActionEventPhase>();

    for (const phase of phases) {
        if (
            phase !== 'started' &&
            phase !== 'performed' &&
            phase !== 'changed' &&
            phase !== 'canceled'
        ) {
            throw new InputConfigurationError(
                'input.invalid-action',
                runtime._resolveMessage({
                    code: 'input.invalid-action',
                    value: phase,
                })
            );
        }

        unique.add(phase);
    }

    return unique;
};

const toActionChannel = <TSchema extends InputActionSchema>(
    action: InputActionName<TSchema>
): InputActionEventActionChannel<TSchema> => `action:${action}` as InputActionEventActionChannel<TSchema>;

const toPhaseChannel = <TPhase extends InputActionEventPhase>(
    phase: TPhase
): InputActionEventPhaseChannel<TPhase> => `phase:${phase}` as InputActionEventPhaseChannel<TPhase>;

const subscribeToChannel = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    channel: Extract<keyof InputActionEventMap<TSchema>, string>,
    callback: (event: InputActionEvent<TSchema>) => void
) => runtime._actionEvents.on(channel, callback);

const emitToChannel = <TSchema extends InputActionSchema>(
    runtime: InputActionEventsRuntime<TSchema>,
    channel: Extract<keyof InputActionEventMap<TSchema>, string>,
    event: InputActionEvent<TSchema>
): void => {
    runtime._actionEvents.emitSync(channel, event);
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
