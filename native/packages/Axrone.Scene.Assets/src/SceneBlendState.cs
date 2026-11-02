namespace Axrone.Scene.Assets;

/// <summary>Blend factor applied by a material pass.</summary>
public enum SceneBlendFactor : byte
{
    /// <summary>Zero.</summary>
    Zero = 0,

    /// <summary>One.</summary>
    One = 1,

    /// <summary>Source color.</summary>
    SourceColor = 2,

    /// <summary>One minus source color.</summary>
    OneMinusSourceColor = 3,

    /// <summary>Destination color.</summary>
    DestinationColor = 4,

    /// <summary>One minus destination color.</summary>
    OneMinusDestinationColor = 5,

    /// <summary>Source alpha.</summary>
    SourceAlpha = 6,

    /// <summary>One minus source alpha.</summary>
    OneMinusSourceAlpha = 7,

    /// <summary>Constant blend color.</summary>
    ConstantColor = 8,

    /// <summary>One minus constant blend color.</summary>
    OneMinusConstantColor = 9,

    /// <summary>Source alpha saturation.</summary>
    SourceAlphaSaturate = 10
}

/// <summary>Blend equation applied by a material pass.</summary>
public enum SceneBlendOperation : byte
{
    /// <summary>Source plus destination.</summary>
    Add = 0,

    /// <summary>Source minus destination.</summary>
    Subtract = 1,

    /// <summary>Destination minus source.</summary>
    ReverseSubtract = 2,

    /// <summary>Component-wise minimum.</summary>
    Min = 3,

    /// <summary>Component-wise maximum.</summary>
    Max = 4
}

/// <summary>
/// Explicit blend state metadata. <see cref="Enabled"/> false leaves blending disabled;
/// otherwise the factors and equations describe the fixed-function blend.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneBlendState(
    bool Enabled,
    SceneBlendFactor SourceColor,
    SceneBlendFactor DestinationColor,
    SceneBlendOperation ColorOperation,
    SceneBlendFactor SourceAlpha,
    SceneBlendFactor DestinationAlpha,
    SceneBlendOperation AlphaOperation)
{
    /// <summary>Blending disabled.</summary>
    public static SceneBlendState Disabled => new(
        false,
        SceneBlendFactor.One,
        SceneBlendFactor.Zero,
        SceneBlendOperation.Add,
        SceneBlendFactor.One,
        SceneBlendFactor.Zero,
        SceneBlendOperation.Add);

    /// <summary>Straight alpha blending.</summary>
    public static SceneBlendState Alpha => new(
        true,
        SceneBlendFactor.SourceAlpha,
        SceneBlendFactor.OneMinusSourceAlpha,
        SceneBlendOperation.Add,
        SceneBlendFactor.One,
        SceneBlendFactor.OneMinusSourceAlpha,
        SceneBlendOperation.Add);

    /// <summary>Additive blending.</summary>
    public static SceneBlendState Additive => new(
        true,
        SceneBlendFactor.One,
        SceneBlendFactor.One,
        SceneBlendOperation.Add,
        SceneBlendFactor.One,
        SceneBlendFactor.One,
        SceneBlendOperation.Add);

    internal void Validate()
    {
        if (!Enum.IsDefined(SourceColor) || !Enum.IsDefined(DestinationColor) ||
            !Enum.IsDefined(SourceAlpha) || !Enum.IsDefined(DestinationAlpha) ||
            !Enum.IsDefined(ColorOperation) || !Enum.IsDefined(AlphaOperation))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Blend state factors and operations must be defined values.");
        }
    }
}
