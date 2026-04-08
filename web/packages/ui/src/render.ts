import type { UIRuntime } from './runtime';
import type { RenderCommand, SizeLike, UIFrame } from './types';

export interface UIFrameSink<TPayload = unknown> extends Disposable {
    render(frame: Readonly<UIFrame<TPayload>>): void;
}

export interface UIFrameSource<TPayload = unknown> {
    getFrame(viewport: Readonly<SizeLike>): UIFrame<TPayload> | null;
}

export type UIFrameProducer<TPayload = unknown> =
    | Readonly<UIFrame<TPayload>>
    | UIFrameSource<TPayload>
    | ((viewport: Readonly<SizeLike>) => UIFrame<TPayload> | null);

export interface UIRuntimeFrameSource<TPayload = unknown> extends UIFrameSource<TPayload> {
    readonly runtime: Pick<UIRuntime<TPayload>, 'commit'>;
}

const isUIFrame = <TPayload>(value: UIFrameProducer<TPayload>): value is Readonly<UIFrame<TPayload>> =>
    typeof value === 'object' && value !== null && 'commands' in value && 'metrics' in value;

const isUIFrameSource = <TPayload>(value: UIFrameProducer<TPayload>): value is UIFrameSource<TPayload> =>
    typeof value === 'object' && value !== null && 'getFrame' in value;

export const createRuntimeFrameSource = <TPayload>(
    runtime: Pick<UIRuntime<TPayload>, 'commit'>
): UIRuntimeFrameSource<TPayload> => ({
    runtime,
    getFrame(viewport) {
        return runtime.commit(viewport);
    },
});

export const resolveUIFrame = <TPayload>(
    producer: UIFrameProducer<TPayload>,
    viewport: Readonly<SizeLike>
): UIFrame<TPayload> | null => {
    if (typeof producer === 'function') {
        return producer(viewport);
    }
    if (isUIFrameSource(producer)) {
        return producer.getFrame(viewport);
    }
    return isUIFrame(producer) ? (producer as UIFrame<TPayload>) : null;
};

export const renderUIFrame = <TPayload>(
    sink: Pick<UIFrameSink<TPayload>, 'render'>,
    producer: UIFrameProducer<TPayload>,
    viewport: Readonly<SizeLike>
): UIFrame<TPayload> | null => {
    const frame = resolveUIFrame(producer, viewport);
    if (frame === null) {
        return null;
    }
    sink.render(frame);
    return frame;
};

export type { RenderCommand, SizeLike, UIFrame };