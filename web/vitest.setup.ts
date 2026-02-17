import { vi, expect } from 'vitest';

(global as any).expect = expect;
(global as any).vi = vi;

Object.assign(global, {
    performance: {
        now: () => Date.now(),
    },
});

const originalLog = console.log;
console.log = (...args: any[]) => {
    if (process.env.NODE_ENV === 'test') {
        return;
    }
    originalLog(...args);
};
