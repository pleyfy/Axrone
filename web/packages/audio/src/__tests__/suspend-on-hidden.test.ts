import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAudioSystem } from '../system';
import {
    FakeAudioContext,
    installFakeAudioGlobals,
} from './helpers/fake-audio-context';

type VisibilityListener = () => void;

const installFakeDocument = () => {
    let hidden = false;
    let handler: VisibilityListener | undefined;
    const addEventListener = vi.fn((type: string, listener: VisibilityListener) => {
        if (type === 'visibilitychange') {
            handler = listener;
        }
    });
    const removeEventListener = vi.fn((type: string, listener: VisibilityListener) => {
        if (type === 'visibilitychange' && handler === listener) {
            handler = undefined;
        }
    });
    vi.stubGlobal('document', {
        get hidden() {
            return hidden;
        },
        addEventListener,
        removeEventListener,
    });
    return {
        addEventListener,
        removeEventListener,
        setHidden: (value: boolean) => {
            hidden = value;
        },
        fire: () => handler?.(),
    };
};

describe('AudioSystem suspendOnHidden', () => {
    beforeAll(() => {
        installFakeAudioGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('suspends the context when the document becomes hidden', async () => {
        const document = installFakeDocument();
        const context = new FakeAudioContext();
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            suspendOnHidden: true,
        });
        const suspendSpy = vi.spyOn(context, 'suspend');

        document.setHidden(true);
        document.fire();
        await vi.waitFor(() => {
            expect(suspendSpy).toHaveBeenCalled();
        });

        expect(system.status).toBe('suspended');
        await system.dispose();
    });

    it('resumes the context when the document becomes visible again', async () => {
        const document = installFakeDocument();
        const context = new FakeAudioContext();
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            suspendOnHidden: true,
        });
        const resumeSpy = vi.spyOn(context, 'resume');

        document.setHidden(true);
        document.fire();
        await vi.waitFor(() => {
            expect(system.status).toBe('suspended');
        });

        document.setHidden(false);
        document.fire();
        await vi.waitFor(() => {
            expect(resumeSpy).toHaveBeenCalled();
        });

        expect(system.status).toBe('running');
        await system.dispose();
    });

    it('does not listen to visibility changes unless opted in', () => {
        const document = installFakeDocument();
        const context = new FakeAudioContext();
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
        });

        expect(document.addEventListener).not.toHaveBeenCalledWith(
            'visibilitychange',
            expect.anything(),
        );

        void system.dispose();
    });

    it('removes the visibility listener on dispose', async () => {
        const document = installFakeDocument();
        const context = new FakeAudioContext();
        const system = createAudioSystem({
            context: context as unknown as AudioContext,
            suspendOnHidden: true,
        });

        expect(document.addEventListener).toHaveBeenCalledWith(
            'visibilitychange',
            expect.any(Function),
        );

        await system.dispose();

        expect(document.removeEventListener).toHaveBeenCalledWith(
            'visibilitychange',
            expect.any(Function),
        );
    });
});
