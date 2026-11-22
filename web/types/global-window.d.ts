declare global {
    interface Window {
        createTestCanvas?: (width?: number, height?: number) => HTMLCanvasElement;
        createWebGLContext?: (
            canvas: HTMLCanvasElement,
            contextAttributes?: WebGLContextAttributes
        ) => WebGL2RenderingContext;
        checkWebGLSupport?: () => boolean;
        testPerformance?: {
            start: number;
            mark: (name: string) => void;
            measure: (name: string, startMark?: string, endMark?: string) => void;
        };
        cleanupTestElements?: () => void;
    }

    // Engine DIAG gate — when true, [DIAG] console.warn calls in the
    // ui / ui-webgl2 packages are allowed to emit. Otherwise they are
    // silently suppressed so production builds stay quiet.
    // eslint-disable-next-line no-var
    var __AXRONE_DIAG__: boolean | undefined;
}

export {};
