import {
    createSpriteAtlas,
    serializeSpriteAtlasDefinition,
    type SpriteAnimationClip,
    type SpriteAtlas,
    type SpriteAtlasDefinition,
    type SpriteAtlasFrame,
} from '@axrone/asset-2d';
import { Component, script } from '@axrone/ecs-runtime';
import { SpriteRenderer } from './sprite-renderer';

export interface SpriteAnimatorConfig {
    readonly atlas?: SpriteAtlas | SpriteAtlasDefinition | null;
    readonly clipId?: string | null;
    readonly playing?: boolean;
    readonly loop?: boolean | null;
    readonly speed?: number;
    readonly preserveSize?: boolean;
    readonly preserveAnchor?: boolean;
    readonly preserveSourceSize?: boolean;
    readonly preserveSliceBorder?: boolean;
}

const toSpriteAtlas = (
    value: SpriteAtlas | SpriteAtlasDefinition | null | undefined
): SpriteAtlas | null => {
    if (!value) {
        return null;
    }

    if (typeof (value as SpriteAtlas).getFrame === 'function') {
        return value as SpriteAtlas;
    }

    return createSpriteAtlas(value as SpriteAtlasDefinition);
};

const resolveDefaultClipId = (atlas: SpriteAtlas | null): string | null =>
    atlas?.animations[0]?.id ?? null;

@script({
    scriptName: 'SpriteAnimator',
    priority: 110,
    executeInEditMode: true,
    singleton: false,
})
export class SpriteAnimator extends Component {
    private _atlas: SpriteAtlas | null;
    private _clipId: string | null;
    private _playing: boolean;
    private _loop: boolean | null;
    private _speed: number;
    private _frameIndex: number;
    private _frameElapsedMs: number;
    private readonly _preserveSize: boolean;
    private readonly _preserveAnchor: boolean;
    private readonly _preserveSourceSize: boolean;
    private readonly _preserveSliceBorder: boolean;

    constructor(config: SpriteAnimatorConfig = {}) {
        super();
        this._atlas = toSpriteAtlas(config.atlas);
        this._clipId = config.clipId ?? resolveDefaultClipId(this._atlas);
        this._playing = config.playing ?? true;
        this._loop = config.loop ?? null;
        this._speed = Number.isFinite(config.speed) ? Math.max(0, config.speed ?? 1) : 1;
        this._frameIndex = 0;
        this._frameElapsedMs = 0;
        this._preserveSize = config.preserveSize ?? false;
        this._preserveAnchor = config.preserveAnchor ?? false;
        this._preserveSourceSize = config.preserveSourceSize ?? false;
        this._preserveSliceBorder = config.preserveSliceBorder ?? false;
    }

    get atlas(): SpriteAtlas | null {
        return this._atlas;
    }

    set atlas(value: SpriteAtlas | SpriteAtlasDefinition | null) {
        this._atlas = toSpriteAtlas(value);
        if (!this._clipId || !this.currentClip) {
            this._clipId = resolveDefaultClipId(this._atlas);
        }
        this._frameIndex = 0;
        this._frameElapsedMs = 0;
        this._applyCurrentFrame();
    }

    get clipId(): string | null {
        return this._clipId;
    }

    set clipId(value: string | null) {
        this._clipId = value;
        this._frameIndex = 0;
        this._frameElapsedMs = 0;
        this._applyCurrentFrame();
    }

    get playing(): boolean {
        return this._playing;
    }

    set playing(value: boolean) {
        this._playing = value;
    }

    get loop(): boolean | null {
        return this._loop;
    }

    set loop(value: boolean | null) {
        this._loop = value;
    }

    get speed(): number {
        return this._speed;
    }

    set speed(value: number) {
        this._speed = Number.isFinite(value) ? Math.max(0, value) : 1;
    }

    get currentClip(): SpriteAnimationClip | null {
        if (!this._atlas || !this._clipId) {
            return null;
        }

        return this._atlas.getAnimation(this._clipId) ?? null;
    }

    get currentFrame(): SpriteAtlasFrame | null {
        const clip = this.currentClip;
        if (clip && clip.frames.length > 0) {
            const frameIndex = Math.min(this._frameIndex, clip.frames.length - 1);
            return clip.frames[frameIndex]!.frame;
        }

        return this._atlas?.frames[0] ?? null;
    }

    override awake(): void {
        this._applyCurrentFrame();
    }

    override start(): void {
        this._applyCurrentFrame();
    }

    override update(deltaTime: number): void {
        const clip = this.currentClip;
        if (!clip || clip.frames.length === 0) {
            this._applyCurrentFrame();
            return;
        }

        this._applyCurrentFrame();

        if (!this._playing || this._speed <= 0 || clip.frames.length === 1 || deltaTime <= 0) {
            return;
        }

        const shouldLoop = this._loop ?? clip.loop;
        let remainingMs = Math.max(0, deltaTime * this._speed);
        if (shouldLoop && clip.durationMs > 0) {
            remainingMs %= clip.durationMs;
        }

        while (remainingMs > 0) {
            const currentFrame = clip.frames[this._frameIndex] ?? clip.frames[0]!;
            const remainingFrameMs = currentFrame.durationMs - this._frameElapsedMs;

            if (remainingMs < remainingFrameMs) {
                this._frameElapsedMs += remainingMs;
                break;
            }

            remainingMs -= remainingFrameMs;
            this._frameElapsedMs = 0;

            if (this._frameIndex < clip.frames.length - 1) {
                this._frameIndex += 1;
                this._applyCurrentFrame();
                continue;
            }

            if (shouldLoop) {
                this._frameIndex = 0;
                this._applyCurrentFrame();
                continue;
            }

            this._playing = false;
            this._frameIndex = clip.frames.length - 1;
            this._applyCurrentFrame();
            break;
        }
    }

    play(clipId: string | null = this._clipId): this {
        this._clipId = clipId ?? resolveDefaultClipId(this._atlas);
        this._frameIndex = 0;
        this._frameElapsedMs = 0;
        this._playing = true;
        this._applyCurrentFrame();
        return this;
    }

    pause(): this {
        this._playing = false;
        return this;
    }

    resume(): this {
        this._playing = true;
        return this;
    }

    stop(resetToFirstFrame: boolean = true): this {
        this._playing = false;
        this._frameElapsedMs = 0;
        if (resetToFirstFrame) {
            this._frameIndex = 0;
            this._applyCurrentFrame();
        }
        return this;
    }

    override serialize(): Record<string, unknown> {
        return {
            atlas: this._atlas ? serializeSpriteAtlasDefinition(this._atlas) : null,
            clipId: this._clipId,
            playing: this._playing,
            loop: this._loop,
            speed: this._speed,
            frameIndex: this._frameIndex,
            frameElapsedMs: this._frameElapsedMs,
            preserveSize: this._preserveSize,
            preserveAnchor: this._preserveAnchor,
            preserveSourceSize: this._preserveSourceSize,
            preserveSliceBorder: this._preserveSliceBorder,
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (data.atlas === null) {
            this._atlas = null;
        } else if (typeof data.atlas === 'object') {
            this._atlas = toSpriteAtlas(data.atlas as SpriteAtlasDefinition);
        }

        if (typeof data.clipId === 'string' || data.clipId === null) {
            this._clipId = data.clipId;
        } else if (!this._clipId) {
            this._clipId = resolveDefaultClipId(this._atlas);
        }

        if (typeof data.playing === 'boolean') {
            this._playing = data.playing;
        }

        if (typeof data.loop === 'boolean' || data.loop === null) {
            this._loop = data.loop;
        }

        if (typeof data.speed === 'number') {
            this._speed = Math.max(0, data.speed);
        }

        if (typeof data.frameIndex === 'number') {
            this._frameIndex = Math.max(0, Math.floor(data.frameIndex));
        }

        if (typeof data.frameElapsedMs === 'number') {
            this._frameElapsedMs = Math.max(0, data.frameElapsedMs);
        }

        this._applyCurrentFrame();
    }

    private _applyCurrentFrame(): void {
        const frame = this.currentFrame;
        if (!frame) {
            return;
        }

        const renderer = this.getComponent(SpriteRenderer);
        if (!renderer) {
            return;
        }

        renderer.applyFrame(frame, {
            preserveSize: this._preserveSize,
            preserveAnchor: this._preserveAnchor,
            preserveSourceSize: this._preserveSourceSize,
            preserveSliceBorder: this._preserveSliceBorder,
        });
    }
}