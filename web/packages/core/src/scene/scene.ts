import { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import { createBox, createPlane, createSphere } from '../geometry/primitives';
import type { IGeometryBuffers } from '../geometry/primitives/types';
import { createGameLoop, type GameLoop, type GameLoopSystem } from '../game-loop';
import { Hierarchy } from '../component-system/components/hierarchy';
import { Transform } from '../component-system/components/transform';
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
import { Animator } from './components/animator';
import { Camera, type CameraConfig } from './components/camera';
import { DirectionalLight } from './components/directional-light';
import { MeshRenderer, type MeshRendererConfig } from './components/mesh-renderer';
import { OrbitCameraController } from './components/orbit-camera-controller';
import { PrefabNodeBinding } from './components/prefab-node-binding';
import { PointLight } from './components/point-light';
import { SpotLight } from './components/spot-light';
import {
    SceneCanvasError,
    SceneLifecycleError,
    SceneMaterialError,
    SceneMeshError,
    SceneShaderError,
} from './errors';
import { ScenePrefabRuntime } from './scene-prefab-runtime';
import {
    cloneMeshDefinition,
    cloneTextureBinding,
    decodeSceneValue,
    encodeSceneValue,
} from './serialization';
import type {
    SceneClearFlag,
    SceneLoopState,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMaterialTextureBindingHandle,
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
    SceneTextureResourceHandle,
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

interface MorphMeshResourceCache {
    readonly rendererId: string;
    readonly baseMeshId: string;
    readonly resource: MeshResource;
    readonly vertices: Uint8Array;
    lastWeightVersion: number;
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

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const encodeBase64 = (bytes: Uint8Array): string => {
    let result = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const byte0 = bytes[index] ?? 0;
        const byte1 = bytes[index + 1] ?? 0;
        const byte2 = bytes[index + 2] ?? 0;
        const block = (byte0 << 16) | (byte1 << 8) | byte2;

        result +=
            BASE64_ALPHABET[(block >>> 18) & 63] +
            BASE64_ALPHABET[(block >>> 12) & 63] +
            (index + 1 < bytes.length ? BASE64_ALPHABET[(block >>> 6) & 63] : '=') +
            (index + 2 < bytes.length ? BASE64_ALPHABET[block & 63] : '=');
    }

    return result;
};

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

interface SceneRenderStatsState {
    frame: number;
    drawCalls: number;
    trianglesSubmitted: number;
}

interface DirectionalLightState {
    readonly direction: Vec3;
    readonly color: Vec3;
    readonly intensity: number;
}

interface PointLightState {
    readonly type: 'point';
    readonly position: Vec3;
    readonly color: Vec3;
    readonly intensity: number;
    readonly range: number;
}

interface SpotLightState {
    readonly type: 'spot';
    readonly position: Vec3;
    readonly direction: Vec3;
    readonly color: Vec3;
    readonly intensity: number;
    readonly range: number;
    readonly innerConeAngle: number;
    readonly outerConeAngle: number;
}

type LocalLightState = PointLightState | SpotLightState;

interface LightingState {
    readonly ambient: Vec3;
    readonly directional: DirectionalLightState | null;
    readonly localLights: readonly LocalLightState[];
    readonly pointCount: number;
    readonly spotCount: number;
}

const DEFAULT_ATTRIBUTE_NAMES: Readonly<Record<SceneMeshSemantic, string>> = Object.freeze({
    position: 'a_Position',
    normal: 'a_Normal',
    uv0: 'a_UV0',
    uv1: 'a_UV1',
    tangent: 'a_Tangent',
    color0: 'a_Color0',
    joints0: 'a_Joints0',
    weights0: 'a_Weights0',
});

const normalizeUniformName = (name: string): string => name.replace(/\[0\]$/, '');

const ATTRIBUTE_LOCATIONS: Readonly<Record<SceneMeshSemantic, number>> = Object.freeze({
    position: 0,
    normal: 1,
    uv0: 2,
    color0: 3,
    tangent: 4,
    uv1: 5,
    joints0: 9,
    weights0: 10,
});

const DEFAULT_CLEAR_COLOR = new Vec4(0.08, 0.09, 0.11, 1);
const DEFAULT_AMBIENT_LIGHT = new Vec3(0.08, 0.08, 0.1);
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_RENDER_PASS_ID = 'main';
const MAX_SCENE_LOCAL_LIGHTS = 4;

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

const MORPH_WEIGHT_EPSILON = 1e-6;

const toBufferBytes = (value: BufferSource): Uint8Array =>
    ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);

const hasActiveMorphWeights = (
    weights: Float32Array | null,
    targetCount: number
): boolean => {
    if (!weights || targetCount <= 0) {
        return false;
    }

    const count = Math.min(weights.length, targetCount);
    for (let index = 0; index < count; index += 1) {
        if (Math.abs(weights[index] ?? 0) > MORPH_WEIGHT_EPSILON) {
            return true;
        }
    }

    return false;
};

const applyMorphTargetsToVertexBytes = (
    definition: SceneMeshDefinition,
    vertices: Uint8Array,
    weights: Float32Array
): void => {
    const morphTargets = definition.morphTargets;
    const baseAttributeMap = new Map(
        definition.attributes.map((attribute) => [attribute.semantic, attribute] as const)
    );
    if (!morphTargets || morphTargets.length === 0 || definition.attributes.length === 0) {
        return;
    }

    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const vertexStride = definition.attributes[0]!.stride;
    const vertexCount = definition.vertexCount ?? Math.floor(vertices.byteLength / vertexStride);
    const targetCount = Math.min(weights.length, morphTargets.length);

    for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
        const weight = weights[targetIndex] ?? 0;
        if (Math.abs(weight) <= MORPH_WEIGHT_EPSILON) {
            continue;
        }

        const target = morphTargets[targetIndex]!;
        for (const attribute of target.attributes) {
            const baseAttribute = baseAttributeMap.get(attribute.semantic);
            if (!baseAttribute) {
                continue;
            }

            for (let vertex = 0; vertex < vertexCount; vertex += 1) {
                const sourceOffset = vertex * attribute.componentCount;
                const destinationBaseOffset = vertex * baseAttribute.stride + baseAttribute.offset;

                for (let component = 0; component < attribute.componentCount; component += 1) {
                    const componentOffset =
                        destinationBaseOffset + component * Float32Array.BYTES_PER_ELEMENT;
                    const currentValue = view.getFloat32(componentOffset, true);
                    const delta = attribute.values[sourceOffset + component] ?? 0;
                    view.setFloat32(componentOffset, currentValue + delta * weight, true);
                }
            }
        }
    }
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

    if (source.kind === 'bytes') {
        return {
            ...definition,
            source: {
                ...source,
                bytes:
                    source.bytes instanceof Uint8Array
                        ? new Uint8Array(source.bytes)
                        : [...source.bytes],
            },
        };
    }

    if (source.kind === 'compressed') {
        return {
            ...definition,
            source: {
                ...source,
                bytes:
                    source.bytes instanceof Uint8Array
                        ? new Uint8Array(source.bytes)
                        : [...source.bytes],
                levels: source.levels.map((level) => ({ ...level })),
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
        case 'texCoord1':
            return 'uv1';
        case 'tangent':
            return 'tangent';
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

const estimateTriangleCount = (mesh: MeshResource): number => {
    if (mesh.topology !== 'triangles') {
        return 0;
    }

    if (mesh.indexCount > 0) {
        return Math.floor(mesh.indexCount / 3);
    }

    return Math.floor(mesh.vertexCount / 3);
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

const mapUniformTypeName = (
    gl: WebGL2RenderingContext,
    typeName: string
): number | undefined => {
    switch (typeName) {
        case 'float':
            return gl.FLOAT;
        case 'vec2':
            return gl.FLOAT_VEC2;
        case 'vec3':
            return gl.FLOAT_VEC3;
        case 'vec4':
            return gl.FLOAT_VEC4;
        case 'int':
            return gl.INT;
        case 'ivec2':
            return gl.INT_VEC2;
        case 'ivec3':
            return gl.INT_VEC3;
        case 'ivec4':
            return gl.INT_VEC4;
        case 'uint':
            return gl.UNSIGNED_INT;
        case 'uvec2':
            return gl.UNSIGNED_INT_VEC2;
        case 'uvec3':
            return gl.UNSIGNED_INT_VEC3;
        case 'uvec4':
            return gl.UNSIGNED_INT_VEC4;
        case 'bool':
            return gl.BOOL;
        case 'bvec2':
            return gl.BOOL_VEC2;
        case 'bvec3':
            return gl.BOOL_VEC3;
        case 'bvec4':
            return gl.BOOL_VEC4;
        case 'mat4':
            return gl.FLOAT_MAT4;
        case 'sampler2D':
            return gl.SAMPLER_2D;
        case 'samplerCube':
            return gl.SAMPLER_CUBE;
        default:
            return undefined;
    }
};

const extractUniformTypeHints = (
    gl: WebGL2RenderingContext,
    ...sources: string[]
): Map<string, number> => {
    const types = new Map<string, number>();
    const pattern = /\buniform\s+(\w+)\s+(\w+)(?:\s*\[[^\]]+\])?\s*;/g;

    for (const source of sources) {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);

        while (match !== null) {
            const uniformType = mapUniformTypeName(gl, match[1]!);
            if (uniformType !== undefined) {
                const uniformName = match[2]!;
                types.set(uniformName, uniformType);
                types.set(normalizeUniformName(uniformName), uniformType);
            }
            match = pattern.exec(source);
        }
    }

    return types;
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
    private readonly _prefabs: ScenePrefabRuntime;
    private readonly _shaders = new Map<string, ShaderResource>();
    private readonly _shaderDefinitions = new Map<string, SceneShaderDefinition>();
    private readonly _materials = new Map<string, MaterialResource>();
    private readonly _materialDefinitions = new Map<string, SceneMaterialDefinition>();
    private readonly _meshes = new Map<string, MeshResource>();
    private readonly _meshDefinitions = new Map<string, SceneMeshDefinition>();
    private readonly _morphMeshes = new Map<string, MorphMeshResourceCache>();
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
    private readonly _renderStats: SceneRenderStatsState = {
        frame: 0,
        drawCalls: 0,
        trianglesSubmitted: 0,
    };
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
            Hierarchy,
            Transform,
            PrefabNodeBinding,
            Animator,
            Camera,
            MeshRenderer,
            DirectionalLight,
            PointLight,
            SpotLight,
            OrbitCameraController,
            ...(options.registry ?? ({} as R)),
        } as RuntimeRegistry<R>;

        for (const componentType of Object.values(this._registry)) {
            const componentName =
                getComponentMetadata(componentType)?.scriptName ?? componentType.name;
            this._componentTypes.set(componentName, componentType);
        }

        this.world = new World(this._registry, options.worldConfig);
        this.systems = new SystemManager(this.world);
        this._prefabs = new ScenePrefabRuntime({
            componentTypes: this._componentTypes,
            createActor: (config) => this.createActor(config),
            getAllActors: () => this.world.getAllActors(),
        });
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

    get renderStats() {
        return {
            frame: this._renderStats.frame,
            drawCalls: this._renderStats.drawCalls,
            trianglesSubmitted: this._renderStats.trianglesSubmitted,
        };
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
        this._disposeMorphMeshesForBaseMesh(definition.id);
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

    getTextureResource(id: string): SceneTextureResourceHandle | null {
        const texture = this._textures.get(id);
        if (!texture) {
            return null;
        }
        const sampler = this._resolveSampler(texture.samplerId);
        return {
            id: texture.id,
            width: texture.width,
            height: texture.height,
            samplerId: texture.samplerId,
            nativeTexture: texture.texture.nativeHandle,
            nativeSampler: sampler.nativeHandle,
        };
    }

    getMaterialTextureBindings(materialId: string): readonly SceneMaterialTextureBindingHandle[] {
        const material = this._materials.get(materialId);
        if (!material) {
            return [];
        }

        return [...material.textureBindings.entries()]
            .sort((left, right) => {
                const leftUnit = left[1].unit ?? Number.MAX_SAFE_INTEGER;
                const rightUnit = right[1].unit ?? Number.MAX_SAFE_INTEGER;
                return leftUnit - rightUnit || left[0].localeCompare(right[0]);
            })
            .flatMap(([uniformName, binding]) => {
                const texture = this._textures.get(binding.textureId);
                if (!texture) {
                    return [];
                }
                const sampler = this._resolveSampler(binding.samplerId ?? texture.samplerId);
                return [
                    {
                        materialId,
                        uniformName,
                        textureId: binding.textureId,
                        samplerId: binding.samplerId ?? texture.samplerId,
                        unit: binding.unit ?? null,
                        width: texture.width,
                        height: texture.height,
                        nativeTexture: texture.texture.nativeHandle,
                        nativeSampler: sampler.nativeHandle,
                    } satisfies SceneMaterialTextureBindingHandle,
                ];
            });
    }

    getMaterialTextureBinding(
        materialId: string,
        uniformName?: string
    ): SceneMaterialTextureBindingHandle | null {
        const bindings = this.getMaterialTextureBindings(materialId);
        if (bindings.length === 0) {
            return null;
        }
        if (!uniformName) {
            return bindings[0] ?? null;
        }
        return bindings.find((binding) => binding.uniformName === uniformName) ?? null;
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
        return this._prefabs.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        this._assertNotDisposed();
        return this._prefabs.instantiatePrefab(prefab, options);
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
            this._prefabs.destroyAllActors();
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

            if (typeof this.gl.getActiveUniform === 'function') {
                const activeUniformCount = this.gl.getProgramParameter(
                    program,
                    this.gl.ACTIVE_UNIFORMS
                );

                for (let index = 0; index < activeUniformCount; index += 1) {
                    const info = this.gl.getActiveUniform(program, index);
                    if (!info) {
                        continue;
                    }

                    const normalizedName = normalizeUniformName(info.name);
                    uniformTypes.set(info.name, info.type);
                    uniformTypes.set(normalizedName, info.type);
                }
            }

            for (const [uniformName, uniformType] of extractUniformTypeHints(
                this.gl,
                definition.vertexSource,
                definition.fragmentSource
            )) {
                if (!uniformTypes.has(uniformName)) {
                    uniformTypes.set(uniformName, uniformType);
                }
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
            const attributeType = attribute.type ?? this.gl.FLOAT;
            if (attribute.integer && typeof this.gl.vertexAttribIPointer === 'function') {
                this.gl.vertexAttribIPointer(
                    location,
                    attribute.componentCount,
                    attributeType,
                    attribute.stride,
                    attribute.offset
                );
            } else {
                this.gl.vertexAttribPointer(
                    location,
                    attribute.componentCount,
                    attributeType,
                    attribute.normalized ?? false,
                    attribute.stride,
                    attribute.offset
                );
            }
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
            case 'bytes': {
                const image = await this._loadImageFromBytes(
                    definition.source.bytes,
                    definition.source.mimeType,
                    definition.source.uri
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
            case 'compressed': {
                if (definition.format === undefined) {
                    throw new SceneMaterialError(
                        `Compressed texture '${definition.id}' must provide an explicit texture format`
                    );
                }

                const levels = [...definition.source.levels].sort((left, right) => left.level - right.level);
                const topLevel = levels[0];
                if (!topLevel) {
                    throw new SceneMaterialError(
                        `Compressed texture '${definition.id}' must include at least one mip level`
                    );
                }

                const compressedBytes =
                    definition.source.bytes instanceof Uint8Array
                        ? definition.source.bytes
                        : new Uint8Array(definition.source.bytes);
                const mipLevelCount = levels.reduce(
                    (count, level) => Math.max(count, level.level + 1),
                    1
                );

                texture = this._textureManager.createTexture({
                    width: topLevel.width,
                    height: topLevel.height,
                    format,
                    dimension: TextureDimension.TEXTURE_2D,
                    usage: TextureUsage.STATIC,
                    mipLevels: mipLevelCount,
                });

                for (const level of levels) {
                    const start = level.byteOffset;
                    const end = start + level.byteLength;
                    if (start < 0 || end > compressedBytes.byteLength) {
                        throw new SceneMaterialError(
                            `Compressed texture '${definition.id}' mip ${level.level} exceeds its payload bounds`
                        );
                    }

                    texture.setData(compressedBytes.subarray(start, end), {
                        mipLevel: level.level,
                        width: level.width,
                        height: level.height,
                    });
                }
                break;
            }
        }

        if (generateMipmaps && texture.mipLevels > 1 && texture.isCompressed === false) {
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

    private async _loadImageFromBytes(
        bytes: readonly number[] | Uint8Array,
        mimeType: string,
        uri?: string
    ): Promise<HTMLImageElement> {
        if (mimeType.startsWith('image/') === false) {
            throw new SceneMaterialError(
                `Cannot decode texture bytes${uri ? ` for '${uri}'` : ''} because mime type '${mimeType}' is not an image`
            );
        }

        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const blobBytes = new Uint8Array(data);
        const blob = new Blob([blobBytes.buffer], { type: mimeType });
        const canCreateObjectUrl =
            typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
        const objectUrl = canCreateObjectUrl
            ? URL.createObjectURL(blob)
            : `data:${mimeType};base64,${encodeBase64(blobBytes)}`;

        try {
            return await this._loadImage(objectUrl);
        } finally {
            if (canCreateObjectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        }
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
        this._renderStats.frame = this.loop.frame;
        this._renderStats.drawCalls = 0;
        this._renderStats.trianglesSubmitted = 0;
        const activeRendererIds = new Set<string>();

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

                const mesh = this._resolveRenderableMesh(item.renderer);
                const material = this._materials.get(item.renderer.materialId);

                if (!mesh || !material) {
                    continue;
                }

                activeRendererIds.add(item.renderer.id);

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
                this._applySkinningUniforms(shader, item.renderer);

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

                this._renderStats.drawCalls += 1;
                this._renderStats.trianglesSubmitted += estimateTriangleCount(mesh);

                this._unbindTextureUnits(boundUnits);
            }
        }

        this.gl.bindVertexArray(null);
        this._pruneMorphMeshCache(activeRendererIds);
    }

    private _resolveRenderableMesh(renderer: MeshRenderer): MeshResource | null {
        const meshId = renderer.meshId;
        if (!meshId) {
            return null;
        }

        const mesh = this._meshes.get(meshId);
        const definition = this._meshDefinitions.get(meshId);
        if (!mesh || !definition?.morphTargets?.length) {
            return mesh ?? null;
        }

        const weights = renderer.getMorphWeightArray();
        if (!hasActiveMorphWeights(weights, definition.morphTargets.length)) {
            return mesh;
        }

        return this._getOrCreateMorphMeshResource(renderer, mesh, definition, weights!);
    }

    private _getOrCreateMorphMeshResource(
        renderer: MeshRenderer,
        mesh: MeshResource,
        definition: SceneMeshDefinition,
        weights: Float32Array
    ): MeshResource {
        const cacheKey = renderer.id;
        const sourceVertices = toBufferBytes(definition.vertices);
        let cache = this._morphMeshes.get(cacheKey);

        if (
            !cache ||
            cache.baseMeshId !== mesh.id ||
            cache.vertices.byteLength !== sourceVertices.byteLength
        ) {
            if (cache) {
                this._disposeMesh(cache.resource);
            }

            const vertices = new Uint8Array(sourceVertices.byteLength);
            vertices.set(sourceVertices);
            const resource = this._createMeshResource({
                id: `${mesh.id}#morph#${renderer.id}`,
                vertices,
                attributes: definition.attributes.map((attribute) => ({ ...attribute })),
                ...(definition.indices ? { indices: definition.indices } : {}),
                ...(definition.vertexCount !== undefined
                    ? { vertexCount: definition.vertexCount }
                    : {}),
                ...(definition.topology ? { topology: definition.topology } : {}),
                usage: this.gl.DYNAMIC_DRAW,
            });

            cache = {
                rendererId: cacheKey,
                baseMeshId: mesh.id,
                resource,
                vertices,
                lastWeightVersion: -1,
            };
            this._morphMeshes.set(cacheKey, cache);
        }

        if (cache.lastWeightVersion !== renderer.morphWeightVersion) {
            cache.vertices.set(sourceVertices);
            applyMorphTargetsToVertexBytes(definition, cache.vertices, weights);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, cache.resource.vertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, cache.vertices, this.gl.DYNAMIC_DRAW);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
            cache.lastWeightVersion = renderer.morphWeightVersion;
        }

        return cache.resource;
    }

    private _disposeMorphMeshesForBaseMesh(meshId: string): void {
        for (const [cacheKey, cache] of this._morphMeshes.entries()) {
            if (cache.baseMeshId !== meshId) {
                continue;
            }

            this._disposeMesh(cache.resource);
            this._morphMeshes.delete(cacheKey);
        }
    }

    private _pruneMorphMeshCache(activeRendererIds: ReadonlySet<string>): void {
        for (const [cacheKey, cache] of this._morphMeshes.entries()) {
            if (activeRendererIds.has(cacheKey)) {
                continue;
            }

            this._disposeMesh(cache.resource);
            this._morphMeshes.delete(cacheKey);
        }
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
        const localLights: LocalLightState[] = [];
        let pointCount = 0;
        let spotCount = 0;
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
            if (point && point.enabled && localLights.length < MAX_SCENE_LOCAL_LIGHTS) {
                pointCount += 1;
                localLights.push({
                    type: 'point',
                    position: point.getWorldPosition(),
                    color: point.color.clone(),
                    intensity: point.intensity,
                    range: point.range,
                });
            }

            const spot = actor.getComponent(SpotLight);
            if (spot && spot.enabled && localLights.length < MAX_SCENE_LOCAL_LIGHTS) {
                spotCount += 1;
                localLights.push({
                    type: 'spot',
                    position: spot.getWorldPosition(),
                    direction: spot.getDirection(),
                    color: spot.color.clone(),
                    intensity: spot.intensity,
                    range: spot.range,
                    innerConeAngle: spot.innerConeAngle,
                    outerConeAngle: spot.outerConeAngle,
                });
            }
        }

        return {
            ambient,
            directional: primaryDirectional ?? fallbackDirectional,
            localLights: Object.freeze(localLights),
            pointCount,
            spotCount,
        };
    }

    private _applyRenderState(shader: ShaderResource, renderPass: RenderPassResource): void {
        const depthTest = renderPass.depthTest ?? shader.depthTest;
        const cull = renderPass.cull ?? shader.cull;
        const blend = renderPass.blend ?? shader.blend;

        if (depthTest) {
            this.gl.enable?.(this.gl.DEPTH_TEST);
        } else {
            this.gl.disable?.(this.gl.DEPTH_TEST);
        }

        if (cull) {
            this.gl.enable?.(this.gl.CULL_FACE);
            this.gl.frontFace?.(this.gl.CCW);
            this.gl.cullFace?.(this.gl.BACK);
        } else {
            this.gl.disable?.(this.gl.CULL_FACE);
        }

        if (blend) {
            this.gl.enable?.(this.gl.BLEND);
            this.gl.blendFunc?.(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        } else {
            this.gl.disable?.(this.gl.BLEND);
        }

        this.gl.depthMask?.(true);
    }

    private _applyLightingUniforms(
        shader: ShaderResource,
        renderer: MeshRenderer,
        lighting: LightingState
    ): void {
        const receiveLighting = renderer.receiveLighting;
        const directional = receiveLighting ? lighting.directional : null;
        const localLights: readonly LocalLightState[] = receiveLighting ? lighting.localLights : [];
        const point = localLights.find(
            (light: LocalLightState): light is PointLightState => light.type === 'point'
        );
        const spot = localLights.find(
            (light: LocalLightState): light is SpotLightState => light.type === 'spot'
        );
        const localLightTypes = new Int32Array(Math.max(1, localLights.length));
        const localLightPositions = new Float32Array(Math.max(1, localLights.length) * 3);
        const localLightDirections = new Float32Array(Math.max(1, localLights.length) * 3);
        const localLightColors = new Float32Array(Math.max(1, localLights.length) * 3);
        const localLightIntensities = new Float32Array(Math.max(1, localLights.length));
        const localLightRanges = new Float32Array(Math.max(1, localLights.length));
        const localLightInnerCones = new Float32Array(Math.max(1, localLights.length));
        const localLightOuterCones = new Float32Array(Math.max(1, localLights.length));

        for (let index = 0; index < localLights.length; index += 1) {
            const light = localLights[index]!;
            const offset = index * 3;
            localLightTypes[index] = light.type === 'spot' ? 1 : 0;
            localLightPositions[offset] = light.position.x;
            localLightPositions[offset + 1] = light.position.y;
            localLightPositions[offset + 2] = light.position.z;
            localLightColors[offset] = light.color.x;
            localLightColors[offset + 1] = light.color.y;
            localLightColors[offset + 2] = light.color.z;
            localLightIntensities[index] = light.intensity;
            localLightRanges[index] = light.range;

            if (light.type === 'spot') {
                localLightDirections[offset] = light.direction.x;
                localLightDirections[offset + 1] = light.direction.y;
                localLightDirections[offset + 2] = light.direction.z;
                localLightInnerCones[index] = light.innerConeAngle;
                localLightOuterCones[index] = light.outerConeAngle;
            }
        }

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
        this._setUniform(shader, 'u_SpotLightCount', receiveLighting ? lighting.spotCount : 0);
        this._setUniform(shader, 'u_SpotLightPosition', spot?.position ?? Vec3.ZERO);
        this._setUniform(shader, 'u_SpotLightDirection', spot?.direction ?? new Vec3(0, -1, 0));
        this._setUniform(shader, 'u_SpotLightColor', spot?.color ?? Vec3.ZERO);
        this._setUniform(shader, 'u_SpotLightIntensity', spot?.intensity ?? 0);
        this._setUniform(shader, 'u_SpotLightRange', spot?.range ?? 0);
        this._setUniform(shader, 'u_SpotLightInnerCone', spot?.innerConeAngle ?? 0);
        this._setUniform(shader, 'u_SpotLightOuterCone', spot?.outerConeAngle ?? 0);
        this._setUniform(shader, 'u_LocalLightCount', receiveLighting ? localLights.length : 0);
        this._setUniform(shader, 'u_LocalLightType', localLightTypes);
        this._setUniform(shader, 'u_LocalLightPosition', localLightPositions);
        this._setUniform(shader, 'u_LocalLightDirection', localLightDirections);
        this._setUniform(shader, 'u_LocalLightColor', localLightColors);
        this._setUniform(shader, 'u_LocalLightIntensity', localLightIntensities);
        this._setUniform(shader, 'u_LocalLightRange', localLightRanges);
        this._setUniform(shader, 'u_LocalLightInnerCone', localLightInnerCones);
        this._setUniform(shader, 'u_LocalLightOuterCone', localLightOuterCones);
    }

    private _applySkinningUniforms(shader: ShaderResource, renderer: MeshRenderer): void {
        const palette = renderer.getSkinJointMatrixPalette();
        const jointCount = palette ? renderer.skinJointCount : 0;

        this._setUniform(shader, 'u_Skinning', Boolean(palette && jointCount > 0));
        this._setUniform(shader, 'u_SkinJointCount', jointCount);
        if (palette) {
            this._setUniform(shader, 'u_JointMatrices', palette);
        }
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

    private _toWebGLMatrixArrayData(value: Float32Array): Float32Array {
        if (value.length <= 16) {
            return this._toWebGLMatrixData(new Mat4(value));
        }

        const transformed = new Float32Array(value.length);
        for (let offset = 0; offset + 15 < value.length; offset += 16) {
            transformed.set(
                this._toWebGLMatrixData(new Mat4(value.subarray(offset, offset + 16))),
                offset
            );
        }
        return transformed;
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
            const uniformType = shader.uniformTypes.get(name);
            switch (uniformType) {
                case this.gl.FLOAT:
                    this.gl.uniform1fv(location, value);
                    return;
                case this.gl.FLOAT_MAT4:
                    this.gl.uniformMatrix4fv(
                        location,
                        false,
                        this._toWebGLMatrixArrayData(value)
                    );
                    return;
                case this.gl.FLOAT_VEC4:
                    this.gl.uniform4fv(location, value);
                    return;
                case this.gl.FLOAT_VEC3:
                    this.gl.uniform3fv(location, value);
                    return;
                case this.gl.FLOAT_VEC2:
                    this.gl.uniform2fv(location, value);
                    return;
            }
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
            const uniformType = shader.uniformTypes.get(name);
            switch (uniformType) {
                case this.gl.INT:
                case this.gl.BOOL:
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
                    this.gl.uniform1iv(location, value);
                    return;
                case this.gl.INT_VEC4:
                case this.gl.BOOL_VEC4:
                    this.gl.uniform4iv(location, value);
                    return;
                case this.gl.INT_VEC3:
                case this.gl.BOOL_VEC3:
                    this.gl.uniform3iv(location, value);
                    return;
                case this.gl.INT_VEC2:
                case this.gl.BOOL_VEC2:
                    this.gl.uniform2iv(location, value);
                    return;
            }
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
            const uniformType = shader.uniformTypes.get(name);
            switch (uniformType) {
                case this.gl.UNSIGNED_INT:
                    this.gl.uniform1uiv(location, value);
                    return;
                case this.gl.UNSIGNED_INT_VEC4:
                    this.gl.uniform4uiv(location, value);
                    return;
                case this.gl.UNSIGNED_INT_VEC3:
                    this.gl.uniform3uiv(location, value);
                    return;
                case this.gl.UNSIGNED_INT_VEC2:
                    this.gl.uniform2uiv(location, value);
                    return;
            }
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
            const uniformType = shader.uniformTypes.get(name);
            if (uniformType === this.gl.FLOAT_MAT4 && value.length % 16 === 0) {
                this.gl.uniformMatrix4fv(
                    location,
                    false,
                    this._toWebGLMatrixArrayData(new Float32Array(value))
                );
                return;
            }

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

    private _clearSceneAssets(): void {
        for (const shader of this._shaders.values()) {
            this.gl.deleteProgram(shader.program);
        }

        for (const mesh of this._meshes.values()) {
            this._disposeMesh(mesh);
        }

        for (const mesh of this._morphMeshes.values()) {
            this._disposeMesh(mesh.resource);
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
        this._morphMeshes.clear();
        this._samplers.clear();
        this._samplerDefinitions.clear();
        this._textures.clear();
        this._textureDefinitions.clear();
        this._renderPasses.clear();
        this._renderPassDefinitions.clear();
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
