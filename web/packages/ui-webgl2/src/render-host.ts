import type { UIFrame } from '@axrone/ui/types';
import type { FrameGLState } from './frame-gl-state';
import type { RenderPipelines } from './render-pipelines';
import {
    type RendererStatisticsState,
    resetRendererStatisticsState,
} from './renderer-statistics';
import type { WebGL2UIRendererOptions } from './types';

export interface RenderHostInput<TPayload = unknown> {
    readonly gl: WebGL2RenderingContext;
    readonly state: FrameGLState;
    readonly statistics: RendererStatisticsState;
    readonly pipelines: RenderPipelines;
    readonly resolveImageResource?: WebGL2UIRendererOptions<TPayload>['resolveImageResource'];
}

export class RenderHost<TPayload = unknown> {
    readonly gl: WebGL2RenderingContext;
    readonly state: FrameGLState;
    readonly statistics: RendererStatisticsState;
    readonly resolveImageResource?: WebGL2UIRendererOptions<TPayload>['resolveImageResource'];
    pipelines: RenderPipelines;
    currentFrame: UIFrame<TPayload> | null = null;

    constructor(input: RenderHostInput<TPayload>) {
        this.gl = input.gl;
        this.state = input.state;
        this.statistics = input.statistics;
        this.pipelines = input.pipelines;
        this.resolveImageResource = input.resolveImageResource;
    }

    resetStatistics(): void {
        resetRendererStatisticsState(this.statistics);
    }
}
