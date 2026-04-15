import type { AssetRecord } from '@axrone/asset-core';
import {
    isAudioClipAssetRecord,
    normalizeAudioClipId,
} from './reference';
import type {
    AudioAssetSchema,
    AudioClipAssetData,
    AudioClipAssetSelector,
    AudioClipInput,
    AudioClipSelector,
    AudioInlineClipSelector,
    AudioRegisteredClipSelector,
} from './types';

const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
    typeof value === 'object' && value !== null;

const hasFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isFloat32ArrayList = (value: unknown): value is readonly Float32Array[] =>
    Array.isArray(value) && value.every((entry) => entry instanceof Float32Array);

export const AUDIO_CLIP_ASSET_KIND = 'audioClip' as const;

export const isAudioClipAssetData = (value: unknown): value is AudioClipAssetData => {
    if (!isObject(value) || typeof value.kind !== 'string') {
        return false;
    }

    switch (value.kind) {
        case 'buffer':
            return typeof AudioBuffer !== 'undefined' ? value.buffer instanceof AudioBuffer : 'buffer' in value;
        case 'pcm':
            return hasFiniteNumber(value.sampleRate) && isFloat32ArrayList(value.channelData);
        case 'encoded':
            return value.data instanceof ArrayBuffer || ArrayBuffer.isView(value.data);
        case 'url':
            return typeof value.url === 'string' && value.url.length > 0;
        default:
            return false;
    }
};

export const isAudioClipSelector = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    value: unknown
): value is AudioClipSelector<TSchema> => {
    if (!isObject(value) || typeof value.kind !== 'string') {
        return false;
    }

    switch (value.kind) {
        case 'registered':
            return typeof value.clipId === 'string';
        case 'asset':
            return 'selector' in value;
        case 'inline':
            return isAudioClipAssetData(value.clip);
        default:
            return false;
    }
};

export const createRegisteredAudioClipSelector = (
    clipId: string
): AudioRegisteredClipSelector => ({
    kind: 'registered',
    clipId: normalizeAudioClipId(clipId),
});

export const createInlineAudioClipSelector = (
    clip: AudioClipAssetData
): AudioInlineClipSelector => ({
    kind: 'inline',
    clip,
});

export const toAudioClipSelector = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    value: AudioClipInput<TSchema> | undefined
): AudioClipSelector<TSchema> | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) {
        return createInlineAudioClipSelector({ kind: 'buffer', buffer: value }) as AudioClipSelector<TSchema>;
    }

    if (isAudioClipSelector<TSchema>(value)) {
        return value;
    }

    if (isAudioClipAssetData(value)) {
        return createInlineAudioClipSelector(value) as AudioClipSelector<TSchema>;
    }

    return {
        kind: 'asset',
        selector: value as AudioClipAssetSelector<TSchema>,
    };
};

export const toAudioClipSelectorFromRecord = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    value: AudioClipAssetSelector<TSchema> | AssetRecord<TSchema>
): AudioClipSelector<TSchema> => {
    if (isAudioClipAssetRecord(value)) {
        return {
            kind: 'asset',
            selector: value as AudioClipAssetSelector<TSchema>,
        };
    }

    return {
        kind: 'asset',
        selector: value,
    };
};