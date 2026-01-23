import type { IVec2Like } from '@axrone/numeric';
import type {
    ConstraintId,
    BodyId,
    Force,
    Torque,
} from '../types';
import { ConstraintType } from '../types';
import type {
    IDistanceConstraintDef2D,
    IRevoluteConstraintDef2D,
    IPrismaticConstraintDef2D,
    IWeldConstraintDef2D,
    IMotorConstraintDef2D,
    IMouseConstraintDef2D,
} from '../types';

const enum ConstraintManagerError {
    INVALID_STATE = 'INVALID_STATE',
    CONSTRAINT_NOT_FOUND = 'CONSTRAINT_NOT_FOUND',
    CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
}

class ConstraintError extends Error {
    readonly code: ConstraintManagerError;
    constructor(message: string, code: ConstraintManagerError) {
        super(message);
        this.name = 'ConstraintError';
        this.code = code;
        Object.setPrototypeOf(this, ConstraintError.prototype);
    }
}

interface ConstraintMetadata {
    readonly type: ConstraintType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly collideConnected: boolean;
    enabled: boolean;
    userData?: unknown;
}

const DISTANCE_STRIDE = 10;
const REVOLUTE_STRIDE = 14;
const PRISMATIC_STRIDE = 16;
const WELD_STRIDE = 8;
const MOTOR_STRIDE = 10;
const MOUSE_STRIDE = 8;

export class ConstraintManager2D implements Disposable {
    private _nextConstraintId: number = 1;
    private _constraintCount: number = 0;
    private readonly _maxConstraints: number;
    private readonly _metadata: Map<ConstraintId, ConstraintMetadata>;
    private readonly _distanceData: Float64Array;
    private readonly _revoluteData: Float64Array;
    private readonly _prismaticData: Float64Array;
    private readonly _weldData: Float64Array;
    private readonly _motorData: Float64Array;
    private readonly _mouseData: Float64Array;
    private readonly _constraintToDistanceIndex: Map<ConstraintId, number>;
    private readonly _constraintToRevoluteIndex: Map<ConstraintId, number>;
    private readonly _constraintToPrismaticIndex: Map<ConstraintId, number>;
    private readonly _constraintToWeldIndex: Map<ConstraintId, number>;
    private readonly _constraintToMotorIndex: Map<ConstraintId, number>;
    private readonly _constraintToMouseIndex: Map<ConstraintId, number>;
    private readonly _bodyToConstraints: Map<BodyId, Set<ConstraintId>>;
    private _distanceCount: number = 0;
    private _revoluteCount: number = 0;
    private _prismaticCount: number = 0;
    private _weldCount: number = 0;
    private _motorCount: number = 0;
    private _mouseCount: number = 0;
    private _disposed: boolean = false;

    constructor(maxConstraints: number = 512) {
        this._maxConstraints = maxConstraints;
        const quarterMax = Math.ceil(maxConstraints / 4);

        this._metadata = new Map();
        this._distanceData = new Float64Array(quarterMax * DISTANCE_STRIDE);
        this._revoluteData = new Float64Array(quarterMax * REVOLUTE_STRIDE);
        this._prismaticData = new Float64Array(quarterMax * PRISMATIC_STRIDE);
        this._weldData = new Float64Array(quarterMax * WELD_STRIDE);
        this._motorData = new Float64Array(quarterMax * MOTOR_STRIDE);
        this._mouseData = new Float64Array(quarterMax * MOUSE_STRIDE);

        this._constraintToDistanceIndex = new Map();
        this._constraintToRevoluteIndex = new Map();
        this._constraintToPrismaticIndex = new Map();
        this._constraintToWeldIndex = new Map();
        this._constraintToMotorIndex = new Map();
        this._constraintToMouseIndex = new Map();
        this._bodyToConstraints = new Map();
    }

    get constraintCount(): number {
        return this._constraintCount;
    }

    createDistanceConstraint(def: IDistanceConstraintDef2D): ConstraintId {
        this._assertNotDisposed();
        this._assertCapacity();

        const constraintId = this._nextConstraintId++ as ConstraintId;
        const index = this._distanceCount++;
        const offset = index * DISTANCE_STRIDE;

        this._distanceData[offset] = def.localAnchorA.x;
        this._distanceData[offset + 1] = def.localAnchorA.y;
        this._distanceData[offset + 2] = def.localAnchorB.x;
        this._distanceData[offset + 3] = def.localAnchorB.y;
        this._distanceData[offset + 4] = def.length ?? 1;
        this._distanceData[offset + 5] = def.minLength ?? 0;
        this._distanceData[offset + 6] = def.maxLength ?? Infinity;
        this._distanceData[offset + 7] = def.stiffness ?? 0;
        this._distanceData[offset + 8] = def.damping ?? 0;
        this._distanceData[offset + 9] = 0;

        this._constraintToDistanceIndex.set(constraintId, index);
        this._registerConstraint(constraintId, ConstraintType.Distance, def);
        return constraintId;
    }

    createRevoluteConstraint(def: IRevoluteConstraintDef2D): ConstraintId {
        this._assertNotDisposed();
        this._assertCapacity();

        const constraintId = this._nextConstraintId++ as ConstraintId;
        const index = this._revoluteCount++;
        const offset = index * REVOLUTE_STRIDE;

        this._revoluteData[offset] = def.localAnchorA.x;
        this._revoluteData[offset + 1] = def.localAnchorA.y;
        this._revoluteData[offset + 2] = def.localAnchorB.x;
        this._revoluteData[offset + 3] = def.localAnchorB.y;
        this._revoluteData[offset + 4] = def.referenceAngle ?? 0;
        this._revoluteData[offset + 5] = def.enableLimit ? 1 : 0;
        this._revoluteData[offset + 6] = def.lowerAngle ?? 0;
        this._revoluteData[offset + 7] = def.upperAngle ?? 0;
        this._revoluteData[offset + 8] = def.enableMotor ? 1 : 0;
        this._revoluteData[offset + 9] = def.motorSpeed ?? 0;
        this._revoluteData[offset + 10] = (def.maxMotorTorque as number) ?? 0;
        this._revoluteData[offset + 11] = 0;
        this._revoluteData[offset + 12] = 0;
        this._revoluteData[offset + 13] = 0;

        this._constraintToRevoluteIndex.set(constraintId, index);
        this._registerConstraint(constraintId, ConstraintType.Revolute, def);
        return constraintId;
    }

    createPrismaticConstraint(def: IPrismaticConstraintDef2D): ConstraintId {
        this._assertNotDisposed();
        this._assertCapacity();

        const constraintId = this._nextConstraintId++ as ConstraintId;
        const index = this._prismaticCount++;
        const offset = index * PRISMATIC_STRIDE;

        this._prismaticData[offset] = def.localAnchorA.x;
        this._prismaticData[offset + 1] = def.localAnchorA.y;
        this._prismaticData[offset + 2] = def.localAnchorB.x;
        this._prismaticData[offset + 3] = def.localAnchorB.y;
        this._prismaticData[offset + 4] = def.localAxisA.x;
        this._prismaticData[offset + 5] = def.localAxisA.y;
        this._prismaticData[offset + 6] = def.referenceAngle ?? 0;
        this._prismaticData[offset + 7] = def.enableLimit ? 1 : 0;
        this._prismaticData[offset + 8] = def.lowerTranslation ?? 0;
        this._prismaticData[offset + 9] = def.upperTranslation ?? 0;
        this._prismaticData[offset + 10] = def.enableMotor ? 1 : 0;
        this._prismaticData[offset + 11] = def.motorSpeed ?? 0;
        this._prismaticData[offset + 12] = (def.maxMotorForce as number) ?? 0;
        this._prismaticData[offset + 13] = 0;
        this._prismaticData[offset + 14] = 0;
        this._prismaticData[offset + 15] = 0;

        this._constraintToPrismaticIndex.set(constraintId, index);
        this._registerConstraint(constraintId, ConstraintType.Prismatic, def);
        return constraintId;
    }

    createWeldConstraint(def: IWeldConstraintDef2D): ConstraintId {
        this._assertNotDisposed();
        this._assertCapacity();

        const constraintId = this._nextConstraintId++ as ConstraintId;
        const index = this._weldCount++;
        const offset = index * WELD_STRIDE;

        this._weldData[offset] = def.localAnchorA.x;
        this._weldData[offset + 1] = def.localAnchorA.y;
        this._weldData[offset + 2] = def.localAnchorB.x;
        this._weldData[offset + 3] = def.localAnchorB.y;
        this._weldData[offset + 4] = def.referenceAngle ?? 0;
        this._weldData[offset + 5] = def.stiffness ?? 0;
        this._weldData[offset + 6] = def.damping ?? 0;
        this._weldData[offset + 7] = 0;

        this._constraintToWeldIndex.set(constraintId, index);
        this._registerConstraint(constraintId, ConstraintType.Weld, def);
        return constraintId;
    }

    createMotorConstraint(def: IMotorConstraintDef2D): ConstraintId {
        this._assertNotDisposed();
        this._assertCapacity();

        const constraintId = this._nextConstraintId++ as ConstraintId;
        const index = this._motorCount++;
        const offset = index * MOTOR_STRIDE;

        this._motorData[offset] = def.linearOffset.x;
        this._motorData[offset + 1] = def.linearOffset.y;
        this._motorData[offset + 2] = def.angularOffset ?? 0;
        this._motorData[offset + 3] = (def.maxForce as number) ?? 1;
        this._motorData[offset + 4] = (def.maxTorque as number) ?? 1;
        this._motorData[offset + 5] = def.correctionFactor ?? 0.3;
        this._motorData[offset + 6] = 0;
        this._motorData[offset + 7] = 0;
        this._motorData[offset + 8] = 0;
        this._motorData[offset + 9] = 0;

        this._constraintToMotorIndex.set(constraintId, index);
        this._registerConstraint(constraintId, ConstraintType.Motor, def);
        return constraintId;
    }

    createMouseConstraint(def: IMouseConstraintDef2D): ConstraintId {
        this._assertNotDisposed();
        this._assertCapacity();

        const constraintId = this._nextConstraintId++ as ConstraintId;
        const index = this._mouseCount++;
        const offset = index * MOUSE_STRIDE;

        this._mouseData[offset] = def.target.x;
        this._mouseData[offset + 1] = def.target.y;
        this._mouseData[offset + 2] = (def.maxForce as number) ?? 1000;
        this._mouseData[offset + 3] = def.stiffness ?? 5;
        this._mouseData[offset + 4] = def.damping ?? 0.7;
        this._mouseData[offset + 5] = 0;
        this._mouseData[offset + 6] = 0;
        this._mouseData[offset + 7] = 0;

        this._constraintToMouseIndex.set(constraintId, index);
        this._registerConstraint(constraintId, ConstraintType.Mouse, def);
        return constraintId;
    }

    destroyConstraint(constraintId: ConstraintId): void {
        this._assertNotDisposed();

        const metadata = this._metadata.get(constraintId);
        if (!metadata) {
            throw new ConstraintError(`Constraint ${constraintId} not found`, ConstraintManagerError.CONSTRAINT_NOT_FOUND);
        }

        this._removeFromBody(metadata.bodyIdA, constraintId);
        this._removeFromBody(metadata.bodyIdB, constraintId);

        this._metadata.delete(constraintId);
        this._constraintToDistanceIndex.delete(constraintId);
        this._constraintToRevoluteIndex.delete(constraintId);
        this._constraintToPrismaticIndex.delete(constraintId);
        this._constraintToWeldIndex.delete(constraintId);
        this._constraintToMotorIndex.delete(constraintId);
        this._constraintToMouseIndex.delete(constraintId);
        this._constraintCount--;
    }

    getConstraintType(constraintId: ConstraintId): ConstraintType {
        const metadata = this._metadata.get(constraintId);
        if (!metadata) {
            throw new ConstraintError(`Constraint ${constraintId} not found`, ConstraintManagerError.CONSTRAINT_NOT_FOUND);
        }
        return metadata.type;
    }

    isEnabled(constraintId: ConstraintId): boolean {
        const metadata = this._metadata.get(constraintId);
        if (!metadata) {
            throw new ConstraintError(`Constraint ${constraintId} not found`, ConstraintManagerError.CONSTRAINT_NOT_FOUND);
        }
        return metadata.enabled;
    }

    setEnabled(constraintId: ConstraintId, enabled: boolean): void {
        const metadata = this._metadata.get(constraintId);
        if (!metadata) {
            throw new ConstraintError(`Constraint ${constraintId} not found`, ConstraintManagerError.CONSTRAINT_NOT_FOUND);
        }
        metadata.enabled = enabled;
    }

    getConstraintsForBody(bodyId: BodyId): readonly ConstraintId[] {
        const constraints = this._bodyToConstraints.get(bodyId);
        return constraints ? Array.from(constraints) : [];
    }

    hasConstraint(constraintId: ConstraintId): boolean {
        return this._metadata.has(constraintId);
    }

    private _registerConstraint(
        constraintId: ConstraintId,
        type: ConstraintType,
        def: { bodyIdA: BodyId; bodyIdB: BodyId; collideConnected?: boolean; userData?: unknown }
    ): void {
        this._metadata.set(constraintId, {
            type,
            bodyIdA: def.bodyIdA,
            bodyIdB: def.bodyIdB,
            collideConnected: def.collideConnected ?? false,
            enabled: true,
            userData: def.userData,
        });

        this._addToBody(def.bodyIdA, constraintId);
        this._addToBody(def.bodyIdB, constraintId);
        this._constraintCount++;
    }

    private _addToBody(bodyId: BodyId, constraintId: ConstraintId): void {
        let constraints = this._bodyToConstraints.get(bodyId);
        if (!constraints) {
            constraints = new Set();
            this._bodyToConstraints.set(bodyId, constraints);
        }
        constraints.add(constraintId);
    }

    private _removeFromBody(bodyId: BodyId, constraintId: ConstraintId): void {
        const constraints = this._bodyToConstraints.get(bodyId);
        if (constraints) {
            constraints.delete(constraintId);
            if (constraints.size === 0) {
                this._bodyToConstraints.delete(bodyId);
            }
        }
    }

    private _assertNotDisposed(): void {
        if (this._disposed) {
            throw new ConstraintError('Manager is disposed', ConstraintManagerError.INVALID_STATE);
        }
    }

    private _assertCapacity(): void {
        if (this._constraintCount >= this._maxConstraints) {
            throw new ConstraintError('Constraint capacity exceeded', ConstraintManagerError.CAPACITY_EXCEEDED);
        }
    }

    [Symbol.dispose](): void {
        if (this._disposed) return;
        this._disposed = true;
        this._metadata.clear();
        this._constraintToDistanceIndex.clear();
        this._constraintToRevoluteIndex.clear();
        this._constraintToPrismaticIndex.clear();
        this._constraintToWeldIndex.clear();
        this._constraintToMotorIndex.clear();
        this._constraintToMouseIndex.clear();
        this._bodyToConstraints.clear();
    }
}
