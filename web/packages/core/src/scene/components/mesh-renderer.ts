import { Mat4 } from '@axrone/numeric';
import { Transform } from '../../component-system/components/transform';
import { Component } from '../../component-system/core/component';
import { script } from '../../component-system/decorators/script';
import type { SceneUniformValue } from '../types';
import { PrefabNodeBinding } from './prefab-node-binding';

export interface MeshRendererSkinConfig {
    readonly jointNodeIds: readonly string[];
    readonly skeletonNodeId?: string;
    readonly inverseBindMatrices?: readonly number[] | Float32Array;
}

export interface MeshRendererMorphConfig {
    readonly weights?: readonly number[] | Float32Array;
}

interface MeshRendererSkinState {
    readonly jointNodeIds: readonly string[];
    readonly skeletonNodeId?: string;
    readonly inverseBindMatrices?: Float32Array;
}

interface MeshRendererMorphState {
    readonly weights: Float32Array;
}

export interface MeshRendererConfig {
    readonly meshId?: string;
    readonly materialId?: string;
    readonly visible?: boolean;
    readonly renderOrder?: number;
    readonly passId?: string;
    readonly receiveLighting?: boolean;
    readonly morph?: MeshRendererMorphConfig | null;
    readonly skin?: MeshRendererSkinConfig | null;
}

const toFloat32Array = (value: readonly number[] | Float32Array | undefined): Float32Array | undefined => {
    if (!value) {
        return undefined;
    }

    return value instanceof Float32Array ? new Float32Array(value) : new Float32Array(value);
};

const normalizeSkin = (value: MeshRendererSkinConfig | null | undefined): MeshRendererSkinState | null => {
    if (!value || !Array.isArray(value.jointNodeIds) || value.jointNodeIds.length === 0) {
        return null;
    }

    const inverseBindMatrices = toFloat32Array(value.inverseBindMatrices);
    if (
        inverseBindMatrices &&
        inverseBindMatrices.length !== value.jointNodeIds.length * 16
    ) {
        throw new Error('Skin inverse bind matrices must contain 16 values per joint');
    }

    return Object.freeze({
        jointNodeIds: Object.freeze(value.jointNodeIds.filter((entry): entry is string => typeof entry === 'string')),
        ...(typeof value.skeletonNodeId === 'string' ? { skeletonNodeId: value.skeletonNodeId } : {}),
        ...(inverseBindMatrices ? { inverseBindMatrices } : {}),
    });
};

const normalizeMorph = (
    value: MeshRendererMorphConfig | null | undefined
): MeshRendererMorphState | null => {
    const weights = toFloat32Array(value?.weights);
    if (!weights || weights.length === 0) {
        return null;
    }

    return Object.freeze({
        weights,
    });
};

const areEqualWeights = (
    left: Float32Array | undefined,
    right: Float32Array | undefined
): boolean => {
    if (left === right) {
        return true;
    }

    if (!left || !right || left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
};

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
    private _morph: MeshRendererMorphState | null;
    private _morphVersion = 0;
    private _skin: MeshRendererSkinState | null;
    private _resolvedSkinInstanceId: string | null = null;
    private _resolvedJointTransforms: readonly (Transform | null)[] | null = null;

    constructor(config: MeshRendererConfig = {}) {
        super();
        this._meshId = config.meshId ?? null;
        this._materialId = config.materialId ?? null;
        this._visible = config.visible ?? true;
        this._renderOrder = config.renderOrder ?? 0;
        this._passId = config.passId ?? 'main';
        this._receiveLighting = config.receiveLighting ?? true;
        this._morph = normalizeMorph(config.morph);
        this._skin = normalizeSkin(config.skin);
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

    get morph(): MeshRendererMorphConfig | null {
        return this._morph
            ? {
                  weights: new Float32Array(this._morph.weights),
              }
            : null;
    }

    set morph(value: MeshRendererMorphConfig | null) {
        const normalized = normalizeMorph(value);
        if (areEqualWeights(this._morph?.weights, normalized?.weights)) {
            return;
        }

        this._morph = normalized;
        this._morphVersion += 1;
    }

    get morphWeights(): Float32Array | null {
        return this._morph ? new Float32Array(this._morph.weights) : null;
    }

    set morphWeights(value: readonly number[] | Float32Array | null) {
        this.morph = value ? { weights: value } : null;
    }

    get morphWeightCount(): number {
        return this._morph?.weights.length ?? 0;
    }

    get morphWeightVersion(): number {
        return this._morphVersion;
    }

    get hasMorphWeights(): boolean {
        return (this._morph?.weights.length ?? 0) > 0;
    }

    getMorphWeightArray(): Float32Array | null {
        return this._morph?.weights ?? null;
    }

    setMorphWeights(value: readonly number[] | Float32Array | null): this {
        this.morphWeights = value;
        return this;
    }

    get skin(): MeshRendererSkinConfig | null {
        return this._skin;
    }

    set skin(value: MeshRendererSkinConfig | null) {
        this._skin = normalizeSkin(value);
        this._resolvedSkinInstanceId = null;
        this._resolvedJointTransforms = null;
    }

    get hasSkin(): boolean {
        return this._skin !== null;
    }

    get skinJointCount(): number {
        return this._skin?.jointNodeIds.length ?? 0;
    }

    getSkinJointMatrixPalette(): Float32Array | null {
        if (!this._skin) {
            return null;
        }

        const meshTransform = this.transform as Transform | undefined;
        if (!meshTransform) {
            return null;
        }

        const jointTransforms = this._resolveJointTransforms();
        if (!jointTransforms) {
            return null;
        }

        const meshInverse = Mat4.invert(meshTransform.worldMatrix);
        const palette = new Float32Array(jointTransforms.length * 16);

        for (let jointIndex = 0; jointIndex < jointTransforms.length; jointIndex += 1) {
            const jointTransform = jointTransforms[jointIndex]!;
            let jointMatrix = Mat4.multiply(meshInverse, jointTransform.worldMatrix);

            if (this._skin.inverseBindMatrices) {
                jointMatrix = Mat4.multiply(
                    jointMatrix,
                    Mat4.fromArray(this._skin.inverseBindMatrices, jointIndex * 16)
                );
            }

            palette.set(jointMatrix.data, jointIndex * 16);
        }

        return palette;
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
            morph: this._morph
                ? {
                      weights: this._morph.weights,
                  }
                : null,
            skin: this._skin
                ? {
                      jointNodeIds: [...this._skin.jointNodeIds],
                      ...(this._skin.skeletonNodeId
                          ? { skeletonNodeId: this._skin.skeletonNodeId }
                          : {}),
                      ...(this._skin.inverseBindMatrices
                          ? { inverseBindMatrices: this._skin.inverseBindMatrices }
                          : {}),
                  }
                : null,
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

        if (data.morph === null) {
            this.morph = null;
        } else if (typeof data.morph === 'object' && data.morph !== null && Array.isArray(data.morph) === false) {
            this.morph = {
                ...(data.morph.weights instanceof Float32Array
                    ? { weights: data.morph.weights }
                    : Array.isArray(data.morph.weights)
                      ? { weights: data.morph.weights.map((entry: unknown) => Number(entry)) }
                      : {}),
            };
        }

        if (data.skin === null) {
            this.skin = null;
        } else if (typeof data.skin === 'object' && data.skin !== null && Array.isArray(data.skin) === false) {
            this.skin = {
                jointNodeIds: Array.isArray(data.skin.jointNodeIds)
                    ? data.skin.jointNodeIds.filter((entry: unknown): entry is string => typeof entry === 'string')
                    : [],
                ...(typeof data.skin.skeletonNodeId === 'string'
                    ? { skeletonNodeId: data.skin.skeletonNodeId }
                    : {}),
                ...(data.skin.inverseBindMatrices instanceof Float32Array
                    ? { inverseBindMatrices: data.skin.inverseBindMatrices }
                    : Array.isArray(data.skin.inverseBindMatrices)
                      ? { inverseBindMatrices: new Float32Array(data.skin.inverseBindMatrices.map((entry: unknown) => Number(entry))) }
                      : {}),
            };
        }

        this._uniformOverrides.clear();
        if (typeof data.uniformOverrides === 'object' && data.uniformOverrides !== null) {
            for (const [name, value] of Object.entries(data.uniformOverrides)) {
                this._uniformOverrides.set(name, value as SceneUniformValue);
            }
        }
    }

    private _resolveJointTransforms(): readonly Transform[] | null {
        if (!this._skin) {
            return null;
        }

        const instanceId = this.actor?.getComponent(PrefabNodeBinding)?.instanceId ?? null;
        if (
            this._resolvedJointTransforms &&
            this._resolvedSkinInstanceId === instanceId &&
            this._resolvedJointTransforms.length === this._skin.jointNodeIds.length &&
            this._resolvedJointTransforms.every((entry) => entry !== null)
        ) {
            return this._resolvedJointTransforms as readonly Transform[];
        }

        const actors = (this.world as { getAllActors?: () => readonly { getComponent: (type: any) => any }[] } | undefined)?.getAllActors?.() ?? [];
        const transformsByNodeId = new Map<string, Transform>();

        for (const actor of actors) {
            const binding = actor.getComponent(PrefabNodeBinding) as PrefabNodeBinding | undefined;
            if (!binding || binding.nodeId === null) {
                continue;
            }
            if (instanceId && binding.instanceId !== instanceId) {
                continue;
            }

            const transform = actor.getComponent(Transform) as Transform | undefined;
            if (transform) {
                transformsByNodeId.set(binding.nodeId, transform);
            }
        }

        this._resolvedSkinInstanceId = instanceId;
        this._resolvedJointTransforms = this._skin.jointNodeIds.map(
            (nodeId) => transformsByNodeId.get(nodeId) ?? null
        );

        if (this._resolvedJointTransforms.some((entry) => entry === null)) {
            return null;
        }

        return this._resolvedJointTransforms as readonly Transform[];
    }
}
