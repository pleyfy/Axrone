import { describe, expect, it, vi } from 'vitest';
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
            expect(textCommand.x).toBe(labelBox.contentX);
            expect(textCommand.y).toBe(labelBox.contentY);
        }
    });

    it('measures intrinsic image widgets and emits image commands', () => {
        const runtime = new UIRuntime({ width: 320, height: 180 });
        const image = runtime.createWidget({
            layout: { width: 'content', height: 'content' },
            image: {
                source: {
                    kind: 'texture',
                    resourceId: 'ui:hero',
                    width: 128,
                    height: 64,
                },
                fit: 'none',
            },
        });

        runtime.appendChild(runtime.root, image);

        const frame = runtime.commit();
        const box = runtime.getLayoutBox(image);
        const command = frame.commands.find((entry) => entry.kind === 'image');

        expect(box.width).toBe(128);
        expect(box.height).toBe(64);
        expect(frame.metrics.imageCommandCount).toBe(1);
        expect(command).toBeDefined();
        if (command && command.kind === 'image') {
            expect(command.source.kind).toBe('texture');
            expect(command.width).toBe(128);
            expect(command.height).toBe(64);
        }
    });

    it('emits advanced text appearance for sdf-ready glyph pipelines', () => {
        const runtime = new UIRuntime({ width: 240, height: 80 });
        runtime.fonts.registerFace({
            family: 'SdfSans',
            face: 'Regular',
            style: 'normal',
            weight: 400,
            ascent: 800,
            descent: 200,
            lineGap: 0,
            unitsPerEm: 1000,
            defaultAdvance: 500,
            fallbackCodePoint: 63,
            glyphs: [32, 63, 65].map((codePoint) => ({
                codePoint,
                advance: codePoint === 32 ? 250 : 500,
                width: codePoint === 32 ? 1 : 480,
                height: codePoint === 32 ? 1 : 720,
                format: 'sdf8' as const,
                distanceRange: 6,
            })),
        });
        const label = runtime.createWidget({
            layout: { width: 120, height: 28 },
            text: {
                value: 'A',
                family: 'SdfSans',
                size: 20,
                outlineColor: '#22d3eeff',
                outlineWidth: 1.5,
                edgeSoftness: 1.25,
            },
        });

        runtime.appendChild(runtime.root, label);

        const frame = runtime.commit();
        const command = frame.commands.find((entry) => entry.kind === 'text');

        expect(command).toBeDefined();
        if (command && command.kind === 'text') {
            expect(command.outlineWidth).toBe(1.5);
            expect(command.edgeSoftness).toBe(1.25);
            expect(command.outlineColor.g).toBeGreaterThan(0);
            expect(command.layout.glyphs[0]?.atlasEntry?.distanceRange).toBe(6);
            expect(command.layout.glyphs[0]?.atlasEntry?.format).toBe('sdf8');
        }
    });

    it('composes selection, shadow, underline and caret commands for rich text widgets', () => {
        const runtime = new UIRuntime({ width: 240, height: 120 });
        runtime.fonts.registerFace(createFontAsset('RichTextSans'));

        const label = runtime.createWidget({
            layout: { width: 160, height: 32 },
            text: {
                value: 'AB',
                family: 'RichTextSans',
                size: 20,
                shadowColor: '#00000099',
                shadowOffsetX: 2,
                shadowOffsetY: 1,
                underline: true,
                underlineColor: '#22d3eeff',
                underlineThickness: 2,
                selectionStart: 0,
                selectionEnd: 1,
                selectionColor: '#1d4ed8aa',
                caretIndex: 1,
                caretColor: '#f8fafcff',
                caretWidth: 2,
            },
        });

        runtime.appendChild(runtime.root, label);

        const frame = runtime.commit();
        const textCommands = frame.commands.filter((entry) => entry.kind === 'text');
        const quadCommands = frame.commands.filter((entry) => entry.kind === 'quad');
        const caretQuad = quadCommands.find((entry) => entry.kind === 'quad' && entry.width === 2);
        const underlineQuad = quadCommands.find((entry) => entry.kind === 'quad' && entry.height === 2);

        expect(textCommands).toHaveLength(2);
        expect(frame.metrics.textCommandCount).toBe(2);
        expect(quadCommands.length).toBeGreaterThanOrEqual(3);
        expect(caretQuad).toBeDefined();
        expect(underlineQuad).toBeDefined();
        if (textCommands[0] && textCommands[0].kind === 'text') {
            expect(textCommands[0].x).toBeGreaterThan(0);
        }
    });

    it('keeps empty text widgets render-safe and preserves caret output', () => {
        const runtime = new UIRuntime({ width: 180, height: 80 });
        runtime.fonts.registerFace(createFontAsset('InputSans'));

        const input = runtime.createWidget({
            layout: { width: 120, height: 24 },
            text: {
                value: 'A',
                family: 'InputSans',
                size: 18,
                caretIndex: 1,
                caretColor: '#f8fafcff',
                caretWidth: 2,
            },
        });

        runtime.appendChild(runtime.root, input);
        runtime.commit();

        runtime.updateWidget(input, {
            text: {
                value: '',
                caretIndex: 0,
                caretColor: '#f8fafcff',
                caretWidth: 2,
            },
        });

        const frame = runtime.commit();
        const textCommands = frame.commands.filter((entry) => entry.kind === 'text');
        const caretQuad = frame.commands.find((entry) => entry.kind === 'quad' && entry.width === 2);

        expect(textCommands).toHaveLength(0);
        expect(caretQuad).toBeDefined();
        expect(runtime.getTextLayout(input)?.carets[0]?.index).toBe(0);
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

    it('routes text input events to the focused widget', () => {
        const runtime = new UIRuntime({ width: 200, height: 80 });
        let received = '';

        const input = runtime.createWidget({
            layout: { width: 120, height: 24 },
            interactive: true,
            focus: { focusable: true },
            handlers: {
                textInput: (event) => {
                    received += event.text;
                    return true;
                },
            },
        });

        runtime.appendChild(runtime.root, input);
        runtime.commit();

        expect(runtime.setFocus(input)).toBe(true);
        expect(runtime.dispatchInput({ type: 'text', text: 'ABC' })).toBe(true);
        expect(received).toBe('ABC');
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

    it('loads binary font sources through the dynamic runtime pipeline and caches rasterized glyph sizes', async () => {
        const rasterizeGlyph = vi.fn((codePoint: number, rasterSize: number) => ({
            codePoint,
            rasterSize,
            width: Math.max(1, rasterSize),
            height: Math.max(1, Math.ceil(rasterSize * 1.2)),
            data: new Uint8Array(Math.max(1, rasterSize) * Math.max(1, Math.ceil(rasterSize * 1.2))).fill(255),
            format: 'alpha8' as const,
            rowStride: Math.max(1, rasterSize),
        }));
        const runtimeFactory = {
            create: vi.fn(async () => ({
                info: {
                    family: 'VectorSans',
                    face: 'Regular',
                    style: 'normal' as const,
                    weight: 400 as const,
                    locale: '',
                    ascent: 800,
                    descent: 200,
                    lineGap: 0,
                    unitsPerEm: 1000,
                    defaultAdvance: 500,
                    fallbackCodePoint: 63,
                },
                measureGlyph: (codePoint: number) => ({
                    codePoint,
                    advance: codePoint === 32 ? 250 : 500,
                    width: codePoint === 32 ? 1 : 480,
                    height: codePoint === 32 ? 1 : 720,
                }),
                rasterizeGlyph,
                getKerning: (leftCodePoint: number, rightCodePoint: number) =>
                    leftCodePoint === 65 && rightCodePoint === 86 ? -40 : 0,
                dispose: vi.fn(),
            })),
        };
        const fonts = new FontRegistry({
            dynamicRuntimeFactory: runtimeFactory,
        });

        const faceId = await fonts.load({
            kind: 'buffer',
            data: new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00]),
            contentType: 'font/ttf',
            family: 'VectorSans',
        });
        const first = fonts.measureGlyph(faceId, 65, 18, 86);
        const second = fonts.measureGlyph(faceId, 65, 18, 86);

        expect(runtimeFactory.create).toHaveBeenCalledTimes(1);
        expect(fonts.getFaceInfo(faceId)?.family).toBe('VectorSans');
        expect(first.advance).toBeCloseTo((500 - 40) * 0.018);
        expect(first.atlasEntry).not.toBeNull();
        expect(first.atlasEntry?.rasterSize).toBe(18);
        expect(second.atlasEntry?.page).toBe(first.atlasEntry?.page);
        expect(rasterizeGlyph).toHaveBeenCalledTimes(1);
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
