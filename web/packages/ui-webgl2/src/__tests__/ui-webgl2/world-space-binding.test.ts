import { describe, expect, it, vi } from 'vitest';
import type { UIAsset } from '@axrone/ui/types';
import { bindUIHostToScene, bindUIHostToWorld, bindUIHostsToScene, getUIHostBinding, getUIHostRuntime } from '../../scene-host';
import { dispatchWorldPointerToUIRuntime } from '../../world-input';
import { UIHost } from '@axrone/scene-runtime/scene-facade';
import { columnMajorIdentity, createSceneTarget, createHostAsset } from './support/ui-webgl2-harness';

describe('world-space UIHost binding', () => {
    const worldSources = () => ({
        viewProjection: () => columnMajorIdentity(),
        entityWorldMatrix: () => columnMajorIdentity(0, 0, -3),
        cameraWorldMatrix: () => columnMajorIdentity(0, 0, 5),
    });

    const createWorldInputTarget = () => {
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

    it('binds a world-space host, registers it, and drives the quad every frame', () => {
        const scene = createSceneTarget();
        const host = new UIHost({
            assetId: 'ui.hud',
            renderMode: 'world-space',
            worldWidth: 1.2,
            worldHeight: 0.4,
        });

        const handle = bindUIHostToWorld({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
            world: worldSources(),
        });

        expect(handle).not.toBeNull();
        // The registry must work in world-space too, so @property('ui-widget')
        // references keep resolving.
        expect(getUIHostRuntime(host)).toBe(handle!.runtime);
        expect(handle!.runtime.getBoundWidget('button')).not.toBeNull();

        // A frame tick renders UI into the surface and then draws the quad.
        const drawCallsBefore = (scene.gl.drawArrays as unknown as { mock: { calls: unknown[] } })
            .mock.calls.length;
        handle!.render(0, 0);
        const drawCallsAfter = (scene.gl.drawArrays as unknown as { mock: { calls: unknown[] } })
            .mock.calls.length;
        expect(drawCallsAfter).toBeGreaterThan(drawCallsBefore);

        handle!.dispose();
        expect(getUIHostBinding(host)).toBeNull();
        // Idempotent dispose keeps the loop clean.
        expect(() => handle!.dispose()).not.toThrow();
    });

    it('resolves UI images through the scene texture registry in world space', () => {
        const scene = createSceneTarget();
        const texture = scene.gl.createTexture();
        const getTextureResource = vi.fn(() => ({
            nativeTexture: texture!,
            nativeSampler: null,
        }));
        const getMaterialTextureBinding = vi.fn(() => null);
        Object.assign(scene, { getTextureResource, getMaterialTextureBinding });

        const asset: UIAsset = {
            id: 'ui.image',
            name: 'image',
            version: 1,
            canvas: {
                referenceWidth: 320,
                referenceHeight: 180,
                scaleMode: 'fill',
                matchBias: 0.5,
            },
            bindings: { root: 'root', image: 'image' },
            root: {
                role: 'root',
                key: 'root',
                enabled: true,
                interactive: false,
                layout: { display: 'overlay', width: '100%', height: '100%' },
                children: [
                    {
                        role: 'custom:image',
                        key: 'image',
                        enabled: true,
                        interactive: false,
                        layout: { width: 64, height: 64 },
                        image: {
                            source: {
                                kind: 'texture',
                                resourceId: 'ui:texture',
                                width: 64,
                                height: 64,
                            },
                        },
                        children: [],
                    },
                ],
            },
        } as unknown as UIAsset;

        const host = new UIHost({
            assetId: 'ui.image',
            renderMode: 'world-space',
            worldWidth: 1,
            worldHeight: 1,
        });
        const handle = bindUIHostToWorld({
            scene,
            host,
            resolveAsset: () => asset,
            world: worldSources(),
        });
        expect(handle).not.toBeNull();

        handle!.render(0, 0);

        expect(getTextureResource).toHaveBeenCalledWith('ui:texture');

        handle!.dispose();
    });

    it('routes hosts by render mode and skips world hosts without matrix sources', () => {
        const scene = createSceneTarget();
        const screenHost = new UIHost({ assetId: 'ui.hud', renderMode: 'screen-overlay' });
        const worldHost = new UIHost({ assetId: 'ui.hud', renderMode: 'world-space' });

        // No `world` option: the world-space host is skipped, the overlay binds.
        const withoutWorld = bindUIHostsToScene({
            scene,
            hosts: [screenHost, worldHost],
            resolveAsset: () => createHostAsset(),
        });
        expect(withoutWorld.handles).toHaveLength(1);
        expect(getUIHostBinding(worldHost)).toBeNull();
        withoutWorld.dispose();

        const withWorld = bindUIHostsToScene({
            scene,
            hosts: [screenHost, worldHost],
            resolveAsset: () => createHostAsset(),
            world: worldSources(),
        });
        expect(withWorld.handles).toHaveLength(2);
        expect(getUIHostBinding(worldHost)).not.toBeNull();
        withWorld.dispose();
        expect(getUIHostBinding(worldHost)).toBeNull();
    });

    it('returns null for a world host without an asset', () => {
        const scene = createSceneTarget();
        const host = new UIHost({ renderMode: 'world-space' });

        expect(
            bindUIHostToWorld({
                scene,
                host,
                resolveAsset: () => createHostAsset(),
                world: worldSources(),
            })
        ).toBeNull();
    });

    it('maps input using the offscreen surface size when surface != canvas', () => {
        // World-space hosts render to an offscreen surface whose size is
        // determined by resolveWorldSurfaceSize (host.worldWidth * textureScale,
        // host.worldHeight * textureScale), which can differ from the main
        // canvas framebuffer. Input must use the surface dimensions, not the
        // canvas dimensions.
        const scene = createSceneTarget();
        // Main canvas is 320x180, but the world surface will be different.
        const host = new UIHost({
            assetId: 'ui.hud',
            renderMode: 'world-space',
            worldWidth: 2.0,
            worldHeight: 1.0,
            textureScale: 200, // surface = 400x200, != canvas 320x180
            receiveInput: true,
        });

        const target = createWorldInputTarget();
        // CSS rect matches the canvas size (devicePixelRatio = 1)
        target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 180 });

        const handle = bindUIHostToWorld({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
            world: worldSources(),
            input: { target },
        });
        expect(handle).not.toBeNull();

        // Trigger layout computation via a render cycle.
        handle!.render(0, 0);

        const pointerDown = vi.fn(() => true);
        handle!.runtime.updateWidget(handle!.runtime.getBoundWidget('button')!, {
            handlers: { pointerDown },
        });

        // The surface is 400x200, the reference is 320x180.
        // With 'fill' scale mode (bias 0.5):
        //   scaleW = 400/320 = 1.25, scaleH = 200/180 ≈ 1.111
        //   blended = 1.25*0.5 + 1.111*0.5 ≈ 1.1806
        //   effectiveW = 320*1.1806 ≈ 377.8, offsetX = (400-377.8)/2 ≈ 11.1
        //   effectiveH = 180*1.1806 ≈ 212.5, offsetY = (200-212.5)/2 ≈ -6.25
        // Button center in reference: (50, 50)
        // Viewport point: (50*1.1806+11.1, 50*1.1806-6.25) = (70.1, 52.8)
        // CSS point: (70.1/1.25, 52.8/1.111) = (56.1, 47.5)
        const scale = 1.25 * 0.5 + (200 / 180) * 0.5;
        const effectiveW = 320 * scale;
        const offsetX = (400 - effectiveW) / 2;
        const effectiveH = 180 * scale;
        const offsetY = (200 - effectiveH) / 2;
        const vpX = 50 * scale + offsetX;
        const vpY = 50 * scale + offsetY;
        const cssX = vpX / (400 / 320);
        const cssY = vpY / (200 / 180);

        target.emit('pointerdown', { clientX: cssX, clientY: cssY });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        // A point clearly outside the button in reference space
        target.emit('pointerdown', { clientX: 250, clientY: 160 });
        expect(pointerDown).toHaveBeenCalledTimes(1);

        handle!.dispose();
    });
});


describe('dispatchWorldPointerToUIRuntime', () => {
    it('forwards a quad hit as a canvas-space pointer event', () => {
        const scene = createSceneTarget();
        const host = new UIHost({ assetId: 'ui.hud' });
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
        });
        const runtime = handle!.runtime;
        handle!.render(320, 180);

        const pointerDown = vi.fn(() => true);
        const widget = runtime.getBoundWidget('button')!;
        runtime.updateWidget(widget, { handlers: { pointerDown } });

        // The asset's button occupies the top-left 100x100 of a 320x180 canvas,
        // so a hit at 10% / 10% lands inside it.
        const handled = dispatchWorldPointerToUIRuntime(
            runtime,
            { u: 0.1, v: 0.1, distance: 4 },
            { phase: 'down' },
            320,
            180
        );

        expect(handled).toBe(true);
        expect(pointerDown).toHaveBeenCalledTimes(1);

        handle!.dispose();
    });

    it('sends a leave when the pointer slides off the quad', () => {
        const scene = createSceneTarget();
        const host = new UIHost({ assetId: 'ui.hud' });
        const handle = bindUIHostToScene({
            scene,
            host,
            resolveAsset: () => createHostAsset(),
        });
        const runtime = handle!.runtime;
        handle!.render(320, 180);

        const pointerLeave = vi.fn(() => true);
        const widget = runtime.getBoundWidget('button')!;
        runtime.updateWidget(widget, { handlers: { pointerLeave } });

        // Hover the widget, then miss the quad entirely.
        dispatchWorldPointerToUIRuntime(runtime, { u: 0.1, v: 0.1, distance: 4 }, { phase: 'move' }, 320, 180);
        const missed = dispatchWorldPointerToUIRuntime(runtime, null, { phase: 'move' }, 320, 180);

        expect(missed).toBe(false);
        expect(pointerLeave).toHaveBeenCalled();

        handle!.dispose();
    });

    it('is a no-op without a runtime', () => {
        expect(
            dispatchWorldPointerToUIRuntime(null, { u: 0.5, v: 0.5, distance: 1 }, { phase: 'down' }, 320, 180)
        ).toBe(false);
    });
});

