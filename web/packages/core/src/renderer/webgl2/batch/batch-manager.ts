import { IBatchManager, IBatchRenderer, BatchStats, BatchConfiguration } from './interfaces';
import { IMaterialInstance } from '../shader/interfaces';
import { BatchRenderer } from './batch-renderer';

export class BatchManager implements IBatchManager {
    private readonly gl: WebGL2RenderingContext;
    private readonly config: Required<BatchConfiguration>;
    private readonly renderers = new Map<string, BatchRenderer>();
    private readonly materialRendererMap = new Map<string, string>();

    private disposed = false;
    private frameCounter = 0;

    constructor(gl: WebGL2RenderingContext, config: BatchConfiguration = {}) {
        this.gl = gl;
        this.config = {
            maxBatchSize: config.maxBatchSize ?? 1024,
            maxRenderers: config.maxRenderers ?? 16,
            enableDynamicBatching: config.enableDynamicBatching ?? true,
            enableInstancing: config.enableInstancing ?? true,
            sortByMaterial: config.sortByMaterial ?? true,
            sortByDepth: config.sortByDepth ?? false
        };
    }

    createRenderer(maxBatchSize?: number): IBatchRenderer {
        if (this.disposed) {
            throw new Error('BatchManager has been disposed');
        }

        if (this.renderers.size >= this.config.maxRenderers) {
            throw new Error(`Maximum number of renderers (${this.config.maxRenderers}) reached`);
        }

        const rendererId = `renderer_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const renderer = new BatchRenderer(this.gl, {
            ...this.config,
            maxBatchSize: maxBatchSize ?? this.config.maxBatchSize
        });

        this.renderers.set(rendererId, renderer);
        return renderer;
    }

    getBestRenderer(material: IMaterialInstance): IBatchRenderer | null {
        if (this.disposed) {
            return null;
        }

        const materialKey = this.getMaterialKey(material);

        const existingRendererId = this.materialRendererMap.get(materialKey);
        if (existingRendererId && this.renderers.has(existingRendererId)) {
            const renderer = this.renderers.get(existingRendererId)!;
            if (renderer.activeGroups < this.config.maxRenderers) {
                return renderer;
            }
        }

        let bestRenderer: BatchRenderer | null = null;
        let minLoad = Infinity;

        for (const renderer of this.renderers.values()) {
            const load = this.calculateRendererLoad(renderer);
            if (load < minLoad) {
                minLoad = load;
                bestRenderer = renderer;
            }
        }

        if (!bestRenderer && this.renderers.size < this.config.maxRenderers) {
            bestRenderer = this.createRenderer() as BatchRenderer;
        }

        if (bestRenderer) {
            const rendererId = this.getRendererKey(bestRenderer);
            if (rendererId) {
                this.materialRendererMap.set(materialKey, rendererId);
            }
        }

        return bestRenderer;
    }

    optimizeBatches(): void {
        if (this.disposed) {
            return;
        }

        this.frameCounter++;

        if (this.frameCounter % 60 === 0) {
            this.performOptimization();
        }
    }

    getStats(): BatchStats {
        if (this.disposed) {
            return {
                totalRenderers: 0,
                totalBatches: 0,
                totalInstances: 0,
                drawCalls: 0,
                instancesPerBatch: 0,
                memoryUsage: 0
            };
        }

        let totalBatches = 0;
        let totalInstances = 0;
        let totalDrawCalls = 0;

        for (const renderer of this.renderers.values()) {
            totalBatches += renderer.activeGroups;
            totalInstances += renderer.totalInstances;

            const frameStats = renderer.getFrameStats();
            totalDrawCalls += frameStats.drawCalls;
        }

        return {
            totalRenderers: this.renderers.size,
            totalBatches,
            totalInstances,
            drawCalls: totalDrawCalls,
            instancesPerBatch: totalBatches > 0 ? totalInstances / totalBatches : 0,
            memoryUsage: this.calculateMemoryUsage()
        };
    }

    dispose(): void {
        if (this.disposed) return;

        for (const renderer of this.renderers.values()) {
            renderer.dispose();
        }

        this.renderers.clear();
        this.materialRendererMap.clear();
        this.disposed = true;
    }

    private performOptimization(): void {

        const emptyRenderers: string[] = [];

        for (const [id, renderer] of this.renderers) {
            if (renderer.totalInstances === 0) {
                emptyRenderers.push(id);
            }
        }

        for (const id of emptyRenderers) {
            const renderer = this.renderers.get(id);
            if (renderer) {
                renderer.dispose();
                this.renderers.delete(id);
            }
        }

        for (const [materialKey, rendererId] of this.materialRendererMap) {
            if (!this.renderers.has(rendererId)) {
                this.materialRendererMap.delete(materialKey);
            }
        }

        this.rebalanceRenderers();
    }

    private rebalanceRenderers(): void {

        const rendererLoads = new Map<string, number>();

        for (const [id, renderer] of this.renderers) {
            rendererLoads.set(id, this.calculateRendererLoad(renderer));
        }

        const avgLoad = Array.from(rendererLoads.values()).reduce((a, b) => a + b, 0) / rendererLoads.size;
        const threshold = avgLoad * 1.5;

        for (const [id, load] of rendererLoads) {
            if (load > threshold) {

                console.debug(`Renderer ${id} is overloaded (load: ${load}, threshold: ${threshold})`);
            }
        }
    }

    private calculateRendererLoad(renderer: BatchRenderer): number {

        const groupWeight = 0.3;
        const instanceWeight = 0.7;

        return (renderer.activeGroups * groupWeight) + (renderer.totalInstances * instanceWeight);
    }

    private calculateMemoryUsage(): number {

        let totalMemory = 0;

        for (const renderer of this.renderers.values()) {

            const estimatedMemoryPerGroup = this.config.maxBatchSize * (16 + 4 + 4) * 4; 
            totalMemory += renderer.activeGroups * estimatedMemoryPerGroup;
        }

        return totalMemory;
    }

    private getMaterialKey(material: IMaterialInstance): string {
        const shader = material.shader.shader.name;
        const blendMode = material.getProperty('blendMode') as string || 'opaque';
        const cullMode = material.getProperty('cullMode') as string || 'back';

        return `${shader}_${blendMode}_${cullMode}`;
    }

    private getRendererKey(renderer: BatchRenderer): string | null {
        for (const [id, r] of this.renderers) {
            if (r === renderer) {
                return id;
            }
        }
        return null;
    }
}
