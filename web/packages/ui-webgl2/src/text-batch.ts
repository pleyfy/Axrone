import type { RectLike, TextGlyphPlacement, TextRenderCommand } from '@axrone/ui/types';
import { Rect } from '@axrone/numeric';
import { createGlyphPageKey, IDENTITY_TRANSFORM, TEXT_FLOATS_PER_INSTANCE } from './batch-layout';
import type { GlyphAtlasPages } from './glyph-atlas-pages';
import { GL_STATE_UNIT0_SAMPLER } from './gl-state';
import type { RenderHost } from './render-host';
import { writeBlendedColor } from './webgl-utils';

export class TextBatch<TPayload = unknown> {
    private readonly data: Float32Array;
    private count = 0;
    private pageKey: number | null = null;
    private clip: RectLike | null = null;
    private missingGlyphDataWarned = false;
    private textDrawCalls = 0;
    private readonly pages: GlyphAtlasPages;

    constructor(capacity: number, pages: GlyphAtlasPages) {
        this.data = new Float32Array(capacity * TEXT_FLOATS_PER_INSTANCE);
        this.pages = pages;
    }

    reset(): void {
        this.count = 0;
        this.clip = null;
        this.textDrawCalls = 0;
        this.pageKey = null;
    }

    get byteLength(): number {
        return this.data.byteLength;
    }

    get instanceCount(): number {
        return this.count;
    }

    get activePageKey(): number | null {
        return this.pageKey;
    }

    clearActivePageKey(): void {
        this.pageKey = null;
    }

    pushCommand(command: TextRenderCommand, viewportHeight: number, host: RenderHost<TPayload>): void {
        for (const glyph of command.layout.glyphs) {
            if (!this.pushGlyph(command, glyph, viewportHeight, host)) {
                if (!glyph.atlasEntry || !glyph.atlasEntry.data) {
                    continue;
                }
                this.flush(viewportHeight, host);
                if (!this.pushGlyph(command, glyph, viewportHeight, host)) {
                    continue;
                }
            }
        }
    }

    pushGlyph(
        command: TextRenderCommand,
        glyph: TextGlyphPlacement,
        viewportHeight: number,
        host: RenderHost<TPayload>
    ): boolean {
        const entry = glyph.atlasEntry;
        if (!entry) {
            return false;
        }
        const pageKey = createGlyphPageKey(entry);
        if (this.pageKey !== null && this.pageKey !== pageKey) {
            return false;
        }
        if (this.clip !== null && this.clip !== (command.clip ?? null) && !Rect.equals(this.clip, command.clip as RectLike)) {
            return false;
        }
        const page = this.pages.ensurePage(entry, host);
        if (page === null) {
            if (!this.missingGlyphDataWarned) {
                console.warn('[WebGL2UIRenderer] Glyph atlas entry has no data — glyph will be skipped. This indicates a post-eviction re-upload failure.');
                this.missingGlyphDataWarned = true;
            }
            return false;
        }
        const base = this.count * TEXT_FLOATS_PER_INSTANCE;
        if (base + TEXT_FLOATS_PER_INSTANCE > this.data.length) {
            return false;
        }
        this.pageKey = pageKey;
        this.clip = command.clip ?? null;
        this.data[base] = command.x + glyph.x;
        this.data[base + 1] = command.y + glyph.y;
        this.data[base + 2] = glyph.width;
        this.data[base + 3] = glyph.height;
        this.data[base + 4] = entry.u0;
        this.data[base + 5] = entry.v0;
        this.data[base + 6] = entry.u1 - entry.u0;
        this.data[base + 7] = entry.v1 - entry.v0;
        writeBlendedColor(this.data, base + 8, command.color, command.opacity);
        writeBlendedColor(this.data, base + 12, command.outlineColor, command.opacity);
        this.data[base + 16] = entry.format === 'sdf8' ? 1 : 0;
        this.data[base + 17] = entry.distanceRange;
        this.data[base + 18] = command.outlineWidth;
        this.data[base + 19] = command.edgeSoftness;
        const transform = command.transform ?? IDENTITY_TRANSFORM;
        this.data[base + 20] = transform[0];
        this.data[base + 21] = transform[1];
        this.data[base + 22] = transform[4];
        this.data[base + 23] = transform[2];
        this.data[base + 24] = transform[3];
        this.data[base + 25] = transform[5];
        this.count += 1;
        host.statistics.glyphCount += 1;
        void page;
        void viewportHeight;
        return true;
    }

    flush(viewportHeight: number, host: RenderHost<TPayload>): void {
        if (this.count === 0 || !host.currentFrame || this.pageKey === null) {
            return;
        }
        const page = this.pages.getPage(this.pageKey);
        if (!page) {
            this.count = 0;
            this.pageKey = null;
            return;
        }
        const frame = host.currentFrame;
        const gl = host.gl;
        const state = host.state;
        const pipelines = host.pipelines;
        pipelines.drawBatch({
            state,
            clip: this.clip,
            clipViewportHeight: viewportHeight,
            frameViewportWidth: frame.viewportWidth,
            frameViewportHeight: frame.viewportHeight,
            program: pipelines.textProgram,
            viewportUniform: pipelines.textViewportUniform,
            vao: pipelines.textVao,
            instanceBuffer: pipelines.textInstanceBuffer,
            data: this.data,
            instanceCount: this.count,
            floatsPerInstance: TEXT_FLOATS_PER_INSTANCE,
            bindTextureResources: () => {
                state.bindUnit0Texture(page.texture);
                state.capture(GL_STATE_UNIT0_SAMPLER);
                state.touch(GL_STATE_UNIT0_SAMPLER);
                gl.bindSampler?.(0, null);
                gl.uniform1i(pipelines.textAtlasUniform, 0);
            },
        });
        host.statistics.drawCalls += 1;
        this.textDrawCalls += 1;
        this.count = 0;
        this.pageKey = null;
    }
}
