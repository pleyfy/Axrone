import { AnimationIkError, AnimationValidationError } from './errors';
import { quatCopy, quatFromTo, quatIdentity, quatInvert, quatMultiply, quatNormalize, quatSlerp, vec3Length, vec3Normalize, vec3Subtract } from './math';
import { AnimationWorldPose, type AnimationPose } from './pose';
import type { AnimationRig } from './rig';
import type { AnimationIkJobDefinition, AnimationIkLayerDefinition, AnimationIkTarget } from './types';

interface AnimationCompiledIkJob {
    readonly id: string;
    readonly solver: 'fabrik' | 'ccd';
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

    constructor(private readonly _rig: AnimationRig, definition: AnimationIkLayerDefinition) {
        if (!definition || typeof definition.id !== 'string' || definition.id.length === 0) {
            throw new AnimationValidationError('IK layers require a non-empty id');
        }
        this.id = definition.id;
        this.weight = definition.weight ?? 1;
        this._worldPose = new AnimationWorldPose(_rig.boneCount);
        this.jobs = Object.freeze(
            definition.jobs.map((jobDefinition) => {
                const rootIndex = _rig.indexOfBone(jobDefinition.rootBone);
                const tipIndex = _rig.indexOfBone(jobDefinition.tipBone);
                const chain = buildChain(_rig, rootIndex, tipIndex);
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
                case 'ccd':
                default:
                    this._solveCcd(job, pose, jobWeight);
                    break;
            }
            if (job.preserveTipRotation) {
                this._applyTipRotation(job, pose, jobWeight);
            }
        }
        return pose;
    }

    private _resolveTarget(job: AnimationCompiledIkJob, pose: AnimationPose): void {
        if (job.targetBoneIndex === undefined) {
            return;
        }
        this._worldPose.update(this._rig, pose);
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

    private _solveCcd(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._resolveTarget(job, pose);
        this._worldPose.update(this._rig, pose);

        for (let iteration = 0; iteration < job.maxIterations; iteration += 1) {
            const tipOffset = job.tipIndex * 3;
            vec3Subtract(this._scratchVectors, 0, job.targetPosition, 0, this._worldPose.translations, tipOffset);
            if (vec3Length(this._scratchVectors, 0) <= job.precision) {
                break;
            }

            for (let chainIndex = job.chain.length - 2; chainIndex >= 0; chainIndex -= 1) {
                const boneIndex = job.chain[chainIndex]!;
                const boneTranslationOffset = boneIndex * 3;
                const boneRotationOffset = boneIndex * 4;
                vec3Subtract(this._scratchVectors, 0, this._worldPose.translations, tipOffset, this._worldPose.translations, boneTranslationOffset);
                vec3Subtract(this._scratchVectors, 3, job.targetPosition, 0, this._worldPose.translations, boneTranslationOffset);
                if (vec3Length(this._scratchVectors, 0) <= 1e-8 || vec3Length(this._scratchVectors, 3) <= 1e-8) {
                    continue;
                }

                quatFromTo(this._scratchQuaternion, 0, this._scratchVectors, 0, this._scratchVectors, 3, this._scratchVectors);
                quatMultiply(
                    this._scratchQuaternionB,
                    0,
                    this._scratchQuaternion,
                    0,
                    this._worldPose.rotations,
                    boneRotationOffset
                );
                const parentIndex = this._rig.parentIndices[boneIndex]!;
                if (parentIndex >= 0) {
                    quatInvert(this._scratchQuaternionC, 0, this._worldPose.rotations, parentIndex * 4);
                    quatMultiply(this._scratchQuaternionB, 0, this._scratchQuaternionC, 0, this._scratchQuaternionB, 0);
                }
                quatSlerp(
                    pose.rotations,
                    boneRotationOffset,
                    pose.rotations,
                    boneRotationOffset,
                    this._scratchQuaternionB,
                    0,
                    weight
                );
                quatNormalize(pose.rotations, boneRotationOffset, pose.rotations, boneRotationOffset);
                this._worldPose.update(this._rig, pose);
            }
        }
    }

    private _solveFabrik(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._resolveTarget(job, pose);
        this._worldPose.update(this._rig, pose);
        const chainLength = job.chain.length;
        const positions = new Float32Array(chainLength * 3);
        const lengths = new Float32Array(Math.max(0, chainLength - 1));
        let totalLength = 0;

        for (let index = 0; index < chainLength; index += 1) {
            const boneIndex = job.chain[index]!;
            positions[index * 3] = this._worldPose.translations[boneIndex * 3]!;
            positions[index * 3 + 1] = this._worldPose.translations[boneIndex * 3 + 1]!;
            positions[index * 3 + 2] = this._worldPose.translations[boneIndex * 3 + 2]!;
            if (index > 0) {
                vec3Subtract(this._scratchVectors, 0, positions, index * 3, positions, (index - 1) * 3);
                lengths[index - 1] = vec3Length(this._scratchVectors, 0);
                totalLength += lengths[index - 1]!;
            }
        }

        const rootBaseX = positions[0]!;
        const rootBaseY = positions[1]!;
        const rootBaseZ = positions[2]!;
        vec3Subtract(this._scratchVectors, 0, job.targetPosition, 0, positions, 0);
        const rootDistance = vec3Length(this._scratchVectors, 0);

        if (rootDistance >= totalLength) {
            vec3Normalize(this._scratchVectors, 0, this._scratchVectors, 0, 1, 0, 0);
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
                    vec3Subtract(this._scratchVectors, 0, positions, index * 3, positions, (index + 1) * 3);
                    vec3Normalize(this._scratchVectors, 0, this._scratchVectors, 0, 1, 0, 0);
                    positions[index * 3] = positions[(index + 1) * 3]! + this._scratchVectors[0]! * lengths[index]!;
                    positions[index * 3 + 1] = positions[(index + 1) * 3 + 1]! + this._scratchVectors[1]! * lengths[index]!;
                    positions[index * 3 + 2] = positions[(index + 1) * 3 + 2]! + this._scratchVectors[2]! * lengths[index]!;
                }

                positions[0] = rootBaseX;
                positions[1] = rootBaseY;
                positions[2] = rootBaseZ;
                for (let index = 1; index < chainLength; index += 1) {
                    vec3Subtract(this._scratchVectors, 0, positions, index * 3, positions, (index - 1) * 3);
                    vec3Normalize(this._scratchVectors, 0, this._scratchVectors, 0, 1, 0, 0);
                    positions[index * 3] = positions[(index - 1) * 3]! + this._scratchVectors[0]! * lengths[index - 1]!;
                    positions[index * 3 + 1] = positions[(index - 1) * 3 + 1]! + this._scratchVectors[1]! * lengths[index - 1]!;
                    positions[index * 3 + 2] = positions[(index - 1) * 3 + 2]! + this._scratchVectors[2]! * lengths[index - 1]!;
                }

                vec3Subtract(
                    this._scratchVectors,
                    0,
                    job.targetPosition,
                    0,
                    positions,
                    (chainLength - 1) * 3
                );
                if (vec3Length(this._scratchVectors, 0) <= job.precision) {
                    break;
                }
            }
        }

        for (let chainIndex = 0; chainIndex < chainLength - 1; chainIndex += 1) {
            const boneIndex = job.chain[chainIndex]!;
            const boneRotationOffset = boneIndex * 4;
            const currentChildIndex = job.chain[chainIndex + 1]!;
            vec3Subtract(this._scratchVectors, 0, this._worldPose.translations, currentChildIndex * 3, this._worldPose.translations, boneIndex * 3);
            vec3Subtract(this._scratchVectors, 3, positions, (chainIndex + 1) * 3, positions, chainIndex * 3);
            if (vec3Length(this._scratchVectors, 0) <= 1e-8 || vec3Length(this._scratchVectors, 3) <= 1e-8) {
                continue;
            }
            quatFromTo(this._scratchQuaternion, 0, this._scratchVectors, 0, this._scratchVectors, 3, this._scratchVectors);
            quatMultiply(
                this._scratchQuaternionB,
                0,
                this._scratchQuaternion,
                0,
                this._worldPose.rotations,
                boneRotationOffset
            );
            const parentIndex = this._rig.parentIndices[boneIndex]!;
            if (parentIndex >= 0) {
                quatInvert(this._scratchQuaternionC, 0, this._worldPose.rotations, parentIndex * 4);
                quatMultiply(this._scratchQuaternionB, 0, this._scratchQuaternionC, 0, this._scratchQuaternionB, 0);
            }
            quatSlerp(
                pose.rotations,
                boneRotationOffset,
                pose.rotations,
                boneRotationOffset,
                this._scratchQuaternionB,
                0,
                weight
            );
            quatNormalize(pose.rotations, boneRotationOffset, pose.rotations, boneRotationOffset);
            this._worldPose.update(this._rig, pose);
        }
    }

    private _applyTipRotation(job: AnimationCompiledIkJob, pose: AnimationPose, weight: number): void {
        this._worldPose.update(this._rig, pose);
        const tipRotationOffset = job.tipIndex * 4;
        const parentIndex = this._rig.parentIndices[job.tipIndex]!;
        quatCopy(this._scratchQuaternion, 0, job.targetRotation, 0);
        if (parentIndex >= 0) {
            quatInvert(this._scratchQuaternionB, 0, this._worldPose.rotations, parentIndex * 4);
            quatMultiply(this._scratchQuaternion, 0, this._scratchQuaternionB, 0, this._scratchQuaternion, 0);
        }
        quatSlerp(
            pose.rotations,
            tipRotationOffset,
            pose.rotations,
            tipRotationOffset,
            this._scratchQuaternion,
            0,
            weight
        );
        quatNormalize(pose.rotations, tipRotationOffset, pose.rotations, tipRotationOffset);
    }
}