import type { CustomDataConfiguration } from '../core/configuration';
import type { IParticleBuffer } from '../core/interfaces';
import type { ParticleId } from '../types';
import { BaseModule } from './base-module';

interface CustomDataSlot {
    type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color';
    data: Float32Array;
    dirty: boolean;
}

interface ParticleCustomData {
    particleId: ParticleId;
    slot1?: number | Float32Array;
    slot2?: number | Float32Array;
    slot3?: number | Float32Array;
    slot4?: number | Float32Array;
}

export class CustomDataModule extends BaseModule<'custom'> {
    private _slots = new Map<string, CustomDataSlot>();
    private _particleData = new Map<ParticleId, ParticleCustomData>();
    private _maxParticles: number;
    private _dataBuffers: Map<string, Float32Array> = new Map();

    constructor(configuration: CustomDataConfiguration) {
        super('custom', configuration, 1000);
        this._maxParticles = 10000;
    }

    protected onInitialize(): void {
        const config = this.config;

        this._initializeSlot('slot1', config.slot1);
        this._initializeSlot('slot2', config.slot2);
        this._initializeSlot('slot3', config.slot3);
        this._initializeSlot('slot4', config.slot4);
    }

    protected onDestroy(): void {
        this._slots.clear();
        this._particleData.clear();
        this._dataBuffers.clear();
    }

    protected onReset(): void {
        this._particleData.clear();

        for (const buffer of this._dataBuffers.values()) {
            buffer.fill(0);
        }
    }

    protected onUpdate(deltaTime: number): void {
        if (!this.config.enabled) return;

        this._updateAnimatedData(deltaTime);
    }

    protected onProcess(particles: IParticleBuffer, deltaTime: number): void {
        if (!this.config.enabled) return;

        const alive = particles.alive as Uint32Array;
        const count = particles.count;

        for (let i = 0; i < count; i++) {
            if (!alive[i]) continue;

            const particleId = particles.getParticleId(i);
            this._processParticleCustomData(particleId, i, particles, deltaTime);
        }

        for (const [particleId, data] of this._particleData.entries()) {
            const particleIndex = particles.getParticleIndex(particleId);
            if (particleIndex === -1 || !alive[particleIndex]) {
                this._particleData.delete(particleId);
            }
        }
    }

    protected onConfigure(
        newConfig: CustomDataConfiguration,
        oldConfig: CustomDataConfiguration
    ): void {
        if (this._slotsChanged(newConfig, oldConfig)) {
            this.onReset();
            this.onInitialize();
        }
    }

    private _initializeSlot(
        slotName: string,
        slotConfig: { readonly type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' }
    ): void {
        const componentCount = this._getComponentCount(slotConfig.type);
        const bufferSize = this._maxParticles * componentCount;

        const slot: CustomDataSlot = {
            type: slotConfig.type,
            data: new Float32Array(bufferSize),
            dirty: false,
        };

        this._slots.set(slotName, slot);
        this._dataBuffers.set(slotName, slot.data);
    }

    private _getComponentCount(
        type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color'
    ): number {
        switch (type) {
            case 'float':
                return 1;
            case 'vector2':
                return 2;
            case 'vector3':
                return 3;
            case 'vector4':
                return 4;
            case 'color':
                return 4;
            default:
                return 1;
        }
    }

    private _processParticleCustomData(
        particleId: ParticleId,
        particleIndex: number,
        particles: IParticleBuffer,
        deltaTime: number
    ): void {
        let particleData = this._particleData.get(particleId);

        if (!particleData) {
            particleData = { particleId };
            this._particleData.set(particleId, particleData);
        }

        for (const [slotName, slot] of this._slots.entries()) {
            this._updateSlotData(slotName, slot, particleData, particleIndex, particles, deltaTime);
        }
    }

    private _updateSlotData(
        slotName: string,
        slot: CustomDataSlot,
        particleData: ParticleCustomData,
        particleIndex: number,
        particles: IParticleBuffer,
        deltaTime: number
    ): void {
        const componentCount = this._getComponentCount(slot.type);
        const dataIndex = particleIndex * componentCount;

        let data = (particleData as any)[slotName];

        if (!data) {
            data = this._createDefaultData(slot.type);
            (particleData as any)[slotName] = data;
        }

        if (typeof data === 'number') {
            slot.data[dataIndex] = data;
        } else if (data instanceof Float32Array) {
            for (let i = 0; i < Math.min(componentCount, data.length); i++) {
                slot.data[dataIndex + i] = data[i];
            }
        }

        slot.dirty = true;
    }

    private _createDefaultData(
        type: 'float' | 'vector2' | 'vector3' | 'vector4' | 'color'
    ): number | Float32Array {
        switch (type) {
            case 'float':
                return 0;
            case 'vector2':
                return new Float32Array([0, 0]);
            case 'vector3':
                return new Float32Array([0, 0, 0]);
            case 'vector4':
                return new Float32Array([0, 0, 0, 0]);
            case 'color':
                return new Float32Array([1, 1, 1, 1]);
            default:
                return 0;
        }
    }

    private _updateAnimatedData(deltaTime: number): void {}

    private _slotsChanged(
        newConfig: CustomDataConfiguration,
        oldConfig: CustomDataConfiguration
    ): boolean {
        return (
            newConfig.slot1.type !== oldConfig.slot1.type ||
            newConfig.slot2.type !== oldConfig.slot2.type ||
            newConfig.slot3.type !== oldConfig.slot3.type ||
            newConfig.slot4.type !== oldConfig.slot4.type
        );
    }

    setParticleData(
        particleId: ParticleId,
        slotName: string,
        data: number | Float32Array
    ): boolean {
        const particleData = this._particleData.get(particleId);
        const slot = this._slots.get(slotName);

        if (!particleData || !slot) {
            return false;
        }

        if (typeof data === 'number' && slot.type !== 'float') {
            return false;
        }

        if (data instanceof Float32Array) {
            const expectedComponents = this._getComponentCount(slot.type);
            if (data.length !== expectedComponents) {
                return false;
            }
        }

        (particleData as any)[slotName] = data;
        slot.dirty = true;
        return true;
    }

    getParticleData(particleId: ParticleId, slotName: string): number | Float32Array | undefined {
        const particleData = this._particleData.get(particleId);
        return particleData ? (particleData as any)[slotName] : undefined;
    }

    getSlotBuffer(slotName: string): Float32Array | undefined {
        return this._dataBuffers.get(slotName);
    }

    getSlotType(
        slotName: string
    ): 'float' | 'vector2' | 'vector3' | 'vector4' | 'color' | undefined {
        const slot = this._slots.get(slotName);
        return slot?.type;
    }

    isSlotDirty(slotName: string): boolean {
        const slot = this._slots.get(slotName);
        return slot?.dirty ?? false;
    }

    markSlotClean(slotName: string): void {
        const slot = this._slots.get(slotName);
        if (slot) {
            slot.dirty = false;
        }
    }

    getAllSlotNames(): string[] {
        return Array.from(this._slots.keys());
    }

    getActiveParticleCount(): number {
        return this._particleData.size;
    }

    setParticleFloat(particleId: ParticleId, slotName: string, value: number): boolean {
        return this.setParticleData(particleId, slotName, value);
    }

    setParticleVector2(particleId: ParticleId, slotName: string, x: number, y: number): boolean {
        return this.setParticleData(particleId, slotName, new Float32Array([x, y]));
    }

    setParticleVector3(
        particleId: ParticleId,
        slotName: string,
        x: number,
        y: number,
        z: number
    ): boolean {
        return this.setParticleData(particleId, slotName, new Float32Array([x, y, z]));
    }

    setParticleVector4(
        particleId: ParticleId,
        slotName: string,
        x: number,
        y: number,
        z: number,
        w: number
    ): boolean {
        return this.setParticleData(particleId, slotName, new Float32Array([x, y, z, w]));
    }

    setParticleColor(
        particleId: ParticleId,
        slotName: string,
        r: number,
        g: number,
        b: number,
        a: number = 1
    ): boolean {
        return this.setParticleData(particleId, slotName, new Float32Array([r, g, b, a]));
    }

    getParticleFloat(particleId: ParticleId, slotName: string): number | undefined {
        const data = this.getParticleData(particleId, slotName);
        return typeof data === 'number' ? data : undefined;
    }

    getParticleVector(particleId: ParticleId, slotName: string): Float32Array | undefined {
        const data = this.getParticleData(particleId, slotName);
        return data instanceof Float32Array ? data : undefined;
    }
}
