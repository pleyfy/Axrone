export class RaycastError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RaycastError';
        Object.setPrototypeOf(this, RaycastError.prototype);
    }
}

export class InvalidRayError extends RaycastError {
    constructor(message: string = 'Invalid ray parameters') {
        super(message);
        this.name = 'InvalidRayError';
        Object.setPrototypeOf(this, InvalidRayError.prototype);
    }
}

export class RaycastQueryError extends RaycastError {
    constructor(message: string = 'Invalid raycast query') {
        super(message);
        this.name = 'RaycastQueryError';
        Object.setPrototypeOf(this, RaycastQueryError.prototype);
    }
}

export class SpatialStructureError extends RaycastError {
    constructor(message: string = 'Spatial structure operation failed') {
        super(message);
        this.name = 'SpatialStructureError';
        Object.setPrototypeOf(this, SpatialStructureError.prototype);
    }
}

export class BVHBuildError extends RaycastError {
    constructor(message: string = 'BVH build failed') {
        super(message);
        this.name = 'BVHBuildError';
        Object.setPrototypeOf(this, BVHBuildError.prototype);
    }
}
