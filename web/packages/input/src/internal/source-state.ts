import { toFiniteNumber } from './shared';
import type {
    ActiveRebinding,
    MutableGamepadState,
    MutableTouchPoint,
} from './shared';
import type {
    InputActionSchema,
    InputControlPath,
    InputDeviceKind,
    InputFocusSourceEvent,
    InputGamepadOptions,
    InputGamepadSnapshot,
    InputMouseButtonSourceEvent,
    InputMouseMoveSourceEvent,
    InputMouseWheelSourceEvent,
    InputSourceEvent,
    InputTouchSourceEvent,
} from '../types';

export interface InputSourceRuntime<TSchema extends InputActionSchema = InputActionSchema> {
    _keysDown: Set<string>;
    _touches: Map<number, MutableTouchPoint>;
    _gamepads: Map<number, MutableGamepadState>;
    _gamepadSeen: Set<number>;
    _gamepad: Required<Pick<InputGamepadOptions, 'enabled' | 'autoPoll'>> &
        Pick<InputGamepadOptions, 'provider'>;
    _mouseButtons: number;
    _mouseX: number;
    _mouseY: number;
    _mouseDeltaX: number;
    _mouseDeltaY: number;
    _mouseWheelX: number;
    _mouseWheelY: number;
    _mouseWheelZ: number;
    _touchOrder: number;
    _touchPinchDistance: number;
    _touchPinchDelta: number;
    _primaryTouchId: number | undefined;
    _timestamp: number;
    _activeRebinding?: ActiveRebinding<TSchema>;
    _captureRebinding(
        control: InputControlPath,
        device: InputDeviceKind,
        timestamp: number,
        magnitudeValue?: number
    ): void;
    _requireControlPath(value: string): InputControlPath;
}

const TOUCH_ANY = -1;
const TOUCH_PRIMARY = -2;
const GAMEPAD_ANY = -1;

export const handleKeyboardEvent = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    event: Readonly<Extract<InputSourceEvent, { type: 'keyboard' }>>
): void => {
    const code = event.code.trim();
    if (!code) {
        return;
    }

    if (event.pressed) {
        runtime._keysDown.add(code);
        if (!event.repeat) {
            runtime._captureRebinding(
                runtime._requireControlPath(`keyboard/${code}`),
                'keyboard',
                runtime._timestamp
            );
        }
    } else {
        runtime._keysDown.delete(code);
    }
};

export const handleMouseButtonEvent = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    event: Readonly<InputMouseButtonSourceEvent>
): void => {
    if (Number.isFinite(event.x)) {
        runtime._mouseX = event.x!;
    }

    if (Number.isFinite(event.y)) {
        runtime._mouseY = event.y!;
    }

    if (!Number.isInteger(event.button) || event.button < 0 || event.button > 30) {
        return;
    }

    const mask = 1 << event.button;
    if (event.pressed) {
        runtime._mouseButtons |= mask;
        runtime._captureRebinding(
            runtime._requireControlPath(`mouse/button/${event.button}`),
            'mouse',
            runtime._timestamp
        );
    } else {
        runtime._mouseButtons &= ~mask;
    }
};

export const handleMouseMoveEvent = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    event: Readonly<InputMouseMoveSourceEvent>
): void => {
    runtime._mouseX = event.x;
    runtime._mouseY = event.y;
    runtime._mouseDeltaX += event.deltaX;
    runtime._mouseDeltaY += event.deltaY;

    const axis =
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
            ? event.deltaX !== 0
                ? 'x'
                : undefined
            : event.deltaY !== 0
              ? 'y'
              : undefined;

    if (axis) {
        runtime._captureRebinding(
            runtime._requireControlPath(`mouse/move/${axis}`),
            'mouse',
            runtime._timestamp,
            Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY))
        );
    }
};

export const handleMouseWheelEvent = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    event: Readonly<InputMouseWheelSourceEvent>
): void => {
    runtime._mouseWheelX += event.deltaX;
    runtime._mouseWheelY += event.deltaY;
    runtime._mouseWheelZ += event.deltaZ ?? 0;

    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    const absZ = Math.abs(event.deltaZ ?? 0);
    const dominant = Math.max(absX, absY, absZ);

    if (dominant <= 0) {
        return;
    }

    const axis = dominant === absX ? 'x' : dominant === absY ? 'y' : 'z';
    runtime._captureRebinding(
        runtime._requireControlPath(`mouse/wheel/${axis}`),
        'mouse',
        runtime._timestamp,
        dominant
    );
};

export const handleTouchEvent = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    event: Readonly<InputTouchSourceEvent>
): void => {
    const changedIds = new Set<number>();

    for (const point of event.changed) {
        changedIds.add(point.id);
        const existing = runtime._touches.get(point.id);

        if (event.phase === 'end' || event.phase === 'cancel') {
            if (existing) {
                existing.deltaX += point.x - existing.x;
                existing.deltaY += point.y - existing.y;
                existing.x = point.x;
                existing.y = point.y;
            }

            runtime._touches.delete(point.id);
            continue;
        }

        if (existing) {
            existing.deltaX += point.x - existing.x;
            existing.deltaY += point.y - existing.y;
            existing.x = point.x;
            existing.y = point.y;
        } else {
            runtime._touches.set(point.id, {
                id: point.id,
                order: ++runtime._touchOrder,
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

            const existing = runtime._touches.get(point.id);
            if (!existing) {
                runtime._touches.set(point.id, {
                    id: point.id,
                    order: ++runtime._touchOrder,
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

    refreshPrimaryTouch(runtime);
    updateTouchPinch(runtime);

    if (event.phase === 'start' && event.changed.length > 0) {
        runtime._captureRebinding(
            runtime._requireControlPath('touch/contact/primary'),
            'touch',
            runtime._timestamp
        );
    } else if (event.phase === 'move' && Math.abs(runtime._touchPinchDelta) > 0) {
        runtime._captureRebinding(
            runtime._requireControlPath('touch/pinch'),
            'touch',
            runtime._timestamp,
            Math.abs(runtime._touchPinchDelta)
        );
    }
};

export const handleFocusEvent = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    event: Readonly<InputFocusSourceEvent>
): void => {
    if (event.focused) {
        return;
    }

    clearDeviceState(runtime, true);
};

export const ingestGamepadSnapshots = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    gamepads: readonly InputGamepadSnapshot[]
): void => {
    runtime._gamepadSeen.clear();

    for (const snapshot of gamepads) {
        if (!Number.isInteger(snapshot.index) || snapshot.index < 0) {
            continue;
        }

        runtime._gamepadSeen.add(snapshot.index);
        const state = ensureGamepadState(
            runtime,
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

    for (const [index, state] of runtime._gamepads) {
        if (!runtime._gamepadSeen.has(index)) {
            state.connected = false;
            state.buttons.fill(0);
            state.axes.fill(0);
        }
    }
};

export const pollGamepads = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>
): void => {
    if (!runtime._gamepad.enabled || !runtime._gamepad.autoPoll) {
        return;
    }

    const provider =
        runtime._gamepad.provider ??
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

    ingestGamepadSnapshots(runtime, snapshots);
    captureGamepadCandidate(runtime, runtime._timestamp);
};

export const captureGamepadCandidate = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    timestamp: number
): void => {
    const active = runtime._activeRebinding;
    if (!active || (active.request.devices?.length && !active.request.devices.includes('gamepad'))) {
        return;
    }

    const threshold = Math.max(0, toFiniteNumber(active.request.threshold, 0.5));

    for (const [index, state] of runtime._gamepads) {
        if (!state.connected) {
            continue;
        }

        for (let button = 0; button < state.buttons.length; button += 1) {
            const value = state.buttons[button] ?? 0;
            if (value >= threshold) {
                runtime._captureRebinding(
                    runtime._requireControlPath(`gamepad/${index}/button/${button}`),
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
                runtime._captureRebinding(
                    runtime._requireControlPath(`gamepad/${index}/axis/${axis}`),
                    'gamepad',
                    timestamp,
                    Math.abs(value)
                );
                return;
            }
        }
    }
};

export const clearDeviceState = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    resetGamepads: boolean
): void => {
    runtime._keysDown.clear();
    runtime._mouseButtons = 0;
    runtime._mouseDeltaX = 0;
    runtime._mouseDeltaY = 0;
    runtime._mouseWheelX = 0;
    runtime._mouseWheelY = 0;
    runtime._mouseWheelZ = 0;
    runtime._touches.clear();
    runtime._primaryTouchId = undefined;
    runtime._touchPinchDistance = 0;
    runtime._touchPinchDelta = 0;

    if (!resetGamepads) {
        return;
    }

    for (const [, state] of runtime._gamepads) {
        state.connected = false;
        state.buttons.fill(0);
        state.axes.fill(0);
    }
};

export const clearTransients = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>
): void => {
    runtime._mouseDeltaX = 0;
    runtime._mouseDeltaY = 0;
    runtime._mouseWheelX = 0;
    runtime._mouseWheelY = 0;
    runtime._mouseWheelZ = 0;
    runtime._touchPinchDelta = 0;

    for (const [, touch] of runtime._touches) {
        touch.deltaX = 0;
        touch.deltaY = 0;
    }
};

export const refreshPrimaryTouch = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>
): void => {
    let selected: MutableTouchPoint | undefined;

    for (const [, touch] of runtime._touches) {
        if (!selected || touch.order < selected.order) {
            selected = touch;
        }
    }

    runtime._primaryTouchId = selected?.id;
};

export const updateTouchPinch = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>
): void => {
    const activeTouches = [...runtime._touches.values()].sort(
        (left, right) => left.order - right.order
    );

    if (activeTouches.length < 2) {
        runtime._touchPinchDistance = 0;
        runtime._touchPinchDelta = 0;
        return;
    }

    const [first, second] = activeTouches;
    const distance = Math.hypot(second!.x - first!.x, second!.y - first!.y);

    if (runtime._touchPinchDistance > 0) {
        runtime._touchPinchDelta += distance - runtime._touchPinchDistance;
    }

    runtime._touchPinchDistance = distance;
};

const ensureGamepadState = <TSchema extends InputActionSchema>(
    runtime: InputSourceRuntime<TSchema>,
    index: number,
    buttonCount: number,
    axisCount: number
): MutableGamepadState => {
    const existing = runtime._gamepads.get(index);

    if (existing) {
        if (existing.buttons.length !== buttonCount) {
            const nextButtons = new Float64Array(buttonCount);
            nextButtons.set(existing.buttons.subarray(0, Math.min(buttonCount, existing.buttons.length)));
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

    runtime._gamepads.set(index, created);
    return created;
};