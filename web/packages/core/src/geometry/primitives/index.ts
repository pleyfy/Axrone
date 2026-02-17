export * from './types';
export { GeometryBuilder } from './geometry-builder';

export { createSphere, createUVSphere, createIcosphere } from './sphere';
export { createBox, createCube, createRoundedBox } from './box';
export { createCapsule, createPill } from './capsule';
export { createCylinder, createCone, createTruncatedCone, createTube } from './cylinder';
export { createPlane, createQuad, createCircle, createRing, createGrid } from './plane';
export { createTorus, createTorusKnot, createSpring } from './torus';

export type {
    IGeometryBuffers,
    IGeometryLayout,
    IVertexAttribute,
    IPrimitiveConfig,
    ISphereConfig,
    IBoxConfig,
    ICapsuleConfig,
    ICylinderConfig,
    IPlaneConfig,
    ITorusConfig,
    GLAttributeType,
} from './types';

export {
    createVertexAttribute,
    createGeometryLayout,
    getAttributeTypeSize,
    DEFAULT_PRIMITIVE_CONFIG,
    VERTEX_ATTRIBUTES,
} from './types';
