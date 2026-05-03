import type { AssetRecord } from '@axrone/asset-core';
import { isAudioClipAssetData, toAudioClipSelector } from '../asset';
import { AudioAssetError } from '../errors';
import {
    isAudioClipAssetRecord,
    normalizeAudioClipId,
} from '../reference';
import type {
    AudioAssetResolver,
    AudioAssetSchema,
    AudioClipAssetData,
    AudioClipAssetSelector,
    AudioClipId,
    AudioClipInput,
    AudioClipRecord,
    AudioClipSelector,
    AudioJsonValue,
    AudioRetryPolicy,
    AudioSystemOptions,
} from '../types';
import { cloneMetadata, isObject, withRetry } from './shared';

export interface AudioClipStoreOptions<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly context: AudioContext;
    readonly assetDatabase?: AudioSystemOptions<TSchema>['assetDatabase'];
    readonly assetResolver?: AudioAssetResolver<TSchema>;
    readonly retryPolicy?: AudioRetryPolicy<TSchema>;
}

export class AudioClipStore<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly #context: AudioContext;
    readonly #assetDatabase?: AudioSystemOptions<TSchema>['assetDatabase'];
    readonly #assetResolver?: AudioAssetResolver<TSchema>;
    readonly #retryPolicy?: AudioRetryPolicy<TSchema>;
    readonly #registeredClips = new Map<AudioClipId, AudioClipSelector<TSchema>>();
    readonly #clipCache = new Map<string, Promise<AudioClipRecord<TSchema>>>();
    readonly #bufferCacheKeys = new WeakMap<AudioBuffer, string>();

    #bufferCacheSequence = 0;

    constructor(options: AudioClipStoreOptions<TSchema>) {
        this.#context = options.context;
        this.#assetDatabase = options.assetDatabase;
        this.#assetResolver = options.assetResolver;
        this.#retryPolicy = options.retryPolicy;
    }

    register(id: AudioClipId | string, clip: AudioClipInput<TSchema>): AudioClipId {
        const normalizedId = normalizeAudioClipId(id);
        const selector = toAudioClipSelector(clip);
        if (!selector) {
            throw new AudioAssetError('Audio clip selector could not be created');
        }

        this.#registeredClips.set(normalizedId, selector);
        this.#invalidate({ kind: 'registered', clipId: normalizedId });
        return normalizedId;
    }

    unregister(id: AudioClipId | string): boolean {
        const normalizedId = normalizeAudioClipId(id);
        this.#invalidate({ kind: 'registered', clipId: normalizedId });
        return this.#registeredClips.delete(normalizedId);
    }

    async resolve(input: AudioClipInput<TSchema>): Promise<AudioClipRecord<TSchema>> {
        const selector = toAudioClipSelector(input);
        if (!selector) {
            throw new AudioAssetError('Audio clip selector could not be created');
        }

        return this.resolveSelector(selector);
    }

    async resolveSelector(selector: AudioClipSelector<TSchema>): Promise<AudioClipRecord<TSchema>> {
        const cacheKey = this.#cacheKeyForSelector(selector);
        const useCache = cacheKey !== undefined;

        if (useCache) {
            const cached = this.#clipCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const pending = withRetry(
            this.#retryPolicy,
            (attempt) => ({ operation: 'asset.resolve', attempt, clip: selector }),
            async () => this.#decodeSelector(selector)
        );

        if (useCache) {
            this.#clipCache.set(cacheKey, pending);
        }

        try {
            return await pending;
        } catch (error) {
            if (useCache) {
                this.#clipCache.delete(cacheKey);
            }
            throw error;
        }
    }

    clear(): void {
        this.#registeredClips.clear();
        this.#clipCache.clear();
    }

    #invalidate(selector: AudioClipSelector<TSchema>): void {
        const cacheKey = this.#cacheKeyForSelector(selector);
        if (cacheKey) {
            this.#clipCache.delete(cacheKey);
        }
    }

    async #decodeSelector(selector: AudioClipSelector<TSchema>): Promise<AudioClipRecord<TSchema>> {
        switch (selector.kind) {
            case 'registered': {
                const registered = this.#registeredClips.get(selector.clipId);
                if (!registered) {
                    throw new AudioAssetError(`Registered audio clip ${selector.clipId} does not exist`);
                }

                return this.resolveSelector(registered);
            }
            case 'asset': {
                const resolved = await this.#resolveAssetClip(selector.selector);
                if (isAudioClipAssetRecord(resolved)) {
                    if (!isAudioClipAssetData(resolved.data)) {
                        throw new AudioAssetError('Resolved asset record does not contain audio clip data');
                    }

                    return this.#decodeClipData(selector, resolved.data, resolved.data.metadata);
                }

                return this.#decodeClipData(selector, resolved, resolved.metadata);
            }
            case 'inline':
                return this.#decodeClipData(selector, selector.clip, selector.clip.metadata);
            default:
                throw new AudioAssetError('Unsupported audio clip selector');
        }
    }

    async #resolveAssetClip(
        selector: AudioClipAssetSelector<TSchema>
    ): Promise<AssetRecord<TSchema> | AudioClipAssetData> {
        const fromResolver = await this.#assetResolver?.resolveClip(selector);
        if (fromResolver) {
            return fromResolver as AssetRecord<TSchema> | AudioClipAssetData;
        }

        const record = this.#assetDatabase?.get(selector);
        if (!record) {
            throw new AudioAssetError(`Audio asset could not be resolved for selector ${JSON.stringify(selector)}`);
        }

        return record;
    }

    async #decodeClipData(
        selector: AudioClipSelector<TSchema>,
        data: AudioClipAssetData,
        metadata?: Readonly<Record<string, AudioJsonValue>>
    ): Promise<AudioClipRecord<TSchema>> {
        let buffer: AudioBuffer;
        switch (data.kind) {
            case 'buffer':
                buffer = data.buffer;
                break;
            case 'pcm':
                buffer = this.#createBufferFromPcm(data);
                break;
            case 'encoded':
                buffer = await this.#context.decodeAudioData(this.#toArrayBuffer(data.data));
                break;
            case 'url': {
                const response = await fetch(data.url, {
                    credentials: data.credentials,
                    headers: data.headers,
                });
                if (!response.ok) {
                    throw new AudioAssetError(`Failed to fetch audio clip ${data.url}`);
                }
                buffer = await this.#context.decodeAudioData(await response.arrayBuffer());
                break;
            }
            default:
                throw new AudioAssetError('Unsupported audio clip asset data');
        }

        return Object.freeze({
            id: normalizeAudioClipId(this.#cacheKeyForSelector(selector) ?? `clip:${++this.#bufferCacheSequence}`),
            selector,
            buffer,
            durationSeconds: buffer.duration,
            sampleRate: buffer.sampleRate,
            channelCount: buffer.numberOfChannels,
            loopStartSeconds: data.loopStartSeconds,
            loopEndSeconds: data.loopEndSeconds,
            metadata: cloneMetadata(metadata),
        });
    }

    #createBufferFromPcm(data: Extract<AudioClipAssetData, { kind: 'pcm' }>): AudioBuffer {
        const frameLength = data.channelData[0]?.length ?? 0;
        const buffer = this.#context.createBuffer(data.channelData.length, frameLength, data.sampleRate);
        data.channelData.forEach((channel, index) => {
            buffer.copyToChannel(channel, index);
        });
        return buffer;
    }

    #toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
        if (value instanceof ArrayBuffer) {
            return value.slice(0);
        }

        const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return view.slice().buffer;
    }

    #cacheKeyForSelector(selector: AudioClipSelector<TSchema>): string | undefined {
        switch (selector.kind) {
            case 'registered':
                return `registered:${selector.clipId}`;
            case 'asset':
                return this.#assetSelectorCacheKey(selector.selector);
            case 'inline':
                switch (selector.clip.kind) {
                    case 'buffer': {
                        const cached = this.#bufferCacheKeys.get(selector.clip.buffer);
                        if (cached) {
                            return cached;
                        }

                        const key = `buffer:${++this.#bufferCacheSequence}`;
                        this.#bufferCacheKeys.set(selector.clip.buffer, key);
                        return key;
                    }
                    case 'url':
                        return `url:${selector.clip.url}`;
                    default:
                        return undefined;
                }
            default:
                return undefined;
        }
    }

    #assetSelectorCacheKey(selector: AudioClipAssetSelector<TSchema>): string {
        if (typeof selector === 'string') {
            return `asset:string:${selector}`;
        }
        if (isObject(selector) && 'token' in selector && typeof selector.token === 'string') {
            return `asset:token:${selector.token}`;
        }
        if (isObject(selector) && 'id' in selector && 'revision' in selector) {
            return `asset:record:${String(selector.id)}:${String(selector.revision)}`;
        }
        if (isObject(selector) && 'key' in selector && typeof selector.key === 'string') {
            return `asset:key:${selector.key}:${'kind' in selector ? String(selector.kind ?? '') : ''}`;
        }

        return `asset:json:${JSON.stringify(selector)}`;
    }
}
