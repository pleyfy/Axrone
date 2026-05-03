import { brandString, type AnimationRigId } from './brands';
import { AnimationValidationError } from './errors';
import { composeMatrix, quatApplyToVec3, quatMultiply, quatNormalize, vec3Add, vec3Multiply } from './math';
import type { AnimationRigDefinition } from './types';

const IDENTITY_TRANSLATION = Object.freeze([0, 0, 0] as const);
const IDENTITY_ROTATION = Object.freeze([0, 0, 0, 1] as const);
const IDENTITY_SCALE = Object.freeze([1, 1, 1] as const);
const IDENTITY_MATRIX = Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
] as const);

const resolveParentIndex = (
    definition: AnimationRigDefinition,
    boneIndex: number,
    indexByName: ReadonlyMap<string, number>
): number => {
    const parent = definition.bones[boneIndex]!.parent;
    if (parent === undefined || parent === null) {
        return -1;
    }
    if (typeof parent === 'number') {
        return parent;
    }
    const resolved = indexByName.get(parent);
    if (resolved === undefined) {
        throw new AnimationValidationError(
            `Animation rig bone '${definition.bones[boneIndex]!.name}' references missing parent '${parent}'`
        );
    }
    return resolved;
};

const buildEvaluationOrder = (parentIndices: Int32Array): Int32Array => {
    const order: number[] = [];
    const temporary = new Uint8Array(parentIndices.length);
    const permanent = new Uint8Array(parentIndices.length);

    const visit = (index: number): void => {
        if (permanent[index] === 1) {
            return;
        }
        if (temporary[index] === 1) {
            throw new AnimationValidationError('Animation rig contains a parent cycle');
        }

        temporary[index] = 1;
        const parentIndex = parentIndices[index]!;
        if (parentIndex >= 0) {
            visit(parentIndex);
        }
        temporary[index] = 0;
        permanent[index] = 1;
        order.push(index);
    };

    for (let index = 0; index < parentIndices.length; index += 1) {
        visit(index);
    }

    return Int32Array.from(order);
};

export class AnimationRig {
    readonly id: AnimationRigId;
    readonly boneCount: number;
    readonly boneNames: readonly string[];
    readonly parentIndices: Int32Array;
    readonly childIndices: readonly Int32Array[];
    readonly rootIndices: Int32Array;
    readonly evaluationOrder: Int32Array;
    readonly restTranslations: Float32Array;
    readonly restRotations: Float32Array;
    readonly restScales: Float32Array;
    readonly inverseBindMatrices: Float32Array | null;

    private readonly _indexByName = new Map<string, number>();

    constructor(definition: AnimationRigDefinition) {
        if (!definition || !Array.isArray(definition.bones) || definition.bones.length === 0) {
            throw new AnimationValidationError('Animation rig requires at least one bone');
        }

        this.id = brandString<'AnimationRigId'>(
            typeof definition.id === 'string' && definition.id.length > 0
                ? definition.id
                : 'animation/rig'
        );
        this.boneCount = definition.bones.length;
        const boneNames = new Array<string>(this.boneCount);
        this.parentIndices = new Int32Array(this.boneCount);
        this.restTranslations = new Float32Array(this.boneCount * 3);
        this.restRotations = new Float32Array(this.boneCount * 4);
        this.restScales = new Float32Array(this.boneCount * 3);
        let inverseBindMatrices: Float32Array | null = null;

        for (let index = 0; index < this.boneCount; index += 1) {
            const bone = definition.bones[index]!;
            if (!bone || typeof bone.name !== 'string' || bone.name.length === 0) {
                throw new AnimationValidationError('Animation rig bones require a non-empty name');
            }
            if (this._indexByName.has(bone.name)) {
                throw new AnimationValidationError(`Duplicate animation rig bone '${bone.name}'`);
            }
            this._indexByName.set(bone.name, index);
            boneNames[index] = bone.name;
        }

        for (let index = 0; index < this.boneCount; index += 1) {
            const bone = definition.bones[index]!;
            const parentIndex = resolveParentIndex(definition, index, this._indexByName);
            if (parentIndex === index) {
                throw new AnimationValidationError(
                    `Animation rig bone '${bone.name}' cannot parent itself`
                );
            }
            if (parentIndex >= this.boneCount) {
                throw new AnimationValidationError(
                    `Animation rig bone '${bone.name}' references out-of-range parent index ${parentIndex}`
                );
            }
            this.parentIndices[index] = parentIndex;
            this.restTranslations.set(bone.translation ?? IDENTITY_TRANSLATION, index * 3);
            this.restRotations.set(bone.rotation ?? IDENTITY_ROTATION, index * 4);
            this.restScales.set(bone.scale ?? IDENTITY_SCALE, index * 3);

            if (bone.inverseBindMatrix) {
                if (!inverseBindMatrices) {
                    inverseBindMatrices = new Float32Array(this.boneCount * 16);
                    for (let matrixIndex = 0; matrixIndex < this.boneCount; matrixIndex += 1) {
                        inverseBindMatrices.set(IDENTITY_MATRIX, matrixIndex * 16);
                    }
                }
                const source = bone.inverseBindMatrix;
                if (source.length !== 16) {
                    throw new AnimationValidationError(
                        `Animation rig bone '${bone.name}' inverse bind matrix must contain 16 values`
                    );
                }
                inverseBindMatrices.set(source, index * 16);
            }
        }

        this.boneNames = Object.freeze(boneNames);
        this.inverseBindMatrices = inverseBindMatrices;
        this.evaluationOrder = buildEvaluationOrder(this.parentIndices);

        const childBuckets = Array.from({ length: this.boneCount }, () => [] as number[]);
        const roots: number[] = [];
        for (let index = 0; index < this.boneCount; index += 1) {
            const parentIndex = this.parentIndices[index]!;
            if (parentIndex >= 0) {
                childBuckets[parentIndex]!.push(index);
            } else {
                roots.push(index);
            }
        }
        this.childIndices = Object.freeze(
            childBuckets.map((bucket) => Int32Array.from(bucket))
        );
        this.rootIndices = Int32Array.from(roots);
    }

    hasBone(name: string): boolean {
        return this._indexByName.has(name);
    }

    indexOfBone(name: string): number {
        const index = this._indexByName.get(name);
        if (index === undefined) {
            throw new AnimationValidationError(`Unknown animation rig bone '${name}'`);
        }
        return index;
    }

    tryIndexOfBone(name: string): number | undefined {
        return this._indexByName.get(name);
    }

    getParentIndex(index: number): number {
        return this.parentIndices[index] ?? -1;
    }

    getBoneName(index: number): string {
        const name = this.boneNames[index];
        if (!name) {
            throw new AnimationValidationError(`Unknown animation rig bone index '${index}'`);
        }
        return name;
    }

    createRestMatrixPalette(): Float32Array {
        const palette = new Float32Array(this.boneCount * 16);
        const worldTranslations = new Float32Array(this.boneCount * 3);
        const worldRotations = new Float32Array(this.boneCount * 4);
        const worldScales = new Float32Array(this.boneCount * 3);
        const scratchVector = new Float32Array(3);

        for (let orderIndex = 0; orderIndex < this.evaluationOrder.length; orderIndex += 1) {
            const boneIndex = this.evaluationOrder[orderIndex]!;
            const parentIndex = this.parentIndices[boneIndex]!;
            const localTranslationOffset = boneIndex * 3;
            const localRotationOffset = boneIndex * 4;
            if (parentIndex < 0) {
                worldTranslations.set(
                    this.restTranslations.subarray(localTranslationOffset, localTranslationOffset + 3),
                    localTranslationOffset
                );
                worldRotations.set(
                    this.restRotations.subarray(localRotationOffset, localRotationOffset + 4),
                    localRotationOffset
                );
                worldScales.set(
                    this.restScales.subarray(localTranslationOffset, localTranslationOffset + 3),
                    localTranslationOffset
                );
            } else {
                const parentTranslationOffset = parentIndex * 3;
                const parentRotationOffset = parentIndex * 4;
                vec3Multiply(
                    scratchVector,
                    0,
                    this.restTranslations,
                    localTranslationOffset,
                    worldScales,
                    parentTranslationOffset
                );
                quatApplyToVec3(
                    scratchVector,
                    0,
                    worldRotations,
                    parentRotationOffset,
                    scratchVector,
                    0
                );
                vec3Add(
                    worldTranslations,
                    localTranslationOffset,
                    worldTranslations,
                    parentTranslationOffset,
                    scratchVector,
                    0
                );
                quatMultiply(
                    worldRotations,
                    localRotationOffset,
                    worldRotations,
                    parentRotationOffset,
                    this.restRotations,
                    localRotationOffset
                );
                quatNormalize(worldRotations, localRotationOffset, worldRotations, localRotationOffset);
                vec3Multiply(
                    worldScales,
                    localTranslationOffset,
                    worldScales,
                    parentTranslationOffset,
                    this.restScales,
                    localTranslationOffset
                );
            }
            composeMatrix(
                palette,
                boneIndex * 16,
                worldTranslations,
                boneIndex * 3,
                worldRotations,
                boneIndex * 4,
                worldScales,
                boneIndex * 3
            );
        }

        return palette;
    }
}