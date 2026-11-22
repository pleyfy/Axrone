import { describe, expect, it } from 'vitest';
import { UIRuntime } from '../runtime';
import type { ImageRenderCommand } from '../types';

const SOURCE = { kind: 'texture' as const, resourceId: 'ui:panel', width: 64, height: 64 };

const createRuntime = (image: Record<string, unknown>) => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    const widget = runtime.createWidget({
        layout: {
            position: 'absolute',
            inset: { left: 0, top: 0 },
            width: 200,
            height: 100,
            padding: 12,
        },
        style: { background: '#0a74daff' },
        image: { source: SOURCE, ...image } as never,
    });
    runtime.appendChild(runtime.root, widget);
    return runtime;
};

const imageCommands = (runtime: UIRuntime): readonly ImageRenderCommand[] =>
    runtime.commit().commands.filter(
        (command): command is ImageRenderCommand => command.kind === 'image'
    );

describe('image bleed', () => {
    it('draws inside the padded content box by default', () => {
        const runtime = createRuntime({ fit: 'fill' });

        const [command] = imageCommands(runtime);
        expect(command).toBeDefined();
        expect(command!.x).toBeCloseTo(12);
        expect(command!.y).toBeCloseTo(12);
        expect(command!.width).toBeCloseTo(176);
        expect(command!.height).toBeCloseTo(76);

        runtime.dispose();
    });

    it('draws across the full border box when bleed is enabled', () => {
        const runtime = createRuntime({ fit: 'fill', bleed: true });

        const [command] = imageCommands(runtime);
        expect(command).toBeDefined();
        expect(command!.x).toBeCloseTo(0);
        expect(command!.y).toBeCloseTo(0);
        expect(command!.width).toBeCloseTo(200);
        expect(command!.height).toBeCloseTo(100);

        runtime.dispose();
    });

    it('aligns contained images within the border box when bleeding', () => {
        const runtime = createRuntime({ fit: 'contain', bleed: true, alignX: 0, alignY: 0 });

        const [command] = imageCommands(runtime);
        expect(command).toBeDefined();
        // 64x64 contained in 200x100 scales by 100/64 -> 100x100.
        expect(command!.width).toBeCloseTo(100);
        expect(command!.height).toBeCloseTo(100);
        expect(command!.x).toBeCloseTo(0);
        expect(command!.y).toBeCloseTo(0);

        runtime.dispose();
    });

    it('bleeds sliced images across the border box', () => {
        const runtime = createRuntime({ fit: 'fill', bleed: true, border: 8 });

        const [command] = imageCommands(runtime);
        expect(command).toBeDefined();
        expect(command!.width).toBeCloseTo(200);
        expect(command!.height).toBeCloseTo(100);
        expect(command!.border).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });

        runtime.dispose();
    });

    it('keeps bleed false when it is not authored', () => {
        const runtime = createRuntime({ fit: 'fill' });
        const [command] = imageCommands(runtime);
        expect(command!.width).toBeCloseTo(176);
        runtime.dispose();
    });

    it('round-trips bleed through the snapshot', () => {
        const runtime = createRuntime({ fit: 'fill', bleed: true });

        const snapshot = runtime.snapshot();
        const node = snapshot.root.children[0];
        expect(node?.image?.bleed).toBe(true);

        runtime.dispose();
    });
});
