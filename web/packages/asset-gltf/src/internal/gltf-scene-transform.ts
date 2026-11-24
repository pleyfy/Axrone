import type { Vec3Tuple, QuatTuple, NodeId, TransformDecomposition, LightReference } from './gltf-branded-types';
import type { GltfEntitySnapshot, GltfComponentSnapshot, TransformComponentData } from './gltf-component-snapshot';
import type { GltfNodeJson } from '../types';
import { nodeId } from './gltf-branded-types';

export interface DecomposedTransform {
    readonly position: Vec3Tuple;
    readonly rotation: QuatTuple;
    readonly scale: Vec3Tuple;
}

export const decomposeNodeTransform = (node: GltfNodeJson): DecomposedTransform => {
    if (node.matrix && node.matrix.length === 16) {
        const m = node.matrix;
        const sx = Math.hypot(m[0], m[1], m[2]);
        const sy = Math.hypot(m[4], m[5], m[6]);
        const sz = Math.hypot(m[8], m[9], m[10]);
        const rm00 = sx === 0 ? 1 : m[0] / sx;
        const rm01 = sx === 0 ? 0 : m[1] / sx;
        const rm02 = sx === 0 ? 0 : m[2] / sx;
        const rm10 = sy === 0 ? 0 : m[4] / sy;
        const rm11 = sy === 0 ? 1 : m[5] / sy;
        const rm12 = sy === 0 ? 0 : m[6] / sy;
        const rm20 = sz === 0 ? 0 : m[8] / sz;
        const rm21 = sz === 0 ? 0 : m[9] / sz;
        const rm22 = sz === 0 ? 1 : m[10] / sz;
        const trace = rm00 + rm11 + rm22;
        let x = 0, y = 0, z = 0, w = 1;

        if (trace > 0) {
            const s = Math.sqrt(trace + 1) * 2;
            w = 0.25 * s;
            x = (rm21 - rm12) / s;
            y = (rm02 - rm20) / s;
            z = (rm10 - rm01) / s;
        } else if (rm00 > rm11 && rm00 > rm22) {
            const s = Math.sqrt(1 + rm00 - rm11 - rm22) * 2;
            w = (rm21 - rm12) / s; x = 0.25 * s; y = (rm01 + rm10) / s; z = (rm02 + rm20) / s;
        } else if (rm11 > rm22) {
            const s = Math.sqrt(1 + rm11 - rm00 - rm22) * 2;
            w = (rm02 - rm20) / s; x = (rm01 + rm10) / s; y = 0.25 * s; z = (rm12 + rm21) / s;
        } else {
            const s = Math.sqrt(1 + rm22 - rm00 - rm11) * 2;
            w = (rm10 - rm01) / s; x = (rm02 + rm20) / s; y = (rm12 + rm21) / s; z = 0.25 * s;
        }

        return Object.freeze({
            position: Object.freeze([m[12], m[13], m[14]]) as Vec3Tuple,
            rotation: Object.freeze([x, y, z, w]) as QuatTuple,
            scale: Object.freeze([sx === 0 ? 0 : sx, sy === 0 ? 0 : sy, sz === 0 ? 0 : sz]) as Vec3Tuple,
        });
    }

    return Object.freeze({
        position: Object.freeze(node.translation ?? [0, 0, 0]) as Vec3Tuple,
        rotation: Object.freeze(node.rotation ?? [0, 0, 0, 1]) as QuatTuple,
        scale: Object.freeze(node.scale ?? [1, 1, 1]) as Vec3Tuple,
    });
};

export const createTransformSnapshot = (node: GltfNodeJson): GltfComponentSnapshot => {
    const transform = decomposeNodeTransform(node);
    return Object.freeze({
        type: 'Transform' as const,
        data: Object.freeze({
            position: Object.freeze([...transform.position]) as Vec3Tuple,
            rotation: Object.freeze([...transform.rotation]) as QuatTuple,
            scale: Object.freeze([...transform.scale]) as Vec3Tuple,
        } satisfies TransformComponentData),
    });
};

export const createEntitySnapshot = (
    nodeIdOrIndex: number | string,
    parentNodeIdOrIndex: (number | string) | null,
    name: string,
    components: readonly GltfComponentSnapshot[]
): GltfEntitySnapshot =>
    Object.freeze({
        nodeId: typeof nodeIdOrIndex === 'string' ? (nodeIdOrIndex as NodeId) : nodeId(nodeIdOrIndex),
        parentNodeId: parentNodeIdOrIndex !== null
            ? (typeof parentNodeIdOrIndex === 'string' ? (parentNodeIdOrIndex as NodeId) : nodeId(parentNodeIdOrIndex))
            : null,
        name,
        layer: 0,
        tag: 'Default',
        active: true,
        persistent: false,
        pooled: false,
        components,
    });

export const nodeIdFromIndex = (nodeIndex: number): NodeId => nodeId(nodeIndex);
