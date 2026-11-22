import type { AnimationParameterStore } from './parameters';
import { BLEND_EPSILON, BLEND_DISTANCE_EPSILON_SQ, BLEND1D_LINEAR_SCAN_LIMIT } from './blend-types';
import type { AnimationMotionEvaluationContext } from './blend-scratch';
import type { IVec2Like } from '@axrone/numeric';

export const resolveMotionTime = (
    normalizedTime: number,
    duration: number,
    cycleOffset: number,
    loop: boolean
): number => {
    if (duration <= 0 || !Number.isFinite(duration) || !Number.isFinite(normalizedTime) || !Number.isFinite(cycleOffset)) {
        return 0;
    }
    const offsetTime = normalizedTime + cycleOffset;
    if (!loop) {
        const normalized = Math.max(0, Math.min(1, offsetTime));
        return normalized * duration;
    }
    const wrapped = offsetTime % 1;
    const normalized = wrapped < 0 ? wrapped + 1 : wrapped;
    return normalized * duration;
};

export const resolveParameterScalar = (parameters: AnimationParameterStore, name: string): number => {
    const value = parameters.get(name);
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    return value ? 1 : 0;
};

export const resolveParameterScalarSafe = (parameters: AnimationParameterStore, name: string): number => {
    const raw = resolveParameterScalar(parameters, name);
    return Number.isFinite(raw) ? raw : 0;
};

export const resolveDirectChildWeight = (
    parameters: AnimationParameterStore,
    parameter: string | undefined,
    weight: number
): number => {
    if (!parameter) {
        return Math.max(0, Number.isFinite(weight) ? weight : 0);
    }
    const value = parameters.get(parameter);
    const scalar = typeof value === 'number' ? value : value ? 1 : 0;
    if (!Number.isFinite(scalar) || !Number.isFinite(weight)) return 0;
    return Math.max(0, scalar * weight);
};

export const resolveAdditiveWeight = (
    parameters: AnimationParameterStore,
    parameter: string | undefined,
    weight: number
): number => {
    if (!parameter) {
        return Number.isFinite(weight) ? weight : 0;
    }
    const value = parameters.get(parameter);
    const scalar = typeof value === 'number' ? value : value ? weight : 0;
    return Number.isFinite(scalar) ? scalar : 0;
};

// Hybrid: linear for <=8 (branch-predictable), binary for larger
export const findBlend1DSegment = (
    children: readonly { readonly threshold: number }[],
    input: number
): number => {
    if (!Number.isFinite(input)) return 0;
    if (children.length === 1 || input <= children[0]!.threshold) {
        return -1;
    }
    if (children.length <= BLEND1D_LINEAR_SCAN_LIMIT) {
        for (let index = 0; index < children.length - 1; index += 1) {
            if (input > children[index + 1]!.threshold) continue;
            return index;
        }
        return -children.length;
    }
    // binary search: find greatest left where threshold <= input < right threshold
    if (input >= children[children.length - 1]!.threshold) return -children.length;
    let low = 0;
    let high = children.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const midVal = children[mid]!.threshold;
        const nextVal = children[mid + 1]?.threshold ?? Infinity;
        if (input < midVal) {
            high = mid - 1;
        } else if (input >= nextVal) {
            low = mid + 1;
        } else if (midVal <= input && input < nextVal) {
            // ensure input is within [mid, mid+1) and mid is not past end
            if (input <= children[0]!.threshold) return -1;
            return mid;
        } else {
            low = mid + 1;
        }
    }
    // fallback linear (should not happen)
    for (let index = 0; index < children.length - 1; index += 1) {
        if (input <= children[index + 1]!.threshold) return index;
    }
    return -children.length;
};

export const resolveBlend1DAlpha = (
    children: readonly { readonly threshold: number }[],
    leftIndex: number,
    input: number
): number => {
    const left = children[leftIndex]!;
    const right = children[leftIndex + 1]!;
    const denom = Math.max(BLEND_EPSILON, right.threshold - left.threshold);
    const alpha = (input - left.threshold) / denom;
    return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
};

export const computeBlend2DWeights = (
    x: number,
    y: number,
    children: readonly Readonly<IVec2Like>[],
    outWeights: number[],
    triangles?: Int32Array
): void => {
    const safeX = Number.isFinite(x) ? x : 0;
    const safeY = Number.isFinite(y) ? y : 0;
    if (triangles && triangles.length >= 3 && computeFreeformWeights(safeX, safeY, children, triangles, outWeights)) {
        return;
    }
    let total = 0;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index]!;
        const dx = safeX - child.x;
        const dy = safeY - child.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= BLEND_DISTANCE_EPSILON_SQ) {
            for (let fill = 0; fill < children.length; fill += 1) outWeights[fill] = 0;
            outWeights[index] = 1;
            return;
        }
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        outWeights[index] = inverseDistance;
        total += inverseDistance;
    }
    if (total <= 0 || !Number.isFinite(total)) {
        const uniform = 1 / Math.max(1, children.length);
        for (let index = 0; index < children.length; index += 1) outWeights[index] = uniform;
        return;
    }
    const invTotal = 1 / total;
    for (let index = 0; index < children.length; index += 1) outWeights[index]! *= invTotal;
};

export const resolveBlend2DWeightsWithContext = (
    x: number,
    y: number,
    children: readonly Readonly<IVec2Like>[],
    context: AnimationMotionEvaluationContext,
    depth: number,
    triangles?: Int32Array
): number[] => {
    const weights = context.blendScratch.acquireBlend2DWeights(depth, children.length);
    computeBlend2DWeights(x, y, children, weights, triangles);
    return weights;
};

const computeFreeformWeights = (
    x: number,
    y: number,
    children: readonly Readonly<IVec2Like>[],
    triangles: Int32Array,
    outWeights: number[]
): boolean => {
    const epsilon = 1e-5;
    for (let index = 0; index < outWeights.length; index += 1) {
        outWeights[index] = 0;
    }

    for (let t = 0; t < triangles.length; t += 3) {
        const a = triangles[t]!;
        const b = triangles[t + 1]!;
        const c = triangles[t + 2]!;
        const pa = children[a]!;
        const pb = children[b]!;
        const pc = children[c]!;
        const area = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
        if (Math.abs(area) <= epsilon) {
            continue;
        }

        let wa = ((pb.x - x) * (pc.y - y) - (pb.y - y) * (pc.x - x)) / area;
        let wb = ((pc.x - x) * (pa.y - y) - (pc.y - y) * (pa.x - x)) / area;
        let wc = 1 - wa - wb;
        if (wa < -epsilon || wb < -epsilon || wc < -epsilon) {
            continue;
        }

        wa = Math.max(0, wa);
        wb = Math.max(0, wb);
        wc = Math.max(0, wc);
        const total = wa + wb + wc;
        if (total <= BLEND_EPSILON) {
            continue;
        }

        const inverse = 1 / total;
        outWeights[a] = wa * inverse;
        outWeights[b] = wb * inverse;
        outWeights[c] = wc * inverse;
        return true;
    }

    return false;
};
