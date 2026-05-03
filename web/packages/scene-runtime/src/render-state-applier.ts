import type {
    SceneMaterialBlendFactor,
    SceneMaterialBlendOperation,
    SceneMaterialBlendTargetStateDefinition,
    SceneMaterialCompareFunction,
    SceneMaterialCullMode,
    SceneMaterialFrontFace,
    SceneMaterialPassDefinition,
    SceneMaterialPassPrimitive,
    SceneMaterialStencilFaceStateDefinition,
    SceneMaterialStencilOperation,
} from './types';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneShaderResource } from './shader-registry';

interface SceneResolvedStencilState {
    readonly enabled: boolean;
    readonly func: number;
    readonly ref: number;
    readonly readMask: number;
    readonly writeMask: number;
    readonly failOp: number;
    readonly zFailOp: number;
    readonly passOp: number;
}

const DEFAULT_STENCIL_MASK = 0xff;
const DEFAULT_BLEND_COLOR = Object.freeze([0, 0, 0, 0] as const);
const DEFAULT_COLOR_WRITE_MASK = Object.freeze([true, true, true, true] as const);

const isTupleEqual = (
    left: readonly number[] | null,
    right: readonly number[]
): boolean => {
    if (!left || left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < right.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
};

const isBooleanTupleEqual = (
    left: readonly boolean[] | null,
    right: readonly boolean[]
): boolean => {
    if (!left || left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < right.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }

    return true;
};

export class SceneRenderStateApplier {
    private _depthTest: boolean | null = null;
    private _depthMask: boolean | null = null;
    private _depthFunc: number | null = null;
    private _cullEnabled: boolean | null = null;
    private _cullFace: number | null = null;
    private _frontFace: number | null = null;
    private _blend: boolean | null = null;
    private _blendEquation: readonly number[] | null = null;
    private _blendFunc: readonly number[] | null = null;
    private _blendColor: readonly number[] | null = null;
    private _colorMask: readonly boolean[] | null = null;
    private _stencilTest: boolean | null = null;
    private _frontStencilState: SceneResolvedStencilState | null = null;
    private _backStencilState: SceneResolvedStencilState | null = null;
    private _alphaToCoverage: boolean | null = null;
    private _rasterizerDiscard: boolean | null = null;
    private _polygonOffsetEnabled: boolean | null = null;
    private _polygonOffset: readonly number[] | null = null;
    private _lineWidth: number | null = null;

    constructor(private readonly _gl: WebGL2RenderingContext) {}

    resolvePrimitiveTopology(primitive: SceneMaterialPassPrimitive): 'triangles' | 'lines' | 'points' {
        switch (primitive) {
            case 'line-list':
                return 'lines';
            case 'point-list':
                return 'points';
            default:
                return 'triangles';
        }
    }

    resolvePrimitiveMode(
        fallbackMode: number,
        materialPass: SceneMaterialPassDefinition | null | undefined
    ): number {
        switch (materialPass?.primitive) {
            case 'line-list':
                return this._gl.LINES;
            case 'point-list':
                return this._gl.POINTS;
            case 'triangle-list':
                return this._gl.TRIANGLES;
            default:
                return fallbackMode;
        }
    }

    resolveBlendEnabled(
        shader: SceneShaderResource,
        renderPass: SceneRenderPassResource,
        materialPass: SceneMaterialPassDefinition | null | undefined
    ): boolean {
        const blendTarget = materialPass?.blendState?.targets?.[0];
        return blendTarget?.blend ?? renderPass.blend ?? shader.blend;
    }

    apply(
        shader: SceneShaderResource,
        renderPass: SceneRenderPassResource,
        materialPass: SceneMaterialPassDefinition | null | undefined = null
    ): void {
        const depthState = materialPass?.depthStencilState;
        const rasterizerState = materialPass?.rasterizerState;
        const blendState = materialPass?.blendState;
        const blendTarget = blendState?.targets?.[0];

        const depthTest = depthState?.depthTest ?? renderPass.depthTest ?? shader.depthTest;
        const depthWrite = depthState?.depthWrite ?? true;
        const depthFunc = this._mapCompareFunction(depthState?.depthFunc ?? 'less') ?? this._gl.LESS;
        const cullMode = this._resolveCullMode(shader, renderPass, rasterizerState?.cullMode);
        const frontFace = this._mapFrontFace(rasterizerState?.frontFace ?? 'ccw');
        const blend = this.resolveBlendEnabled(shader, renderPass, materialPass);
        const blendColor = blendState?.blendColor ?? DEFAULT_BLEND_COLOR;
        const colorWriteMask = blendTarget?.colorWriteMask ?? DEFAULT_COLOR_WRITE_MASK;
        const frontStencil = this._resolveFrontStencilState(renderPass, depthState?.front);
        const backStencil = this._resolveBackStencilState(renderPass, depthState?.back);
        const stencilEnabled = frontStencil.enabled || backStencil.enabled;
        const alphaToCoverage = blendState?.alphaToCoverage ?? false;
        const rasterizerDiscard = rasterizerState?.discard ?? false;
        const polygonOffsetFactor =
            rasterizerState?.depthBiasSlopeScale ?? rasterizerState?.depthBias ?? 0;
        const polygonOffsetUnits = rasterizerState?.depthBias ?? 0;
        const polygonOffsetEnabled = polygonOffsetFactor !== 0 || polygonOffsetUnits !== 0;
        const lineWidth = rasterizerState?.lineWidth ?? 1;

        this._applyCapability(this._gl.DEPTH_TEST, depthTest, '_depthTest');

        if (this._depthMask !== depthWrite) {
            this._gl.depthMask?.(depthWrite);
            this._depthMask = depthWrite;
        }

        if (this._depthFunc !== depthFunc) {
            this._gl.depthFunc?.(depthFunc);
            this._depthFunc = depthFunc;
        }

        if (cullMode === this._gl.NONE) {
            this._applyCapability(this._gl.CULL_FACE, false, '_cullEnabled');
            this._cullFace = null;
        } else {
            this._applyCapability(this._gl.CULL_FACE, true, '_cullEnabled');
            if (this._cullFace !== cullMode) {
                this._gl.cullFace?.(cullMode);
                this._cullFace = cullMode;
            }
        }

        if (this._frontFace !== frontFace) {
            this._gl.frontFace?.(frontFace);
            this._frontFace = frontFace;
        }

        this._applyCapability(this._gl.BLEND, blend, '_blend');
        if (blend) {
            const blendEquation = [
                this._mapBlendOperation(blendTarget?.colorOp ?? 'add'),
                this._mapBlendOperation(blendTarget?.alphaOp ?? 'add'),
            ] as const;
            if (!isTupleEqual(this._blendEquation, blendEquation)) {
                this._gl.blendEquationSeparate?.(blendEquation[0], blendEquation[1]);
                this._blendEquation = blendEquation;
            }

            const blendFunc = [
                this._mapBlendFactor(blendTarget?.srcColorFactor ?? 'src-alpha'),
                this._mapBlendFactor(blendTarget?.dstColorFactor ?? 'one-minus-src-alpha'),
                this._mapBlendFactor(blendTarget?.srcAlphaFactor ?? 'one'),
                this._mapBlendFactor(blendTarget?.dstAlphaFactor ?? 'one-minus-src-alpha'),
            ] as const;
            if (!isTupleEqual(this._blendFunc, blendFunc)) {
                this._gl.blendFuncSeparate?.(
                    blendFunc[0],
                    blendFunc[1],
                    blendFunc[2],
                    blendFunc[3]
                );
                this._blendFunc = blendFunc;
            }

            if (!isTupleEqual(this._blendColor, blendColor)) {
                this._gl.blendColor?.(
                    blendColor[0],
                    blendColor[1],
                    blendColor[2],
                    blendColor[3]
                );
                this._blendColor = [...blendColor];
            }
        } else {
            this._blendEquation = null;
            this._blendFunc = null;
            this._blendColor = null;
        }

        if (!isBooleanTupleEqual(this._colorMask, colorWriteMask)) {
            this._gl.colorMask?.(
                colorWriteMask[0],
                colorWriteMask[1],
                colorWriteMask[2],
                colorWriteMask[3]
            );
            this._colorMask = [...colorWriteMask];
        }

        this._applyCapability(this._gl.STENCIL_TEST, stencilEnabled, '_stencilTest');
        if (stencilEnabled) {
            this._applyStencilFaceState(this._gl.FRONT, frontStencil, '_frontStencilState');
            this._applyStencilFaceState(this._gl.BACK, backStencil, '_backStencilState');
        } else {
            this._frontStencilState = null;
            this._backStencilState = null;
        }

        if ('SAMPLE_ALPHA_TO_COVERAGE' in this._gl) {
            this._applyCapability(
                (this._gl as WebGL2RenderingContext & { SAMPLE_ALPHA_TO_COVERAGE: number })
                    .SAMPLE_ALPHA_TO_COVERAGE,
                alphaToCoverage,
                '_alphaToCoverage'
            );
        }

        if ('RASTERIZER_DISCARD' in this._gl) {
            this._applyCapability(
                (this._gl as WebGL2RenderingContext & { RASTERIZER_DISCARD: number })
                    .RASTERIZER_DISCARD,
                rasterizerDiscard,
                '_rasterizerDiscard'
            );
        }

        if ('POLYGON_OFFSET_FILL' in this._gl) {
            this._applyCapability(
                (this._gl as WebGL2RenderingContext & { POLYGON_OFFSET_FILL: number })
                    .POLYGON_OFFSET_FILL,
                polygonOffsetEnabled,
                '_polygonOffsetEnabled'
            );
        }

        const polygonOffset = [polygonOffsetFactor, polygonOffsetUnits] as const;
        if (polygonOffsetEnabled && !isTupleEqual(this._polygonOffset, polygonOffset)) {
            this._gl.polygonOffset?.(polygonOffsetFactor, polygonOffsetUnits);
            this._polygonOffset = polygonOffset;
        } else if (!polygonOffsetEnabled) {
            this._polygonOffset = null;
        }

        if (this._lineWidth !== lineWidth) {
            this._gl.lineWidth?.(lineWidth);
            this._lineWidth = lineWidth;
        }
    }

    reset(): void {
        this._depthTest = null;
        this._depthMask = null;
        this._depthFunc = null;
        this._cullEnabled = null;
        this._cullFace = null;
        this._frontFace = null;
        this._blend = null;
        this._blendEquation = null;
        this._blendFunc = null;
        this._blendColor = null;
        this._colorMask = null;
        this._stencilTest = null;
        this._frontStencilState = null;
        this._backStencilState = null;
        this._alphaToCoverage = null;
        this._rasterizerDiscard = null;
        this._polygonOffsetEnabled = null;
        this._polygonOffset = null;
        this._lineWidth = null;
    }

    private _applyCapability(
        capability: number,
        enabled: boolean,
        key:
            | '_depthTest'
            | '_cullEnabled'
            | '_blend'
            | '_stencilTest'
            | '_alphaToCoverage'
            | '_rasterizerDiscard'
            | '_polygonOffsetEnabled'
    ): void {
        if (this[key] === enabled) {
            return;
        }

        if (enabled) {
            this._gl.enable?.(capability);
        } else {
            this._gl.disable?.(capability);
        }
        this[key] = enabled as never;
    }

    private _resolveCullMode(
        shader: SceneShaderResource,
        renderPass: SceneRenderPassResource,
        materialCullMode: SceneMaterialCullMode | undefined
    ): number {
        if (materialCullMode) {
            return this._mapCullMode(materialCullMode);
        }

        const cullEnabled = renderPass.cull ?? shader.cull;
        return cullEnabled ? this._gl.BACK : this._gl.NONE;
    }

    private _resolveFrontStencilState(
        renderPass: SceneRenderPassResource,
        face: SceneMaterialStencilFaceStateDefinition | undefined
    ): SceneResolvedStencilState {
        return {
            enabled: face?.stencilTest ?? renderPass.stencilTest ?? false,
            func: this._mapCompareFunction(face?.stencilFunc) ?? renderPass.stencilFunc ?? this._gl.ALWAYS,
            ref: face?.stencilRef ?? renderPass.stencilRef ?? 0,
            readMask: face?.stencilReadMask ?? renderPass.stencilMask ?? DEFAULT_STENCIL_MASK,
            writeMask: face?.stencilWriteMask ?? renderPass.stencilMask ?? DEFAULT_STENCIL_MASK,
            failOp: this._mapStencilOperation(face?.stencilFailOp) ?? renderPass.stencilFail ?? this._gl.KEEP,
            zFailOp:
                this._mapStencilOperation(face?.stencilZFailOp) ??
                renderPass.stencilZFail ??
                this._gl.KEEP,
            passOp:
                this._mapStencilOperation(face?.stencilPassOp) ??
                renderPass.stencilZPass ??
                this._gl.KEEP,
        };
    }

    private _resolveBackStencilState(
        renderPass: SceneRenderPassResource,
        face: SceneMaterialStencilFaceStateDefinition | undefined
    ): SceneResolvedStencilState {
        return {
            enabled: face?.stencilTest ?? renderPass.stencilTest ?? false,
            func: this._mapCompareFunction(face?.stencilFunc) ?? renderPass.stencilFunc ?? this._gl.ALWAYS,
            ref: face?.stencilRef ?? renderPass.stencilRef ?? 0,
            readMask: face?.stencilReadMask ?? renderPass.stencilMask ?? DEFAULT_STENCIL_MASK,
            writeMask: face?.stencilWriteMask ?? renderPass.stencilMask ?? DEFAULT_STENCIL_MASK,
            failOp: this._mapStencilOperation(face?.stencilFailOp) ?? renderPass.stencilFail ?? this._gl.KEEP,
            zFailOp:
                this._mapStencilOperation(face?.stencilZFailOp) ??
                renderPass.stencilZFail ??
                this._gl.KEEP,
            passOp:
                this._mapStencilOperation(face?.stencilPassOp) ??
                renderPass.stencilZPass ??
                this._gl.KEEP,
        };
    }

    private _applyStencilFaceState(
        face: number,
        state: SceneResolvedStencilState,
        key: '_frontStencilState' | '_backStencilState'
    ): void {
        const current = this[key];
        if (
            current &&
            current.enabled === state.enabled &&
            current.func === state.func &&
            current.ref === state.ref &&
            current.readMask === state.readMask &&
            current.writeMask === state.writeMask &&
            current.failOp === state.failOp &&
            current.zFailOp === state.zFailOp &&
            current.passOp === state.passOp
        ) {
            return;
        }

        this._gl.stencilFuncSeparate?.(face, state.func, state.ref, state.readMask);
        this._gl.stencilMaskSeparate?.(face, state.writeMask);
        this._gl.stencilOpSeparate?.(face, state.failOp, state.zFailOp, state.passOp);
        this[key] = state;
    }

    private _mapCullMode(cullMode: SceneMaterialCullMode): number {
        switch (cullMode) {
            case 'front':
                return this._gl.FRONT;
            case 'none':
                return this._gl.NONE;
            default:
                return this._gl.BACK;
        }
    }

    private _mapFrontFace(frontFace: SceneMaterialFrontFace): number {
        return frontFace === 'cw' ? this._gl.CW : this._gl.CCW;
    }

    private _mapCompareFunction(compareFunction: SceneMaterialCompareFunction | undefined): number | undefined {
        switch (compareFunction) {
            case 'never':
                return this._gl.NEVER;
            case 'less':
                return this._gl.LESS;
            case 'equal':
                return this._gl.EQUAL;
            case 'lequal':
                return this._gl.LEQUAL;
            case 'greater':
                return this._gl.GREATER;
            case 'notequal':
                return this._gl.NOTEQUAL;
            case 'gequal':
                return this._gl.GEQUAL;
            case 'always':
                return this._gl.ALWAYS;
            default:
                return undefined;
        }
    }

    private _mapStencilOperation(operation: SceneMaterialStencilOperation | undefined): number | undefined {
        switch (operation) {
            case 'keep':
                return this._gl.KEEP;
            case 'zero':
                return this._gl.ZERO;
            case 'replace':
                return this._gl.REPLACE;
            case 'invert':
                return this._gl.INVERT;
            case 'incr':
                return this._gl.INCR;
            case 'incr-wrap':
                return this._gl.INCR_WRAP;
            case 'decr':
                return this._gl.DECR;
            case 'decr-wrap':
                return this._gl.DECR_WRAP;
            default:
                return undefined;
        }
    }

    private _mapBlendFactor(factor: SceneMaterialBlendFactor): number {
        switch (factor) {
            case 'zero':
                return this._gl.ZERO;
            case 'one':
                return this._gl.ONE;
            case 'src-color':
                return this._gl.SRC_COLOR;
            case 'one-minus-src-color':
                return this._gl.ONE_MINUS_SRC_COLOR;
            case 'dst-color':
                return this._gl.DST_COLOR;
            case 'one-minus-dst-color':
                return this._gl.ONE_MINUS_DST_COLOR;
            case 'src-alpha':
                return this._gl.SRC_ALPHA;
            case 'one-minus-src-alpha':
                return this._gl.ONE_MINUS_SRC_ALPHA;
            case 'dst-alpha':
                return this._gl.DST_ALPHA;
            case 'one-minus-dst-alpha':
                return this._gl.ONE_MINUS_DST_ALPHA;
            case 'constant-color':
                return this._gl.CONSTANT_COLOR;
            case 'one-minus-constant-color':
                return this._gl.ONE_MINUS_CONSTANT_COLOR;
            case 'constant-alpha':
                return this._gl.CONSTANT_ALPHA;
            case 'one-minus-constant-alpha':
                return this._gl.ONE_MINUS_CONSTANT_ALPHA;
            case 'src-alpha-saturate':
                return this._gl.SRC_ALPHA_SATURATE;
            default:
                return this._gl.ONE;
        }
    }

    private _mapBlendOperation(operation: SceneMaterialBlendOperation): number {
        switch (operation) {
            case 'subtract':
                return this._gl.FUNC_SUBTRACT;
            case 'reverse-subtract':
                return this._gl.FUNC_REVERSE_SUBTRACT;
            case 'min':
                return this._gl.MIN;
            case 'max':
                return this._gl.MAX;
            default:
                return this._gl.FUNC_ADD;
        }
    }
}
