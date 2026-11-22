import { AnimationValidationError } from './errors';
import { SoaVec3Buffer, SoaQuatBuffer } from '@axrone/numeric';
import type { AnimationCurveBindingDefinition } from './types';
import type { AnimationRig } from './rig';

export interface AnimationCurveBinding {
    readonly id: string;
    readonly componentCount: number;
    readonly offset: number;
}

export class AnimationCurveLayout {
    readonly bindings: readonly AnimationCurveBinding[];
    readonly componentCount: number;

    private readonly _bindingById = new Map<string, AnimationCurveBinding>();

    constructor(definitions: readonly AnimationCurveBindingDefinition[] = []) {
        let offset = 0;
        const bindings: AnimationCurveBinding[] = [];
        for (let index = 0; index < definitions.length; index += 1) {
            const definition = definitions[index]!;
            if (!definition || typeof definition.id !== 'string' || definition.id.length === 0) {
                throw new AnimationValidationError('Animation curves require a non-empty id');
            }
            if (!Number.isInteger(definition.componentCount) || definition.componentCount <= 0) {
                throw new AnimationValidationError(
                    `Animation curve '${definition.id}' requires a positive componentCount`
                );
            }
            if (this._bindingById.has(definition.id)) {
                throw new AnimationValidationError(`Duplicate animation curve '${definition.id}'`);
            }
            const binding = Object.freeze({
                id: definition.id,
                componentCount: definition.componentCount,
                offset,
            });
            bindings.push(binding);
            this._bindingById.set(binding.id, binding);
            offset += binding.componentCount;
        }
        this.bindings = Object.freeze(bindings);
        this.componentCount = offset;
    }

    has(id: string): boolean {
        return this._bindingById.has(id);
    }

    get(id: string): AnimationCurveBinding | undefined {
        return this._bindingById.get(id);
    }
}

const copyInto = (destination: Float32Array, source: ArrayLike<number>): void => {
    const count = Math.min(destination.length, source.length);
    for (let index = 0; index < count; index += 1) {
        destination[index] = source[index]!;
    }
};

export class AnimationCurveStore {
    readonly values: Float32Array;

    constructor(
        readonly layout: AnimationCurveLayout,
        initialValues?: ArrayLike<number>
    ) {
        this.values = new Float32Array(layout.componentCount);
        if (initialValues) {
            copyInto(this.values, initialValues);
        }
    }

    reset(defaultValues?: ArrayLike<number>): this {
        this.values.fill(0);
        if (defaultValues) {
            copyInto(this.values, defaultValues);
        }
        return this;
    }

    copyFrom(other: AnimationCurveStore): this {
        if (other.values.length !== this.values.length) {
            throw new AnimationValidationError('Animation curve layouts are incompatible');
        }
        this.values.set(other.values);
        return this;
    }

    read(id: string): Float32Array | null {
        const binding = this.layout.get(id);
        if (!binding) {
            return null;
        }
        return this.values.subarray(binding.offset, binding.offset + binding.componentCount);
    }

    write(id: string, value: ArrayLike<number>): this {
        const binding = this.layout.get(id);
        if (!binding) {
            throw new AnimationValidationError(`Unknown animation curve '${id}'`);
        }
        for (let componentIndex = 0; componentIndex < binding.componentCount; componentIndex += 1) {
            this.values[binding.offset + componentIndex] = Number(value[componentIndex] ?? 0);
        }
        return this;
    }
}

export class AnimationPose {
    readonly translations: Float32Array;
    readonly rotations: Float32Array;
    readonly scales: Float32Array;

    constructor(readonly boneCount: number) {
        this.translations = new Float32Array(boneCount * 3);
        this.rotations = new Float32Array(boneCount * 4);
        this.scales = new Float32Array(boneCount * 3);
    }

    copyFrom(other: AnimationPose): this {
        if (other.boneCount !== this.boneCount) {
            throw new AnimationValidationError('Animation poses have different bone counts');
        }
        this.translations.set(other.translations);
        this.rotations.set(other.rotations);
        this.scales.set(other.scales);
        return this;
    }

    reset(rig: AnimationRig): this {
        this.translations.set(rig.restTranslations);
        this.rotations.set(rig.restRotations);
        this.scales.set(rig.restScales);
        return this;
    }
}

export class AnimationFrame {
    readonly pose: AnimationPose;
    readonly curves: AnimationCurveStore;

    constructor(rig: AnimationRig, curveLayout: AnimationCurveLayout) {
        this.pose = new AnimationPose(rig.boneCount).reset(rig);
        this.curves = new AnimationCurveStore(curveLayout);
    }

    reset(rig: AnimationRig, curveDefaults?: ArrayLike<number>): this {
        this.pose.reset(rig);
        this.curves.reset(curveDefaults);
        return this;
    }

    copyFrom(other: AnimationFrame): this {
        this.pose.copyFrom(other.pose);
        this.curves.copyFrom(other.curves);
        return this;
    }
}

export class AnimationMask {
    private readonly _bits: Uint32Array;

    constructor(readonly boneCount: number, fill: boolean = false) {
        this._bits = new Uint32Array(Math.max(1, Math.ceil(boneCount / 32)));
        if (fill) {
            this.fill(true);
        }
    }

    has(index: number): boolean {
        const bucket = index >> 5;
        const bit = index & 31;
        return (this._bits[bucket] & (1 << bit)) !== 0;
    }

    set(index: number, enabled: boolean): this {
        const bucket = index >> 5;
        const bit = index & 31;
        if (enabled) {
            this._bits[bucket] |= 1 << bit;
        } else {
            this._bits[bucket] &= ~(1 << bit);
        }
        return this;
    }

    fill(enabled: boolean): this {
        this._bits.fill(enabled ? 0xffffffff : 0);
        return this;
    }
}

export class AnimationWorldPose {
    readonly translations: Float32Array;
    readonly rotations: Float32Array;
    readonly scales: Float32Array;

    private readonly _scratchVector = new Float32Array(3);

    constructor(readonly boneCount: number) {
        this.translations = new Float32Array(boneCount * 3);
        this.rotations = new Float32Array(boneCount * 4);
        this.scales = new Float32Array(boneCount * 3);
    }

    update(rig: AnimationRig, pose: AnimationPose): this {
        for (let orderIndex = 0; orderIndex < rig.evaluationOrder.length; orderIndex += 1) {
            const boneIndex = rig.evaluationOrder[orderIndex]!;
            const localTranslationOffset = boneIndex * 3;
            const localRotationOffset = boneIndex * 4;
            const parentIndex = rig.parentIndices[boneIndex]!;
            if (parentIndex < 0) {
                this.translations.set(
                    pose.translations.subarray(localTranslationOffset, localTranslationOffset + 3),
                    localTranslationOffset
                );
                this.rotations.set(
                    pose.rotations.subarray(localRotationOffset, localRotationOffset + 4),
                    localRotationOffset
                );
                this.scales.set(
                    pose.scales.subarray(localTranslationOffset, localTranslationOffset + 3),
                    localTranslationOffset
                );
                continue;
            }

            const parentTranslationOffset = parentIndex * 3;
            const parentRotationOffset = parentIndex * 4;
            SoaVec3Buffer.vec3Multiply(
                this._scratchVector,
                0,
                pose.translations,
                localTranslationOffset,
                this.scales,
                parentTranslationOffset
            );
            SoaQuatBuffer.quatApplyToVec3(
                this._scratchVector,
                0,
                this.rotations,
                parentRotationOffset,
                this._scratchVector,
                0
            );
            SoaVec3Buffer.vec3Add(
                this.translations,
                localTranslationOffset,
                this.translations,
                parentTranslationOffset,
                this._scratchVector,
                0
            );
            SoaQuatBuffer.quatMultiply(
                this.rotations,
                localRotationOffset,
                this.rotations,
                parentRotationOffset,
                pose.rotations,
                localRotationOffset
            );
            SoaQuatBuffer.quatNormalize(this.rotations, localRotationOffset, this.rotations, localRotationOffset);
            SoaVec3Buffer.vec3Multiply(
                this.scales,
                localTranslationOffset,
                this.scales,
                parentTranslationOffset,
                pose.scales,
                localTranslationOffset
            );
        }

        return this;
    }
}
