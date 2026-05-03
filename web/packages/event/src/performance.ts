interface PerformanceTimer {
    readonly now: () => number;
}

const fallbackPerformance: PerformanceTimer = {
    now: () => Date.now(),
};

const globalPerformance =
    typeof globalThis === 'object' &&
    globalThis !== null &&
    'performance' in globalThis &&
    typeof globalThis.performance?.now === 'function'
        ? (globalThis.performance as PerformanceTimer)
        : undefined;

export const performance: PerformanceTimer = globalPerformance ?? fallbackPerformance;
