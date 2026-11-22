export {
    Rigidbody3D,
    Rigidbody3DType,
    ForceMode3D,
    RigidbodyConstraints3D,
    CollisionDetectionMode3D,
    RigidbodyInterpolation3D,
} from './rigidbody3d';
export type { IRigidbody3DConfig } from './rigidbody3d';

export {
    Collider3D,
    PhysicMaterialCombine,
    CapsuleDirection3D,
    INVALID_SHAPE_ID,
} from './collider3d';
export type { IPhysicMaterial3D, IMutableCollisionFilter3D } from './collider3d';

export { BoxCollider3D } from './box-collider3d';
export { SphereCollider3D } from './sphere-collider3d';
export { CapsuleCollider3D } from './capsule-collider3d';
export { CylinderCollider3D } from './cylinder-collider3d';
export { MeshCollider3D } from './mesh-collider3d';

export {
    Joint3D,
    JOINT_CAPABILITY_3D,
    JointDriveMode3D,
    INVALID_CONSTRAINT_ID,
    DEFAULT_JOINT_DRIVE,
    DEFAULT_JOINT_MOTOR,
    DEFAULT_SOFT_JOINT_LIMIT,
    DEFAULT_SOFT_JOINT_LIMIT_SPRING,
} from './joint3d';
export type {
    JointCapability3D,
    IJointDrive3D,
    IJointLimits3D,
    IJointMotor3D,
    ISoftJointLimit3D,
    ISoftJointLimitSpring3D,
} from './joint3d';

export { FixedJoint3D } from './fixed-joint3d';
export { HingeJoint3D } from './hinge-joint3d';
export { SpringJoint3D } from './spring-joint3d';

export { CharacterController, CollisionFlags } from './character-controller';
export type { ICharacterControllerConfig } from './character-controller';
