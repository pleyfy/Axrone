import type {
    CustomRenderCommand,
    GlyphAtlasPageSnapshot,
    RectLike,
    UIFrame,
} from '@axrone/ui/types';
import type { UIFrameSink } from '@axrone/ui/render';
import { DisposedUIError } from '@axrone/ui/errors';
import { Rect } from '@axrone/numeric';
import { GL_STATE_FRAMEBUFFER } from './gl-state';
import { createRendererStatisticsState, getRendererStatistics } from './renderer-statistics';
import { FrameGLState } from './frame-gl-state';
import { QuadBatch } from './quad-batch';
import { ImageBatch } from './image-batch';
import { GlyphAtlasPages } from './glyph-atlas-pages';
import { TextBatch } from './text-batch';
import { RenderHost } from './render-host';
import { RenderPipelines } from './render-pipelines';
import type {
    WebGL2UICustomCommandContext,
    WebGL2UIRendererOptions,
    WebGL2UIRendererStatistics,
    WebGL2UIRenderOptions,
} from './types';

export class WebGL2UIRenderer<TPayload = unknown> implements UIFrameSink<TPayload> {
    private readonly gl: WebGL2RenderingContext;
    private readonly statisticsState: ReturnType<typeof createRendererStatisticsState>;
    private readonly glState: FrameGLState;
    private readonly quadBatch: QuadBatch<TPayload>;
    private readonly imageBatch: ImageBatch<TPayload>;
    private readonly glyphPages: GlyphAtlasPages;
    private readonly textBatch: TextBatch<TPayload>;
    private pipelines: RenderPipelines;
    private readonly renderHost: RenderHost<TPayload>;
    private readonly resolveImageResource?: WebGL2UIRendererOptions<TPayload>['resolveImageResource'];
    private readonly customCommandRenderer?: WebGL2UIRendererOptions<TPayload>['customCommandRenderer'];
    private readonly atlasFilter: 'nearest' | 'linear';
    private lastViewportHeight = 0;
    private disposed = false;
    private contextLost = false;

    constructor(options: WebGL2UIRendererOptions<TPayload>) {
        this.gl = options.gl;
        this.resolveImageResource = options.resolveImageResource;
        this.customCommandRenderer = options.customCommandRenderer;
        this.atlasFilter = options.atlasFilter ?? 'linear';
        this.statisticsState = createRendererStatisticsState();
        this.glState = new FrameGLState(this.gl);
        this.quadBatch = new QuadBatch<TPayload>(options.quadBatchCapacity ?? 1024);
        this.imageBatch = new ImageBatch<TPayload>(options.imageBatchCapacity ?? 1024);
        this.glyphPages = new GlyphAtlasPages(this.gl, this.atlasFilter);
        this.textBatch = new TextBatch<TPayload>(options.glyphBatchCapacity ?? 4096, this.glyphPages);
        this.pipelines = new RenderPipelines({
            gl: this.gl,
            quadBatchByteLength: this.quadBatch.byteLength,
            imageBatchByteLength: this.imageBatch.byteLength,
            textBatchByteLength: this.textBatch.byteLength,
        });
        this.renderHost = new RenderHost<TPayload>({
            gl: this.gl,
            state: this.glState,
            statistics: this.statisticsState,
            pipelines: this.pipelines,
            resolveImageResource: this.resolveImageResource,
        });
        this.attachContextLossHandlers();
    }

    /**
     * Creates every GPU-dependent object: programs, uniform locations, static
     * and instance buffers, VAOs and their vertex layouts. Called by the
     * constructor and again after a webglcontextrestored event. CPU-side batch
     * storage intentionally lives outside so it survives context loss.
     */
    private createGpuResources(): void {
        this.pipelines = new RenderPipelines({
            gl: this.gl,
            quadBatchByteLength: this.quadBatch.byteLength,
            imageBatchByteLength: this.imageBatch.byteLength,
            textBatchByteLength: this.textBatch.byteLength,
        });
        this.renderHost.pipelines = this.pipelines;
    }

    private readonly handleContextLost = (event: Event): void => {
        // Preventing default keeps the context alive for a potential restore.
        event.preventDefault();
        this.contextLost = true;
        // Every GPU handle — including glyph page textures — is now invalid.
        // Dropping the pages forces re-upload after restore instead of reusing
        // stale texture handles.
        this.glyphPages.reset();
    };

    private readonly handleContextRestored = (): void => {
        try {
            this.createGpuResources();
            this.contextLost = false;
        } catch (error) {
            // A failed restore must not throw inside the browser event handler;
            // rendering stays disabled until a successful recreation.
            this.contextLost = true;
            // eslint-disable-next-line no-console
            console.error('[WebGL2UIRenderer] Failed to restore GPU resources after context loss.', error);
        }
    };

    private attachContextLossHandlers(): void {
        const canvas = this.gl.canvas as HTMLCanvasElement | undefined;
        if (canvas && typeof canvas.addEventListener === 'function') {
            canvas.addEventListener('webglcontextlost', this.handleContextLost);
            canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
        }
    }

    private detachContextLossHandlers(): void {
        const canvas = this.gl.canvas as HTMLCanvasElement | undefined;
        if (canvas && typeof canvas.removeEventListener === 'function') {
            canvas.removeEventListener('webglcontextlost', this.handleContextLost);
            canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
        }
    }

    getStats(): WebGL2UIRendererStatistics {
        return getRendererStatistics(this.statisticsState, this.glyphPages.pageCount);
    }

    /**
     * Handle an atlas page eviction from the CPU-side glyph atlas.
     * Deletes the corresponding GPU texture and removes the renderer's
     * TexturePage bookkeeping entry.
     */
    handleAtlasPageEviction(snapshot: GlyphAtlasPageSnapshot): void {
        if (this.contextLost) {
            return;
        }
        const evictedEntry = snapshot.entries[0];
        if (!evictedEntry) {
            return;
        }
        const pageKey = (evictedEntry.faceId as number) * 65536 + (snapshot.id as number);
        // If the evicted page was the active text page, flush any batched
        // glyphs before deleting the texture so they are not silently dropped.
        if (this.textBatch.activePageKey === pageKey && this.textBatch.instanceCount > 0) {
            this.textBatch.flush(this.lastViewportHeight, this.renderHost);
        }
        this.glyphPages.evict(pageKey);
        // Reset the active text page key if it matched the evicted page.
        if (this.textBatch.activePageKey === pageKey) {
            this.textBatch.clearActivePageKey();
        }
    }

    render(frame: Readonly<UIFrame<TPayload>>, options?: WebGL2UIRenderOptions): void {
        this.ensureActive();
        if (this.contextLost) {
            // GPU resources are invalid; skip the frame until the context is
            // restored and resources are recreated.
            return;
        }
        this.lastViewportHeight = frame.viewportHeight;
        this.renderHost.currentFrame = frame as UIFrame<TPayload>;
        this.renderHost.resetStatistics();
        this.quadBatch.reset();
        this.imageBatch.reset();
        this.textBatch.reset();

        try {
            if (options && 'framebuffer' in options) {
                this.glState.capture(GL_STATE_FRAMEBUFFER);
                this.glState.touch(GL_STATE_FRAMEBUFFER);
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, options.framebuffer ?? null);
            }
            this.glState.prepareFrame(frame.viewportWidth, frame.viewportHeight);

            let hasPendingImages = false;
            let hasPendingText = false;
            let pendingImageZIndex = -1;

            for (const command of frame.commands) {
                if (command.kind === 'quad') {
                    if (hasPendingImages && pendingImageZIndex < command.zIndex) {
                        this.imageBatch.flush(frame.viewportHeight, this.renderHost);
                        hasPendingImages = false;
                        pendingImageZIndex = -1;
                    }
                    // NOTE: Do NOT flush text here — quads are backgrounds and
                    // text must remain batched to draw AFTER all quads in the
                    // same clip region. Flushing text before quads causes the
                    // quads to overdraw the text (invisible labels on fills).
                    if (this.quadBatch.activeClip !== (command.clip ?? null) && !Rect.equals(this.quadBatch.activeClip, command.clip)) {
                        this.quadBatch.flush(frame.viewportHeight, this.renderHost);
                        this.quadBatch.setActiveClip(command.clip ?? null);
                    }
                    this.quadBatch.push(command, frame.viewportHeight, this.renderHost);
                    continue;
                }
                if (command.kind === 'image') {
                    if (hasPendingText) {
                        // Text and images share the texture unit, so pending
                        // glyphs must flush before the image binds. Flush the
                        // quad/stroke batch first: fills accumulated so far are
                        // backgrounds for those glyphs, and flushing text alone
                        // would let them overdraw labels at frame end.
                        this.quadBatch.flush(frame.viewportHeight, this.renderHost);
                        this.textBatch.flush(frame.viewportHeight, this.renderHost);
                        hasPendingText = false;
                    }
                    hasPendingImages = true;
                    pendingImageZIndex = command.zIndex;
                    this.imageBatch.pushCommand(command, frame, this.renderHost);
                    continue;
                }
                if (command.kind === 'text') {
                    if (hasPendingImages) {
                        this.imageBatch.flush(frame.viewportHeight, this.renderHost);
                        hasPendingImages = false;
                        pendingImageZIndex = -1;
                    }
                    hasPendingText = true;
                    this.textBatch.pushCommand(command, frame.viewportHeight, this.renderHost);
                    continue;
                }
                if (command.kind === 'stroke') {
                    if (hasPendingImages && pendingImageZIndex < command.zIndex) {
                        this.imageBatch.flush(frame.viewportHeight, this.renderHost);
                        hasPendingImages = false;
                        pendingImageZIndex = -1;
                    }
                    // NOTE: Do NOT flush text here — strokes share the quad
                    // pipeline and text must draw after them.
                    if (!this.quadBatch.activeClip || !Rect.equals(this.quadBatch.activeClip, command.clip)) {
                        this.quadBatch.flush(frame.viewportHeight, this.renderHost);
                        this.quadBatch.setActiveClip(command.clip ?? null);
                    }
                    this.quadBatch.pushStroke(command, frame.viewportHeight, this.renderHost);
                    continue;
                }
                this.quadBatch.flush(frame.viewportHeight, this.renderHost);
                this.imageBatch.flush(frame.viewportHeight, this.renderHost);
                hasPendingImages = false;
                pendingImageZIndex = -1;
                this.textBatch.flush(frame.viewportHeight, this.renderHost);
                if (this.customCommandRenderer) {
                    this.statisticsState.customCommandCount += 1;
                    this.customCommandRenderer(command as CustomRenderCommand<TPayload>, {
                        gl: this.gl,
                        frame,
                        clip: command.clip,
                        viewport: {
                            width: frame.viewportWidth,
                            height: frame.viewportHeight,
                        },
                    });
                    // Custom renderers may rebind the active texture unit;
                    // force re-issue on the next unit-sensitive call.
                    this.glState.invalidateTextureUnit();
                }
            }

            this.quadBatch.flush(frame.viewportHeight, this.renderHost);
            this.imageBatch.flush(frame.viewportHeight, this.renderHost);
            this.textBatch.flush(frame.viewportHeight, this.renderHost);
            // Frame-complete: all batch state is reset by the flush methods.
        } finally {
            this.renderHost.currentFrame = null;
            this.glState.restore();
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.detachContextLossHandlers();
        this.glyphPages.deleteAll();
        this.pipelines.delete();
        this.disposed = true;
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new DisposedUIError('WebGL2UIRenderer');
        }
    }
}

export type { WebGL2UICustomCommandContext, WebGL2UIRendererOptions, WebGL2UIRendererStatistics };
