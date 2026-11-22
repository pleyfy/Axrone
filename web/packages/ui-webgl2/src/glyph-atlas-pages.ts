import type { FontGlyphBitmapFormat, GlyphAtlasEntry } from '@axrone/ui/types';
import { createUploadedGlyphKey, toUint8Array } from '@axrone/ui/font';
import { createGlyphPageKey } from './batch-layout';
import type { FrameGLState } from './frame-gl-state';
import { GL_STATE_UNPACK_ALIGNMENT } from './gl-state';
import type { RendererStatisticsState } from './renderer-statistics';

export interface TexturePage {
    readonly texture: WebGLTexture;
    readonly width: number;
    readonly height: number;
    readonly format: FontGlyphBitmapFormat;
    readonly uploadedGlyphs: Set<number>;
}

export interface GlyphAtlasContext {
    readonly gl: WebGL2RenderingContext;
    readonly state: FrameGLState;
    readonly statistics: RendererStatisticsState;
}

export class GlyphAtlasPages {
    private readonly gl: WebGL2RenderingContext;
    private readonly atlasFilter: 'nearest' | 'linear';
    private readonly pages = new Map<number, TexturePage>();

    constructor(gl: WebGL2RenderingContext, atlasFilter: 'nearest' | 'linear') {
        this.gl = gl;
        this.atlasFilter = atlasFilter;
    }

    get pageCount(): number {
        return this.pages.size;
    }

    getPage(pageKey: number): TexturePage | null {
        return this.pages.get(pageKey) ?? null;
    }

    reset(): void {
        this.pages.clear();
    }

    evict(pageKey: number): void {
        const page = this.pages.get(pageKey);
        if (page) {
            this.gl.deleteTexture(page.texture);
            this.pages.delete(pageKey);
        }
    }

    deleteAll(): void {
        for (const page of this.pages.values()) {
            this.gl.deleteTexture(page.texture);
        }
        this.pages.clear();
    }

    ensurePage(entry: GlyphAtlasEntry, context: GlyphAtlasContext): TexturePage | null {
        const gl = this.gl;
        const key = createGlyphPageKey(entry);
        let page = this.pages.get(key);
        if (!page) {
            const texture = gl.createTexture();
            if (!texture) {
                return null;
            }
            context.state.bindUnit0Texture(texture);
            const internalFormat = entry.format === 'rgba8' ? gl.RGBA8 : gl.R8;
            const format = entry.format === 'rgba8' ? gl.RGBA : gl.RED;
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_MIN_FILTER,
                this.atlasFilter === 'linear' ? gl.LINEAR : gl.NEAREST
            );
            gl.texParameteri(
                gl.TEXTURE_2D,
                gl.TEXTURE_MAG_FILTER,
                this.atlasFilter === 'linear' ? gl.LINEAR : gl.NEAREST
            );
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            context.state.capture(GL_STATE_UNPACK_ALIGNMENT);
            context.state.touch(GL_STATE_UNPACK_ALIGNMENT);
            gl.pixelStorei?.(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                internalFormat,
                entry.pageWidth,
                entry.pageHeight,
                0,
                format,
                gl.UNSIGNED_BYTE,
                null
            );
            page = {
                texture,
                width: entry.pageWidth,
                height: entry.pageHeight,
                format: entry.format,
                uploadedGlyphs: new Set<number>(),
            };
            this.pages.set(key, page);
        }
        const glyphKey = createUploadedGlyphKey(entry);
        if (!page.uploadedGlyphs.has(glyphKey)) {
            if (!entry.data) {
                return null;
            }
            const packed = this.packGlyphData(entry);
            context.state.bindUnit0Texture(page.texture);
            context.state.capture(GL_STATE_UNPACK_ALIGNMENT);
            context.state.touch(GL_STATE_UNPACK_ALIGNMENT);
            gl.pixelStorei?.(gl.UNPACK_ALIGNMENT, 1);
            gl.texSubImage2D(
                gl.TEXTURE_2D,
                0,
                entry.x,
                entry.y,
                entry.width,
                entry.height,
                entry.format === 'rgba8' ? gl.RGBA : gl.RED,
                gl.UNSIGNED_BYTE,
                packed
            );
            page.uploadedGlyphs.add(glyphKey);
            context.statistics.uploadedGlyphCount += 1;
        }
        return page;
    }

    private packGlyphData(entry: GlyphAtlasEntry): Uint8Array {
        const bytesPerPixel = entry.format === 'rgba8' ? 4 : 1;
        const expectedStride = entry.width * bytesPerPixel;
        const source = toUint8Array(entry.data!);
        if (entry.rowStride === expectedStride) {
            return source;
        }
        const packed = new Uint8Array(expectedStride * entry.height);
        for (let row = 0; row < entry.height; row += 1) {
            const sourceOffset = row * entry.rowStride;
            const targetOffset = row * expectedStride;
            packed.set(source.subarray(sourceOffset, sourceOffset + expectedStride), targetOffset);
        }
        return packed;
    }
}
