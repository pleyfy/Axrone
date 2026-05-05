import { Vec3, type Mat4 } from '@axrone/numeric';
import { ReusableList, SortableRenderList, StringKeyCache } from './memory';
import type {
    ReadonlyRenderList,
    RenderCameraState,
    RenderFrameInput,
    RenderLight,
    RenderPrimitiveInstance,
    RenderReflectionProbe,
} from './types';

export interface RenderFrameClassifierOptions {
    readonly maxTransparentPrimitives: number;
    readonly maxActiveLocalLights: number;
    readonly maxActiveReflectionProbes: number;
    readonly maxShadowedLights: number;
}

const OPAQUE_SORT: readonly [1, 1, 1] = [1, 1, 1] as const;
const TRANSPARENT_SORT: readonly [1, -1, 1] = [1, -1, 1] as const;
const IMPORTANCE_SORT: readonly [-1, 1, 1] = [-1, 1, 1] as const;
const MAX_CLASSIFICATION_WARNINGS = 16;

type RenderVec3Ref = RenderCameraState['position'] | RenderReflectionProbe['position'];
type ObjectVec3Ref = Exclude<RenderVec3Ref, readonly [number, number, number]>;

const asObjectVec3 = (value: RenderVec3Ref): ObjectVec3Ref => value as ObjectVec3Ref;

const getX = (value: RenderVec3Ref): number => (Array.isArray(value) ? value[0] : asObjectVec3(value).x);
const getY = (value: RenderVec3Ref): number => (Array.isArray(value) ? value[1] : asObjectVec3(value).y);
const getZ = (value: RenderVec3Ref): number => (Array.isArray(value) ? value[2] : asObjectVec3(value).z);

const getTranslationX = (matrix: Mat4): number => matrix.data[3];
const getTranslationY = (matrix: Mat4): number => matrix.data[7];
const getTranslationZ = (matrix: Mat4): number => matrix.data[11];

const resolveCameraFrustum = (camera: RenderCameraState) => camera.frustum ?? camera.camera3D?.frustum;

const layerVisible = (cameraMask: number, primitiveMask: number | undefined): boolean =>
    primitiveMask === undefined || primitiveMask === 0 || (cameraMask & primitiveMask) !== 0;

const localLightImportance = (light: RenderLight, camera: RenderCameraState): number => {
    const cx = getX(camera.position);
    const cy = getY(camera.position);
    const cz = getZ(camera.position);
    let px = 0;
    let py = 0;
    let pz = 0;
    let range = 1;

    if (light.type === 'point' || light.type === 'spot') {
        px = getX(light.position);
        py = getY(light.position);
        pz = getZ(light.position);
        range = Math.max(0.001, light.range);
    }

    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    return (light.intensity * range * range) / Math.max(distanceSq, 1);
};

const primitiveDistanceSq = (primitive: RenderPrimitiveInstance, camera: RenderCameraState): number => {
    const cx = getX(camera.position);
    const cy = getY(camera.position);
    const cz = getZ(camera.position);
    const px = primitive.bounds ? getX(primitive.bounds.center) : getTranslationX(primitive.worldMatrix);
    const py = primitive.bounds ? getY(primitive.bounds.center) : getTranslationY(primitive.worldMatrix);
    const pz = primitive.bounds ? getZ(primitive.bounds.center) : getTranslationZ(primitive.worldMatrix);
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    return dx * dx + dy * dy + dz * dz;
};

const probeUpdateUrgency = (probe: RenderReflectionProbe, frame: number): number => {
    const interval = Math.max(1, probe.updateInterval ?? 30);
    const age =
        probe.lastUpdatedFrame === undefined ? interval : Math.max(0, frame - probe.lastUpdatedFrame);
    const dirtyBoost = probe.dirty === true ? interval * 2 : 0;
    const priority = probe.priority ?? 0;
    return priority * 100 + dirtyBoost + age;
};

const reflectionProbeDistanceSq = (probe: RenderReflectionProbe, camera: RenderCameraState): number => {
    const dx = getX(probe.position) - getX(camera.position);
    const dy = getY(probe.position) - getY(camera.position);
    const dz = getZ(probe.position) - getZ(camera.position);
    return dx * dx + dy * dy + dz * dz;
};

const isTransparentMaterial = (primitive: RenderPrimitiveInstance): boolean =>
    primitive.material.transparent === true;

const castsShadows = (primitive: RenderPrimitiveInstance): boolean =>
    primitive.material.castsShadows !== false;

const renderQueueFor = (primitive: RenderPrimitiveInstance): number => {
    if (primitive.material.renderQueue !== undefined) {
        return primitive.material.renderQueue;
    }
    if (primitive.material.transparent) {
        return 3000;
    }
    if (primitive.material.alphaClipped) {
        return 2450;
    }
    return 2000;
};

export class RenderFrameClassifier {
    private readonly _strings = new StringKeyCache();
    private readonly _primitiveFrustumMin = new Vec3();
    private readonly _primitiveFrustumMax = new Vec3();
    private readonly _primitiveFrustumBounds = {
        kind: 'aabb' as const,
        min: this._primitiveFrustumMin,
        max: this._primitiveFrustumMax,
    };
    private readonly _opaque = new SortableRenderList<RenderPrimitiveInstance>(256);
    private readonly _transparent = new SortableRenderList<RenderPrimitiveInstance>(128);
    private readonly _shadowCasters = new SortableRenderList<RenderPrimitiveInstance>(256);
    private readonly _localLightCandidates = new SortableRenderList<RenderLight>(64);
    private readonly _probeCandidates = new SortableRenderList<RenderReflectionProbe>(32);
    private readonly _activeLights = new ReusableList<RenderLight>(32);
    private readonly _shadowLights = new ReusableList<RenderLight>(8);
    private readonly _activeProbes = new ReusableList<RenderReflectionProbe>(8);
    private readonly _probeUpdates = new ReusableList<RenderReflectionProbe>(4);

    constructor(private readonly _options: RenderFrameClassifierOptions) {}

    get opaque(): ReadonlyRenderList<RenderPrimitiveInstance> {
        return this._opaque;
    }

    get transparent(): ReadonlyRenderList<RenderPrimitiveInstance> {
        return this._transparent;
    }

    get shadowCasters(): ReadonlyRenderList<RenderPrimitiveInstance> {
        return this._shadowCasters;
    }

    get activeLights(): ReadonlyRenderList<RenderLight> {
        return this._activeLights;
    }

    get shadowLights(): ReadonlyRenderList<RenderLight> {
        return this._shadowLights;
    }

    get activeProbes(): ReadonlyRenderList<RenderReflectionProbe> {
        return this._activeProbes;
    }

    get probeUpdates(): ReadonlyRenderList<RenderReflectionProbe> {
        return this._probeUpdates;
    }

    reset(): void {
        this._opaque.reset();
        this._transparent.reset();
        this._shadowCasters.reset();
        this._localLightCandidates.reset();
        this._probeCandidates.reset();
        this._activeLights.reset();
        this._shadowLights.reset();
        this._activeProbes.reset();
        this._probeUpdates.reset();
    }

    clear(): void {
        this._strings.clear();
        this._opaque.clear();
        this._transparent.clear();
        this._shadowCasters.clear();
        this._localLightCandidates.clear();
        this._probeCandidates.clear();
        this._activeLights.clear();
        this._shadowLights.clear();
        this._activeProbes.clear();
        this._probeUpdates.clear();
    }

    classify(input: RenderFrameInput, frame: number, warnings: ReusableList<string>): void {
        this._classifyPrimitives(input, warnings);
        this._classifyLights(input);
        this._classifyProbes(input, frame);
    }

    private _classifyPrimitives(input: RenderFrameInput, warnings: ReusableList<string>): void {
        const cameraMask = input.camera.layerMask ?? -1;
        const frustum = resolveCameraFrustum(input.camera);
        for (const primitive of input.primitives) {
            if (primitive.visible === false) {
                continue;
            }

            if (!layerVisible(cameraMask, primitive.layerMask)) {
                continue;
            }

            if (frustum && primitive.bounds && !this._intersectsCameraFrustum(primitive, frustum)) {
                continue;
            }

            const queue = renderQueueFor(primitive);
            const materialKey = this._strings.get(primitive.material.id);
            const meshKey = this._strings.get(primitive.meshId);
            const distanceSq = primitiveDistanceSq(primitive, input.camera);

            if (isTransparentMaterial(primitive)) {
                if (this._transparent.length >= this._options.maxTransparentPrimitives) {
                    if (warnings.length < MAX_CLASSIFICATION_WARNINGS) {
                        warnings.push(
                            `transparent primitive budget exceeded at ${this._options.maxTransparentPrimitives}`
                        );
                    }
                    continue;
                }

                this._transparent.push(
                    primitive,
                    queue,
                    distanceSq,
                    materialKey + (primitive.sortBias ?? 0)
                );
            } else {
                this._opaque.push(primitive, queue, materialKey, meshKey);
            }

            if (castsShadows(primitive)) {
                this._shadowCasters.push(primitive, queue, materialKey, distanceSq);
            }
        }

        this._opaque.sort(OPAQUE_SORT);
        this._transparent.sort(TRANSPARENT_SORT);
        this._shadowCasters.sort(OPAQUE_SORT);
    }

    private _intersectsCameraFrustum(
        primitive: RenderPrimitiveInstance,
        frustum: NonNullable<ReturnType<typeof resolveCameraFrustum>>
    ): boolean {
        const bounds = primitive.bounds;
        if (!bounds) {
            return true;
        }

        const centerX = getX(bounds.center);
        const centerY = getY(bounds.center);
        const centerZ = getZ(bounds.center);
        const extentX = getX(bounds.extents);
        const extentY = getY(bounds.extents);
        const extentZ = getZ(bounds.extents);

        this._primitiveFrustumMin.x = centerX - extentX;
        this._primitiveFrustumMin.y = centerY - extentY;
        this._primitiveFrustumMin.z = centerZ - extentZ;
        this._primitiveFrustumMax.x = centerX + extentX;
        this._primitiveFrustumMax.y = centerY + extentY;
        this._primitiveFrustumMax.z = centerZ + extentZ;

        return frustum.intersectsAabb(this._primitiveFrustumBounds);
    }

    private _classifyLights(input: RenderFrameInput): void {
        for (const light of input.lights ?? []) {
            if (light.type === 'directional') {
                this._activeLights.push(light);
                if (light.castsShadows && this._shadowLights.length < this._options.maxShadowedLights) {
                    this._shadowLights.push(light);
                }
                continue;
            }

            this._localLightCandidates.push(
                light,
                localLightImportance(light, input.camera),
                light.intensity,
                light.type === 'spot' ? 1 : 0
            );
        }

        this._localLightCandidates.sort(IMPORTANCE_SORT);
        const count = Math.min(this._localLightCandidates.length, this._options.maxActiveLocalLights);
        for (let i = 0; i < count; i++) {
            const light = this._localLightCandidates.at(i);
            this._activeLights.push(light);
            if (light.castsShadows && this._shadowLights.length < this._options.maxShadowedLights) {
                this._shadowLights.push(light);
            }
        }
    }

    private _classifyProbes(input: RenderFrameInput, frame: number): void {
        for (const probe of input.environment?.reflectionProbes ?? []) {
            const priority = probeUpdateUrgency(probe, frame);
            const distanceSq = reflectionProbeDistanceSq(probe, input.camera);
            this._probeCandidates.push(probe, priority, distanceSq, probe.intensity ?? 1);
        }

        this._probeCandidates.sort(IMPORTANCE_SORT);
        const activeCount = Math.min(this._probeCandidates.length, this._options.maxActiveReflectionProbes);
        for (let i = 0; i < activeCount; i++) {
            const probe = this._probeCandidates.at(i);
            this._activeProbes.push(probe);
            const mode = probe.mode ?? 'baked';
            const interval = Math.max(1, probe.updateInterval ?? 30);
            const shouldUpdate =
                mode !== 'baked' &&
                (probe.dirty === true ||
                    probe.lastUpdatedFrame === undefined ||
                    frame - probe.lastUpdatedFrame >= interval);
            if (shouldUpdate) {
                this._probeUpdates.push(probe);
            }
        }
    }
}