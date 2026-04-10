import type { ComponentRegistry } from '../../core/src/component-system/types/core';
import type { SceneOptions } from './types';
import {
    DEFAULT_SCENE_HEIGHT,
    DEFAULT_SCENE_WIDTH,
} from './scene-runtime-defaults';
import { SceneSnapshotFacade } from './scene-snapshot-facade';

export class SceneLifecycleFacade<
    R extends ComponentRegistry = Record<string, never>,
> extends SceneSnapshotFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super(options);
    }

    get status() {
        return this._kernel.lifecycle.status;
    }

    get isDisposed(): boolean {
        return this._kernel.lifecycle.isDisposed;
    }

    get renderStats() {
        return this._kernel.renderRuntime.stats;
    }

    start(now?: number): this {
        this._kernel.lifecycle.start(now);
        return this;
    }

    pause(): this {
        this._kernel.lifecycle.pause();
        return this;
    }

    resume(now?: number): this {
        this._kernel.lifecycle.resume(now);
        return this;
    }

    stop(): this {
        this._kernel.lifecycle.stop();
        return this;
    }

    renderNow(): this {
        this._kernel.lifecycle.renderNow();
        return this;
    }

    resize(
        width: number = this.canvas.clientWidth || DEFAULT_SCENE_WIDTH,
        height: number = this.canvas.clientHeight || DEFAULT_SCENE_HEIGHT,
        pixelRatio?: number
    ): this {
        this._kernel.lifecycle.resize(width, height, pixelRatio);
        return this;
    }

    dispose(): void {
        this._kernel.lifecycle.dispose();
    }
}