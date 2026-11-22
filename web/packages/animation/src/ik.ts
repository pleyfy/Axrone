import { AnimationIkError, AnimationValidationError } from './errors';
import { SoaVec3Buffer, SoaQuatBuffer } from '@axrone/numeric';
import { AnimationWorldPose, type AnimationPose } from './pose';
import type { AnimationRig } from './rig';
import type { AnimationIkJobDefinition, AnimationIkLayerDefinition, AnimationIkTarget } from './types';

export const IK_CONVERGENCE_EPSILON = 1e-8;

interface AnimationCompiledIkJob {
    readonly id: string;
    readonly solver: 'fabrik' | 'ccd' | 'twoBone' | 'aim';
    readonly chain: Int32Array;
    readonly rootIndex: number;
    readonly tipIndex: number;
    readonly targetBoneIndex?: number;
    readonly precision: number;
    readonly maxIterations: number;
    readonly weight: number;
    readonly preserveTipRotation: boolean;
    readonly targetPosition: Float32Array;
    readonly targetRotation: Float32Array;
    readonly polePosition: Float32Array;
    readonly poleBoneIndex?: number;
    readonly minBendRadians: number;
    readonly maxBendRadians: number;
    readonly twistRadians: number;
    readonly aimUp: Float32Array;
    readonly maxAimAngleRadians: number;
}

const buildChain = (rig: AnimationRig, rootIndex: number, tipIndex: number): Int32Array => {
    const chain: number[] = [];
    let current = tipIndex;
    while (current >= 0) {
        chain.push(current);
        if (current === rootIndex) {
            return Int32Array.from(chain.reverse());
        }
        current = rig.parentIndices[current]!;
    }
    throw new AnimationValidationError(
        `IK chain root '${rig.getBoneName(rootIndex)}' is not an ancestor of tip '${rig.getBoneName(tipIndex)}'`
    );
};

const DEG_TO_RAD = Math.PI / 180;
const SOLVER_EPSILON = 1e-6;

const validateBendLimits = (job: AnimationIkJobDefinition): void => {
    const min = job.minBendDegrees ?? 0;
    const max = job.maxBendDegrees ?? 180;
    const twist = job.twistDegrees ?? 0;
    if (
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(twist) ||
        min < 0 ||
        max > 180 ||
        min > max
    ) {
        throw new AnimationValidationError(
            `IK job '${String(job.id)}' bend limits [${min}, ${max}] degrees are outside [0, 180] or inverted`
        );
    }
};

const validateAimLimits = (job: AnimationIkJobDefinition): void => {
    const maxAimAngle = job.maxAimAngleDegrees ?? 180;
    if (!Number.isFinite(maxAimAngle) || maxAimAngle < 0 || maxAimAngle > 180) {
        throw new AnimationValidationError(
            `IK job '${String(job.id)}' max aim angle ${maxAimAngle} degrees must be finite and inside [0, 180]`
        );
    }
};

const clampUnit = (value: number): number => (value < -1 ? -1 : value > 1 ? 1 : value);

const rotateByQuaternion = (
    quaternion: Float32Array,
    offset: number,
    x: number,
    y: number,
    z: number
): readonly [number, number, number] => {
    const qx = quaternion[offset]!;
    const qy = quaternion[offset + 1]!;
    const qz = quaternion[offset + 2]!;
    const qw = quaternion[offset + 3]!;

    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);

    return [
        x + qw * tx + (qy * tz - qz * ty),
        y + qw * ty + (qz * tx - qx * tz),
        z + qw * tz + (qx * ty - qy * tx),
    ];
};

const rotateAxisAngle = (
    x: number,
    y: number,
    z: number,
    ax: number,
    ay: number,
    az: number,
    angle: number
): readonly [number, number, number] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dot = ax * x + ay * y + az * z;
    const cx = ay * z - az * y;
    const cy = az * x - ax * z;
    const cz = ax * y - ay * x;
    return [
        x * cos + cx * sin + ax * dot * (1 - cos),
        y * cos + cy * sin + ay * dot * (1 - cos),
        z * cos + cz * sin + az * dot * (1 - cos),
    ];
};

const writeAxisAngleQuaternion = (
    out: Float32Array,
    offset: number,
    ax: number,
    ay: number,
    az: number,
    angle: number
): void => {
    const length = Math.hypot(ax, ay, az);
    if (length <= SOLVER_EPSILON) {
        out[offset] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = 0;
        out[offset + 3] = 1;
        return;
    }

    const half = angle * 0.5;
    const sin = Math.sin(half) / length;
    out[offset] = ax * sin;
    out[offset + 1] = ay * sin;
    out[offset + 2] = az * sin;
    out[offset + 3] = Math.cos(half);
};

export class AnimationIkLayer {
    readonly id: string;
    readonly weight: number;
    readonly jobs: readonly AnimationCompiledIkJob[];

    private readonly _jobById = new Map<string, AnimationCompiledIkJob>();
    private readonly _worldPose: AnimationWorldPose;
    private readonly _scratchQuaternion = new Float32Array(4);
    private readonly _scratchQuaternionB = new Float32Array(4);
    private readonly _scratchQuaternionC = new Float32Array(4);
    private readonly _scratchVectors = new Float32Array(24);
    private readonly _fabrikPositions: Float32Array;
    private readonly _fabrikLengths: Float32Array;

    constructor(private readonly _rig: AnimationRig, definition: AnimationIkLayerDefinition) {
        if (!definition || typeof definition.id !== 'string' || definition.id.length === 0) {
            throw new AnimationValidationError('IK layers require a non-empty id');
        }
        this.id = definition.id;
        this.weight = definition.weight ?? 1;
        this._worldPose = new AnimationWorldPose(_rig.boneCount);
        // Pre-allocate FABRIK scratch buffers sized to the longest chain, matching
        // the CCD solver's approach of using instance-level scratch arrays.
        let maxFabrikChain = 0;
        for (const jobDefinition of definition.jobs) {
            if (jobDefinition.solver === 'fabrik') {
                const root = _rig.indexOfBone(jobDefinition.rootBone);
                const tip = _rig.indexOfBone(jobDefinition.tipBone);
                let length = 0;
                let current = tip;
                while (current >= 0) {
                    length += 1;
                    if (current === root) break;
                    current = _rig.parentIndices[current]!;
                }
                if (length > maxFabrikChain) maxFabrikChain = length;
            }
        }
        this._fabrikPositions = new Float32Array(maxFabrikChain * 3);
        this._fabrikLengths = new Float32Array(Math.max(0, maxFabrikChain - 1));
        this.jobs = Object.freeze(
            definition.jobs.map((jobDefinition) => {
                const rootIndex = _rig.indexOfBone(jobDefinition.rootBone);
                const tipIndex =
                    jobDefinition.solver === 'aim'
                        ? rootIndex
                        : _rig.indexOfBone(jobDefinition.tipBone);
                const chain =
                    jobDefinition.solver === 'aim'
                        ? Int32Array.from([rootIndex])
                        : buildChain(_rig, rootIndex, tipIndex);
                if (jobDefinition.solver === 'twoBone' && chain.length !== 3) {
                    throw new AnimationValidationError(
                        `Two-bone IK job '${String(jobDefinition.id)}' requires exactly three bones (root, mid, tip)`
                    );
                }
                validateBendLimits(jobDefinition);
                validateAimLimits(jobDefinition);
                const job = Object.freeze({
                    id: String(jobDefinition.id),
                    solver: jobDefinition.solver,
                    chain,
                    rootIndex,
                    tipIndex,
                    targetBoneIndex:
                        typeof jobDefinition.targetBone === 'string'
                            ? _rig.tryIndexOfBone(jobDefinition.targetBone)
                            : undefined,
                    precision:
                        typeof jobDefinition.precision === 'number' && Number.isFinite(jobDefinition.precision)
                            ? Math.max(1e-5, jobDefinition.precision)
                            : 1e-3,
                    maxIterations:
                        typeof jobDefinition.maxIterations === 'number' && Number.isFinite(jobDefinition.maxIterations)
                            ? Math.max(1, Math.trunc(jobDefinition.maxIterations))
                            : 12,
                    weight:
                        typeof jobDefinition.weight === 'number' && Number.isFinite(jobDefinition.weight)
                            ? jobDefinition.weight
                            : 1,
                    preserveTipRotation: jobDefinition.preserveTipRotation ?? false,
                    targetPosition: new Float32Array(jobDefinition.targetPosition ?? [0, 0, 0]),
                    targetRotation: new Float32Array(jobDefinition.targetRotation ?? [0, 0, 0, 1]),
                    polePosition: new Float32Array(jobDefinition.polePosition ?? [0, 0, 0]),
                    poleBoneIndex:
                        typeof jobDefinition.poleBone === 'string'
                            ? _rig.tryIndexOfBone(jobDefinition.poleBone)
                            : undefined,
                    minBendRadians:
                        Math.min(
                            Math.max(jobDefinition.minBendDegrees ?? 0, 0),
                            180
                        ) * DEG_TO_RAD,
                    maxBendRadians:
                        Math.min(
                            Math.max(jobDefinition.maxBendDegrees ?? 180, 0),
                            180
                        ) * DEG_TO_RAD,
                    twistRadians: (jobDefinition.twistDegrees ?? 0) * DEG_TO_RAD,
                    aimUp: new Float32Array(jobDefinition.aimUp ?? [0, 0, 0]),
                    maxAimAngleRadians:
                        Math.min(
                            Math.max(jobDefinition.maxAimAngleDegrees ?? 180, 0),
                            180
                        ) * DEG_TO_RAD,
                } satisfies AnimationCompiledIkJob);
                if (this._jobById.has(job.id)) {
                    throw new AnimationValidationError(`Duplicate IK job '${job.id}'`);
                }
                this._jobById.set(job.id, job);
                return job;
            })
        );
    }

    setTarget(jobId: string, target: AnimationIkTarget): this {
        const job = this._jobById.get(jobId);
        if (!job) {
            throw new AnimationIkError(`Unknown IK job '${jobId}'`);
        }
        job.targetPosition.set(target.position);
        if (target.rotation) {
            job.targetRotation.set(target.rotation);
        }
        return this;
    }

    apply(pose: AnimationPose, weight: number = this.weight): AnimationPose {
        const layerWeight = Math.max(0, Math.min(1, weight));
        if (layerWeight <= 0) {
            return pose;
        }
        for (let jobIndex = 0; jobIndex < this.jobs.length; jobIndex += 1) {
            const job = this.jobs[jobIndex]!;
            const jobWeight = Math.max(0, Math.min(1, layerWeight * job.weight));
            if (jobWeight <= 0) {
                continue;
            }
            switch (job.solver) {
                case 'fabrik':
                    this._solveFabrik(job, pose, jobWeight);
                    break;
                case 'twoBone':
                    this._solveTwoBone(job, pose, jobWeight);
                    break;
                case 'aim':
                    this._solveAim(job, pose, jobWeight);
                    break;
                case 'ccd':
                default:
                    this._solveCcd(job, pose, jobWeight);
                    break;
            }
            if (job.preserveTipRotation && job.solver !== 'aim') {
                this._applyTipRotation(job, pose, jobWeight);
            }
        }
        return pose;
    }

    private _resolveTarget(job: AnimationCompiledIkJob, pose: AnimationPose): void {
        if (job.targetBoneIndex === undefined && job.poleBoneIndex === undefined) {
            return;
        }
        this._worldPose.update(this._rig, pose);
        if (job.targetBoneIndex !== undefined) {
            const targetOffset = job.targetBoneIndex * 3;
            const rotationOffset = job.targetBoneIndex * 4;
            job.targetPosition[0] = this._worldPose.translations[targetOffset]!;
            job.targetPosition[1] = this._worldPose.translations[targetOffset + 1]!;
            job.targetPosition[2] = this._worldPose.translations[targetOffset + 2]!;
            job.targetRotation[0] = this._worldPose.rotations[rotationOffset]!;
            job.targetRotation[1] = this._worldPose.rotations[rotationOffset + 1]!;
            job.targetRotation[2] = this._worldPose.rotations[rotationOffset + 2]!;
            job.targetRotation[3] = this._worldPose.rotations[rotationOffset + 3]!;
        }
        if (job.poleBoneIndex !== undefined) {
            const poleOffset = job.poleBoneIndex * 3;
            job.polePosition[0] = this._worldPose.translations[poleOffset]!;
            job.polePosition[1] = this._worldPose.translations[poleOffset + 1]!;
            job.polePosition[2] = this._worldPose.translations[poleOffset + 2]!;
        }
    }

    private _solveCcd(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._resolveTarget(job, pose);
        this._worldPose.update(this._rig, pose);

        for (let iteration = 0; iteration < job.maxIterations; iteration += 1) {
            const tipOffset = job.tipIndex * 3;
            SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, job.targetPosition, 0, this._worldPose.translations, tipOffset);
            if (SoaVec3Buffer.vec3Length(this._scratchVectors, 0) <= job.precision) {
                break;
            }

            for (let chainIndex = job.chain.length - 2; chainIndex >= 0; chainIndex -= 1) {
                const boneIndex = job.chain[chainIndex]!;
                const boneTranslationOffset = boneIndex * 3;
                SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, this._worldPose.translations, tipOffset, this._worldPose.translations, boneTranslationOffset);
                SoaVec3Buffer.vec3Subtract(this._scratchVectors, 3, job.targetPosition, 0, this._worldPose.translations, boneTranslationOffset);
                if (SoaVec3Buffer.vec3Length(this._scratchVectors, 0) <= IK_CONVERGENCE_EPSILON || SoaVec3Buffer.vec3Length(this._scratchVectors, 3) <= IK_CONVERGENCE_EPSILON) {
                    continue;
                }

                this._applyBoneCorrection(boneIndex, pose, weight);
            }
        }
    }

    private _solveFabrik(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._resolveTarget(job, pose);
        this._worldPose.update(this._rig, pose);
        const chainLength = job.chain.length;
        const positions = this._fabrikPositions;
        const lengths = this._fabrikLengths;
        let totalLength = 0;

        for (let index = 0; index < chainLength; index += 1) {
            const boneIndex = job.chain[index]!;
            positions[index * 3] = this._worldPose.translations[boneIndex * 3]!;
            positions[index * 3 + 1] = this._worldPose.translations[boneIndex * 3 + 1]!;
            positions[index * 3 + 2] = this._worldPose.translations[boneIndex * 3 + 2]!;
            if (index > 0) {
                SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, positions, index * 3, positions, (index - 1) * 3);
                lengths[index - 1] = SoaVec3Buffer.vec3Length(this._scratchVectors, 0);
                totalLength += lengths[index - 1]!;
            }
        }

        const rootBaseX = positions[0]!;
        const rootBaseY = positions[1]!;
        const rootBaseZ = positions[2]!;
        SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, job.targetPosition, 0, positions, 0);
        const rootDistance = SoaVec3Buffer.vec3Length(this._scratchVectors, 0);

        if (rootDistance >= totalLength) {
            SoaVec3Buffer.vec3Normalize(this._scratchVectors, 0, this._scratchVectors, 0, 1, 0, 0);
            for (let index = 1; index < chainLength; index += 1) {
                positions[index * 3] = positions[(index - 1) * 3]! + this._scratchVectors[0]! * lengths[index - 1]!;
                positions[index * 3 + 1] = positions[(index - 1) * 3 + 1]! + this._scratchVectors[1]! * lengths[index - 1]!;
                positions[index * 3 + 2] = positions[(index - 1) * 3 + 2]! + this._scratchVectors[2]! * lengths[index - 1]!;
            }
        } else {
            for (let iteration = 0; iteration < job.maxIterations; iteration += 1) {
                positions[(chainLength - 1) * 3] = job.targetPosition[0]!;
                positions[(chainLength - 1) * 3 + 1] = job.targetPosition[1]!;
                positions[(chainLength - 1) * 3 + 2] = job.targetPosition[2]!;

                for (let index = chainLength - 2; index >= 0; index -= 1) {
                    SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, positions, index * 3, positions, (index + 1) * 3);
                    SoaVec3Buffer.vec3Normalize(this._scratchVectors, 0, this._scratchVectors, 0, 1, 0, 0);
                    positions[index * 3] = positions[(index + 1) * 3]! + this._scratchVectors[0]! * lengths[index]!;
                    positions[index * 3 + 1] = positions[(index + 1) * 3 + 1]! + this._scratchVectors[1]! * lengths[index]!;
                    positions[index * 3 + 2] = positions[(index + 1) * 3 + 2]! + this._scratchVectors[2]! * lengths[index]!;
                }

                positions[0] = rootBaseX;
                positions[1] = rootBaseY;
                positions[2] = rootBaseZ;
                for (let index = 1; index < chainLength; index += 1) {
                    SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, positions, index * 3, positions, (index - 1) * 3);
                    SoaVec3Buffer.vec3Normalize(this._scratchVectors, 0, this._scratchVectors, 0, 1, 0, 0);
                    positions[index * 3] = positions[(index - 1) * 3]! + this._scratchVectors[0]! * lengths[index - 1]!;
                    positions[index * 3 + 1] = positions[(index - 1) * 3 + 1]! + this._scratchVectors[1]! * lengths[index - 1]!;
                    positions[index * 3 + 2] = positions[(index - 1) * 3 + 2]! + this._scratchVectors[2]! * lengths[index - 1]!;
                }

                SoaVec3Buffer.vec3Subtract(
                    this._scratchVectors,
                    0,
                    job.targetPosition,
                    0,
                    positions,
                    (chainLength - 1) * 3
                );
                if (SoaVec3Buffer.vec3Length(this._scratchVectors, 0) <= job.precision) {
                    break;
                }
            }
        }

        for (let chainIndex = 0; chainIndex < chainLength - 1; chainIndex += 1) {
            const boneIndex = job.chain[chainIndex]!;
            const currentChildIndex = job.chain[chainIndex + 1]!;
            SoaVec3Buffer.vec3Subtract(this._scratchVectors, 0, this._worldPose.translations, currentChildIndex * 3, this._worldPose.translations, boneIndex * 3);
            SoaVec3Buffer.vec3Subtract(this._scratchVectors, 3, positions, (chainIndex + 1) * 3, positions, chainIndex * 3);
            if (SoaVec3Buffer.vec3Length(this._scratchVectors, 0) <= IK_CONVERGENCE_EPSILON || SoaVec3Buffer.vec3Length(this._scratchVectors, 3) <= IK_CONVERGENCE_EPSILON) {
                continue;
            }
            this._applyBoneCorrection(boneIndex, pose, weight);
        }
    }

    private _applyBoneCorrection(boneIndex: number, pose: AnimationPose, weight: number): void {
        const boneRotationOffset = boneIndex * 4;
        SoaQuatBuffer.quatFromTo(this._scratchQuaternion, 0, this._scratchVectors, 0, this._scratchVectors, 3, this._scratchVectors);
        SoaQuatBuffer.quatMultiply(
            this._scratchQuaternionB,
            0,
            this._scratchQuaternion,
            0,
            this._worldPose.rotations,
            boneRotationOffset
        );
        const parentIndex = this._rig.parentIndices[boneIndex]!;
        if (parentIndex >= 0) {
            SoaQuatBuffer.quatInvert(this._scratchQuaternionC, 0, this._worldPose.rotations, parentIndex * 4);
            SoaQuatBuffer.quatMultiply(this._scratchQuaternionB, 0, this._scratchQuaternionC, 0, this._scratchQuaternionB, 0);
        }
        SoaQuatBuffer.quatSlerp(
            pose.rotations,
            boneRotationOffset,
            pose.rotations,
            boneRotationOffset,
            this._scratchQuaternionB,
            0,
            weight
        );
        SoaQuatBuffer.quatNormalize(pose.rotations, boneRotationOffset, pose.rotations, boneRotationOffset);
        this._worldPose.update(this._rig, pose);
    }

    /**
     * Analytic two-bone solve: the mid joint is placed analytically from the
     * target distance, the bend limits and the pole vector, so elbows and knees
     * cannot hyperextend or flip to the wrong side.
     */
    private _solveTwoBone(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        if (job.chain.length !== 3) {
            return;
        }

        this._resolveTarget(job, pose);
        this._worldPose.update(this._rig, pose);

        const root = job.chain[0]!;
        const mid = job.chain[1]!;
        const tip = job.chain[2]!;
        const worldT = this._worldPose.translations;

        const p0x = worldT[root * 3]!;
        const p0y = worldT[root * 3 + 1]!;
        const p0z = worldT[root * 3 + 2]!;
        const p1x = worldT[mid * 3]!;
        const p1y = worldT[mid * 3 + 1]!;
        const p1z = worldT[mid * 3 + 2]!;
        const p2x = worldT[tip * 3]!;
        const p2y = worldT[tip * 3 + 1]!;
        const p2z = worldT[tip * 3 + 2]!;

        const upperLength = Math.hypot(p1x - p0x, p1y - p0y, p1z - p0z);
        const lowerLength = Math.hypot(p2x - p1x, p2y - p1y, p2z - p1z);
        if (upperLength <= SOLVER_EPSILON || lowerLength <= SOLVER_EPSILON) {
            return;
        }

        let dirX = job.targetPosition[0]! - p0x;
        let dirY = job.targetPosition[1]! - p0y;
        let dirZ = job.targetPosition[2]! - p0z;
        const targetDistance = Math.hypot(dirX, dirY, dirZ);
        if (targetDistance <= SOLVER_EPSILON) {
            return;
        }
        dirX /= targetDistance;
        dirY /= targetDistance;
        dirZ /= targetDistance;

        const minReach = Math.abs(upperLength - lowerLength) + SOLVER_EPSILON;
        const maxReach = upperLength + lowerLength - SOLVER_EPSILON;
        let reach = Math.min(Math.max(targetDistance, minReach), maxReach);

        const cosRoot =
            (upperLength * upperLength + reach * reach - lowerLength * lowerLength) /
            (2 * upperLength * reach);
        let bend = Math.acos(clampUnit(cosRoot));
        bend = Math.min(Math.max(bend, job.minBendRadians), job.maxBendRadians);

        const sinBend = Math.sin(bend);
        const lowerProjection = Math.sqrt(
            Math.max(0, lowerLength * lowerLength - upperLength * upperLength * sinBend * sinBend)
        );
        reach = Math.min(
            Math.max(upperLength * Math.cos(bend) + lowerProjection, minReach),
            maxReach
        );

        let poleX = job.polePosition[0]! - p0x;
        let poleY = job.polePosition[1]! - p0y;
        let poleZ = job.polePosition[2]! - p0z;
        const poleDot = poleX * dirX + poleY * dirY + poleZ * dirZ;
        poleX -= dirX * poleDot;
        poleY -= dirY * poleDot;
        poleZ -= dirZ * poleDot;
        let poleLength = Math.hypot(poleX, poleY, poleZ);

        if (poleLength <= SOLVER_EPSILON) {
            poleX = p1x - p0x;
            poleY = p1y - p0y;
            poleZ = p1z - p0z;
            const currentDot = poleX * dirX + poleY * dirY + poleZ * dirZ;
            poleX -= dirX * currentDot;
            poleY -= dirY * currentDot;
            poleZ -= dirZ * currentDot;
            poleLength = Math.hypot(poleX, poleY, poleZ);
        }

        if (poleLength <= SOLVER_EPSILON) {
            // Any vector orthogonal to the target direction works as a bend
            // plane. The reference axis is the one the direction is least
            // aligned with, so the cross product stays well conditioned.
            const absX = Math.abs(dirX);
            const absY = Math.abs(dirY);
            const absZ = Math.abs(dirZ);
            let refX = 0;
            let refY = 0;
            let refZ = 0;
            if (absX <= absY && absX <= absZ) {
                refX = 1;
            } else if (absY <= absZ) {
                refY = 1;
            } else {
                refZ = 1;
            }
            poleX = dirY * refZ - dirZ * refY;
            poleY = dirZ * refX - dirX * refZ;
            poleZ = dirX * refY - dirY * refX;
            poleLength = Math.hypot(poleX, poleY, poleZ);
            if (poleLength <= SOLVER_EPSILON) {
                return;
            }
        }

        poleX /= poleLength;
        poleY /= poleLength;
        poleZ /= poleLength;

        const cosBend = Math.cos(bend);
        const sinBendAngle = Math.sin(bend);
        let midDirX = dirX * cosBend + poleX * sinBendAngle;
        let midDirY = dirY * cosBend + poleY * sinBendAngle;
        let midDirZ = dirZ * cosBend + poleZ * sinBendAngle;
        const midDirLength = Math.hypot(midDirX, midDirY, midDirZ) || 1;
        midDirX /= midDirLength;
        midDirY /= midDirLength;
        midDirZ /= midDirLength;

        const desiredMidX = p0x + midDirX * upperLength;
        const desiredMidY = p0y + midDirY * upperLength;
        const desiredMidZ = p0z + midDirZ * upperLength;
        const desiredTipX = p0x + dirX * reach;
        const desiredTipY = p0y + dirY * reach;
        const desiredTipZ = p0z + dirZ * reach;

        this._applyDirectionCorrection(
            root,
            pose,
            weight,
            p1x - p0x,
            p1y - p0y,
            p1z - p0z,
            midDirX,
            midDirY,
            midDirZ
        );

        if (Math.abs(job.twistRadians) > SOLVER_EPSILON) {
            writeAxisAngleQuaternion(this._scratchQuaternionC, 0, dirX, dirY, dirZ, job.twistRadians);
            this._applyWorldRotation(root, pose, weight, this._scratchQuaternionC);
        }

        this._worldPose.update(this._rig, pose);
        const updatedWorldT = this._worldPose.translations;
        const currentTipX = updatedWorldT[tip * 3]! - updatedWorldT[mid * 3]!;
        const currentTipY = updatedWorldT[tip * 3 + 1]! - updatedWorldT[mid * 3 + 1]!;
        const currentTipZ = updatedWorldT[tip * 3 + 2]! - updatedWorldT[mid * 3 + 2]!;
        this._applyDirectionCorrection(
            mid,
            pose,
            weight,
            currentTipX,
            currentTipY,
            currentTipZ,
            desiredTipX - desiredMidX,
            desiredTipY - desiredMidY,
            desiredTipZ - desiredMidZ
        );
    }

    /**
     * Single-bone look-at: the bone's forward axis turns toward the target with
     * a hard angle limit, and an optional world up removes roll.
     */
    private _solveAim(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._resolveTarget(job, pose);
        this._worldPose.update(this._rig, pose);

        const bone = job.chain[0]!;
        const worldT = this._worldPose.translations;
        const worldR = this._worldPose.rotations;

        let dirX = job.targetPosition[0]! - worldT[bone * 3]!;
        let dirY = job.targetPosition[1]! - worldT[bone * 3 + 1]!;
        let dirZ = job.targetPosition[2]! - worldT[bone * 3 + 2]!;
        const distance = Math.hypot(dirX, dirY, dirZ);
        if (distance <= SOLVER_EPSILON) {
            return;
        }
        dirX /= distance;
        dirY /= distance;
        dirZ /= distance;

        const forward = rotateByQuaternion(worldR, bone * 4, 0, 0, 1);
        let targetX = dirX;
        let targetY = dirY;
        let targetZ = dirZ;
        const angle = Math.acos(clampUnit(forward[0] * dirX + forward[1] * dirY + forward[2] * dirZ));
        if (angle > job.maxAimAngleRadians && job.maxAimAngleRadians < Math.PI) {
            const axisX = forward[1] * dirZ - forward[2] * dirY;
            const axisY = forward[2] * dirX - forward[0] * dirZ;
            const axisZ = forward[0] * dirY - forward[1] * dirX;
            const axisLength = Math.hypot(axisX, axisY, axisZ);
            if (axisLength > SOLVER_EPSILON) {
                const clamped = rotateAxisAngle(
                    forward[0],
                    forward[1],
                    forward[2],
                    axisX / axisLength,
                    axisY / axisLength,
                    axisZ / axisLength,
                    job.maxAimAngleRadians
                );
                targetX = clamped[0];
                targetY = clamped[1];
                targetZ = clamped[2];
            }
        }

        this._applyDirectionCorrection(
            bone,
            pose,
            weight,
            forward[0],
            forward[1],
            forward[2],
            targetX,
            targetY,
            targetZ
        );

        const upX = job.aimUp[0]!;
        const upY = job.aimUp[1]!;
        const upZ = job.aimUp[2]!;
        if (Math.hypot(upX, upY, upZ) <= SOLVER_EPSILON) {
            return;
        }

        this._worldPose.update(this._rig, pose);
        const updatedWorldR = this._worldPose.rotations;
        const updatedForward = rotateByQuaternion(updatedWorldR, bone * 4, 0, 0, 1);
        const upAfterRaw = rotateByQuaternion(updatedWorldR, bone * 4, 0, 1, 0);
        const upDot = upAfterRaw[0] * updatedForward[0] + upAfterRaw[1] * updatedForward[1] + upAfterRaw[2] * updatedForward[2];
        let upAfterX = upAfterRaw[0] - updatedForward[0] * upDot;
        let upAfterY = upAfterRaw[1] - updatedForward[1] * upDot;
        let upAfterZ = upAfterRaw[2] - updatedForward[2] * upDot;
        const upAfterLength = Math.hypot(upAfterX, upAfterY, upAfterZ);
        if (upAfterLength <= SOLVER_EPSILON) {
            return;
        }
        upAfterX /= upAfterLength;
        upAfterY /= upAfterLength;
        upAfterZ /= upAfterLength;

        const desiredDot = upX * updatedForward[0] + upY * updatedForward[1] + upZ * updatedForward[2];
        let desiredX = upX - updatedForward[0] * desiredDot;
        let desiredY = upY - updatedForward[1] * desiredDot;
        let desiredZ = upZ - updatedForward[2] * desiredDot;
        const desiredLength = Math.hypot(desiredX, desiredY, desiredZ);
        if (desiredLength <= SOLVER_EPSILON) {
            return;
        }
        desiredX /= desiredLength;
        desiredY /= desiredLength;
        desiredZ /= desiredLength;

        const roll = Math.acos(
            clampUnit(upAfterX * desiredX + upAfterY * desiredY + upAfterZ * desiredZ)
        );
        const rollSign =
            (upAfterY * desiredZ - upAfterZ * desiredY) * updatedForward[0] +
            (upAfterZ * desiredX - upAfterX * desiredZ) * updatedForward[1] +
            (upAfterX * desiredY - upAfterY * desiredX) * updatedForward[2] >=
            0
                ? 1
                : -1;

        writeAxisAngleQuaternion(
            this._scratchQuaternionC,
            0,
            updatedForward[0],
            updatedForward[1],
            updatedForward[2],
            roll * rollSign
        );
        this._applyWorldRotation(bone, pose, weight, this._scratchQuaternionC);
    }

    private _applyDirectionCorrection(
        boneIndex: number,
        pose: AnimationPose,
        weight: number,
        fromX: number,
        fromY: number,
        fromZ: number,
        toX: number,
        toY: number,
        toZ: number
    ): void {
        this._scratchVectors[0] = fromX;
        this._scratchVectors[1] = fromY;
        this._scratchVectors[2] = fromZ;
        this._scratchVectors[3] = toX;
        this._scratchVectors[4] = toY;
        this._scratchVectors[5] = toZ;
        SoaQuatBuffer.quatFromTo(
            this._scratchQuaternion,
            0,
            this._scratchVectors,
            0,
            this._scratchVectors,
            3,
            this._scratchVectors
        );
        this._applyWorldRotation(boneIndex, pose, weight, this._scratchQuaternion);
    }

    private _applyWorldRotation(
        boneIndex: number,
        pose: AnimationPose,
        weight: number,
        worldCorrection: Float32Array
    ): void {
        const boneRotationOffset = boneIndex * 4;
        SoaQuatBuffer.quatMultiply(
            this._scratchQuaternionB,
            0,
            worldCorrection,
            0,
            this._worldPose.rotations,
            boneRotationOffset
        );
        const parentIndex = this._rig.parentIndices[boneIndex]!;
        if (parentIndex >= 0) {
            SoaQuatBuffer.quatInvert(this._scratchQuaternionC, 0, this._worldPose.rotations, parentIndex * 4);
            SoaQuatBuffer.quatMultiply(this._scratchQuaternionB, 0, this._scratchQuaternionC, 0, this._scratchQuaternionB, 0);
        }
        SoaQuatBuffer.quatSlerp(
            pose.rotations,
            boneRotationOffset,
            pose.rotations,
            boneRotationOffset,
            this._scratchQuaternionB,
            0,
            weight
        );
        SoaQuatBuffer.quatNormalize(pose.rotations, boneRotationOffset, pose.rotations, boneRotationOffset);
        this._worldPose.update(this._rig, pose);
    }

    private _applyTipRotation(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._worldPose.update(this._rig, pose);
        const tipRotationOffset = job.tipIndex * 4;
        const parentIndex = this._rig.parentIndices[job.tipIndex]!;
        SoaQuatBuffer.quatCopy(this._scratchQuaternion, 0, job.targetRotation, 0);
        if (parentIndex >= 0) {
            SoaQuatBuffer.quatInvert(this._scratchQuaternionB, 0, this._worldPose.rotations, parentIndex * 4);
            SoaQuatBuffer.quatMultiply(this._scratchQuaternion, 0, this._scratchQuaternionB, 0, this._scratchQuaternion, 0);
        }
        SoaQuatBuffer.quatSlerp(
            pose.rotations,
            tipRotationOffset,
            pose.rotations,
            tipRotationOffset,
            this._scratchQuaternion,
            0,
            weight
        );
        SoaQuatBuffer.quatNormalize(pose.rotations, tipRotationOffset, pose.rotations, tipRotationOffset);
    }
}