import { createRandom } from '@axrone/random';
import type {
    TerrainDescriptor,
    TerrainFoliageInstance,
    TerrainFoliageLayer,
    TerrainSplatResolution,
} from '../types';
import { TERRAIN_FOLIAGE_CANDIDATES_PER_TEXEL, validateTerrainDescriptor, validateTerrainFoliageLayers } from '../types';
import type { TerrainHeightmap } from '../heightmap/terrain-heightmap';
import { sampleTerrainFoliageDensity } from './terrain-foliage-density';

/**
 * Deterministic foliage scatter: candidate points are drawn cell-by-cell from
 * the seeded engine PRNG and accepted proportionally to the painted density
 * map, so identical inputs always reproduce the identical forest. Heights are
 * sampled from the live heightmap, which means sculpting the terrain reseats
 * every instance for free on the next scatter pass.
 */

/** Hard cap keeping a single layer's batch mesh within editor budgets. */
export const TERRAIN_MAX_FOLIAGE_INSTANCES = 10_000;

export interface TerrainFoliageScatterOptions {
    readonly heightmap: TerrainHeightmap;
    readonly descriptor: TerrainDescriptor;
    readonly density: Uint8Array;
    readonly densityResolution: TerrainSplatResolution;
    readonly layer: TerrainFoliageLayer;
    readonly seed: number;
}

const sampleSlopeDeg = (
    heightmap: TerrainHeightmap,
    descriptor: TerrainDescriptor,
    u: number,
    v: number
): number => {
    // Merkezi fark ile yerel gradyan; adim bir grid hucresi.
    const step = 1 / (heightmap.resolution - 1);
    const left = heightmap.sampleHeight(u - step, v);
    const right = heightmap.sampleHeight(u + step, v);
    const near = heightmap.sampleHeight(u, v - step);
    const far = heightmap.sampleHeight(u, v + step);

    const worldStepX = 2 * step * descriptor.width;
    const worldStepZ = 2 * step * descriptor.length;
    const slopeX = ((right - left) * descriptor.maxHeight) / worldStepX;
    const slopeZ = ((far - near) * descriptor.maxHeight) / worldStepZ;
    return (Math.atan(Math.sqrt(slopeX * slopeX + slopeZ * slopeZ)) * 180) / Math.PI;
};

/**
 * Produces the deterministic instance list for one foliage layer. The result
 * is frozen; callers rebuild rather than mutate.
 */
export const scatterTerrainFoliage = ({
    heightmap,
    descriptor,
    density,
    densityResolution,
    layer,
    seed,
}: TerrainFoliageScatterOptions): readonly TerrainFoliageInstance[] => {
    validateTerrainDescriptor(descriptor);
    validateTerrainFoliageLayers([layer]);

    if (layer.density <= 0) {
        return Object.freeze([]);
    }

    const random = createRandom(seed);
    const texelCount = densityResolution * densityResolution;
    // Aday sayisi katman yogunlugundan bagimsizdir: yogunluk yalnizca kabul
    // esiginde uygulanir, boylece instance sayisi yogunlukla lineer artar ve
    // yogunluk degisimleri onceki adaylarin PRNG dizisini kaydirmaz.
    const candidateCount = Math.min(
        Math.ceil(texelCount * TERRAIN_FOLIAGE_CANDIDATES_PER_TEXEL),
        TERRAIN_MAX_FOLIAGE_INSTANCES * 4
    );

    const instances: TerrainFoliageInstance[] = [];
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
        // PRNG cekim sirasi sabit: u, v, kabul, rotasyon, olcek. Kabul
        // reddedilse bile rotasyon/olcek cekilir ki yogunluk boyamasi
        // komsu instance'larin yerini kaydirmasin.
        const u = random.float();
        const v = random.float();
        const acceptance = random.float();
        const rotationY = random.float() * Math.PI * 2;
        const scaleT = random.float();

        const localDensity =
            sampleTerrainFoliageDensity(density, densityResolution, u, v) * layer.density;
        if (localDensity <= 0 || acceptance > localDensity) {
            continue;
        }

        if (layer.maxSlopeDeg < 90) {
            const slopeDeg = sampleSlopeDeg(heightmap, descriptor, u, v);
            if (slopeDeg > layer.maxSlopeDeg) {
                continue;
            }
        }

        instances.push({
            x: (u - 0.5) * descriptor.width,
            y: heightmap.sampleHeight(u, v) * descriptor.maxHeight,
            z: (v - 0.5) * descriptor.length,
            rotationY,
            scale: layer.minScale + (layer.maxScale - layer.minScale) * scaleT,
        });

        if (instances.length >= TERRAIN_MAX_FOLIAGE_INSTANCES) {
            break;
        }
    }

    return Object.freeze(instances);
};
