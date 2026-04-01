import type { Vec2, Vec3, Vec4, Mat4 } from '@axrone/numeric';
import type { Actor, ActorConfig } from '../component-system/core/actor';
import type { World } from '../component-system/core/world';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import type { GameLoopScheduler, GameLoopStatus } from '../game-loop';
import type { Camera } from './components/camera';
import type { MeshRenderer } from './components/mesh-renderer';
import type { Transform } from '../component-system/components/transform';

export type SceneMeshSemantic = 'position' | 'normal' | 'uv0' | 'color0';
export type SceneMeshTopology = 'triangles' | 'lines' | 'points';

export type SceneUniformValue =
    | number
    | boolean
    | readonly number[]
    | Float32Array
    | Int32Array
    | Uint32Array
    | Vec2
    | Vec3
    | Vec4
    | Mat4;

export interface SceneVertexAttribute {
    readonly semantic: SceneMeshSemantic;
    readonly componentCount: 1 | 2 | 3 | 4;
    readonly offset: number;
    readonly stride: number;
    readonly type?: number;
    readonly normalized?: boolean;
}

export interface SceneMeshDefinition {
    readonly id: string;
    readonly vertices: BufferSource;
    readonly attributes: readonly SceneVertexAttribute[];
    readonly indices?: Uint8Array | Uint16Array | Uint32Array;
    readonly vertexCount?: number;
    readonly topology?: SceneMeshTopology;
    readonly usage?: number;
}

export interface SceneShaderDefinition {
    readonly id: string;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly attributes?: Partial<Record<SceneMeshSemantic, string>>;
    readonly uniforms?: readonly string[];
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export interface SceneMaterialDefinition {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms?: Readonly<Record<string, SceneUniformValue>>;
}

export interface SceneCanvasOptions {
    readonly canvas?: HTMLCanvasElement;
    readonly gl?: WebGL2RenderingContext;
    readonly parent?: HTMLElement;
    readonly width?: number;
    readonly height?: number;
    readonly pixelRatio?: number;
    readonly className?: string;
    readonly appendToDom?: boolean;
    readonly contextAttributes?: WebGLContextAttributes;
    readonly createCanvas?: () => HTMLCanvasElement;
}

export interface SceneOptions<R extends ComponentRegistry = Record<string, never>>
    extends SceneCanvasOptions {
    readonly registry?: R;
    readonly scheduler?: GameLoopScheduler;
    readonly autoStart?: boolean;
    readonly fixedDelta?: number;
    readonly maxDelta?: number;
    readonly maxSubSteps?: number;
    readonly clearColor?: Vec4 | readonly [number, number, number, number];
}

export interface SceneShaderHandle {
    readonly id: string;
    readonly uniformNames: readonly string[];
}

export interface SceneMeshHandle {
    readonly id: string;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly topology: SceneMeshTopology;
}

export interface SceneMaterialHandle {
    readonly id: string;
    readonly shaderId: string;
}

export type SceneBuiltInRegistry = {
    readonly Transform: typeof Transform;
    readonly Camera: typeof Camera;
    readonly MeshRenderer: typeof MeshRenderer;
};

export type SceneRegistry<R extends ComponentRegistry = Record<string, never>> = R &
    SceneBuiltInRegistry;

export interface SceneLoopState {
    readonly sceneId: string;
}

export interface SceneActorFactory<R extends ComponentRegistry = Record<string, never>> {
    createActor(config?: ActorConfig): Actor<World<SceneRegistry<R>>>;
}

export interface SceneLifecycle<R extends ComponentRegistry = Record<string, never>>
    extends SceneActorFactory<R> {
    readonly status: GameLoopStatus;
    readonly isDisposed: boolean;
    start(now?: number): this;
    pause(): this;
    resume(now?: number): this;
    stop(): this;
    renderNow(): this;
    resize(width?: number, height?: number, pixelRatio?: number): this;
    dispose(): void;
}

export interface SceneSystemHost<R extends ComponentRegistry = Record<string, never>> {
    addSystem<Q extends SystemQuery<SceneRegistry<R>>>(
        system: System<SceneRegistry<R>, Q>,
        phase?: string
    ): this;
    removeSystem(systemId: string): boolean;
}

export interface SceneComponentHost<R extends ComponentRegistry = Record<string, never>> {
    registerComponent<T extends ComponentConstructor>(componentType: T): this;
    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean;
    getRegisteredComponentNames(): readonly string[];
}