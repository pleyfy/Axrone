import type {
    InputMessageCode,
    InputMessageDescriptor,
    InputMessageResolver,
    InputValidationMessageCode,
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

export const DEFAULT_INPUT_MESSAGE_RESOLVER: InputMessageResolver = (
    descriptor: Readonly<InputMessageDescriptor>
): string | undefined => {
    switch (descriptor.code) {
        case 'input.invalid-action':
            return `Invalid input action: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-binding':
            return `Invalid input binding: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-context':
            return `Invalid input context: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-control-path':
            return `Invalid input control path: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-priority':
            return `Invalid input context priority: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-rebind':
            return `Invalid input rebind request: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-slot':
            return `Invalid input binding slot: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-snapshot':
            return `Invalid input snapshot: ${descriptor.reason}`;
        case 'input.invalid-target':
            return `Invalid input target: ${formatUnknown(descriptor.value)}`;
        case 'input.invalid-user':
            return `Invalid input user: ${formatUnknown(descriptor.value)}`;
        case 'input.context.conflict':
            return `Input context "${descriptor.id}" already exists`;
        case 'input.user.conflict':
            return `Input user "${descriptor.id}" already exists`;
        case 'input.disposed':
            return 'Input system has been disposed';
        case 'input.rebind.timeout':
            return `Input rebinding timed out for action "${descriptor.action}" in context "${descriptor.context}"`;
        default:
            return undefined;
    }
};

export const resolveInputMessage = (
    descriptor: Readonly<InputMessageDescriptor>,
    locale: string,
    resolver?: InputMessageResolver
): string =>
    resolver?.(descriptor, locale) ??
    DEFAULT_INPUT_MESSAGE_RESOLVER(descriptor, locale) ??
    descriptor.code;

export class InputError extends Error {
    override readonly name: string;
    readonly code: InputMessageCode;

    constructor(name: string, code: InputMessageCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = name;
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class InputConfigurationError extends InputError {
    constructor(code: InputValidationMessageCode, message: string, options?: ErrorOptions) {
        super('InputConfigurationError', code, message, options);
    }
}

export class InputDisposedError extends InputError {
    constructor(message: string, options?: ErrorOptions) {
        super('InputDisposedError', 'input.disposed', message, options);
    }
}

export class InputSnapshotError extends InputError {
    constructor(message: string, options?: ErrorOptions) {
        super('InputSnapshotError', 'input.invalid-snapshot', message, options);
    }
}

export class InputContextError extends InputError {
    readonly contextId: string;

    constructor(code: 'input.invalid-context' | 'input.context.conflict', contextId: string, message: string, options?: ErrorOptions) {
        super('InputContextError', code, message, options);
        this.contextId = contextId;
    }
}

export class InputUserError extends InputError {
    readonly userId: string;

    constructor(code: 'input.invalid-user' | 'input.user.conflict', userId: string, message: string, options?: ErrorOptions) {
        super('InputUserError', code, message, options);
        this.userId = userId;
    }
}

export class InputRebindingError extends InputError {
    constructor(
        code: 'input.invalid-rebind' | 'input.invalid-slot' | 'input.rebind.timeout',
        message: string,
        options?: ErrorOptions
    ) {
        super('InputRebindingError', code, message, options);
    }
}
