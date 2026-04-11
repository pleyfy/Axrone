import {
    applyDeadzone,
    applyScalarProcessors,
    applyVectorProcessors,
    clamp,
    EPSILON,
    magnitude,
} from './shared';
import { isButtonInteractionInterrupted } from './evaluator';
import type {
    AxisStateStore,
    ButtonStateStore,
    InternalActionDefinition,
    InternalActionEventDescriptor,
    Vector2StateStore,
} from './shared';
import type { InputActionSchema, InputContextId } from '../types';
import type { InputEvaluationRuntime } from './evaluator';

export interface InputCommitRuntime<TSchema extends InputActionSchema = InputActionSchema>
    extends InputEvaluationRuntime<TSchema> {
    _buttonStateStores: Array<ButtonStateStore | undefined>;
    _axisStateStores: Array<AxisStateStore | undefined>;
    _vectorStateStores: Array<Vector2StateStore | undefined>;
    _frame: number;
    _timestamp: number;
    _hasActionEventListeners(): boolean;
    _emitActionEvents(
        index: number,
        definition: InternalActionDefinition,
        descriptors: readonly InternalActionEventDescriptor[]
    ): void;
}

export const commitButtonState = <TSchema extends InputActionSchema>(
    runtime: InputCommitRuntime<TSchema>,
    index: number,
    definition: Extract<InternalActionDefinition, { kind: 'button' }>
): void => {
    const state = runtime._buttonStateStores[index]!;
    const previousValue = state.value;
    const previousRawValue = state.rawValue;
    const previousContext = state.context;
    const previousTapSequenceCount = state.tapSequenceCount;
    const previousRepeatCount = state.repeatCount;
    const rawValue = applyScalarProcessors(runtime._accumulatorX[index]!, definition.processors);
    const nextValue = previousValue
        ? rawValue > definition.releasePoint + EPSILON
        : rawValue >= definition.pressPoint - EPSILON;
    const pressed = !previousValue && nextValue;
    const released = previousValue && !nextValue;
    const interactions = definition.interactions;
    const multiTap = interactions.multiTap;
    let heldDurationMs = 0;
    let tapSequenceCount = state.tapSequenceCount;
    let repeatCount = state.repeatCount;
    let holdTriggered = false;
    let tapTriggered = false;
    let multiTapTriggered = false;
    let repeatTriggered = false;

    if (tapSequenceCount > 0) {
        const maxDelayMs = multiTap?.maxDelayMs ?? 0;
        if (
            typeof state.lastTapTimestamp !== 'number' ||
            maxDelayMs <= 0 ||
            runtime._timestamp - state.lastTapTimestamp > maxDelayMs + EPSILON
        ) {
            tapSequenceCount = 0;
            state.lastTapTimestamp = undefined;
        }
    }

    if (pressed) {
        state.pressStartedAt = runtime._timestamp;
        state.holdConsumed = false;
        repeatCount = 0;
        state.nextRepeatAt =
            interactions.repeat
                ? runtime._timestamp + interactions.repeat.delayMs
                : undefined;
    }

    if (nextValue) {
        const pressStartedAt = state.pressStartedAt ?? runtime._timestamp;
        const hold = interactions.hold;
        const repeat = interactions.repeat;
        state.pressStartedAt = pressStartedAt;
        heldDurationMs = Math.max(0, runtime._timestamp - pressStartedAt);

        if (hold && heldDurationMs + EPSILON >= hold.durationMs) {
            if (hold.continuous) {
                holdTriggered = true;
            } else if (!state.holdConsumed) {
                holdTriggered = true;
                state.holdConsumed = true;
            }
        }

        if (repeat) {
            const nextRepeatAt = state.nextRepeatAt ?? pressStartedAt + repeat.delayMs;
            if (runtime._timestamp + EPSILON >= nextRepeatAt) {
                const emittedCount =
                    1 + Math.floor(Math.max(0, runtime._timestamp - nextRepeatAt) / repeat.intervalMs);
                repeatTriggered = emittedCount > 0;
                repeatCount += emittedCount;
                state.nextRepeatAt = nextRepeatAt + emittedCount * repeat.intervalMs;
            } else {
                state.nextRepeatAt = nextRepeatAt;
            }
        } else {
            repeatCount = 0;
            state.nextRepeatAt = undefined;
        }
    } else if (released) {
        const pressStartedAt = state.pressStartedAt ?? runtime._timestamp;
        const interrupted = isButtonInteractionInterrupted(
            runtime,
            index,
            previousContext as InputContextId | undefined
        );
        heldDurationMs = Math.max(0, runtime._timestamp - pressStartedAt);
        state.pressStartedAt = undefined;
        state.holdConsumed = false;
        state.nextRepeatAt = undefined;

        if (interrupted) {
            tapSequenceCount = 0;
            state.lastTapTimestamp = undefined;
        } else {
            if (interactions.tap && heldDurationMs <= interactions.tap.maxDurationMs + EPSILON) {
                tapTriggered = true;
            }

            if (multiTap && heldDurationMs <= multiTap.maxDurationMs + EPSILON) {
                const withinDelay =
                    typeof state.lastTapTimestamp === 'number' &&
                    runtime._timestamp - state.lastTapTimestamp <= multiTap.maxDelayMs + EPSILON;
                tapSequenceCount = withinDelay ? tapSequenceCount + 1 : 1;
                state.lastTapTimestamp = runtime._timestamp;

                if (tapSequenceCount >= multiTap.tapCount) {
                    tapSequenceCount = multiTap.tapCount;
                    multiTapTriggered = true;
                    state.lastTapTimestamp = undefined;
                }
            } else if (!multiTap && tapTriggered) {
                tapSequenceCount = 1;
                state.lastTapTimestamp = runtime._timestamp;
            } else if (multiTap) {
                tapSequenceCount = 0;
                state.lastTapTimestamp = undefined;
            }
        }
    } else {
        repeatCount = 0;
        state.nextRepeatAt = undefined;

        if (tapSequenceCount > 0 && !multiTap) {
            tapSequenceCount = 0;
            state.lastTapTimestamp = undefined;
        }
    }

    state.previousValue = previousValue;
    state.previousRawValue = previousRawValue;
    state.value = nextValue;
    state.rawValue = rawValue;
    state.pressed = pressed;
    state.released = released;
    state.heldDurationMs = heldDurationMs;
    state.tapSequenceCount = tapSequenceCount;
    state.repeatCount = repeatCount;
    state.holdTriggered = holdTriggered;
    state.tapTriggered = tapTriggered;
    state.multiTapTriggered = multiTapTriggered;
    state.repeatTriggered = repeatTriggered;
    state.active = nextValue;
    state.changed =
        pressed ||
        released ||
        holdTriggered ||
        tapTriggered ||
        multiTapTriggered ||
        repeatTriggered ||
        tapSequenceCount !== previousTapSequenceCount ||
        repeatCount !== previousRepeatCount ||
        Math.abs(rawValue - previousRawValue) > EPSILON;
    state.frame = runtime._frame;
    state.timestamp = runtime._timestamp;
    state.context = runtime._sourceContexts[index];

    if (runtime._hasActionEventListeners()) {
        const context = state.context;
        const terminalContext = context ?? previousContext;
        const descriptors: InternalActionEventDescriptor[] = [];

        if (pressed) {
            descriptors.push({
                phase: 'started',
                trigger: 'press',
                context,
            });
            descriptors.push({
                phase: 'performed',
                trigger: 'press',
                context,
            });
        }

        if (holdTriggered) {
            descriptors.push({
                phase: 'performed',
                trigger: 'hold',
                context,
            });
        }

        if (tapTriggered) {
            descriptors.push({
                phase: 'performed',
                trigger: 'tap',
                context: terminalContext,
            });
        }

        if (multiTapTriggered) {
            descriptors.push({
                phase: 'performed',
                trigger: 'multi-tap',
                context: terminalContext,
            });
        }

        if (repeatTriggered) {
            descriptors.push({
                phase: 'performed',
                trigger: 'repeat',
                context,
            });
        }

        if (state.changed) {
            descriptors.push({
                phase: 'changed',
                trigger: 'change',
                context: nextValue ? context : terminalContext,
            });
        }

        if (released) {
            descriptors.push({
                phase: 'canceled',
                trigger: 'release',
                context: terminalContext,
            });
        }

        runtime._emitActionEvents(index, definition, descriptors);
    }
};

export const commitAxisState = <TSchema extends InputActionSchema>(
    runtime: InputCommitRuntime<TSchema>,
    index: number,
    definition: Extract<InternalActionDefinition, { kind: 'axis' }>
): void => {
    const state = runtime._axisStateStores[index]!;
    const previousActive = state.active;
    const previousContext = state.context;
    const previousValue = state.value;
    const unclamped = applyDeadzone(runtime._accumulatorX[index]!, definition.deadzone);
    const value = applyScalarProcessors(
        clamp(unclamped, definition.min, definition.max),
        definition.processors
    );

    state.previousValue = previousValue;
    state.value = value;
    state.delta = value - previousValue;
    state.active = Math.abs(value) > EPSILON;
    state.changed = Math.abs(state.delta) > EPSILON;
    state.frame = runtime._frame;
    state.timestamp = runtime._timestamp;
    state.context = runtime._sourceContexts[index];

    if (runtime._hasActionEventListeners()) {
        const context = state.context;
        const terminalContext = context ?? previousContext;
        const descriptors: InternalActionEventDescriptor[] = [];

        if (!previousActive && state.active) {
            descriptors.push({
                phase: 'started',
                trigger: 'activate',
                context,
            });
        }

        if (state.active && state.changed) {
            descriptors.push({
                phase: 'performed',
                trigger: 'change',
                context,
            });
        }

        if (state.changed) {
            descriptors.push({
                phase: 'changed',
                trigger: 'change',
                context: state.active ? context : terminalContext,
            });
        }

        if (previousActive && !state.active) {
            descriptors.push({
                phase: 'canceled',
                trigger: 'deactivate',
                context: terminalContext,
            });
        }

        runtime._emitActionEvents(index, definition, descriptors);
    }
};

export const commitVectorState = <TSchema extends InputActionSchema>(
    runtime: InputCommitRuntime<TSchema>,
    index: number,
    definition: Extract<InternalActionDefinition, { kind: 'vector2' }>
): void => {
    const state = runtime._vectorStateStores[index]!;
    const previousActive = state.active;
    const previousContext = state.context;
    let x = runtime._accumulatorX[index]!;
    let y = runtime._accumulatorY[index]!;
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

    if (definition.processors.length > 0) {
        const processed = applyVectorProcessors({ x, y }, definition.processors);
        x = processed.x;
        y = processed.y;
        length = magnitude(x, y);
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
    state.frame = runtime._frame;
    state.timestamp = runtime._timestamp;
    state.context = runtime._sourceContexts[index];

    if (runtime._hasActionEventListeners()) {
        const context = state.context;
        const terminalContext = context ?? previousContext;
        const descriptors: InternalActionEventDescriptor[] = [];

        if (!previousActive && state.active) {
            descriptors.push({
                phase: 'started',
                trigger: 'activate',
                context,
            });
        }

        if (state.active && state.changed) {
            descriptors.push({
                phase: 'performed',
                trigger: 'change',
                context,
            });
        }

        if (state.changed) {
            descriptors.push({
                phase: 'changed',
                trigger: 'change',
                context: state.active ? context : terminalContext,
            });
        }

        if (previousActive && !state.active) {
            descriptors.push({
                phase: 'canceled',
                trigger: 'deactivate',
                context: terminalContext,
            });
        }

        runtime._emitActionEvents(index, definition, descriptors);
    }
};
