import { AudioBusError } from '../errors';
import {
    MASTER_AUDIO_BUS_ID,
    normalizeAudioBusId,
} from '../reference';
import type {
    AudioBusDefinition,
    AudioBusId,
    AudioBusState,
    AudioJsonValue,
    AudioMessageDescriptor,
    AudioMixerSnapshot,
    AudioSnapshotTransitionOptions,
} from '../types';
import type { InternalBus } from './runtime';
import {
    cloneMetadata,
    disconnectNode,
    setParamValue,
} from './shared';

export interface AudioBusRegistryOptions {
    readonly context: AudioContext;
    readonly destination: AudioNode;
    readonly createConfigurationError: (descriptor: AudioMessageDescriptor) => Error;
    readonly normalizeGain: (
        value: number,
        code: 'audio.invalid-gain' | 'audio.invalid-distance'
    ) => number;
    readonly normalizePan: (value: number) => number;
}

export interface AudioBusRemovalResult {
    readonly removed: boolean;
    readonly fallbackBusId?: AudioBusId;
}

export class AudioBusRegistry {
    readonly #context: AudioContext;
    readonly #destination: AudioNode;
    readonly #createConfigurationError: AudioBusRegistryOptions['createConfigurationError'];
    readonly #normalizeGain: AudioBusRegistryOptions['normalizeGain'];
    readonly #normalizePan: AudioBusRegistryOptions['normalizePan'];
    readonly #buses = new Map<AudioBusId, InternalBus>();

    constructor(options: AudioBusRegistryOptions) {
        this.#context = options.context;
        this.#destination = options.destination;
        this.#createConfigurationError = options.createConfigurationError;
        this.#normalizeGain = options.normalizeGain;
        this.#normalizePan = options.normalizePan;

        const master = this.#createRuntime({ id: MASTER_AUDIO_BUS_ID });
        this.#buses.set(MASTER_AUDIO_BUS_ID, master);
        this.#connect(master);
    }

    initialize(definitions: readonly AudioBusDefinition[]): void {
        for (const definition of definitions) {
            this.upsert({ ...definition, parentId: undefined });
        }

        for (const definition of definitions) {
            if (definition.parentId !== undefined) {
                this.upsert({ id: definition.id, parentId: definition.parentId });
            }
        }
    }

    upsert(definition: AudioBusDefinition): AudioBusState {
        const id = normalizeAudioBusId(definition.id);
        const parentId =
            definition.parentId === undefined ? undefined : normalizeAudioBusId(definition.parentId);

        if (id === MASTER_AUDIO_BUS_ID && parentId !== undefined) {
            throw this.#createConfigurationError({
                code: 'audio.invalid-parent-bus',
                value: parentId,
            });
        }
        if (parentId === id) {
            throw this.#createConfigurationError({
                code: 'audio.bus.cycle',
                busId: id,
                parentId,
            });
        }
        if (parentId !== undefined && !this.#buses.has(parentId)) {
            throw new AudioBusError(`Audio bus ${parentId} does not exist`, parentId);
        }
        if (parentId && this.#createsCycle(id, parentId)) {
            throw this.#createConfigurationError({
                code: 'audio.bus.cycle',
                busId: id,
                parentId,
            });
        }

        const isNew = !this.#buses.has(id);
        let bus = this.#buses.get(id);
        if (!bus) {
            bus = this.#createRuntime({ id });
            this.#buses.set(id, bus);
        }

        if (isNew || bus.parentId !== parentId) {
            if (bus.parentId) {
                this.#buses.get(bus.parentId)?.childIds.delete(bus.id);
            }
            bus.parentId = parentId;
            if (parentId) {
                this.#buses.get(parentId)?.childIds.add(bus.id);
            }
            this.#connect(bus);
        }

        if (definition.volume !== undefined) {
            bus.volume = this.#normalizeGain(definition.volume, 'audio.invalid-gain');
        }
        if (definition.mute !== undefined) {
            bus.mute = definition.mute;
        }
        if (definition.pan !== undefined) {
            bus.pan = this.#normalizePan(definition.pan);
        }
        if (definition.metadata !== undefined) {
            bus.metadata = cloneMetadata(definition.metadata);
        }

        this.#applyState(bus);
        return this.snapshot(bus.id);
    }

    remove(id: AudioBusId | string): AudioBusRemovalResult {
        const normalizedId = normalizeAudioBusId(id);
        if (normalizedId === MASTER_AUDIO_BUS_ID) {
            return { removed: false };
        }

        const bus = this.#buses.get(normalizedId);
        if (!bus) {
            return { removed: false };
        }

        const fallbackBusId = bus.parentId ?? MASTER_AUDIO_BUS_ID;
        const fallbackBus = this.require(fallbackBusId);

        for (const childId of bus.childIds) {
            const child = this.#buses.get(childId);
            if (!child) {
                continue;
            }

            child.parentId = fallbackBusId;
            fallbackBus.childIds.add(childId);
            this.#connect(child);
        }

        if (bus.parentId) {
            this.#buses.get(bus.parentId)?.childIds.delete(normalizedId);
        }

        disconnectNode(bus.outputNode);
        disconnectNode(bus.gainNode);
        disconnectNode(bus.panNode);
        this.#buses.delete(normalizedId);

        return {
            removed: true,
            fallbackBusId,
        };
    }

    require(id: AudioBusId | string): InternalBus {
        const normalizedId = normalizeAudioBusId(id);
        const bus = this.#buses.get(normalizedId);
        if (!bus) {
            throw new AudioBusError(`Audio bus ${normalizedId} does not exist`, normalizedId);
        }
        return bus;
    }

    get(id: AudioBusId | string): AudioBusState | undefined {
        const bus = this.#buses.get(normalizeAudioBusId(id));
        return bus ? this.snapshot(bus.id) : undefined;
    }

    list(): readonly AudioBusState[] {
        return Object.freeze([...this.#buses.values()].map((bus) => this.snapshot(bus.id)));
    }

    snapshot(id: AudioBusId): AudioBusState {
        const bus = this.require(id);
        return Object.freeze({
            id: bus.id,
            parentId: bus.parentId,
            volume: bus.volume,
            mute: bus.mute,
            pan: bus.pan,
            effectiveGain: this.#effectiveGain(bus.id),
            childIds: Object.freeze([...bus.childIds]),
            metadata: bus.metadata,
        });
    }

    captureSnapshot(id?: string): AudioMixerSnapshot {
        return Object.freeze({
            id,
            buses: Object.freeze(
                [...this.#buses.values()].map((bus) =>
                    Object.freeze({
                        id: bus.id,
                        volume: bus.volume,
                        mute: bus.mute,
                        pan: bus.pan,
                    })
                )
            ),
        });
    }

    applySnapshot(
        snapshot: AudioMixerSnapshot,
        options: AudioSnapshotTransitionOptions = {}
    ): void {
        const atTime = options.atTime ?? this.#context.currentTime;
        const durationSeconds = options.durationSeconds ?? 0;

        for (const entry of snapshot.buses) {
            const bus = this.#buses.get(normalizeAudioBusId(entry.id));
            if (!bus) {
                continue;
            }

            if (entry.volume !== undefined) {
                bus.volume = this.#normalizeGain(entry.volume, 'audio.invalid-gain');
            }
            if (entry.mute !== undefined) {
                bus.mute = entry.mute;
            }
            if (entry.pan !== undefined) {
                bus.pan = this.#normalizePan(entry.pan);
            }
            this.#applyState(bus, { atTime, durationSeconds });
        }
    }

    clear(): void {
        for (const [id, bus] of [...this.#buses]) {
            if (id === MASTER_AUDIO_BUS_ID) {
                bus.childIds.clear();
                bus.parentId = undefined;
                bus.volume = 1;
                bus.mute = false;
                bus.pan = 0;
                bus.metadata = Object.freeze({});
                this.#connect(bus);
                continue;
            }

            disconnectNode(bus.outputNode);
            disconnectNode(bus.gainNode);
            disconnectNode(bus.panNode);
            this.#buses.delete(id);
        }
    }

    #createRuntime(definition: Pick<AudioBusDefinition, 'id' | 'parentId'>): InternalBus {
        const gainNode = this.#context.createGain();
        const panNode =
            typeof this.#context.createStereoPanner === 'function'
                ? this.#context.createStereoPanner()
                : undefined;
        let outputNode: AudioNode = gainNode;
        if (panNode) {
            gainNode.connect(panNode);
            outputNode = panNode;
        }

        return {
            id: normalizeAudioBusId(definition.id),
            parentId: definition.parentId ? normalizeAudioBusId(definition.parentId) : undefined,
            gainNode,
            panNode,
            outputNode,
            childIds: new Set<AudioBusId>(),
            volume: 1,
            mute: false,
            pan: 0,
            metadata: Object.freeze({}) as Readonly<Record<string, AudioJsonValue>>,
        };
    }

    #connect(bus: InternalBus): void {
        disconnectNode(bus.outputNode);
        const parent = bus.parentId ? this.#buses.get(bus.parentId) : undefined;
        bus.outputNode.connect(parent?.gainNode ?? this.#destination);
        this.#applyState(bus);
    }

    #applyState(
        bus: InternalBus,
        options: { atTime?: number; durationSeconds?: number } = {}
    ): void {
        const atTime = options.atTime ?? this.#context.currentTime;
        const durationSeconds = options.durationSeconds ?? 0;
        setParamValue(bus.gainNode.gain, bus.mute ? 0 : bus.volume, atTime, durationSeconds);
        if (bus.panNode) {
            setParamValue(bus.panNode.pan, bus.pan, atTime, durationSeconds);
        }
    }

    #effectiveGain(id: AudioBusId): number {
        let gain = 1;
        let current: AudioBusId | undefined = id;
        while (current) {
            const bus = this.#buses.get(current);
            if (!bus) {
                break;
            }
            gain *= bus.mute ? 0 : bus.volume;
            current = bus.parentId;
        }
        return gain;
    }

    #createsCycle(id: AudioBusId, parentId: AudioBusId): boolean {
        let current: AudioBusId | undefined = parentId;
        while (current) {
            if (current === id) {
                return true;
            }
            current = this.#buses.get(current)?.parentId;
        }
        return false;
    }
}
