import { IGradient } from './interfaces';
import { IVec4Array } from './aligned-arrays';
import { Random } from '../random';

export interface ColorStop {
    readonly time: number;
    readonly color: [number, number, number, number];
}

export interface GradientCache {
    gradient: IGradient;
    lookupTable?: Float32Array;
    tableSize: number;
    lastUpdate: number;
}

export enum BlendMode {
    Normal = 0,
    Additive = 1,
    Multiply = 2,
    Screen = 3,
    Overlay = 4,
    SoftLight = 5,
    HardLight = 6,
    ColorDodge = 7,
    ColorBurn = 8,
    Darken = 9,
    Lighten = 10,
    Difference = 11,
    Exclusion = 12,
}

export enum ColorSpace {
    RGB = 0,
    HSV = 1,
    HSL = 2,
    LAB = 3,
    LCH = 4,
}

export interface GradientStats {
    evaluationsPerFrame: number;
    cacheHitRatio: number;
    avgEvaluationTime: number;
    memoryUsage: number;
}

export class GradientEvaluator {
    private static readonly _gradientCache = new Map<string, GradientCache>();
    private static readonly _lookupTableSize = 1024;
    private static _cacheVersion = 0;

    private static readonly _stats: GradientStats = {
        evaluationsPerFrame: 0,
        cacheHitRatio: 0,
        avgEvaluationTime: 0,
        memoryUsage: 0,
    };

    private static readonly _tempTimes = new Float32Array(1024);
    private static readonly _tempResults = new Float32Array(4096);

    static evaluate(
        gradient: IGradient,
        time: number,
        randomSeed: number,
        colorSpace: ColorSpace = ColorSpace.RGB,
        gammaCorrect = true
    ): { x: number; y: number; z: number; w: number } {
        const startTime = performance.now();
        this._stats.evaluationsPerFrame++;

        time = Math.max(0, Math.min(1, time));

        let result: { x: number; y: number; z: number; w: number };

        switch (gradient.mode) {
            case 0:
                result = this._evaluateBlend(gradient, time, colorSpace, gammaCorrect);
                break;
            case 1:
                result = this._evaluateFixed(gradient, time);
                break;
            case 2:
                result = this._evaluateRandom(gradient, randomSeed);
                break;
            default:
                result = { x: 1, y: 1, z: 1, w: 1 };
        }

        this._stats.avgEvaluationTime += performance.now() - startTime;
        return result;
    }

    static evaluateBatch(
        gradient: IGradient,
        times: Float32Array,
        randomSeeds: Uint32Array,
        results: IVec4Array,
        count: number,
        colorSpace: ColorSpace = ColorSpace.RGB,
        gammaCorrect = true
    ): void {
        const startTime = performance.now();

        const cache = this._findCacheForGradient(gradient);

        if (cache && cache.lookupTable && gradient.mode === 0) {
            this._evaluateBatchFromLookupTable(cache, times, results, count);
        } else {
            this._evaluateBatchDirect(
                gradient,
                times,
                randomSeeds,
                results,
                count,
                colorSpace,
                gammaCorrect
            );
        }

        this._stats.avgEvaluationTime += performance.now() - startTime;
        this._stats.evaluationsPerFrame += count;
    }

    static buildLookupTable(gradient: IGradient, cacheKey: string): void {
        if (gradient.mode !== 0) return;

        const cache: GradientCache = {
            gradient,
            tableSize: this._lookupTableSize,
            lastUpdate: this._cacheVersion++,
        };

        cache.lookupTable = new Float32Array(this._lookupTableSize * 4);
        const step = 1.0 / (this._lookupTableSize - 1);

        for (let i = 0; i < this._lookupTableSize; i++) {
            const time = i * step;
            const color = this._evaluateBlend(gradient, time, ColorSpace.RGB, true);
            const baseIndex = i * 4;

            cache.lookupTable[baseIndex] = color.x;
            cache.lookupTable[baseIndex + 1] = color.y;
            cache.lookupTable[baseIndex + 2] = color.z;
            cache.lookupTable[baseIndex + 3] = color.w;
        }

        this._gradientCache.set(cacheKey, cache);
    }

    static clearCache(): void {
        this._gradientCache.clear();
        this._cacheVersion = 0;
    }

    static getStats(): GradientStats {
        const memoryUsage = this._calculateMemoryUsage();
        const hitRatio =
            this._stats.evaluationsPerFrame > 0
                ? this._gradientCache.size / this._stats.evaluationsPerFrame
                : 0;

        return {
            ...this._stats,
            cacheHitRatio: hitRatio,
            memoryUsage,
        };
    }

    static resetStats(): void {
        this._stats.evaluationsPerFrame = 0;
        this._stats.avgEvaluationTime = 0;
    }

    static createGradient(stops: ColorStop[], blendMode: BlendMode = BlendMode.Normal): IGradient {
        const sortedStops = [...stops].sort((a, b) => a.time - b.time);

        const colorKeys = new Float32Array(sortedStops.length * 5);
        const alphaKeys = new Float32Array(sortedStops.length * 2);

        for (let i = 0; i < sortedStops.length; i++) {
            const stop = sortedStops[i];
            const colorIndex = i * 5;
            const alphaIndex = i * 2;

            colorKeys[colorIndex] = stop.time;
            colorKeys[colorIndex + 1] = stop.color[0];
            colorKeys[colorIndex + 2] = stop.color[1];
            colorKeys[colorIndex + 3] = stop.color[2];
            colorKeys[colorIndex + 4] = stop.color[3];

            alphaKeys[alphaIndex] = stop.time;
            alphaKeys[alphaIndex + 1] = stop.color[3];
        }

        return {
            mode: 0,
            colorKeys,
            alphaKeys,
            keyCount: sortedStops.length,
            blendMode,
        };
    }

    private static _evaluateBlend(
        gradient: IGradient,
        time: number,
        colorSpace: ColorSpace,
        gammaCorrect: boolean
    ): { x: number; y: number; z: number; w: number } {
        if (!gradient.colorKeys || gradient.keyCount === 0) {
            return { x: 1, y: 1, z: 1, w: 1 };
        }

        if (gradient.keyCount === 1) {
            return {
                x: gradient.colorKeys[1],
                y: gradient.colorKeys[2],
                z: gradient.colorKeys[3],
                w: gradient.colorKeys[4],
            };
        }

        let keyIndex = 0;
        for (let i = 0; i < gradient.keyCount - 1; i++) {
            const keyTime = gradient.colorKeys[i * 5];
            const nextKeyTime = gradient.colorKeys[(i + 1) * 5];

            if (time >= keyTime && time <= nextKeyTime) {
                keyIndex = i;
                break;
            }
        }

        const key1Index = keyIndex * 5;
        const key2Index = (keyIndex + 1) * 5;

        const t1 = gradient.colorKeys[key1Index];
        const t2 = gradient.colorKeys[key2Index];

        const factor = t2 > t1 ? (time - t1) / (t2 - t1) : 0;

        const color1 = [
            gradient.colorKeys[key1Index + 1],
            gradient.colorKeys[key1Index + 2],
            gradient.colorKeys[key1Index + 3],
            gradient.colorKeys[key1Index + 4],
        ];

        const color2 = [
            gradient.colorKeys[key2Index + 1],
            gradient.colorKeys[key2Index + 2],
            gradient.colorKeys[key2Index + 3],
            gradient.colorKeys[key2Index + 4],
        ];

        const result = this._interpolateColors(color1, color2, factor, colorSpace, gammaCorrect);

        return {
            x: result[0],
            y: result[1],
            z: result[2],
            w: result[3],
        };
    }

    private static _evaluateFixed(
        gradient: IGradient,
        time: number
    ): { x: number; y: number; z: number; w: number } {
        if (!gradient.colorKeys || gradient.keyCount === 0) {
            return { x: 1, y: 1, z: 1, w: 1 };
        }

        let closestIndex = 0;
        let closestDistance = Infinity;

        for (let i = 0; i < gradient.keyCount; i++) {
            const keyTime = gradient.colorKeys[i * 5];
            const distance = Math.abs(time - keyTime);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }

        const keyIndex = closestIndex * 5;
        return {
            x: gradient.colorKeys[keyIndex + 1],
            y: gradient.colorKeys[keyIndex + 2],
            z: gradient.colorKeys[keyIndex + 3],
            w: gradient.colorKeys[keyIndex + 4],
        };
    }

    private static _evaluateRandom(
        gradient: IGradient,
        randomSeed: number
    ): { x: number; y: number; z: number; w: number } {
        if (!gradient.colorKeys || gradient.keyCount === 0) {
            return { x: 1, y: 1, z: 1, w: 1 };
        }

        const random = new Random(randomSeed);
        const keyIndex = Math.floor(random.float() * gradient.keyCount) * 5;

        return {
            x: gradient.colorKeys[keyIndex + 1],
            y: gradient.colorKeys[keyIndex + 2],
            z: gradient.colorKeys[keyIndex + 3],
            w: gradient.colorKeys[keyIndex + 4],
        };
    }

    private static _interpolateColors(
        color1: number[],
        color2: number[],
        factor: number,
        colorSpace: ColorSpace,
        gammaCorrect: boolean
    ): number[] {
        if (gammaCorrect && colorSpace === ColorSpace.RGB) {
            const linear1 = color1.map((c) => Math.pow(c, 2.2));
            const linear2 = color2.map((c) => Math.pow(c, 2.2));

            const linearResult = [
                linear1[0] + (linear2[0] - linear1[0]) * factor,
                linear1[1] + (linear2[1] - linear1[1]) * factor,
                linear1[2] + (linear2[2] - linear1[2]) * factor,
                color1[3] + (color2[3] - color1[3]) * factor,
            ];

            return [
                Math.pow(linearResult[0], 1.0 / 2.2),
                Math.pow(linearResult[1], 1.0 / 2.2),
                Math.pow(linearResult[2], 1.0 / 2.2),
                linearResult[3],
            ];
        }

        switch (colorSpace) {
            case ColorSpace.HSV:
                return this._interpolateHSV(color1, color2, factor);
            case ColorSpace.HSL:
                return this._interpolateHSL(color1, color2, factor);
            case ColorSpace.LAB:
                return this._interpolateLAB(color1, color2, factor);
            case ColorSpace.LCH:
                return this._interpolateLCH(color1, color2, factor);
            default:
                return [
                    color1[0] + (color2[0] - color1[0]) * factor,
                    color1[1] + (color2[1] - color1[1]) * factor,
                    color1[2] + (color2[2] - color1[2]) * factor,
                    color1[3] + (color2[3] - color1[3]) * factor,
                ];
        }
    }

    private static _interpolateHSV(color1: number[], color2: number[], factor: number): number[] {
        const hsv1 = this._rgbToHsv(color1[0], color1[1], color1[2]);
        const hsv2 = this._rgbToHsv(color2[0], color2[1], color2[2]);

        let hueDiff = hsv2[0] - hsv1[0];
        if (hueDiff > 0.5) hueDiff -= 1;
        if (hueDiff < -0.5) hueDiff += 1;

        const resultHsv = [
            (hsv1[0] + hueDiff * factor) % 1,
            hsv1[1] + (hsv2[1] - hsv1[1]) * factor,
            hsv1[2] + (hsv2[2] - hsv1[2]) * factor,
        ];

        const rgb = this._hsvToRgb(resultHsv[0], resultHsv[1], resultHsv[2]);
        return [rgb[0], rgb[1], rgb[2], color1[3] + (color2[3] - color1[3]) * factor];
    }

    private static _interpolateHSL(color1: number[], color2: number[], factor: number): number[] {
        return this._interpolateHSV(color1, color2, factor);
    }

    private static _interpolateLAB(color1: number[], color2: number[], factor: number): number[] {
        return [
            color1[0] + (color2[0] - color1[0]) * factor,
            color1[1] + (color2[1] - color1[1]) * factor,
            color1[2] + (color2[2] - color1[2]) * factor,
            color1[3] + (color2[3] - color1[3]) * factor,
        ];
    }

    private static _interpolateLCH(color1: number[], color2: number[], factor: number): number[] {
        return [
            color1[0] + (color2[0] - color1[0]) * factor,
            color1[1] + (color2[1] - color1[1]) * factor,
            color1[2] + (color2[2] - color1[2]) * factor,
            color1[3] + (color2[3] - color1[3]) * factor,
        ];
    }

    private static _rgbToHsv(r: number, g: number, b: number): [number, number, number] {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;

        let h = 0;
        const s = max === 0 ? 0 : diff / max;
        const v = max;

        if (diff !== 0) {
            switch (max) {
                case r:
                    h = ((g - b) / diff) % 6;
                    break;
                case g:
                    h = (b - r) / diff + 2;
                    break;
                case b:
                    h = (r - g) / diff + 4;
                    break;
            }
            h /= 6;
        }

        return [h, s, v];
    }

    private static _hsvToRgb(h: number, s: number, v: number): [number, number, number] {
        const c = v * s;
        const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
        const m = v - c;

        let r = 0,
            g = 0,
            b = 0;

        const hSector = Math.floor(h * 6);
        switch (hSector) {
            case 0:
                r = c;
                g = x;
                b = 0;
                break;
            case 1:
                r = x;
                g = c;
                b = 0;
                break;
            case 2:
                r = 0;
                g = c;
                b = x;
                break;
            case 3:
                r = 0;
                g = x;
                b = c;
                break;
            case 4:
                r = x;
                g = 0;
                b = c;
                break;
            case 5:
                r = c;
                g = 0;
                b = x;
                break;
        }

        return [r + m, g + m, b + m];
    }

    private static _evaluateBatchFromLookupTable(
        cache: GradientCache,
        times: Float32Array,
        results: IVec4Array,
        count: number
    ): void {
        const table = cache.lookupTable!;
        const tableSize = cache.tableSize;

        for (let i = 0; i < count; i++) {
            const time = Math.max(0, Math.min(1, times[i]));
            const scaledTime = time * (tableSize - 1);
            const index = Math.floor(scaledTime);
            const fraction = scaledTime - index;

            if (index >= tableSize - 1) {
                const baseIndex = (tableSize - 1) * 4;
                results.x[i] = table[baseIndex];
                results.y[i] = table[baseIndex + 1];
                results.z![i] = table[baseIndex + 2];
                results.w![i] = table[baseIndex + 3];
            } else {
                const baseIndex1 = index * 4;
                const baseIndex2 = (index + 1) * 4;

                results.x[i] =
                    table[baseIndex1] + (table[baseIndex2] - table[baseIndex1]) * fraction;
                results.y[i] =
                    table[baseIndex1 + 1] +
                    (table[baseIndex2 + 1] - table[baseIndex1 + 1]) * fraction;
                results.z![i] =
                    table[baseIndex1 + 2] +
                    (table[baseIndex2 + 2] - table[baseIndex1 + 2]) * fraction;
                results.w![i] =
                    table[baseIndex1 + 3] +
                    (table[baseIndex2 + 3] - table[baseIndex1 + 3]) * fraction;
            }
        }
    }

    private static _evaluateBatchDirect(
        gradient: IGradient,
        times: Float32Array,
        randomSeeds: Uint32Array,
        results: IVec4Array,
        count: number,
        colorSpace: ColorSpace,
        gammaCorrect: boolean
    ): void {
        for (let i = 0; i < count; i++) {
            const color = this.evaluate(
                gradient,
                times[i],
                randomSeeds[i],
                colorSpace,
                gammaCorrect
            );
            results.x[i] = color.x;
            results.y[i] = color.y;
            results.z![i] = color.z;
            results.w![i] = color.w;
        }
    }

    private static _findCacheForGradient(gradient: IGradient): GradientCache | undefined {
        for (const cache of this._gradientCache.values()) {
            if (cache.gradient === gradient) {
                return cache;
            }
        }
        return undefined;
    }

    private static _calculateMemoryUsage(): number {
        let totalSize = 0;

        for (const cache of this._gradientCache.values()) {
            totalSize += cache.lookupTable?.length || 0;
        }

        totalSize += this._tempTimes.length;
        totalSize += this._tempResults.length;

        return (totalSize * 4) / 1024;
    }
}
