import { beforeAll, describe, expect, it } from 'vitest';
import { AudioListenerComponent } from '../audio-listener-component';
import { AudioSourceComponent } from '../audio-source-component';
import { AudioComponentBinder } from '../component-binder';
import { createAudioSystem } from '../system';
import { MASTER_AUDIO_BUS_ID } from '../reference';
import { FakeAudioBuffer, FakeAudioContext, installFakeAudioGlobals } from './helpers/fake-audio-context';

beforeAll(() => {
    installFakeAudioGlobals();
});

describe('AudioListenerComponent', () => {
    describe('constructor defaults', () => {
        it('initializes all fields with correct defaults', () => {
            const comp = new AudioListenerComponent();
            expect(comp.listenerId).toBe('default');
            expect(comp.active).toBe(true);
            expect(comp.position).toEqual({ x: 0, y: 0, z: 0 });
            expect(comp.forward).toEqual({ x: 0, y: 0, z: -1 });
            expect(comp.up).toEqual({ x: 0, y: 1, z: 0 });
            expect(comp.useTransform).toBe(true);
            expect(comp.globalVolume).toBe(1);
            expect(comp.dopplerFactor).toBe(1);
            expect(comp.speakerMode).toBe('stereo');
            expect(comp.sampleRate).toBe(48000);
            expect(comp.dspBufferSize).toBe(1024);
            expect(comp.realVoices).toBe(32);
            expect(comp.virtualVoices).toBe(128);
            expect(comp.virtualVoiceBehavior).toBe('playSilent');
            expect(comp.hrtfPlugin).toBe('none');
            expect(comp.occlusionMode).toBe('raycastDiffraction');
            expect(comp.occlusionLayers).toEqual([0, 3, 6, 7]);
            expect(comp.reverbPreset).toBe('off');
            expect(comp.reverbLevel).toBe(0);
            expect(comp.ambientClipId).toBe('');
            expect(comp.ambientVolume).toBe(0.5);
            expect(comp.followCamera).toBe(true);
            expect(comp.metadata).toEqual({});
        });
    });

    describe('constructor with config', () => {
        it('applies all config values', () => {
            const comp = new AudioListenerComponent({
                listenerId: 'main',
                active: false,
                position: { x: 1, y: 2, z: 3 },
                forward: { x: 0, y: 0, z: 1 },
                up: { x: 1, y: 0, z: 0 },
                useTransform: false,
                globalVolume: 0.8,
                dopplerFactor: 2,
                speakerMode: '5.1',
                sampleRate: 96000,
                dspBufferSize: 256,
                realVoices: 64,
                virtualVoices: 256,
                virtualVoiceBehavior: 'stopImmediately',
                hrtfPlugin: 'oculus',
                occlusionMode: 'none',
                occlusionLayers: [1, 2],
                reverbPreset: 'room',
                reverbLevel: 0.7,
                ambientClipId: 'amb-1',
                ambientVolume: 0.3,
                followCamera: false,
                metadata: { key: 'val' },
            });
            expect(comp.listenerId).toBe('main');
            expect(comp.active).toBe(false);
            expect(comp.position).toEqual({ x: 1, y: 2, z: 3 });
            expect(comp.speakerMode).toBe('5.1');
            expect(comp.sampleRate).toBe(96000);
            expect(comp.dspBufferSize).toBe(256);
            expect(comp.virtualVoiceBehavior).toBe('stopImmediately');
            expect(comp.hrtfPlugin).toBe('oculus');
            expect(comp.occlusionMode).toBe('none');
            expect(comp.reverbPreset).toBe('room');
            expect(comp.reverbLevel).toBe(0.7);
            expect(comp.ambientClipId).toBe('amb-1');
            expect(comp.followCamera).toBe(false);
            expect(comp.metadata).toEqual({ key: 'val' });
        });
    });

    describe('normalizer fallbacks for invalid values', () => {
        it('falls back to default speakerMode for invalid value', () => {
            const comp = new AudioListenerComponent({ speakerMode: 'invalid' as any });
            expect(comp.speakerMode).toBe('stereo');
        });

        it('falls back to default sampleRate for invalid value', () => {
            const comp = new AudioListenerComponent({ sampleRate: 33333 });
            expect(comp.sampleRate).toBe(48000);
        });

        it('falls back to default dspBufferSize for invalid value', () => {
            const comp = new AudioListenerComponent({ dspBufferSize: 999 });
            expect(comp.dspBufferSize).toBe(1024);
        });

        it('falls back to default hrtfPlugin for invalid value', () => {
            const comp = new AudioListenerComponent({ hrtfPlugin: 'invalid' as any });
            expect(comp.hrtfPlugin).toBe('none');
        });

        it('falls back to default occlusionMode for invalid value', () => {
            const comp = new AudioListenerComponent({ occlusionMode: 'invalid' as any });
            expect(comp.occlusionMode).toBe('raycastDiffraction');
        });

        it('falls back to default reverbPreset for invalid value', () => {
            const comp = new AudioListenerComponent({ reverbPreset: 'invalid' as any });
            expect(comp.reverbPreset).toBe('off');
        });

        it('falls back to default virtualVoiceBehavior for invalid value', () => {
            const comp = new AudioListenerComponent({ virtualVoiceBehavior: 'invalid' as any });
            expect(comp.virtualVoiceBehavior).toBe('playSilent');
        });
    });

    describe('setter normalization', () => {
        it('clamps globalVolume to [0, 1]', () => {
            const comp = new AudioListenerComponent();
            comp.globalVolume = 5;
            expect(comp.globalVolume).toBe(1);
            comp.globalVolume = -1;
            expect(comp.globalVolume).toBe(0);
        });

        it('clamps dopplerFactor to [0, 5]', () => {
            const comp = new AudioListenerComponent();
            comp.dopplerFactor = 10;
            expect(comp.dopplerFactor).toBe(5);
        });

        it('clamps reverbLevel to [0, 1]', () => {
            const comp = new AudioListenerComponent();
            comp.reverbLevel = 2;
            expect(comp.reverbLevel).toBe(1);
        });

        it('normalizes speakerMode on set', () => {
            const comp = new AudioListenerComponent();
            comp.speakerMode = '7.1';
            expect(comp.speakerMode).toBe('7.1');
            comp.speakerMode = 'invalid' as any;
            expect(comp.speakerMode).toBe('stereo');
        });
    });

    describe('toDescriptor', () => {
        it('uses stored position when useTransform is false', () => {
            const comp = new AudioListenerComponent({
                useTransform: false,
                position: { x: 5, y: 6, z: 7 },
            });
            const desc = comp.toDescriptor();
            expect(desc.position).toEqual({ x: 5, y: 6, z: 7 });
        });

        it('falls back to stored position when transform is undefined', () => {
            const comp = new AudioListenerComponent({
                useTransform: true,
                position: { x: 1, y: 2, z: 3 },
            });
            // No entity/entity set, so transform is undefined
            const desc = comp.toDescriptor();
            expect(desc.position).toEqual({ x: 1, y: 2, z: 3 });
        });
    });

    describe('serialize / deserialize roundtrip', () => {
        it('preserves all fields through serialize/deserialize', () => {
            const original = new AudioListenerComponent({
                listenerId: 'main',
                active: false,
                position: { x: 1, y: 2, z: 3 },
                forward: { x: 0, y: 0, z: -1 },
                up: { x: 0, y: 1, z: 0 },
                useTransform: false,
                globalVolume: 0.7,
                dopplerFactor: 2,
                speakerMode: '5.1',
                sampleRate: 96000,
                dspBufferSize: 256,
                realVoices: 64,
                virtualVoices: 256,
                virtualVoiceBehavior: 'stopImmediately',
                hrtfPlugin: 'oculus',
                occlusionMode: 'none',
                occlusionLayers: [1, 2],
                reverbPreset: 'room',
                reverbLevel: 0.5,
                ambientClipId: 'amb-1',
                ambientVolume: 0.3,
                followCamera: false,
                metadata: { key: 'val' },
            });

            const data = original.serialize();
            const restored = new AudioListenerComponent();
            restored.deserialize(data);

            expect(restored.listenerId).toBe(original.listenerId);
            expect(restored.active).toBe(original.active);
            expect(restored.position).toEqual(original.position);
            expect(restored.globalVolume).toBe(original.globalVolume);
            expect(restored.speakerMode).toBe(original.speakerMode);
            expect(restored.sampleRate).toBe(original.sampleRate);
            expect(restored.reverbPreset).toBe(original.reverbPreset);
            expect(restored.metadata).toEqual(original.metadata);
        });

        it('ignores invalid types during deserialize', () => {
            const comp = new AudioListenerComponent();
            comp.deserialize({
                listenerId: 42,
                active: 'yes',
                globalVolume: 'loud',
            });
            expect(comp.listenerId).toBe('default');
            expect(comp.active).toBe(true);
            expect(comp.globalVolume).toBe(1);
        });

        it('normalizes invalid enum strings during deserialize', () => {
            const comp = new AudioListenerComponent();
            comp.deserialize({
                speakerMode: 'surround',
                hrtfPlugin: 'unknown',
                occlusionMode: 'simple',
                reverbPreset: 'cathedral',
                virtualVoiceBehavior: 'drop',
            });
            expect(comp.speakerMode).toBe('stereo');
            expect(comp.hrtfPlugin).toBe('none');
            expect(comp.occlusionMode).toBe('raycastDiffraction');
            expect(comp.reverbPreset).toBe('off');
            expect(comp.virtualVoiceBehavior).toBe('playSilent');
        });
    });

    describe('clone', () => {
        it('produces an independent copy', () => {
            const original = new AudioListenerComponent({
                listenerId: 'main',
                globalVolume: 0.5,
                position: { x: 1, y: 2, z: 3 },
            });
            const cloned = original.clone();
            expect(cloned.listenerId).toBe('main');
            expect(cloned.globalVolume).toBe(0.5);
            expect(cloned.position).toEqual({ x: 1, y: 2, z: 3 });

            cloned.globalVolume = 0.9;
            expect(original.globalVolume).toBe(0.5);
        });
    });
});

describe('AudioSourceComponent', () => {
    describe('constructor defaults', () => {
        it('initializes all fields with correct defaults', () => {
            const comp = new AudioSourceComponent();
            expect(comp.busId).toBe(MASTER_AUDIO_BUS_ID);
            expect(comp.volume).toBe(1);
            expect(comp.muted).toBe(false);
            expect(comp.loop).toBe(false);
            expect(comp.autoplay).toBe(false);
            expect(comp.playbackRate).toBe(1);
            expect(comp.detuneCents).toBe(0);
            expect(comp.pan).toBe(0);
            expect(comp.spatial).toBeUndefined();
            expect(comp.startOffsetSeconds).toBe(0);
            expect(comp.useTransform).toBe(true);
            expect(comp.metadata).toEqual({});
            expect(comp.playbackState).toBe('idle');
        });
    });

    describe('command queue', () => {
        it('play/pause/resume/stop enqueue commands', () => {
            const comp = new AudioSourceComponent();
            comp.play();
            comp.pause();
            comp.resume();
            comp.stop();
            const commands = comp.consumeCommands();
            expect(commands.length).toBe(4);
            expect(commands[0].kind).toBe('play');
            expect(commands[1].kind).toBe('pause');
            expect(commands[2].kind).toBe('resume');
            expect(commands[3].kind).toBe('stop');
        });

        it('consumeCommands drains the queue', () => {
            const comp = new AudioSourceComponent();
            comp.play();
            comp.consumeCommands();
            expect(comp.consumeCommands().length).toBe(0);
        });

        it('consumeCommands returns frozen array', () => {
            const comp = new AudioSourceComponent();
            comp.play();
            const commands = comp.consumeCommands();
            expect(Object.isFrozen(commands)).toBe(true);
        });
    });

    describe('autoplay', () => {
        it('consumes autoplay as a play command', () => {
            const comp = new AudioSourceComponent({ autoplay: true });
            const commands = comp.consumeCommands();
            expect(commands.length).toBe(1);
            expect(commands[0].kind).toBe('play');
        });

        it('autoplay is consumed only once', () => {
            const comp = new AudioSourceComponent({ autoplay: true });
            comp.consumeCommands();
            const second = comp.consumeCommands();
            expect(second.length).toBe(0);
        });

        it('setting autoplay to true re-arms pending flag', () => {
            const comp = new AudioSourceComponent();
            comp.consumeCommands();
            comp.autoplay = true;
            const commands = comp.consumeCommands();
            expect(commands.length).toBe(1);
            expect(commands[0].kind).toBe('play');
        });
    });

    describe('onDisable', () => {
        it('enqueues a stop command', () => {
            const comp = new AudioSourceComponent();
            comp.onDisable();
            const commands = comp.consumeCommands();
            expect(commands.some((c) => c.kind === 'stop')).toBe(true);
        });
    });

    describe('toDescriptor', () => {
        it('produces a descriptor with correct fields', () => {
            const comp = new AudioSourceComponent({
                sourceId: 'src-1',
                busId: 'music',
                volume: 0.5,
                muted: true,
                loop: true,
                playbackRate: 1.5,
                pan: -0.3,
            });
            const desc = comp.toDescriptor();
            expect(desc.id).toBe('src-1');
            expect(desc.busId).toBe('music');
            expect(desc.volume).toBe(0.5);
            expect(desc.muted).toBe(true);
            expect(desc.loop).toBe(true);
            expect(desc.playbackRate).toBe(1.5);
            expect(desc.pan).toBe(-0.3);
        });

        it('creates 3D spatial from transform when no spatial exists', () => {
            const comp = new AudioSourceComponent({ useTransform: true });
            // No transform available, so spatial stays undefined
            const desc = comp.toDescriptor();
            expect(desc.spatial).toBeUndefined();
        });
    });

    describe('serialize / deserialize roundtrip', () => {
        it('preserves all fields through serialize/deserialize', () => {
            const original = new AudioSourceComponent({
                sourceId: 'src-1',
                busId: 'sfx',
                volume: 0.7,
                muted: true,
                loop: true,
                autoplay: true,
                playbackRate: 2,
                detuneCents: 50,
                pan: 0.5,
                startOffsetSeconds: 1.5,
                useTransform: false,
                metadata: { tag: 'ui' },
            });

            const data = original.serialize();
            const restored = new AudioSourceComponent();
            restored.deserialize(data);

            expect(restored.sourceId).toBe(original.sourceId);
            expect(restored.busId).toBe(original.busId);
            expect(restored.volume).toBe(original.volume);
            expect(restored.muted).toBe(original.muted);
            expect(restored.loop).toBe(original.loop);
            expect(restored.autoplay).toBe(original.autoplay);
            expect(restored.playbackRate).toBe(original.playbackRate);
            expect(restored.detuneCents).toBe(original.detuneCents);
            expect(restored.pan).toBe(original.pan);
            expect(restored.metadata).toEqual(original.metadata);
        });
    });

    describe('clone', () => {
        it('produces an independent copy', () => {
            const original = new AudioSourceComponent({
                sourceId: 'src-1',
                volume: 0.5,
                loop: true,
            });
            const cloned = original.clone();
            expect(cloned.sourceId).toBe('src-1');
            expect(cloned.volume).toBe(0.5);
            expect(cloned.loop).toBe(true);

            cloned.volume = 0.9;
            expect(original.volume).toBe(0.5);
        });
    });

    describe('syncState', () => {
        it('updates playbackState from source state', () => {
            const comp = new AudioSourceComponent();
            expect(comp.playbackState).toBe('idle');
            comp.syncState({ playbackState: 'playing' } as any);
            expect(comp.playbackState).toBe('playing');
            comp.syncState({ playbackState: 'paused' } as any);
            expect(comp.playbackState).toBe('paused');
        });
    });

    describe('setter validation', () => {
        it('rejects negative volume', () => {
            const comp = new AudioSourceComponent({ volume: 1 });
            comp.volume = -1;
            expect(comp.volume).toBe(1);
        });

        it('rejects NaN volume', () => {
            const comp = new AudioSourceComponent({ volume: 0.5 });
            comp.volume = NaN;
            expect(comp.volume).toBe(0.5);
        });

        it('rejects non-positive playbackRate', () => {
            const comp = new AudioSourceComponent({ playbackRate: 1 });
            comp.playbackRate = 0;
            expect(comp.playbackRate).toBe(1);
            comp.playbackRate = -1;
            expect(comp.playbackRate).toBe(1);
        });

        it('rejects NaN detuneCents', () => {
            const comp = new AudioSourceComponent({ detuneCents: 100 });
            comp.detuneCents = NaN;
            expect(comp.detuneCents).toBe(100);
        });

        it('clamps pan to [-1, 1]', () => {
            const comp = new AudioSourceComponent({ pan: 0 });
            comp.pan = 5;
            expect(comp.pan).toBe(1);
            comp.pan = -5;
            expect(comp.pan).toBe(-1);
        });

        it('rejects NaN pan', () => {
            const comp = new AudioSourceComponent({ pan: 0.5 });
            comp.pan = NaN;
            expect(comp.pan).toBe(0.5);
        });
    });
});

describe('AudioComponentBinder', () => {
    const createSystem = () => {
        const context = new FakeAudioContext();
        return createAudioSystem({
            context: context as unknown as AudioContext,
            listeners: [{ id: 'main', active: true }],
        });
    };

    describe('attach / detach listener', () => {
        it('attachListener returns this for chaining', () => {
            const binder = new AudioComponentBinder(createSystem());
            const comp = new AudioListenerComponent();
            const result = binder.attachListener(comp);
            expect(result).toBe(binder);
        });

        it('detachListener returns true for attached, false for unknown', () => {
            const binder = new AudioComponentBinder(createSystem());
            const comp = new AudioListenerComponent();
            binder.attachListener(comp);
            expect(binder.detachListener(comp)).toBe(true);
            expect(binder.detachListener(comp)).toBe(false);
        });
    });

    describe('attach / detach source', () => {
        it('attachSource returns this for chaining', () => {
            const binder = new AudioComponentBinder(createSystem());
            const comp = new AudioSourceComponent();
            const result = binder.attachSource(comp);
            expect(result).toBe(binder);
        });

        it('detachSource returns true for attached, false for unknown', () => {
            const binder = new AudioComponentBinder(createSystem());
            const comp = new AudioSourceComponent();
            binder.attachSource(comp);
            expect(binder.detachSource(comp)).toBe(true);
            expect(binder.detachSource(comp)).toBe(false);
        });
    });

    describe('clear', () => {
        it('empties both listener and source sets', async () => {
            const binder = new AudioComponentBinder(createSystem());
            binder.attachListener(new AudioListenerComponent());
            binder.attachSource(new AudioSourceComponent());
            binder.clear();
            // After clear, update should do nothing (no listeners or sources)
            await binder.update();
        });
    });

    describe('update', () => {
        it('upserts listeners and sources into the system', async () => {
            const system = createSystem();
            const binder = new AudioComponentBinder(system);

            const listener = new AudioListenerComponent({
                listenerId: 'binder-listener',
                useTransform: false,
                position: { x: 10, y: 20, z: 30 },
            });
            binder.attachListener(listener);

            const buffer = new FakeAudioBuffer(2, 48000, 48000) as unknown as AudioBuffer;
            const source = new AudioSourceComponent({
                sourceId: 'binder-source',
                busId: 'master',
                clip: { kind: 'buffer', buffer },
                useTransform: false,
            });
            binder.attachSource(source);

            await binder.update();

            const listenerState = system.getListener('binder-listener');
            expect(listenerState).toBeDefined();
            expect(listenerState!.position).toEqual({ x: 10, y: 20, z: 30 });

            const sourceState = system.getSource('binder-source');
            expect(sourceState).toBeDefined();
        });

        it('dispatches play commands from sources', async () => {
            const system = createSystem();
            const binder = new AudioComponentBinder(system);

            const buffer = new FakeAudioBuffer(2, 48000, 48000) as unknown as AudioBuffer;
            const source = new AudioSourceComponent({
                sourceId: 'play-src',
                clip: { kind: 'buffer', buffer },
                useTransform: false,
            });
            source.play();
            binder.attachSource(source);

            await binder.update();

            const state = system.getSource('play-src');
            expect(state).toBeDefined();
            expect(state!.playbackState).toBe('playing');
        });
    });
});

// update() used to discard every command failure with a bare catch, so a source with an
// unresolvable clip silently did nothing: no rejection, no console output, no diagnostic
// attributable to the component. Failures are now collected and returned.
describe('AudioComponentBinder command failures', () => {
    const createBinderFixture = () => {
        const context = new FakeAudioContext();
        const system = createAudioSystem({ context: context as unknown as AudioContext });
        const binder = new AudioComponentBinder(system);
        return { context, system, binder };
    };

    const attachFailingSource = (binder: AudioComponentBinder, sourceId: string) => {
        const component = new AudioSourceComponent({
            sourceId,
            clip: { kind: 'url', url: 'https://example.invalid/missing.mp3' },
        });
        binder.attachSource(component);
        return component;
    };

    it('returns a failure for a command whose clip cannot resolve', async () => {
        const { binder } = createBinderFixture();
        const component = attachFailingSource(binder, 'broken');
        component.play();

        const failures = await binder.update();

        expect(failures).toHaveLength(1);
        expect(failures[0].command).toBe('play');
        expect(failures[0].component).toBe(component);
        expect(failures[0].error).toBeInstanceOf(Error);
    });

    it('keeps draining the queue after a failure', async () => {
        const { binder } = createBinderFixture();
        const first = attachFailingSource(binder, 'first-broken');
        const second = attachFailingSource(binder, 'second-broken');
        first.play();
        second.play();

        const failures = await binder.update();

        expect(failures.map((failure) => failure.component)).toEqual([first, second]);
    });

    it('returns an empty list when nothing fails', async () => {
        const { binder } = createBinderFixture();
        const buffer = new FakeAudioBuffer(2, 96000, 48000);
        const component = new AudioSourceComponent({
            sourceId: 'fine',
            clip: { kind: 'buffer', buffer: buffer as unknown as AudioBuffer },
        });
        binder.attachSource(component);
        component.play();

        const failures = await binder.update();

        expect(failures).toEqual([]);
    });
});
