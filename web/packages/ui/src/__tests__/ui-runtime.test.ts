import { describe, expect, it } from 'vitest';
import { FontRegistry, UIRuntime, createRuntimeFrameSource, renderUIFrame } from '../index';

const createFontAsset = (family = 'TestSans') => ({
    family,
    face: 'Regular',
    style: 'normal' as const,
    weight: 400 as const,
    ascent: 800,
    descent: 200,
    lineGap: 0,
    unitsPerEm: 1000,
    defaultAdvance: 500,
    fallbackCodePoint: 63,
    glyphs: [32, 63, 65, 66, 67, 68, 69, 72, 76, 79, 87, 97, 100, 101, 103, 104, 108, 111, 114, 116, 8230].map(
        (codePoint) => ({
            codePoint,
            advance: codePoint === 32 ? 250 : 500,
            width: codePoint === 32 ? 1 : 480,
            height: codePoint === 32 ? 1 : 720,
        })
    ),
});

describe('@axrone/ui runtime', () => {
    it('lays out stacked widgets and emits quad and text commands', () => {
        const runtime = new UIRuntime({ width: 400, height: 200 });
        runtime.fonts.registerFace(createFontAsset());

        const container = runtime.createWidget({
            layout: {
                width: 220,
                height: 64,
                display: 'stack',
                direction: 'row',
                gap: 8,
                padding: 10,
            },
            style: {
                background: '#223344ff',
            },
        });
        const icon = runtime.createWidget({
            layout: { width: 40, height: 20 },
            style: { background: '#55aa22ff' },
        });
        const label = runtime.createWidget({
            layout: { height: 20 },
            text: { value: 'AB', family: 'TestSans', size: 20 },
            style: { color: '#ffffffff' },
        });

        runtime.appendChild(runtime.root, container);
        runtime.appendChild(container, icon);
        runtime.appendChild(container, label);

        const frame = runtime.commit();
        const iconBox = runtime.getLayoutBox(icon);
        const labelBox = runtime.getLayoutBox(label);

        expect(iconBox.x).toBeCloseTo(10);
        expect(labelBox.x).toBeGreaterThan(iconBox.x + iconBox.width);
        expect(frame.commands.some((command) => command.kind === 'quad')).toBe(true);

        const textCommand = frame.commands.find((command) => command.kind === 'text');
        expect(textCommand).toBeDefined();
        if (textCommand && textCommand.kind === 'text') {
            expect(textCommand.layout.glyphs.length).toBeGreaterThan(0);
        }
    });

    it('moves focus with directional and linear navigation', () => {
        const runtime = new UIRuntime({ width: 320, height: 120 });

        const row = runtime.createWidget({
            layout: {
                width: 240,
                height: 40,
                display: 'stack',
                direction: 'row',
                gap: 12,
            },
        });
        const first = runtime.createWidget({ layout: { width: 48, height: 24 }, interactive: true, focus: { focusable: true } });
        const second = runtime.createWidget({ layout: { width: 48, height: 24 }, interactive: true, focus: { focusable: true } });
        const third = runtime.createWidget({ layout: { width: 48, height: 24 }, interactive: true, focus: { focusable: true } });

        runtime.appendChild(runtime.root, row);
        runtime.appendChild(row, first);
        runtime.appendChild(row, second);
        runtime.appendChild(row, third);
        runtime.commit();

        expect(runtime.setFocus(first)).toBe(true);
        expect(runtime.moveFocus('right')).toBe(second);
        expect(runtime.moveFocus('forward')).toBe(third);
    });

    it('loads font assets with retry and allocates atlas entries', async () => {
        let attempts = 0;
        const asset = createFontAsset('RemoteSans');
        const fonts = new FontRegistry({
            fetch: (async () => {
                attempts += 1;
                if (attempts === 1) {
                    return {
                        ok: false,
                        status: 503,
                        json: async () => asset,
                    } as Response;
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => asset,
                } as Response;
            }) as typeof fetch,
        });

        const faceId = await fonts.load(
            { kind: 'url', url: 'https://example.com/font.json' },
            { retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 } }
        );

        expect(attempts).toBe(2);
        expect(fonts.getFaceInfo(faceId)?.family).toBe('RemoteSans');
        const glyph = fonts.ensureGlyph(faceId, 65);
        expect(glyph).not.toBeNull();
        expect(glyph?.pageWidth).toBeGreaterThan(0);
        expect(glyph?.pageHeight).toBeGreaterThan(0);
        expect(glyph?.format).toBe('alpha8');
        fonts.dispose();
    });

    it('resolves runtime frames through the renderer seam helpers', () => {
        const runtime = new UIRuntime({ width: 96, height: 48 });
        const box = runtime.createWidget({
            layout: { width: 24, height: 12 },
            style: { background: '#ffffffff' },
        });
        runtime.appendChild(runtime.root, box);

        const source = createRuntimeFrameSource(runtime);
        let seenCommands = 0;
        const frame = renderUIFrame(
            {
                render(resolved) {
                    seenCommands = resolved.commands.length;
                },
            },
            source,
            { width: 96, height: 48 }
        );

        expect(frame).not.toBeNull();
        expect(seenCommands).toBeGreaterThan(0);
    });

    it('renders custom widget payloads and restores snapshots', () => {
        type Payload = { kind: 'badge'; label: string };

        const registerBadge = (runtime: UIRuntime<Payload>) => {
            runtime.registry.register({
                type: 'badge',
                render: ({ props, push }) => {
                    push({ kind: 'badge', label: String(props.label ?? '') });
                },
            });
        };

        const runtime = new UIRuntime<Payload>({ width: 120, height: 40 });
        registerBadge(runtime);

        const badge = runtime.createWidget({
            controller: 'badge',
            props: { label: 'hello' },
            layout: { width: 32, height: 16 },
        });

        runtime.appendChild(runtime.root, badge);
        const frame = runtime.commit();
        const custom = frame.commands.find((command) => command.kind === 'custom');

        expect(custom).toBeDefined();
        if (custom && custom.kind === 'custom') {
            expect(custom.payload).toEqual({ kind: 'badge', label: 'hello' });
        }

        const snapshot = runtime.snapshot();
        const restored = new UIRuntime<Payload>();
        registerBadge(restored);
        restored.restore(snapshot);
        const restoredFrame = restored.commit();

        expect(restored.getWidgetCount()).toBe(1);
        expect(restoredFrame.commands.some((command) => command.kind === 'custom')).toBe(true);
    });
});