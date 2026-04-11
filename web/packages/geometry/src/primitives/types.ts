import { IVec3Like } from '@axrone/numeric';
import { ByteBuffer } from '@axrone/utility';

declare const __geometryBrand: unique symbol;
declare const __vertexAttributeBrand: unique symbol;
declare const __geometryLayoutBrand: unique symbol;

export type GeometryData = ArrayBuffer & { readonly [__geometryBrand]: true };
export type VertexAttributeId = string & { readonly [__vertexAttributeBrand]: true };
export type GeometryLayoutId = string & { readonly [__geometryLayoutBrand]: true };

export const enum GLAttributeType {
    FLOAT = 0x1406,
    UNSIGNED_SHORT = 0x1403,
    UNSIGNED_INT = 0x1405,
    BYTE = 0x1400,
    UNSIGNED_BYTE = 0x1401,
    SHORT = 0x1402,
    INT = 0x1404,
}

export interface IVertexAttribute<TName extends string = string> {
    readonly name: TName;
    readonly size: 1 | 2 | 3 | 4;
    readonly type: GLAttributeType;
    readonly normalized: boolean;
    readonly offset: number;
}

export interface IGeometryLayout<
    TAttributes extends readonly IVertexAttribute[] = readonly IVertexAttribute[],
> {
    readonly id: GeometryLayoutId;
    readonly attributes: TAttributes;
    readonly stride: number;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly primitiveType: 'triangles' | 'lines' | 'points';
}

export interface IGeometryBuffers<TLayout extends IGeometryLayout = IGeometryLayout> {
    readonly vertices: ByteBuffer;
    readonly indices: ByteBuffer;
    readonly layout: TLayout;
}

export interface IPrimitiveConfig {
    readonly generateNormals: boolean;
    readonly generateTexCoords: boolean;
    readonly generateTangents: boolean;
    readonly flipWindingOrder: boolean;
    readonly useIndexBuffer: boolean;
    readonly indexType: GLAttributeType.UNSIGNED_SHORT | GLAttributeType.UNSIGNED_INT;
}

export interface ISphereConfig extends Partial<IPrimitiveConfig> {
    readonly radius: number;
    readonly widthSegments: number;
    readonly heightSegments: number;
    readonly phiStart: number;
    readonly phiLength: number;
    readonly thetaStart: number;
    readonly thetaLength: number;
}

export interface IBoxConfig extends Partial<IPrimitiveConfig> {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly widthSegments: number;
    readonly heightSegments: number;
    readonly depthSegments: number;
}

export interface ICylinderConfig extends Partial<IPrimitiveConfig> {
    readonly radiusTop: number;
    readonly radiusBottom: number;
    readonly height: number;
    readonly radialSegments: number;
    readonly heightSegments: number;
    readonly openEnded: boolean;
    readonly thetaStart: number;
    readonly thetaLength: number;
}

export interface ICapsuleConfig extends Partial<IPrimitiveConfig> {
    readonly radius: number;
    readonly length: number;
    readonly capSegments: number;
    readonly radialSegments: number;
}

export interface IPlaneConfig extends Partial<IPrimitiveConfig> {
    readonly width: number;
    readonly height: number;
    readonly widthSegments: number;
    readonly heightSegments: number;
}

export interface ITorusConfig extends Partial<IPrimitiveConfig> {
    readonly radius: number;
    readonly tube: number;
    readonly radialSegments: number;
    readonly tubularSegments: number;
    readonly arc: number;
}

export interface IVertex {
    position: IVec3Like;
    normal?: IVec3Like;
    texCoord?: { u: number; v: number };
    tangent?: IVec3Like;
}

export interface ITriangle {
    readonly a: number;
    readonly b: number;
    readonly c: number;
}

export const DEFAULT_PRIMITIVE_CONFIG: Required<IPrimitiveConfig> = {
    generateNormals: true,
    generateTexCoords: true,
    generateTangents: false,
    flipWindingOrder: false,
    useIndexBuffer: true,
    indexType: GLAttributeType.UNSIGNED_SHORT,
} as const;

export const VERTEX_ATTRIBUTES = {
    POSITION: 'position' as const,
    NORMAL: 'normal' as const,
    TEXCOORD: 'texCoord' as const,
    TANGENT: 'tangent' as const,
    COLOR: 'color' as const,
} as const;

export const createVertexAttribute = <TName extends string>(
    name: TName,
    size: 1 | 2 | 3 | 4,
    type: GLAttributeType,
    normalized: boolean = false,
    offset: number = 0
): IVertexAttribute<TName> => ({
    name,
    size,
    type,
    normalized,
    offset,
});

export const createGeometryLayout = <TAttributes extends readonly IVertexAttribute[]>(
    attributes: TAttributes,
    vertexCount: number,
    indexCount: number,
    primitiveType: 'triangles' | 'lines' | 'points' = 'triangles'
): IGeometryLayout<TAttributes> => {
    const stride = attributes.reduce((sum, attr) => {
        const typeSize = getAttributeTypeSize(attr.type);
        return sum + attr.size * typeSize;
    }, 0);

    const id =
        `layout_${attributes.map((a) => a.name).join('_')}_${Date.now()}` as GeometryLayoutId;

    return {
        id,
        attributes,
        stride,
        vertexCount,
        indexCount,
        primitiveType,
    };
};

export const getAttributeTypeSize = (type: GLAttributeType): number => {
    switch (type) {
        case GLAttributeType.BYTE:
        case GLAttributeType.UNSIGNED_BYTE:
            return 1;
        case GLAttributeType.SHORT:
        case GLAttributeType.UNSIGNED_SHORT:
            return 2;
        case GLAttributeType.INT:
        case GLAttributeType.UNSIGNED_INT:
        case GLAttributeType.FLOAT:
            return 4;
        default:
            throw new Error(`Unknown attribute type: ${type}`);
    }
};
