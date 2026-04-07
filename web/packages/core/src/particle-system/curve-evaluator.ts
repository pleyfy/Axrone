import { ICurve } from './interfaces';
import { Random } from '../random';

interface CurveCache {
    curve: ICurve;
    lookupTable?: Float32Array;
    minTable?: Float32Array;
    maxTable?: Float32Array;
    tableSize: number;
    lastUpdate: number;
}

export class CurveEvaluator {
    private static readonly tempKeys = new Float32Array(1024);
    private static readonly tempTimes = new Float32Array(1024);
    private static readonly _curveCache = new Map<string, CurveCache>();
    private static readonly _lookupTableSize = 512;
    private static _cacheVersion = 0;

    static evaluate(curve: ICurve, time: number, randomSeed: number): number {
        time = Math.max(0, Math.min(1, time));

        switch (curve.mode) {
            case 0:
                return curve.constant;

            case 2:
                return this._evaluateRandom(curve, randomSeed);

            case 1:
                return this._evaluateCurve(curve, time);

            case 3:
                return this._evaluateRandomCurve(curve, time, randomSeed);

            default:
                return curve.constant;
        }
    }

    static evaluateBatch(
        curve: ICurve,
        times: Float32Array,
        randomSeeds: Uint32Array,
        results: Float32Array,
        count: number
    ): void {
        switch (curve.mode) {
            case 0:
                results.fill(curve.constant, 0, count);
                break;

            case 2:
                this._evaluateRandomBatch(curve, randomSeeds, results, count);
                break;

            case 1:
                this._evaluateCurveBatch(curve, times, results, count);
                break;

            case 3:
                this._evaluateRandomCurveBatch(curve, times, randomSeeds, results, count);
                break;

            default:
                results.fill(curve.constant, 0, count);
                break;
        }
    }

    static buildLookupTable(curve: ICurve, cacheKey: string): void {
        if (curve.mode !== 1 && curve.mode !== 3) return;

        const cache: CurveCache = {
            curve,
            tableSize: this._lookupTableSize,
            lastUpdate: this._cacheVersion++,
        };

        if (curve.mode === 1 && curve.curve) {
            cache.lookupTable = this._buildCurveLookupTable(curve.curve, curve.curveLength);
        }

        if (curve.mode === 3) {
            if (curve.curveMin) {
                cache.minTable = this._buildCurveLookupTable(curve.curveMin, curve.curveLength);
            }
            if (curve.curveMax) {
                cache.maxTable = this._buildCurveLookupTable(curve.curveMax, curve.curveLength);
            }
        }

        this._curveCache.set(cacheKey, cache);
    }

    static clearCache(): void {
        this._curveCache.clear();
        this._cacheVersion = 0;
    }

    static invalidateCache(cacheKey: string): void {
        this._curveCache.delete(cacheKey);
    }

    private static _evaluateRandom(curve: ICurve, randomSeed: number): number {
        const random = new Random(randomSeed);
        return curve.constantMin + (curve.constantMax - curve.constantMin) * random.float();
    }

    private static _evaluateCurve(curve: ICurve, time: number): number {
        if (!curve.curve) return curve.constant;

        const cache = this._findCacheForCurve(curve);
        if (cache && cache.lookupTable) {
            return this._sampleLookupTable(cache.lookupTable, time);
        }

        return this.sampleCurve(curve.curve, time, curve.curveLength);
    }

    private static _evaluateRandomCurve(curve: ICurve, time: number, randomSeed: number): number {
        const cache = this._findCacheForCurve(curve);
        const random = new Random(randomSeed);

        let min: number;
        let max: number;

        if (cache) {
            min = cache.minTable
                ? this._sampleLookupTable(cache.minTable, time)
                : curve.constantMin;
            max = cache.maxTable
                ? this._sampleLookupTable(cache.maxTable, time)
                : curve.constantMax;
        } else {
            min = curve.curveMin
                ? this.sampleCurve(curve.curveMin, time, curve.curveLength)
                : curve.constantMin;
            max = curve.curveMax
                ? this.sampleCurve(curve.curveMax, time, curve.curveLength)
                : curve.constantMax;
        }

        return min + (max - min) * random.float();
    }

    private static _evaluateRandomBatch(
        curve: ICurve,
        randomSeeds: Uint32Array,
        results: Float32Array,
        count: number
    ): void {
        const range = curve.constantMax - curve.constantMin;
        for (let i = 0; i < count; i++) {
            const random = new Random(randomSeeds[i]);
            results[i] = curve.constantMin + range * random.float();
        }
    }

    private static _evaluateCurveBatch(
        curve: ICurve,
        times: Float32Array,
        results: Float32Array,
        count: number
    ): void {
        if (!curve.curve) {
            results.fill(curve.constant, 0, count);
            return;
        }

        const cache = this._findCacheForCurve(curve);

        if (cache && cache.lookupTable) {
            for (let i = 0; i < count; i++) {
                results[i] = this._sampleLookupTable(cache.lookupTable, times[i]);
            }
        } else {
            for (let i = 0; i < count; i++) {
                results[i] = this.sampleCurve(curve.curve!, times[i], curve.curveLength);
            }
        }
    }

    private static _evaluateRandomCurveBatch(
        curve: ICurve,
        times: Float32Array,
        randomSeeds: Uint32Array,
        results: Float32Array,
        count: number
    ): void {
        const cache = this._findCacheForCurve(curve);

        for (let i = 0; i < count; i++) {
            const time = times[i];
            const random = new Random(randomSeeds[i]);

            let min: number;
            let max: number;

            if (cache) {
                min = cache.minTable
                    ? this._sampleLookupTable(cache.minTable, time)
                    : curve.constantMin;
                max = cache.maxTable
                    ? this._sampleLookupTable(cache.maxTable, time)
                    : curve.constantMax;
            } else {
                min = curve.curveMin
                    ? this.sampleCurve(curve.curveMin, time, curve.curveLength)
                    : curve.constantMin;
                max = curve.curveMax
                    ? this.sampleCurve(curve.curveMax, time, curve.curveLength)
                    : curve.constantMax;
            }

            results[i] = min + (max - min) * random.float();
        }
    }

    private static _buildCurveLookupTable(curve: Float32Array, curveLength: number): Float32Array {
        const table = new Float32Array(this._lookupTableSize);
        const step = 1.0 / (this._lookupTableSize - 1);

        for (let i = 0; i < this._lookupTableSize; i++) {
            const time = i * step;
            table[i] = this.sampleCurve(curve, time, curveLength);
        }

        return table;
    }

    private static _sampleLookupTable(table: Float32Array, time: number): number {
        time = Math.max(0, Math.min(1, time));

        const scaledTime = time * (table.length - 1);
        const index = Math.floor(scaledTime);
        const fraction = scaledTime - index;

        if (index >= table.length - 1) {
            return table[table.length - 1];
        }

        return table[index] + (table[index + 1] - table[index]) * fraction;
    }

    private static _findCacheForCurve(curve: ICurve): CurveCache | undefined {
        for (const cache of this._curveCache.values()) {
            if (cache.curve === curve) {
                return cache;
            }
        }
        return undefined;
    }

    static sampleCurve(curve: Float32Array, time: number, curveLength: number): number {
        if (!curve || curveLength === 0) return 0;

        time = Math.max(0, Math.min(1, time));

        if (curveLength === 1) {
            return curve[0];
        }

        const scaledTime = time * (curveLength - 1);
        const index = Math.floor(scaledTime);
        const fraction = scaledTime - index;

        if (index >= curveLength - 1) {
            return curve[curveLength - 1];
        }

        return curve[index] + (curve[index + 1] - curve[index]) * fraction;
    }

    static sampleCurveAdvanced(
        curve: Float32Array,
        time: number,
        curveLength: number,
        interpolationMode: 'linear' | 'step' | 'cubic' = 'linear'
    ): number {
        if (!curve || curveLength === 0) return 0;

        time = Math.max(0, Math.min(1, time));

        if (curveLength === 1) {
            return curve[0];
        }

        const scaledTime = time * (curveLength - 1);
        const index = Math.floor(scaledTime);
        const fraction = scaledTime - index;

        if (index >= curveLength - 1) {
            return curve[curveLength - 1];
        }

        switch (interpolationMode) {
            case 'step':
                return curve[index];

            case 'cubic':
                return this._cubicInterpolate(curve, index, fraction, curveLength);

            case 'linear':
            default:
                return curve[index] + (curve[index + 1] - curve[index]) * fraction;
        }
    }

    private static _cubicInterpolate(
        curve: Float32Array,
        index: number,
        fraction: number,
        curveLength: number
    ): number {
        const p0 = curve[Math.max(0, index - 1)];
        const p1 = curve[index];
        const p2 = curve[Math.min(curveLength - 1, index + 1)];
        const p3 = curve[Math.min(curveLength - 1, index + 2)];

        const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
        const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
        const a2 = -0.5 * p0 + 0.5 * p2;
        const a3 = p1;

        return a0 * fraction * fraction * fraction + a1 * fraction * fraction + a2 * fraction + a3;
    }

    static getStats(): { cacheSize: number; cacheVersion: number; lookupTableSize: number } {
        return {
            cacheSize: this._curveCache.size,
            cacheVersion: this._cacheVersion,
            lookupTableSize: this._lookupTableSize,
        };
    }
}
