import { Component } from '../../component-system/core/component';
import { script } from '../../component-system/decorators/script';
import type { SceneUniformValue } from '../types';

export interface MeshRendererConfig {
    readonly meshId?: string;
    readonly materialId?: string;
    readonly visible?: boolean;
    readonly renderOrder?: number;
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
    private readonly _uniformOverrides = new Map<string, SceneUniformValue>();

    constructor(config: MeshRendererConfig = {}) {
        super();
        this._meshId = config.meshId ?? null;
        this._materialId = config.materialId ?? null;
        this._visible = config.visible ?? true;
        this._renderOrder = config.renderOrder ?? 0;
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
}