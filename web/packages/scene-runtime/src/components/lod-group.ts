import { Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import type { Mutable } from '@axrone/utility';

export interface LODLevelConfig {
    readonly screenRelativeTransitionHeight: number;
    readonly fadeTransitionWidth?: number;
    readonly renderers: readonly string[];
}

export interface LODGroupConfig {
    readonly localReferencePoint?: Vec3 | readonly [number, number, number];
    readonly size?: number;
    readonly fadeMode?: 'none' | 'cross-fade' | 'speed-tree';
    readonly animateCrossFading?: boolean;
    readonly enabled?: boolean;
    readonly lodLevels?: readonly LODLevelConfig[];
}

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

export interface LODLevel {
    readonly screenRelativeTransitionHeight: number;
    readonly fadeTransitionWidth: number;
    readonly renderers: string[];
}

/**
 * LODGroup component manages level-of-detail switching for renderers.
 * It automatically switches between different detail levels based on
 * the object's screen size, improving rendering performance.
 *
 * @example
 * ```ts
 * const lod = new LODGroup({
 *     size: 2,
 *     lodLevels: [
 *         { screenRelativeTransitionHeight: 0.6, renderers: ['high-detail'] },
 *         { screenRelativeTransitionHeight: 0.3, renderers: ['medium-detail'] },
 *         { screenRelativeTransitionHeight: 0.1, renderers: ['low-detail'] },
 *     ],
 * });
 * actor.addComponent(LODGroup, lod);
 * ```
 */
@script({
    scriptName: 'LODGroup',
    priority: 200,
    executeInEditMode: true,
    singleton: false,
})
export class LODGroup extends Component {
    private _localReferencePoint: Vec3;
    private _size: number;
    private _fadeMode: 'none' | 'cross-fade' | 'speed-tree';
    private _animateCrossFading: boolean;
    private _lodEnabled: boolean;
    private _lodLevels: LODLevel[];
    private _currentLODIndex: number = -1;
    private _forcedLODIndex: number | null = null;
    private _lastScreenHeight: number = 0;

    constructor(config: LODGroupConfig = {}) {
        super();
        this._localReferencePoint = Vec3.ZERO.clone();
        this._size = 1;
        this._fadeMode = 'none';
        this._animateCrossFading = true;
        this._lodEnabled = true;
        this._lodLevels = [];
        this._applyConfig(config);
    }

    get localReferencePoint(): Vec3 {
        return this._localReferencePoint;
    }

    set localReferencePoint(value: Vec3 | readonly [number, number, number]) {
        this._localReferencePoint = toVec3(value);
    }

    get size(): number {
        return this._size;
    }

    set size(value: number) {
        this._size = Math.max(0.001, value);
    }

    get fadeMode(): 'none' | 'cross-fade' | 'speed-tree' {
        return this._fadeMode;
    }

    set fadeMode(value: 'none' | 'cross-fade' | 'speed-tree') {
        this._fadeMode = value;
    }

    get animateCrossFading(): boolean {
        return this._animateCrossFading;
    }

    set animateCrossFading(value: boolean) {
        this._animateCrossFading = value;
    }

    get lodEnabled(): boolean {
        return this._lodEnabled;
    }

    set lodEnabled(value: boolean) {
        this._lodEnabled = value;
    }

    get lodCount(): number {
        return this._lodLevels.length;
    }

    get currentLODIndex(): number {
        return this._currentLODIndex;
    }

    get forcedLODIndex(): number | null {
        return this._forcedLODIndex;
    }

    get lastScreenHeight(): number {
        return this._lastScreenHeight;
    }

    /**
     * Gets the LOD level configuration at the specified index.
     */
    getLODLevel(index: number): LODLevel | null {
        return this._lodLevels[index] ?? null;
    }

    /**
     * Gets all LOD levels.
     */
    getLODLevels(): readonly LODLevel[] {
        return this._lodLevels;
    }

    /**
     * Sets all LOD levels at once.
     */
    setLODLevels(levels: readonly LODLevelConfig[]): void {
        this._lodLevels = levels
            .map((level) => ({
                screenRelativeTransitionHeight: Math.max(0, Math.min(1, level.screenRelativeTransitionHeight)),
                fadeTransitionWidth: Math.max(0, level.fadeTransitionWidth ?? 0),
                renderers: [...level.renderers],
            }))
            .sort((a, b) => b.screenRelativeTransitionHeight - a.screenRelativeTransitionHeight);
        this._clearDanglingForcedLOD();
    }

    /**
     * Adds a new LOD level.
     */
    addLODLevel(level: LODLevelConfig): void {
        this._lodLevels.push({
            screenRelativeTransitionHeight: Math.max(0, Math.min(1, level.screenRelativeTransitionHeight)),
            fadeTransitionWidth: Math.max(0, level.fadeTransitionWidth ?? 0),
            renderers: [...level.renderers],
        });
        this._lodLevels.sort((a, b) => b.screenRelativeTransitionHeight - a.screenRelativeTransitionHeight);
        // Re-sorting reshuffles indices, so a pinned index may now address
        // a different level — drop the override back to automatic selection.
        this._forcedLODIndex = null;
    }

    /**
     * Removes the LOD level at the specified index.
     */
    removeLODLevel(index: number): void {
        if (index >= 0 && index < this._lodLevels.length) {
            this._lodLevels.splice(index, 1);
            this._clearDanglingForcedLOD();
        }
    }

    private _clearDanglingForcedLOD(): void {
        if (this._forcedLODIndex !== null && this._forcedLODIndex >= this._lodLevels.length) {
            this._forcedLODIndex = null;
        }
    }

    /**
     * Recalculates the LOD group bounds based on the reference point and size.
     */
    recalculateBounds(): void {
        // In a full implementation, this would calculate bounds from child renderers
        // For now, we use the manually set size and reference point
    }

    /**
     * Forces a specific LOD level, bypassing automatic selection.
     * Pass -1 to return to automatic selection.
     */
    forceLOD(index: number): void {
        if (index === -1) {
            this._forcedLODIndex = null;
            return;
        }
        if (index < 0 || index >= this._lodLevels.length) {
            return;
        }
        this._forcedLODIndex = index;
        this._currentLODIndex = index;
    }

    /**
     * Evaluates which LOD level should be active based on screen height.
     * @param screenRelativeHeight The object's height relative to screen height (0-1)
     * @returns The index of the LOD level that should be active
     */
    evaluateLOD(screenRelativeHeight: number): number {
        this._lastScreenHeight = screenRelativeHeight;

        if (!this._lodEnabled || this._lodLevels.length === 0) {
            return -1;
        }

        if (this._forcedLODIndex !== null) {
            this._currentLODIndex = this._forcedLODIndex;
            return this._forcedLODIndex;
        }

        for (let i = 0; i < this._lodLevels.length; i++) {
            const level = this._lodLevels[i];
            if (level && screenRelativeHeight >= level.screenRelativeTransitionHeight) {
                this._currentLODIndex = i;
                return i;
            }
        }

        // If below all thresholds, use the last (lowest detail) LOD
        this._currentLODIndex = this._lodLevels.length - 1;
        return this._currentLODIndex;
    }

    /**
     * Gets the renderers that should be visible for the current LOD level.
     */
    getActiveRenderers(): readonly string[] {
        if (this._currentLODIndex < 0 || this._currentLODIndex >= this._lodLevels.length) {
            return [];
        }

        return this._lodLevels[this._currentLODIndex]?.renderers ?? [];
    }

    /**
     * Calculates the cross-fade blend factor between current and next LOD.
     * @returns Blend factor from 0 (current LOD) to 1 (next LOD)
     */
    getCrossFadeBlend(): number {
        if (this._fadeMode === 'none' || this._currentLODIndex < 0) {
            return 0;
        }

        const currentLevel = this._lodLevels[this._currentLODIndex];
        const nextLevel = this._lodLevels[this._currentLODIndex + 1];

        if (!currentLevel || !nextLevel || currentLevel.fadeTransitionWidth <= 0) {
            return 0;
        }

        const fadeStart = currentLevel.screenRelativeTransitionHeight;
        const fadeEnd = fadeStart - currentLevel.fadeTransitionWidth;
        const fadeRange = fadeStart - fadeEnd;

        if (fadeRange <= 0) {
            return 0;
        }

        const t = (fadeStart - this._lastScreenHeight) / fadeRange;
        return Math.max(0, Math.min(1, t));
    }

    /**
     * Gets the world-space reference point for LOD calculations.
     */
    getWorldReferencePoint(): Vec3 {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return this._localReferencePoint.clone();
        }

        const worldPos = transform.worldPosition;
        return Vec3.add(worldPos, this._localReferencePoint);
    }

    override serialize(): Record<string, unknown> {
        return {
            localReferencePoint: [this._localReferencePoint.x, this._localReferencePoint.y, this._localReferencePoint.z],
            size: this._size,
            fadeMode: this._fadeMode,
            animateCrossFading: this._animateCrossFading,
            enabled: this._lodEnabled,
            lodLevels: this._lodLevels.map((level) => ({
                screenRelativeTransitionHeight: level.screenRelativeTransitionHeight,
                fadeTransitionWidth: level.fadeTransitionWidth,
                renderers: [...level.renderers],
            })),
        };
    }

    override deserialize(data: Record<string, any>): void {
        type MutableLODConfig = Mutable<LODGroupConfig>;
        const patch: MutableLODConfig = {};

        if (Array.isArray(data.localReferencePoint) && data.localReferencePoint.length === 3) {
            patch.localReferencePoint = data.localReferencePoint;
        }
        if (typeof data.size === 'number') {
            patch.size = data.size;
        }
        if (typeof data.fadeMode === 'string') {
            patch.fadeMode = data.fadeMode;
        }
        if (typeof data.animateCrossFading === 'boolean') {
            patch.animateCrossFading = data.animateCrossFading;
        }
        if (typeof data.enabled === 'boolean') {
            patch.enabled = data.enabled;
        }
        if (Array.isArray(data.lodLevels)) {
            patch.lodLevels = data.lodLevels;
        }

        this._applyConfig(patch);
    }

    private _applyConfig(config: LODGroupConfig): void {
        if (config.localReferencePoint) {
            this._localReferencePoint = toVec3(config.localReferencePoint);
        }
        if (typeof config.size === 'number') {
            this._size = Math.max(0.001, config.size);
        }
        if (config.fadeMode) {
            this._fadeMode = config.fadeMode;
        }
        if (typeof config.animateCrossFading === 'boolean') {
            this._animateCrossFading = config.animateCrossFading;
        }
        if (typeof config.enabled === 'boolean') {
            this._lodEnabled = config.enabled;
        }
        if (config.lodLevels) {
            this.setLODLevels(config.lodLevels);
        }
    }
}
