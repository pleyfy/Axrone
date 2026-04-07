import type {
    AssetMessageCode,
    AssetMessageDescriptor,
    AssetMessageResolver,
} from './types';

const formatUnknown = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof Error) {
        return value.message;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

export const DEFAULT_ASSET_MESSAGE_RESOLVER: AssetMessageResolver = (
    descriptor: Readonly<AssetMessageDescriptor>
): string | undefined => {
    switch (descriptor.code) {
        case 'asset.invalid-id':
            return `Invalid asset id: ${formatUnknown(descriptor.value)}`;
        case 'asset.invalid-importer':
            return `Invalid asset importer: ${formatUnknown(descriptor.value)}`;
        case 'asset.invalid-key':
            return `Invalid asset key: ${formatUnknown(descriptor.value)}`;
        case 'asset.invalid-kind':
            return `Invalid asset kind: ${formatUnknown(descriptor.value)}`;
        case 'asset.invalid-revision':
            return `Invalid asset revision: ${formatUnknown(descriptor.value)}`;
        case 'asset.invalid-source':
            return `Invalid asset source: ${formatUnknown(descriptor.value)}`;
        case 'asset.conflict.key-bound':
            return `Asset key "${descriptor.key}" is already bound to ${descriptor.currentId}; requested ${descriptor.requestedId}`;
        case 'asset.conflict.kind-mismatch':
            return `Asset ${descriptor.id} expected kind "${descriptor.expected}" but received "${descriptor.received}"`;
        case 'asset.dependency.missing':
            return `Missing asset dependency: ${descriptor.dependency}`;
        case 'asset.disposed':
            return 'Asset database has been disposed';
        case 'asset.import.failed':
            return `Asset import failed in importer "${descriptor.importerId}" on attempt ${descriptor.attempt}: ${formatUnknown(descriptor.reason)}`;
        case 'asset.importer.not-found':
            return `No asset importer found for source kind "${descriptor.sourceKind}"${descriptor.uri ? ` (${descriptor.uri})` : ''}${descriptor.mimeType ? ` with mime type "${descriptor.mimeType}"` : ''}`;
        case 'asset.lifecycle.dispose-failed':
            return `Failed to dispose asset ${descriptor.id} (${descriptor.kind}): ${formatUnknown(descriptor.reason)}`;
        case 'asset.reference.invalid':
            return `Invalid asset reference: ${formatUnknown(descriptor.value)}`;
        case 'asset.snapshot.invalid':
            return `Invalid asset snapshot: ${descriptor.reason}`;
        default:
            return undefined;
    }
};

export const resolveAssetMessage = (
    descriptor: Readonly<AssetMessageDescriptor>,
    locale: string,
    resolver?: AssetMessageResolver
): string => {
    const resolved = resolver?.(descriptor, locale) ?? DEFAULT_ASSET_MESSAGE_RESOLVER(descriptor, locale);
    return resolved ?? descriptor.code;
};

export class AssetError extends Error {
    override readonly name: string;
    readonly code: AssetMessageCode;

    constructor(name: string, code: AssetMessageCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = name;
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class AssetConfigurationError extends AssetError {
    constructor(code: AssetMessageCode, message: string, options?: ErrorOptions) {
        super('AssetConfigurationError', code, message, options);
    }
}

export class AssetConflictError extends AssetError {
    constructor(
        code: 'asset.conflict.key-bound' | 'asset.conflict.kind-mismatch',
        message: string,
        options?: ErrorOptions
    ) {
        super('AssetConflictError', code, message, options);
    }
}

export class AssetDisposedError extends AssetError {
    constructor(message: string, options?: ErrorOptions) {
        super('AssetDisposedError', 'asset.disposed', message, options);
    }
}

export class AssetImporterNotFoundError extends AssetError {
    constructor(message: string, options?: ErrorOptions) {
        super('AssetImporterNotFoundError', 'asset.importer.not-found', message, options);
    }
}

export class AssetImportError extends AssetError {
    readonly importerId: string;
    readonly attempt: number;

    constructor(message: string, importerId: string, attempt: number, options?: ErrorOptions) {
        super('AssetImportError', 'asset.import.failed', message, options);
        this.importerId = importerId;
        this.attempt = attempt;
    }
}

export class AssetReferenceError extends AssetError {
    constructor(message: string, options?: ErrorOptions) {
        super('AssetReferenceError', 'asset.reference.invalid', message, options);
    }
}

export class AssetDependencyError extends AssetError {
    readonly dependency: string;

    constructor(message: string, dependency: string, options?: ErrorOptions) {
        super('AssetDependencyError', 'asset.dependency.missing', message, options);
        this.dependency = dependency;
    }
}

export class AssetSnapshotError extends AssetError {
    constructor(message: string, options?: ErrorOptions) {
        super('AssetSnapshotError', 'asset.snapshot.invalid', message, options);
    }
}

export class AssetLifecycleError extends AssetError {
    readonly id: string;
    readonly kind: string;

    constructor(message: string, id: string, kind: string, options?: ErrorOptions) {
        super('AssetLifecycleError', 'asset.lifecycle.dispose-failed', message, options);
        this.id = id;
        this.kind = kind;
    }
}
