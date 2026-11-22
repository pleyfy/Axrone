import { fmix32 } from '@axrone/hash';
import {
    ObjectPool,
    PriorityQueue,
    type PriorityQueueHandle,
} from '@axrone/memory';
import { TileCodec } from '../codec/tile-codec';
import { packGridKey } from '../codec/spatial-codec';
import type { TilemapEngine } from '../engine/tilemap-engine';
import { KEY_MAX, KEY_MIN, type PackedTileWord } from '../types/brands';
import type { LayerReference, LayerSpec } from '../types/layers';
import {
    DEFAULT_MAX_EXPANDED_NODES,
    type PathOptions,
    type PathResult,
} from './path-types';

interface PathNode {
    gridX: number;
    gridY: number;
    g: number;
    score: number;
    parent: PathNode | null;
    handle: PriorityQueueHandle | null;
    closed: boolean;
}

const createPathNode = (): PathNode => ({
    gridX: 0,
    gridY: 0,
    g: 0,
    score: 0,
    parent: null,
    handle: null,
    closed: false,
});

const resetPathNode = (node: PathNode): void => {
    node.gridX = 0;
    node.gridY = 0;
    node.g = 0;
    node.score = 0;
    node.parent = null;
    node.handle = null;
    node.closed = false;
};

const createNodePool = (): ObjectPool<PathNode> =>
    new ObjectPool<PathNode>({
        factory: createPathNode,
        resetHandler: resetPathNode,
        initialCapacity: 16,
        maxCapacity: 262_144,
        autoExpand: true,
        enableMetrics: false,
        enableInstrumentation: false,
    });

/**
 * Shared node pool: per-query pools churn thousands of wrappers and make the
 * 1k-query benchmark GC-bound. A nested query from a user predicate gets its
 * own short-lived pool instead of stealing nodes from the outer search.
 */
const sharedNodePool = createNodePool();
let sharedPoolInUse = false;

/**
 * Open-addressed node table keyed by packed `GridKey` values. A `Map` would
 * allocate per entry and sit directly in the A* hot loop; this keeps the
 * lookup in typed arrays and reuses the engine's hash mixer. Generation stamps
 * make `clear()` O(1).
 */
class PathNodeTable {
    #capacity: number;
    #mask: number;
    #keys: Uint32Array;
    #nodes: (PathNode | undefined)[];
    #stamps: Uint32Array;
    #generation = 1;
    #size = 0;

    constructor(capacity = 256) {
        this.#capacity = capacity;
        this.#mask = capacity - 1;
        this.#keys = new Uint32Array(capacity);
        this.#nodes = new Array(capacity);
        this.#stamps = new Uint32Array(capacity);
    }

    get size(): number {
        return this.#size;
    }

    clear(): void {
        this.#generation++;
        if (this.#generation > 0xfffffffe) {
            this.#stamps.fill(0);
            this.#generation = 1;
        }
        this.#size = 0;
    }

    find(key: number): PathNode | null {
        const normalized = key >>> 0;
        let slot = fmix32(normalized) & this.#mask;
        while (this.#stamps[slot] === this.#generation) {
            if (this.#keys[slot] === normalized) {
                return this.#nodes[slot]!;
            }
            slot = (slot + 1) & this.#mask;
        }
        return null;
    }

    insert(key: number, node: PathNode): void {
        if ((this.#size + 1) * 10 >= this.#capacity * 7) {
            this.#grow();
        }
        this.#insertExisting(key >>> 0, node);
    }

    forEach(visit: (node: PathNode) => void): void {
        for (let slot = 0; slot < this.#capacity; slot++) {
            if (this.#stamps[slot] === this.#generation) {
                visit(this.#nodes[slot]!);
            }
        }
    }

    #insertExisting(key: number, node: PathNode): void {
        let slot = fmix32(key) & this.#mask;
        while (this.#stamps[slot] === this.#generation) {
            slot = (slot + 1) & this.#mask;
        }
        this.#keys[slot] = key;
        this.#nodes[slot] = node;
        this.#stamps[slot] = this.#generation;
        this.#size++;
    }

    #grow(): void {
        const previousKeys = this.#keys;
        const previousNodes = this.#nodes;
        const previousStamps = this.#stamps;
        const previousCapacity = this.#capacity;
        this.#capacity *= 2;
        this.#mask = this.#capacity - 1;
        this.#keys = new Uint32Array(this.#capacity);
        this.#nodes = new Array(this.#capacity);
        this.#stamps = new Uint32Array(this.#capacity);
        this.#size = 0;
        for (let slot = 0; slot < previousCapacity; slot++) {
            if (previousStamps[slot] !== this.#generation) continue;
            this.#insertExisting(
                previousKeys[slot]!,
                previousNodes[slot]!
            );
        }
    }
}

const NEIGHBOURS_4 = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
] as const;

const NEIGHBOURS_DIAGONAL = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
] as const;

const defaultBlocked = (word: PackedTileWord): boolean =>
    TileCodec.unpackCollision(word) !== 0;

const defaultStepCost = (word: PackedTileWord): number =>
    1 + TileCodec.unpackMaterial(word);

const heuristic = (
    gridX: number,
    gridY: number,
    goalX: number,
    goalY: number,
    diagonal: boolean
): number => {
    const dx = Math.abs(goalX - gridX);
    const dy = Math.abs(goalY - gridY);
    if (!diagonal) return dx + dy;
    const minimum = Math.min(dx, dy);
    const maximum = Math.max(dx, dy);
    return maximum + (Math.SQRT2 - 1) * minimum;
};

const inBounds = (gridX: number, gridY: number): boolean =>
    gridX >= KEY_MIN &&
    gridX <= KEY_MAX &&
    gridY >= KEY_MIN &&
    gridY <= KEY_MAX;

/**
 * A* over one tilemap layer.
 *
 * The open set is a handle-based min `PriorityQueue` (the engine's indexed
 * heap) so a better route to a discovered node is a decrease-key update, not a
 * duplicate push. Nodes come from an `ObjectPool` and are keyed by packed
 * `GridKey` values in an open-addressed table.
 *
 * Blocking defaults to a non-zero collision mask and step cost to
 * `1 + material`. Diagonal steps cost `sqrt(2)` times the base cost. The
 * result never truncates a path: a too-small `out` buffer reports
 * `buffer-too-small` with the required waypoint count.
 */
export const findPath = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    options: PathOptions = {}
): PathResult => {
    if (
        !inBounds(startX, startY) ||
        !inBounds(goalX, goalY)
    ) {
        return { status: 'no-path', expanded: 0 };
    }
    const isBlocked = options.isBlocked ?? defaultBlocked;
    const stepCost = options.stepCost ?? defaultStepCost;
    if (
        isBlocked(engine.readAt(layer, startX, startY)) ||
        isBlocked(engine.readAt(layer, goalX, goalY))
    ) {
        return { status: 'no-path', expanded: 0 };
    }
    if (startX === goalX && startY === goalY) {
        const out = options.out;
        if (out !== undefined && out.length < 2) {
            return { status: 'buffer-too-small', required: 1, expanded: 0 };
        }
        const waypoints = out ?? new Int32Array(2);
        waypoints[0] = startX;
        waypoints[1] = startY;
        return {
            status: 'found',
            count: 1,
            expanded: 0,
            cost: 0,
            waypoints,
        };
    }

    const diagonal = options.allowDiagonal ?? true;
    const preventCornerCutting = options.preventCornerCutting ?? true;
    const maxExpanded = options.maxExpandedNodes ?? DEFAULT_MAX_EXPANDED_NODES;

    const useSharedPool = !sharedPoolInUse;
    const pool = useSharedPool ? sharedNodePool : createNodePool();
    if (useSharedPool) sharedPoolInUse = true;
    const table = new PathNodeTable();
    const queue = PriorityQueue.min<PathNode, number>();

    let expanded = 0;
    const releaseAll = (): void => {
        table.forEach((node) => pool.release(node));
        table.clear();
        queue.clear();
        if (!useSharedPool) pool.clear();
    };

    try {
        const start = pool.acquire();
        start.gridX = startX;
        start.gridY = startY;
        start.score = heuristic(startX, startY, goalX, goalY, diagonal);
        start.handle = queue.enqueue(start, start.score);
        table.insert(packGridKey(startX, startY), start);

        const directions = diagonal
            ? [...NEIGHBOURS_4, ...NEIGHBOURS_DIAGONAL]
            : NEIGHBOURS_4;

        while (!queue.isEmpty()) {
            const current = queue.dequeue()!;
            if (current.closed) continue;
            current.handle = null;
            current.closed = true;
            expanded++;
            if (current.gridX === goalX && current.gridY === goalY) {
                return reconstruct(
                    current,
                    expanded,
                    options.out,
                    releaseAll
                );
            }
            if (expanded >= maxExpanded) {
                return { status: 'limit', expanded };
            }

            for (const [offsetX, offsetY] of directions) {
                const nextX = current.gridX + offsetX;
                const nextY = current.gridY + offsetY;
                if (!inBounds(nextX, nextY)) continue;
                const nextWord = engine.readAt(layer, nextX, nextY);
                if (isBlocked(nextWord)) continue;
                if (
                    offsetX !== 0 &&
                    offsetY !== 0 &&
                    preventCornerCutting
                ) {
                    if (
                        isBlocked(
                            engine.readAt(
                                layer,
                                current.gridX + offsetX,
                                current.gridY
                            )
                        ) ||
                        isBlocked(
                            engine.readAt(
                                layer,
                                current.gridX,
                                current.gridY + offsetY
                            )
                        )
                    ) {
                        continue;
                    }
                }
                const step =
                    stepCost(nextWord) *
                    (offsetX !== 0 && offsetY !== 0 ? Math.SQRT2 : 1);
                const tentative = current.g + step;
                const key = packGridKey(nextX, nextY);
                const existing = table.find(key);
                if (existing === null) {
                    const node = pool.acquire();
                    node.gridX = nextX;
                    node.gridY = nextY;
                    node.g = tentative;
                    node.parent = current;
                    node.score =
                        tentative +
                        heuristic(nextX, nextY, goalX, goalY, diagonal);
                    node.handle = queue.enqueue(node, node.score);
                    table.insert(key, node);
                    continue;
                }
                if (existing.closed || tentative >= existing.g) continue;
                existing.g = tentative;
                existing.parent = current;
                existing.score =
                    tentative + heuristic(nextX, nextY, goalX, goalY, diagonal);
                if (existing.handle === null) {
                    existing.handle = queue.enqueue(
                        existing,
                        existing.score
                    );
                } else {
                    queue.update(
                        existing.handle,
                        existing,
                        existing.score
                    );
                }
            }
        }
        return { status: 'no-path', expanded };
    } finally {
        // `reconstruct` releases the pool before returning; releasing twice
        // would corrupt the pool, so guard with a table size check.
        if (table.size > 0) releaseAll();
        if (useSharedPool) sharedPoolInUse = false;
    }
};

const reconstruct = (
    goal: PathNode,
    expanded: number,
    out: Int32Array | undefined,
    releaseAll: () => void
): PathResult => {
    let count = 0;
    for (let node: PathNode | null = goal; node !== null; node = node.parent) {
        count++;
    }
    const required = count * 2;
    if (out !== undefined && out.length < required) {
        releaseAll();
        return { status: 'buffer-too-small', required, expanded };
    }
    const waypoints = out ?? new Int32Array(required);
    let index = required - 2;
    for (let node: PathNode | null = goal; node !== null; node = node.parent) {
        waypoints[index] = node.gridX;
        waypoints[index + 1] = node.gridY;
        index -= 2;
    }
    const cost = goal.g;
    releaseAll();
    return {
        status: 'found',
        count,
        expanded,
        cost,
        waypoints,
    };
};
