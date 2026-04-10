export interface WorldMetrics {
    readonly entityCount: number;
    readonly archetypeCount: number;
    readonly queryCount: number;
    readonly eventCount: number;
    readonly memoryUsage: number;
    readonly lastUpdateTime: number;
}

export interface WorldMetricsSnapshot {
    readonly entityCount: number;
    readonly archetypeCount: number;
    readonly actorCount: number;
    readonly freeEntityCount: number;
    readonly componentTypes: readonly string[];
}

export interface WorldDebugInfoSnapshot extends WorldMetricsSnapshot {
    readonly state: string;
    readonly config: object;
    readonly nextEntityId: number;
    readonly archetypes: readonly {
        readonly id: string;
        readonly signature: readonly string[];
        readonly entityCount: number;
        readonly mask: string;
    }[];
}

export class WorldMetricsService {
    private readonly _creationTime = performance.now();
    private _lastUpdateTime = 0;
    private _queryCount = 0;
    private _eventCount = 0;

    constructor(private readonly _enabled: boolean) {}

    markMutation(): void {
        if (!this._enabled) {
            return;
        }

        this._lastUpdateTime = performance.now();
    }

    recordQuery(): void {
        if (!this._enabled) {
            return;
        }

        this._queryCount += 1;
        this._lastUpdateTime = performance.now();
    }

    recordEvent(): void {
        if (!this._enabled) {
            return;
        }

        this._eventCount += 1;
    }

    getMetrics(snapshot: WorldMetricsSnapshot): Readonly<WorldMetrics> | null {
        if (!this._enabled) {
            return null;
        }

        return {
            entityCount: snapshot.entityCount,
            archetypeCount: snapshot.archetypeCount,
            queryCount: this._queryCount,
            eventCount: this._eventCount,
            memoryUsage: this._estimateMemoryUsage(snapshot),
            lastUpdateTime: this._lastUpdateTime,
        };
    }

    getDebugInfo(snapshot: WorldDebugInfoSnapshot): Record<string, unknown> {
        return {
            state: snapshot.state,
            creationTime: this._creationTime,
            lastUpdateTime: this._lastUpdateTime,
            config: snapshot.config,
            entityCount: snapshot.entityCount,
            archetypeCount: snapshot.archetypeCount,
            freeEntityCount: snapshot.freeEntityCount,
            nextEntityId: snapshot.nextEntityId,
            componentTypes: snapshot.componentTypes,
            metrics: this.getMetrics(snapshot),
            archetypes: snapshot.archetypes,
            queryCache: {
                enabled: true,
                invalidated: false,
            },
        };
    }

    private _estimateMemoryUsage(snapshot: WorldMetricsSnapshot): number {
        let totalSize = 0;

        totalSize += 1000;
        totalSize += snapshot.entityCount * 50;
        totalSize += snapshot.actorCount * 100;
        totalSize += snapshot.freeEntityCount * 10;
        totalSize += snapshot.archetypeCount * 500;
        totalSize += snapshot.componentTypes.length * 20;
        totalSize += 200;
        totalSize += 300;

        return totalSize;
    }
}
