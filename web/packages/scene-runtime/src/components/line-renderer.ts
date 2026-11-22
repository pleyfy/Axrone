import { Vec3, Vec4 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import type { Mutable } from '@axrone/utility';

export type LineTextureMode = 'stretch' | 'tile' | 'distribute-per-segment' | 'repeat-per-segment';
export type LineAlignment = 'view' | 'transform-z' | 'local';

export interface LineRendererGradientStop {
    readonly position: number;
    readonly color: Vec4 | readonly [number, number, number, number];
}

export interface LineRendererConfig {
    readonly positions?: readonly (Vec3 | readonly [number, number, number])[];
    readonly useWorldSpace?: boolean;
    readonly loop?: boolean;
    readonly startWidth?: number;
    readonly endWidth?: number;
    readonly widthCurve?: readonly number[];
    readonly startColor?: Vec4 | readonly [number, number, number, number];
    readonly endColor?: Vec4 | readonly [number, number, number, number];
    readonly colorGradient?: readonly LineRendererGradientStop[];
    readonly cornerVertices?: number;
    readonly endCapVertices?: number;
    readonly textureMode?: LineTextureMode;
    readonly alignment?: LineAlignment;
    readonly textureScale?: readonly [number, number];
    readonly shadowCasting?: boolean;
    readonly generateLightingData?: boolean;
    readonly numCapVertices?: number;
    readonly numCornerVertices?: number;
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

const toVec4 = (
    value?: Vec4 | readonly [number, number, number, number],
    fallback: Vec4 = Vec4.ONE
): Vec4 => {
    if (value instanceof Vec4) {
        return Vec4.from(value);
    }

    if (Array.isArray(value) && value.length === 4) {
        return Vec4.fromArray(value);
    }

    return fallback.clone();
};

/**
 * LineRenderer component draws procedural lines in 3D space.
 * Unlike TrailRenderer which follows object movement, LineRenderer
 * uses explicitly defined positions to create line geometry.
 *
 * @example
 * ```ts
 * const line = new LineRenderer({
 *     positions: [
 *         [0, 0, 0],
 *         [1, 1, 0],
 *         [2, 0, 0],
 *     ],
 *     startWidth: 0.1,
 *     endWidth: 0.1,
 *     startColor: [1, 0, 0, 1],
 *     endColor: [0, 0, 1, 1],
 * });
 * actor.addComponent(LineRenderer, line);
 * ```
 */
@script({
    scriptName: 'LineRenderer',
    priority: 140,
    executeInEditMode: true,
    singleton: false,
})
export class LineRenderer extends Component {
    private _positions: Vec3[];
    private _useWorldSpace: boolean;
    private _loop: boolean;
    private _startWidth: number;
    private _endWidth: number;
    private _widthCurve: number[];
    private _startColor: Vec4;
    private _endColor: Vec4;
    private _colorGradient: LineRendererGradientStop[];
    private _cornerVertices: number;
    private _endCapVertices: number;
    private _textureMode: LineTextureMode;
    private _alignment: LineAlignment;
    private _textureScaleX: number;
    private _textureScaleY: number;
    private _shadowCasting: boolean;
    private _generateLightingData: boolean;

    constructor(config: LineRendererConfig = {}) {
        super();
        this._positions = [];
        this._useWorldSpace = true;
        this._loop = false;
        this._startWidth = 1;
        this._endWidth = 1;
        this._widthCurve = [];
        this._startColor = Vec4.ONE.clone();
        this._endColor = Vec4.ONE.clone();
        this._colorGradient = [];
        this._cornerVertices = 0;
        this._endCapVertices = 0;
        this._textureMode = 'stretch';
        this._alignment = 'view';
        this._textureScaleX = 1;
        this._textureScaleY = 1;
        this._shadowCasting = false;
        this._generateLightingData = false;
        this._applyConfig(config);
    }

    get positionCount(): number {
        return this._positions.length;
    }

    get useWorldSpace(): boolean {
        return this._useWorldSpace;
    }

    set useWorldSpace(value: boolean) {
        this._useWorldSpace = value;
    }

    get loop(): boolean {
        return this._loop;
    }

    set loop(value: boolean) {
        this._loop = value;
    }

    get startWidth(): number {
        return this._startWidth;
    }

    set startWidth(value: number) {
        this._startWidth = Math.max(0, value);
    }

    get endWidth(): number {
        return this._endWidth;
    }

    set endWidth(value: number) {
        this._endWidth = Math.max(0, value);
    }

    get widthCurve(): readonly number[] {
        return this._widthCurve;
    }

    set widthCurve(value: readonly number[]) {
        this._widthCurve = [...value];
    }

    get startColor(): Vec4 {
        return this._startColor;
    }

    set startColor(value: Vec4 | readonly [number, number, number, number]) {
        this._startColor = toVec4(value);
    }

    get endColor(): Vec4 {
        return this._endColor;
    }

    set endColor(value: Vec4 | readonly [number, number, number, number]) {
        this._endColor = toVec4(value);
    }

    get colorGradient(): readonly LineRendererGradientStop[] {
        return this._colorGradient;
    }

    set colorGradient(value: readonly LineRendererGradientStop[]) {
        this._colorGradient = value.map((stop) => ({
            position: Math.max(0, Math.min(1, stop.position)),
            color: toVec4(stop.color),
        }));
    }

    get cornerVertices(): number {
        return this._cornerVertices;
    }

    set cornerVertices(value: number) {
        this._cornerVertices = Math.max(0, Math.floor(value));
    }

    get endCapVertices(): number {
        return this._endCapVertices;
    }

    set endCapVertices(value: number) {
        this._endCapVertices = Math.max(0, Math.floor(value));
    }

    get textureMode(): LineTextureMode {
        return this._textureMode;
    }

    set textureMode(value: LineTextureMode) {
        this._textureMode = value;
    }

    get alignment(): LineAlignment {
        return this._alignment;
    }

    set alignment(value: LineAlignment) {
        this._alignment = value;
    }

    get textureScale(): readonly [number, number] {
        return [this._textureScaleX, this._textureScaleY];
    }

    set textureScale(value: readonly [number, number]) {
        this._textureScaleX = value[0];
        this._textureScaleY = value[1];
    }

    get shadowCasting(): boolean {
        return this._shadowCasting;
    }

    set shadowCasting(value: boolean) {
        this._shadowCasting = value;
    }

    get generateLightingData(): boolean {
        return this._generateLightingData;
    }

    set generateLightingData(value: boolean) {
        this._generateLightingData = value;
    }

    /**
     * Gets the position at the specified index.
     */
    getPosition(index: number): Vec3 | null {
        return this._positions[index] ?? null;
    }

    /**
     * Sets the position at the specified index.
     */
    setPosition(index: number, position: Vec3 | readonly [number, number, number]): void {
        if (index >= 0 && index < this._positions.length) {
            this._positions[index] = toVec3(position);
        }
    }

    /**
     * Gets all positions as an array. Live internal storage — do not
     * mutate the array or its elements; use setPosition/setPositions.
     */
    getPositions(): readonly Vec3[] {
        return this._positions;
    }

    /**
     * Sets all positions at once.
     */
    setPositions(positions: readonly (Vec3 | readonly [number, number, number])[]): void {
        this._positions = positions.map((pos) => toVec3(pos));
    }

    /**
     * Adds a position to the end of the line.
     */
    addPosition(position: Vec3 | readonly [number, number, number]): void {
        this._positions.push(toVec3(position));
    }

    /**
     * Removes all positions.
     */
    clearPositions(): void {
        this._positions.length = 0;
    }

    /**
     * Evaluates the width at a normalized position (0-1) along the line.
     */
    evaluateWidth(t: number): number {
        const clampedT = Math.max(0, Math.min(1, t));

        if (this._widthCurve.length >= 2) {
            const curveT = clampedT * (this._widthCurve.length - 1);
            const index = Math.floor(curveT);
            const fraction = curveT - index;
            const a = this._widthCurve[index] ?? 1;
            const b = this._widthCurve[Math.min(index + 1, this._widthCurve.length - 1)] ?? 1;
            const curveValue = a + (b - a) * fraction;
            return this._startWidth + (this._endWidth - this._startWidth) * curveValue;
        }

        return this._startWidth + (this._endWidth - this._startWidth) * clampedT;
    }

    /**
     * Evaluates the color at a normalized position (0-1) along the line.
     */
    evaluateColor(t: number): Vec4 {
        const clampedT = Math.max(0, Math.min(1, t));

        if (this._colorGradient.length > 0) {
            return this._evaluateGradientColor(clampedT);
        }

        return new Vec4(
            this._startColor.x + (this._endColor.x - this._startColor.x) * clampedT,
            this._startColor.y + (this._endColor.y - this._startColor.y) * clampedT,
            this._startColor.z + (this._endColor.z - this._startColor.z) * clampedT,
            this._startColor.w + (this._endColor.w - this._startColor.w) * clampedT
        );
    }

    /**
     * Returns the total length of the line.
     */
    getLength(): number {
        if (this._positions.length < 2) {
            return 0;
        }

        let length = 0;
        for (let i = 0; i < this._positions.length - 1; i++) {
            length += Vec3.distance(this._positions[i]!, this._positions[i + 1]!);
        }

        if (this._loop && this._positions.length > 2) {
            length += Vec3.distance(
                this._positions[this._positions.length - 1]!,
                this._positions[0]!
            );
        }

        return length;
    }

    override serialize(): Record<string, unknown> {
        return {
            positions: this._positions.map((pos) => [pos.x, pos.y, pos.z]),
            useWorldSpace: this._useWorldSpace,
            loop: this._loop,
            startWidth: this._startWidth,
            endWidth: this._endWidth,
            widthCurve: [...this._widthCurve],
            startColor: [this._startColor.x, this._startColor.y, this._startColor.z, this._startColor.w],
            endColor: [this._endColor.x, this._endColor.y, this._endColor.z, this._endColor.w],
            colorGradient: this._colorGradient.map((stop) => {
                const color = toVec4(stop.color);
                return {
                    position: stop.position,
                    color: [color.x, color.y, color.z, color.w],
                };
            }),
            cornerVertices: this._cornerVertices,
            endCapVertices: this._endCapVertices,
            textureMode: this._textureMode,
            alignment: this._alignment,
            textureScale: [this._textureScaleX, this._textureScaleY],
            shadowCasting: this._shadowCasting,
            generateLightingData: this._generateLightingData,
        };
    }

    override deserialize(data: Record<string, any>): void {
        type MutableLineConfig = Mutable<LineRendererConfig>;
        const patch: MutableLineConfig = {};

        if (Array.isArray(data.positions)) {
            patch.positions = data.positions;
        }
        if (typeof data.useWorldSpace === 'boolean') {
            patch.useWorldSpace = data.useWorldSpace;
        }
        if (typeof data.loop === 'boolean') {
            patch.loop = data.loop;
        }
        if (typeof data.startWidth === 'number') {
            patch.startWidth = data.startWidth;
        }
        if (typeof data.endWidth === 'number') {
            patch.endWidth = data.endWidth;
        }
        if (Array.isArray(data.widthCurve)) {
            patch.widthCurve = data.widthCurve;
        }
        if (Array.isArray(data.startColor) && data.startColor.length === 4) {
            patch.startColor = data.startColor;
        }
        if (Array.isArray(data.endColor) && data.endColor.length === 4) {
            patch.endColor = data.endColor;
        }
        if (Array.isArray(data.colorGradient)) {
            patch.colorGradient = data.colorGradient;
        }
        if (typeof data.cornerVertices === 'number') {
            patch.cornerVertices = data.cornerVertices;
        }
        if (typeof data.endCapVertices === 'number') {
            patch.endCapVertices = data.endCapVertices;
        }
        if (typeof data.textureMode === 'string') {
            patch.textureMode = data.textureMode;
        }
        if (typeof data.alignment === 'string') {
            patch.alignment = data.alignment;
        }
        if (Array.isArray(data.textureScale) && data.textureScale.length === 2) {
            patch.textureScale = data.textureScale;
        }
        if (typeof data.shadowCasting === 'boolean') {
            patch.shadowCasting = data.shadowCasting;
        }
        if (typeof data.generateLightingData === 'boolean') {
            patch.generateLightingData = data.generateLightingData;
        }

        this._applyConfig(patch);
    }

    private _evaluateGradientColor(t: number): Vec4 {
        if (this._colorGradient.length === 0) {
            return Vec4.ONE.clone();
        }

        if (this._colorGradient.length === 1) {
            return toVec4(this._colorGradient[0].color);
        }

        let lowerStop = this._colorGradient[0];
        let upperStop = this._colorGradient[this._colorGradient.length - 1];

        for (let i = 0; i < this._colorGradient.length - 1; i++) {
            const current = this._colorGradient[i];
            const next = this._colorGradient[i + 1];
            if (current && next && t >= current.position && t <= next.position) {
                lowerStop = current;
                upperStop = next;
                break;
            }
        }

        const range = upperStop.position - lowerStop.position;
        const fraction = range > 0 ? (t - lowerStop.position) / range : 0;

        const lowerColor = toVec4(lowerStop.color);
        const upperColor = toVec4(upperStop.color);

        return Vec4.lerpUnClamped(lowerColor, upperColor, fraction);
    }

    private _applyConfig(config: LineRendererConfig): void {
        if (config.positions) {
            this._positions = config.positions.map((pos) => toVec3(pos));
        }
        if (typeof config.useWorldSpace === 'boolean') {
            this._useWorldSpace = config.useWorldSpace;
        }
        if (typeof config.loop === 'boolean') {
            this._loop = config.loop;
        }
        if (typeof config.startWidth === 'number') {
            this._startWidth = Math.max(0, config.startWidth);
        }
        if (typeof config.endWidth === 'number') {
            this._endWidth = Math.max(0, config.endWidth);
        }
        if (config.widthCurve) {
            this._widthCurve = [...config.widthCurve];
        }
        if (config.startColor) {
            this._startColor = toVec4(config.startColor);
        }
        if (config.endColor) {
            this._endColor = toVec4(config.endColor);
        }
        if (config.colorGradient) {
            this._colorGradient = config.colorGradient.map((stop) => ({
                position: Math.max(0, Math.min(1, stop.position)),
                color: toVec4(stop.color),
            }));
        }
        if (typeof config.cornerVertices === 'number') {
            this._cornerVertices = Math.max(0, Math.floor(config.cornerVertices));
        }
        if (typeof config.endCapVertices === 'number') {
            this._endCapVertices = Math.max(0, Math.floor(config.endCapVertices));
        }
        if (config.textureMode) {
            this._textureMode = config.textureMode;
        }
        if (config.alignment) {
            this._alignment = config.alignment;
        }
        if (config.textureScale) {
            this._textureScaleX = config.textureScale[0];
            this._textureScaleY = config.textureScale[1];
        }
        if (typeof config.shadowCasting === 'boolean') {
            this._shadowCasting = config.shadowCasting;
        }
        if (typeof config.generateLightingData === 'boolean') {
            this._generateLightingData = config.generateLightingData;
        }
    }
}
