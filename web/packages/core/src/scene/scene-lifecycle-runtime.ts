import type { GameLoop, GameLoopStatus } from '../game-loop';
import { SceneLifecycleError } from './errors';
import type { SceneLoopState } from './types';

export interface SceneLifecycleRuntimeOptions {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly loop: GameLoop<SceneLoopState>;
    readonly autoCreatedCanvas: boolean;
    readonly pixelRatio: number;
    readonly defaultWidth: number;
    readonly defaultHeight: number;
    readonly render: (deltaTime: number) => void;
    readonly disposeAssets: () => void;
    readonly disposeWorld: () => void;
}

export class SceneLifecycleRuntime {
    private readonly _canvas: HTMLCanvasElement;
    private readonly _gl: WebGL2RenderingContext;
    private readonly _loop: GameLoop<SceneLoopState>;
    private readonly _autoCreatedCanvas: boolean;
    private readonly _defaultWidth: number;
    private readonly _defaultHeight: number;
    private readonly _render: (deltaTime: number) => void;
    private readonly _disposeAssets: () => void;
    private readonly _disposeWorld: () => void;
    private _pixelRatio: number;
    private _disposed = false;

    constructor(options: SceneLifecycleRuntimeOptions) {
        this._canvas = options.canvas;
        this._gl = options.gl;
        this._loop = options.loop;
        this._autoCreatedCanvas = options.autoCreatedCanvas;
        this._defaultWidth = options.defaultWidth;
        this._defaultHeight = options.defaultHeight;
        this._render = options.render;
        this._disposeAssets = options.disposeAssets;
        this._disposeWorld = options.disposeWorld;
        this._pixelRatio = options.pixelRatio > 0 ? options.pixelRatio : 1;
    }

    get status(): GameLoopStatus {
        return this._loop.status;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    start(now?: number): void {
        this.assertNotDisposed();
        this._loop.start(now);
    }

    pause(): void {
        this.assertNotDisposed();
        this._loop.pause();
    }

    resume(now?: number): void {
        this.assertNotDisposed();
        this._loop.resume(now);
    }

    stop(): void {
        this.assertNotDisposed();
        this._loop.stop();
    }

    renderNow(): void {
        this.assertNotDisposed();
        this._render(0);
    }

    resize(
        width: number = this._canvas.clientWidth || this._defaultWidth,
        height: number = this._canvas.clientHeight || this._defaultHeight,
        pixelRatio: number = this._pixelRatio
    ): void {
        this.assertNotDisposed();
        this._pixelRatio = pixelRatio > 0 ? pixelRatio : 1;

        const targetWidth = Math.max(1, Math.floor(width * this._pixelRatio));
        const targetHeight = Math.max(1, Math.floor(height * this._pixelRatio));
        this._canvas.width = targetWidth;
        this._canvas.height = targetHeight;
        this._canvas.style.width = `${width}px`;
        this._canvas.style.height = `${height}px`;
        this._gl.viewport(0, 0, targetWidth, targetHeight);
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        let lifecycleError: SceneLifecycleError | null = null;

        try {
            this._loop.dispose();
        } catch (error) {
            lifecycleError = new SceneLifecycleError('Failed to dispose scene loop', error);
        }

        try {
            this._disposeAssets();
        } catch (error) {
            lifecycleError ??= new SceneLifecycleError('Failed to dispose scene assets', error);
        }

        try {
            this._disposeWorld();
        } catch (error) {
            lifecycleError ??= new SceneLifecycleError('Failed to dispose scene world', error);
        }

        try {
            if (
                this._autoCreatedCanvas &&
                this._canvas.parentNode &&
                typeof this._canvas.parentNode.removeChild === 'function'
            ) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
        } catch (error) {
            lifecycleError ??= new SceneLifecycleError(
                'Failed to remove auto-created scene canvas',
                error
            );
        }

        this._disposed = true;

        if (lifecycleError) {
            throw lifecycleError;
        }
    }

    assertNotDisposed(): void {
        if (!this._disposed) {
            return;
        }

        throw new SceneLifecycleError('Scene has already been disposed');
    }
}
