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
}

export {};
