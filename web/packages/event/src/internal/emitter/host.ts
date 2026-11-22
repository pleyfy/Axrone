import type { EventKey, EventMap, EventPriority } from '../../definition';
import type { EmitterState } from './state';

export type EmitOptions = { priority?: EventPriority };

export interface EmitterHost<T extends EventMap = EventMap> {
    readonly state: EmitterState;
    offById(subscriptionId: symbol): boolean;
    emit<K extends EventKey<T>>(event: K, data: T[K], options?: EmitOptions): Promise<boolean>;
    emitSync<K extends EventKey<T>>(event: K, data: T[K], options?: EmitOptions): boolean;
}

export type EmitterHostTarget<T extends EventMap = EventMap> = Omit<EmitterHost<T>, 'state'>;

export function createEmitterHost<T extends EventMap = EventMap>(
    state: EmitterState,
    target: EmitterHostTarget<T>
): EmitterHost<T> {
    return {
        state,
        offById: (subscriptionId) => target.offById(subscriptionId),
        emit: (event, data, options) => target.emit(event, data, options),
        emitSync: (event, data, options) => target.emitSync(event, data, options),
    };
}
