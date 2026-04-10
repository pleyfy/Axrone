import type { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import type { FilterMode, TextureFormat, WrapMode } from '../../renderer/webgl2/texture/interfaces';

export type GltfMeshSemantic =
    | 'position'
    | 'normal'
    | 'uv0'
    | 'uv1'
    | 'tangent'
    | 'color0'
    | 'joints0'
    | 'weights0';

export type GltfMorphTargetSemantic = 'position' | 'normal' | 'tangent';
export type GltfMeshTopology = 'triangles' | 'lines' | 'points';

export type GltfUniformValue =
    | number
    | boolean
    | readonly number[]
    | Float32Array
    | Int32Array
    | Uint32Array
    | Vec2
    | Vec3
    | Vec4
    | Quat
    | Mat4;

export type GltfSerializedValue =
    | string
    | number
    | boolean
    | null
    | readonly GltfSerializedValue[]
    | { readonly [key: string]: GltfSerializedValue };

export interface GltfVertexAttribute {
    readonly semantic: GltfMeshSemantic;
    readonly componentCount: 1 | 2 | 3 | 4;
    readonly offset: number;
    readonly stride: number;
    readonly type?: number;
    readonly normalized?: boolean;
    readonly integer?: boolean;
}

export interface GltfMorphTargetAttribute {
    readonly semantic: GltfMorphTargetSemantic;
    readonly componentCount: 3;
    readonly values: Float32Array;
}

export interface GltfMorphTargetDefinition {
    readonly name?: string;
    readonly attributes: readonly GltfMorphTargetAttribute[];
}

export interface GltfMeshDefinition {
    readonly id: string;
    readonly vertices: BufferSource;
    readonly attributes: readonly GltfVertexAttribute[];
    readonly morphTargets?: readonly GltfMorphTargetDefinition[];
    readonly indices?: Uint8Array | Uint16Array | Uint32Array;
    readonly vertexCount?: number;
    readonly topology?: GltfMeshTopology;
    readonly usage?: number;
}

export interface GltfSamplerDefinition {
    readonly id: string;
    readonly minFilter?: FilterMode;
    readonly magFilter?: FilterMode;
    readonly wrapS?: WrapMode;
    readonly wrapT?: WrapMode;
    readonly wrapR?: WrapMode;
    readonly maxAnisotropy?: number;
}

export interface GltfTextureCompressedLevelDefinition {
    readonly level: number;
    readonly width: number;
    readonly height: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

export type GltfTextureSourceDefinition =
    | {
          readonly kind: 'color';
          readonly color: readonly [number, number, number, number];
          readonly width?: number;
          readonly height?: number;
      }
    | {
          readonly kind: 'checker';
          readonly size?: number;
          readonly colorA?: readonly [number, number, number, number];
          readonly colorB?: readonly [number, number, number, number];
      }
    | {
          readonly kind: 'data';
          readonly width: number;
          readonly height: number;
          readonly data: readonly number[];
          readonly channels?: 1 | 2 | 3 | 4;
      }
    | {
          readonly kind: 'url';
          readonly url: string;
          readonly crossOrigin?: string | null;
      }
    | {
          readonly kind: 'bytes';
          readonly bytes: readonly number[] | Uint8Array;
          readonly mimeType: string;
          readonly uri?: string;
      }
    | {
          readonly kind: 'compressed';
          readonly bytes: readonly number[] | Uint8Array;
          readonly levels: readonly GltfTextureCompressedLevelDefinition[];
          readonly container?: 'ktx2' | 'basisu';
          readonly uri?: string;
      };

export interface GltfTextureDefinition {
    readonly id: string;
    readonly source: GltfTextureSourceDefinition;
    readonly format?: TextureFormat;
    readonly generateMipmaps?: boolean;
    readonly samplerId?: string;
}

export type GltfTextureBindingDefinition =
    | string
    | {
          readonly textureId: string;
          readonly samplerId?: string;
          readonly unit?: number;
      };

export interface GltfShaderDefinition {
    readonly id: string;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly attributes?: Partial<Record<GltfMeshSemantic, string>>;
    readonly uniforms?: readonly string[];
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export interface GltfMaterialDefinition {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms?: Readonly<Record<string, GltfUniformValue>>;
    readonly textures?: Readonly<Record<string, GltfTextureBindingDefinition>>;
}

export interface GltfComponentSnapshot {
    readonly type: string;
    readonly data: GltfSerializedValue;
}

export interface GltfActorSnapshot {
    readonly nodeId?: string;
    readonly parentNodeId?: string | null;
    readonly name: string;
    readonly layer: number;
    readonly tag: string;
    readonly active: boolean;
    readonly persistent: boolean;
    readonly pooled: boolean;
    readonly components: readonly GltfComponentSnapshot[];
}

export interface GltfPrefabDefinition {
    readonly id: string;
    readonly actors: readonly GltfActorSnapshot[];
}