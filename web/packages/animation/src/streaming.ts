import { AnimationClip } from './clip';
import type { AnimationControllerClipActivity } from './types';

export type AnimationClipStreamingChunkStatus = 'idle' | 'requested' | 'loaded' | 'failed';
export type AnimationClipStreamingRequestReason = 'active' | 'preload';

export interface AnimationClipStreamingRequest {
    readonly clipId: string;
    readonly chunkId: string;
    readonly uri: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly reason: AnimationClipStreamingRequestReason;
    readonly priority: number;
    readonly weight: number;
    readonly mimeType?: string;
    readonly byteOffset?: number;
    readonly byteLength?: number;
}

export interface AnimationClipStreamingChunkSnapshot {
    readonly clipId: string;
    readonly chunkId: string;
    readonly uri: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly status: AnimationClipStreamingChunkStatus;
    readonly active: boolean;
    readonly withinPreloadWindow: boolean;
    readonly weight: number;
    readonly requestCount: number;
    readonly lastRequestReason?: AnimationClipStreamingRequestReason;
    readonly error?: string;
    readonly mimeType?: string;
    readonly byteOffset?: number;
    readonly byteLength?: number;
}

export interface AnimationClipStreamingStateSnapshot {
    readonly clipId: string;
    readonly enabled: boolean;
    readonly mode: 'resident' | 'streamed';
    readonly ready: boolean;
    readonly activeWeight: number;
    readonly preloadWindow: number;
    readonly priority: number;
    readonly activeChunkIds: readonly string[];
    readonly requestedChunkIds: readonly string[];
    readonly loadedChunkIds: readonly string[];
    readonly failedChunkIds: readonly string[];
    readonly pendingRequests: readonly AnimationClipStreamingRequest[];
    readonly chunks: readonly AnimationClipStreamingChunkSnapshot[];
}

export interface AnimationStreamingSnapshot {
    readonly ready: boolean;
    readonly pendingRequests: readonly AnimationClipStreamingRequest[];
    readonly clips: readonly AnimationClipStreamingStateSnapshot[];
}

interface AnimationResolvedStreamingChunk {
    readonly id: string;
    readonly uri: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly mimeType?: string;
    readonly byteOffset?: number;
    readonly byteLength?: number;
}

interface AnimationStreamingChunkState {
    readonly chunk: AnimationResolvedStreamingChunk;
    status: AnimationClipStreamingChunkStatus;
    active: boolean;
    withinPreloadWindow: boolean;
    weight: number;
    requestCount: number;
    lastRequestReason?: AnimationClipStreamingRequestReason;
    error?: string;
}

interface AnimationClipStreamingRecord {
    readonly clip: AnimationClip;
    readonly mode: 'resident' | 'streamed';
    readonly preloadWindow: number;
    readonly priority: number;
    readonly chunks: readonly AnimationResolvedStreamingChunk[];
    readonly chunkStates: Map<string, AnimationStreamingChunkState>;
}

const EMPTY_SNAPSHOT: AnimationStreamingSnapshot = Object.freeze({
    ready: true,
    pendingRequests: Object.freeze([]),
    clips: Object.freeze([]),
});

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

const toChunkId = (clipId: string, chunkId: string | undefined, index: number): string =>
    typeof chunkId === 'string' && chunkId.length > 0 ? chunkId : `${clipId}:chunk:${index}`;

const normalizeTime = (time: number, duration: number, loop: boolean): number => {
    if (!Number.isFinite(time) || duration <= 0) {
        return 0;
    }
    if (!loop) {
        return clamp(time, 0, duration);
    }
    const wrapped = time % duration;
    return wrapped < 0 ? wrapped + duration : wrapped;
};

const resolveWindowRanges = (
    time: number,
    preloadWindow: number,
    duration: number,
    loop: boolean
): readonly (readonly [number, number])[] => {
    if (duration <= 0) {
        return Object.freeze([[0, 0] as const]);
    }
    const start = normalizeTime(time, duration, loop);
    if (preloadWindow <= 0) {
        return Object.freeze([[start, start] as const]);
    }
    if (!loop) {
        return Object.freeze([[start, clamp(start + preloadWindow, 0, duration)] as const]);
    }
    const end = start + preloadWindow;
    if (end <= duration) {
        return Object.freeze([[start, end] as const]);
    }
    return Object.freeze([
        [start, duration] as const,
        [0, end % duration] as const,
    ]);
};

const chunkContainsTime = (
    chunk: AnimationResolvedStreamingChunk,
    time: number,
    duration: number
): boolean => {
    if (duration <= 0) {
        return false;
    }
    if (time === duration) {
        return chunk.startTime <= duration && chunk.endTime >= duration;
    }
    return time >= chunk.startTime && time < chunk.endTime;
};

const chunkIntersectsRanges = (
    chunk: AnimationResolvedStreamingChunk,
    ranges: readonly (readonly [number, number])[]
): boolean => {
    for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index]!;
        if (range[0] === range[1]) {
            if (chunk.startTime <= range[0] && chunk.endTime >= range[1]) {
                return true;
            }
            continue;
        }
        if (chunk.startTime < range[1] && chunk.endTime > range[0]) {
            return true;
        }
    }
    return false;
};

const buildVirtualStreamingChunks = (clip: AnimationClip): readonly AnimationResolvedStreamingChunk[] => {
    const chunkDuration = clip.streaming?.chunkDuration;
    const sourceUri = clip.streaming?.sourceUri;
    if (!sourceUri || !chunkDuration || !Number.isFinite(chunkDuration) || chunkDuration <= 0 || clip.duration <= 0) {
        return Object.freeze([]);
    }

    const chunks: AnimationResolvedStreamingChunk[] = [];
    const count = Math.max(1, Math.ceil(clip.duration / chunkDuration));
    for (let index = 0; index < count; index += 1) {
        const startTime = Math.min(clip.duration, index * chunkDuration);
        const endTime = index === count - 1 ? clip.duration : Math.min(clip.duration, startTime + chunkDuration);
        chunks.push(
            Object.freeze({
                id: `${clip.id}:virtual:${index}`,
                uri: sourceUri,
                startTime,
                endTime,
            })
        );
    }
    return Object.freeze(chunks);
};

const buildStreamingRecord = (clip: AnimationClip): AnimationClipStreamingRecord | null => {
    const streaming = clip.streaming;
    if (!streaming || streaming.mode !== 'streamed') {
        return null;
    }

    const chunks = streaming.catalog?.chunks.length
        ? Object.freeze(
              streaming.catalog.chunks.map((chunk, index) =>
                  Object.freeze({
                      id: toChunkId(clip.id, chunk.id, index),
                      uri: chunk.uri,
                      startTime: chunk.startTime,
                      endTime: chunk.endTime,
                      ...(typeof chunk.mimeType === 'string' ? { mimeType: chunk.mimeType } : {}),
                      ...(typeof chunk.byteOffset === 'number' ? { byteOffset: chunk.byteOffset } : {}),
                      ...(typeof chunk.byteLength === 'number' ? { byteLength: chunk.byteLength } : {}),
                  })
              )
          )
        : buildVirtualStreamingChunks(clip);

    if (chunks.length === 0) {
        return null;
    }

    return {
        clip,
        mode: 'streamed',
        preloadWindow:
            typeof streaming.preloadWindow === 'number' && Number.isFinite(streaming.preloadWindow)
                ? Math.max(0, streaming.preloadWindow)
                : 0,
        priority:
            typeof streaming.priority === 'number' && Number.isFinite(streaming.priority)
                ? Math.trunc(streaming.priority)
                : 0,
        chunks,
        chunkStates: new Map(
            chunks.map((chunk) => [
                chunk.id,
                {
                    chunk,
                    status: 'idle' as AnimationClipStreamingChunkStatus,
                    active: false,
                    withinPreloadWindow: false,
                    weight: 0,
                    requestCount: 0,
                },
            ])
        ),
    };
};

const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

export class AnimationClipStreamingScheduler {
    private readonly _records = new Map<string, AnimationClipStreamingRecord>();
    private _snapshot: AnimationStreamingSnapshot = EMPTY_SNAPSHOT;

    constructor(clips: Iterable<AnimationClip> | ReadonlyMap<string, AnimationClip>) {
        const mapLike = clips as ReadonlyMap<string, AnimationClip>;
        const iterable = typeof mapLike.values === 'function' && typeof mapLike.get === 'function'
            ? mapLike.values()
            : (clips as Iterable<AnimationClip>);
        for (const clip of iterable) {
            const record = buildStreamingRecord(clip);
            if (record) {
                this._records.set(clip.id, record);
            }
        }
    }

    get snapshot(): AnimationStreamingSnapshot {
        return this._snapshot;
    }

    update(activities: readonly AnimationControllerClipActivity[]): AnimationStreamingSnapshot {
        if (this._records.size === 0) {
            this._snapshot = EMPTY_SNAPSHOT;
            return this._snapshot;
        }

        for (const record of this._records.values()) {
            for (const state of record.chunkStates.values()) {
                state.active = false;
                state.withinPreloadWindow = false;
                state.weight = 0;
            }
        }

        const pendingRequests: AnimationClipStreamingRequest[] = [];
        for (let index = 0; index < activities.length; index += 1) {
            const activity = activities[index]!;
            const record = this._records.get(activity.clipId);
            if (!record) {
                continue;
            }
            const effectiveWeight = Math.max(0, activity.layerWeight * activity.motionWeight);
            if (effectiveWeight <= 0) {
                continue;
            }
            const activeTime = normalizeTime(activity.time, record.clip.duration, activity.loop);
            const ranges = resolveWindowRanges(
                activity.time,
                record.preloadWindow,
                record.clip.duration,
                activity.loop
            );

            for (const state of record.chunkStates.values()) {
                const active = chunkContainsTime(state.chunk, activeTime, record.clip.duration);
                const withinPreloadWindow = chunkIntersectsRanges(state.chunk, ranges);
                if (!active && !withinPreloadWindow) {
                    continue;
                }
                state.active = state.active || active;
                state.withinPreloadWindow = state.withinPreloadWindow || withinPreloadWindow;
                state.weight = Math.max(state.weight, effectiveWeight);
            }
        }

        for (const record of this._records.values()) {
            for (const state of record.chunkStates.values()) {
                if ((state.active || state.withinPreloadWindow) && state.status === 'idle') {
                    state.status = 'requested';
                    state.requestCount += 1;
                    state.lastRequestReason = state.active ? 'active' : 'preload';
                    state.error = undefined;
                    pendingRequests.push(
                        Object.freeze({
                            clipId: record.clip.id,
                            chunkId: state.chunk.id,
                            uri: state.chunk.uri,
                            startTime: state.chunk.startTime,
                            endTime: state.chunk.endTime,
                            reason: state.lastRequestReason,
                            priority: record.priority,
                            weight: state.weight,
                            ...(typeof state.chunk.mimeType === 'string' ? { mimeType: state.chunk.mimeType } : {}),
                            ...(typeof state.chunk.byteOffset === 'number' ? { byteOffset: state.chunk.byteOffset } : {}),
                            ...(typeof state.chunk.byteLength === 'number' ? { byteLength: state.chunk.byteLength } : {}),
                        } satisfies AnimationClipStreamingRequest)
                    );
                }
            }
        }

        pendingRequests.sort(
            (left, right) =>
                (left.reason === right.reason ? 0 : left.reason === 'active' ? -1 : 1) ||
                right.priority - left.priority ||
                right.weight - left.weight ||
                left.startTime - right.startTime ||
                left.clipId.localeCompare(right.clipId)
        );

        const snapshots = [...this._records.values()]
            .map((record) => {
                const chunkSnapshots = [...record.chunkStates.values()]
                    .map((state) =>
                        Object.freeze({
                            clipId: record.clip.id,
                            chunkId: state.chunk.id,
                            uri: state.chunk.uri,
                            startTime: state.chunk.startTime,
                            endTime: state.chunk.endTime,
                            status: state.status,
                            active: state.active,
                            withinPreloadWindow: state.withinPreloadWindow,
                            weight: state.weight,
                            requestCount: state.requestCount,
                            ...(state.lastRequestReason ? { lastRequestReason: state.lastRequestReason } : {}),
                            ...(state.error ? { error: state.error } : {}),
                            ...(typeof state.chunk.mimeType === 'string' ? { mimeType: state.chunk.mimeType } : {}),
                            ...(typeof state.chunk.byteOffset === 'number' ? { byteOffset: state.chunk.byteOffset } : {}),
                            ...(typeof state.chunk.byteLength === 'number' ? { byteLength: state.chunk.byteLength } : {}),
                        } satisfies AnimationClipStreamingChunkSnapshot)
                    )
                    .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
                const activeChunkIds = freezeArray(
                    chunkSnapshots.filter((chunk) => chunk.active).map((chunk) => chunk.chunkId)
                );
                const requestedChunkIds = freezeArray(
                    chunkSnapshots.filter((chunk) => chunk.status === 'requested').map((chunk) => chunk.chunkId)
                );
                const loadedChunkIds = freezeArray(
                    chunkSnapshots.filter((chunk) => chunk.status === 'loaded').map((chunk) => chunk.chunkId)
                );
                const failedChunkIds = freezeArray(
                    chunkSnapshots.filter((chunk) => chunk.status === 'failed').map((chunk) => chunk.chunkId)
                );
                const activeWeight = chunkSnapshots.reduce(
                    (max, chunk) => (chunk.active ? Math.max(max, chunk.weight) : max),
                    0
                );
                const ready = activeChunkIds.length === 0 || activeChunkIds.every((chunkId) => loadedChunkIds.includes(chunkId));
                return Object.freeze({
                    clipId: record.clip.id,
                    enabled: true,
                    mode: record.mode,
                    ready,
                    activeWeight,
                    preloadWindow: record.preloadWindow,
                    priority: record.priority,
                    activeChunkIds,
                    requestedChunkIds,
                    loadedChunkIds,
                    failedChunkIds,
                    pendingRequests: freezeArray(
                        pendingRequests.filter((request) => request.clipId === record.clip.id)
                    ),
                    chunks: freezeArray(chunkSnapshots),
                } satisfies AnimationClipStreamingStateSnapshot);
            })
            .sort((left, right) => right.activeWeight - left.activeWeight || right.priority - left.priority || left.clipId.localeCompare(right.clipId));

        this._snapshot = Object.freeze({
            ready: snapshots.every((clip) => clip.ready),
            pendingRequests: freezeArray(pendingRequests),
            clips: freezeArray(snapshots),
        });
        return this._snapshot;
    }

    markChunkRequested(clipId: string, chunkIdOrUri: string): boolean {
        const state = this._resolveChunkState(clipId, chunkIdOrUri);
        if (!state) {
            return false;
        }
        state.status = 'requested';
        state.error = undefined;
        return true;
    }

    markChunkLoaded(clipId: string, chunkIdOrUri: string): boolean {
        const state = this._resolveChunkState(clipId, chunkIdOrUri);
        if (!state) {
            return false;
        }
        state.status = 'loaded';
        state.error = undefined;
        return true;
    }

    markChunkFailed(clipId: string, chunkIdOrUri: string, error?: string): boolean {
        const state = this._resolveChunkState(clipId, chunkIdOrUri);
        if (!state) {
            return false;
        }
        state.status = 'failed';
        state.error = typeof error === 'string' && error.length > 0 ? error : 'failed';
        return true;
    }

    reset(clipId?: string): void {
        const records = clipId ? [this._records.get(clipId)].filter(Boolean) : [...this._records.values()];
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index]!;
            for (const state of record.chunkStates.values()) {
                state.status = 'idle';
                state.active = false;
                state.withinPreloadWindow = false;
                state.weight = 0;
                state.requestCount = 0;
                state.lastRequestReason = undefined;
                state.error = undefined;
            }
        }
        this._snapshot = EMPTY_SNAPSHOT;
    }

    private _resolveChunkState(clipId: string, chunkIdOrUri: string): AnimationStreamingChunkState | undefined {
        const record = this._records.get(clipId);
        if (!record) {
            return undefined;
        }
        for (const state of record.chunkStates.values()) {
            if (state.chunk.id === chunkIdOrUri || state.chunk.uri === chunkIdOrUri) {
                return state;
            }
        }
        return undefined;
    }
}