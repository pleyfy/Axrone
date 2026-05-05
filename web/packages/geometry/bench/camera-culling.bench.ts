import { performance } from 'node:perf_hooks';
import { Camera3D, FrustumCuller } from '@axrone/geometry';

interface BenchItem {
    readonly id: number;
    readonly bounds: {
        readonly kind: 'sphere';
        readonly center: readonly [number, number, number];
        readonly radius: number;
    };
}

interface BenchResult {
    readonly mode: 'sync' | 'async';
    readonly durationMs: number;
    readonly visibleCount: number;
    readonly opsPerSecond: number;
}

const parseIntegerArg = (name: string, fallback: number): number => {
    const prefix = `--${name}=`;
    const raw = process.argv.find((value) => value.startsWith(prefix));
    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw.slice(prefix.length), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const itemCount = parseIntegerArg('items', 50000);
const iterations = parseIntegerArg('iterations', 8);
const asyncBatchSize = parseIntegerArg('batchSize', 1024);

const camera = Camera3D.perspective({
    id: 'bench-camera',
    projection: {
        kind: 'perspective',
        verticalFieldOfView: Math.PI / 3,
        aspectRatio: 16 / 9,
        near: 0.1,
        far: 500,
    },
    pose: {
        position: [0, 4, 16],
        target: [0, 0, 0],
    },
});

const createItems = (count: number): BenchItem[] => {
    const items: BenchItem[] = new Array(count);
    for (let index = 0; index < count; index += 1) {
        const ring = index % 2048;
        const layer = Math.floor(index / 2048);
        const angle = ring * 0.017453292519943295;
        const radius = 6 + (ring % 48) * 0.75;
        const x = Math.cos(angle) * radius;
        const y = ((layer % 9) - 4) * 1.5;
        const z = -8 - layer * 0.9 - Math.sin(angle) * radius;
        items[index] = {
            id: index,
            bounds: {
                kind: 'sphere',
                center: [x, y, z],
                radius: 0.6 + (index % 5) * 0.1,
            },
        };
    }
    return items;
};

const items = createItems(itemCount);
const culler = new FrustumCuller<BenchItem>({
    bounds: (item) => item.bounds,
    asyncBatchSize,
});

const runSync = (): BenchResult => {
    const startedAt = performance.now();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        culler.cull(items, camera.frustum);
    }
    const durationMs = performance.now() - startedAt;
    return {
        mode: 'sync',
        durationMs,
        visibleCount: culler.visible.length,
        opsPerSecond: (itemCount * iterations * 1000) / durationMs,
    };
};

const runAsync = async (): Promise<BenchResult> => {
    const startedAt = performance.now();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        await culler.cullAsync(items, camera.frustum, {
            batchSize: asyncBatchSize,
            scheduler: async () => undefined,
        });
    }
    const durationMs = performance.now() - startedAt;
    return {
        mode: 'async',
        durationMs,
        visibleCount: culler.visible.length,
        opsPerSecond: (itemCount * iterations * 1000) / durationMs,
    };
};

const printResult = (result: BenchResult): void => {
    const label = result.mode.padEnd(5, ' ');
    console.log(
        `${label} duration=${result.durationMs.toFixed(2)}ms visible=${result.visibleCount} throughput=${result.opsPerSecond.toFixed(0)} items/sec`
    );
};

const main = async (): Promise<void> => {
    console.log(
        `geometry-culling-benchmark items=${itemCount} iterations=${iterations} batchSize=${asyncBatchSize}`
    );
    const syncResult = runSync();
    const asyncResult = await runAsync();
    printResult(syncResult);
    printResult(asyncResult);
};

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});