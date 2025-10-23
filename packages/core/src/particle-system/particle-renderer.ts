import { IVec4Array, IVec3Array } from './aligned-arrays';
import { ParticleSOA } from './particle-soa';
import { SortMode } from './types';

export interface IRenderBatch {
    readonly startIndex: number;
    readonly count: number;
    readonly material: IMaterial;
    readonly texture: ITexture | null;
    readonly blendMode: BlendMode;
    readonly sortMode: SortMode;
    readonly priority: number;
    readonly instanceData: Float32Array;
}

export interface IMaterial {
    readonly id: string;
    readonly shader: IShader;
    readonly texture?: ITexture;
    readonly blendMode: BlendMode;
    readonly sortMode: SortMode;
    readonly priority: number;
    readonly cullMode: CullMode;
    readonly depthTest: boolean;
    readonly depthWrite: boolean;
    readonly properties: Record<string, unknown>;
}

export interface ITexture {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat;
    readonly mipLevels: number;
    readonly isAtlas: boolean;
    readonly atlasRegions?: TextureRegion[];
}

export interface IShader {
    readonly id: string;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly uniforms: Record<string, ShaderUniform>;
    readonly attributes: Record<string, ShaderAttribute>;
}

export interface TextureRegion {
    readonly name: string;
    readonly u: number;
    readonly v: number;
    readonly width: number;
    readonly height: number;
}

export interface ShaderUniform {
    readonly name: string;
    readonly type: UniformType;
    readonly location: number;
}

export interface ShaderAttribute {
    readonly name: string;
    readonly type: AttributeType;
    readonly location: number;
    readonly size: number;
}

export enum BlendMode {
    Opaque = 0,
    Additive = 1,
    Alpha = 2,
    Multiply = 3,
    Screen = 4,
    Overlay = 5,
    SoftAdditive = 6,
    PremultipliedAlpha = 7,
}

export enum CullMode {
    None = 0,
    Front = 1,
    Back = 2,
}

export enum TextureFormat {
    RGB8 = 0,
    RGBA8 = 1,
    RGB16F = 2,
    RGBA16F = 3,
    RGB32F = 4,
    RGBA32F = 5,
    Depth24 = 6,
    Depth32F = 7,
}

export enum UniformType {
    Float = 0,
    Vec2 = 1,
    Vec3 = 2,
    Vec4 = 3,
    Mat3 = 4,
    Mat4 = 5,
    Sampler2D = 6,
    SamplerCube = 7,
}

export enum AttributeType {
    Float = 0,
    Vec2 = 1,
    Vec3 = 2,
    Vec4 = 3,
    Int = 4,
    IVec2 = 5,
    IVec3 = 6,
    IVec4 = 7,
}

export interface RenderStats {
    totalParticles: number;
    renderedParticles: number;
    batchCount: number;
    drawCalls: number;
    sortTime: number;
    batchTime: number;
    renderTime: number;
    memoryUsage: number;
}

export interface RenderSettings {
    maxBatchSize: number;
    enableDepthSort: boolean;
    enableInstancing: boolean;
    enableAtlasOptimization: boolean;
    enableLOD: boolean;
    lodDistances: number[];
    cullingEnabled: boolean;
    frustumCulling: boolean;
    occlusionCulling: boolean;
}

export class ParticleSystemRenderer {
    private readonly _settings: RenderSettings;
    private readonly _renderBatches: IRenderBatch[] = [];
    private readonly _sortedIndices: Uint32Array;
    private readonly _tempIndices: Uint32Array;
    private readonly _sortKeys: Float32Array;
    private readonly _histogram: Uint32Array;

    private readonly _instancePositions: Float32Array;
    private readonly _instanceColors: Float32Array;
    private readonly _instanceSizes: Float32Array;
    private readonly _instanceRotations: Float32Array;
    private readonly _instanceUVs: Float32Array;
    private readonly _instanceCustom: Float32Array;

    private readonly _stats: RenderStats = {
        totalParticles: 0,
        renderedParticles: 0,
        batchCount: 0,
        drawCalls: 0,
        sortTime: 0,
        batchTime: 0,
        renderTime: 0,
        memoryUsage: 0,
    };

    private readonly _materialCache = new Map<string, IMaterial>();
    private readonly _batchCache = new Map<string, IRenderBatch[]>();

    private readonly _frustumPlanes: Float32Array = new Float32Array(24); // 6 planes * 4 components
    private readonly _visibilityFlags: Uint8Array;

    constructor(maxParticles: number, settings: Partial<RenderSettings> = {}) {
        this._settings = {
            maxBatchSize: 1000,
            enableDepthSort: true,
            enableInstancing: true,
            enableAtlasOptimization: true,
            enableLOD: false,
            lodDistances: [100, 500, 1000],
            cullingEnabled: true,
            frustumCulling: true,
            occlusionCulling: false,
            ...settings,
        };

        this._sortedIndices = new Uint32Array(maxParticles);
        this._tempIndices = new Uint32Array(maxParticles);
        this._sortKeys = new Float32Array(maxParticles);
        this._histogram = new Uint32Array(256);
        this._visibilityFlags = new Uint8Array(maxParticles);

        this._instancePositions = new Float32Array(maxParticles * 3);
        this._instanceColors = new Float32Array(maxParticles * 4);
        this._instanceSizes = new Float32Array(maxParticles * 3);
        this._instanceRotations = new Float32Array(maxParticles * 4); // Quaternion
        this._instanceUVs = new Float32Array(maxParticles * 4); // UV rect
        this._instanceCustom = new Float32Array(maxParticles * 8); // Custom data

        this._initializeArrays();
    }

    private _initializeArrays(): void {
        for (let i = 0; i < this._sortedIndices.length; i++) {
            this._sortedIndices[i] = i;
        }

        this._visibilityFlags.fill(1);

        for (let i = 0; i < this._instanceUVs.length; i += 4) {
            this._instanceUVs[i + 2] = 1; // width
            this._instanceUVs[i + 3] = 1; // height
        }
    }

    updateFrustum(viewProjectionMatrix: Float32Array): void {
        if (!this._settings.frustumCulling) return;

        this._extractFrustumPlanes(viewProjectionMatrix);
    }

    private _extractFrustumPlanes(matrix: Float32Array): void {
        this._frustumPlanes[0] = matrix[3] + matrix[0];
        this._frustumPlanes[1] = matrix[7] + matrix[4];
        this._frustumPlanes[2] = matrix[11] + matrix[8];
        this._frustumPlanes[3] = matrix[15] + matrix[12];

        this._frustumPlanes[4] = matrix[3] - matrix[0];
        this._frustumPlanes[5] = matrix[7] - matrix[4];
        this._frustumPlanes[6] = matrix[11] - matrix[8];
        this._frustumPlanes[7] = matrix[15] - matrix[12];

        this._frustumPlanes[8] = matrix[3] + matrix[1];
        this._frustumPlanes[9] = matrix[7] + matrix[5];
        this._frustumPlanes[10] = matrix[11] + matrix[9];
        this._frustumPlanes[11] = matrix[15] + matrix[13];

        this._frustumPlanes[12] = matrix[3] - matrix[1];
        this._frustumPlanes[13] = matrix[7] - matrix[5];
        this._frustumPlanes[14] = matrix[11] - matrix[9];
        this._frustumPlanes[15] = matrix[15] - matrix[13];

        this._frustumPlanes[16] = matrix[3] + matrix[2];
        this._frustumPlanes[17] = matrix[7] + matrix[6];
        this._frustumPlanes[18] = matrix[11] + matrix[10];
        this._frustumPlanes[19] = matrix[15] + matrix[14];

        this._frustumPlanes[20] = matrix[3] - matrix[2];
        this._frustumPlanes[21] = matrix[7] - matrix[6];
        this._frustumPlanes[22] = matrix[11] - matrix[10];
        this._frustumPlanes[23] = matrix[15] - matrix[14];

        for (let i = 0; i < 6; i++) {
            const offset = i * 4;
            const length = Math.sqrt(
                this._frustumPlanes[offset] * this._frustumPlanes[offset] +
                    this._frustumPlanes[offset + 1] * this._frustumPlanes[offset + 1] +
                    this._frustumPlanes[offset + 2] * this._frustumPlanes[offset + 2]
            );

            if (length > 0) {
                this._frustumPlanes[offset] /= length;
                this._frustumPlanes[offset + 1] /= length;
                this._frustumPlanes[offset + 2] /= length;
                this._frustumPlanes[offset + 3] /= length;
            }
        }
    }

    private _performFrustumCulling(particles: ParticleSOA): void {
        if (!this._settings.frustumCulling) {
            this._visibilityFlags.fill(1);
            return;
        }

        const positions = particles.positions;
        const sizes = particles.sizes;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            const px = positions[i * 3];
            const py = positions[i * 3 + 1];
            const pz = positions[i * 3 + 2];
            const radius = Math.max(sizes[i * 3], sizes[i * 3 + 1], sizes[i * 3 + 2]) * 0.5;

            let visible = true;

            for (let planeIndex = 0; planeIndex < 6 && visible; planeIndex++) {
                const offset = planeIndex * 4;
                const distance =
                    this._frustumPlanes[offset] * px +
                    this._frustumPlanes[offset + 1] * py +
                    this._frustumPlanes[offset + 2] * pz +
                    this._frustumPlanes[offset + 3];

                if (distance < -radius) {
                    visible = false;
                }
            }

            this._visibilityFlags[i] = visible ? 1 : 0;
        }
    }

    sortParticles(
        particles: ParticleSOA,
        sortMode: SortMode,
        cameraPosition?: { x: number; y: number; z: number }
    ): void {
        if (sortMode === SortMode.None || !this._settings.enableDepthSort) return;

        const startTime = performance.now();
        const count = particles.count;

        this._generateSortKeys(particles, sortMode, cameraPosition, count);

        this._radixSort(this._sortedIndices, this._sortKeys, count);

        this._stats.sortTime = performance.now() - startTime;
    }

    private _generateSortKeys(
        particles: ParticleSOA,
        sortMode: SortMode,
        cameraPosition: { x: number; y: number; z: number } | undefined,
        count: number
    ): void {
        const positions = particles.positions;
        const ages = particles.ages;

        for (let i = 0; i < count; i++) {
            this._sortedIndices[i] = i;

            switch (sortMode) {
                case SortMode.Distance:
                    if (cameraPosition) {
                        const dx = positions[i * 3] - cameraPosition.x;
                        const dy = positions[i * 3 + 1] - cameraPosition.y;
                        const dz = positions[i * 3 + 2] - cameraPosition.z;
                        this._sortKeys[i] = dx * dx + dy * dy + dz * dz;
                    } else {
                        this._sortKeys[i] = 0;
                    }
                    break;
                case SortMode.OldestFirst:
                    this._sortKeys[i] = ages[i];
                    break;
                case SortMode.YoungestFirst:
                    this._sortKeys[i] = -ages[i];
                    break;
                default:
                    this._sortKeys[i] = i;
            }
        }
    }

    private _radixSort(indices: Uint32Array, keys: Float32Array, count: number): void {
        const keyInts = new Uint32Array(keys.buffer, keys.byteOffset, count);
        const tempInts = new Uint32Array(count);

        let sourceIndices = indices;
        let targetIndices = this._tempIndices;

        for (let pass = 0; pass < 4; pass++) {
            this._histogram.fill(0);

            for (let i = 0; i < count; i++) {
                const key = keyInts[sourceIndices[i]];
                const byte = (key >>> (pass * 8)) & 0xff;
                this._histogram[byte]++;
            }

            let offset = 0;
            for (let i = 0; i < 256; i++) {
                const temp = this._histogram[i];
                this._histogram[i] = offset;
                offset += temp;
            }

            for (let i = 0; i < count; i++) {
                const index = sourceIndices[i];
                const key = keyInts[index];
                const byte = (key >>> (pass * 8)) & 0xff;
                targetIndices[this._histogram[byte]++] = index;
            }

            const temp = sourceIndices;
            sourceIndices = targetIndices;
            targetIndices = temp;
        }

        if (sourceIndices !== indices) {
            indices.set(sourceIndices.subarray(0, count));
        }
    }

    createRenderBatches(
        particles: ParticleSOA,
        materials: readonly IMaterial[],
        textures?: readonly ITexture[]
    ): readonly IRenderBatch[] {
        const startTime = performance.now();
        this._renderBatches.length = 0;

        this._performFrustumCulling(particles);

        const activeIndices = particles.getActiveIndices();
        let visibleCount = 0;
        for (const index of activeIndices) {
            if (this._visibilityFlags[index]) {
                visibleCount++;
            }
        }

        if (visibleCount === 0) {
            this._stats.renderedParticles = 0;
            this._stats.batchCount = 0;
            return this._renderBatches;
        }

        // Generate batches based on material and texture
        this._generateBatches(particles, materials, textures);

        // Sort batches by priority and blend mode
        this._sortBatches();

        this._stats.batchTime = performance.now() - startTime;
        this._stats.renderedParticles = visibleCount;
        this._stats.batchCount = this._renderBatches.length;

        return this._renderBatches;
    }

    /**
     * Generate render batches
     */
    private _generateBatches(
        particles: ParticleSOA,
        materials: readonly IMaterial[],
        textures?: readonly ITexture[]
    ): void {
        let currentMaterial: IMaterial | null = null;
        let currentTexture: ITexture | null = null;
        let batchStart = 0;
        let batchCount = 0;
        let instanceDataOffset = 0;

        const activeIndices = particles.getActiveIndices();

        for (let i = 0; i < activeIndices.length; i++) {
            const sortedIndex =
                this._sortedIndices[i] < activeIndices.length
                    ? activeIndices[this._sortedIndices[i]]
                    : activeIndices[i];

            if (!this._visibilityFlags[sortedIndex]) {
                continue;
            }

            // Use default material and texture since ParticleSOA doesn't have these properties
            const material = materials[0] || {
                id: 'default',
                shader: {
                    id: 'default',
                    vertexSource: '',
                    fragmentSource: '',
                    uniforms: {},
                    attributes: {},
                },
                blendMode: BlendMode.Alpha,
                sortMode: SortMode.Distance,
                priority: 0,
                cullMode: CullMode.None,
                depthTest: true,
                depthWrite: false,
                properties: {},
            };
            const texture = textures?.[0] || material.texture || null;

            // Check if we need to start a new batch
            const needNewBatch =
                currentMaterial !== material ||
                currentTexture !== texture ||
                batchCount >= this._settings.maxBatchSize;

            if (needNewBatch && batchCount > 0) {
                // Finalize current batch
                this._finalizeBatch(
                    currentMaterial!,
                    currentTexture,
                    batchStart,
                    batchCount,
                    instanceDataOffset
                );
                batchStart = i;
                batchCount = 0;
                instanceDataOffset += batchCount;
            }

            if (needNewBatch) {
                currentMaterial = material;
                currentTexture = texture;
            }

            // Add particle to instance data
            this._addParticleToInstanceData(
                particles,
                sortedIndex,
                instanceDataOffset + batchCount
            );
            batchCount++;
        }

        // Finalize last batch
        if (batchCount > 0 && currentMaterial) {
            this._finalizeBatch(
                currentMaterial,
                currentTexture,
                batchStart,
                batchCount,
                instanceDataOffset
            );
        }
    }

    /**
     * Add particle data to instance buffers
     */
    private _addParticleToInstanceData(
        particles: ParticleSOA,
        particleIndex: number,
        instanceIndex: number
    ): void {
        const posOffset = instanceIndex * 3;
        const colorOffset = instanceIndex * 4;
        const sizeOffset = instanceIndex * 3;
        const rotOffset = instanceIndex * 4;
        const uvOffset = instanceIndex * 4;
        const customOffset = instanceIndex * 8;

        // Position
        this._instancePositions[posOffset] = particles.positions[particleIndex * 3];
        this._instancePositions[posOffset + 1] = particles.positions[particleIndex * 3 + 1];
        this._instancePositions[posOffset + 2] = particles.positions[particleIndex * 3 + 2];

        // Color
        this._instanceColors[colorOffset] = particles.colors[particleIndex * 4];
        this._instanceColors[colorOffset + 1] = particles.colors[particleIndex * 4 + 1];
        this._instanceColors[colorOffset + 2] = particles.colors[particleIndex * 4 + 2];
        this._instanceColors[colorOffset + 3] = particles.colors[particleIndex * 4 + 3];

        // Size
        this._instanceSizes[sizeOffset] = particles.sizes[particleIndex * 3];
        this._instanceSizes[sizeOffset + 1] = particles.sizes[particleIndex * 3 + 1];
        this._instanceSizes[sizeOffset + 2] = particles.sizes[particleIndex * 3 + 2];

        // Rotation (convert from Euler to quaternion or use default)
        this._instanceRotations[rotOffset] = 0;
        this._instanceRotations[rotOffset + 1] = 0;
        this._instanceRotations[rotOffset + 2] = 0;
        this._instanceRotations[rotOffset + 3] = 1; // Identity quaternion

        // UV coordinates (default to full texture)
        this._instanceUVs[uvOffset] = 0;
        this._instanceUVs[uvOffset + 1] = 0;
        this._instanceUVs[uvOffset + 2] = 1;
        this._instanceUVs[uvOffset + 3] = 1;

        // Custom data
        this._instanceCustom[customOffset] = particles.customData1[particleIndex * 4];
        this._instanceCustom[customOffset + 1] = particles.customData1[particleIndex * 4 + 1];
        this._instanceCustom[customOffset + 2] = particles.customData1[particleIndex * 4 + 2];
        this._instanceCustom[customOffset + 3] = particles.customData1[particleIndex * 4 + 3];

        this._instanceCustom[customOffset + 4] = particles.customData2[particleIndex * 4];
        this._instanceCustom[customOffset + 5] = particles.customData2[particleIndex * 4 + 1];
        this._instanceCustom[customOffset + 6] = particles.customData2[particleIndex * 4 + 2];
        this._instanceCustom[customOffset + 7] = particles.customData2[particleIndex * 4 + 3];
    }

    /**
     * Finalize a render batch
     */
    private _finalizeBatch(
        material: IMaterial,
        texture: ITexture | null,
        startIndex: number,
        count: number,
        instanceDataOffset: number
    ): void {
        // Create instance data for this batch
        const instanceData = new Float32Array(count * 24); // 3+4+3+4+4+8 = 26 components per instance
        let offset = 0;

        for (let i = 0; i < count; i++) {
            const srcIndex = instanceDataOffset + i;

            // Position (3)
            instanceData[offset++] = this._instancePositions[srcIndex * 3];
            instanceData[offset++] = this._instancePositions[srcIndex * 3 + 1];
            instanceData[offset++] = this._instancePositions[srcIndex * 3 + 2];

            // Color (4)
            instanceData[offset++] = this._instanceColors[srcIndex * 4];
            instanceData[offset++] = this._instanceColors[srcIndex * 4 + 1];
            instanceData[offset++] = this._instanceColors[srcIndex * 4 + 2];
            instanceData[offset++] = this._instanceColors[srcIndex * 4 + 3];

            // Size (3)
            instanceData[offset++] = this._instanceSizes[srcIndex * 3];
            instanceData[offset++] = this._instanceSizes[srcIndex * 3 + 1];
            instanceData[offset++] = this._instanceSizes[srcIndex * 3 + 2];

            // Rotation (4)
            instanceData[offset++] = this._instanceRotations[srcIndex * 4];
            instanceData[offset++] = this._instanceRotations[srcIndex * 4 + 1];
            instanceData[offset++] = this._instanceRotations[srcIndex * 4 + 2];
            instanceData[offset++] = this._instanceRotations[srcIndex * 4 + 3];

            // UV (4)
            instanceData[offset++] = this._instanceUVs[srcIndex * 4];
            instanceData[offset++] = this._instanceUVs[srcIndex * 4 + 1];
            instanceData[offset++] = this._instanceUVs[srcIndex * 4 + 2];
            instanceData[offset++] = this._instanceUVs[srcIndex * 4 + 3];

            // Custom (6, reduced from 8 to fit in 24)
            instanceData[offset++] = this._instanceCustom[srcIndex * 8];
            instanceData[offset++] = this._instanceCustom[srcIndex * 8 + 1];
            instanceData[offset++] = this._instanceCustom[srcIndex * 8 + 2];
            instanceData[offset++] = this._instanceCustom[srcIndex * 8 + 3];
            instanceData[offset++] = this._instanceCustom[srcIndex * 8 + 4];
            instanceData[offset++] = this._instanceCustom[srcIndex * 8 + 5];
        }

        const batch: IRenderBatch = {
            startIndex,
            count,
            material,
            texture,
            blendMode: material.blendMode,
            sortMode: material.sortMode,
            priority: material.priority,
            instanceData,
        };

        this._renderBatches.push(batch);
    }

    /**
     * Sort batches by priority and blend mode
     */
    private _sortBatches(): void {
        this._renderBatches.sort((a, b) => {
            // First by priority
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }

            // Then by blend mode (opaque first, then transparent)
            const aOpaque = a.blendMode === BlendMode.Opaque ? 0 : 1;
            const bOpaque = b.blendMode === BlendMode.Opaque ? 0 : 1;
            if (aOpaque !== bOpaque) {
                return aOpaque - bOpaque;
            }

            // Finally by material ID for batching
            return a.material.id.localeCompare(b.material.id);
        });
    }

    /**
     * Get render statistics
     */
    getStats(): RenderStats {
        this._stats.memoryUsage = this._calculateMemoryUsage();
        return { ...this._stats };
    }

    /**
     * Calculate memory usage
     */
    private _calculateMemoryUsage(): number {
        let totalBytes = 0;

        // Core arrays
        totalBytes += this._sortedIndices.byteLength;
        totalBytes += this._tempIndices.byteLength;
        totalBytes += this._sortKeys.byteLength;
        totalBytes += this._histogram.byteLength;
        totalBytes += this._visibilityFlags.byteLength;

        // Instance data
        totalBytes += this._instancePositions.byteLength;
        totalBytes += this._instanceColors.byteLength;
        totalBytes += this._instanceSizes.byteLength;
        totalBytes += this._instanceRotations.byteLength;
        totalBytes += this._instanceUVs.byteLength;
        totalBytes += this._instanceCustom.byteLength;

        // Batches
        for (const batch of this._renderBatches) {
            totalBytes += batch.instanceData.byteLength;
        }

        return totalBytes / 1024; // KB
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this._stats.totalParticles = 0;
        this._stats.renderedParticles = 0;
        this._stats.batchCount = 0;
        this._stats.drawCalls = 0;
        this._stats.sortTime = 0;
        this._stats.batchTime = 0;
        this._stats.renderTime = 0;
    }

    /**
     * Update settings
     */
    updateSettings(settings: Partial<RenderSettings>): void {
        Object.assign(this._settings, settings);
    }

    /**
     * Get current settings
     */
    getSettings(): RenderSettings {
        return { ...this._settings };
    }

    /**
     * Clear all caches
     */
    clearCaches(): void {
        this._materialCache.clear();
        this._batchCache.clear();
    }
}
