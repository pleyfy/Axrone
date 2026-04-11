import type { TextureSheetConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ParticleId } from '../types';
import { BaseModule } from './base-module';

interface TextureFrame {
    x: number;
    y: number;
    width: number;
    height: number;
    u: number;
    v: number;
    uWidth: number;
    vHeight: number;
}

interface AnimationSequence {
    name: string;
    startFrame: number;
    endFrame: number;
    fps: number;
    loop: boolean;
}

interface ParticleAnimation {
    particleId: ParticleId;
    sequenceName: string;
    currentFrame: number;
    frameTime: number;
    elapsed: number;
    playing: boolean;
    loop: boolean;
}

export class TextureSheetModule extends BaseModule<'texture'> {
    private _frames: TextureFrame[] = [];
    private _sequences = new Map<string, AnimationSequence>();
    private _particleAnimations = new Map<ParticleId, ParticleAnimation>();
    private _frameData: Float32Array;
    private _maxParticles: number;

    constructor(configuration: TextureSheetConfiguration) {
        super('texture', configuration, 1100);
        this._maxParticles = 10000;
        this._frameData = new Float32Array(this._maxParticles * 4);
    }

    protected onInitialize(): void {
        const config = this.config;

        const textureWidth = 1024;
        const textureHeight = 1024;
        this._generateFrames(config.tilesX, config.tilesY, textureWidth, textureHeight);

        if (config.animation !== 'wholeSheet') {
            this._setupDefaultAnimation(config);
        }
    }

    protected onDestroy(): void {
        this._frames.length = 0;
        this._sequences.clear();
        this._particleAnimations.clear();
    }

    protected onReset(): void {
        this._particleAnimations.clear();
        this._frameData.fill(0);
    }

    protected onUpdate(deltaTime: number): void {
        if (!this.config.enabled) return;

        for (const [particleId, animation] of this._particleAnimations.entries()) {
            if (animation.playing) {
                this._updateAnimation(animation, deltaTime);
            }
        }
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled) return;

        const config = this.config;
        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const particleId = particles.getParticleId(i);
            this._processParticleTexture(particleId, i, particles, config, deltaTime);
        }

        for (const [particleId, animation] of this._particleAnimations.entries()) {
            const particleIndex = particles.getParticleIndex(particleId);
            if (particleIndex === -1 || !alive[particleIndex]) {
                this._particleAnimations.delete(particleId);
            }
        }
    }

    protected onConfigure(
        newConfig: TextureSheetConfiguration,
        oldConfig: TextureSheetConfiguration
    ): void {
        if (newConfig.tilesX !== oldConfig.tilesX || newConfig.tilesY !== oldConfig.tilesY) {
            const textureWidth = 1024;
            const textureHeight = 1024;
            this._generateFrames(newConfig.tilesX, newConfig.tilesY, textureWidth, textureHeight);
        }

        if (newConfig.animation !== oldConfig.animation) {
            if (newConfig.animation !== 'wholeSheet') {
                this._setupDefaultAnimation(newConfig);
            } else {
                this._sequences.clear();
                this._particleAnimations.clear();
            }
        }
    }

    private _generateFrames(
        tilesX: number,
        tilesY: number,
        textureWidth: number,
        textureHeight: number
    ): void {
        this._frames.length = 0;

        const frameWidth = textureWidth / tilesX;
        const frameHeight = textureHeight / tilesY;
        const uStep = 1.0 / tilesX;
        const vStep = 1.0 / tilesY;

        for (let y = 0; y < tilesY; y++) {
            for (let x = 0; x < tilesX; x++) {
                const frame: TextureFrame = {
                    x: x * frameWidth,
                    y: y * frameHeight,
                    width: frameWidth,
                    height: frameHeight,
                    u: x * uStep,
                    v: y * vStep,
                    uWidth: uStep,
                    vHeight: vStep,
                };
                this._frames.push(frame);
            }
        }
    }

    private _setupDefaultAnimation(config: TextureSheetConfiguration): void {
        if (this._frames.length > 0) {
            const sequence: AnimationSequence = {
                name: 'default',
                startFrame: 0,
                endFrame: this._frames.length - 1,
                fps: config.fps,
                loop: true,
            };
            this._sequences.set('default', sequence);
        }
    }

    private _processParticleTexture(
        particleId: ParticleId,
        particleIndex: number,
        particles: IParticleBuffer,
        config: TextureSheetConfiguration,
        deltaTime: number
    ): void {
        let animation = this._particleAnimations.get(particleId);

        if (!animation) {
            const newAnimation = this._createParticleAnimation(particleId, config);
            if (newAnimation) {
                this._particleAnimations.set(particleId, newAnimation);
                animation = newAnimation;
            }
        }

        if (animation) {
            this._updateParticleFrameData(particleIndex, animation);
        }
    }

    private _createParticleAnimation(
        particleId: ParticleId,
        config: TextureSheetConfiguration
    ): ParticleAnimation | null {
        if (config.animation === 'wholeSheet') {
            return {
                particleId,
                sequenceName: 'static',
                currentFrame: 0,
                frameTime: 0,
                elapsed: 0,
                playing: false,
                loop: false,
            };
        }

        const sequence = this._sequences.get('default');
        if (!sequence) return null;

        const animation: ParticleAnimation = {
            particleId,
            sequenceName: 'default',
            currentFrame: sequence.startFrame,
            frameTime: 1.0 / sequence.fps,
            elapsed: 0,
            playing: true,
            loop: sequence.loop,
        };

        return animation;
    }

    private _updateAnimation(animation: ParticleAnimation, deltaTime: number): void {
        animation.elapsed += deltaTime;

        if (animation.elapsed >= animation.frameTime) {
            const sequence = this._sequences.get(animation.sequenceName);
            if (!sequence) return;

            animation.elapsed = 0;
            animation.currentFrame++;

            if (animation.currentFrame > sequence.endFrame) {
                if (animation.loop) {
                    animation.currentFrame = sequence.startFrame;
                } else {
                    animation.currentFrame = sequence.endFrame;
                    animation.playing = false;
                }
            }
        }
    }

    private _updateParticleFrameData(particleIndex: number, animation: ParticleAnimation): void {
        const frameIndex = Math.max(0, Math.min(animation.currentFrame, this._frames.length - 1));
        const frame = this._frames[frameIndex];

        if (frame) {
            const dataIndex = particleIndex * 4;
            this._frameData[dataIndex] = frame.u;
            this._frameData[dataIndex + 1] = frame.v;
            this._frameData[dataIndex + 2] = frame.uWidth;
            this._frameData[dataIndex + 3] = frame.vHeight;
        }
    }

    addAnimationSequence(
        name: string,
        startFrame: number,
        endFrame: number,
        fps: number,
        loop: boolean = true
    ): boolean {
        if (startFrame < 0 || endFrame >= this._frames.length || startFrame > endFrame) {
            return false;
        }

        const sequence: AnimationSequence = {
            name,
            startFrame,
            endFrame,
            fps,
            loop,
        };

        this._sequences.set(name, sequence);
        return true;
    }

    removeAnimationSequence(name: string): boolean {
        return this._sequences.delete(name);
    }

    setParticleAnimation(particleId: ParticleId, sequenceName: string): boolean {
        const sequence = this._sequences.get(sequenceName);
        const existingAnimation = this._particleAnimations.get(particleId);

        if (!sequence || !existingAnimation) {
            return false;
        }

        existingAnimation.sequenceName = sequenceName;
        existingAnimation.currentFrame = sequence.startFrame;
        existingAnimation.frameTime = 1.0 / sequence.fps;
        existingAnimation.elapsed = 0;
        existingAnimation.playing = true;
        existingAnimation.loop = sequence.loop;

        return true;
    }

    setParticleFrame(particleId: ParticleId, frameIndex: number): boolean {
        const animation = this._particleAnimations.get(particleId);

        if (!animation || frameIndex < 0 || frameIndex >= this._frames.length) {
            return false;
        }

        animation.currentFrame = frameIndex;
        animation.playing = false;
        return true;
    }

    playParticleAnimation(particleId: ParticleId): boolean {
        const animation = this._particleAnimations.get(particleId);
        if (animation) {
            animation.playing = true;
            return true;
        }
        return false;
    }

    pauseParticleAnimation(particleId: ParticleId): boolean {
        const animation = this._particleAnimations.get(particleId);
        if (animation) {
            animation.playing = false;
            return true;
        }
        return false;
    }

    getParticleCurrentFrame(particleId: ParticleId): number {
        const animation = this._particleAnimations.get(particleId);
        return animation ? animation.currentFrame : -1;
    }

    getFrameUV(frameIndex: number): TextureFrame | null {
        return frameIndex >= 0 && frameIndex < this._frames.length
            ? this._frames[frameIndex]
            : null;
    }

    getFrameData(): Float32Array {
        return this._frameData;
    }

    getFrameCount(): number {
        return this._frames.length;
    }

    getSequenceNames(): string[] {
        return Array.from(this._sequences.keys());
    }

    getActiveAnimationCount(): number {
        let count = 0;
        for (const animation of this._particleAnimations.values()) {
            if (animation.playing) count++;
        }
        return count;
    }

    getFrameAtTime(sequenceName: string, time: number): number {
        const sequence = this._sequences.get(sequenceName);
        if (!sequence) return -1;

        const frameCount = sequence.endFrame - sequence.startFrame + 1;
        const sequenceDuration = frameCount / sequence.fps;

        let normalizedTime = time % sequenceDuration;
        if (normalizedTime < 0) normalizedTime += sequenceDuration;

        const frameIndex = Math.floor((normalizedTime / sequenceDuration) * frameCount);
        return sequence.startFrame + Math.min(frameIndex, frameCount - 1);
    }

    preloadFrames(frameIndices: number[]): void {
        for (const index of frameIndices) {
            if (index >= 0 && index < this._frames.length) {
                const frame = this._frames[index];
            }
        }
    }
}
