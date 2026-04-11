export * from '@axrone/physics-core';
export * from '@axrone/physics-2d';
export * from '@axrone/physics-3d';

export type {
    RaycastId,
    LayerMask,
    RaycastFlags,
    RaycastLayer,
    IRay2D,
    IRay3D,
    IRaycastHit2D,
    IRaycastHit3D,
    IRaycastQuery2D,
    IRaycastQuery3D,
    RaycastPredicate2D,
    RaycastPredicate3D,
    IBarycentricCoords,
} from './types/raycast-types';
export { RayPrimitiveIntersector2D, RayPrimitiveIntersector3D } from './core/raycast-primitives';
export {
    Raycaster2D as RaycastEngine2D,
    Raycaster3D as RaycastEngine3D,
    RaycastResult2D,
    RaycastResult3D,
} from './core/raycast-engine';
export { BoundingVolumeHierarchy } from './core/raycast-bvh';
export { SpatialHashGrid3D, SpatialOctree } from './core/raycast-spatial';
export {
    RaycastCache2D,
    RaycastCache3D,
    RaycastBatcher2D,
    RaycastBatcher3D,
    RaycastStatistics,
} from './core/raycast-optimization';
export {
    RaycastSystem2D,
    RaycastSystem3D,
    createRaycastSystem2D,
    createRaycastSystem3D,
} from './core/raycast-system';
export * from './core/raycast-errors';
export {
    RaycastHitComparator,
    RayBuilder2D,
    RayBuilder3D,
    LayerMaskBuilder,
    RaycastFlagsBuilder,
    interpolateHit2D,
    interpolateHit3D,
    createSphereCastOrigins3D,
    createBoxCastOrigins3D,
} from './core/raycast-utils';
export {
    ShapeCaster3D,
    MultiRaycaster3D,
    createShapeCaster3D,
    createMultiRaycaster3D,
} from './core/raycast-advanced';
export type {
    IShapecastQuery3D,
    ISphereCastQuery3D,
    IBoxCastQuery3D,
    ICapsuleCastQuery3D,
} from './core/raycast-advanced';
export {
    ContinuousRaycast3D,
    AdaptiveRaycaster3D,
    PriorityRaycaster3D,
    createContinuousRaycast3D,
    createAdaptiveRaycaster3D,
    createPriorityRaycaster3D,
} from './core/raycast-continuous';
export type { ITimeOfImpact, ISweepTestQuery } from './core/raycast-continuous';
