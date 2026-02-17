import { Mat4 } from '@axrone/numeric';
import { PriorityQueue } from '@axrone/utility';
import { IBatchable, IBatchRenderer, BatchConfiguration } from './interfaces';
import { IMaterialInstance } from '../shader/interfaces';
import { BatchGroup } from './batch-group';

interface BatchJob {
    group: BatchGroup;
    priority: number;
    depth: number;
}

export class BatchRenderer implements IBatchRenderer {
    readonly maxBatchSize: number;

    private readonly gl: WebGL2RenderingContext;
    private readonly config: Required<BatchConfiguration>;
    private readonly batchGroups = new Map<string, BatchGroup>();
    private readonly materialGroups = new Map<string, BatchGroup[]>();
    private readonly renderQueue = new PriorityQueue<BatchJob, number>();

    private disposed = false;
    private frameStats = {
        drawCalls: 0,
        instancesRendered: 0,
        batchesProcessed: 0
    };

    constructor(gl: WebGL2RenderingContext, config: BatchConfiguration = {}) {
        this.gl = gl;
        this.maxBatchSize = config.maxBatchSize ?? 1024;

        this.config = {
            maxBatchSize: config.maxBatchSize ?? 1024,
            maxRenderers: config.maxRenderers ?? 16,
            enableDynamicBatching: config.enableDynamicBatching ?? true,
            enableInstancing: config.enableInstancing ?? true,
            sortByMaterial: config.sortByMaterial ?? true,
            sortByDepth: config.sortByDepth ?? false
        };
    }

    get activeGroups(): number {
        return this.batchGroups.size;
    }

    get totalInstances(): number {
        let total = 0;
        for (const group of this.batchGroups.values()) {
            total += group.size;
        }
        return total;
    }

    addInstance(instance: IBatchable): boolean {
        if (this.disposed || !instance.visible) {
            return false;
        }

        const materialKey = this.getMaterialKey(instance.material);
        let targetGroup = this.findCompatibleGroup(materialKey, instance);

        if (!targetGroup) {
            targetGroup = this.createBatchGroup(instance.material);
            if (!targetGroup) {
                return false;
            }
        }

        return targetGroup.addInstance(instance);
    }

    removeInstance(instanceId: string): boolean {
        if (this.disposed) {
            return false;
        }

        for (const group of this.batchGroups.values()) {
            if (group.removeInstance(instanceId)) {

                if (group.isEmpty) {
                    this.removeBatchGroup(group);
                }
                return true;
            }
        }

        return false;
    }

    updateInstance(instanceId: string): void {
        if (this.disposed) {
            return;
        }

        for (const group of this.batchGroups.values()) {
            const instance = group.instances.find(inst => inst.id === instanceId);
            if (instance) {
                group.updateInstance(instanceId);
                break;
            }
        }
    }

    render(viewMatrix: Mat4, projectionMatrix: Mat4): void {
        if (this.disposed) {
            return;
        }

        this.frameStats = { drawCalls: 0, instancesRendered: 0, batchesProcessed: 0 };

        this.buildRenderQueue(viewMatrix);

        while (!this.renderQueue.isEmpty) {
            const job = this.renderQueue.tryDequeue();
            if (!job) break;

            job.group.render(viewMatrix, projectionMatrix);

            this.frameStats.drawCalls++;
            this.frameStats.instancesRendered += job.group.size;
            this.frameStats.batchesProcessed++;
        }
    }

    flush(): void {
        if (this.disposed) {
            return;
        }

        for (const group of this.batchGroups.values()) {
            group.update();
        }
    }

    dispose(): void {
        if (this.disposed) return;

        for (const group of this.batchGroups.values()) {
            group.dispose();
        }

        this.batchGroups.clear();
        this.materialGroups.clear();
        this.renderQueue.clear();

        this.disposed = true;
    }

    getFrameStats() {
        return { ...this.frameStats };
    }

    private findCompatibleGroup(materialKey: string, instance: IBatchable): BatchGroup | null {
        const groups = this.materialGroups.get(materialKey);
        if (!groups) {
            return null;
        }

        for (const group of groups) {
            if (!group.isFull && this.isInstanceCompatible(group, instance)) {
                return group;
            }
        }

        return null;
    }

    private createBatchGroup(material: IMaterialInstance): BatchGroup | null {
        if (this.batchGroups.size >= this.config.maxRenderers) {
            return null;
        }

        const group = new BatchGroup(
            this.gl,
            material,
            this.maxBatchSize,
            this.config.enableDynamicBatching
        );

        this.batchGroups.set(group.id, group);

        const materialKey = this.getMaterialKey(material);
        if (!this.materialGroups.has(materialKey)) {
            this.materialGroups.set(materialKey, []);
        }
        this.materialGroups.get(materialKey)!.push(group);

        return group;
    }

    private removeBatchGroup(group: BatchGroup): void {
        const materialKey = this.getMaterialKey(group.material);
        const groups = this.materialGroups.get(materialKey);

        if (groups) {
            const index = groups.indexOf(group);
            if (index !== -1) {
                groups.splice(index, 1);
            }

            if (groups.length === 0) {
                this.materialGroups.delete(materialKey);
            }
        }

        this.batchGroups.delete(group.id);
        group.dispose();
    }

    private buildRenderQueue(viewMatrix: Mat4): void {
        this.renderQueue.clear();

        for (const group of this.batchGroups.values()) {
            if (group.isEmpty) continue;

            const priority = this.calculateGroupPriority(group);
            const depth = this.calculateGroupDepth(group, viewMatrix);

            this.renderQueue.enqueue({
                group,
                priority,
                depth
            }, priority);
        }
    }

    private calculateGroupPriority(group: BatchGroup): number {

        const material = group.material;
        const blendMode = material.getProperty('blendMode') as string;

        if (blendMode === 'opaque') {
            return 1000;
        } else if (blendMode === 'alpha_blend') {
            return 500;
        } else {
            return 100;
        }
    }

    private calculateGroupDepth(group: BatchGroup, viewMatrix: Mat4): number {
        if (!this.config.sortByDepth || group.isEmpty) {
            return 0;
        }

        let totalDepth = 0;
        let count = 0;

        for (const instance of group.instances) {
            if (instance.visible) {

                const worldPos = instance.worldMatrix.data.slice(12, 15); 
                const viewPos = viewMatrix.multiply(instance.worldMatrix).data.slice(12, 15);
                totalDepth += viewPos[2];
                count++;
            }
        }

        return count > 0 ? totalDepth / count : 0;
    }

    private getMaterialKey(material: IMaterialInstance): string {

        const shader = material.shader.shader.name;
        const blendMode = material.getProperty('blendMode') as string || 'opaque';
        const cullMode = material.getProperty('cullMode') as string || 'back';

        return `${shader}_${blendMode}_${cullMode}`;
    }

    private isInstanceCompatible(group: BatchGroup, instance: IBatchable): boolean {

        return group.material.shader === instance.material.shader;
    }
}
