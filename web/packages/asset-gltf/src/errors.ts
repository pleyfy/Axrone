export class GltfError extends Error {
    constructor(message: string, readonly code: string, readonly cause?: unknown) {
        super(message);
        this.name = 'GltfError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class GltfContainerError extends GltfError {
    constructor(message: string, cause?: unknown) {
        super(message, 'gltf.container.invalid', cause);
        this.name = 'GltfContainerError';
    }
}

export class GltfSchemaError extends GltfError {
    constructor(message: string, cause?: unknown) {
        super(message, 'gltf.schema.invalid', cause);
        this.name = 'GltfSchemaError';
    }
}

export class GltfResourceError extends GltfError {
    constructor(
        message: string,
        readonly resourceUri: string,
        readonly resourceKind: 'buffer' | 'image',
        cause?: unknown
    ) {
        super(message, 'gltf.resource.unresolved', cause);
        this.name = 'GltfResourceError';
    }
}

export class GltfAccessorError extends GltfError {
    constructor(message: string, readonly accessorIndex: number, cause?: unknown) {
        super(message, 'gltf.accessor.invalid', cause);
        this.name = 'GltfAccessorError';
    }
}

export class GltfTopologyError extends GltfError {
    constructor(message: string, readonly primitiveMode: number, cause?: unknown) {
        super(message, 'gltf.topology.unsupported', cause);
        this.name = 'GltfTopologyError';
    }
}
