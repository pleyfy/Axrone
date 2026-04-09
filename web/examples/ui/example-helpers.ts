import { Scene, Transform, Vec3, createUnlitColorShaderDefinition } from '@axrone/core';
import { Quat } from '@axrone/numeric';
import { UIRuntime } from '@axrone/ui';
import type { TextBlockInput, WidgetLayoutInput, WidgetStyleInput } from '@axrone/ui';
import { attachUIOverlayToScene } from '@axrone/ui-webgl2';
import { bindSceneToContainer } from '../example-runtime';
import type { ExampleHandle } from '../example-types';

export const UI_DEMO_FONT_FAMILY = 'OverlayBitmap';

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
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    ':': ['.....', '..#..', '.....', '.....', '..#..', '.....', '.....'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '.....'],
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
            const alpha = rows[sourceY]?.[sourceX] === '#' ? 255 : 0;
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

type DemoPalette = 'cyan' | 'sunset' | 'lime' | 'violet';

const DEMO_PALETTES: Record<DemoPalette, readonly [number, number, number]> = {
    cyan: [24, 170, 244],
    sunset: [248, 113, 113],
    lime: [132, 204, 22],
    violet: [167, 139, 250],
};

export const createUIDemoFontAsset = () => ({
    family: UI_DEMO_FONT_FAMILY,
    face: 'Regular',
    style: 'normal' as const,
    weight: 400 as const,
    ascent: 14,
    descent: 4,
    lineGap: 2,
    unitsPerEm: 20,
    defaultAdvance: 12,
    fallbackCodePoint: 63,
    glyphs: Object.entries(GLYPH_PATTERNS).map(([character, pattern]) => {
        if (character === ' ') {
            return {
                codePoint: 32,
                advance: 6,
                width: 1,
                height: 1,
            };
        }

        const data = scaleGlyphPattern(pattern);
        const isPunctuation = character === '.' || character === ':';
        return {
            codePoint: character.charCodeAt(0),
            advance: character === '-' ? 10 : isPunctuation ? 6 : 12,
            width: 10,
            height: 14,
            data,
            format: 'alpha8' as const,
            rowStride: 10,
        };
    }),
});

export const createUIDemoTextureData = (palette: DemoPalette = 'cyan', size = 8): number[] => {
    const [r, g, b] = DEMO_PALETTES[palette];
    const data: number[] = [];

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const diagonal = (x + y) / Math.max(1, size * 2 - 2);
            const ring = Math.sin((x + 0.5) * 0.85) * Math.cos((y + 0.5) * 0.85);
            const stripe = (x + y) % 2 === 0 ? 1 : 0.55;
            const intensity = Math.max(0.28, 0.72 + ring * 0.22) * stripe;
            data.push(Math.round((r * (1 - diagonal) + 255 * diagonal * 0.18) * intensity));
            data.push(Math.round((g * (0.75 + diagonal * 0.25)) * intensity));
            data.push(Math.round((b * (0.6 + diagonal * 0.4)) * intensity));
            data.push(255);
        }
    }

    return data;
};

const pointerPayload = (event: PointerEvent | WheelEvent, scene: Scene) => {
    const rect = scene.canvas.getBoundingClientRect();
    const scaleX = scene.canvas.width / Math.max(1, rect.width || scene.canvas.width || 1);
    const scaleY = scene.canvas.height / Math.max(1, rect.height || scene.canvas.height || 1);
    const clientX = 'clientX' in event ? event.clientX : rect.left - 1;
    const clientY = 'clientY' in event ? event.clientY : rect.top - 1;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
};

export const bindUIRuntimeToCanvas = (scene: Scene, runtime: UIRuntime): (() => void) => {
    const canvas = scene.canvas;
    const bridgeHost = canvas.parentElement ?? document.body;
    const textBridge = document.createElement('textarea');
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';

    textBridge.tabIndex = -1;
    textBridge.setAttribute('aria-hidden', 'true');
    textBridge.setAttribute('autocomplete', 'off');
    textBridge.setAttribute('autocorrect', 'off');
    textBridge.setAttribute('autocapitalize', 'off');
    textBridge.spellcheck = false;
    textBridge.style.position = 'fixed';
    textBridge.style.left = '-10000px';
    textBridge.style.top = '0';
    textBridge.style.width = '1px';
    textBridge.style.height = '1px';
    textBridge.style.opacity = '0';
    textBridge.style.pointerEvents = 'none';
    textBridge.style.border = '0';
    textBridge.style.padding = '0';
    textBridge.style.resize = 'none';
    bridgeHost.appendChild(textBridge);

    const focusTextBridge = () => {
        if (!canvas.isConnected) {
            return;
        }
        if (document.activeElement !== textBridge) {
            textBridge.focus({ preventScroll: true });
        }
        const caret = textBridge.value.length;
        textBridge.setSelectionRange(caret, caret);
    };

    const scheduleTextBridgeFocus = () => {
        queueMicrotask(() => {
            focusTextBridge();
        });
    };

    let suppressNextTextInput = false;

    const dispatchTextPayload = (text: string) => {
        const normalized = text.replace(/\r\n/g, '\n');
        if (normalized.length === 0) {
            return false;
        }
        return runtime.dispatchInput({ type: 'text', text: normalized });
    };

    const flushTextBridgeValue = () => {
        const text = textBridge.value;
        textBridge.value = '';
        return dispatchTextPayload(text);
    };

    const handlePointerMove = (event: PointerEvent) => {
        const point = pointerPayload(event, scene);
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'move',
            x: point.x,
            y: point.y,
            pointerId: event.pointerId,
            button: event.button,
            buttons: event.buttons,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        });
    };

    const handlePointerDown = (event: PointerEvent) => {
        const point = pointerPayload(event, scene);
        const handled = runtime.dispatchInput({
            type: 'pointer',
            phase: 'down',
            x: point.x,
            y: point.y,
            pointerId: event.pointerId,
            button: event.button,
            buttons: event.buttons,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        });
        if (handled) {
            event.preventDefault();
        }
        scheduleTextBridgeFocus();
    };

    const handlePointerUp = (event: PointerEvent) => {
        const point = pointerPayload(event, scene);
        const handled = runtime.dispatchInput({
            type: 'pointer',
            phase: 'up',
            x: point.x,
            y: point.y,
            pointerId: event.pointerId,
            button: event.button,
            buttons: event.buttons,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        });
        if (handled) {
            event.preventDefault();
        }
    };

    const handlePointerLeave = () => {
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'move',
            x: -1,
            y: -1,
            buttons: 0,
        });
    };

    const handleWheel = (event: WheelEvent) => {
        const point = pointerPayload(event, scene);
        const handled = runtime.dispatchInput({
            type: 'pointer',
            phase: 'wheel',
            x: point.x,
            y: point.y,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        });
        if (handled) {
            event.preventDefault();
        }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        const handled = runtime.dispatchInput({
            type: 'key',
            phase: 'down',
            key: event.key,
            code: event.code,
            repeat: event.repeat,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        });
        if (handled) {
            event.preventDefault();
        }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
        const handled = runtime.dispatchInput({
            type: 'key',
            phase: 'up',
            key: event.key,
            code: event.code,
            repeat: event.repeat,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
        });
        if (handled) {
            event.preventDefault();
        }
    };

    const handleCanvasFocus = () => {
        scheduleTextBridgeFocus();
    };

    const handleTextBridgeFocus = () => {
        runtime.dispatchInput({ type: 'focus', focused: true });
    };

    const handleTextBridgeBlur = () => {
        queueMicrotask(() => {
            if (!canvas.isConnected) {
                return;
            }

            const activeElement = document.activeElement;
            if (
                document.hasFocus() &&
                (activeElement === canvas ||
                    (activeElement instanceof Node && bridgeHost.contains(activeElement)))
            ) {
                scheduleTextBridgeFocus();
                return;
            }

            runtime.dispatchInput({ type: 'focus', focused: false });
        });
    };

    const handleWindowBlur = () => {
        runtime.dispatchInput({ type: 'focus', focused: false });
    };

    const handleBeforeInput = (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }

        let text = '';
        switch (event.inputType) {
            case 'insertText':
            case 'insertCompositionText':
            case 'insertFromComposition':
            case 'insertReplacementText':
                text = event.data ?? '';
                break;
            case 'insertLineBreak':
                text = '\n';
                break;
            default:
                return;
        }

        if (text.length === 0) {
            return;
        }

        textBridge.value = '';
        const handled = dispatchTextPayload(text);
        if (handled) {
            suppressNextTextInput = true;
            event.preventDefault();
        }
    };

    const handleTextInput = (event: Event) => {
        if (suppressNextTextInput) {
            suppressNextTextInput = false;
            textBridge.value = '';
            event.preventDefault();
            return;
        }
        const handled = flushTextBridgeValue();
        if (handled) {
            event.preventDefault();
        }
    };

    const handlePaste = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) {
            return;
        }
        textBridge.value = '';
        const handled = runtime.dispatchInput({ type: 'text', text });
        if (handled) {
            event.preventDefault();
        }
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('focus', handleCanvasFocus);
    textBridge.addEventListener('keydown', handleKeyDown);
    textBridge.addEventListener('keyup', handleKeyUp);
    textBridge.addEventListener('focus', handleTextBridgeFocus);
    textBridge.addEventListener('blur', handleTextBridgeBlur);
    textBridge.addEventListener('beforeinput', handleBeforeInput);
    textBridge.addEventListener('input', handleTextInput);
    textBridge.addEventListener('paste', handlePaste);
    globalThis.addEventListener('pointerup', handlePointerUp);
    globalThis.addEventListener('blur', handleWindowBlur);

    return () => {
        canvas.removeEventListener('pointermove', handlePointerMove);
        canvas.removeEventListener('pointerdown', handlePointerDown);
        canvas.removeEventListener('pointerleave', handlePointerLeave);
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('focus', handleCanvasFocus);
        textBridge.removeEventListener('keydown', handleKeyDown);
        textBridge.removeEventListener('keyup', handleKeyUp);
        textBridge.removeEventListener('focus', handleTextBridgeFocus);
        textBridge.removeEventListener('blur', handleTextBridgeBlur);
        textBridge.removeEventListener('beforeinput', handleBeforeInput);
        textBridge.removeEventListener('input', handleTextInput);
        textBridge.removeEventListener('paste', handlePaste);
        globalThis.removeEventListener('pointerup', handlePointerUp);
        globalThis.removeEventListener('blur', handleWindowBlur);
        textBridge.remove();
    };
};

export interface UIExampleHost extends ExampleHandle {
    readonly scene: Scene;
    readonly runtime: UIRuntime;
    readonly overlayShaderId: string;
}

export interface UIExampleHostOptions {
    readonly container: HTMLElement;
    readonly bindInput?: boolean;
    readonly clearColor?: readonly [number, number, number, number];
    readonly cubeColor?: readonly [number, number, number, number];
}

export const createUIExampleHost = async (
    options: UIExampleHostOptions
): Promise<UIExampleHost> => {
    options.container.replaceChildren();

    const scene = new Scene({
        width: options.container.clientWidth || 960,
        height: options.container.clientHeight || 540,
        autoStart: true,
        parent: options.container,
        appendToDom: true,
        createCanvas: () => document.createElement('canvas'),
        clearColor: options.clearColor ?? [0.03, 0.04, 0.07, 1],
    });

    const overlayShader = scene.registerShader(createUnlitColorShaderDefinition('overlay/unlit-color'));
    scene.createBoxMesh('ui-example.cube');
    scene.createMaterial({
        id: 'ui-example.cube-material',
        shaderId: overlayShader.id,
        uniforms: {
            u_Color: options.cubeColor ?? [0.22, 0.56, 0.93, 1],
        },
    });
    scene.createCameraActor({ name: 'UICamera' }, { primary: true, fieldOfView: 60 });

    const cube = scene.createRenderableActor(
        { name: 'UIExampleCube' },
        { meshId: 'ui-example.cube', materialId: 'ui-example.cube-material' }
    );
    cube.requireComponent(Transform).position = new Vec3(0.9, -0.45, -4.6);

    const runtime = new UIRuntime({ width: scene.canvas.width, height: scene.canvas.height });
    runtime.fonts.registerFace(createUIDemoFontAsset());

    const cleanupResize = bindSceneToContainer(scene, options.container, 960, 540);
    const cleanupInput = options.bindInput ? bindUIRuntimeToCanvas(scene, runtime) : () => {};
    const overlay = attachUIOverlayToScene(scene, {
        ui: () => runtime.commit({ width: scene.canvas.width, height: scene.canvas.height }),
        priority: -1000,
        renderer: {
            atlasFilter: 'nearest',
        },
    });

    const spinSystemId = 'ui-example.spin-cube';
    scene.loop.addSystem({
        id: spinSystemId,
        priority: 100,
        enabled: true,
        update(context) {
            const angle = context.elapsed * 0.001;
            cube.requireComponent(Transform).rotation = Quat.fromEuler(0, angle, angle * 0.5);
        },
    });

    return {
        scene,
        runtime,
        overlayShaderId: overlayShader.id,
        dispose() {
            cleanupInput();
            cleanupResize();
            overlay.dispose();
            scene.loop.removeSystem(spinSystemId);
            runtime.dispose();
            scene.dispose();
            options.container.replaceChildren();
        },
    };
};

export const createDemoPanel = (
    runtime: UIRuntime,
    layout: WidgetLayoutInput = {},
    style: WidgetStyleInput = {}
) =>
    runtime.createWidget({
        role: 'container',
        layout: {
            position: 'absolute',
            anchor: 'top-left',
            inset: { top: 24, left: 24 },
            width: 420,
            height: 280,
            padding: 18,
            display: 'stack',
            direction: 'column',
            gap: 12,
            ...layout,
        },
        style: {
            background: '#0f172acc',
            borderColor: '#38bdf8aa',
            borderWidth: 1,
            radius: 18,
            ...style,
        },
    });

export const createDemoText = (
    runtime: UIRuntime,
    value: string,
    size: number,
    options: {
        readonly color?: string;
        readonly layout?: WidgetLayoutInput;
        readonly style?: WidgetStyleInput;
        readonly text?: Partial<TextBlockInput>;
    } = {}
) =>
    runtime.createWidget({
        role: 'text',
        layout: options.layout,
        style: options.style,
        text: {
            value,
            family: UI_DEMO_FONT_FAMILY,
            size,
            color: options.color ?? '#dbeafeff',
            ...(options.text ?? {}),
        },
    });