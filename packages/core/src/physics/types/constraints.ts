import type { IVec2Like, IVec3Like } from '@axrone/numeric';
import type { BodyId, ConstraintId, ConstraintType, Force, Torque } from './primitives';

export const enum JointLimitState {
    Inactive = 0,
    AtLower = 1,
    AtUpper = 2,
    Equal = 3,
}

export interface IConstraintDef {
    readonly type: ConstraintType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface IDistanceConstraintDef2D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec2Like>;
    readonly localAnchorB: Readonly<IVec2Like>;
    readonly length?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly stiffness?: number;
    readonly damping?: number;
}

export interface IDistanceConstraintDef3D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec3Like>;
    readonly localAnchorB: Readonly<IVec3Like>;
    readonly length?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly stiffness?: number;
    readonly damping?: number;
}

export interface IRevoluteConstraintDef2D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec2Like>;
    readonly localAnchorB: Readonly<IVec2Like>;
    readonly referenceAngle?: number;
    readonly enableLimit?: boolean;
    readonly lowerAngle?: number;
    readonly upperAngle?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorTorque?: Torque;
}

export interface IRevoluteConstraintDef3D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec3Like>;
    readonly localAnchorB: Readonly<IVec3Like>;
    readonly axis: Readonly<IVec3Like>;
    readonly referenceAngle?: number;
    readonly enableLimit?: boolean;
    readonly lowerAngle?: number;
    readonly upperAngle?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorTorque?: Torque;
}

export interface IPrismaticConstraintDef2D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec2Like>;
    readonly localAnchorB: Readonly<IVec2Like>;
    readonly localAxisA: Readonly<IVec2Like>;
    readonly referenceAngle?: number;
    readonly enableLimit?: boolean;
    readonly lowerTranslation?: number;
    readonly upperTranslation?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorForce?: Force;
}

export interface IPrismaticConstraintDef3D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec3Like>;
    readonly localAnchorB: Readonly<IVec3Like>;
    readonly localAxisA: Readonly<IVec3Like>;
    readonly referenceAngle?: number;
    readonly enableLimit?: boolean;
    readonly lowerTranslation?: number;
    readonly upperTranslation?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorForce?: Force;
}

export interface IWeldConstraintDef2D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec2Like>;
    readonly localAnchorB: Readonly<IVec2Like>;
    readonly referenceAngle?: number;
    readonly stiffness?: number;
    readonly damping?: number;
}

export interface IWeldConstraintDef3D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec3Like>;
    readonly localAnchorB: Readonly<IVec3Like>;
    readonly referenceRotation?: Readonly<IVec3Like>;
    readonly stiffness?: number;
    readonly damping?: number;
}

export interface IWheelConstraintDef2D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec2Like>;
    readonly localAnchorB: Readonly<IVec2Like>;
    readonly localAxisA: Readonly<IVec2Like>;
    readonly enableLimit?: boolean;
    readonly lowerTranslation?: number;
    readonly upperTranslation?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorTorque?: Torque;
    readonly stiffness?: number;
    readonly damping?: number;
}

export interface IMotorConstraintDef2D extends IConstraintDef {
    readonly linearOffset: Readonly<IVec2Like>;
    readonly angularOffset?: number;
    readonly maxForce?: Force;
    readonly maxTorque?: Torque;
    readonly correctionFactor?: number;
}

export interface IMotorConstraintDef3D extends IConstraintDef {
    readonly linearOffset: Readonly<IVec3Like>;
    readonly angularOffset?: Readonly<IVec3Like>;
    readonly maxForce?: Force;
    readonly maxTorque?: Torque;
    readonly correctionFactor?: number;
}

export interface IMouseConstraintDef2D extends IConstraintDef {
    readonly target: Readonly<IVec2Like>;
    readonly maxForce?: Force;
    readonly stiffness?: number;
    readonly damping?: number;
}

export interface IGearConstraintDef extends IConstraintDef {
    readonly constraintIdA: ConstraintId;
    readonly constraintIdB: ConstraintId;
    readonly ratio?: number;
}

export interface IRopeConstraintDef2D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec2Like>;
    readonly localAnchorB: Readonly<IVec2Like>;
    readonly maxLength: number;
}

export interface IRopeConstraintDef3D extends IConstraintDef {
    readonly localAnchorA: Readonly<IVec3Like>;
    readonly localAnchorB: Readonly<IVec3Like>;
    readonly maxLength: number;
}

export interface IConstraint2D {
    readonly id: ConstraintId;
    readonly type: ConstraintType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly collideConnected: boolean;
    readonly userData?: unknown;

    getAnchorA(): IVec2Like;
    getAnchorB(): IVec2Like;
    getReactionForce(inverseDt: number): IVec2Like;
    getReactionTorque(inverseDt: number): number;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
}

export interface IConstraint3D {
    readonly id: ConstraintId;
    readonly type: ConstraintType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly collideConnected: boolean;
    readonly userData?: unknown;

    getAnchorA(): IVec3Like;
    getAnchorB(): IVec3Like;
    getReactionForce(inverseDt: number): IVec3Like;
    getReactionTorque(inverseDt: number): IVec3Like;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
}

export interface IDistanceConstraint2D extends IConstraint2D {
    getLength(): number;
    setLength(length: number): void;
    getMinLength(): number;
    setMinLength(length: number): void;
    getMaxLength(): number;
    setMaxLength(length: number): void;
    getCurrentLength(): number;
    getStiffness(): number;
    setStiffness(stiffness: number): void;
    getDamping(): number;
    setDamping(damping: number): void;
}

export interface IRevoluteConstraint2D extends IConstraint2D {
    getReferenceAngle(): number;
    getJointAngle(): number;
    getJointSpeed(): number;
    isLimitEnabled(): boolean;
    enableLimit(enabled: boolean): void;
    getLowerLimit(): number;
    getUpperLimit(): number;
    setLimits(lower: number, upper: number): void;
    isMotorEnabled(): boolean;
    enableMotor(enabled: boolean): void;
    getMotorSpeed(): number;
    setMotorSpeed(speed: number): void;
    getMaxMotorTorque(): Torque;
    setMaxMotorTorque(torque: Torque): void;
    getMotorTorque(inverseDt: number): Torque;
}

export interface IPrismaticConstraint2D extends IConstraint2D {
    getLocalAxisA(): IVec2Like;
    getReferenceAngle(): number;
    getJointTranslation(): number;
    getJointSpeed(): number;
    isLimitEnabled(): boolean;
    enableLimit(enabled: boolean): void;
    getLowerLimit(): number;
    getUpperLimit(): number;
    setLimits(lower: number, upper: number): void;
    isMotorEnabled(): boolean;
    enableMotor(enabled: boolean): void;
    getMotorSpeed(): number;
    setMotorSpeed(speed: number): void;
    getMaxMotorForce(): Force;
    setMaxMotorForce(force: Force): void;
    getMotorForce(inverseDt: number): Force;
}

export interface IWeldConstraint2D extends IConstraint2D {
    getReferenceAngle(): number;
    getStiffness(): number;
    setStiffness(stiffness: number): void;
    getDamping(): number;
    setDamping(damping: number): void;
}

export interface IWheelConstraint2D extends IConstraint2D {
    getLocalAxisA(): IVec2Like;
    getJointTranslation(): number;
    getJointLinearSpeed(): number;
    getJointAngle(): number;
    getJointAngularSpeed(): number;
    isLimitEnabled(): boolean;
    enableLimit(enabled: boolean): void;
    getLowerLimit(): number;
    getUpperLimit(): number;
    setLimits(lower: number, upper: number): void;
    isMotorEnabled(): boolean;
    enableMotor(enabled: boolean): void;
    getMotorSpeed(): number;
    setMotorSpeed(speed: number): void;
    getMaxMotorTorque(): Torque;
    setMaxMotorTorque(torque: Torque): void;
    getMotorTorque(inverseDt: number): Torque;
    getStiffness(): number;
    setStiffness(stiffness: number): void;
    getDamping(): number;
    setDamping(damping: number): void;
}

export interface IMotorConstraint2D extends IConstraint2D {
    getLinearOffset(): IVec2Like;
    setLinearOffset(offset: Readonly<IVec2Like>): void;
    getAngularOffset(): number;
    setAngularOffset(offset: number): void;
    getMaxForce(): Force;
    setMaxForce(force: Force): void;
    getMaxTorque(): Torque;
    setMaxTorque(torque: Torque): void;
    getCorrectionFactor(): number;
    setCorrectionFactor(factor: number): void;
}

export interface IMouseConstraint2D extends IConstraint2D {
    getTarget(): IVec2Like;
    setTarget(target: Readonly<IVec2Like>): void;
    getMaxForce(): Force;
    setMaxForce(force: Force): void;
    getStiffness(): number;
    setStiffness(stiffness: number): void;
    getDamping(): number;
    setDamping(damping: number): void;
}

export interface IGearConstraint extends IConstraint2D {
    getConstraintA(): ConstraintId;
    getConstraintB(): ConstraintId;
    getRatio(): number;
    setRatio(ratio: number): void;
}

export interface IRopeConstraint2D extends IConstraint2D {
    getMaxLength(): number;
    setMaxLength(length: number): void;
    getLimitState(): JointLimitState;
}

export interface IConstraintSolver {
    warmStart(): void;
    solveVelocityConstraints(): void;
    solvePositionConstraints(): boolean;
}

export interface IConstraintVelocityData {
    readonly jacobian: Float64Array;
    readonly effectiveMass: Float64Array;
    readonly bias: number;
    readonly impulse: number;
    readonly lowerImpulse: number;
    readonly upperImpulse: number;
}

export interface IConstraintPositionData {
    readonly c: number;
    readonly k: number;
    readonly positionError: number;
}
