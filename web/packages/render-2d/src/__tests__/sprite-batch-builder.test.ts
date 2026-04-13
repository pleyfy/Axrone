import { describe, expect, it } from 'vitest';
import { Color } from '@axrone/numeric';
import { Render2DSpriteBatchBuilder } from '../sprite-batch-builder';

const identity = Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
] as const);

describe('Render2DSpriteBatchBuilder', () => {
    it('batches consecutive sprites that share the same texture source', () => {
        const builder = new Render2DSpriteBatchBuilder();
        const result = builder.build([
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 2, height: 4 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                color: new Color(1, 1, 1, 1),
            },
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 0.5, height: 0.5 },
                color: new Color(1, 0.5, 0.25, 1),
            },
            {
                source: { kind: 'material', materialId: 'mat/b' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0, y: 0 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                color: new Color(0.5, 1, 1, 0.5),
            },
        ]);

        expect(result.spriteCount).toBe(3);
        expect(result.quadCount).toBe(3);
        expect(result.indexCount).toBe(18);
        expect(result.batches).toHaveLength(2);
        expect(result.batches[0]?.quadCount).toBe(2);
        expect(result.batches[0]?.key.sourceKey).toBe('texture:atlas/a');
        expect(result.batches[1]?.quadCount).toBe(1);
        expect(result.batches[1]?.key.sourceKey).toBe('material:mat/b');
    });

    it('writes transformed quad vertices using row-major transform data', () => {
        const builder = new Render2DSpriteBatchBuilder();
        const translation = [
            1, 0, 0, 3,
            0, 1, 0, 4,
            0, 0, 1, 2,
            0, 0, 0, 1,
        ] as const;

        const result = builder.build([
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: translation,
                size: { width: 2, height: 2 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                color: Color.WHITE,
            },
        ]);

        const view = new Float32Array(result.vertexData.buffer, result.vertexData.byteOffset, result.vertexData.byteLength / 4);

        expect(view[0]).toBe(2);
        expect(view[1]).toBe(3);
        expect(view[2]).toBe(2);
        expect(view[6]).toBe(4);
        expect(view[7]).toBe(3);
        expect(view[8]).toBe(2);
        expect(view[12]).toBe(4);
        expect(view[13]).toBe(5);
        expect(view[14]).toBe(2);
        expect(view[18]).toBe(2);
        expect(view[19]).toBe(5);
        expect(view[20]).toBe(2);
    });

    it('splits batches when the configured quad limit is reached', () => {
        const builder = new Render2DSpriteBatchBuilder({ maxBatchQuads: 1 });
        const result = builder.build([
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                color: Color.WHITE,
            },
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                color: Color.WHITE,
            },
        ]);

        expect(result.batches).toHaveLength(2);
        expect(result.batches[0]?.indexOffset).toBe(0);
        expect(result.batches[1]?.indexOffset).toBe(6);
    });

    it('splits batches when clip rect state changes', () => {
        const builder = new Render2DSpriteBatchBuilder();
        const result = builder.build([
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                clipRect: { x: 0, y: 0, width: 64, height: 64 },
                color: Color.WHITE,
            },
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                clipRect: { x: 0, y: 0, width: 64, height: 64 },
                color: Color.WHITE,
            },
            {
                source: { kind: 'texture', textureId: 'atlas/a' },
                worldMatrix: identity,
                size: { width: 1, height: 1 },
                anchor: { x: 0.5, y: 0.5 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                clipRect: { x: 32, y: 0, width: 64, height: 64 },
                color: Color.WHITE,
            },
        ]);

        expect(result.batches).toHaveLength(2);
        expect(result.batches[0]?.quadCount).toBe(2);
        expect(result.batches[0]?.key.clipRect).toEqual({
            x: 0,
            y: 0,
            width: 64,
            height: 64,
        });
        expect(result.batches[1]?.quadCount).toBe(1);
    });

    it('emits nine-slice quads from a single sprite submission', () => {
        const builder = new Render2DSpriteBatchBuilder();
        const result = builder.build([
            {
                source: { kind: 'texture', textureId: 'atlas/panel' },
                worldMatrix: identity,
                size: { width: 30, height: 18 },
                anchor: { x: 0, y: 0 },
                uvRect: { x: 0.25, y: 0.125, width: 0.5, height: 0.5 },
                color: Color.WHITE,
                slice: {
                    sourceSize: { width: 10, height: 6 },
                    border: { left: 2, right: 2, top: 1, bottom: 1 },
                },
            },
        ]);

        expect(result.spriteCount).toBe(1);
        expect(result.quadCount).toBe(9);
        expect(result.vertexCount).toBe(36);
        expect(result.indexCount).toBe(54);
        expect(result.batches[0]?.quadCount).toBe(9);

        const view = new Float32Array(
            result.vertexData.buffer,
            result.vertexData.byteOffset,
            result.vertexData.byteLength / 4
        );

        expect(view[0]).toBe(0);
        expect(view[6]).toBe(6);
    });
});