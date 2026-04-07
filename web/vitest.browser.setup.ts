(window as any).createTestCanvas = (width = 800, height = 600) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    return canvas;
};

(window as any).createWebGLContext = (
    canvas: HTMLCanvasElement,
    contextAttributes: Partial<WebGLContextAttributes> = {}
) => {
    const gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: true,
        stencil: true,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        ...contextAttributes,
    } as WebGLContextAttributes);

    if (!gl) {
        throw new Error('WebGL2 not supported in this browser');
    }

    return gl as WebGL2RenderingContext;
};

(window as any).checkWebGLSupport = () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return gl !== null;
};

(window as any).testPerformance = {
    start: performance.now(),
    mark: (name: string) => performance.mark(name),
    measure: (name: string, startMark?: string, endMark?: string) =>
        performance.measure(name, startMark, endMark),
};

(window as any).cleanupTestElements = () => {
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach((canvas) => canvas.remove());
};

afterEach(() => {
    (window as any).cleanupTestElements();
});
