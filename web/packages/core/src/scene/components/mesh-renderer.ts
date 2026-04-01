import { Component } from '../../component-system/core/component';
import { script } from '../../component-system/decorators/script';
import type { SceneUniformValue } from '../types';

export interface MeshRendererConfig {
    readonly meshId?: string;
    readonly materialId?: string;
    readonly visible?: boolean;
    readonly renderOrder?: number;
    readonly passId?: string;
    readonly receiveLighting?: boolean;
}

@script({
    scriptName: 'MeshRenderer',
    priority: 100,
    executeInEditMode: true,
    singleton: false,
})
export class MeshRenderer extends Component {
    private _meshId: string | null;
    private _materialId: string | null;
    private _visible: boolean;
    private _renderOrder: number;
    private _passId: string;
    private _receiveLighting: boolean;
    private readonly _uniformOverrides = new Map<string, SceneUniformValue>();

    constructor(config: MeshRendererConfig = {}) {
        super();
        this._meshId = config.meshId ?? null;
        this._materialId = config.materialId ?? null;
        this._visible = config.visible ?? true;
        this._renderOrder = config.renderOrder ?? 0;
        this._passId = config.passId ?? 'main';
        this._receiveLighting = config.receiveLighting ?? true;
    }

    get meshId(): string | null {
        return this._meshId;
    }

    set meshId(value: string | null) {
        this._meshId = value;
    }

    get materialId(): string | null {
        return this._materialId;
    }

    set materialId(value: string | null) {
        this._materialId = value;
    }

    get visible(): boolean {
        return this._visible;
    }

    set visible(value: boolean) {
        this._visible = value;
    }

    get renderOrder(): number {
        return this._renderOrder;
    }

    set renderOrder(value: number) {
        this._renderOrder = value;
    }

    get passId(): string {
        return this._passId;
    }

    set passId(value: string) {
        this._passId = value;
    }

    get receiveLighting(): boolean {
        return this._receiveLighting;
    }

    set receiveLighting(value: boolean) {
        this._receiveLighting = value;
    }

    setUniform(name: string, value: SceneUniformValue): this {
        this._uniformOverrides.set(name, value);
        return this;
    }

    deleteUniform(name: string): boolean {
        return this._uniformOverrides.delete(name);
    }

    clearUniforms(): void {
        this._uniformOverrides.clear();
    }

    getUniformEntries(): readonly (readonly [string, SceneUniformValue])[] {
        return [...this._uniformOverrides.entries()];
    }

    override serialize(): Record<string, unknown> {
        return {
            meshId: this._meshId,
            materialId: this._materialId,
            visible: this._visible,
            renderOrder: this._renderOrder,
            passId: this._passId,
            receiveLighting: this._receiveLighting,
            uniformOverrides: Object.fromEntries(this._uniformOverrides),
        };
    }

    override deserialize(data: Record<string, any>): void {
        if (typeof data.meshId === 'string' || data.meshId === null) {
            this._meshId = data.meshId;
        }
        if (typeof data.materialId === 'string' || data.materialId === null) {
            this._materialId = data.materialId;
        }
        if (typeof data.visible === 'boolean') {
            this._visible = data.visible;
        }
        if (typeof data.renderOrder === 'number') {
            this._renderOrder = data.renderOrder;
        }
        if (typeof data.passId === 'string') {
            this._passId = data.passId;
        }
        if (typeof data.receiveLighting === 'boolean') {
            this._receiveLighting = data.receiveLighting;
        }

        this._uniformOverrides.clear();
        if (typeof data.uniformOverrides === 'object' && data.uniformOverrides !== null) {
            for (const [name, value] of Object.entries(data.uniformOverrides)) {
                this._uniformOverrides.set(name, value as SceneUniformValue);
            }
        }
    }
}