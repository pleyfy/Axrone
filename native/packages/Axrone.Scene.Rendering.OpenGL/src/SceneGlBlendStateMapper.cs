namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>Resolved fixed-function blend state for one draw.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneGlBlendMapping(
    bool Enabled,
    uint SourceColor,
    uint DestinationColor,
    uint SourceAlpha,
    uint DestinationAlpha,
    uint ColorEquation,
    uint AlphaEquation);

/// <summary>
/// Resolves material, pass and queue transparency into a fixed-function blend
/// mapping. An explicit <see cref="SceneMaterialPass.BlendState"/> wins over the
/// legacy <see cref="SceneMaterialPass.Blend"/> boolean, which keeps additive,
/// min and max materials distinguishable from alpha blending.
/// </summary>
public static class SceneGlBlendStateMapper
{
    private const uint SourceColor = 0x0300;
    private const uint OneMinusSourceColor = 0x0301;
    private const uint DestinationColor = 0x0306;
    private const uint OneMinusDestinationColor = 0x0307;
    private const uint SourceAlpha = 0x0302;
    private const uint OneMinusSourceAlpha = 0x0303;
    private const uint ConstantColor = 0x8001;
    private const uint OneMinusConstantColor = 0x8002;
    private const uint SourceAlphaSaturate = 0x0308;

    private const uint EquationAdd = 0x8006;
    private const uint EquationSubtract = 0x800A;
    private const uint EquationReverseSubtract = 0x800B;
    private const uint EquationMin = 0x8007;
    private const uint EquationMax = 0x8008;

    /// <summary>Resolves the blend mapping for one material draw.</summary>
    public static SceneGlBlendMapping Resolve(
        SceneGlMaterial material,
        SceneRenderPassDefinition pass,
        bool transparent)
    {
        ArgumentNullException.ThrowIfNull(material);
        ArgumentNullException.ThrowIfNull(pass);

        SceneMaterialPass? materialPass = material.PrimaryPass;
        SceneBlendState? explicitState = materialPass?.BlendState;
        bool enabled = explicitState?.Enabled ??
            materialPass?.Blend ??
            pass.Blend ??
            (transparent || material.Surface.AlphaMode == SceneMaterialAlphaMode.Blend);

        if (!enabled)
        {
            return new SceneGlBlendMapping(
                false,
                GLConst.One,
                GLConst.Zero,
                GLConst.One,
                GLConst.Zero,
                EquationAdd,
                EquationAdd);
        }

        if (explicitState is { } state)
        {
            return new SceneGlBlendMapping(
                true,
                MapFactor(state.SourceColor),
                MapFactor(state.DestinationColor),
                MapFactor(state.SourceAlpha),
                MapFactor(state.DestinationAlpha),
                MapOperation(state.ColorOperation),
                MapOperation(state.AlphaOperation));
        }

        return new SceneGlBlendMapping(
            true,
            GLConst.SrcAlpha,
            GLConst.OneMinusSrcAlpha,
            GLConst.One,
            GLConst.OneMinusSrcAlpha,
            EquationAdd,
            EquationAdd);
    }

    private static uint MapFactor(SceneBlendFactor factor) => factor switch
    {
        SceneBlendFactor.Zero => 0,
        SceneBlendFactor.One => 1,
        SceneBlendFactor.SourceColor => SourceColor,
        SceneBlendFactor.OneMinusSourceColor => OneMinusSourceColor,
        SceneBlendFactor.DestinationColor => DestinationColor,
        SceneBlendFactor.OneMinusDestinationColor => OneMinusDestinationColor,
        SceneBlendFactor.SourceAlpha => SourceAlpha,
        SceneBlendFactor.OneMinusSourceAlpha => OneMinusSourceAlpha,
        SceneBlendFactor.ConstantColor => ConstantColor,
        SceneBlendFactor.OneMinusConstantColor => OneMinusConstantColor,
        SceneBlendFactor.SourceAlphaSaturate => SourceAlphaSaturate,
        _ => 1
    };

    private static uint MapOperation(SceneBlendOperation operation) => operation switch
    {
        SceneBlendOperation.Add => EquationAdd,
        SceneBlendOperation.Subtract => EquationSubtract,
        SceneBlendOperation.ReverseSubtract => EquationReverseSubtract,
        SceneBlendOperation.Min => EquationMin,
        SceneBlendOperation.Max => EquationMax,
        _ => EquationAdd
    };
}
