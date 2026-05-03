export class FakeAudioParam {
    value: number;
    readonly events: Array<
        | { readonly type: 'cancel'; readonly atTime: number }
        | { readonly type: 'set'; readonly value: number; readonly atTime: number }
        | { readonly type: 'ramp'; readonly value: number; readonly atTime: number }
    > = [];

    constructor(initialValue = 0) {
        this.value = initialValue;
    }

    cancelScheduledValues(atTime: number): void {
        this.events.push({ type: 'cancel', atTime });
    }

    setValueAtTime(value: number, atTime: number): void {
        this.value = value;
        this.events.push({ type: 'set', value, atTime });
    }

    linearRampToValueAtTime(value: number, atTime: number): void {
        this.value = value;
        this.events.push({ type: 'ramp', value, atTime });
    }
}

class FakeAudioNode {
    readonly connections: unknown[] = [];

    constructor(readonly kind: string) {}

    connect(target: unknown): unknown {
        this.connections.push(target);
        return target;
    }

    disconnect(): void {
        this.connections.splice(0);
    }
}

export class FakeGainNode extends FakeAudioNode {
    readonly gain = new FakeAudioParam(1);

    constructor() {
        super('gain');
    }
}

export class FakeStereoPannerNode extends FakeAudioNode {
    readonly pan = new FakeAudioParam(0);

    constructor() {
        super('stereo-panner');
    }
}

export class FakePannerNode extends FakeAudioNode {
    readonly positionX = new FakeAudioParam(0);
    readonly positionY = new FakeAudioParam(0);
    readonly positionZ = new FakeAudioParam(0);
    readonly orientationX = new FakeAudioParam(0);
    readonly orientationY = new FakeAudioParam(0);
    readonly orientationZ = new FakeAudioParam(-1);

    distanceModel: DistanceModelType = 'inverse';
    panningModel: PanningModelType = 'HRTF';
    refDistance = 1;
    maxDistance = 1000000;
    rolloffFactor = 0;
    coneInnerAngle = 360;
    coneOuterAngle = 360;
    coneOuterGain = 0;

    constructor() {
        super('panner');
    }
}

export class FakeAudioBuffer {
    readonly channelData: Float32Array[];
    readonly duration: number;
    readonly numberOfChannels: number;

    constructor(
        channelCount = 2,
        readonly length = 48000,
        readonly sampleRate = 48000
    ) {
        this.numberOfChannels = channelCount;
        this.duration = sampleRate > 0 ? length / sampleRate : 0;
        this.channelData = Array.from({ length: channelCount }, () => new Float32Array(length));
    }

    copyToChannel(source: Float32Array, channelNumber: number): void {
        this.channelData[channelNumber]?.set(source);
    }
}

type ScheduledTime = number | undefined;

const minScheduledTime = (left: ScheduledTime, right: ScheduledTime): ScheduledTime => {
    if (left === undefined) {
        return right;
    }
    if (right === undefined) {
        return left;
    }
    return Math.min(left, right);
};

export class FakeBufferSourceNode extends FakeAudioNode {
    buffer: AudioBuffer | null = null;
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    readonly playbackRate = new FakeAudioParam(1);
    readonly detune = new FakeAudioParam(0);
    onended: (() => void) | null = null;
    readonly startCalls: Array<{
        readonly when: number;
        readonly offset: number;
        readonly duration?: number;
    }> = [];
    readonly stopCalls: number[] = [];

    #scheduledStart?: number;
    #scheduledNaturalEnd?: number;
    #scheduledStop?: number;
    #ended = false;

    constructor(readonly context: FakeAudioContext) {
        super('buffer-source');
    }

    start(when = 0, offset = 0, duration?: number): void {
        this.startCalls.push({ when, offset, duration });
        this.#scheduledStart = when;
        if (this.loop && duration === undefined) {
            this.#scheduledNaturalEnd = undefined;
            return;
        }

        const resolvedDuration =
            duration ??
            Math.max(0, (this.buffer?.duration ?? 0) - offset);
        this.#scheduledNaturalEnd = when + resolvedDuration;
    }

    stop(when = this.context.currentTime): void {
        this.stopCalls.push(when);
        this.#scheduledStop = when;
    }

    emitEnded(): void {
        if (this.#ended) {
            return;
        }
        this.#ended = true;
        this.onended?.();
    }

    flush(currentTime: number): void {
        if (this.#ended) {
            return;
        }

        const effectiveEnd = minScheduledTime(this.#scheduledNaturalEnd, this.#scheduledStop);
        if (effectiveEnd === undefined) {
            return;
        }

        if (currentTime >= effectiveEnd) {
            this.emitEnded();
        }
    }
}

export class FakeAudioListener {
    readonly positionX = new FakeAudioParam(0);
    readonly positionY = new FakeAudioParam(0);
    readonly positionZ = new FakeAudioParam(0);
    readonly forwardX = new FakeAudioParam(0);
    readonly forwardY = new FakeAudioParam(0);
    readonly forwardZ = new FakeAudioParam(-1);
    readonly upX = new FakeAudioParam(0);
    readonly upY = new FakeAudioParam(1);
    readonly upZ = new FakeAudioParam(0);
}

export class FakeAudioContext {
    currentTime = 0;
    state: AudioContextState = 'running';
    readonly destination = new FakeAudioNode('destination');
    readonly listener = new FakeAudioListener();
    readonly gainNodes: FakeGainNode[] = [];
    readonly stereoPannerNodes: FakeStereoPannerNode[] = [];
    readonly pannerNodes: FakePannerNode[] = [];
    readonly bufferSourceNodes: FakeBufferSourceNode[] = [];
    readonly buffers: FakeAudioBuffer[] = [];

    createGain(): GainNode {
        const node = new FakeGainNode();
        this.gainNodes.push(node);
        return node as unknown as GainNode;
    }

    createStereoPanner(): StereoPannerNode {
        const node = new FakeStereoPannerNode();
        this.stereoPannerNodes.push(node);
        return node as unknown as StereoPannerNode;
    }

    createPanner(): PannerNode {
        const node = new FakePannerNode();
        this.pannerNodes.push(node);
        return node as unknown as PannerNode;
    }

    createBufferSource(): AudioBufferSourceNode {
        const node = new FakeBufferSourceNode(this);
        this.bufferSourceNodes.push(node);
        return node as unknown as AudioBufferSourceNode;
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
        const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
        this.buffers.push(buffer);
        return buffer as unknown as AudioBuffer;
    }

    async decodeAudioData(_audioData: ArrayBuffer): Promise<AudioBuffer> {
        return this.createBuffer(2, 48000, 48000);
    }

    async resume(): Promise<void> {
        this.state = 'running';
    }

    async suspend(): Promise<void> {
        this.state = 'suspended';
    }

    async close(): Promise<void> {
        this.state = 'closed';
    }

    advance(seconds: number): void {
        this.currentTime += seconds;
        this.flush();
    }

    flush(): void {
        for (const node of this.bufferSourceNodes) {
            node.flush(this.currentTime);
        }
    }
}

let globalsInstalled = false;

export const installFakeAudioGlobals = (): void => {
    if (globalsInstalled) {
        return;
    }

    const target = globalThis as typeof globalThis & {
        AudioBuffer: typeof AudioBuffer;
        StereoPannerNode: typeof StereoPannerNode;
        PannerNode: typeof PannerNode;
    };

    target.AudioBuffer = FakeAudioBuffer as unknown as typeof AudioBuffer;
    target.StereoPannerNode = FakeStereoPannerNode as unknown as typeof StereoPannerNode;
    target.PannerNode = FakePannerNode as unknown as typeof PannerNode;
    globalsInstalled = true;
};
