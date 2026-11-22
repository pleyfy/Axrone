import type {
    EdgeInsets,
    ImageRenderCommand,
    RectLike,
    UIFrame,
} from '@axrone/ui/types';
import { Rect } from '@axrone/numeric';
import { IMAGE_FLOATS_PER_INSTANCE, IDENTITY_TRANSFORM, sliceColumnsScratch, sliceRowsScratch } from './batch-layout';
import { GL_STATE_UNIT0_SAMPLER } from './gl-state';
import { resolveSliceSpans, sliceImageCommand } from './nine-slice';
import type { RenderHost } from './render-host';
import type { WebGL2UIMaterialImageContext } from './types';
import { writeBlendedColor } from './webgl-utils';

export class ImageBatch<TPayload = unknown> {
    private readonly data: Float32Array;
    private count = 0;
    private activeTexture: WebGLTexture | null = null;
    private activeSampler: WebGLSampler | null = null;
    private clip: RectLike | null = null;

    constructor(capacity: number) {
        this.data = new Float32Array(capacity * IMAGE_FLOATS_PER_INSTANCE);
    }

    reset(): void {
        this.count = 0;
        this.clip = null;
        this.activeSampler = null;
        this.activeTexture = null;
    }

    get byteLength(): number {
        return this.data.byteLength;
    }

    get instanceCount(): number {
        return this.count;
    }

    pushCommand(command: ImageRenderCommand, frame: Readonly<UIFrame<TPayload>>, host: RenderHost<TPayload>): void {
        const border = command.border;
        if (
            border &&
            (border.left > 0 || border.top > 0 || border.right > 0 || border.bottom > 0)
        ) {
            this.pushSlicedImage(command, border, frame, host);
            return;
        }
        this.pushQuad(command, frame, host);
    }

    pushQuad(command: ImageRenderCommand, frame: Readonly<UIFrame<TPayload>>, host: RenderHost<TPayload>): void {
        const resource = host.resolveImageResource?.(command.source, {
            gl: host.gl,
            frame,
            command,
        });
        if (!resource) {
            return;
        }
        if (resource.kind === 'material') {
            host.statistics.imageCount += 1;
            this.flush(frame.viewportHeight, host);
            host.statistics.materialImageCount += 1;
            host.state.applyClip(command.clip ?? null, frame.viewportHeight);
            resource.render({
                gl: host.gl,
                frame,
                command,
                clip: command.clip,
                viewport: { width: frame.viewportWidth, height: frame.viewportHeight },
            } satisfies WebGL2UIMaterialImageContext<TPayload>);
            return;
        }
        this.pushInstance(
            command,
            resource.texture,
            resource.sampler ?? null,
            command.clip ?? null,
            frame,
            host,
            command.x,
            command.y,
            command.width,
            command.height,
            command.uvRect.x,
            command.uvRect.y,
            command.uvRect.width,
            command.uvRect.height
        );
    }

    pushSlicedImage(
        command: ImageRenderCommand,
        border: EdgeInsets,
        frame: Readonly<UIFrame<TPayload>>,
        host: RenderHost<TPayload>
    ): void {
        const resource = host.resolveImageResource?.(command.source, {
            gl: host.gl,
            frame,
            command,
        });
        if (!resource) {
            return;
        }
        if (resource.kind === 'material') {
            for (const slice of sliceImageCommand(command, border, sliceColumnsScratch, sliceRowsScratch)) {
                this.pushQuad(slice, frame, host);
            }
            return;
        }
        resolveSliceSpans(
            command.width,
            border.left,
            border.right,
            Math.max(1, command.source.width),
            command.uvRect.x,
            command.uvRect.width,
            sliceColumnsScratch
        );
        resolveSliceSpans(
            command.height,
            border.top,
            border.bottom,
            Math.max(1, command.source.height),
            command.uvRect.y,
            command.uvRect.height,
            sliceRowsScratch
        );
        const fillCenter = command.fillCenter !== false;
        const sampler = resource.sampler ?? null;
        const clip = command.clip ?? null;
        for (let row = 0; row < sliceRowsScratch.length; row += 1) {
            const vertical = sliceRowsScratch[row];
            if (vertical.size <= 0 || vertical.uvSize <= 0) {
                continue;
            }
            for (let column = 0; column < sliceColumnsScratch.length; column += 1) {
                if (row === 1 && column === 1 && !fillCenter) {
                    continue;
                }
                const horizontal = sliceColumnsScratch[column];
                if (horizontal.size <= 0 || horizontal.uvSize <= 0) {
                    continue;
                }
                this.pushInstance(
                    command,
                    resource.texture,
                    sampler,
                    clip,
                    frame,
                    host,
                    command.x + horizontal.offset,
                    command.y + vertical.offset,
                    horizontal.size,
                    vertical.size,
                    horizontal.uvOffset,
                    vertical.uvOffset,
                    horizontal.uvSize,
                    vertical.uvSize
                );
            }
        }
    }

    pushInstance(
        command: ImageRenderCommand,
        texture: WebGLTexture,
        sampler: WebGLSampler | null,
        clip: RectLike | null,
        frame: Readonly<UIFrame<TPayload>>,
        host: RenderHost<TPayload>,
        x: number,
        y: number,
        width: number,
        height: number,
        uvX: number,
        uvY: number,
        uvWidth: number,
        uvHeight: number
    ): void {
        if (
            (this.activeTexture !== null && this.activeTexture !== texture) ||
            (this.activeSampler !== sampler) ||
            (this.clip !== null && this.clip !== (command.clip ?? null) && !Rect.equals(this.clip, command.clip as RectLike))
        ) {
            this.flush(frame.viewportHeight, host);
        }
        const data = this.data;
        let base = this.count * IMAGE_FLOATS_PER_INSTANCE;
        if (base + IMAGE_FLOATS_PER_INSTANCE > data.length) {
            this.flush(frame.viewportHeight, host);
            base = 0;
        }
        this.activeTexture = texture;
        this.activeSampler = sampler;
        this.clip = clip;
        data[base] = x;
        data[base + 1] = y;
        data[base + 2] = width;
        data[base + 3] = height;
        data[base + 4] = uvX;
        data[base + 5] = uvY;
        data[base + 6] = uvWidth;
        data[base + 7] = uvHeight;
        writeBlendedColor(data, base + 8, command.tint, command.opacity);
        data[base + 12] = command.radius.topLeft;
        data[base + 13] = command.radius.topRight;
        data[base + 14] = command.radius.bottomRight;
        data[base + 15] = command.radius.bottomLeft;
        const transform = command.transform ?? IDENTITY_TRANSFORM;
        data[base + 16] = transform[0];
        data[base + 17] = transform[1];
        data[base + 18] = transform[4];
        data[base + 19] = transform[2];
        data[base + 20] = transform[3];
        data[base + 21] = transform[5];
        this.count += 1;
        host.statistics.imageCount += 1;
    }

    flush(viewportHeight: number, host: RenderHost<TPayload>): void {
        if (this.count === 0 || !host.currentFrame || !this.activeTexture) {
            this.count = 0;
            this.activeTexture = null;
            return;
        }
        const frame = host.currentFrame;
        const gl = host.gl;
        const state = host.state;
        const pipelines = host.pipelines;
        const texture = this.activeTexture;
        const sampler = this.activeSampler;
        pipelines.drawBatch({
            state,
            clip: this.clip,
            clipViewportHeight: viewportHeight,
            frameViewportWidth: frame.viewportWidth,
            frameViewportHeight: frame.viewportHeight,
            program: pipelines.imageProgram,
            viewportUniform: pipelines.imageViewportUniform,
            vao: pipelines.imageVao,
            instanceBuffer: pipelines.imageInstanceBuffer,
            data: this.data,
            instanceCount: this.count,
            floatsPerInstance: IMAGE_FLOATS_PER_INSTANCE,
            bindTextureResources: () => {
                state.capture(GL_STATE_UNIT0_SAMPLER);
                state.touch(GL_STATE_UNIT0_SAMPLER);
                state.bindUnit0Texture(texture);
                gl.bindSampler(0, sampler);
                gl.uniform1i(pipelines.imageTextureUniform, 0);
            },
        });
        host.statistics.drawCalls += 1;
        this.count = 0;
        this.activeTexture = null;
        this.activeSampler = null;
    }
}
