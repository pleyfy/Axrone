import { Scene, Transform, Vec3, createUnlitColorShaderDefinition } from '@axrone/core';
import { Quat } from '@axrone/numeric';
import { UIRuntime } from '@axrone/ui';
import { attachUIOverlayToScene } from '@axrone/ui-webgl2';
import { bindSceneToContainer } from './example-runtime';
import type { ExampleContext, SceneExample } from './example-types';

const OVERLAY_EDITOR_TEXT = 'SCENE UI RANGE';

const GLYPH_PATTERNS = {
    '?': ['.###.', '...#.', '..#..', '..#..', '..#..', '.....', '..#..'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '...#.', '..##.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
} as const;

const scaleGlyphPattern = (rows: readonly string[], scale = 2): Uint8Array => {
    const sourceHeight = rows.length;
    const sourceWidth = rows[0]?.length ?? 0;
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const data = new Uint8Array(width * height);

    for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
        for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
            const filled = rows[sourceY]?.[sourceX] === '#';
            const alpha = filled ? 255 : 0;
            for (let offsetY = 0; offsetY < scale; offsetY += 1) {
                for (let offsetX = 0; offsetX < scale; offsetX += 1) {
                    const x = sourceX * scale + offsetX;
                    const y = sourceY * scale + offsetY;
                    data[y * width + x] = alpha;
                }
            }
        }
    }

    return data;
};

const createFontAsset = () => ({
    family: 'OverlayBitmap',
    face: 'Regular',
    style: 'normal' as const,
    weight: 400 as const,
    ascent: 18,
    descent: 6,
    lineGap: 2,
    unitsPerEm: 24,
    defaultAdvance: 12,
    fallbackCodePoint: 63,
    glyphs: ['?', ' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'C', 'D', 'E', 'F', 'G', 'I', 'M', 'N', 'O', 'R', 'S', 'U', 'W', 'X'].map(
        (character) => {
            if (character === ' ') {
                return {
                    codePoint: 32,
                    advance: 6,
                    width: 1,
                    height: 1,
                };
            }

            const pattern = GLYPH_PATTERNS[character as keyof typeof GLYPH_PATTERNS] ?? GLYPH_PATTERNS['?'];
            const data = scaleGlyphPattern(pattern);
            return {
                codePoint: character.charCodeAt(0),
                advance: 12,
                width: 10,
                height: 14,
                data,
                format: 'alpha8' as const,
                rowStride: 10,
            };
        }
    ),
});

const createOverlayTextureData = (): number[] => {
    const size = 8;
    const data: number[] = [];

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const diagonal = (x + y) / (size * 2 - 2);
            const stripe = (x + y) % 2 === 0 ? 1 : 0.45;
            data.push(Math.round((24 + 80 * diagonal) * stripe));
            data.push(Math.round((120 + 110 * (1 - diagonal)) * stripe));
            data.push(Math.round((210 + 30 * diagonal) * stripe));
            data.push(255);
        }
    }

    return data;
};

const pad3 = (value: number): string => value.toString().padStart(3, '0');

const createStatsLabel = (frame: number, drawCalls: number): string =>
    `FRAME ${pad3(frame % 1000)} DRAWS ${pad3(drawCalls % 1000)}`;

const resolveEditorState = (frame: number) => {
    const caretIndex = frame % (OVERLAY_EDITOR_TEXT.length + 1);
    const selectionStart = Math.max(0, caretIndex - 4);
    const selectionEnd = Math.min(OVERLAY_EDITOR_TEXT.length, selectionStart + 6);
    return {
        caretIndex,
        selectionStart,
        selectionEnd,
        caretVisible: Math.floor(frame / 24) % 2 === 0,
    };
};

const sceneUiOverlayExample: SceneExample = {
    id: 'scene-ui-overlay',
    title: 'Scene UI Overlay',
    description:
        'Binds retained UI into the live Scene after-frame phase with scene-resolved image resources and editor-style text overlays.',
    tags: ['scene', 'ui', 'overlay', 'webgl2'],
    order: 5,
    async mount({ container }: ExampleContext) {
        container.replaceChildren();

        const scene = new Scene({
            width: container.clientWidth || 960,
            height: container.clientHeight || 540,
            autoStart: true,
            parent: container,
            appendToDom: true,
            createCanvas: () => document.createElement('canvas'),
        });

        scene.createBoxMesh('overlay-demo-box');
        const overlayShader = scene.registerShader(createUnlitColorShaderDefinition('overlay/unlit-color'));
        scene.createMaterial({
            id: 'overlay-demo-material',
            shaderId: overlayShader.id,
            uniforms: {
                u_Color: [0.18, 0.58, 0.96, 1],
            },
        });
        await scene.registerTexture({
            id: 'overlay-preview-texture',
            source: {
                kind: 'data',
                width: 8,
                height: 8,
                channels: 4,
                data: createOverlayTextureData(),
            },
            generateMipmaps: true,
        });
        scene.createMaterial({
            id: 'overlay-ui-preview-material',
            shaderId: overlayShader.id,
            uniforms: {
                u_Color: [1, 1, 1, 1],
            },
            textures: {
                u_PreviewTexture: 'overlay-preview-texture',
            },
        });

        scene.createCameraActor({ name: 'OverlayCamera' }, { primary: true, fieldOfView: 60 });

        const cube = scene.createRenderableActor(
            { name: 'OverlayCube' },
            { meshId: 'overlay-demo-box', materialId: 'overlay-demo-material' }
        );
        cube.requireComponent(Transform).position = new Vec3(0, 0, -4);

        const runtime = new UIRuntime({ width: scene.canvas.width, height: scene.canvas.height });
        runtime.fonts.registerFace(createFontAsset());

        const panel = runtime.createWidget({
            layout: {
                position: 'absolute',
                anchor: 'top-left',
                inset: { top: 24, left: 24 },
                width: 368,
                height: 232,
                padding: 20,
                display: 'stack',
                direction: 'column',
                gap: 12,
            },
            style: {
                background: '#0f172acc',
                borderColor: '#38bdf8aa',
                borderWidth: 1,
                radius: 18,
            },
        });
        const title = runtime.createWidget({
            text: {
                value: 'AXRONE UI',
                family: 'OverlayBitmap',
                size: 22,
                color: '#f8fafcff',
            },
            layout: { height: 30 },
        });
        const caption = runtime.createWidget({
            text: {
                value: 'SCENE RESOURCE IMAGE',
                family: 'OverlayBitmap',
                size: 14,
                color: '#cbd5e1ff',
            },
            layout: { height: 18 },
        });
        const body = runtime.createWidget({
            layout: {
                display: 'stack',
                direction: 'row',
                gap: 14,
                height: 116,
            },
        });
        const preview = runtime.createWidget({
            layout: { width: 116, height: 116 },
            style: {
                background: '#020617ff',
                borderColor: '#22d3ee88',
                borderWidth: 1,
                radius: 16,
                clip: true,
            },
            image: {
                source: {
                    kind: 'material',
                    materialId: 'overlay-ui-preview-material',
                    textureBinding: 'u_PreviewTexture',
                    width: 8,
                    height: 8,
                },
                fit: 'cover',
                sampling: 'linear',
            },
        });
        const copy = runtime.createWidget({
            layout: {
                display: 'stack',
                direction: 'column',
                gap: 12,
                grow: 1,
                height: 116,
            },
        });
        const editorLine = runtime.createWidget({
            text: {
                value: OVERLAY_EDITOR_TEXT,
                family: 'OverlayBitmap',
                size: 18,
                color: '#f8fafcff',
                shadowColor: '#020617cc',
                shadowOffsetX: 2,
                shadowOffsetY: 2,
                underline: true,
                underlineColor: '#38bdf8ff',
                underlineThickness: 2,
                underlineOffset: 2,
                selectionStart: 0,
                selectionEnd: 6,
                selectionColor: '#0ea5e966',
                caretIndex: 6,
                caretColor: '#f8fafcff',
                caretWidth: 2,
                caretInset: 1,
            },
            layout: { height: 30 },
        });
        const source = runtime.createWidget({
            text: {
                value: 'SCENE IMAGE',
                family: 'OverlayBitmap',
                size: 14,
                color: '#7dd3fcff',
            },
            layout: { height: 18 },
        });
        const stats = runtime.createWidget({
            text: {
                value: createStatsLabel(0, 0),
                family: 'OverlayBitmap',
                size: 14,
                color: '#93c5fdff',
            },
            layout: { height: 18 },
        });

        runtime.appendChild(runtime.root, panel);
        runtime.appendChild(panel, title);
        runtime.appendChild(panel, caption);
        runtime.appendChild(panel, body);
        runtime.appendChild(body, preview);
        runtime.appendChild(body, copy);
        runtime.appendChild(copy, editorLine);
        runtime.appendChild(copy, source);
        runtime.appendChild(copy, stats);

        const cleanupResize = bindSceneToContainer(scene, container, 960, 540);
        const overlay = attachUIOverlayToScene(scene, {
            ui: () => runtime.commit({ width: scene.canvas.width, height: scene.canvas.height }),
            priority: -1000,
        });

        scene.loop.addSystem({
            id: 'scene-ui-overlay.stats',
            priority: 100,
            enabled: true,
            update(context) {
                const angle = context.elapsed * 0.001;
                cube.requireComponent(Transform).rotation = Quat.fromEuler(0, angle, angle * 0.5);
            },
            afterFrame(context) {
                const editor = resolveEditorState(context.frame);
                runtime.updateWidget(editorLine, {
                    text: {
                        selectionStart: editor.selectionStart,
                        selectionEnd: editor.selectionEnd,
                        caretIndex: editor.caretIndex,
                        caretColor: editor.caretVisible ? '#f8fafcff' : '#00000000',
                    },
                });
                runtime.updateWidget(stats, {
                    text: {
                        value: createStatsLabel(context.frame, scene.renderStats.drawCalls),
                    },
                });
            },
        });

        const root = globalThis as { scene?: Scene; uiRuntime?: UIRuntime };
        root.scene = scene;
        root.uiRuntime = runtime;

        return {
            dispose() {
                cleanupResize();
                overlay.dispose();
                scene.loop.removeSystem('scene-ui-overlay.stats');
                if (root.scene === scene) {
                    delete root.scene;
                }
                if (root.uiRuntime === runtime) {
                    delete root.uiRuntime;
                }
                runtime.dispose();
                scene.dispose();
                container.replaceChildren();
            },
        };
    },
};

export default sceneUiOverlayExample;