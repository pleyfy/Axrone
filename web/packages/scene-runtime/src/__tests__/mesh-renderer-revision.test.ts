import { describe, expect, it } from 'vitest';
import { MeshRenderer } from '../components/mesh-renderer';

describe('MeshRenderer revision', () => {
    it('advances on materialId, visible, setUniform and morph changes', () => {
        const renderer = new MeshRenderer({ meshId: 'mesh', materialId: 'mat-a' });
        const initial = renderer.revision;

        renderer.materialId = 'mat-b';
        expect(renderer.revision).toBeGreaterThan(initial);

        const afterMaterial = renderer.revision;
        renderer.visible = false;
        expect(renderer.revision).toBeGreaterThan(afterMaterial);

        const afterVisible = renderer.revision;
        renderer.setUniform('u_Color', [1, 1, 1, 1]);
        expect(renderer.revision).toBeGreaterThan(afterVisible);

        const afterUniform = renderer.revision;
        renderer.morph = { weights: [0.25] };
        expect(renderer.revision).toBeGreaterThan(afterUniform);
    });

    it('does not advance when a mutator is a no-op', () => {
        const renderer = new MeshRenderer({ meshId: 'mesh', visible: true });
        const initial = renderer.revision;

        renderer.visible = true;
        renderer.meshId = 'mesh';
        expect(renderer.revision).toBe(initial);

        renderer.morph = { weights: [0.5] };
        const afterMorph = renderer.revision;
        renderer.morph = { weights: [0.5] };
        expect(renderer.revision).toBe(afterMorph);
    });

    it('advances on meshId, passId, renderOrder, receiveLighting, skin and deserialize', () => {
        const renderer = new MeshRenderer();
        const steps: (() => void)[] = [
            () => {
                renderer.meshId = 'mesh:new';
            },
            () => {
                renderer.passId = 'overlay';
            },
            () => {
                renderer.renderOrder = 5;
            },
            () => {
                renderer.receiveLighting = false;
            },
            () => {
                renderer.skin = { jointNodeIds: ['joint'] };
            },
            () => {
                renderer.deserialize(renderer.serialize());
            },
        ];

        for (const step of steps) {
            const before = renderer.revision;
            step();
            expect(renderer.revision).toBeGreaterThan(before);
        }
    });
});
