import { AudioListenerError } from '../errors';
import { normalizeAudioListenerId } from '../reference';
import type {
    AudioListenerDescriptor,
    AudioListenerId,
    AudioListenerState,
} from '../types';
import type { InternalListener } from './runtime';
import {
    DEFAULT_LISTENER_FORWARD,
    DEFAULT_LISTENER_POSITION,
    DEFAULT_LISTENER_UP,
    cloneMetadata,
    normalizeVector3,
} from './shared';
import { syncAudioListenerToContext } from './spatial';

export class AudioListenerRegistry {
    readonly #listeners = new Map<AudioListenerId, InternalListener>();

    #activeListenerId?: AudioListenerId;

    get activeListenerId(): AudioListenerId | undefined {
        return this.#activeListenerId;
    }

    upsert(descriptor: AudioListenerDescriptor): AudioListenerState {
        const id = normalizeAudioListenerId(descriptor.id ?? 'default');
        let listener = this.#listeners.get(id);

        if (!listener) {
            listener = {
                id,
                active: descriptor.active ?? this.#listeners.size === 0,
                enabled: descriptor.enabled ?? true,
                position: normalizeVector3(descriptor.position, DEFAULT_LISTENER_POSITION),
                forward: normalizeVector3(descriptor.forward, DEFAULT_LISTENER_FORWARD),
                up: normalizeVector3(descriptor.up, DEFAULT_LISTENER_UP),
                metadata: cloneMetadata(descriptor.metadata),
            };
            this.#listeners.set(id, listener);
        }

        if (descriptor.active !== undefined) {
            listener.active = descriptor.active;
        }
        if (descriptor.enabled !== undefined) {
            listener.enabled = descriptor.enabled;
        }
        if (descriptor.position !== undefined) {
            listener.position = normalizeVector3(descriptor.position, DEFAULT_LISTENER_POSITION);
        }
        if (descriptor.forward !== undefined) {
            listener.forward = normalizeVector3(descriptor.forward, DEFAULT_LISTENER_FORWARD);
        }
        if (descriptor.up !== undefined) {
            listener.up = normalizeVector3(descriptor.up, DEFAULT_LISTENER_UP);
        }
        if (descriptor.metadata !== undefined) {
            listener.metadata = cloneMetadata(descriptor.metadata);
        }

        if (listener.active) {
            this.#activate(listener.id);
        } else if (this.#activeListenerId === listener.id || !this.#activeListenerId) {
            this.#activeListenerId = this.#findFallbackListenerId();
        }

        return this.snapshot(listener.id);
    }

    remove(id: AudioListenerId | string): boolean {
        const normalizedId = normalizeAudioListenerId(id);
        const removed = this.#listeners.delete(normalizedId);
        if (!removed) {
            return false;
        }

        if (this.#activeListenerId === normalizedId) {
            this.#activeListenerId = this.#findFallbackListenerId();
        }
        return true;
    }

    setActive(id: AudioListenerId | string): void {
        const normalizedId = normalizeAudioListenerId(id);
        const listener = this.#listeners.get(normalizedId);
        if (!listener) {
            throw new AudioListenerError(`Audio listener ${normalizedId} does not exist`, normalizedId);
        }
        this.#activate(listener.id);
    }

    get(id: AudioListenerId | string): AudioListenerState | undefined {
        const listener = this.#listeners.get(normalizeAudioListenerId(id));
        return listener ? this.snapshot(listener.id) : undefined;
    }

    list(): readonly AudioListenerState[] {
        return Object.freeze([...this.#listeners.values()].map((listener) => this.snapshot(listener.id)));
    }

    snapshot(id: AudioListenerId): AudioListenerState {
        const listener = this.require(id);
        return Object.freeze({
            id: listener.id,
            active: listener.active,
            enabled: listener.enabled,
            position: normalizeVector3(listener.position, DEFAULT_LISTENER_POSITION),
            forward: normalizeVector3(listener.forward, DEFAULT_LISTENER_FORWARD),
            up: normalizeVector3(listener.up, DEFAULT_LISTENER_UP),
            metadata: listener.metadata,
        });
    }

    activeRuntime(): InternalListener | undefined {
        return this.#activeListenerId ? this.#listeners.get(this.#activeListenerId) : undefined;
    }

    audibleRuntime(): InternalListener | undefined {
        const listener = this.activeRuntime();
        return listener?.enabled ? listener : undefined;
    }

    syncToContext(audioListener: AudioListener): void {
        syncAudioListenerToContext(audioListener, this.audibleRuntime());
    }

    require(id: AudioListenerId | string): InternalListener {
        const normalizedId = normalizeAudioListenerId(id);
        const listener = this.#listeners.get(normalizedId);
        if (!listener) {
            throw new AudioListenerError(`Audio listener ${normalizedId} does not exist`, normalizedId);
        }
        return listener;
    }

    clear(): void {
        this.#listeners.clear();
        this.#activeListenerId = undefined;
    }

    #activate(id: AudioListenerId): void {
        for (const candidate of this.#listeners.values()) {
            candidate.active = candidate.id === id;
        }
        this.#activeListenerId = id;
    }

    #findFallbackListenerId(): AudioListenerId | undefined {
        let fallbackId: AudioListenerId | undefined;
        for (const listener of this.#listeners.values()) {
            const shouldActivate = fallbackId === undefined && listener.enabled;
            listener.active = shouldActivate;
            if (shouldActivate) {
                fallbackId = listener.id;
            }
        }
        return fallbackId;
    }
}
