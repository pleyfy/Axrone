import { EMPTY_MODIFIERS, INPUT_SNAPSHOT_VERSION, isRecord, toFiniteNumber } from './shared';
import { InputRebindingError, InputSnapshotError } from '../errors';
import type {
    ActiveRebinding,
    InternalActionDefinition,
    InternalContext,
    InternalContextAction,
    InternalInputUser,
} from './shared';
import type { InputCompiler } from './compiler';
import type {
    InputActionBindings,
    InputActionName,
    InputActionSchema,
    InputBinding,
    InputBindingControlPatchRequest,
    InputBindingForAction,
    InputBindingMutationRequest,
    InputBindingReplaceRequest,
    InputBindingSlot,
    InputContextDefinition,
    InputContextId,
    InputContextSnapshot,
    InputContextState,
    InputControlBinding,
    InputControlPath,
    InputDeviceKind,
    InputMessageDescriptor,
    InputRebindingCandidate,
    InputRebindingHandlers,
    InputRebindingRequest,
    InputRebindingResult,
    InputRebindingSession,
    InputRestoreOptions,
    InputSystemSnapshot,
    InputUserDefinition,
    InputUserSnapshot,
    InputUserId,
} from '../types';

export interface InputRebindingRuntime<TSchema extends InputActionSchema = InputActionSchema> {
    _compiler: InputCompiler<TSchema>;
    _actionNames: readonly InputActionName<TSchema>[];
    _actionDefinitions: readonly InternalActionDefinition[];
    _contexts: Map<string, InternalContext<TSchema>>;
    _users: Map<string, InternalInputUser>;
    _gamepadOwners: Map<number, InputUserId>;
    _contextOrderDirty: boolean;
    _activeRebinding: ActiveRebinding<TSchema> | undefined;
    _rebindToken: number;
    _locale: string;
    _now(): number;
    _requireActionIndex(action: string): number;
    _requireContext(value: string | InputContextId): InternalContext<TSchema>;
    _requireContextAction<TAction extends InputActionName<TSchema>>(
        context: string | InputContextId,
        action: TAction
    ): InternalContextAction<TSchema>;
    _requireControlPath(value: string): InputControlPath;
    _resolveMessage(descriptor: Readonly<InputMessageDescriptor>): string;
    _upsertContext(definition: InputContextDefinition<TSchema>, allowReplace: boolean): InputContextState;
    _upsertUser(definition: InputUserDefinition, allowReplace: boolean): void;
    _getOrderedContexts(): readonly InternalContext<TSchema>[];
}

export const applyBindingMutation = <TSchema extends InputActionSchema, TAction extends InputActionName<TSchema>>(
    runtime: InputRebindingRuntime<TSchema>,
    request: Readonly<InputBindingMutationRequest<TSchema, TAction>>
): readonly InputBindingForAction<TSchema[TAction]>[] => {
    if ('bindings' in request) {
        const replaceRequest = request as InputBindingReplaceRequest<TSchema, TAction>;
        const entry = runtime._requireContextAction(replaceRequest.context, replaceRequest.action);
        const normalized = runtime._compiler.normalizeBindingList(
            replaceRequest.action,
            replaceRequest.bindings
        );
        entry.current = normalized as readonly InputBinding[];
        entry.compiled = runtime._compiler.compileBindings(entry.current);
        return entry.current as readonly InputBindingForAction<TSchema[TAction]>[];
    }

    const patchRequest = request as InputBindingControlPatchRequest<TSchema, TAction>;
    const { entry, index, slot, control } = resolveControlPatch(runtime, patchRequest);
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
        nextBindings[index] = patchBindingControl(nextBindings[index]!, slot, control);
    }

    const normalized = runtime._compiler.normalizeBindingList(patchRequest.action, nextBindings);
    entry.current = normalized as readonly InputBinding[];
    entry.compiled = runtime._compiler.compileBindings(entry.current);
    return entry.current as readonly InputBindingForAction<TSchema[TAction]>[];
};

export const beginRebindingSession = <TSchema extends InputActionSchema, TAction extends InputActionName<TSchema>>(
    runtime: InputRebindingRuntime<TSchema>,
    request: Readonly<InputRebindingRequest<TSchema, TAction>>,
    handlers?: InputRebindingHandlers<TSchema, TAction>
): InputRebindingSession<TSchema, TAction> => {
    resolveBindingTarget(runtime, request.context, request.action, request.index, request.slot);

    if (runtime._activeRebinding) {
        cancelRebindingSession(runtime, 'replaced');
    }

    const token = ++runtime._rebindToken;
    const startedAtEpochMs = runtime._now();
    const timeoutMs =
        typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs)
            ? Math.max(0, request.timeoutMs)
            : undefined;

    runtime._activeRebinding = {
        token,
        request,
        handlers,
        startedAtEpochMs,
        deadlineEpochMs: typeof timeoutMs === 'number' ? startedAtEpochMs + timeoutMs : undefined,
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
            if (runtime._activeRebinding?.token === token) {
                cancelRebindingSession(runtime, 'manual');
            }
        },
    };
};

export const captureRebindingCandidate = <TSchema extends InputActionSchema>(
    runtime: InputRebindingRuntime<TSchema>,
    control: InputControlPath,
    device: InputDeviceKind,
    timestamp: number,
    magnitudeValue = 1
): void => {
    const active = runtime._activeRebinding;
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

    const nextBindings = applyBindingMutation(runtime, {
        context: active.request.context,
        action: active.request.action,
        index: active.request.index,
        slot: active.request.slot,
        control,
    } as InputBindingControlPatchRequest<TSchema>);
    const resolved = resolveBindingTarget(
        runtime,
        active.request.context,
        active.request.action,
        active.request.index,
        active.request.slot
    );
    const binding = nextBindings[resolved.index]!;
    const handlers = active.handlers;
    runtime._activeRebinding = undefined;

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
};

export const cancelRebindingSession = <TSchema extends InputActionSchema>(
    runtime: InputRebindingRuntime<TSchema>,
    reason: 'manual' | 'timeout' | 'disposed' | 'replaced' | 'completed'
): void => {
    const active = runtime._activeRebinding;
    if (!active) {
        return;
    }

    runtime._activeRebinding = undefined;
    active.handlers?.cancel?.(reason);
};

export const expireRebindingSessionIfNeeded = <TSchema extends InputActionSchema>(
    runtime: InputRebindingRuntime<TSchema>,
    now: number
): void => {
    const active = runtime._activeRebinding;
    if (!active || typeof active.deadlineEpochMs !== 'number' || now < active.deadlineEpochMs) {
        return;
    }

    runtime._resolveMessage({
        code: 'input.rebind.timeout',
        action: String(active.request.action),
        context: String(active.request.context),
    });
    const handlers = active.handlers;
    runtime._activeRebinding = undefined;
    handlers?.cancel?.('timeout');
};

export const createInputSnapshot = <TSchema extends InputActionSchema>(
    runtime: InputRebindingRuntime<TSchema>
): InputSystemSnapshot<TSchema> => {
    const users =
        runtime._users.size > 0
            ? Object.freeze(
                  [...runtime._users.values()].map<InputUserSnapshot>((user) =>
                      Object.freeze({
                          id: user.id,
                          enabled: user.enabled,
                          devices: Object.freeze([...user.devices.values()]),
                      })
                  )
              )
            : undefined;
    const contexts = runtime._getOrderedContexts().map<InputContextSnapshot<TSchema>>((context) => {
        const bindings: Partial<InputActionBindings<TSchema>> = {};

        for (const [actionIndex, actionEntry] of context.actions) {
            const actionName = runtime._actionNames[actionIndex]!;
            bindings[actionName] =
                actionEntry.current as readonly InputBindingForAction<TSchema[typeof actionName]>[];
        }

        return Object.freeze({
            id: context.id,
            priority: context.priority,
            enabled: context.enabled,
            capture: context.capture,
            user: context.user,
            bindings: Object.freeze(bindings) as InputContextSnapshot<TSchema>['bindings'],
        });
    });

    return Object.freeze({
        version: INPUT_SNAPSHOT_VERSION,
        locale: runtime._locale,
        capturedAtEpochMs: runtime._now(),
        users,
        contexts: Object.freeze(contexts),
    });
};

export const restoreInputSnapshot = <TSchema extends InputActionSchema>(
    runtime: InputRebindingRuntime<TSchema>,
    snapshot: Readonly<InputSystemSnapshot<TSchema>>,
    options: InputRestoreOptions,
    isSnapshot: (value: unknown) => value is InputSystemSnapshot<TSchema>
): void => {
    if (!isSnapshot(snapshot)) {
        throw new InputSnapshotError(
            runtime._resolveMessage({
                code: 'input.invalid-snapshot',
                reason: 'snapshot shape is invalid',
            })
        );
    }

    if (!options.merge) {
        runtime._users.clear();
        runtime._gamepadOwners.clear();
        runtime._contexts.clear();
        runtime._contextOrderDirty = true;
    }

    for (const userSnapshot of snapshot.users ?? []) {
        if (!isRecord(userSnapshot) || typeof userSnapshot.id !== 'string') {
            throw new InputSnapshotError(
                runtime._resolveMessage({
                    code: 'input.invalid-snapshot',
                    reason: 'user entry is invalid',
                })
            );
        }

        runtime._upsertUser(
            {
                id: userSnapshot.id,
                enabled: userSnapshot.enabled,
                devices: userSnapshot.devices,
            },
            true
        );
    }

    for (const contextSnapshot of snapshot.contexts) {
        if (!isRecord(contextSnapshot) || typeof contextSnapshot.id !== 'string') {
            throw new InputSnapshotError(
                runtime._resolveMessage({
                    code: 'input.invalid-snapshot',
                    reason: 'context entry is invalid',
                })
            );
        }

        runtime._upsertContext(
            {
                id: contextSnapshot.id,
                priority: contextSnapshot.priority,
                enabled: contextSnapshot.enabled,
                capture: contextSnapshot.capture,
                user: contextSnapshot.user,
                bindings: contextSnapshot.bindings,
            },
            true
        );
    }
};

const resolveBindingTarget = <TSchema extends InputActionSchema, TAction extends InputActionName<TSchema>>(
    runtime: InputRebindingRuntime<TSchema>,
    contextValue: string | InputContextId,
    action: TAction,
    indexValue: number | undefined,
    slotValue?: InputBindingSlot
): {
    readonly entry: InternalContextAction<TSchema>;
    readonly index: number;
    readonly slot: InputBindingSlot;
    readonly context: InternalContext<TSchema>;
} => {
    const context = runtime._requireContext(contextValue);
    const entry = runtime._requireContextAction(context.id, action);
    const actionIndex = runtime._requireActionIndex(action);
    const actionDefinition = runtime._actionDefinitions[actionIndex]!;

    if (typeof indexValue !== 'number' || !Number.isInteger(indexValue) || indexValue < 0) {
        if (actionDefinition.kind === 'vector2') {
            throw new InputRebindingError(
                'input.invalid-rebind',
                runtime._resolveMessage({
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
            runtime._resolveMessage({
                code: 'input.invalid-rebind',
                value: { context: contextValue, action, index: indexValue, slot: slotValue },
            })
        );
    }

    const slot = resolveBindingSlot(runtime, binding, slotValue);
    return {
        entry,
        index: indexValue,
        slot,
        context,
    };
};

const resolveControlPatch = <TSchema extends InputActionSchema, TAction extends InputActionName<TSchema>>(
    runtime: InputRebindingRuntime<TSchema>,
    request: Readonly<InputBindingControlPatchRequest<TSchema, TAction>>
): {
    readonly entry: InternalContextAction<TSchema>;
    readonly index: number;
    readonly slot: InputBindingSlot;
    readonly control: InputControlPath;
    readonly context: InternalContext<TSchema>;
} => {
    if (!isRecord(request)) {
        throw new InputRebindingError(
            'input.invalid-rebind',
            runtime._resolveMessage({
                code: 'input.invalid-rebind',
                value: request,
            })
        );
    }

    return {
        ...resolveBindingTarget(runtime, request.context, request.action, request.index, request.slot),
        control: runtime._requireControlPath(request.control),
    };
};

const resolveBindingSlot = <TSchema extends InputActionSchema>(
    runtime: InputRebindingRuntime<TSchema>,
    binding: InputBinding,
    slot?: InputBindingSlot
): InputBindingSlot => {
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
        runtime._resolveMessage({
            code: 'input.invalid-slot',
            value: slot ?? binding.type,
        })
    );
};

const patchBindingControl = (
    binding: InputBinding,
    slot: InputBindingSlot,
    control: InputControlPath
): InputBinding => {
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
        String(slot)
    );
};
