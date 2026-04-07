import { Mat4 } from '@axrone/numeric';
import { IMaterialInstance } from '../shader/interfaces';

export interface IBatchable {
    readonly id: string;
    readonly worldMatrix: Mat4;
    readonly material: IMaterialInstance;
    readonly visible: boolean;
    readonly castShadows: boolean;
    readonly receiveShadows: boolean;
}

export interface IBatchGroup {
    readonly id: string;
    readonly material: IMaterialInstance;
    readonly instances: readonly IBatchable[];
    readonly maxInstances: number;
    readonly isDynamic: boolean;
}

export interface IBatchRenderer {
    readonly maxBatchSize: number;
    readonly activeGroups: number;
    readonly totalInstances: number;

    addInstance(instance: IBatchable): boolean;
    removeInstance(instanceId: string): boolean;
    updateInstance(instanceId: string): void;
    render(viewMatrix: Mat4, projectionMatrix: Mat4): void;
    flush(): void;
    dispose(): void;
}

export interface IBatchManager {
    createRenderer(maxBatchSize?: number): IBatchRenderer;
    getBestRenderer(material: IMaterialInstance): IBatchRenderer | null;
    optimizeBatches(): void;
    getStats(): BatchStats;
    dispose(): void;
}

export interface BatchStats {
    readonly totalRenderers: number;
    readonly totalBatches: number;
    readonly totalInstances: number;
    readonly drawCalls: number;
    readonly instancesPerBatch: number;
    readonly memoryUsage: number;
}

export interface BatchConfiguration {
    readonly maxBatchSize?: number;
    readonly maxRenderers?: number;
    readonly enableDynamicBatching?: boolean;
    readonly enableInstancing?: boolean;
    readonly sortByMaterial?: boolean;
    readonly sortByDepth?: boolean;
}
