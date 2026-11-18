import { Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import type { Mutable } from '@axrone/utility';

export type ReflectionProbeMode = 'baked' | 'realtime' | 'custom';
export type ReflectionProbeShape = 'sphere' | 'box';
export type ReflectionProbeRefreshMode = 'on-load' | 'every-frame' | 'via-scripting';
export type ReflectionProbeTimeSlicingMode = 'all-faces-at-once' | 'individual-faces' | 'no-time-slicing';
export type ReflectionProbeClearFlags = 'skybox' | 'solid-color' | 'depth-only';

export interface ReflectionProbeConfig {
    readonly mode?: ReflectionProbeMode;
    readonly shape?: ReflectionProbeShape;
    readonly refreshMode?: ReflectionProbeRefreshMode;
    readonly timeSlicingMode?: ReflectionProbeTimeSlicingMode;
    readonly resolution?: number;
    readonly clearFlags?: ReflectionProbeClearFlags;
    readonly backgroundColor?: Vec3 | readonly [number, number, number];
    readonly intensity?: number;
    readonly blendDistance?: number;
    readonly boxProjection?: boolean;
    readonly boxSize?: Vec3 | readonly [number, number, number];
    readonly boxOffset?: Vec3 | readonly [number, number, number];
    readonly nearClip?: number;
    readonly farClip?: number;
    readonly shadowDistance?: number;
    readonly cullingMask?: number;
    readonly importance?: number;
    readonly hdr?: boolean;
    readonly customTextureId?: string | null;
}

type MutableReflectionProbeConfig = Mutable<ReflectionProbeConfig>;

const toVec3 = (
    value?: Vec3 | readonly [number, number, number],
    fallback: Vec3 = Vec3.ZERO
): Vec3 => {
    if (value instanceof Vec3) {
        return Vec3.from(value);
    }

    if (Array.isArray(value) && value.length === 3) {
        return Vec3.fromArray(value);
    }

    return fallback.clone();
};

const DEFAULT_BACKGROUND_COLOR = Object.freeze(new Vec3(0.08, 0.09, 0.11));
const DEFAULT_BOX_SIZE = Object.freeze(new Vec3(10, 10, 10));

/**
 * ReflectionProbe component captures the surrounding environment into a cubemap
 * that can be used by nearby objects for realistic reflections.
 *
 * @example
 * ```ts
 * const probe = new ReflectionProbe({
 *     mode: 'realtime',
 *     shape: 'box',
 *     boxSize: [5, 5, 5],
 *     intensity: 1,
 * });
 * actor.addComponent(ReflectionProbe, probe);
 * ```
 */
@script({
    scriptName: 'ReflectionProbe',
    priority: 500,
    executeInEditMode: true,
    singleton: false,
})
export class ReflectionProbe extends Component {
    private _mode: ReflectionProbeMode;
    private _shape: ReflectionProbeShape;
    private _refreshMode: ReflectionProbeRefreshMode;
    private _timeSlicingMode: ReflectionProbeTimeSlicingMode;
    private _resolution: number;
    private _clearFlags: ReflectionProbeClearFlags;
    private _backgroundColor: Vec3;
    private _intensity: number;
    private _blendDistance: number;
    private _boxProjection: boolean;
    private _boxSize: Vec3;
    private _boxOffset: Vec3;
    private _nearClip: number;
    private _farClip: number;
    private _shadowDistance: number;
    private _cullingMask: number;
    private _importance: number;
    private _hdr: boolean;
    private _customTextureId: string | null;
    private _needsRender: boolean = true;

    constructor(config: ReflectionProbeConfig = {}) {
        super();
        this._mode = 'baked';
        this._shape = 'box';
        this._refreshMode = 'on-load';
        this._timeSlicingMode = 'all-faces-at-once';
        this._resolution = 256;
        this._clearFlags = 'skybox';
        this._backgroundColor = Vec3.from(DEFAULT_BACKGROUND_COLOR);
        this._intensity = 1;
        this._blendDistance = 1;
        this._boxProjection = true;
        this._boxSize = Vec3.from(DEFAULT_BOX_SIZE);
        this._boxOffset = Vec3.ZERO.clone();
        this._nearClip = 0.1;
        this._farClip = 1000;
        this._shadowDistance = 100;
        this._cullingMask = 0xffffffff;
        this._importance = 0;
        this._hdr = true;
        this._customTextureId = null;
        this._applyConfig(config);
    }

    get mode(): ReflectionProbeMode {
        return this._mode;
    }

    set mode(value: ReflectionProbeMode) {
        this._mode = value;
        this._needsRender = true;
    }

    get shape(): ReflectionProbeShape {
        return this._shape;
    }

    set shape(value: ReflectionProbeShape) {
        this._shape = value;
    }

    get refreshMode(): ReflectionProbeRefreshMode {
        return this._refreshMode;
    }

    set refreshMode(value: ReflectionProbeRefreshMode) {
        this._refreshMode = value;
    }

    get timeSlicingMode(): ReflectionProbeTimeSlicingMode {
        return this._timeSlicingMode;
    }

    set timeSlicingMode(value: ReflectionProbeTimeSlicingMode) {
        this._timeSlicingMode = value;
    }

    get resolution(): number {
        return this._resolution;
    }

    set resolution(value: number) {
        const validResolutions = [16, 32, 64, 128, 256, 512, 1024, 2048];
        this._resolution = validResolutions.includes(value) ? value : 256;
        this._needsRender = true;
    }

    get clearFlags(): ReflectionProbeClearFlags {
        return this._clearFlags;
    }

    set clearFlags(value: ReflectionProbeClearFlags) {
        this._clearFlags = value;
        this._needsRender = true;
    }

    get backgroundColor(): Vec3 {
        return this._backgroundColor;
    }

    set backgroundColor(value: Vec3 | readonly [number, number, number]) {
        this._backgroundColor = toVec3(value, Vec3.from(DEFAULT_BACKGROUND_COLOR));
        this._needsRender = true;
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._intensity = Math.max(0, value);
    }

    get blendDistance(): number {
        return this._blendDistance;
    }

    set blendDistance(value: number) {
        this._blendDistance = Math.max(0, value);
    }

    get boxProjection(): boolean {
        return this._boxProjection;
    }

    set boxProjection(value: boolean) {
        this._boxProjection = value;
    }

    get boxSize(): Vec3 {
        return this._boxSize;
    }

    set boxSize(value: Vec3 | readonly [number, number, number]) {
        this._boxSize = toVec3(value, Vec3.from(DEFAULT_BOX_SIZE));
    }

    get boxOffset(): Vec3 {
        return this._boxOffset;
    }

    set boxOffset(value: Vec3 | readonly [number, number, number]) {
        this._boxOffset = toVec3(value);
    }

    get nearClip(): number {
        return this._nearClip;
    }

    set nearClip(value: number) {
        this._nearClip = Math.max(0.001, value);
        this._needsRender = true;
    }

    get farClip(): number {
        return this._farClip;
    }

    set farClip(value: number) {
        this._farClip = Math.max(this._nearClip + 0.001, value);
        this._needsRender = true;
    }

    get shadowDistance(): number {
        return this._shadowDistance;
    }

    set shadowDistance(value: number) {
        this._shadowDistance = Math.max(0, value);
    }

    get cullingMask(): number {
        return this._cullingMask;
    }

    set cullingMask(value: number) {
        this._cullingMask = value >>> 0;
        this._needsRender = true;
    }

    get importance(): number {
        return this._importance;
    }

    set importance(value: number) {
        this._importance = value;
    }

    get hdr(): boolean {
        return this._hdr;
    }

    set hdr(value: boolean) {
        this._hdr = value;
        this._needsRender = true;
    }

    get customTextureId(): string | null {
        return this._customTextureId;
    }

    set customTextureId(value: string | null) {
        this._customTextureId = value;
    }

    get needsRender(): boolean {
        return this._needsRender;
    }

    /**
     * Marks the probe as rendered, clearing the needsRender flag.
     */
    markRendered(): void {
        this._needsRender = false;
    }

    /**
     * Requests a re-render of the reflection probe.
     */
    requestRender(): void {
        this._needsRender = true;
    }

    /**
     * Gets the world-space position of the probe.
     */
    getWorldPosition(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return Vec3.ZERO.clone();
        }

        return transform.worldPosition.clone();
    }

    /**
     * Gets the world-space center of the probe's influence volume.
     */
    getWorldCenter(): Vec3 {
        const worldPos = this.getWorldPosition();
        return Vec3.add(worldPos, this._boxOffset);
    }

    /**
     * Checks if a point is within the probe's influence volume.
     */
    containsPoint(point: Vec3): boolean {
        const center = this.getWorldCenter();

        if (this._shape === 'sphere') {
            const radius = Math.max(this._boxSize.x, this._boxSize.y, this._boxSize.z) * 0.5;
            return Vec3.distance(point, center) <= radius + this._blendDistance;
        }

        const halfSize = new Vec3(
            this._boxSize.x * 0.5 + this._blendDistance,
            this._boxSize.y * 0.5 + this._blendDistance,
            this._boxSize.z * 0.5 + this._blendDistance
        );

        return (
            Math.abs(point.x - center.x) <= halfSize.x &&
            Math.abs(point.y - center.y) <= halfSize.y &&
            Math.abs(point.z - center.z) <= halfSize.z
        );
    }

    /**
     * Calculates the blend weight for a point within the probe's influence.
     * @returns Weight from 0 (outside) to 1 (fully inside)
     */
    getBlendWeight(point: Vec3): number {
        if (this._blendDistance <= 0) {
            return this.containsPoint(point) ? 1 : 0;
        }

        const center = this.getWorldCenter();

        if (this._shape === 'sphere') {
            const radius = Math.max(this._boxSize.x, this._boxSize.y, this._boxSize.z) * 0.5;
            const distance = Vec3.distance(point, center);
            if (distance <= radius) {
                return 1;
            }
            if (distance >= radius + this._blendDistance) {
                return 0;
            }
            return 1 - (distance - radius) / this._blendDistance;
        }

        const halfSize = Vec3.multiplyScalar(this._boxSize, 0.5);
        const dx = Math.max(0, Math.abs(point.x - center.x) - halfSize.x);
        const dy = Math.max(0, Math.abs(point.y - center.y) - halfSize.y);
        const dz = Math.max(0, Math.abs(point.z - center.z) - halfSize.z);
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance <= 0) {
            return 1;
        }
        if (distance >= this._blendDistance) {
            return 0;
        }
        return 1 - distance / this._blendDistance;
    }

    override serialize(): Record<string, unknown> {
        return {
            mode: this._mode,
            shape: this._shape,
            refreshMode: this._refreshMode,
            timeSlicingMode: this._timeSlicingMode,
            resolution: this._resolution,
            clearFlags: this._clearFlags,
            backgroundColor: [this._backgroundColor.x, this._backgroundColor.y, this._backgroundColor.z],
            intensity: this._intensity,
            blendDistance: this._blendDistance,
            boxProjection: this._boxProjection,
            boxSize: [this._boxSize.x, this._boxSize.y, this._boxSize.z],
            boxOffset: [this._boxOffset.x, this._boxOffset.y, this._boxOffset.z],
            nearClip: this._nearClip,
            farClip: this._farClip,
            shadowDistance: this._shadowDistance,
            cullingMask: this._cullingMask,
            importance: this._importance,
            hdr: this._hdr,
            customTextureId: this._customTextureId,
        };
    }

    override deserialize(data: Record<string, unknown>): void {
        const patch: MutableReflectionProbeConfig = {};

        if (typeof data.mode === 'string') {
            patch.mode = data.mode as ReflectionProbeMode;
        }
        if (typeof data.shape === 'string') {
            patch.shape = data.shape as ReflectionProbeShape;
        }
        if (typeof data.refreshMode === 'string') {
            patch.refreshMode = data.refreshMode as ReflectionProbeRefreshMode;
        }
        if (typeof data.timeSlicingMode === 'string') {
            patch.timeSlicingMode = data.timeSlicingMode as ReflectionProbeTimeSlicingMode;
        }
        if (typeof data.resolution === 'number') {
            patch.resolution = data.resolution;
        }
        if (typeof data.clearFlags === 'string') {
            patch.clearFlags = data.clearFlags as ReflectionProbeClearFlags;
        }
        if (Array.isArray(data.backgroundColor) && data.backgroundColor.length === 3) {
            patch.backgroundColor = data.backgroundColor as [number, number, number];
        }
        if (typeof data.intensity === 'number') {
            patch.intensity = data.intensity;
        }
        if (typeof data.blendDistance === 'number') {
            patch.blendDistance = data.blendDistance;
        }
        if (typeof data.boxProjection === 'boolean') {
            patch.boxProjection = data.boxProjection;
        }
        if (Array.isArray(data.boxSize) && data.boxSize.length === 3) {
            patch.boxSize = data.boxSize as [number, number, number];
        }
        if (Array.isArray(data.boxOffset) && data.boxOffset.length === 3) {
            patch.boxOffset = data.boxOffset as [number, number, number];
        }
        if (typeof data.nearClip === 'number') {
            patch.nearClip = data.nearClip;
        }
        if (typeof data.farClip === 'number') {
            patch.farClip = data.farClip;
        }
        if (typeof data.shadowDistance === 'number') {
            patch.shadowDistance = data.shadowDistance;
        }
        if (typeof data.cullingMask === 'number') {
            patch.cullingMask = data.cullingMask;
        }
        if (typeof data.importance === 'number') {
            patch.importance = data.importance;
        }
        if (typeof data.hdr === 'boolean') {
            patch.hdr = data.hdr;
        }
        if (typeof data.customTextureId === 'string' || data.customTextureId === null) {
            patch.customTextureId = data.customTextureId;
        }

        this._applyConfig(patch);
    }

    private _applyConfig(config: ReflectionProbeConfig): void {
        if (config.mode) {
            this._mode = config.mode;
        }
        if (config.shape) {
            this._shape = config.shape;
        }
        if (config.refreshMode) {
            this._refreshMode = config.refreshMode;
        }
        if (config.timeSlicingMode) {
            this._timeSlicingMode = config.timeSlicingMode;
        }
        if (typeof config.resolution === 'number') {
            const validResolutions = [16, 32, 64, 128, 256, 512, 1024, 2048];
            this._resolution = validResolutions.includes(config.resolution) ? config.resolution : 256;
        }
        if (config.clearFlags) {
            this._clearFlags = config.clearFlags;
        }
        if (config.backgroundColor) {
            this._backgroundColor = toVec3(config.backgroundColor, Vec3.from(DEFAULT_BACKGROUND_COLOR));
        }
        if (typeof config.intensity === 'number') {
            this._intensity = Math.max(0, config.intensity);
        }
        if (typeof config.blendDistance === 'number') {
            this._blendDistance = Math.max(0, config.blendDistance);
        }
        if (typeof config.boxProjection === 'boolean') {
            this._boxProjection = config.boxProjection;
        }
        if (config.boxSize) {
            this._boxSize = toVec3(config.boxSize, Vec3.from(DEFAULT_BOX_SIZE));
        }
        if (config.boxOffset) {
            this._boxOffset = toVec3(config.boxOffset);
        }
        if (typeof config.nearClip === 'number') {
            this._nearClip = Math.max(0.001, config.nearClip);
        }
        if (typeof config.farClip === 'number') {
            this._farClip = Math.max(this._nearClip + 0.001, config.farClip);
        }
        if (typeof config.shadowDistance === 'number') {
            this._shadowDistance = Math.max(0, config.shadowDistance);
        }
        if (typeof config.cullingMask === 'number') {
            this._cullingMask = config.cullingMask >>> 0;
        }
        if (typeof config.importance === 'number') {
            this._importance = config.importance;
        }
        if (typeof config.hdr === 'boolean') {
            this._hdr = config.hdr;
        }
        if (config.customTextureId !== undefined) {
            this._customTextureId = config.customTextureId;
        }
    }
}
