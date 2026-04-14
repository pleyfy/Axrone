import type {
    AudioMessageCode,
    AudioMessageDescriptor,
    AudioMessageResolver,
    AudioRuntimeMessageCode,
    AudioValidationMessageCode,
} from './types';

const formatUnknown = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

export const DEFAULT_AUDIO_MESSAGE_RESOLVER: AudioMessageResolver = (
    descriptor: AudioMessageDescriptor
): string | undefined => {
    switch (descriptor.code) {
        case 'audio.invalid-bus-id':
            return `Invalid audio bus id: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-clip':
            return `Invalid audio clip input: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-context':
            return `Invalid audio context: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-distance':
            return `Invalid audio distance value: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-gain':
            return `Invalid audio gain value: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-listener':
            return `Invalid audio listener input: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-pan':
            return `Invalid audio pan value: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-parent-bus':
            return `Invalid audio parent bus: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-playback-rate':
            return `Invalid audio playback rate: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-source':
            return `Invalid audio source input: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-snapshot':
            return `Invalid audio snapshot: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-time':
            return `Invalid audio time value: ${formatUnknown(descriptor.value)}`;
        case 'audio.invalid-vector':
            return `Invalid audio vector value: ${formatUnknown(descriptor.value)}`;
        case 'audio.bus.cycle':
            return `Audio bus cycle detected between ${descriptor.busId} and ${descriptor.parentId}`;
        case 'audio.asset.resolve-failed':
            return `Failed to resolve audio asset ${formatUnknown(descriptor.selector)}: ${formatUnknown(descriptor.reason)}`;
        case 'audio.bus.missing':
            return `Audio bus not found: ${descriptor.busId}`;
        case 'audio.context.resume-failed':
            return `Failed to resume audio context: ${formatUnknown(descriptor.reason)}`;
        case 'audio.context.suspend-failed':
            return `Failed to suspend audio context: ${formatUnknown(descriptor.reason)}`;
        case 'audio.disposed':
            return 'Audio system has already been disposed';
        case 'audio.listener.missing':
            return `Audio listener not found: ${descriptor.listenerId}`;
        case 'audio.snapshot.invalid':
            return `Audio snapshot is invalid: ${descriptor.reason}`;
        case 'audio.source.missing':
            return `Audio source not found: ${descriptor.sourceId}`;
        case 'audio.source.play-failed':
            return `Failed to play audio source ${descriptor.sourceId}: ${formatUnknown(descriptor.reason)}`;
        case 'audio.source.resume-failed':
            return `Failed to resume audio source ${descriptor.sourceId}: ${formatUnknown(descriptor.reason)}`;
        case 'audio.unavailable':
            return `Audio system is unavailable: ${descriptor.reason}`;
        default:
            return undefined;
    }
};

export const resolveAudioMessage = (
    descriptor: AudioMessageDescriptor,
    locale = 'en',
    resolver: AudioMessageResolver = DEFAULT_AUDIO_MESSAGE_RESOLVER
): string => resolver(descriptor, locale) ?? DEFAULT_AUDIO_MESSAGE_RESOLVER(descriptor, locale) ?? descriptor.code;

export class AudioError extends Error {
    override readonly name: string;
    readonly code: AudioMessageCode;

    constructor(name: string, code: AudioMessageCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = name;
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class AudioConfigurationError extends AudioError {
    constructor(code: AudioValidationMessageCode, message: string, options?: ErrorOptions) {
        super('AudioConfigurationError', code, message, options);
    }
}

export class AudioLifecycleError extends AudioError {
    constructor(
        code: 'audio.context.resume-failed' | 'audio.context.suspend-failed',
        message: string,
        options?: ErrorOptions
    ) {
        super('AudioLifecycleError', code, message, options);
    }
}

export class AudioDisposedError extends AudioError {
    constructor(message: string, options?: ErrorOptions) {
        super('AudioDisposedError', 'audio.disposed', message, options);
    }
}

export class AudioUnavailableError extends AudioError {
    constructor(message: string, options?: ErrorOptions) {
        super('AudioUnavailableError', 'audio.unavailable', message, options);
    }
}

export class AudioAssetError extends AudioError {
    constructor(message: string, options?: ErrorOptions) {
        super('AudioAssetError', 'audio.asset.resolve-failed', message, options);
    }
}

export class AudioBusError extends AudioError {
    readonly busId: string;

    constructor(message: string, busId: string, options?: ErrorOptions) {
        super('AudioBusError', 'audio.bus.missing', message, options);
        this.busId = busId;
    }
}

export class AudioListenerError extends AudioError {
    readonly listenerId: string;

    constructor(message: string, listenerId: string, options?: ErrorOptions) {
        super('AudioListenerError', 'audio.listener.missing', message, options);
        this.listenerId = listenerId;
    }
}

export class AudioSourceError extends AudioError {
    readonly sourceId: string;

    constructor(
        code: 'audio.source.missing' | 'audio.source.play-failed' | 'audio.source.resume-failed',
        message: string,
        sourceId: string,
        options?: ErrorOptions
    ) {
        super('AudioSourceError', code, message, options);
        this.sourceId = sourceId;
    }
}

export class AudioSnapshotError extends AudioError {
    constructor(message: string, options?: ErrorOptions) {
        super('AudioSnapshotError', 'audio.snapshot.invalid', message, options);
    }
}