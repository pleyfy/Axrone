import { vi, expect } from 'vitest';

(global as any).expect = expect;
(global as any).vi = vi;

if (!(global as any).WebGL2RenderingContext) {
    let nextWebGL2Constant = 0x2000;
    (global as any).WebGL2RenderingContext = new Proxy(class WebGL2RenderingContext {}, {
        get(target, property, receiver) {
            if (typeof property === 'string' && !(property in target)) {
                Reflect.set(target, property, nextWebGL2Constant++);
            }

            return Reflect.get(target, property, receiver);
        },
    });
}

if (!(global as any).ImageBitmap) {
    (global as any).ImageBitmap = class ImageBitmap {};
}

if (!(global as any).ImageData) {
    (global as any).ImageData = class ImageData {};
}

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
