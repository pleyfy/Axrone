import { InputConfigurationError } from '../errors';
import { parseInputControlPath } from '../reference';
import {
    clamp,
    DEFAULT_HOLD_DURATION_MS,
    DEFAULT_MULTI_TAP_COUNT,
    DEFAULT_MULTI_TAP_DELAY_MS,
    DEFAULT_REPEAT_DELAY_MS,
    DEFAULT_REPEAT_INTERVAL_MS,
    DEFAULT_TAP_DURATION_MS,
    EMPTY_PROCESSORS,
    EPSILON,
    GAMEPAD_ANY,
    isRecord,
    modifiersToMask,
    toFiniteNumber,
    TOUCH_ANY,
    TOUCH_PRIMARY,
    uniqueModifiers,
} from './shared';
import type {
    InternalActionDefinition,
    InternalBinding,
    InternalButtonInteractions,
    InternalControl,
    InternalProcessor,
    InternalScalarProcessor,
    InternalVectorProcessor,
} from './shared';
import type {
    InputActionDefinition,
    InputActionKind,
    InputActionName,
    InputActionSchema,
    InputAxisActionDefinition,
    InputAxisCompositeBinding,
    InputBinding,
    InputBindingForAction,
    InputButtonActionDefinition,
    InputButtonInteraction,
    InputControlBinding,
    InputControlPath,
    InputDirectionalBinding,
    InputDualAxisBinding,
    InputMessageDescriptor,
    InputProcessor,
    InputVector2ActionDefinition,
} from '../types';

export interface InputCompilerHost<TSchema extends InputActionSchema> {
    getActionKind<TAction extends InputActionName<TSchema>>(action: TAction): InputActionKind;
    requireControlPath(value: string): InputControlPath;
    resolveMessage(descriptor: Readonly<InputMessageDescriptor>): string;
}

export interface InputCompiler<TSchema extends InputActionSchema> {
    normalizeActionDefinition(name: string, definition: InputActionDefinition): InternalActionDefinition;
    normalizeBindingList<TAction extends InputActionName<TSchema>>(
        action: TAction,
        bindings: readonly InputBindingForAction<TSchema[TAction]>[] | readonly InputBinding[]
    ): readonly InputBinding[];
    compileBindings(bindings: readonly InputBinding[]): readonly InternalBinding[];
}

export const createInputCompiler = <TSchema extends InputActionSchema>(
    host: InputCompilerHost<TSchema>
): InputCompiler<TSchema> => {
    const compileProcessors = (
        kind: 'scalar' | 'vector2',
        processors?: readonly InputProcessor[]
    ): readonly InternalProcessor[] => {
        if (!processors?.length) {
            return Object.freeze([]);
        }

        const compiled: InternalProcessor[] = [];

        for (const processor of processors) {
            if (!isRecord(processor) || typeof processor.type !== 'string') {
                throw new InputConfigurationError(
                    'input.invalid-binding',
                    host.resolveMessage({
                        code: 'input.invalid-binding',
                        value: processor,
                    })
                );
            }

            switch (processor.type) {
                case 'scale':
                    if (kind !== 'scalar') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'scalar',
                            type: 'scale',
                            value: toFiniteNumber(processor.value, 1),
                        })
                    );
                    continue;
                case 'invert':
                    if (kind !== 'scalar') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'scalar',
                            type: 'invert',
                        })
                    );
                    continue;
                case 'clamp':
                    if (kind !== 'scalar') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'scalar',
                            type: 'clamp',
                            min: Math.min(
                                toFiniteNumber(processor.min, -Infinity),
                                toFiniteNumber(processor.max, Infinity)
                            ),
                            max: Math.max(
                                toFiniteNumber(processor.min, -Infinity),
                                toFiniteNumber(processor.max, Infinity)
                            ),
                        })
                    );
                    continue;
                case 'deadzone':
                    if (kind !== 'scalar') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'scalar',
                            type: 'deadzone',
                            value: Math.max(0, toFiniteNumber(processor.value, 0)),
                        })
                    );
                    continue;
                case 'curve':
                    if (kind !== 'scalar') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'scalar',
                            type: 'curve',
                            exponent: Math.max(EPSILON, toFiniteNumber(processor.exponent, 1)),
                            signed: processor.signed ?? true,
                        })
                    );
                    continue;
                case 'scale-vector2':
                    if (kind !== 'vector2') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'vector2',
                            type: 'scale-vector2',
                            x: toFiniteNumber(processor.x, 1),
                            y: toFiniteNumber(processor.y, 1),
                        })
                    );
                    continue;
                case 'invert-vector2':
                    if (kind !== 'vector2') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'vector2',
                            type: 'invert-vector2',
                            x: processor.x ?? true,
                            y: processor.y ?? true,
                        })
                    );
                    continue;
                case 'normalize-vector2':
                    if (kind !== 'vector2') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'vector2',
                            type: 'normalize-vector2',
                        })
                    );
                    continue;
                case 'clamp-magnitude':
                    if (kind !== 'vector2') {
                        break;
                    }

                    compiled.push(
                        Object.freeze({
                            kind: 'vector2',
                            type: 'clamp-magnitude',
                            min: Math.max(0, toFiniteNumber(processor.min, 0)),
                            max: Math.max(0, toFiniteNumber(processor.max, 1)),
                        })
                    );
                    continue;
            }

            throw new InputConfigurationError(
                'input.invalid-binding',
                host.resolveMessage({
                    code: 'input.invalid-binding',
                    value: processor,
                })
            );
        }

        return Object.freeze(compiled);
    };

    const compileButtonInteractions = (
        interactions?: readonly InputButtonInteraction[]
    ): InternalButtonInteractions => {
        let press = false;
        let hold: InternalButtonInteractions['hold'];
        let tap: InternalButtonInteractions['tap'];
        let multiTap: InternalButtonInteractions['multiTap'];
        let repeat: InternalButtonInteractions['repeat'];

        for (const interaction of interactions ?? []) {
            if (!isRecord(interaction) || typeof interaction.type !== 'string') {
                throw new InputConfigurationError(
                    'input.invalid-action',
                    host.resolveMessage({
                        code: 'input.invalid-action',
                        value: interaction,
                    })
                );
            }

            switch (interaction.type) {
                case 'press':
                    if (!press) {
                        press = true;
                    }
                    break;
                case 'hold':
                    if (hold) {
                        throw new InputConfigurationError(
                            'input.invalid-action',
                            host.resolveMessage({
                                code: 'input.invalid-action',
                                value: interaction,
                            })
                        );
                    }

                    hold = Object.freeze({
                        durationMs: Math.max(
                            0,
                            toFiniteNumber(interaction.durationMs, DEFAULT_HOLD_DURATION_MS)
                        ),
                        continuous: interaction.mode === 'continuous',
                    });
                    break;
                case 'tap':
                    if (tap) {
                        throw new InputConfigurationError(
                            'input.invalid-action',
                            host.resolveMessage({
                                code: 'input.invalid-action',
                                value: interaction,
                            })
                        );
                    }

                    tap = Object.freeze({
                        maxDurationMs: Math.max(
                            0,
                            toFiniteNumber(interaction.maxDurationMs, DEFAULT_TAP_DURATION_MS)
                        ),
                    });
                    break;
                case 'multi-tap':
                    if (multiTap) {
                        throw new InputConfigurationError(
                            'input.invalid-action',
                            host.resolveMessage({
                                code: 'input.invalid-action',
                                value: interaction,
                            })
                        );
                    }

                    multiTap = Object.freeze({
                        tapCount: Math.max(
                            2,
                            Math.trunc(
                                toFiniteNumber(interaction.tapCount, DEFAULT_MULTI_TAP_COUNT)
                            )
                        ),
                        maxDelayMs: Math.max(
                            0,
                            toFiniteNumber(interaction.maxDelayMs, DEFAULT_MULTI_TAP_DELAY_MS)
                        ),
                        maxDurationMs: Math.max(
                            0,
                            toFiniteNumber(interaction.maxDurationMs, DEFAULT_TAP_DURATION_MS)
                        ),
                    });
                    break;
                case 'repeat':
                    if (repeat) {
                        throw new InputConfigurationError(
                            'input.invalid-action',
                            host.resolveMessage({
                                code: 'input.invalid-action',
                                value: interaction,
                            })
                        );
                    }

                    repeat = Object.freeze({
                        delayMs: Math.max(
                            0,
                            toFiniteNumber(interaction.delayMs, DEFAULT_REPEAT_DELAY_MS)
                        ),
                        intervalMs: Math.max(
                            1,
                            toFiniteNumber(interaction.intervalMs, DEFAULT_REPEAT_INTERVAL_MS)
                        ),
                    });
                    break;
                default:
                    throw new InputConfigurationError(
                        'input.invalid-action',
                        host.resolveMessage({
                            code: 'input.invalid-action',
                            value: interaction,
                        })
                    );
            }
        }

        return Object.freeze({
            press,
            hold,
            tap,
            multiTap,
            repeat,
        });
    };

    const normalizeActionDefinition = (
        name: string,
        definition: InputActionDefinition
    ): InternalActionDefinition => {
        if (!isRecord(definition) || typeof definition.kind !== 'string') {
            throw new InputConfigurationError(
                'input.invalid-action',
                host.resolveMessage({
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
                    processors: compileProcessors('scalar', buttonDefinition.processors) as readonly InternalScalarProcessor[],
                    interactions: compileButtonInteractions(buttonDefinition.interactions),
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
                    processors: compileProcessors('scalar', axisDefinition.processors) as readonly InternalScalarProcessor[],
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
                    processors: compileProcessors('vector2', vectorDefinition.processors) as readonly InternalVectorProcessor[],
                });
            }
            default:
                throw new InputConfigurationError(
                    'input.invalid-action',
                    host.resolveMessage({
                        code: 'input.invalid-action',
                        value: { name, definition },
                    })
                );
        }
    };

    const normalizeBinding = (actionKind: InputActionKind, binding: InputBinding): InputBinding => {
        if (!isRecord(binding) || typeof binding.type !== 'string') {
            throw new InputConfigurationError(
                'input.invalid-binding',
                host.resolveMessage({
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

                const control = host.requireControlPath((binding as InputControlBinding).control);
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
                    processors: binding.processors ?? EMPTY_PROCESSORS,
                });
            }
            case 'axis': {
                if (actionKind === 'vector2') {
                    break;
                }

                const axisBinding = binding as InputAxisCompositeBinding;
                return Object.freeze({
                    type: 'axis',
                    negative: host.requireControlPath(axisBinding.negative),
                    positive: host.requireControlPath(axisBinding.positive),
                    scale: toFiniteNumber(axisBinding.scale, 1),
                    consume,
                    modifiers,
                    exactModifiers,
                    processors: binding.processors ?? EMPTY_PROCESSORS,
                });
            }
            case 'vector2': {
                if (actionKind !== 'vector2') {
                    break;
                }

                const vectorBinding = binding as InputDirectionalBinding;
                return Object.freeze({
                    type: 'vector2',
                    up: host.requireControlPath(vectorBinding.up),
                    down: host.requireControlPath(vectorBinding.down),
                    left: host.requireControlPath(vectorBinding.left),
                    right: host.requireControlPath(vectorBinding.right),
                    normalize: !!vectorBinding.normalize,
                    scale: toFiniteNumber(vectorBinding.scale, 1),
                    consume,
                    modifiers,
                    exactModifiers,
                    processors: binding.processors ?? EMPTY_PROCESSORS,
                });
            }
            case 'dual-axis': {
                if (actionKind !== 'vector2') {
                    break;
                }

                const dualAxisBinding = binding as InputDualAxisBinding;
                return Object.freeze({
                    type: 'dual-axis',
                    x: host.requireControlPath(dualAxisBinding.x),
                    y: host.requireControlPath(dualAxisBinding.y),
                    normalize: !!dualAxisBinding.normalize,
                    scale: toFiniteNumber(dualAxisBinding.scale, 1),
                    deadzone: Math.max(0, toFiniteNumber(dualAxisBinding.deadzone, 0)),
                    consume,
                    modifiers,
                    exactModifiers,
                    processors: binding.processors ?? EMPTY_PROCESSORS,
                });
            }
        }

        throw new InputConfigurationError(
            'input.invalid-binding',
            host.resolveMessage({
                code: 'input.invalid-binding',
                value: binding,
            })
        );
    };

    const compileTouchSelector = (token: string): number => {
        if (token === 'any') {
            return TOUCH_ANY;
        }

        if (token === 'primary') {
            return TOUCH_PRIMARY;
        }

        return Number(token);
    };

    const compileGamepadSelector = (token: string): number =>
        token === 'any' ? GAMEPAD_ANY : Number(token);

    const compileControl = (path: InputControlPath): InternalControl => {
        const parsed = parseInputControlPath(path);

        if (!parsed) {
            throw new InputConfigurationError(
                'input.invalid-control-path',
                host.resolveMessage({
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
                        target: compileTouchSelector(parsed.target),
                        signed: false,
                    });
                }

                if (parsed.kind === 'position' || parsed.kind === 'delta') {
                    return Object.freeze({
                        device: 'touch',
                        kind: parsed.kind,
                        path: parsed.path,
                        axis: parsed.axis,
                        target: compileTouchSelector(parsed.target),
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
                        selector: compileGamepadSelector(parsed.selector),
                        button: parsed.button,
                        signed: false,
                    });
                }

                if (parsed.kind === 'axis') {
                    return Object.freeze({
                        device: 'gamepad',
                        kind: 'axis',
                        path: parsed.path,
                        selector: compileGamepadSelector(parsed.selector),
                        axis: parsed.axis,
                        signed: true,
                    });
                }

                return Object.freeze({
                    device: 'gamepad',
                    kind: 'connected',
                    path: parsed.path,
                    selector: compileGamepadSelector(parsed.selector),
                    signed: false,
                });
        }
    };

    const normalizeBindingList = <TAction extends InputActionName<TSchema>>(
        action: TAction,
        bindings: readonly InputBindingForAction<TSchema[TAction]>[] | readonly InputBinding[]
    ): readonly InputBinding[] => {
        const actionKind = host.getActionKind(action);
        const normalized: InputBinding[] = [];

        for (const binding of bindings) {
            normalized.push(normalizeBinding(actionKind, binding));
        }

        return Object.freeze(normalized);
    };

    const compileBindings = (bindings: readonly InputBinding[]): readonly InternalBinding[] => {
        const compiled: InternalBinding[] = [];

        for (const binding of bindings) {
            const modifiers = uniqueModifiers(binding.modifiers);
            const modifierMask = modifiersToMask(modifiers);
            const exactModifiers = !!binding.exactModifiers;
            const consume = !!binding.consume;

            switch (binding.type) {
                case 'control': {
                    const control = compileControl(host.requireControlPath(String(binding.control)));
                    const processors = compileProcessors('scalar', binding.processors) as readonly InternalScalarProcessor[];
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
                            processors,
                            paths: Object.freeze([control.path]),
                        })
                    );
                    break;
                }
                case 'axis': {
                    const negative = compileControl(host.requireControlPath(String(binding.negative)));
                    const positive = compileControl(host.requireControlPath(String(binding.positive)));
                    const processors = compileProcessors('scalar', binding.processors) as readonly InternalScalarProcessor[];
                    compiled.push(
                        Object.freeze({
                            type: 'axis',
                            negative,
                            positive,
                            scale: binding.scale ?? 1,
                            consume,
                            modifierMask,
                            exactModifiers,
                            processors,
                            paths: Object.freeze([negative.path, positive.path]),
                        })
                    );
                    break;
                }
                case 'vector2': {
                    const up = compileControl(host.requireControlPath(String(binding.up)));
                    const down = compileControl(host.requireControlPath(String(binding.down)));
                    const left = compileControl(host.requireControlPath(String(binding.left)));
                    const right = compileControl(host.requireControlPath(String(binding.right)));
                    const processors = compileProcessors('vector2', binding.processors) as readonly InternalVectorProcessor[];
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
                            processors,
                            paths: Object.freeze([up.path, down.path, left.path, right.path]),
                        })
                    );
                    break;
                }
                case 'dual-axis': {
                    const x = compileControl(host.requireControlPath(String(binding.x)));
                    const y = compileControl(host.requireControlPath(String(binding.y)));
                    const processors = compileProcessors('vector2', binding.processors) as readonly InternalVectorProcessor[];
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
                            processors,
                            paths: Object.freeze([x.path, y.path]),
                        })
                    );
                    break;
                }
            }
        }

        return Object.freeze(compiled);
    };

    return {
        normalizeActionDefinition,
        normalizeBindingList,
        compileBindings,
    };
};