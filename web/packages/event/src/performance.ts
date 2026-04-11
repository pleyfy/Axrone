interface PerformanceTimer {
    readonly now: () => number;
}

class FallbackPerformanceTimer implements PerformanceTimer {
    readonly now = (): number => Date.now();
}

class PerformanceProvider {
    private static instance?: PerformanceTimer;

    static getInstance(): PerformanceTimer {
        if (!PerformanceProvider.instance) {
            PerformanceProvider.instance = PerformanceProvider.createTimer();
        }
        return PerformanceProvider.instance;
    }

    private static createTimer(): PerformanceTimer {
        if (typeof window !== 'undefined' && window.performance && 'now' in window.performance) {
            return window.performance as PerformanceTimer;
        }

        if (typeof global !== 'undefined' && global.performance && 'now' in global.performance) {
            return global.performance as PerformanceTimer;
        }

        try {
            const perfHooks = require('perf_hooks');
            if (perfHooks?.performance && 'now' in perfHooks.performance) {
                return perfHooks.performance as PerformanceTimer;
            }
        } catch {}

        return new FallbackPerformanceTimer();
    }

    static reset(): void {
        PerformanceProvider.instance = undefined;
    }
}

export const performance = PerformanceProvider.getInstance();
