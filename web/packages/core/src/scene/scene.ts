import { Mat4, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { createBox, createPlane, createSphere } from '../geometry/primitives';
import type { IGeometryBuffers } from '../geometry/primitives/types';
import { createGameLoop, type GameLoop, type GameLoopSystem } from '../game-loop';
import { Transform } from '../component-system/components/transform';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import { SystemManager, SystemPhase } from '../component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import { Camera, type CameraConfig } from './components/camera';
import { MeshRenderer, type MeshRendererConfig } from './components/mesh-renderer';
import {
    SceneCanvasError,
    SceneLifecycleError,
    SceneMaterialError,
    SceneMeshError,
    SceneShaderError,
} from './errors';
import type {
    SceneBuiltInRegistry,
    SceneLoopState,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneMeshSemantic,
    SceneMeshTopology,
    SceneOptions,
    SceneRegistry,
    SceneShaderDefinition,
    SceneShaderHandle,
    SceneUniformValue,
} from './types';

type RuntimeRegistry<R extends ComponentRegistry> = SceneRegistry<R>;

interface ResolvedSurface {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly autoCreated: boolean;
}

interface ShaderResource {
    readonly id: string;
    readonly program: WebGLProgram;
    readonly uniformLocations: ReadonlyMap<string, WebGLUniformLocation>;
    readonly uniformNames: readonly string[];
    readonly attributeNames: Readonly<Record<SceneMeshSemantic, string>>;
    readonly depthTest: boolean;
    readonly cull: boolean;
    readonly blend: boolean;
}

interface MeshResource {
    readonly id: string;
    readonly vertexArray: WebGLVertexArrayObject;
    readonly vertexBuffer: WebGLBuffer;
    readonly indexBuffer: WebGLBuffer | null;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly indexType: number | null;
    readonly topology: SceneMeshTopology;
    readonly mode: number;
}

interface MaterialResource {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms: Map<string, SceneUniformValue>;
}

interface RenderItem {
    readonly transform: Transform;
    readonly renderer: MeshRenderer;
}

const DEFAULT_ATTRIBUTE_NAMES: Readonly<Record<SceneMeshSemantic, string>> = Object.freeze({
    position: 'a_Position',
    normal: 'a_Normal',
    uv0: 'a_UV0',
    color0: 'a_Color0',
});

const ATTRIBUTE_LOCATIONS: Readonly<Record<SceneMeshSemantic, number>> = Object.freeze({
    position: 0,
    normal: 1,
    uv0: 2,
    color0: 3,
});

const DEFAULT_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

const createId = (prefix: string): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const toVec4 = (value?: Vec4 | readonly [number, number, number, number]): Vec4 => {
    if (value instanceof Vec4) {
        return new Vec4(value.x, value.y, value.z, value.w);
    }

    if (Array.isArray(value) && value.length === 4) {
        return new Vec4(value[0], value[1], value[2], value[3]);
    }

    return new Vec4(
        DEFAULT_CLEAR_COLOR.x,
        DEFAULT_CLEAR_COLOR.y,
        DEFAULT_CLEAR_COLOR.z,
        DEFAULT_CLEAR_COLOR.w
    );
};

const mapGeometryAttribute = (name: string): SceneMeshSemantic | null => {
    switch (name) {
        case 'position':
            return 'position';
        case 'normal':
            return 'normal';
        case 'texCoord':
            return 'uv0';
        case 'color':
            return 'color0';
        default:
            return null;
    }
};

const mapTopologyToMode = (
    gl: WebGL2RenderingContext,
    topology: SceneMeshTopology
): number => {
    switch (topology) {
        case 'lines':
            return gl.LINES;
        case 'points':
            return gl.POINTS;
        case 'triangles':
        default:
            return gl.TRIANGLES;
    }
};

const extractUniformNames = (...sources: string[]): string[] => {
    const names = new Set<string>();
    const pattern = /\buniform\s+\w+\s+(\w+)(?:\s*\[[^\]]+\])?\s*;/g;

    for (const source of sources) {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);

        while (match !== null) {
            names.add(match[1]);
            match = pattern.exec(source);
        }
    }

    return [...names];
};

export const createUnlitColorShaderDefinition = (id: string = 'Scene/UnlitColor'): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_UV0;
void main() {
    v_UV0 = a_UV0;
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
    fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
in vec2 v_UV0;
out vec4 o_Color;
void main() {
    o_Color = u_Color;
}`,
    uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Color'],
    depthTest: true,
    cull: true,
    blend: false,
});

export class Scene<R extends ComponentRegistry = Record<string, never>> {
    readonly id: string;
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly world: World<RuntimeRegistry<R>>;
    readonly systems: SystemManager<RuntimeRegistry<R>>;
    readonly loop: GameLoop<SceneLoopState>;

    private readonly _registry: RuntimeRegistry<R>;
    private readonly _shaders = new Map<string, ShaderResource>();
    private readonly _materials = new Map<string, MaterialResource>();
    private readonly _meshes = new Map<string, MeshResource>();
    private readonly _autoCreatedCanvas: boolean;
    private readonly _defaultClearColor: Vec4;
    private _pixelRatio: number;
    private _disposed = false;

    constructor(options: SceneOptions<R> = {}) {
        this.id = createId('scene');
        const surface = this._resolveSurface(options);
        this.canvas = surface.canvas;
        this.gl = surface.gl;
        this._autoCreatedCanvas = surface.autoCreated;
        this._pixelRatio = options.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
        this._defaultClearColor = toVec4(options.clearColor);

        this._registry = {
            Transform,
            Camera,
            MeshRenderer,
            ...(options.registry ?? ({} as R)),
        } as RuntimeRegistry<R>;

        this.world = new World(this._registry);
        this.systems = new SystemManager(this.world);
        this.resize(options.width, options.height, this._pixelRatio);

        const loopSystems: readonly GameLoopSystem<SceneLoopState>[] = [
            {
                id: 'scene.pre-update',
                beforeUpdate: (context) => {
                    this.systems.executePhase(SystemPhase.PreUpdate, context.delta);
                },
            },
            {
                id: 'scene.fixed-update',
                fixedUpdate: (context) => {
                    this._fixedUpdateActors(context.fixedDelta);
                },
            },
            {
                id: 'scene.update',
                update: (context) => {
                    this._updateActors(context.delta);
                    this.systems.executePhase(SystemPhase.Update, context.delta);
                    this._lateUpdateActors(context.delta);
                    this.systems.executePhase(SystemPhase.PostUpdate, context.delta);
                },
            },
            {
                id: 'scene.render',
                render: (context) => {
                    this.systems.executePhase(SystemPhase.Render, context.delta);
                    this._render(context.delta);
                },
            },
        ];

        this.loop = createGameLoop({
            state: { sceneId: this.id },
            scheduler: options.scheduler,
            fixedDelta: options.fixedDelta,
            maxDelta: options.maxDelta,
            maxSubSteps: options.maxSubSteps,
            autoStart: false,
            systems: loopSystems,
            errorPolicy: 'throw',
        });

        if (options.autoStart !== false) {
            this.start();
        }
    }

    get status() {
        return this.loop.status;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    registerComponent<T extends ComponentConstructor>(componentType: T): this {
        this._assertNotDisposed();
        this.world.registerComponentType(componentType);
        return this;
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        this._assertNotDisposed();
        return this.world.isComponentRegistered(componentTypeOrName);
    }

    getRegisteredComponentNames(): readonly string[] {
        this._assertNotDisposed();
        return this.world.getRegisteredComponentNames();
    }

    createActor(config: ActorConfig = {}): Actor<World<RuntimeRegistry<R>>> {
        this._assertNotDisposed();
        return new Actor(this.world, config);
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<RuntimeRegistry<R>>> {
        const actor = this.createActor(actorConfig);
        actor.addComponent(Camera, cameraConfig);
        return actor;
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): Actor<World<RuntimeRegistry<R>>> {
        const actor = this.createActor(actorConfig);
        actor.addComponent(MeshRenderer, rendererConfig);
        return actor;
    }

    addSystem<Q extends SystemQuery<RuntimeRegistry<R>>>(
        system: System<RuntimeRegistry<R>, Q>,
        phase: SystemPhase = SystemPhase.Update
    ): this {
        this._assertNotDisposed();
        this.systems.addSystem(system, phase);
        return this;
    }

    removeSystem(systemId: string): boolean {
        this._assertNotDisposed();
        return this.systems.removeSystem(systemId as any);
    }

    registerShader(definition: SceneShaderDefinition): SceneShaderHandle {
        this._assertNotDisposed();
        const existing = this._shaders.get(definition.id);
        if (existing) {
            this.gl.deleteProgram(existing.program);
            this._shaders.delete(definition.id);
        }

        const resource = this._createShaderResource(definition);
        this._shaders.set(resource.id, resource);

        return {
            id: resource.id,
            uniformNames: resource.uniformNames,
        };
    }

    getShader(id: string): SceneShaderHandle | null {
        const shader = this._shaders.get(id);
        if (!shader) {
            return null;
        }

        return {
            id: shader.id,
            uniformNames: shader.uniformNames,
        };
    }

    createMaterial(definition: SceneMaterialDefinition): SceneMaterialHandle {
        this._assertNotDisposed();
        if (!this._shaders.has(definition.shaderId)) {
            throw new SceneMaterialError(
                `Cannot create material '${definition.id}' because shader '${definition.shaderId}' is not registered`
            );
        }

        const resource: MaterialResource = {
            id: definition.id,
            shaderId: definition.shaderId,
            uniforms: new Map(Object.entries(definition.uniforms ?? {})),
        };

        this._materials.set(resource.id, resource);

        return {
            id: resource.id,
            shaderId: resource.shaderId,
        };
    }

    setMaterialUniform(materialId: string, name: string, value: SceneUniformValue): this {
        this._assertNotDisposed();
        const material = this._materials.get(materialId);
        if (!material) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        material.uniforms.set(name, value);
        return this;
    }

    getMaterial(materialId: string): SceneMaterialHandle | null {
        const material = this._materials.get(materialId);
        if (!material) {
            return null;
        }

        return {
            id: material.id,
            shaderId: material.shaderId,
        };
    }

    registerMesh(definition: SceneMeshDefinition): SceneMeshHandle {
        this._assertNotDisposed();
        const existing = this._meshes.get(definition.id);
        if (existing) {
            this._disposeMesh(existing);
            this._meshes.delete(definition.id);
        }

        const resource = this._createMeshResource(definition);
        this._meshes.set(resource.id, resource);

        return {
            id: resource.id,
            vertexCount: resource.vertexCount,
            indexCount: resource.indexCount,
            topology: resource.topology,
        };
    }

    getMesh(id: string): SceneMeshHandle | null {
        const mesh = this._meshes.get(id);
        if (!mesh) {
            return null;
        }

        return {
            id: mesh.id,
            vertexCount: mesh.vertexCount,
            indexCount: mesh.indexCount,
            topology: mesh.topology,
        };
    }

    createBoxMesh(id: string, width: number = 1, height: number = 1, depth: number = 1): SceneMeshHandle {
        return this._registerGeometryBuffers(
            id,
            createBox({
                width,
                height,
                depth,
                generateNormals: true,
                generateTexCoords: true,
                generateTangents: false,
            })
        );
    }

    createPlaneMesh(id: string, width: number = 1, height: number = 1): SceneMeshHandle {
        return this._registerGeometryBuffers(
            id,
            createPlane({
                width,
                height,
                generateNormals: true,
                generateTexCoords: true,
                generateTangents: false,
            })
        );
    }

    createSphereMesh(id: string, radius: number = 1, segments: number = 24): SceneMeshHandle {
        return this._registerGeometryBuffers(
            id,
            createSphere({
                radius,
                widthSegments: segments,
                heightSegments: segments,
                generateNormals: true,
                generateTexCoords: true,
                generateTangents: false,
            })
        );
    }

    start(now?: number): this {
        this._assertNotDisposed();
        this.loop.start(now);
        return this;
    }

    pause(): this {
        this._assertNotDisposed();
        this.loop.pause();
        return this;
    }

    resume(now?: number): this {
        this._assertNotDisposed();
        this.loop.resume(now);
        return this;
    }

    stop(): this {
        this._assertNotDisposed();
        this.loop.stop();
        return this;
    }

    renderNow(): this {
        this._assertNotDisposed();
        this._render(0);
        return this;
    }

    resize(
        width: number = this.canvas.clientWidth || DEFAULT_WIDTH,
        height: number = this.canvas.clientHeight || DEFAULT_HEIGHT,
        pixelRatio: number = this._pixelRatio
    ): this {
        this._assertNotDisposed();
        this._pixelRatio = pixelRatio > 0 ? pixelRatio : 1;

        const targetWidth = Math.max(1, Math.floor(width * this._pixelRatio));
        const targetHeight = Math.max(1, Math.floor(height * this._pixelRatio));
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.gl.viewport(0, 0, targetWidth, targetHeight);

        return this;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        try {
            this.loop.dispose();
        } catch (error) {
            throw new SceneLifecycleError('Failed to dispose scene loop', error);
        } finally {
            for (const shader of this._shaders.values()) {
                this.gl.deleteProgram(shader.program);
            }

            for (const mesh of this._meshes.values()) {
                this._disposeMesh(mesh);
            }

            this._shaders.clear();
            this._materials.clear();
            this._meshes.clear();

            if (!this.world.isDisposed) {
                this.world.clear();
            }

            if (
                this._autoCreatedCanvas &&
                this.canvas.parentNode &&
                typeof this.canvas.parentNode.removeChild === 'function'
            ) {
                this.canvas.parentNode.removeChild(this.canvas);
            }

            this._disposed = true;
        }
    }

    private _resolveSurface(options: SceneOptions<R>): ResolvedSurface {
        let canvas = options.canvas;
        let autoCreated = false;

        if (!canvas) {
            if (options.gl?.canvas instanceof HTMLCanvasElement) {
                canvas = options.gl.canvas;
            } else if (options.createCanvas) {
                canvas = options.createCanvas();
                autoCreated = true;
            } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
                canvas = document.createElement('canvas');
                autoCreated = true;
            } else {
                throw new SceneCanvasError('Unable to resolve a canvas for the scene');
            }
        }

        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new SceneCanvasError('Scene canvas must be an HTMLCanvasElement');
        }

        if (options.className) {
            canvas.className = options.className;
        }

        if (
            autoCreated &&
            options.appendToDom !== false &&
            typeof document !== 'undefined'
        ) {
            const parent = options.parent ?? document.body;
            parent?.appendChild(canvas);
        }

        const gl = options.gl ?? canvas.getContext('webgl2', options.contextAttributes);
        if (!gl) {
            throw new SceneCanvasError('Failed to acquire a WebGL2 rendering context');
        }

        return {
            canvas,
            gl,
            autoCreated,
        };
    }

    private _createShaderResource(definition: SceneShaderDefinition): ShaderResource {
        const program = this.gl.createProgram();
        if (!program) {
            throw new SceneShaderError(`Failed to create shader program '${definition.id}'`);
        }

        const attributeNames = {
            ...DEFAULT_ATTRIBUTE_NAMES,
            ...(definition.attributes ?? {}),
        } as Record<SceneMeshSemantic, string>;

        const vertexShader = this._compileShader(this.gl.VERTEX_SHADER, definition.vertexSource);
        const fragmentShader = this._compileShader(this.gl.FRAGMENT_SHADER, definition.fragmentSource);

        try {
            for (const semantic of Object.keys(attributeNames) as SceneMeshSemantic[]) {
                this.gl.bindAttribLocation(
                    program,
                    ATTRIBUTE_LOCATIONS[semantic],
                    attributeNames[semantic]
                );
            }

            this.gl.attachShader(program, vertexShader);
            this.gl.attachShader(program, fragmentShader);
            this.gl.linkProgram(program);

            if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
                const info = this.gl.getProgramInfoLog(program) ?? 'Unknown link failure';
                throw new SceneShaderError(
                    `Failed to link shader '${definition.id}': ${info}`
                );
            }

            const uniformNames = Array.from(
                new Set(
                    definition.uniforms ??
                        extractUniformNames(definition.vertexSource, definition.fragmentSource)
                )
            );

            const uniformLocations = new Map<string, WebGLUniformLocation>();
            for (const uniformName of uniformNames) {
                const location = this.gl.getUniformLocation(program, uniformName);
                if (location !== null) {
                    uniformLocations.set(uniformName, location);
                }
            }

            return {
                id: definition.id,
                program,
                uniformLocations,
                uniformNames,
                attributeNames,
                depthTest: definition.depthTest ?? true,
                cull: definition.cull ?? true,
                blend: definition.blend ?? false,
            };
        } finally {
            this.gl.deleteShader(vertexShader);
            this.gl.deleteShader(fragmentShader);
        }
    }

    private _compileShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) {
            throw new SceneShaderError('Failed to create WebGL shader');
        }

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const info = this.gl.getShaderInfoLog(shader) ?? 'Unknown compilation failure';
            this.gl.deleteShader(shader);
            throw new SceneShaderError(`Shader compilation failed: ${info}`);
        }

        return shader;
    }

    private _createMeshResource(definition: SceneMeshDefinition): MeshResource {
        if (definition.attributes.length === 0) {
            throw new SceneMeshError(`Mesh '${definition.id}' must define at least one attribute`);
        }

        const vao = this.gl.createVertexArray();
        const vertexBuffer = this.gl.createBuffer();

        if (!vao || !vertexBuffer) {
            throw new SceneMeshError(`Failed to allocate mesh resources for '${definition.id}'`);
        }

        const usage = definition.usage ?? this.gl.STATIC_DRAW;
        this.gl.bindVertexArray(vao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, definition.vertices, usage);

        for (const attribute of definition.attributes) {
            const location = ATTRIBUTE_LOCATIONS[attribute.semantic];
            this.gl.enableVertexAttribArray(location);
            this.gl.vertexAttribPointer(
                location,
                attribute.componentCount,
                attribute.type ?? this.gl.FLOAT,
                attribute.normalized ?? false,
                attribute.stride,
                attribute.offset
            );
        }

        let indexBuffer: WebGLBuffer | null = null;
        let indexCount = 0;
        let indexType: number | null = null;

        if (definition.indices) {
            indexBuffer = this.gl.createBuffer();
            if (!indexBuffer) {
                throw new SceneMeshError(`Failed to create index buffer for mesh '${definition.id}'`);
            }

            this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, definition.indices, usage);
            indexCount = definition.indices.length;
            indexType =
                definition.indices instanceof Uint32Array
                    ? this.gl.UNSIGNED_INT
                    : definition.indices instanceof Uint8Array
                      ? this.gl.UNSIGNED_BYTE
                      : this.gl.UNSIGNED_SHORT;
        }

        this.gl.bindVertexArray(null);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);

        const stride = definition.attributes[0].stride;
        const byteLength = (definition.vertices as ArrayBufferView).byteLength;
        const vertexCount = definition.vertexCount ?? Math.floor(byteLength / stride);

        return {
            id: definition.id,
            vertexArray: vao,
            vertexBuffer,
            indexBuffer,
            vertexCount,
            indexCount,
            indexType,
            topology: definition.topology ?? 'triangles',
            mode: mapTopologyToMode(this.gl, definition.topology ?? 'triangles'),
        };
    }

    private _registerGeometryBuffers(id: string, geometryBuffers: IGeometryBuffers): SceneMeshHandle {
        const attributes = geometryBuffers.layout.attributes
            .map((attribute) => {
                const semantic = mapGeometryAttribute(attribute.name);
                if (!semantic) {
                    return null;
                }

                return {
                    semantic,
                    componentCount: attribute.size,
                    offset: attribute.offset,
                    stride: geometryBuffers.layout.stride,
                    type: attribute.type,
                    normalized: attribute.normalized,
                };
            })
            .filter((attribute): attribute is NonNullable<typeof attribute> => attribute !== null);

        const vertexBytes = geometryBuffers.vertices.toUint8Array();
        const indexBytes = geometryBuffers.indices.toUint8Array();
        const indexArray =
            geometryBuffers.layout.indexCount > 0
                ? new Uint16Array(
                      indexBytes.buffer.slice(
                          indexBytes.byteOffset,
                          indexBytes.byteOffset + indexBytes.byteLength
                      )
                  )
                : undefined;

        return this.registerMesh({
            id,
            vertices: vertexBytes,
            indices: indexArray,
            vertexCount: geometryBuffers.layout.vertexCount,
            topology: geometryBuffers.layout.primitiveType,
            attributes,
        });
    }

    private _fixedUpdateActors(deltaTime: number): void {
        for (const actor of this.world.getAllActors()) {
            actor.fixedUpdate(deltaTime);
        }
    }

    private _updateActors(deltaTime: number): void {
        for (const actor of this.world.getAllActors()) {
            actor.update(deltaTime);
        }
    }

    private _lateUpdateActors(deltaTime: number): void {
        for (const actor of this.world.getAllActors()) {
            actor.lateUpdate(deltaTime);
        }
    }

    private _render(deltaTime: number): void {
        const camera = this._selectCamera();
        const clearColor = camera?.clearColor ?? this._defaultClearColor;

        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(clearColor.x, clearColor.y, clearColor.z, clearColor.w);
        this.gl.clearDepth(camera?.clearDepth ?? 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        if (!camera) {
            return;
        }

        const aspectRatio = this.canvas.width / Math.max(1, this.canvas.height);
        const viewMatrix = camera.getViewMatrix();
        const projectionMatrix = camera.getProjectionMatrix(aspectRatio);
        const cameraPosition = camera.getWorldPosition();
        const renderItems = this._collectRenderItems();

        for (const item of renderItems) {
            if (item.renderer.meshId === null || item.renderer.materialId === null) {
                continue;
            }

            const mesh = this._meshes.get(item.renderer.meshId);
            const material = this._materials.get(item.renderer.materialId);

            if (!mesh || !material) {
                continue;
            }

            const shader = this._shaders.get(material.shaderId);
            if (!shader) {
                continue;
            }

            const modelMatrix = item.transform.worldMatrix;
            const viewProjectionMatrix = Mat4.multiply(projectionMatrix, viewMatrix);
            const mvpMatrix = Mat4.multiply(viewProjectionMatrix, modelMatrix);

            this._applyShaderState(shader);
            this.gl.useProgram(shader.program);
            this.gl.bindVertexArray(mesh.vertexArray);

            this._setUniform(shader, 'u_Model', modelMatrix);
            this._setUniform(shader, 'u_View', viewMatrix);
            this._setUniform(shader, 'u_Projection', projectionMatrix);
            this._setUniform(shader, 'u_MVP', mvpMatrix);
            this._setUniform(shader, 'u_Time', this.loop.elapsed / 1000);
            this._setUniform(shader, 'u_DeltaTime', deltaTime / 1000);
            this._setUniform(shader, 'u_Frame', this.loop.frame);
            this._setUniform(shader, 'u_Resolution', new Vec2(this.canvas.width, this.canvas.height));
            this._setUniform(shader, 'u_CameraPosition', cameraPosition);

            for (const [name, value] of material.uniforms) {
                this._setUniform(shader, name, value);
            }

            for (const [name, value] of item.renderer.getUniformEntries()) {
                this._setUniform(shader, name, value);
            }

            if (mesh.indexBuffer && mesh.indexType !== null && mesh.indexCount > 0) {
                this.gl.drawElements(mesh.mode, mesh.indexCount, mesh.indexType, 0);
            } else {
                this.gl.drawArrays(mesh.mode, 0, mesh.vertexCount);
            }
        }

        this.gl.bindVertexArray(null);
    }

    private _collectRenderItems(): RenderItem[] {
        const items: RenderItem[] = [];

        for (const actor of this.world.getAllActors()) {
            if (!actor.active) {
                continue;
            }

            const transform = actor.getComponent(Transform);
            const renderer = actor.getComponent(MeshRenderer);

            if (!transform || !renderer || !renderer.enabled || !renderer.visible) {
                continue;
            }

            items.push({ transform, renderer });
        }

        items.sort((left, right) => left.renderer.renderOrder - right.renderer.renderOrder);
        return items;
    }

    private _selectCamera(): Camera | undefined {
        let fallback: Camera | undefined;

        for (const actor of this.world.getAllActors()) {
            if (!actor.active) {
                continue;
            }

            const camera = actor.getComponent(Camera);
            if (!camera || !camera.enabled) {
                continue;
            }

            if (camera.primary) {
                return camera;
            }

            if (!fallback) {
                fallback = camera;
            }
        }

        return fallback;
    }

    private _applyShaderState(shader: ShaderResource): void {
        if (shader.depthTest) {
            this.gl.enable(this.gl.DEPTH_TEST);
        } else {
            this.gl.disable(this.gl.DEPTH_TEST);
        }

        if (shader.cull) {
            this.gl.enable(this.gl.CULL_FACE);
            this.gl.cullFace(this.gl.BACK);
        } else {
            this.gl.disable(this.gl.CULL_FACE);
        }

        if (shader.blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        } else {
            this.gl.disable(this.gl.BLEND);
        }

        this.gl.depthMask(true);
    }

    private _setUniform(
        shader: ShaderResource,
        name: string,
        value: SceneUniformValue | null | undefined
    ): void {
        if (value === null || value === undefined) {
            return;
        }

        const location = shader.uniformLocations.get(name);
        if (!location) {
            return;
        }

        if (value instanceof Mat4) {
            this.gl.uniformMatrix4fv(location, false, new Float32Array(value.data));
            return;
        }

        if (value instanceof Vec4) {
            this.gl.uniform4f(location, value.x, value.y, value.z, value.w);
            return;
        }

        if (value instanceof Vec3) {
            this.gl.uniform3f(location, value.x, value.y, value.z);
            return;
        }

        if (value instanceof Vec2) {
            this.gl.uniform2f(location, value.x, value.y);
            return;
        }

        if (value instanceof Float32Array) {
            switch (value.length) {
                case 16:
                    this.gl.uniformMatrix4fv(location, false, value);
                    return;
                case 4:
                    this.gl.uniform4fv(location, value);
                    return;
                case 3:
                    this.gl.uniform3fv(location, value);
                    return;
                case 2:
                    this.gl.uniform2fv(location, value);
                    return;
                default:
                    this.gl.uniform1fv(location, value);
                    return;
            }
        }

        if (value instanceof Int32Array) {
            switch (value.length) {
                case 4:
                    this.gl.uniform4iv(location, value);
                    return;
                case 3:
                    this.gl.uniform3iv(location, value);
                    return;
                case 2:
                    this.gl.uniform2iv(location, value);
                    return;
                default:
                    this.gl.uniform1iv(location, value);
                    return;
            }
        }

        if (value instanceof Uint32Array) {
            switch (value.length) {
                case 4:
                    this.gl.uniform4uiv(location, value);
                    return;
                case 3:
                    this.gl.uniform3uiv(location, value);
                    return;
                case 2:
                    this.gl.uniform2uiv(location, value);
                    return;
                default:
                    this.gl.uniform1uiv(location, value);
                    return;
            }
        }

        if (Array.isArray(value)) {
            switch (value.length) {
                case 16:
                    this.gl.uniformMatrix4fv(location, false, new Float32Array(value));
                    return;
                case 4:
                    this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
                    return;
                case 3:
                    this.gl.uniform3f(location, value[0], value[1], value[2]);
                    return;
                case 2:
                    this.gl.uniform2f(location, value[0], value[1]);
                    return;
                case 1:
                    this.gl.uniform1f(location, value[0]);
                    return;
                default:
                    this.gl.uniform1fv(location, new Float32Array(value));
                    return;
            }
        }

        if (typeof value === 'boolean') {
            this.gl.uniform1i(location, value ? 1 : 0);
            return;
        }

        if (typeof value === 'number') {
            this.gl.uniform1f(location, value);
        }
    }

    private _disposeMesh(mesh: MeshResource): void {
        this.gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.indexBuffer) {
            this.gl.deleteBuffer(mesh.indexBuffer);
        }
        this.gl.deleteVertexArray(mesh.vertexArray);
    }

    private _assertNotDisposed(): void {
        if (!this._disposed) {
            return;
        }

        throw new SceneLifecycleError('Scene has already been disposed');
    }
}

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);