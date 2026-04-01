import { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { createBox, createPlane, createSphere } from '../geometry/primitives';
import type { IGeometryBuffers } from '../geometry/primitives/types';
import { createGameLoop, type GameLoop, type GameLoopSystem } from '../game-loop';
import { Transform } from '../component-system/components/transform';
import { Component } from '../component-system/core/component';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import { getComponentMetadata } from '../component-system/decorators/script';
import { SystemManager, SystemPhase } from '../component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import {
    FilterMode,
    TextureDimension,
    TextureFormat,
    TextureUsage,
    WrapMode,
    type ITexture,
    type ITextureSampler,
} from '../renderer/webgl2/texture/interfaces';
import { WebGLTextureManager } from '../renderer/webgl2/texture/manager';
import { Camera, type CameraConfig } from './components/camera';
import { DirectionalLight } from './components/directional-light';
import { MeshRenderer, type MeshRendererConfig } from './components/mesh-renderer';
import { OrbitCameraController } from './components/orbit-camera-controller';
import { PointLight } from './components/point-light';
import {
    SceneCanvasError,
    SceneLifecycleError,
    SceneMaterialError,
    SceneMeshError,
    SceneShaderError,
} from './errors';
import {
    cloneMeshDefinition,
    cloneTextureBinding,
    decodeSceneValue,
    encodeSceneValue,
} from './serialization';
import type {
    SceneActorSnapshot,
    SceneClearFlag,
    SceneComponentSnapshot,
    SceneLoopState,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneMeshSemantic,
    SceneMeshTopology,
    SceneOptions,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneRegistry,
    SceneRenderPassDefinition,
    SceneRenderPassHandle,
    SceneSamplerDefinition,
    SceneSamplerHandle,
    SceneShaderDefinition,
    SceneShaderHandle,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
    SceneTextureBindingDefinition,
    SceneTextureDefinition,
    SceneTextureHandle,
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
    readonly uniformTypes: ReadonlyMap<string, number>;
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

interface MaterialTextureBinding {
    readonly textureId: string;
    readonly samplerId: string | null;
    readonly unit?: number;
}

interface MaterialResource {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms: Map<string, SceneUniformValue>;
    readonly textureBindings: Map<string, MaterialTextureBinding>;
}

interface TextureResource {
    readonly id: string;
    readonly texture: ITexture;
    readonly width: number;
    readonly height: number;
    readonly samplerId: string | null;
}

interface SamplerResource {
    readonly id: string;
    readonly sampler: ITextureSampler;
}

interface RenderPassResource {
    readonly id: string;
    readonly order: number;
    readonly rendererPassId: string;
    readonly enabled: boolean;
    readonly clearFlags: readonly SceneClearFlag[];
    readonly clearColor: Vec4 | null;
    readonly clearDepth: number | null;
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

interface RenderItem {
    readonly transform: Transform;
    readonly renderer: MeshRenderer;
}

interface DirectionalLightState {
    readonly direction: Vec3;
    readonly color: Vec3;
    readonly intensity: number;
}

interface PointLightState {
    readonly position: Vec3;
    readonly color: Vec3;
    readonly intensity: number;
    readonly range: number;
}

interface LightingState {
    readonly ambient: Vec3;
    readonly directional: DirectionalLightState | null;
    readonly point: PointLightState | null;
    readonly pointCount: number;
}

const DEFAULT_ATTRIBUTE_NAMES: Readonly<Record<SceneMeshSemantic, string>> = Object.freeze({
    position: 'a_Position',
    normal: 'a_Normal',
    uv0: 'a_UV0',
    color0: 'a_Color0',
});

const normalizeUniformName = (name: string): string => name.replace(/\[0\]$/, '');

const ATTRIBUTE_LOCATIONS: Readonly<Record<SceneMeshSemantic, number>> = Object.freeze({
    position: 0,
    normal: 1,
    uv0: 2,
    color0: 3,
});

const DEFAULT_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
const DEFAULT_AMBIENT_LIGHT = new Vec3(0.08, 0.08, 0.1);
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_RENDER_PASS_ID = 'main';

const createId = (prefix: string): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const toVec4 = (
    value?: Vec4 | readonly [number, number, number, number] | null,
    fallback: Vec4 = DEFAULT_CLEAR_COLOR
): Vec4 => {
    if (value instanceof Vec4) {
        return new Vec4(value.x, value.y, value.z, value.w);
    }

    if (Array.isArray(value) && value.length === 4) {
        return new Vec4(value[0], value[1], value[2], value[3]);
    }

    return new Vec4(fallback.x, fallback.y, fallback.z, fallback.w);
};

const toVec3 = (
    value?: Vec3 | readonly [number, number, number] | null,
    fallback: Vec3 = DEFAULT_AMBIENT_LIGHT
): Vec3 => {
    if (value instanceof Vec3) {
        return new Vec3(value.x, value.y, value.z);
    }

    if (Array.isArray(value) && value.length === 3) {
        return new Vec3(value[0], value[1], value[2]);
    }

    return new Vec3(fallback.x, fallback.y, fallback.z);
};

const cloneSceneValue = <T>(value: T): T => decodeSceneValue(encodeSceneValue(value)) as T;

const cloneShaderDefinition = (definition: SceneShaderDefinition): SceneShaderDefinition => ({
    ...definition,
    uniforms: definition.uniforms ? [...definition.uniforms] : undefined,
    attributes: definition.attributes ? { ...definition.attributes } : undefined,
});

const cloneMaterialDefinition = (definition: SceneMaterialDefinition): SceneMaterialDefinition => ({
    id: definition.id,
    shaderId: definition.shaderId,
    uniforms: definition.uniforms
        ? Object.fromEntries(
              Object.entries(definition.uniforms).map(([name, value]) => [
                  name,
                  cloneSceneValue(value),
              ])
          )
        : undefined,
    textures: definition.textures
        ? Object.fromEntries(
              Object.entries(definition.textures).map(([name, binding]) => [
                  name,
                  cloneTextureBinding(binding),
              ])
          )
        : undefined,
});

const cloneSamplerDefinition = (definition: SceneSamplerDefinition): SceneSamplerDefinition => ({
    ...definition,
});

const cloneTextureDefinition = (definition: SceneTextureDefinition): SceneTextureDefinition => {
    const source = definition.source;

    if (source.kind === 'color') {
        return {
            ...definition,
            source: {
                ...source,
                color: [...source.color] as readonly [number, number, number, number],
            },
        };
    }

    if (source.kind === 'checker') {
        return {
            ...definition,
            source: {
                ...source,
                colorA: source.colorA
                    ? ([...source.colorA] as readonly [number, number, number, number])
                    : undefined,
                colorB: source.colorB
                    ? ([...source.colorB] as readonly [number, number, number, number])
                    : undefined,
            },
        };
    }

    if (source.kind === 'data') {
        return {
            ...definition,
            source: {
                ...source,
                data: [...source.data],
            },
        };
    }

    return {
        ...definition,
        source: { ...source },
    };
};

const cloneRenderPassDefinition = (
    definition: SceneRenderPassDefinition
): SceneRenderPassDefinition => ({
    ...definition,
    clearFlags: definition.clearFlags ? [...definition.clearFlags] : undefined,
    clearColor:
        definition.clearColor === null
            ? null
            : definition.clearColor
              ? toVec4(definition.clearColor)
              : undefined,
});

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

const mapTopologyToMode = (gl: WebGL2RenderingContext, topology: SceneMeshTopology): number => {
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

const normalizeTextureBinding = (
    binding: SceneTextureBindingDefinition
): MaterialTextureBinding => {
    if (typeof binding === 'string') {
        return {
            textureId: binding,
            samplerId: null,
        };
    }

    return {
        textureId: binding.textureId,
        samplerId: binding.samplerId ?? null,
        unit: binding.unit,
    };
};

const clampByte = (value: number): number => {
    const normalized = value <= 1 && value >= 0 ? value * 255 : value;
    return Math.max(0, Math.min(255, Math.round(normalized)));
};

const calculateMipLevels = (width: number, height: number): number =>
    Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1);

const inferTextureChannels = (format: TextureFormat): 1 | 2 | 3 | 4 => {
    const value = String(format);

    if (value.includes('RGBA')) {
        return 4;
    }

    if (value.includes('RGB')) {
        return 3;
    }

    if (value.includes('RG')) {
        return 2;
    }

    return 1;
};

const isFloatTextureFormat = (format: TextureFormat): boolean => {
    const value = String(format);
    return value.includes('16F') || value.includes('32F');
};

const createSolidTextureData = (
    color: readonly [number, number, number, number],
    width: number,
    height: number
): Uint8Array => {
    const data = new Uint8Array(width * height * 4);
    const red = clampByte(color[0]);
    const green = clampByte(color[1]);
    const blue = clampByte(color[2]);
    const alpha = clampByte(color[3]);

    for (let index = 0; index < data.length; index += 4) {
        data[index] = red;
        data[index + 1] = green;
        data[index + 2] = blue;
        data[index + 3] = alpha;
    }

    return data;
};

const createCheckerTextureData = (
    size: number,
    colorA: readonly [number, number, number, number],
    colorB: readonly [number, number, number, number]
): Uint8Array => {
    const data = new Uint8Array(size * size * 4);
    const a = colorA.map((value) => clampByte(value)) as number[];
    const b = colorB.map((value) => clampByte(value)) as number[];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const source = (x + y) % 2 === 0 ? a : b;

            data[offset] = source[0];
            data[offset + 1] = source[1];
            data[offset + 2] = source[2];
            data[offset + 3] = source[3];
        }
    }

    return data;
};

const createRawTextureData = (
    format: TextureFormat,
    width: number,
    height: number,
    sourceData: readonly number[],
    channels?: 1 | 2 | 3 | 4
): ArrayBufferView => {
    const channelCount = channels ?? inferTextureChannels(format);
    const expectedLength = width * height * channelCount;
    const values =
        sourceData.length >= expectedLength
            ? sourceData.slice(0, expectedLength)
            : [...sourceData, ...new Array(expectedLength - sourceData.length).fill(0)];

    if (isFloatTextureFormat(format)) {
        return new Float32Array(values);
    }

    return new Uint8Array(values.map((entry) => clampByte(entry)));
};

export const createUnlitColorShaderDefinition = (
    id: string = 'Scene/UnlitColor'
): SceneShaderDefinition => ({
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
    private readonly _componentTypes = new Map<string, ComponentConstructor>();
    private readonly _shaders = new Map<string, ShaderResource>();
    private readonly _shaderDefinitions = new Map<string, SceneShaderDefinition>();
    private readonly _materials = new Map<string, MaterialResource>();
    private readonly _materialDefinitions = new Map<string, SceneMaterialDefinition>();
    private readonly _meshes = new Map<string, MeshResource>();
    private readonly _meshDefinitions = new Map<string, SceneMeshDefinition>();
    private readonly _samplers = new Map<string, SamplerResource>();
    private readonly _samplerDefinitions = new Map<string, SceneSamplerDefinition>();
    private readonly _textures = new Map<string, TextureResource>();
    private readonly _textureDefinitions = new Map<string, SceneTextureDefinition>();
    private readonly _renderPasses = new Map<string, RenderPassResource>();
    private readonly _renderPassDefinitions = new Map<string, SceneRenderPassDefinition>();
    private readonly _textureManager: WebGLTextureManager;
    private readonly _defaultSampler: ITextureSampler;
    private readonly _autoCreatedCanvas: boolean;
    private readonly _defaultClearColor: Vec4;
    private readonly _ambientLight: Vec3;
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
        this._ambientLight = toVec3(options.ambientLight);
        this._textureManager = new WebGLTextureManager(this.gl);
        this._defaultSampler = this._textureManager.getDefaultSampler(
            FilterMode.LINEAR,
            WrapMode.REPEAT
        );

        this._registry = {
            Transform,
            Camera,
            MeshRenderer,
            DirectionalLight,
            PointLight,
            OrbitCameraController,
            ...(options.registry ?? ({} as R)),
        } as RuntimeRegistry<R>;

        for (const componentType of Object.values(this._registry)) {
            const componentName =
                getComponentMetadata(componentType)?.scriptName ?? componentType.name;
            this._componentTypes.set(componentName, componentType);
        }

        this.world = new World(this._registry);
        this.systems = new SystemManager(this.world);
        this.resize(options.width, options.height, this._pixelRatio);

        const initialRenderPasses = options.renderPasses?.length
            ? options.renderPasses
            : [
                  {
                      id: DEFAULT_RENDER_PASS_ID,
                      order: 0,
                      rendererPassId: DEFAULT_RENDER_PASS_ID,
                      clearFlags: ['color', 'depth'],
                      clearColor: this._defaultClearColor,
                  } satisfies SceneRenderPassDefinition,
              ];

        for (const renderPass of initialRenderPasses) {
            this.registerRenderPass(renderPass);
        }

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
        const componentName = getComponentMetadata(componentType)?.scriptName ?? componentType.name;
        this._componentTypes.set(componentName, componentType);
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
        this._shaderDefinitions.set(resource.id, cloneShaderDefinition(definition));

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
            textureBindings: new Map(
                Object.entries(definition.textures ?? {}).map(([name, binding]) => [
                    name,
                    normalizeTextureBinding(binding),
                ])
            ),
        };

        this._materials.set(resource.id, resource);
        this._materialDefinitions.set(resource.id, cloneMaterialDefinition(definition));

        return {
            id: resource.id,
            shaderId: resource.shaderId,
            textureBindings: [...resource.textureBindings.keys()],
        };
    }

    setMaterialUniform(materialId: string, name: string, value: SceneUniformValue): this {
        this._assertNotDisposed();
        const material = this._materials.get(materialId);
        if (!material) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        material.uniforms.set(name, value);
        const definition = this._materialDefinitions.get(materialId);
        if (definition) {
            const uniforms = { ...(definition.uniforms ?? {}) };
            uniforms[name] = cloneSceneValue(value);
            this._materialDefinitions.set(materialId, {
                ...definition,
                uniforms,
            });
        }

        return this;
    }

    setMaterialTexture(
        materialId: string,
        name: string,
        binding: SceneTextureBindingDefinition
    ): this {
        this._assertNotDisposed();
        const material = this._materials.get(materialId);
        if (!material) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        material.textureBindings.set(name, normalizeTextureBinding(binding));
        const definition = this._materialDefinitions.get(materialId);
        if (definition) {
            this._materialDefinitions.set(materialId, {
                ...definition,
                textures: {
                    ...(definition.textures ?? {}),
                    [name]: cloneTextureBinding(binding),
                },
            });
        }

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
            textureBindings: [...material.textureBindings.keys()],
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
        this._meshDefinitions.set(resource.id, cloneMeshDefinition(definition));

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

    registerSampler(definition: SceneSamplerDefinition): SceneSamplerHandle {
        this._assertNotDisposed();
        const existing = this._samplers.get(definition.id);
        if (existing && !existing.sampler.isDisposed) {
            existing.sampler.dispose();
            this._samplers.delete(definition.id);
        }

        const sampler = this._textureManager.createSampler({
            minFilter: definition.minFilter ?? FilterMode.LINEAR,
            magFilter: definition.magFilter ?? FilterMode.LINEAR,
            wrapS: definition.wrapS ?? WrapMode.REPEAT,
            wrapT: definition.wrapT ?? WrapMode.REPEAT,
            wrapR: definition.wrapR,
            maxAnisotropy: definition.maxAnisotropy,
        });

        this._samplers.set(definition.id, {
            id: definition.id,
            sampler,
        });
        this._samplerDefinitions.set(definition.id, cloneSamplerDefinition(definition));

        return {
            id: definition.id,
        };
    }

    getSampler(id: string): SceneSamplerHandle | null {
        const sampler = this._samplers.get(id);
        if (!sampler) {
            return null;
        }

        return {
            id: sampler.id,
        };
    }

    async registerTexture(definition: SceneTextureDefinition): Promise<SceneTextureHandle> {
        this._assertNotDisposed();
        const existing = this._textures.get(definition.id);
        if (existing && !existing.texture.isDisposed) {
            existing.texture.dispose();
            this._textures.delete(definition.id);
        }

        const resource = await this._createTextureResource(definition);
        this._textures.set(resource.id, resource);
        this._textureDefinitions.set(resource.id, cloneTextureDefinition(definition));

        return {
            id: resource.id,
            width: resource.width,
            height: resource.height,
            samplerId: resource.samplerId,
        };
    }

    getTexture(id: string): SceneTextureHandle | null {
        const texture = this._textures.get(id);
        if (!texture) {
            return null;
        }

        return {
            id: texture.id,
            width: texture.width,
            height: texture.height,
            samplerId: texture.samplerId,
        };
    }

    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle {
        this._assertNotDisposed();
        const resource: RenderPassResource = {
            id: definition.id,
            order: definition.order ?? this._renderPasses.size,
            rendererPassId: definition.rendererPassId ?? definition.id,
            enabled: definition.enabled ?? true,
            clearFlags:
                definition.clearFlags ??
                (this._renderPasses.size === 0 || definition.id === DEFAULT_RENDER_PASS_ID
                    ? ['color', 'depth']
                    : []),
            clearColor:
                definition.clearColor === null
                    ? null
                    : definition.clearColor
                      ? toVec4(definition.clearColor)
                      : definition.id === DEFAULT_RENDER_PASS_ID
                        ? toVec4(this._defaultClearColor)
                        : null,
            clearDepth: definition.clearDepth ?? null,
            depthTest: definition.depthTest,
            cull: definition.cull,
            blend: definition.blend,
        };

        this._renderPasses.set(definition.id, resource);
        this._renderPassDefinitions.set(definition.id, cloneRenderPassDefinition(definition));

        return {
            id: resource.id,
            order: resource.order,
            rendererPassId: resource.rendererPassId,
            enabled: resource.enabled,
        };
    }

    getRenderPass(id: string): SceneRenderPassHandle | null {
        const renderPass = this._renderPasses.get(id);
        if (!renderPass) {
            return null;
        }

        return {
            id: renderPass.id,
            order: renderPass.order,
            rendererPassId: renderPass.rendererPassId,
            enabled: renderPass.enabled,
        };
    }

    getRenderPasses(): readonly SceneRenderPassHandle[] {
        return [...this._renderPasses.values()]
            .sort((left, right) => left.order - right.order)
            .map((renderPass) => ({
                id: renderPass.id,
                order: renderPass.order,
                rendererPassId: renderPass.rendererPassId,
                enabled: renderPass.enabled,
            }));
    }

    createBoxMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        depth: number = 1
    ): SceneMeshHandle {
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

    createPrefab(
        id: string,
        actors: readonly Actor[] = this.world.getAllActors()
    ): ScenePrefabDefinition {
        this._assertNotDisposed();

        return {
            id,
            actors: actors.map((actor) => this._createActorSnapshot(actor)),
        };
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        this._assertNotDisposed();
        const createdActors: Actor[] = [];

        for (const actorSnapshot of prefab.actors) {
            const actor = this.createActor({
                name: `${options.namePrefix ?? ''}${actorSnapshot.name}`,
                layer: actorSnapshot.layer as any,
                tag: actorSnapshot.tag as any,
                active: false,
                persistent: actorSnapshot.persistent,
                pooled: actorSnapshot.pooled,
                autoStart: false,
            });

            for (const componentSnapshot of actorSnapshot.components) {
                this._hydrateComponent(actor, componentSnapshot, options);
            }

            actor.start();
            actor.active = actorSnapshot.active;
            createdActors.push(actor);
        }

        return createdActors;
    }

    serializeScene(): SceneSnapshot {
        this._assertNotDisposed();

        return {
            version: 1,
            prefab: this.createPrefab(`${this.id}:prefab`),
            shaders: [...this._shaderDefinitions.values()].map((definition) =>
                cloneShaderDefinition(definition)
            ),
            meshes: [...this._meshDefinitions.values()].map((definition) =>
                cloneMeshDefinition(definition)
            ),
            materials: [...this._materialDefinitions.values()].map((definition) =>
                cloneMaterialDefinition(definition)
            ),
            textures: [...this._textureDefinitions.values()].map((definition) =>
                cloneTextureDefinition(definition)
            ),
            samplers: [...this._samplerDefinitions.values()].map((definition) =>
                cloneSamplerDefinition(definition)
            ),
            renderPasses: [...this._renderPassDefinitions.values()]
                .map((definition) => cloneRenderPassDefinition(definition))
                .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
        };
    }

    async loadScene(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly Actor[]> {
        this._assertNotDisposed();

        if (snapshot.version !== 1) {
            throw new SceneLifecycleError(
                `Unsupported scene snapshot version '${snapshot.version}'`
            );
        }

        if (options.clearExisting !== false) {
            this._destroyAllActors();
            this._clearSceneAssets();
        }

        for (const shader of snapshot.shaders) {
            this.registerShader(shader);
        }

        for (const mesh of snapshot.meshes) {
            this.registerMesh(mesh);
        }

        for (const sampler of snapshot.samplers) {
            this.registerSampler(sampler);
        }

        for (const texture of snapshot.textures) {
            await this.registerTexture(texture);
        }

        if (options.clearExisting !== false) {
            this._renderPasses.clear();
            this._renderPassDefinitions.clear();
        }

        const renderPasses =
            snapshot.renderPasses.length > 0
                ? snapshot.renderPasses
                : [
                      {
                          id: DEFAULT_RENDER_PASS_ID,
                          order: 0,
                          rendererPassId: DEFAULT_RENDER_PASS_ID,
                          clearFlags: ['color', 'depth'],
                          clearColor: this._defaultClearColor,
                      } satisfies SceneRenderPassDefinition,
                  ];

        for (const renderPass of renderPasses) {
            this.registerRenderPass(renderPass);
        }

        for (const material of snapshot.materials) {
            this.createMaterial(material);
        }

        return this.instantiatePrefab(snapshot.prefab, options);
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
            this._clearSceneAssets();
            this._textureManager.dispose();

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
            } else if (
                typeof document !== 'undefined' &&
                typeof document.createElement === 'function'
            ) {
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

        if (autoCreated && options.appendToDom !== false && typeof document !== 'undefined') {
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
        const fragmentShader = this._compileShader(
            this.gl.FRAGMENT_SHADER,
            definition.fragmentSource
        );

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
                throw new SceneShaderError(`Failed to link shader '${definition.id}': ${info}`);
            }

            const uniformNames = Array.from(
                new Set(
                    definition.uniforms ??
                        extractUniformNames(definition.vertexSource, definition.fragmentSource)
                )
            );

            const uniformLocations = new Map<string, WebGLUniformLocation>();
            const uniformTypes = new Map<string, number>();
            for (const uniformName of uniformNames) {
                const location = this.gl.getUniformLocation(program, uniformName);
                if (location !== null) {
                    uniformLocations.set(uniformName, location);
                }
            }

            const activeUniformCount = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
            for (let index = 0; index < activeUniformCount; index += 1) {
                const info = this.gl.getActiveUniform(program, index);
                if (!info) {
                    continue;
                }

                const normalizedName = normalizeUniformName(info.name);
                uniformTypes.set(info.name, info.type);
                uniformTypes.set(normalizedName, info.type);
            }

            return {
                id: definition.id,
                program,
                uniformLocations,
                uniformTypes,
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
                throw new SceneMeshError(
                    `Failed to create index buffer for mesh '${definition.id}'`
                );
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
        const byteLength = definition.vertices.byteLength;
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

    private async _createTextureResource(
        definition: SceneTextureDefinition
    ): Promise<TextureResource> {
        const format = definition.format ?? TextureFormat.RGBA8;
        const generateMipmaps = definition.generateMipmaps ?? true;
        const mipLevelsFor = (width: number, height: number): number =>
            generateMipmaps ? calculateMipLevels(width, height) : 1;

        let texture: ITexture;

        switch (definition.source.kind) {
            case 'color': {
                const width = definition.source.width ?? 1;
                const height = definition.source.height ?? 1;
                texture = this._textureManager.createTexture(
                    {
                        width,
                        height,
                        format,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(width, height),
                    },
                    createSolidTextureData(definition.source.color, width, height)
                );
                break;
            }
            case 'checker': {
                const size = definition.source.size ?? 8;
                texture = this._textureManager.createTexture(
                    {
                        width: size,
                        height: size,
                        format,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(size, size),
                    },
                    createCheckerTextureData(
                        size,
                        definition.source.colorA ?? [0.08, 0.1, 0.12, 1],
                        definition.source.colorB ?? [0.88, 0.92, 0.96, 1]
                    )
                );
                break;
            }
            case 'data': {
                texture = this._textureManager.createTexture(
                    {
                        width: definition.source.width,
                        height: definition.source.height,
                        format,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(definition.source.width, definition.source.height),
                    },
                    createRawTextureData(
                        format,
                        definition.source.width,
                        definition.source.height,
                        definition.source.data,
                        definition.source.channels
                    )
                );
                break;
            }
            case 'url': {
                const image = await this._loadImage(
                    definition.source.url,
                    definition.source.crossOrigin
                );
                texture = this._textureManager.createTexture(
                    {
                        width: image.width,
                        height: image.height,
                        format,
                        dimension: TextureDimension.TEXTURE_2D,
                        usage: TextureUsage.STATIC,
                        mipLevels: mipLevelsFor(image.width, image.height),
                    },
                    image
                );
                break;
            }
        }

        if (generateMipmaps && texture.mipLevels > 1) {
            texture.generateMipmaps();
        }

        return {
            id: definition.id,
            texture,
            width: texture.width,
            height: texture.height,
            samplerId: definition.samplerId ?? null,
        };
    }

    private async _loadImage(url: string, crossOrigin?: string | null): Promise<HTMLImageElement> {
        return await new Promise((resolve, reject) => {
            const image = new Image();

            if (crossOrigin !== undefined) {
                image.crossOrigin = crossOrigin ?? '';
            } else if (url.startsWith('http')) {
                image.crossOrigin = 'anonymous';
            }

            image.onload = () => resolve(image);
            image.onerror = () => reject(new SceneMaterialError(`Failed to load texture '${url}'`));
            image.src = url;
        });
    }

    private _registerGeometryBuffers(
        id: string,
        geometryBuffers: IGeometryBuffers
    ): SceneMeshHandle {
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

        const vertexReader = geometryBuffers.vertices.duplicate().rewind();
        const vertexFloatCount = vertexReader.remaining / 4;
        const vertexBytes = new Float32Array(vertexFloatCount);
        for (let index = 0; index < vertexFloatCount; index += 1) {
            vertexBytes[index] = vertexReader.getFloat32();
        }

        const indexReader = geometryBuffers.indices.duplicate().rewind();
        const bytesPerIndex =
            geometryBuffers.layout.indexCount > 0
                ? indexReader.remaining / geometryBuffers.layout.indexCount
                : 0;
        const indexArray =
            geometryBuffers.layout.indexCount > 0
                ? bytesPerIndex === 4
                    ? new Uint32Array(
                          Array.from({ length: geometryBuffers.layout.indexCount }, () =>
                              indexReader.getUint32()
                          )
                      )
                    : new Uint16Array(
                          Array.from({ length: geometryBuffers.layout.indexCount }, () =>
                              indexReader.getUint16()
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
        const lighting = this._collectLighting();
        const renderPasses = [...this._renderPasses.values()]
            .filter((renderPass) => renderPass.enabled)
            .sort((left, right) => left.order - right.order);

        if (renderPasses.length === 0) {
            return;
        }

        const aspectRatio = this.canvas.width / Math.max(1, this.canvas.height);
        const viewMatrix = camera?.getViewMatrix();
        const projectionMatrix = camera?.getProjectionMatrix(aspectRatio);
        const cameraPosition = camera?.getWorldPosition();

        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        for (const renderPass of renderPasses) {
            this._prepareRenderPass(renderPass, camera);

            if (!camera || !viewMatrix || !projectionMatrix || !cameraPosition) {
                continue;
            }

            const renderItems = this._collectRenderItems(renderPass.rendererPassId);
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

                this._applyRenderState(shader, renderPass);
                this.gl.useProgram(shader.program);
                this.gl.bindVertexArray(mesh.vertexArray);

                this._setUniform(shader, 'u_Model', modelMatrix);
                this._setUniform(shader, 'u_View', viewMatrix);
                this._setUniform(shader, 'u_Projection', projectionMatrix);
                this._setUniform(shader, 'u_ViewProjection', viewProjectionMatrix);
                this._setUniform(shader, 'u_MVP', mvpMatrix);
                this._setUniform(shader, 'u_Time', this.loop.elapsed / 1000);
                this._setUniform(shader, 'u_DeltaTime', deltaTime / 1000);
                this._setUniform(shader, 'u_Frame', this.loop.frame);
                this._setUniform(
                    shader,
                    'u_Resolution',
                    new Vec2(this.canvas.width, this.canvas.height)
                );
                this._setUniform(shader, 'u_CameraPosition', cameraPosition);
                this._applyLightingUniforms(shader, item.renderer, lighting);

                const boundUnits = this._bindMaterialTextures(shader, material);

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

                this._unbindTextureUnits(boundUnits);
            }
        }

        this.gl.bindVertexArray(null);
    }

    private _prepareRenderPass(renderPass: RenderPassResource, camera?: Camera): void {
        const clearFlags = renderPass.clearFlags;
        let mask = 0;

        if (clearFlags.includes('color')) {
            const clearColor =
                renderPass.clearColor ?? camera?.clearColor ?? this._defaultClearColor;
            this.gl.clearColor(clearColor.x, clearColor.y, clearColor.z, clearColor.w);
            mask |= this.gl.COLOR_BUFFER_BIT;
        }

        if (clearFlags.includes('depth')) {
            this.gl.clearDepth(renderPass.clearDepth ?? camera?.clearDepth ?? 1);
            mask |= this.gl.DEPTH_BUFFER_BIT;
        }

        if (mask !== 0) {
            this.gl.clear(mask);
        }
    }

    private _collectRenderItems(passId: string): RenderItem[] {
        const items: RenderItem[] = [];

        for (const actor of this.world.getAllActors()) {
            if (!actor.active) {
                continue;
            }

            const transform = actor.getComponent(Transform);
            const renderer = actor.getComponent(MeshRenderer);

            if (
                !transform ||
                !renderer ||
                !renderer.enabled ||
                !renderer.visible ||
                renderer.passId !== passId
            ) {
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

    private _collectLighting(): LightingState {
        let primaryDirectional: DirectionalLightState | null = null;
        let fallbackDirectional: DirectionalLightState | null = null;
        let pointLight: PointLightState | null = null;
        let pointCount = 0;
        const ambient = new Vec3(this._ambientLight.x, this._ambientLight.y, this._ambientLight.z);

        for (const actor of this.world.getAllActors()) {
            if (!actor.active) {
                continue;
            }

            const directional = actor.getComponent(DirectionalLight);
            if (directional && directional.enabled) {
                const state: DirectionalLightState = {
                    direction: directional.getDirection(),
                    color: directional.color.clone(),
                    intensity: directional.intensity,
                };

                ambient.x += directional.ambientColor.x;
                ambient.y += directional.ambientColor.y;
                ambient.z += directional.ambientColor.z;

                if (directional.primary) {
                    primaryDirectional = state;
                } else if (!fallbackDirectional) {
                    fallbackDirectional = state;
                }
            }

            const point = actor.getComponent(PointLight);
            if (point && point.enabled) {
                pointCount += 1;
                if (!pointLight) {
                    pointLight = {
                        position: point.getWorldPosition(),
                        color: point.color.clone(),
                        intensity: point.intensity,
                        range: point.range,
                    };
                }
            }
        }

        return {
            ambient,
            directional: primaryDirectional ?? fallbackDirectional,
            point: pointLight,
            pointCount,
        };
    }

    private _applyRenderState(shader: ShaderResource, renderPass: RenderPassResource): void {
        const depthTest = renderPass.depthTest ?? shader.depthTest;
        const cull = renderPass.cull ?? shader.cull;
        const blend = renderPass.blend ?? shader.blend;

        if (depthTest) {
            this.gl.enable(this.gl.DEPTH_TEST);
        } else {
            this.gl.disable(this.gl.DEPTH_TEST);
        }

        if (cull) {
            this.gl.enable(this.gl.CULL_FACE);
            this.gl.frontFace(this.gl.CCW);
            this.gl.cullFace(this.gl.BACK);
        } else {
            this.gl.disable(this.gl.CULL_FACE);
        }

        if (blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        } else {
            this.gl.disable(this.gl.BLEND);
        }

        this.gl.depthMask(true);
    }

    private _applyLightingUniforms(
        shader: ShaderResource,
        renderer: MeshRenderer,
        lighting: LightingState
    ): void {
        const receiveLighting = renderer.receiveLighting;
        const directional = receiveLighting ? lighting.directional : null;
        const point = receiveLighting ? lighting.point : null;

        this._setUniform(shader, 'u_ReceiveLighting', receiveLighting);
        this._setUniform(shader, 'u_AmbientLight', receiveLighting ? lighting.ambient : Vec3.ZERO);
        this._setUniform(shader, 'u_LightDirection', directional?.direction ?? new Vec3(0, -1, 0));
        this._setUniform(shader, 'u_LightColor', directional?.color ?? Vec3.ZERO);
        this._setUniform(shader, 'u_LightIntensity', directional?.intensity ?? 0);
        this._setUniform(shader, 'u_PointLightCount', receiveLighting ? lighting.pointCount : 0);
        this._setUniform(shader, 'u_PointLightPosition', point?.position ?? Vec3.ZERO);
        this._setUniform(shader, 'u_PointLightColor', point?.color ?? Vec3.ZERO);
        this._setUniform(shader, 'u_PointLightIntensity', point?.intensity ?? 0);
        this._setUniform(shader, 'u_PointLightRange', point?.range ?? 0);
    }

    private _bindMaterialTextures(shader: ShaderResource, material: MaterialResource): number[] {
        const assignments = [...material.textureBindings.entries()].sort((left, right) => {
            const leftUnit = left[1].unit ?? Number.MAX_SAFE_INTEGER;
            const rightUnit = right[1].unit ?? Number.MAX_SAFE_INTEGER;
            return leftUnit - rightUnit;
        });

        const usedUnits = new Set<number>();
        const boundUnits: number[] = [];
        let nextUnit = 0;

        for (const [uniformName, binding] of assignments) {
            const texture = this._textures.get(binding.textureId);
            if (!texture) {
                continue;
            }

            let unit = binding.unit;
            if (unit === undefined) {
                while (usedUnits.has(nextUnit)) {
                    nextUnit += 1;
                }
                unit = nextUnit;
            }

            usedUnits.add(unit);
            boundUnits.push(unit);

            texture.texture.bind(unit);
            const sampler = this._resolveSampler(binding.samplerId ?? texture.samplerId);
            sampler.bind(unit);
            this._setUniform(shader, uniformName, unit);
        }

        return boundUnits;
    }

    private _unbindTextureUnits(units: readonly number[]): void {
        for (const unit of units) {
            this.gl.bindSampler(unit, null);
            this.gl.activeTexture(this.gl.TEXTURE0 + unit);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }
    }

    private _toWebGLMatrixData(value: Mat4): Float32Array {
        return new Float32Array(Mat4.transpose(value).data);
    }

    private _setNumericUniform(
        shader: ShaderResource,
        location: WebGLUniformLocation,
        name: string,
        value: number
    ): void {
        const uniformType = shader.uniformTypes.get(name);

        switch (uniformType) {
            case this.gl.BOOL:
            case this.gl.INT:
            case this.gl.SAMPLER_2D:
            case this.gl.SAMPLER_CUBE:
            case this.gl.SAMPLER_2D_SHADOW:
            case this.gl.SAMPLER_2D_ARRAY:
            case this.gl.SAMPLER_2D_ARRAY_SHADOW:
            case this.gl.SAMPLER_CUBE_SHADOW:
            case this.gl.INT_SAMPLER_2D:
            case this.gl.INT_SAMPLER_3D:
            case this.gl.INT_SAMPLER_CUBE:
            case this.gl.INT_SAMPLER_2D_ARRAY:
            case this.gl.UNSIGNED_INT_SAMPLER_2D:
            case this.gl.UNSIGNED_INT_SAMPLER_3D:
            case this.gl.UNSIGNED_INT_SAMPLER_CUBE:
            case this.gl.UNSIGNED_INT_SAMPLER_2D_ARRAY:
                this.gl.uniform1i(location, Math.trunc(value));
                return;
            case this.gl.UNSIGNED_INT:
                this.gl.uniform1ui(location, Math.max(0, Math.trunc(value)));
                return;
            case this.gl.FLOAT:
            default:
                this.gl.uniform1f(location, value);
                return;
        }
    }

    private _resolveSampler(id: string | null): ITextureSampler {
        if (!id) {
            return this._defaultSampler;
        }

        return this._samplers.get(id)?.sampler ?? this._defaultSampler;
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
            this.gl.uniformMatrix4fv(location, false, this._toWebGLMatrixData(value));
            return;
        }

        if (value instanceof Quat) {
            this.gl.uniform4f(location, value.x, value.y, value.z, value.w);
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
                    this.gl.uniformMatrix4fv(
                        location,
                        false,
                        this._toWebGLMatrixData(new Mat4(value))
                    );
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
                    this.gl.uniformMatrix4fv(
                        location,
                        false,
                        this._toWebGLMatrixData(new Mat4(value))
                    );
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
            this._setNumericUniform(shader, location, name, value);
        }
    }

    private _createActorSnapshot(actor: Actor): SceneActorSnapshot {
        const components = actor
            .getAllComponents()
            .map((component) => this._createComponentSnapshot(component));

        return {
            name: actor.name,
            layer: actor.layer,
            tag: actor.tag,
            active: actor.active,
            persistent: actor.persistent,
            pooled: actor.pooled,
            components,
        };
    }

    private _createComponentSnapshot(component: Component): SceneComponentSnapshot {
        const serialize = (component as { serialize?: () => Record<string, any> }).serialize;
        const data = typeof serialize === 'function' ? (serialize.call(component) ?? {}) : {};

        return {
            type: component.constructor.name,
            data: encodeSceneValue(data),
        };
    }

    private _hydrateComponent(
        actor: Actor,
        snapshot: SceneComponentSnapshot,
        options: ScenePrefabInstantiateOptions
    ): void {
        const componentType = this._componentTypes.get(snapshot.type);
        if (!componentType) {
            throw new SceneLifecycleError(
                `Cannot instantiate prefab because component '${snapshot.type}' is not registered`
            );
        }

        const existingComponent = actor
            .getAllComponents()
            .find((component) => component.constructor === componentType);
        const component =
            existingComponent ??
            actor.addComponent(
                componentType as new (...args: any[]) => Component,
                ...(options.componentArgsResolver?.(snapshot.type, snapshot.data) ?? [])
            );

        const decoded = decodeSceneValue(snapshot.data);
        if (
            typeof (component as { deserialize?: (data: Record<string, any>) => void })
                .deserialize === 'function'
        ) {
            (component as { deserialize(data: Record<string, any>): void }).deserialize(
                (decoded && typeof decoded === 'object' && !Array.isArray(decoded)
                    ? decoded
                    : {}) as Record<string, any>
            );
            return;
        }

        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
            Object.assign(component as object, decoded);
        }
    }

    private _clearSceneAssets(): void {
        for (const shader of this._shaders.values()) {
            this.gl.deleteProgram(shader.program);
        }

        for (const mesh of this._meshes.values()) {
            this._disposeMesh(mesh);
        }

        for (const sampler of this._samplers.values()) {
            if (!sampler.sampler.isDisposed) {
                sampler.sampler.dispose();
            }
        }

        for (const texture of this._textures.values()) {
            if (!texture.texture.isDisposed) {
                texture.texture.dispose();
            }
        }

        this._shaders.clear();
        this._shaderDefinitions.clear();
        this._materials.clear();
        this._materialDefinitions.clear();
        this._meshes.clear();
        this._meshDefinitions.clear();
        this._samplers.clear();
        this._samplerDefinitions.clear();
        this._textures.clear();
        this._textureDefinitions.clear();
        this._renderPasses.clear();
        this._renderPassDefinitions.clear();
    }

    private _destroyAllActors(): void {
        const actors = [...this.world.getAllActors()];
        for (const actor of actors) {
            actor.destroy(true);
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
