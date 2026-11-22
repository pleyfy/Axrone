import { describe, expect, it, vi } from 'vitest';
import type { UIAsset } from '@axrone/ui/types';
import { bindUIHostToScene, bindUIHostsToScene, getUIHostBinding, getUIHostRuntime, resolveUIWidgetRef } from '../../scene-host';
import { UIHost, createLazySceneUIWidgetRef } from '@axrone/scene-runtime/scene-facade';
import { getCheckboxChecked } from '@axrone/ui';
import { createGameLoop } from '@axrone/game-loop';
import { createSceneTarget, createCheckboxAsset, createHostAsset, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('scene-host UIHost binding', () => {
    const createInputTarget = () => {
        const listeners = new Map<string, Set<(event: unknown) => void>>();
        return {
            addEventListener: vi.fn((type: string, listener: (event: never) => void) => {
                const bucket = listeners.get(type) ?? new Set();
                bucket.add(listener as (event: unknown) => void);
                listeners.set(type, bucket);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: never) => void) => {
                listeners.get(type)?.delete(listener as (event: unknown) => void);
            }),
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
            emit(type: string, event: unknown) {
                for (const listener of listeners.get(type) ?? []) {
                    listener(event);
                }
            },
            listenerCount(type: string) {
                return listeners.get(type)?.size ?? 0;
            },
        };
    };

    it('wires pointer input with coordinate mapping when receiveInput is enabled', () => {
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: true });
        const resolveAsset = vi.fn(() => createHostAsset());

        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset,
            input: { target },
        });

        expect(handle).not.toBeNull();
        expect(resolveAsset).toHaveBeenCalledWith('ui.hud');
        expect(target.listenerCount('pointerdown')).toBe(1);
        expect(target.listenerCount('pointermove')).toBe(1);
        expect(target.listenerCount('keydown')).toBe(0);

        const pointerDown = vi.fn(() => true);
        const button = handle!.runtime.getBoundWidget('button');
        expect(button).not.toBeNull();
        handle!.runtime.updateWidget(button!, { handlers: { pointerDown } });
        handle!.render(320, 180);

        // CSS rect is 320x180 and framebuffer is 320x180 => 1:1 mapping
        target.emit('pointerdown', { clientX: 40, clientY: 40 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        target.emit('pointerdown', { clientX: 200, clientY: 150 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        handle!.dispose();
        expect(target.listenerCount('pointerdown')).toBe(0);
        expect(target.listenerCount('pointermove')).toBe(0);
    });

    it('fires widget handlers when pointerdown arrives before the first render', () => {
        // Regression: the original bug had input ordering-coupled to a prior
        // commitToViewport() call via dispatchViewportInput. After the fix,
        // dispatchInput is used directly with reference-space coords, so input
        // works as soon as layout is available (one commitToViewport call)
        // without needing the overlay render pipeline to run first.
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: true });
    
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();
    
        const pointerDown = vi.fn(() => true);
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('button')!, {
            handlers: { pointerDown },
        });
    
        // Trigger layout computation without going through the overlay pipeline.
        handle!.runtime.commitToViewport(320, 180);
    
        // Input must work without handle.render() or the overlay system running.
        target.emit('pointerdown', { clientX: 40, clientY: 40 });
        expect(pointerDown).toHaveBeenCalledTimes(1);
    
        handle!.dispose();
    });
    
    it('hits widgets with non-zero radius and borderWidth before first render', () => {
        // Ensures the input path works for styled widgets (radius/border)
        // without going through the full overlay render pipeline.
        const styledAsset = (): UIAsset => ({
            ...createHostAsset(),
            root: {
                role: 'root',
                enabled: true,
                interactive: false,
                layout: { display: 'overlay', width: '100%', height: '100%' },
                children: [
                    {
                        role: 'button',
                        key: 'hud-button',
                        enabled: true,
                        interactive: true,
                        layout: { width: 100, height: 100 },
                        style: { background: '#112233ff', radius: 12, borderWidth: 3, borderColor: '#ffffffff' },
                        children: [],
                    },
                ],
            } as never,
        });
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: true });
    
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => styledAsset(),
            input: { target },
        });
    
        const pointerDown = vi.fn(() => true);
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('button')!, {
            handlers: { pointerDown },
        });
    
        // Trigger layout computation directly.
        handle!.runtime.commitToViewport(320, 180);
    
        // Inside the 100x100 styled button
        target.emit('pointerdown', { clientX: 50, clientY: 50 });
        expect(pointerDown).toHaveBeenCalledTimes(1);
    
        // Outside the button
        target.emit('pointerdown', { clientX: 200, clientY: 150 });
        expect(pointerDown).toHaveBeenCalledTimes(1);
    
        handle!.dispose();
    });
    
    it('mapsCSS-scaled client coordinates into framebuffer pixels', () => {
        const scene = createSceneTarget();
        const target = createInputTarget();
        // CSS size is half the framebuffer: 160x90 vs 320x180 => 2x scale
        target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90 });
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: true });

        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();

        const pointerDown = vi.fn(() => true);
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('button')!, {
            handlers: { pointerDown },
        });
        handle!.render(320, 180);

        // client (40, 40) -> framebuffer (80, 80): inside the 100x100 button
        target.emit('pointerdown', { clientX: 40, clientY: 40 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        // client (70, 70) -> framebuffer (140, 140): outside the button
        target.emit('pointerdown', { clientX: 70, clientY: 70 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        handle!.dispose();
    });

    it('correctly maps input under match-width-or-height letterboxing for all anchor positions', () => {
        // Regression test: verifies that commitToViewport + dispatchViewportInput
        // produce consistent coordinate mapping when the viewport aspect ratio differs
        // from the reference, causing letterbox/pillarbox offsets.
        const letterboxScene = {
            gl: createMockWebGL2Context(),
            canvas: { width: 905, height: 961 } as HTMLCanvasElement,
            loop: createGameLoop({ state: { sceneId: 'scene:ui-host' }, autoStart: false }),
        };
        const target = createInputTarget();
        // CSS size matches the framebuffer (devicePixelRatio = 1)
        target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 905, height: 961 });

        // Asset with 1920x1080 reference and match-width-or-height scaling (bias 0.45)
        // This matches the real UI-test.ui.json canvas config.
        const letterboxAsset = (): UIAsset => ({
            id: 'ui.letterbox',
            name: 'LetterboxTest',
            version: 1,
            canvas: {
                referenceWidth: 1920,
                referenceHeight: 1080,
                scaleMode: 'match-width-or-height',
                matchBias: 0.45,
            },
            bindings: {
                centerButton: 'center-btn',
                leftButton: 'left-btn',
                rightButton: 'right-btn',
            },
            root: {
                role: 'root',
                enabled: true,
                interactive: false,
                layout: { display: 'overlay', width: '100%', height: '100%' },
                children: [
                    {
                        role: 'button',
                        key: 'center-btn',
                        enabled: true,
                        interactive: true,
                        layout: {
                            position: 'absolute',
                            width: 200,
                            height: 60,
                            anchor: { x: 0.5, y: 0.5, maxX: 0.5, maxY: 0.5, pivotX: 0.5, pivotY: 0.5 },
                        },
                        style: { background: '#0a74daff' },
                        children: [],
                    },
                    {
                        role: 'button',
                        key: 'left-btn',
                        enabled: true,
                        interactive: true,
                        layout: {
                            position: 'absolute',
                            width: 200,
                            height: 60,
                            anchor: { x: 0, y: 0.5, maxX: 0, maxY: 0.5, pivotX: 0, pivotY: 0.5, offsetX: 100, offsetY: 0 },
                        },
                        style: { background: '#0a74daff' },
                        children: [],
                    },
                    {
                        role: 'button',
                        key: 'right-btn',
                        enabled: true,
                        interactive: true,
                        layout: {
                            position: 'absolute',
                            width: 200,
                            height: 60,
                            anchor: { x: 1, y: 0.5, maxX: 1, maxY: 0.5, pivotX: 1, pivotY: 0.5, offsetX: -100, offsetY: 0 },
                        },
                        style: { background: '#0a74daff' },
                        children: [],
                    },
                ],
            } as never,
        });

        const host = new UIHost({ assetId: 'ui.letterbox', receiveInput: true });
        const handle = bindUIHostToScene({
            scene: letterboxScene,
            host,
            resolveAsset: () => letterboxAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();

        // Render at the framebuffer size (905x961) — this sets lastViewport.
        handle!.render(905, 961);

        const centerHandler = vi.fn(() => true);
        const leftHandler = vi.fn(() => true);
        const rightHandler = vi.fn(() => true);
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('centerButton')!, { handlers: { pointerDown: centerHandler } });
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('leftButton')!, { handlers: { pointerDown: leftHandler } });
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('rightButton')!, { handlers: { pointerDown: rightHandler } });

        // Verify layout boxes to know exact reference positions
        const centerBox = handle!.runtime.getLayoutBox(handle!.runtime.getBoundWidget('centerButton')!);
        const leftBox = handle!.runtime.getLayoutBox(handle!.runtime.getBoundWidget('leftButton')!);
        const rightBox = handle!.runtime.getLayoutBox(handle!.runtime.getBoundWidget('rightButton')!);

        // Compute the canvas scale for this viewport
        // scaleW = 905/1920 ≈ 0.4714, scaleH = 961/1080 ≈ 0.8898
        // blended = 0.4714 * 0.55 + 0.8898 * 0.45 ≈ 0.6597
        const scale = 0.4714 * 0.55 + 0.8898 * 0.45;
        const effectiveW = 1920 * scale;
        const offsetX = (905 - effectiveW) / 2;
        const effectiveH = 1080 * scale;
        const offsetY = (961 - effectiveH) / 2;

        // Helper: convert reference point to framebuffer point
        const refToFramebuffer = (refX: number, refY: number) => ({
            x: refX * scale + offsetX,
            y: refY * scale + offsetY,
        });

        // Test CENTER button (anchored at center of 1920x1080 reference)
        const centerRef = { x: centerBox.x + centerBox.width / 2, y: centerBox.y + centerBox.height / 2 };
        const centerFb = refToFramebuffer(centerRef.x, centerRef.y);
        target.emit('pointerdown', { clientX: centerFb.x, clientY: centerFb.y });
        expect(centerHandler).toHaveBeenCalledTimes(1);

        // Test LEFT button (anchored at left side, offsetX=100)
        const leftRef = { x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2 };
        const leftFb = refToFramebuffer(leftRef.x, leftRef.y);
        target.emit('pointerdown', { clientX: leftFb.x, clientY: leftFb.y });
        expect(leftHandler).toHaveBeenCalledTimes(1);

        // Test RIGHT button (anchored at right side, offsetX=-100)
        const rightRef = { x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2 };
        const rightFb = refToFramebuffer(rightRef.x, rightRef.y);
        target.emit('pointerdown', { clientX: rightFb.x, clientY: rightFb.y });
        expect(rightHandler).toHaveBeenCalledTimes(1);

        handle!.dispose();
    });

    it('correctly maps input under match-height pillarboxing', () => {
        // When the viewport is wider than the reference aspect ratio,
        // match-height scale mode produces pillarbox (vertical bars).
        const pillarboxScene = {
            gl: createMockWebGL2Context(),
            canvas: { width: 1920, height: 800 } as HTMLCanvasElement,
            loop: createGameLoop({ state: { sceneId: 'scene:ui-host' }, autoStart: false }),
        };
        const target = createInputTarget();
        target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 800 });

        const pillarboxAsset = (): UIAsset => ({
            id: 'ui.pillarbox',
            name: 'PillarboxTest',
            version: 1,
            canvas: {
                referenceWidth: 1920,
                referenceHeight: 1080,
                scaleMode: 'match-height',
                matchBias: 1.0,
            },
            bindings: { centerButton: 'center-btn' },
            root: {
                role: 'root',
                enabled: true,
                interactive: false,
                layout: { display: 'overlay', width: '100%', height: '100%' },
                children: [
                    {
                        role: 'button',
                        key: 'center-btn',
                        enabled: true,
                        interactive: true,
                        layout: {
                            position: 'absolute',
                            width: 200,
                            height: 60,
                            anchor: { x: 0.5, y: 0.5, maxX: 0.5, maxY: 0.5, pivotX: 0.5, pivotY: 0.5 },
                        },
                        style: { background: '#0a74daff' },
                        children: [],
                    },
                ],
            } as never,
        });

        const host = new UIHost({ assetId: 'ui.pillarbox', receiveInput: true });
        const handle = bindUIHostToScene({
            scene: pillarboxScene,
            host,
            resolveAsset: () => pillarboxAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();

        const centerHandler = vi.fn(() => true);
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('centerButton')!, {
            handlers: { pointerDown: centerHandler },
        });

        // match-height: scale = 800/1080 ≈ 0.7407
        // effectiveW = 1920 * 0.7407 ≈ 1422.2
        // offsetX = (1920 - 1422.2) / 2 ≈ 248.9
        // effectiveH = 1080 * 0.7407 = 800
        // offsetY = 0
        const scale = 800 / 1080;
        const effectiveW = 1920 * scale;
        const offsetX = (1920 - effectiveW) / 2;

        const centerBox = handle!.runtime.getLayoutBox(handle!.runtime.getBoundWidget('centerButton')!);
        const centerRefX = centerBox.x + centerBox.width / 2;
        const centerRefY = centerBox.y + centerBox.height / 2;
        const fbX = centerRefX * scale + offsetX;
        const fbY = centerRefY * scale;

        target.emit('pointerdown', { clientX: fbX, clientY: fbY });
        expect(centerHandler).toHaveBeenCalledTimes(1);

        handle!.dispose();
    });

    it('toggles a checkbox through the full DOM-to-runtime input path', () => {
        // End-to-end proof for exported builds: DOM pointer events on the
        // container must drive a real checkbox-toggle controller (the exact
        // symptom from the field: preview worked, build clicks did nothing).
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.checkbox', receiveInput: true });
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createCheckboxAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();
        handle!.render(320, 180);

        const runtime = handle!.runtime;
        const widget = runtime.getBoundWidget('checkbox')!;
        expect(getCheckboxChecked(runtime, widget)).toBe(false);

        const point = {
            clientX: 30,
            clientY: 30,
            pointerId: 1,
            button: 0,
            buttons: 1,
            deltaX: 0,
            deltaY: 0,
            altKey: false,
            ctrlKey: false,
            shiftKey: false,
            metaKey: false,
        };
        target.emit('pointerdown', point);
        target.emit('pointerup', { ...point, buttons: 0 });
        expect(getCheckboxChecked(runtime, widget)).toBe(true);

        target.emit('pointerdown', point);
        target.emit('pointerup', { ...point, buttons: 0 });
        expect(getCheckboxChecked(runtime, widget)).toBe(false);

        handle!.dispose();
    });

    it('still hits widgets after the container moves (no stale rect cache)', () => {
        // The old wiring cached getBoundingClientRect() on first use: any
        // layout shift afterwards (status bar, canvas resize) silently offset
        // every click in exported builds.
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.checkbox', receiveInput: true });
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createCheckboxAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();
        handle!.render(320, 180);

        const runtime = handle!.runtime;
        const widget = runtime.getBoundWidget('checkbox')!;
        target.emit('pointermove', {
            clientX: 30, clientY: 30, pointerId: 1, button: 0, buttons: 0,
            deltaX: 0, deltaY: 0, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
        });

        // Container shifts down 100px: the same buffer point is now at client (30, 130).
        target.getBoundingClientRect = () => ({ left: 0, top: 100, width: 320, height: 180 });
        const point = {
            clientX: 30, clientY: 130, pointerId: 1, button: 0, buttons: 1,
            deltaX: 0, deltaY: 0, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
        };
        target.emit('pointerdown', point);
        target.emit('pointerup', { ...point, buttons: 0 });
        expect(getCheckboxChecked(runtime, widget)).toBe(true);

        handle!.dispose();
    });

    it('treats pointercancel as pointerup so touch taps never stick', () => {
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.checkbox', receiveInput: true });
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createCheckboxAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();
        handle!.render(320, 180);

        const runtime = handle!.runtime;
        const widget = runtime.getBoundWidget('checkbox')!;
        const point = {
            clientX: 30, clientY: 30, pointerId: 1, button: 0, buttons: 1,
            deltaX: 0, deltaY: 0, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
        };
        target.emit('pointerdown', point);
        target.emit('pointercancel', point);
        expect(getCheckboxChecked(runtime, widget)).toBe(true);

        handle!.dispose();
    });

    it('does not attach input listeners when receiveInput is false', () => {
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: false });

        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
            input: { target },
        });

        expect(handle).not.toBeNull();
        expect(target.addEventListener).not.toHaveBeenCalled();
        handle!.dispose();
    });

    it('prefers resolveAsset over resolveAssetJson when both are provided', () => {
        const scene = createSceneTarget();
        const host = new UIHost({ assetId: 'ui.hud' });
        const resolveAsset = vi.fn(() => createHostAsset());
        const resolveAssetJson = vi.fn(() => JSON.stringify(createHostAsset()));

        const handle = bindUIHostToScene({ scene, host, resolveAsset, resolveAssetJson });

        expect(handle).not.toBeNull();
        expect(resolveAsset).toHaveBeenCalledTimes(1);
        expect(resolveAssetJson).not.toHaveBeenCalled();
        handle!.dispose();
    });

    it('binds multiple hosts, skipping unresolvable ones, and disposes them together', () => {
        const scene = createSceneTarget();
        const bindable = new UIHost({ assetId: 'ui.hud' });
        const emptyAssetId = new UIHost({ assetId: '' });
        const unresolvable = new UIHost({ assetId: 'ui.missing' });

        const bindings = bindUIHostsToScene({
            scene,
            hosts: [bindable, emptyAssetId, unresolvable],
            resolveAsset: (assetId) => (assetId === 'ui.hud' ? createHostAsset() : null),
        });

        expect(bindings.handles).toHaveLength(1);
        expect(bindings.handles[0].asset.id).toBe('ui.hud');

        bindings.dispose();
        expect(() => bindings.dispose()).not.toThrow();
    });

    it('registers bound hosts so getUIHostRuntime resolves the live runtime', () => {
        const scene = createSceneTarget();
        const host = new UIHost({ assetId: 'ui.hud' });

        expect(getUIHostRuntime(host)).toBeNull();

        const handle = bindUIHostToScene({ scene, host, resolveAsset: () => createHostAsset() });
        expect(handle).not.toBeNull();
        expect(getUIHostBinding(host)).toBe(handle);
        expect(getUIHostRuntime(host)).toBe(handle!.runtime);

        handle!.dispose();
        expect(getUIHostBinding(host)).toBeNull();
        expect(getUIHostRuntime(host)).toBeNull();
    });

    it('resolves UIWidgetRefs that mutate the bound widget and go inert on dispose', () => {
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: true });

        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
            input: { target },
        });
        expect(handle).not.toBeNull();

        expect(resolveUIWidgetRef(host, 'missing-key')).toBeNull();

        const ref = resolveUIWidgetRef(host, 'button');
        expect(ref).not.toBeNull();
        expect(ref!.isValid()).toBe(true);
        expect(ref!.widgetId).toBe(handle!.runtime.getBoundWidget('button'));

        // Mutations through the ref reach the live runtime: attach a handler
        // and confirm the real input path invokes it.
        const pointerDown = vi.fn(() => true);
        expect(ref!.setHandlers({ pointerDown })).toBe(true);
        expect(ref!.setStyle({ background: '#ff0000ff' })).toBe(true);
        handle!.render(320, 180);
        target.emit('pointerdown', { clientX: 40, clientY: 40 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        handle!.dispose();
        expect(ref!.isValid()).toBe(false);
        expect(ref!.setText('gone')).toBe(false);
    });

    it('lazily resolves scene-runtime ui-widget refs once the host is bound', () => {
        const scene = createSceneTarget();
        const target = createInputTarget();
        const host = new UIHost({ assetId: 'ui.hud', receiveInput: true });

        // Created before any binding exists — exactly how hydrated script
        // properties behave when scripts instantiate before bindUIHostsToScene.
        const lazyRef = createLazySceneUIWidgetRef(() => host, 'button');
        expect(lazyRef.isValid()).toBe(false);
        expect(lazyRef.setText('early')).toBe(false);

        const bindings = bindUIHostsToScene({
            scene,
            hosts: [host],
            resolveAsset: () => createHostAsset(),
            input: { target },
        });
        expect(bindings.handles).toHaveLength(1);

        expect(lazyRef.isValid()).toBe(true);
        const pointerDown = vi.fn(() => true);
        expect(lazyRef.setHandlers({ pointerDown })).toBe(true);
        bindings.handles[0].render(320, 180);
        target.emit('pointerdown', { clientX: 40, clientY: 40 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        bindings.dispose();
        expect(lazyRef.isValid()).toBe(false);
    });
});

