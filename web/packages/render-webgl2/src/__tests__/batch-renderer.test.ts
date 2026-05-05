import { Mat4 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { BatchRenderer } from '../batch/batch-renderer';

const createRenderer = () => new BatchRenderer({} as WebGL2RenderingContext, { sortByDepth: true });

describe('BatchRenderer', () => {
    it('calculates depth from row-major translation slots', () => {
        const renderer = createRenderer();
        const depth = (
            renderer as unknown as {
                calculateGroupDepth(group: {
                    isEmpty: boolean;
                    instances: readonly { visible: boolean; worldMatrix: Mat4 }[];
                }, viewMatrix: Mat4): number;
            }
        ).calculateGroupDepth(
            {
                isEmpty: false,
                instances: [
                    {
                        visible: true,
                        worldMatrix: Mat4.translate({ x: 0, y: 0, z: -6 }),
                    },
                ],
            },
            new Mat4()
        );

        expect(depth).toBe(-6);
    });
});