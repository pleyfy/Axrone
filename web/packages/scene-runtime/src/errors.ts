export class SceneError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly cause?: unknown
    ) {
        super(message);
        this.name = 'SceneError';
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

export class SceneCanvasError extends SceneError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_CANVAS_ERROR', cause);
        this.name = 'SceneCanvasError';
    }
}

export class SceneShaderError extends SceneError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_SHADER_ERROR', cause);
        this.name = 'SceneShaderError';
    }
}

export class SceneMeshError extends SceneError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_MESH_ERROR', cause);
        this.name = 'SceneMeshError';
    }
}

export class SceneMaterialError extends SceneError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_MATERIAL_ERROR', cause);
        this.name = 'SceneMaterialError';
    }
}

export class SceneLifecycleError extends SceneError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_LIFECYCLE_ERROR', cause);
        this.name = 'SceneLifecycleError';
    }
}

export class SceneCapabilityError extends SceneError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_CAPABILITY_ERROR', cause);
        this.name = 'SceneCapabilityError';
    }
}

export class ScenePrefabError extends SceneError {
    constructor(message: string, code = 'SCENE_PREFAB_ERROR', cause?: unknown) {
        super(message, code, cause);
        this.name = 'ScenePrefabError';
    }
}

export class ScenePrefabValidationError extends ScenePrefabError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_PREFAB_VALIDATION_ERROR', cause);
        this.name = 'ScenePrefabValidationError';
    }
}

export class ScenePrefabResolutionError extends ScenePrefabError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_PREFAB_RESOLUTION_ERROR', cause);
        this.name = 'ScenePrefabResolutionError';
    }
}

export class ScenePrefabConflictError extends ScenePrefabError {
    constructor(message: string, cause?: unknown) {
        super(message, 'SCENE_PREFAB_CONFLICT_ERROR', cause);
        this.name = 'ScenePrefabConflictError';
    }
}
