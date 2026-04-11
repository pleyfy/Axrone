import type {
    GamepadAxisControlPath,
    GamepadButtonControlPath,
    GamepadConnectionControlPath,
    InputContextId,
    InputControlPath,
    InputGamepadSelectorToken,
    InputTouchSelectorToken,
    InputUserId,
    KeyboardControlPath,
    KnownInputControlPath,
    MouseButtonControlPath,
    MouseMotionControlPath,
    MousePositionControlPath,
    MouseWheelControlPath,
    ParsedGamepadAxisControlPath,
    ParsedGamepadButtonControlPath,
    ParsedGamepadConnectionControlPath,
    ParsedInputControlPath,
    ParsedKeyboardControlPath,
    ParsedMouseAxisControlPath,
    ParsedMouseButtonControlPath,
    ParsedTouchAggregateControlPath,
    ParsedTouchAxisControlPath,
    ParsedTouchContactControlPath,
    TouchAggregateControlPath,
    TouchContactControlPath,
    TouchDeltaControlPath,
    TouchPositionControlPath,
} from './types';

const INPUT_PATH_SEGMENT_PATTERN = /^[^/\s]+$/;
const GAMEPAD_SEMANTIC_BUTTON_MAP = Object.freeze({
    south: 0,
    east: 1,
    west: 2,
    north: 3,
    'left-shoulder': 4,
    'right-shoulder': 5,
    'left-trigger-button': 6,
    'right-trigger-button': 7,
    select: 8,
    start: 9,
    'left-stick-press': 10,
    'right-stick-press': 11,
    'dpad-up': 12,
    'dpad-down': 13,
    'dpad-left': 14,
    'dpad-right': 15,
    guide: 16,
    touchpad: 17,
} as const);
const GAMEPAD_SEMANTIC_AXIS_MAP = Object.freeze({
    'left-stick/x': 0,
    'left-stick/y': 1,
    'right-stick/x': 2,
    'right-stick/y': 3,
    'left-trigger': 4,
    'right-trigger': 5,
} as const);

const asInputContextIdUnchecked = (value: string): InputContextId => value as InputContextId;
const asInputUserIdUnchecked = (value: string): InputUserId => value as InputUserId;
const asInputControlPathUnchecked = <TPath extends string>(value: TPath): TPath & InputControlPath =>
    value as TPath & InputControlPath;

const normalizeSelectorToken = <TToken extends string>(
    value: string,
    mode: 'gamepad' | 'touch'
): TToken | undefined => {
    const token = value.trim().toLowerCase();

    if (!token) {
        return undefined;
    }

    if (token === 'any') {
        return token as TToken;
    }

    if (mode === 'touch' && token === 'primary') {
        return token as TToken;
    }

    const numeric = Number(token);
    if (!Number.isInteger(numeric) || numeric < 0) {
        return undefined;
    }

    return String(numeric) as TToken;
};

const isAxisToken = (value: string): value is 'x' | 'y' | 'z' =>
    value === 'x' || value === 'y' || value === 'z';

const isBinaryAxisToken = (value: string): value is 'x' | 'y' => value === 'x' || value === 'y';

export const asInputContextId = (value: string): InputContextId => asInputContextIdUnchecked(value);
export const asInputUserId = (value: string): InputUserId => asInputUserIdUnchecked(value);
export const asInputControlPath = <TPath extends KnownInputControlPath | string>(
    value: TPath
): TPath & InputControlPath => asInputControlPathUnchecked(value);

export const normalizeInputContextId = (value?: string): InputContextId | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim();
    return normalized ? asInputContextIdUnchecked(normalized) : undefined;
};

export const normalizeInputUserId = (value?: string): InputUserId | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim();
    return normalized ? asInputUserIdUnchecked(normalized) : undefined;
};

export const normalizeInputControlPath = (
    value?: string
): KnownInputControlPath & InputControlPath | undefined => {
    const parsed = value ? parseInputControlPath(value) : undefined;
    return parsed?.path;
};

export const parseInputControlPath = (value: string): ParsedInputControlPath | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const parts = trimmed.split('/');
    const device = parts[0]?.toLowerCase();

    if (device === 'keyboard') {
        const code = parts.slice(1).join('/').trim();
        if (!code || code.includes('/') || !INPUT_PATH_SEGMENT_PATTERN.test(code)) {
            return undefined;
        }

        const path = asInputControlPathUnchecked<KeyboardControlPath>(`keyboard/${code}`);
        const parsed: ParsedKeyboardControlPath = {
            device: 'keyboard',
            path,
            code,
        };
        return parsed;
    }

    if (device === 'mouse') {
        const category = parts[1]?.toLowerCase();

        if (category === 'button' && parts.length === 3) {
            const button = Number(parts[2]);
            if (!Number.isInteger(button) || button < 0) {
                return undefined;
            }

            const path = asInputControlPathUnchecked<MouseButtonControlPath>(
                `mouse/button/${button}`
            );
            const parsed: ParsedMouseButtonControlPath = {
                device: 'mouse',
                kind: 'button',
                path,
                button,
            };
            return parsed;
        }

        if ((category === 'move' || category === 'wheel' || category === 'position') && parts.length === 3) {
            const axisToken = parts[2]?.toLowerCase();
            if (!axisToken || !isAxisToken(axisToken)) {
                return undefined;
            }

            if (category !== 'wheel' && axisToken === 'z') {
                return undefined;
            }

            const path =
                category === 'move'
                    ? asInputControlPathUnchecked<MouseMotionControlPath>(
                          `mouse/move/${axisToken as 'x' | 'y'}`
                      )
                    : category === 'wheel'
                      ? asInputControlPathUnchecked<MouseWheelControlPath>(
                            `mouse/wheel/${axisToken}`
                        )
                      : asInputControlPathUnchecked<MousePositionControlPath>(
                            `mouse/position/${axisToken as 'x' | 'y'}`
                        );

            const parsed: ParsedMouseAxisControlPath = {
                device: 'mouse',
                kind: category,
                path,
                axis: axisToken,
            };
            return parsed;
        }

        return undefined;
    }

    if (device === 'touch') {
        const category = parts[1]?.toLowerCase();

        if (category === 'pinch' && parts.length === 2) {
            const parsed: ParsedTouchAggregateControlPath = {
                device: 'touch',
                kind: 'pinch',
                path: asInputControlPathUnchecked<TouchAggregateControlPath>('touch/pinch'),
            };
            return parsed;
        }

        if (category === 'count' && parts.length === 2) {
            const parsed: ParsedTouchAggregateControlPath = {
                device: 'touch',
                kind: 'count',
                path: asInputControlPathUnchecked<TouchAggregateControlPath>('touch/count'),
            };
            return parsed;
        }

        if (category === 'contact' && parts.length === 3) {
            const target = normalizeSelectorToken<InputTouchSelectorToken>(parts[2]!, 'touch');
            if (!target) {
                return undefined;
            }

            const path = asInputControlPathUnchecked<TouchContactControlPath>(
                `touch/contact/${target}`
            );
            const parsed: ParsedTouchContactControlPath = {
                device: 'touch',
                kind: 'contact',
                path,
                target,
            };
            return parsed;
        }

        if ((category === 'position' || category === 'delta') && parts.length === 4) {
            const axis = parts[2]?.toLowerCase();
            const target = normalizeSelectorToken<InputTouchSelectorToken>(parts[3]!, 'touch');

            if (!axis || !isBinaryAxisToken(axis) || !target) {
                return undefined;
            }

            const path =
                category === 'position'
                    ? asInputControlPathUnchecked<TouchPositionControlPath>(
                          `touch/position/${axis}/${target}`
                      )
                    : asInputControlPathUnchecked<TouchDeltaControlPath>(
                          `touch/delta/${axis}/${target}`
                      );

            const parsed: ParsedTouchAxisControlPath = {
                device: 'touch',
                kind: category,
                path,
                axis,
                target,
            };
            return parsed;
        }

        return undefined;
    }

    if (device === 'gamepad') {
        const selector = normalizeSelectorToken<InputGamepadSelectorToken>(parts[1] ?? '', 'gamepad');
        const category = parts[2]?.toLowerCase();

        if (!selector || !category) {
            return undefined;
        }

        if (category === 'connected' && parts.length === 3) {
            const path = asInputControlPathUnchecked<GamepadConnectionControlPath>(
                `gamepad/${selector}/connected`
            );
            const parsed: ParsedGamepadConnectionControlPath = {
                device: 'gamepad',
                kind: 'connected',
                path,
                selector,
            };
            return parsed;
        }

        if ((category === 'button' || category === 'axis') && parts.length === 4) {
            const index = Number(parts[3]);
            if (!Number.isInteger(index) || index < 0) {
                return undefined;
            }

            if (category === 'button') {
                const path = asInputControlPathUnchecked<GamepadButtonControlPath>(
                    `gamepad/${selector}/button/${index}`
                );
                const parsed: ParsedGamepadButtonControlPath = {
                    device: 'gamepad',
                    kind: 'button',
                    path,
                    selector,
                    button: index,
                };
                return parsed;
            }

            const path = asInputControlPathUnchecked<GamepadAxisControlPath>(
                `gamepad/${selector}/axis/${index}`
            );
            const parsed: ParsedGamepadAxisControlPath = {
                device: 'gamepad',
                kind: 'axis',
                path,
                selector,
                axis: index,
            };
            return parsed;
        }

        if (parts.length === 3) {
            const semanticButton = category as keyof typeof GAMEPAD_SEMANTIC_BUTTON_MAP | undefined;
            if (semanticButton && semanticButton in GAMEPAD_SEMANTIC_BUTTON_MAP) {
                const button = GAMEPAD_SEMANTIC_BUTTON_MAP[semanticButton];
                const path = asInputControlPathUnchecked<GamepadButtonControlPath>(
                    `gamepad/${selector}/button/${button}`
                );
                const parsed: ParsedGamepadButtonControlPath = {
                    device: 'gamepad',
                    kind: 'button',
                    path,
                    selector,
                    button,
                };
                return parsed;
            }
        }

        if (parts.length === 4) {
            const semanticAxis = `${category}/${parts[3]!.toLowerCase()}` as keyof typeof GAMEPAD_SEMANTIC_AXIS_MAP;
            if (semanticAxis in GAMEPAD_SEMANTIC_AXIS_MAP) {
                const axis = GAMEPAD_SEMANTIC_AXIS_MAP[semanticAxis];
                const path = asInputControlPathUnchecked<GamepadAxisControlPath>(
                    `gamepad/${selector}/axis/${axis}`
                );
                const parsed: ParsedGamepadAxisControlPath = {
                    device: 'gamepad',
                    kind: 'axis',
                    path,
                    selector,
                    axis,
                };
                return parsed;
            }
        }

        return undefined;
    }

    return undefined;
};

export const isInputControlPath = (value: unknown): value is KnownInputControlPath & InputControlPath =>
    typeof value === 'string' && !!parseInputControlPath(value);
