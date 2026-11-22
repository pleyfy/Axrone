import type { ManualScheduler } from '../../../../tests/shared/test-harness';

/**
 * Shared performance-test helpers for scene-3d suites.
 *
 * Single source of truth: readHeapBytes / runFrames / hasMemoryApi /
 * linearSlope were previously copy-pasted across
 * script-performance-regression, script-performance-game-scripts and
 * webgl-resource-leak-detection (P1-9 deduplication).
 */

// ─── Memory measurement ─────────────────────────────────────────────────────

/**
 * Read heap usage from the best available source.
 * Returns null when no memory API is reachable (e.g. some CI envs).
 */
export function readHeapBytes(): number | null {
    // Chromium / browser
    const perfMemory = (performance as unknown as Record<string, unknown>).memory as
        | Record<string, number>
        | undefined;
    if (perfMemory && typeof perfMemory.usedJSHeapSize === 'number') {
        return perfMemory.usedJSHeapSize;
    }
    // Node.js
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
        return process.memoryUsage().heapUsed;
    }
    return null;
}

/**
 * Returns true when a memory measurement API is available.
 */
export function hasMemoryApi(): boolean {
    return readHeapBytes() !== null;
}

/**
 * Best-effort forced GC. Active when the runtime exposes `globalThis.gc`
 * (Node with --expose-gc). Call before measurement loops so garbage left
 * over from setup does not trigger a collection inside the timed region.
 */
export function forceGcIfAvailable(): void {
    const maybeGc = (globalThis as { gc?: () => void }).gc;
    if (typeof maybeGc === 'function') {
        maybeGc();
    }
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

/**
 * Run `count` scheduler frames starting at `startMs`, incrementing by `stepMs`.
 */
export function runFrames(
    scheduler: ManualScheduler,
    count: number,
    startMs = 0,
    stepMs = 16,
): void {
    for (let i = 0; i < count; i++) {
        scheduler.flush(startMs + i * stepMs);
    }
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/**
 * Linear regression slope of a sample series.
 * Returns bytes-per-index growth rate; a positive slope indicates growth.
 */
export function linearSlope(samples: number[]): number {
    const n = samples.length;
    if (n < 2) return 0;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += samples[i]!;
        sumXY += i * samples[i]!;
        sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Median of a numeric array — robust against GC/scheduler spikes that
 * poison mean-based frame-time assertions.
 */
export function median(samples: number[]): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2
        : sorted[mid]!;
}

// ─── Source-pattern validation (mandatory extraction) ───────────────────────

/**
 * Matches any `new` expression: `new Foo(...)`, `new ns.Foo(...)`.
 */
export const ANY_ALLOCATION_PATTERN = /\bnew\s+[\w$][\w$.]*/g;

/**
 * Matches `new Vec3(...)` / `new Quat(...)` in BOTH source form and
 * esbuild-transpiled form (`new __vite_ssr_import_0__.Vec3(...)`).
 * The naive `\bnew\s+Vec3\b` silently misses the transpiled shape.
 */
export const VECTOR_ALLOCATION_PATTERN = /\bnew\s+(?:[\w$.]*\.)?(?:Vec3|Quat)\b/g;

/**
 * Extract a class method body from `Class.toString()` source.
 *
 * Unlike lazy regexes (`/method...\{[\s\S]*?\n\s{4}\}/`) this:
 *  - anchors on the method DEFINITION line, so call sites (`this.foo(...)`)
 *    are never matched,
 *  - brace-counts to the true closing brace instead of guessing indentation,
 *  - THROWS when the method is not found, so pattern assertions can never
 *    pass vacuously (the old `if (match) { ... }` guards silently skipped
 *    validation whenever the regex missed).
 *
 * Limitation: string/template/comment content is skipped during brace
 * counting; regex literals containing braces are not.
 */
export function extractMethodBody(classSource: string, methodName: string): string {
    const definitionPattern = new RegExp(
        `(?:^|\\n)[ \\t]*(?:(?:get|set|async|static|private|public|protected)\\s+)*` +
            `${methodName}\\s*\\([^)]*\\)\\s*\\{`,
    );
    const match = definitionPattern.exec(classSource);
    if (!match) {
        throw new Error(
            `extractMethodBody: method "${methodName}" not found in class source. ` +
                'The validation target was likely renamed — update the test instead of skipping it.',
        );
    }

    let i = match.index + match[0].length;
    const len = classSource.length;
    let depth = 1;
    while (i < len && depth > 0) {
        const ch = classSource[i];
        if (ch === '/' && classSource[i + 1] === '/') {
            i = classSource.indexOf('\n', i);
            if (i < 0) break;
            continue;
        }
        if (ch === '/' && classSource[i + 1] === '*') {
            i = classSource.indexOf('*/', i);
            if (i < 0) break;
            i += 2;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i += 1;
            while (i < len && classSource[i] !== quote) {
                if (classSource[i] === '\\') i += 1;
                i += 1;
            }
            i += 1;
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        i += 1;
    }
    if (depth !== 0) {
        throw new Error(
            `extractMethodBody: unbalanced braces while extracting "${methodName}".`,
        );
    }
    return classSource.slice(match.index + match[0].length, i - 1);
}
