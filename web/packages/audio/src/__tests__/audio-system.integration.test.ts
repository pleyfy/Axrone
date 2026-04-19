import { beforeAll, describe, expect, it } from 'vitest';
import { createAudioSystem } from '../system';
import {
    FakeAudioBuffer,
    FakeAudioContext,
    installFakeAudioGlobals,
} from './helpers/fake-audio-context';

describe('AudioSystem integration', () => {
    beforeAll(() => {
        installFakeAudioGlobals();
    });

    it('syncs listener activation and fallback through the registry layer', () => {
        const context = new FakeAudioContext();
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            listeners: [
                {
                    id: 'main',
                    active: true,
                    position: { x: 1, y: 2, z: 3 },
                },
                {
                    id: 'backup',
                    position: { x: 9, y: 8, z: 7 },
                },
            ],
        });

        expect(system.activeListener?.id).toBe('main');
        expect(context.listener.positionX.value).toBe(1);
        expect(context.listener.positionY.value).toBe(2);
        expect(context.listener.positionZ.value).toBe(3);

        system.setActiveListener('backup');

        expect(system.activeListener?.id).toBe('backup');
        expect(context.listener.positionX.value).toBe(9);
        expect(context.listener.positionY.value).toBe(8);
        expect(context.listener.positionZ.value).toBe(7);

        expect(system.removeListener('backup')).toBe(true);
        expect(system.activeListener?.id).toBe('main');
        expect(context.listener.positionX.value).toBe(1);
        expect(context.listener.positionY.value).toBe(2);
        expect(context.listener.positionZ.value).toBe(3);
    });

    it('re-routes active playback when a source bus changes', async () => {
        const context = new FakeAudioContext();
        const buffer = new FakeAudioBuffer(2, 96000, 48000) as unknown as AudioBuffer;
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
        });

        system.upsertBus({ id: 'music' });
        system.upsertBus({ id: 'sfx' });
        system.upsertListener({ id: 'listener', active: true });
        system.upsertSource({
            id: 'laser',
            busId: 'music',
            clip: {
                kind: 'buffer',
                buffer,
            },
            spatial: {
                mode: '2d',
                position: { x: 2, y: 0, z: 0 },
            },
        });

        await system.playSource('laser');

        const musicBusGain = context.gainNodes[1];
        const sfxBusGain = context.gainNodes[2];
        const playbackPanner = context.stereoPannerNodes.at(-1);

        expect(playbackPanner?.connections[0]).toBe(musicBusGain);
        expect(system.getSource('laser')?.busId).toBe('music');

        system.updateSource('laser', { busId: 'sfx' });

        expect(playbackPanner?.connections[0]).toBe(sfxBusGain);
        expect(system.getSource('laser')?.busId).toBe('sfx');
    });

    it('restores snapshot playback into a fresh audio context with preserved offsets', async () => {
        const sourceContext = new FakeAudioContext();
        const buffer = new FakeAudioBuffer(2, 192000, 48000) as unknown as AudioBuffer;
        const sourceSystem = createAudioSystem({
            context: sourceContext as unknown as AudioContext,
            listeners: [
                {
                    id: 'main',
                    active: true,
                    position: { x: 4, y: 0, z: 0 },
                },
            ],
            buses: [{ id: 'music' }],
            sources: [
                {
                    id: 'theme',
                    busId: 'music',
                    clip: {
                        kind: 'buffer',
                        buffer,
                    },
                    loop: true,
                },
            ],
        });

        await sourceSystem.playSource('theme');
        sourceContext.advance(1.5);
        const snapshot = sourceSystem.snapshot();

        expect(snapshot.sources[0]?.currentOffsetSeconds).toBeCloseTo(1.5, 5);

        const restoredContext = new FakeAudioContext();
        const restoredSystem = createAudioSystem({
            context: restoredContext as unknown as AudioContext,
        });

        await restoredSystem.restore(snapshot, { restorePlayback: true });

        expect(restoredSystem.activeListener?.id).toBe('main');
        expect(restoredSystem.getBus('music')?.id).toBe('music');
        expect(restoredSystem.getSource('theme')?.playbackState).toBe('playing');
        expect(restoredContext.listener.positionX.value).toBe(4);

        const restoredPlayback = restoredContext.bufferSourceNodes.at(-1);
        expect(restoredPlayback?.startCalls[0]?.offset).toBeCloseTo(
            snapshot.sources[0]?.currentOffsetSeconds ?? 0,
            5
        );
    });

    it('captures pause offsets and resumes from the paused position', async () => {
        const context = new FakeAudioContext();
        const buffer = new FakeAudioBuffer(2, 192000, 48000) as unknown as AudioBuffer;
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            listeners: [{ id: 'main', active: true }],
            sources: [
                {
                    id: 'ambience',
                    clip: {
                        kind: 'buffer',
                        buffer,
                    },
                },
            ],
        });

        await system.playSource('ambience');
        context.advance(0.75);

        system.pauseSource('ambience');
        context.flush();

        expect(system.getSource('ambience')?.playbackState).toBe('paused');
        expect(system.getSource('ambience')?.currentOffsetSeconds).toBeCloseTo(0.75, 5);

        await system.resumeSource('ambience');

        const resumedNode = context.bufferSourceNodes.at(-1);
        expect(resumedNode?.startCalls[0]?.offset).toBeCloseTo(0.75, 5);
        expect(system.getSource('ambience')?.playbackState).toBe('playing');
    });

    it('cleans up transient sources after scheduled stop reaches ended state', async () => {
        const context = new FakeAudioContext();
        const buffer = new FakeAudioBuffer(2, 96000, 48000) as unknown as AudioBuffer;
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            listeners: [{ id: 'main', active: true }],
        });

        const handle = await system.play({
            clip: {
                kind: 'buffer',
                buffer,
            },
        });

        expect(system.getSource(handle.sourceId)).toBeDefined();

        handle.stop({ when: context.currentTime + 0.5 });
        context.advance(0.25);

        expect(system.getSource(handle.sourceId)).toBeDefined();

        context.advance(0.25);

        expect(system.getSource(handle.sourceId)).toBeUndefined();
    });

    it('transitions non-looping playback to stopped when natural duration elapses', async () => {
        const context = new FakeAudioContext();
        const buffer = new FakeAudioBuffer(2, 48000, 48000) as unknown as AudioBuffer;
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            listeners: [{ id: 'main', active: true }],
            sources: [
                {
                    id: 'voice',
                    clip: {
                        kind: 'buffer',
                        buffer,
                    },
                },
            ],
        });

        await system.playSource('voice');
        context.advance(1);

        expect(system.getSource('voice')?.playbackState).toBe('stopped');
        expect(system.getSource('voice')?.currentOffsetSeconds).toBe(0);
    });
});
