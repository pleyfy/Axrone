import type { QuadRenderCommand, RectLike, StrokeRenderCommand } from '@axrone/ui/types';
import { Rect } from '@axrone/numeric';
import { IDENTITY_TRANSFORM, QUAD_FLOATS_PER_INSTANCE } from './batch-layout';
import type { RenderHost } from './render-host';
import { writeBlendedColor, writeStrokeColor } from './webgl-utils';

export class QuadBatch<TPayload = unknown> {
    private readonly data: Float32Array;
    private count = 0;
    private clip: RectLike | null = null;
    private readonly strokeColorScratch = new Float32Array(4);

    constructor(capacity: number) {
        this.data = new Float32Array(capacity * QUAD_FLOATS_PER_INSTANCE);
    }

    reset(): void {
        this.count = 0;
        this.clip = null;
    }

    get byteLength(): number {
        return this.data.byteLength;
    }

    get instanceCount(): number {
        return this.count;
    }

    get activeClip(): RectLike | null {
        return this.clip;
    }

    setActiveClip(clip: RectLike | null): void {
        this.clip = clip;
    }

    push(command: QuadRenderCommand, viewportHeight: number, host: RenderHost<TPayload>): void {
        const data = this.data;
        let base = this.count * QUAD_FLOATS_PER_INSTANCE;
        if (base + QUAD_FLOATS_PER_INSTANCE > data.length) {
            this.flush(viewportHeight, host);
            base = 0;
        }
        data[base] = command.x;
        data[base + 1] = command.y;
        data[base + 2] = command.width;
        data[base + 3] = command.height;
        writeBlendedColor(data, base + 4, command.color, command.opacity);
        writeBlendedColor(data, base + 8, command.borderColor, command.opacity);
        data[base + 12] = command.radius.topLeft;
        data[base + 13] = command.radius.topRight;
        data[base + 14] = command.radius.bottomRight;
        data[base + 15] = command.radius.bottomLeft;
        data[base + 16] = command.borderWidth;
        const transform = command.transform ?? IDENTITY_TRANSFORM;
        data[base + 17] = transform[0];
        data[base + 18] = transform[1];
        data[base + 19] = transform[4];
        data[base + 20] = transform[2];
        data[base + 21] = transform[3];
        data[base + 22] = transform[5];
        this.count += 1;
        host.statistics.quadCount += 1;
    }

    pushStroke(command: StrokeRenderCommand, viewportHeight: number, host: RenderHost<TPayload>): void {
        const data = this.data;
        const widgetX = command.x;
        const widgetY = command.y;
        const widgetW = command.width;
        const widgetH = command.height;
        const camera = command.transform ?? IDENTITY_TRANSFORM;
        for (const stroke of command.strokes) {
            writeStrokeColor(stroke.color, this.strokeColorScratch);
            const weight = Math.max(0.5, stroke.weight);
            const halfWeight = weight * 0.5;
            const points = stroke.points;
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[i];
                const p1 = points[i + 1];
                const x0 = widgetX + p0[0] * widgetW;
                const y0 = widgetY + p0[1] * widgetH;
                const x1 = widgetX + p1[0] * widgetW;
                const y1 = widgetY + p1[1] * widgetH;
                const dx = x1 - x0;
                const dy = y1 - y0;
                const segLen = Math.sqrt(dx * dx + dy * dy);
                if (segLen < 0.001) continue;
                const dirX = dx / segLen;
                const dirY = dy / segLen;
                const nx = -dirY;
                const ny = dirX;
                const extent = segLen + weight;
                const s0 = dirX;
                const s2 = dirY;
                const s1 = nx;
                const s3 = ny;
                const s4 = x0 - dirX * halfWeight - nx * halfWeight;
                const s5 = y0 - dirY * halfWeight - ny * halfWeight;
                const r0 = camera[0] * s0 + camera[1] * s2;
                const r1 = camera[0] * s1 + camera[1] * s3;
                const r2 = camera[2] * s0 + camera[3] * s2;
                const r3 = camera[2] * s1 + camera[3] * s3;
                const r4 = camera[0] * s4 + camera[1] * s5 + camera[4];
                const r5 = camera[2] * s4 + camera[3] * s5 + camera[5];
                let base = this.count * QUAD_FLOATS_PER_INSTANCE;
                if (base + QUAD_FLOATS_PER_INSTANCE > data.length) {
                    this.flush(viewportHeight, host);
                    base = 0;
                }
                data[base] = 0;
                data[base + 1] = 0;
                data[base + 2] = extent;
                data[base + 3] = weight;
                data[base + 4] = this.strokeColorScratch[0];
                data[base + 5] = this.strokeColorScratch[1];
                data[base + 6] = this.strokeColorScratch[2];
                data[base + 7] = this.strokeColorScratch[3] * command.opacity;
                data[base + 8] = 0;
                data[base + 9] = 0;
                data[base + 10] = 0;
                data[base + 11] = 0;
                data[base + 12] = 0;
                data[base + 13] = 0;
                data[base + 14] = 0;
                data[base + 15] = 0;
                data[base + 16] = 0;
                data[base + 17] = r0;
                data[base + 18] = r1;
                data[base + 19] = r4;
                data[base + 20] = r2;
                data[base + 21] = r3;
                data[base + 22] = r5;
                this.count += 1;
                host.statistics.quadCount += 1;
            }
        }
    }

    flush(viewportHeight: number, host: RenderHost<TPayload>): void {
        if (this.count === 0 || !host.currentFrame) {
            return;
        }
        const frame = host.currentFrame;
        host.pipelines.drawBatch({
            state: host.state,
            clip: this.clip,
            clipViewportHeight: viewportHeight,
            frameViewportWidth: frame.viewportWidth,
            frameViewportHeight: frame.viewportHeight,
            program: host.pipelines.quadProgram,
            viewportUniform: host.pipelines.quadViewportUniform,
            vao: host.pipelines.quadVao,
            instanceBuffer: host.pipelines.quadInstanceBuffer,
            data: this.data,
            instanceCount: this.count,
            floatsPerInstance: QUAD_FLOATS_PER_INSTANCE,
        });
        host.statistics.drawCalls += 1;
        this.count = 0;
    }
}
