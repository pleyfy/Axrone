import {
    applyDeadzone,
    applyScalarProcessors,
    applyVectorProcessors,
    EPSILON,
    GAMEPAD_ANY,
    magnitude,
    MODIFIER_MASKS,
    TOUCH_ANY,
    TOUCH_PRIMARY,
} from './shared';
import type {
    InternalActionDefinition,
    InternalAxisCompositeBinding,
    InternalBinding,
    InternalBindingBase,
    InternalContext,
    InternalControl,
    InternalInputUser,
    InternalControlBinding,
    InternalDirectionalBinding,
    InternalDualAxisBinding,
    MutableGamepadState,
    MutableTouchPoint,
    MutableVector2,
} from './shared';
import type { InputActionSchema, InputContextId, InputControlPath, InputUserId } from '../types';

export interface InputEvaluationRuntime<TSchema extends InputActionSchema = InputActionSchema> {
    _actionDefinitions: readonly InternalActionDefinition[];
    _contexts: Map<string, InternalContext<TSchema>>;
    _users: Map<string, InternalInputUser>;
    _keysDown: Set<string>;
    _touches: Map<number, MutableTouchPoint>;
    _gamepads: Map<number, MutableGamepadState>;
    _gamepadOwners: Map<number, InputUserId>;
    _consumedPaths: Set<InputControlPath>;
    _accumulatorX: Float64Array;
    _accumulatorY: Float64Array;
    _assigned: Uint8Array;
    _sourceContexts: Array<InputContextId | undefined>;
    _mouseButtons: number;
    _mouseX: number;
    _mouseY: number;
    _mouseDeltaX: number;
    _mouseDeltaY: number;
    _mouseWheelX: number;
    _mouseWheelY: number;
    _mouseWheelZ: number;
    _touchPinchDelta: number;
    _primaryTouchId: number | undefined;
    _getOrderedContexts(): readonly InternalContext<TSchema>[];
}

export const collectActionInputs = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>
): void => {
    runtime._accumulatorX.fill(0);
    runtime._accumulatorY.fill(0);
    runtime._assigned.fill(0);
    runtime._sourceContexts.fill(undefined);
    runtime._consumedPaths.clear();

    for (const context of runtime._getOrderedContexts()) {
        if (!context.enabled) {
            continue;
        }

        for (const [actionIndex, actionEntry] of context.actions) {
            const definition = runtime._actionDefinitions[actionIndex]!;

            if (definition.kind === 'vector2') {
                evaluateVectorAction(runtime, actionIndex, definition, context, actionEntry.compiled);
                continue;
            }

            evaluateScalarAction(runtime, actionIndex, definition, context, actionEntry.compiled);
        }
    }
};

export const isButtonInteractionInterrupted = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    actionIndex: number,
    previousContext: InputContextId | undefined
): boolean => {
    if (!previousContext) {
        return false;
    }

    const context = runtime._contexts.get(previousContext);

    if (!context) {
        return true;
    }

    const action = context.actions.get(actionIndex);

    if (!action) {
        return true;
    }

    for (const binding of action.compiled) {
        if (binding.type !== 'control' && binding.type !== 'axis') {
            continue;
        }

        const value =
            binding.type === 'control'
                ? evaluateControlBinding(runtime, binding, context.user)
                : evaluateAxisCompositeBinding(runtime, binding, context.user);

        if (Math.abs(value) > EPSILON) {
            return true;
        }
    }

    return false;
};

const evaluateScalarAction = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    actionIndex: number,
    definition: Extract<InternalActionDefinition, { kind: 'button' | 'axis' }>,
    context: InternalContext<TSchema>,
    bindings: readonly InternalBinding[]
): void => {
    for (const binding of bindings) {
        if (binding.type !== 'control' && binding.type !== 'axis') {
            continue;
        }

        if (!matchesModifiers(runtime, binding) || isBindingConsumed(runtime, binding)) {
            continue;
        }

        const value =
            binding.type === 'control'
                ? evaluateControlBinding(runtime, binding, context.user)
                : evaluateAxisCompositeBinding(runtime, binding, context.user);

        if (Math.abs(value) <= EPSILON) {
            continue;
        }

        if (!runtime._sourceContexts[actionIndex]) {
            runtime._sourceContexts[actionIndex] = context.id;
        }

        if (definition.kind === 'button') {
            runtime._accumulatorX[actionIndex] = Math.max(
                runtime._accumulatorX[actionIndex]!,
                Math.abs(value)
            );
        } else if (definition.combine === 'latest') {
            if (runtime._assigned[actionIndex] === 0) {
                runtime._assigned[actionIndex] = 1;
                runtime._accumulatorX[actionIndex] = value;
            }
        } else if (definition.combine === 'max-abs') {
            if (Math.abs(value) > Math.abs(runtime._accumulatorX[actionIndex]!)) {
                runtime._accumulatorX[actionIndex] = value;
            }
        } else {
            runtime._accumulatorX[actionIndex] += value;
        }

        if (context.capture === 'used' || definition.consume || binding.consume) {
            consumeBinding(runtime, binding);
        }
    }
};

const evaluateVectorAction = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    actionIndex: number,
    definition: Extract<InternalActionDefinition, { kind: 'vector2' }>,
    context: InternalContext<TSchema>,
    bindings: readonly InternalBinding[]
): void => {
    for (const binding of bindings) {
        if (binding.type !== 'vector2' && binding.type !== 'dual-axis') {
            continue;
        }

        if (!matchesModifiers(runtime, binding) || isBindingConsumed(runtime, binding)) {
            continue;
        }

        const vector =
            binding.type === 'vector2'
                ? evaluateDirectionalBinding(runtime, binding, context.user)
                : evaluateDualAxisBinding(runtime, binding, context.user);

        if (Math.abs(vector.x) <= EPSILON && Math.abs(vector.y) <= EPSILON) {
            continue;
        }

        if (!runtime._sourceContexts[actionIndex]) {
            runtime._sourceContexts[actionIndex] = context.id;
        }

        if (definition.combine === 'latest') {
            if (runtime._assigned[actionIndex] === 0) {
                runtime._assigned[actionIndex] = 1;
                runtime._accumulatorX[actionIndex] = vector.x;
                runtime._accumulatorY[actionIndex] = vector.y;
            }
        } else {
            runtime._accumulatorX[actionIndex] += vector.x;
            runtime._accumulatorY[actionIndex] += vector.y;
        }

        if (context.capture === 'used' || definition.consume || binding.consume) {
            consumeBinding(runtime, binding);
        }
    }
};

const evaluateControlBinding = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalControlBinding,
    user?: InputUserId
): number => {
    let value = sampleControl(runtime, binding.control, user);

    if (binding.invert) {
        value = -value;
    }

    value = applyDeadzone(value, binding.deadzone);
    return applyScalarProcessors(value * binding.scale, binding.processors);
};

const evaluateAxisCompositeBinding = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalAxisCompositeBinding,
    user?: InputUserId
): number => {
    const positive = sampleDirectional(runtime, binding.positive, 'positive', user);
    const negative = sampleDirectional(runtime, binding.negative, 'negative', user);
    return applyScalarProcessors((positive - negative) * binding.scale, binding.processors);
};

const evaluateDirectionalBinding = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalDirectionalBinding,
    user?: InputUserId
): MutableVector2 => {
    let x =
        sampleDirectional(runtime, binding.right, 'positive', user) -
        sampleDirectional(runtime, binding.left, 'negative', user);
    let y =
        sampleDirectional(runtime, binding.up, 'positive', user) -
        sampleDirectional(runtime, binding.down, 'negative', user);

    x *= binding.scale;
    y *= binding.scale;

    if (binding.normalize) {
        const length = magnitude(x, y);
        if (length > 1) {
            x /= length;
            y /= length;
        }
    }

    return applyVectorProcessors(
        {
            x,
            y,
        },
        binding.processors
    );
};

const evaluateDualAxisBinding = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalDualAxisBinding,
    user?: InputUserId
): MutableVector2 => {
    let x = sampleControl(runtime, binding.x, user) * binding.scale;
    let y = sampleControl(runtime, binding.y, user) * binding.scale;
    const length = magnitude(x, y);

    if (length <= binding.deadzone) {
        x = 0;
        y = 0;
    } else if (binding.normalize && length > 1) {
        x /= length;
        y /= length;
    }

    return applyVectorProcessors(
        {
            x,
            y,
        },
        binding.processors
    );
};

const sampleControl = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    control: InternalControl,
    user?: InputUserId
): number => {
    if (!canAccessControl(runtime, control, user)) {
        return 0;
    }

    switch (control.device) {
        case 'keyboard':
            return runtime._keysDown.has(control.code) ? 1 : 0;
        case 'mouse':
            switch (control.kind) {
                case 'button':
                    return (runtime._mouseButtons & (1 << control.button)) !== 0 ? 1 : 0;
                case 'move':
                    return control.axis === 'x' ? runtime._mouseDeltaX : runtime._mouseDeltaY;
                case 'wheel':
                    if (control.axis === 'x') {
                        return runtime._mouseWheelX;
                    }

                    if (control.axis === 'y') {
                        return runtime._mouseWheelY;
                    }

                    return runtime._mouseWheelZ;
                case 'position':
                    return control.axis === 'x' ? runtime._mouseX : runtime._mouseY;
            }
            return 0;
        case 'touch':
            switch (control.kind) {
                case 'contact':
                    if (control.target === TOUCH_ANY) {
                        return runtime._touches.size > 0 ? 1 : 0;
                    }
                    return resolveTouch(runtime, control.target) ? 1 : 0;
                case 'position': {
                    const touch = resolveTouch(runtime, control.target);
                    if (!touch) {
                        return 0;
                    }
                    return control.axis === 'x' ? touch.x : touch.y;
                }
                case 'delta': {
                    const touch = resolveTouch(runtime, control.target);
                    if (!touch) {
                        return 0;
                    }
                    return control.axis === 'x' ? touch.deltaX : touch.deltaY;
                }
                case 'pinch':
                    return runtime._touchPinchDelta;
                case 'count':
                    return runtime._touches.size;
            }
            return 0;
        case 'gamepad':
            switch (control.kind) {
                case 'connected':
                    return sampleGamepadConnected(runtime, control.selector, user);
                case 'button':
                    return sampleGamepadButton(runtime, control.selector, control.button, user);
                case 'axis':
                    return sampleGamepadAxis(runtime, control.selector, control.axis, user);
            }
            return 0;
    }
};

const sampleDirectional = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    control: InternalControl,
    direction: 'positive' | 'negative',
    user?: InputUserId
): number => {
    const raw = sampleControl(runtime, control, user);

    if (!control.signed) {
        return raw > 0 ? raw : 0;
    }

    return direction === 'positive' ? Math.max(raw, 0) : Math.max(-raw, 0);
};

const resolveTouch = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    target: number
): MutableTouchPoint | undefined => {
    if (target === TOUCH_ANY) {
        return runtime._primaryTouchId !== undefined
            ? runtime._touches.get(runtime._primaryTouchId)
            : runtime._touches.values().next().value;
    }

    if (target === TOUCH_PRIMARY) {
        return runtime._primaryTouchId !== undefined
            ? runtime._touches.get(runtime._primaryTouchId)
            : undefined;
    }

    return runtime._touches.get(target);
};

const sampleGamepadConnected = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    selector: number,
    user?: InputUserId
): number => {
    if (selector === GAMEPAD_ANY) {
        for (const [index, state] of runtime._gamepads) {
            if (state.connected && canAccessGamepadIndex(runtime, index, user)) {
                return 1;
            }
        }
        return 0;
    }

    if (!canAccessGamepadIndex(runtime, selector, user)) {
        return 0;
    }

    return runtime._gamepads.get(selector)?.connected ? 1 : 0;
};

const sampleGamepadButton = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    selector: number,
    button: number,
    user?: InputUserId
): number => {
    if (selector === GAMEPAD_ANY) {
        let maxValue = 0;

        for (const [index, state] of runtime._gamepads) {
            if (!state.connected) {
                continue;
            }

            if (!canAccessGamepadIndex(runtime, index, user)) {
                continue;
            }

            maxValue = Math.max(maxValue, state.buttons[button] ?? 0);
        }

        return maxValue;
    }

    if (!canAccessGamepadIndex(runtime, selector, user)) {
        return 0;
    }

    const state = runtime._gamepads.get(selector);
    return state?.connected ? state.buttons[button] ?? 0 : 0;
};

const sampleGamepadAxis = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    selector: number,
    axis: number,
    user?: InputUserId
): number => {
    if (selector === GAMEPAD_ANY) {
        let best = 0;

        for (const [index, state] of runtime._gamepads) {
            if (!state.connected) {
                continue;
            }

            if (!canAccessGamepadIndex(runtime, index, user)) {
                continue;
            }

            const value = state.axes[axis] ?? 0;
            if (Math.abs(value) > Math.abs(best)) {
                best = value;
            }
        }

        return best;
    }

    if (!canAccessGamepadIndex(runtime, selector, user)) {
        return 0;
    }

    const state = runtime._gamepads.get(selector);
    return state?.connected ? state.axes[axis] ?? 0 : 0;
};

const canAccessControl = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    control: InternalControl,
    user?: InputUserId
): boolean => {
    if (!user) {
        return true;
    }

    const owner = runtime._users.get(user);
    if (!owner?.enabled) {
        return false;
    }

    if (control.device === 'gamepad') {
        return control.selector === GAMEPAD_ANY
            ? [...owner.devices.values()].some((device) => device.device === 'gamepad')
            : canAccessGamepadIndex(runtime, control.selector, user);
    }

    return owner.devices.has(control.device);
};

const canAccessGamepadIndex = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    index: number,
    user?: InputUserId
): boolean => {
    if (!user) {
        return true;
    }

    return runtime._gamepadOwners.get(index) === user;
};

const matchesModifiers = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalBindingBase<InternalBinding['type']>
): boolean => {
    if (binding.modifierMask === 0) {
        return true;
    }

    const currentMask = currentModifierMask(runtime);
    if (binding.exactModifiers) {
        return currentMask === binding.modifierMask;
    }

    return (currentMask & binding.modifierMask) === binding.modifierMask;
};

const currentModifierMask = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>
): number => {
    let mask = 0;

    if (runtime._keysDown.has('ShiftLeft') || runtime._keysDown.has('ShiftRight')) {
        mask |= MODIFIER_MASKS.shift;
    }

    if (runtime._keysDown.has('ControlLeft') || runtime._keysDown.has('ControlRight')) {
        mask |= MODIFIER_MASKS.ctrl;
    }

    if (runtime._keysDown.has('AltLeft') || runtime._keysDown.has('AltRight')) {
        mask |= MODIFIER_MASKS.alt;
    }

    if (runtime._keysDown.has('MetaLeft') || runtime._keysDown.has('MetaRight')) {
        mask |= MODIFIER_MASKS.meta;
    }

    return mask;
};

const isBindingConsumed = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalBindingBase<InternalBinding['type']>
): boolean => {
    for (const path of binding.paths) {
        if (runtime._consumedPaths.has(path)) {
            return true;
        }
    }

    return false;
};

const consumeBinding = <TSchema extends InputActionSchema>(
    runtime: InputEvaluationRuntime<TSchema>,
    binding: InternalBindingBase<InternalBinding['type']>
): void => {
    for (const path of binding.paths) {
        runtime._consumedPaths.add(path);
    }
};
