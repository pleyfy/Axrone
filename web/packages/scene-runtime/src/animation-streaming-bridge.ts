import type { AnimationClipStreamingRequest } from '@axrone/animation';
import type { Actor, Entity } from '@axrone/ecs-runtime';
import { isRecord } from '@axrone/utility';
import { Animator } from './components/animator';

export interface AnimationStreamingBridgeWorld {
    readonly on?: (event: string, handler: (data: Record<string, unknown>) => void) => () => void;
    readonly emitSync?: (event: string, data: Record<string, unknown>) => boolean;
    readonly getActor?: (entity: Entity) => Actor | undefined;
    readonly getAllActors?: () => readonly Actor[];
}

export interface AnimationStreamingRequestEvent extends AnimationClipStreamingRequest {
    readonly entity?: Entity;
    readonly actorId?: string;
}

export interface AnimationStreamingChunkResolveResult {
    readonly bytes: Uint8Array | ArrayBuffer | ArrayBufferView;
    readonly mimeType?: string;
}

export interface ResolvedAnimationStreamingChunk {
    readonly actor?: Actor;
    readonly actorId?: string;
    readonly animator: Animator;
    readonly entity: Entity;
    readonly request: AnimationStreamingRequestEvent;
    readonly bytes: Uint8Array;
    readonly mimeType?: string;
}

export interface FailedAnimationStreamingChunk {
    readonly actor?: Actor;
    readonly actorId?: string;
    readonly animator?: Animator;
    readonly entity?: Entity;
    readonly request: AnimationStreamingRequestEvent;
    readonly error: Error;
}

export interface AnimationStreamingResolveContext {
    readonly world: AnimationStreamingBridgeWorld;
    readonly actor?: Actor;
    readonly animator: Animator;
    readonly entity: Entity;
    readonly request: AnimationStreamingRequestEvent;
    readonly signal: AbortSignal;
}

export type AnimationStreamingChunkResolver = (
    request: Readonly<AnimationStreamingRequestEvent>,
    context: Readonly<AnimationStreamingResolveContext>
) =>
    | AnimationStreamingChunkResolveResult
    | Uint8Array
    | ArrayBuffer
    | ArrayBufferView
    | Promise<
          | AnimationStreamingChunkResolveResult
          | Uint8Array
          | ArrayBuffer
          | ArrayBufferView
          | undefined
      >
    | undefined;

interface AnimationStreamingFetchResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText?: string;
    readonly headers?: {
        get(name: string): string | null;
    };
    arrayBuffer(): Promise<ArrayBuffer>;
}

interface AnimationStreamingFetchInit {
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
}

type AnimationStreamingFetch = (
    input: string,
    init?: AnimationStreamingFetchInit
) => Promise<AnimationStreamingFetchResponse>;

export interface FetchAnimationStreamingResolverOptions {
    readonly fetch?: AnimationStreamingFetch;
    readonly headers?:
        | Record<string, string>
        | ((request: Readonly<AnimationStreamingRequestEvent>) => Record<string, string> | undefined);
}

export interface AnimationStreamingBridgeOptions {
    readonly resolver?: AnimationStreamingChunkResolver;
    readonly applyToAnimator?: boolean;
    readonly onChunkLoaded?: (
        chunk: Readonly<ResolvedAnimationStreamingChunk>
    ) => void | Promise<void>;
    readonly onChunkFailed?: (
        failure: Readonly<FailedAnimationStreamingChunk>
    ) => void | Promise<void>;
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isAbortError = (error: unknown): boolean =>
    error instanceof Error && error.name === 'AbortError';

const toUint8Array = (
    value: Uint8Array | ArrayBuffer | ArrayBufferView
): Uint8Array => {
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    return new Uint8Array(value.slice(0));
};

const toError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

const buildRequestKey = (request: Readonly<AnimationStreamingRequestEvent>): string =>
    `${String(request.entity ?? '')}:${request.clipId}:${request.chunkId}`;

const getGlobalFetch = (): AnimationStreamingFetch | undefined => {
    const candidate = globalThis as { fetch?: AnimationStreamingFetch };
    return typeof candidate.fetch === 'function' ? candidate.fetch.bind(globalThis) : undefined;
};

const cloneRequest = (request: AnimationStreamingRequestEvent): AnimationStreamingRequestEvent =>
    Object.freeze({
        ...(request.entity !== undefined ? { entity: request.entity } : {}),
        ...(typeof request.actorId === 'string' ? { actorId: request.actorId } : {}),
        clipId: request.clipId,
        chunkId: request.chunkId,
        uri: request.uri,
        startTime: request.startTime,
        endTime: request.endTime,
        reason: request.reason,
        priority: request.priority,
        weight: request.weight,
        ...(typeof request.mimeType === 'string' ? { mimeType: request.mimeType } : {}),
        ...(typeof request.byteOffset === 'number' ? { byteOffset: request.byteOffset } : {}),
        ...(typeof request.byteLength === 'number' ? { byteLength: request.byteLength } : {}),
    });

const parseStreamingRequestEvent = (value: unknown): AnimationStreamingRequestEvent | null => {
    if (!isRecord(value)) {
        return null;
    }
    if (
        typeof value.clipId !== 'string' ||
        value.clipId.length === 0 ||
        typeof value.chunkId !== 'string' ||
        value.chunkId.length === 0 ||
        typeof value.uri !== 'string' ||
        value.uri.length === 0 ||
        !isFiniteNumber(value.startTime) ||
        !isFiniteNumber(value.endTime) ||
        (value.reason !== 'active' && value.reason !== 'preload')
    ) {
        return null;
    }

    return cloneRequest({
        clipId: value.clipId,
        chunkId: value.chunkId,
        uri: value.uri,
        startTime: value.startTime,
        endTime: value.endTime,
        reason: value.reason,
        priority: isFiniteNumber(value.priority) ? Math.trunc(value.priority) : 0,
        weight: isFiniteNumber(value.weight) ? value.weight : 0,
        ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
        ...(isFiniteNumber(value.byteOffset) ? { byteOffset: Math.max(0, Math.trunc(value.byteOffset)) } : {}),
        ...(isFiniteNumber(value.byteLength) ? { byteLength: Math.max(0, Math.trunc(value.byteLength)) } : {}),
        ...(value.entity !== undefined ? { entity: value.entity as Entity } : {}),
        ...(typeof value.actorId === 'string' ? { actorId: value.actorId } : {}),
    });
};

const normalizeResolvedChunk = (
    value:
        | AnimationStreamingChunkResolveResult
        | Uint8Array
        | ArrayBuffer
        | ArrayBufferView,
    request: Readonly<AnimationStreamingRequestEvent>
): { readonly bytes: Uint8Array; readonly mimeType?: string } => {
    if (isRecord(value) && 'bytes' in value) {
        const bytes = (value as AnimationStreamingChunkResolveResult).bytes;
        return Object.freeze({
            bytes: toUint8Array(bytes),
            ...(typeof (value as AnimationStreamingChunkResolveResult).mimeType === 'string'
                ? { mimeType: (value as AnimationStreamingChunkResolveResult).mimeType }
                : typeof request.mimeType === 'string'
                  ? { mimeType: request.mimeType }
                  : {}),
        });
    }

    return Object.freeze({
        bytes: toUint8Array(value as Uint8Array | ArrayBuffer | ArrayBufferView),
        ...(typeof request.mimeType === 'string' ? { mimeType: request.mimeType } : {}),
    });
};

export const createFetchAnimationStreamingResolver = (
    options: FetchAnimationStreamingResolverOptions = {}
): AnimationStreamingChunkResolver => {
    const fetchImpl = options.fetch ?? getGlobalFetch();

    return async (request, context) => {
        if (!fetchImpl) {
            throw new Error('Animation streaming fetch resolver requires a fetch implementation');
        }

        const headers = {
            ...(typeof options.headers === 'function' ? options.headers(request) : options.headers),
        } as Record<string, string>;
        const hasByteRange =
            typeof request.byteOffset === 'number' &&
            Number.isFinite(request.byteOffset) &&
            request.byteOffset >= 0 &&
            typeof request.byteLength === 'number' &&
            Number.isFinite(request.byteLength) &&
            request.byteLength > 0;

        if (hasByteRange) {
            const end = request.byteOffset! + request.byteLength! - 1;
            headers.Range = `bytes=${request.byteOffset}-${end}`;
        }

        const response = await fetchImpl(request.uri, {
            headers,
            signal: context.signal,
        });

        if (!response.ok) {
            throw new Error(
                `Animation streaming fetch failed for '${request.uri}' with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
            );
        }

        let bytes = new Uint8Array(await response.arrayBuffer());
        if (hasByteRange && response.status !== 206) {
            const start = request.byteOffset!;
            const end = Math.min(bytes.byteLength, start + request.byteLength!);
            bytes = bytes.slice(start, end);
        }

        return Object.freeze({
            bytes,
            mimeType: response.headers?.get('content-type') ?? request.mimeType,
        });
    };
};

export class AnimationStreamingBridge {
    private readonly _resolver: AnimationStreamingChunkResolver;
    private _unsubscribe: (() => void) | null = null;
    private readonly _inFlight = new Map<string, AbortController>();
    private readonly _inFlightTasks = new Set<Promise<void>>();
    private readonly _idleResolvers = new Set<() => void>();
    private _disposed = false;

    constructor(
        private readonly _world: AnimationStreamingBridgeWorld,
        private readonly _options: AnimationStreamingBridgeOptions = {}
    ) {
        this._resolver = _options.resolver ?? createFetchAnimationStreamingResolver();
    }

    get inFlightRequestCount(): number {
        return this._inFlight.size;
    }

    start(): this {
        if (this._disposed) {
            throw new Error('AnimationStreamingBridge has been disposed');
        }
        if (this._unsubscribe) {
            return this;
        }
        if (typeof this._world.on !== 'function') {
            throw new Error('AnimationStreamingBridge requires a world with an on(event, handler) API');
        }

        this._unsubscribe = this._world.on('animation:streaming-request', (payload) => {
            this._queueRequest(payload);
        });
        return this;
    }

    async waitForIdle(): Promise<void> {
        if (this._inFlightTasks.size === 0) {
            return;
        }
        await new Promise<void>((resolve) => {
            this._idleResolvers.add(resolve);
        });
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._unsubscribe?.();
        this._unsubscribe = null;

        for (const controller of this._inFlight.values()) {
            controller.abort();
        }
        this._inFlight.clear();
        this._resolveIdleWaiters();
    }

    private _queueRequest(payload: unknown): void {
        const request = parseStreamingRequestEvent(payload);
        if (!request) {
            return;
        }
        const key = buildRequestKey(request);
        if (this._inFlight.has(key)) {
            return;
        }

        const controller = new AbortController();
        this._inFlight.set(key, controller);

        const task = Promise.resolve()
            .then(async () => {
                const actor = this._resolveActor(request);
                const animator = actor?.getComponent(Animator);
                const entity = actor?.entity ?? request.entity;

                if (!animator || entity === undefined) {
                    const error = new Error(
                        `Animation streaming request '${request.chunkId}' could not resolve an Animator instance`
                    );
                    await this._handleFailure(request, error, actor, animator, entity);
                    return;
                }

                try {
                    const resolved = await this._resolver(
                        request,
                        Object.freeze({
                            world: this._world,
                            actor,
                            animator,
                            entity,
                            request,
                            signal: controller.signal,
                        })
                    );

                    if (controller.signal.aborted || this._disposed) {
                        return;
                    }

                    if (!resolved) {
                        throw new Error(
                            `Animation streaming resolver returned no data for '${request.uri}'`
                        );
                    }

                    const chunk = normalizeResolvedChunk(resolved, request);
                    const payload = Object.freeze({
                        actor,
                        animator,
                        entity,
                        request,
                        bytes: chunk.bytes,
                        ...(typeof request.actorId === 'string'
                            ? { actorId: request.actorId }
                            : actor
                              ? { actorId: String(actor.id) }
                              : {}),
                        ...(typeof chunk.mimeType === 'string' ? { mimeType: chunk.mimeType } : {}),
                    } satisfies ResolvedAnimationStreamingChunk);

                    const applyToAnimator =
                        this._options.applyToAnimator ?? this._options.onChunkLoaded === undefined;
                    if (applyToAnimator) {
                        animator.applyStreamingChunkBytes(request.clipId, payload.bytes, {
                            startTime: request.startTime,
                            endTime: request.endTime,
                        });
                    }

                    await this._options.onChunkLoaded?.(payload);
                    if (controller.signal.aborted || this._disposed) {
                        return;
                    }

                    this._world.emitSync?.('animation:streaming-loaded', {
                        actorId: payload.actorId,
                        entity,
                        clipId: request.clipId,
                        chunkId: request.chunkId,
                        uri: request.uri,
                        byteLength: payload.bytes.byteLength,
                        ...(payload.mimeType ? { mimeType: payload.mimeType } : {}),
                    });
                    animator.markStreamingChunkLoaded(request.clipId, request.chunkId);
                } catch (error) {
                    if (controller.signal.aborted || isAbortError(error) || this._disposed) {
                        return;
                    }
                    await this._handleFailure(request, toError(error), actor, animator, entity);
                }
            })
            .finally(() => {
                this._inFlight.delete(key);
                this._inFlightTasks.delete(task);
                this._resolveIdleWaiters();
            });

        this._inFlightTasks.add(task);
    }

    private _resolveActor(request: Readonly<AnimationStreamingRequestEvent>): Actor | undefined {
        if (request.entity !== undefined) {
            const actor = this._world.getActor?.(request.entity);
            if (actor) {
                return actor;
            }
        }
        if (typeof request.actorId === 'string') {
            return this._world.getAllActors?.().find((actor) => String(actor.id) === request.actorId);
        }
        return undefined;
    }

    private async _handleFailure(
        request: Readonly<AnimationStreamingRequestEvent>,
        error: Error,
        actor: Actor | undefined,
        animator: Animator | undefined,
        entity: Entity | undefined
    ): Promise<void> {
        const failure = Object.freeze({
            actor,
            ...(typeof request.actorId === 'string' ? { actorId: request.actorId } : {}),
            ...(animator ? { animator } : {}),
            ...(entity !== undefined ? { entity } : {}),
            request,
            error,
        } satisfies FailedAnimationStreamingChunk);

        await this._options.onChunkFailed?.(failure);
        if (this._disposed) {
            return;
        }

        this._world.emitSync?.('animation:streaming-failed', {
            actorId: request.actorId,
            entity,
            clipId: request.clipId,
            chunkId: request.chunkId,
            uri: request.uri,
            error: error.message,
        });
        animator?.markStreamingChunkFailed(request.clipId, request.chunkId, error.message);
    }

    private _resolveIdleWaiters(): void {
        if (this._inFlightTasks.size !== 0) {
            return;
        }
        for (const resolve of this._idleResolvers) {
            resolve();
        }
        this._idleResolvers.clear();
    }
}

export const bindAnimationStreamingBridge = (
    world: AnimationStreamingBridgeWorld,
    options: AnimationStreamingBridgeOptions = {}
): AnimationStreamingBridge => new AnimationStreamingBridge(world, options).start();