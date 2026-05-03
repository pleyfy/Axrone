import { composeMatrix, mat4Invert, mat4Multiply } from './math';
import type { AnimationWorldPose } from './pose';
import type { AnimationRig } from './rig';

export interface AnimationSkinningPaletteOptions {
    readonly meshWorldMatrix: ArrayLike<number>;
    readonly jointWorldMatrices: readonly ArrayLike<number>[];
    readonly inverseBindMatrices?: ArrayLike<number> | null;
    readonly out?: Float32Array;
}

const writeIdentity = (target: Float32Array, offset: number): void => {
    target[offset] = 1;
    target[offset + 1] = 0;
    target[offset + 2] = 0;
    target[offset + 3] = 0;
    target[offset + 4] = 0;
    target[offset + 5] = 1;
    target[offset + 6] = 0;
    target[offset + 7] = 0;
    target[offset + 8] = 0;
    target[offset + 9] = 0;
    target[offset + 10] = 1;
    target[offset + 11] = 0;
    target[offset + 12] = 0;
    target[offset + 13] = 0;
    target[offset + 14] = 0;
    target[offset + 15] = 1;
};

export const computeSkinningPalette = ({
    meshWorldMatrix,
    jointWorldMatrices,
    inverseBindMatrices,
    out,
}: AnimationSkinningPaletteOptions): Float32Array => {
    const palette = out ?? new Float32Array(jointWorldMatrices.length * 16);
    const inverseMeshMatrix = new Float32Array(16);
    const scratchMatrix = new Float32Array(16);
    if (!mat4Invert(inverseMeshMatrix, 0, meshWorldMatrix, 0)) {
        palette.fill(0);
        for (let index = 0; index < jointWorldMatrices.length; index += 1) {
            writeIdentity(palette, index * 16);
        }
        return palette;
    }

    for (let jointIndex = 0; jointIndex < jointWorldMatrices.length; jointIndex += 1) {
        mat4Multiply(scratchMatrix, 0, inverseMeshMatrix, 0, jointWorldMatrices[jointIndex]!, 0);
        if (inverseBindMatrices) {
            mat4Multiply(palette, jointIndex * 16, scratchMatrix, 0, inverseBindMatrices, jointIndex * 16);
        } else {
            palette.set(scratchMatrix, jointIndex * 16);
        }
    }

    return palette;
};

export const computeRigSkinningPalette = (
    rig: AnimationRig,
    worldPose: AnimationWorldPose,
    out?: Float32Array
): Float32Array => {
    const palette = out ?? new Float32Array(rig.boneCount * 16);
    const worldMatrix = new Float32Array(16);
    const scratch = new Float32Array(16);
    for (let boneIndex = 0; boneIndex < rig.boneCount; boneIndex += 1) {
        composeMatrix(
            worldMatrix,
            0,
            worldPose.translations,
            boneIndex * 3,
            worldPose.rotations,
            boneIndex * 4,
            worldPose.scales,
            boneIndex * 3
        );
        if (rig.inverseBindMatrices) {
            mat4Multiply(scratch, 0, worldMatrix, 0, rig.inverseBindMatrices, boneIndex * 16);
            palette.set(scratch, boneIndex * 16);
        } else {
            palette.set(worldMatrix, boneIndex * 16);
        }
    }
    return palette;
};