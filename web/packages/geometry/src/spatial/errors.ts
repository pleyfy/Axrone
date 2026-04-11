export class SpatialError extends Error {
    constructor(
        message: string,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'SpatialError';
        Object.setPrototypeOf(this, SpatialError.prototype);
    }
}

export class SpatialBoundsError extends SpatialError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, context);
        this.name = 'SpatialBoundsError';
        Object.setPrototypeOf(this, SpatialBoundsError.prototype);
    }
}

export class SpatialItemError extends SpatialError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, context);
        this.name = 'SpatialItemError';
        Object.setPrototypeOf(this, SpatialItemError.prototype);
    }
}

export class SpatialConfigError extends SpatialError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, context);
        this.name = 'SpatialConfigError';
        Object.setPrototypeOf(this, SpatialConfigError.prototype);
    }
}
