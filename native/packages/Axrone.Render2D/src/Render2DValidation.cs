namespace Axrone.Render2D;

using System.Diagnostics.CodeAnalysis;

/// <summary>Typed validation failures returned by the batch builder.</summary>
public enum Render2DValidationErrorCode : byte
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>World matrix contains a non-finite value.</summary>
    WorldMatrixNotFinite = 1,

    /// <summary>Sprite size is not finite.</summary>
    SizeNotFinite = 2,

    /// <summary>Anchor is not finite.</summary>
    AnchorNotFinite = 3,

    /// <summary>UV rectangle is not finite.</summary>
    UvNotFinite = 4,

    /// <summary>Color is not finite.</summary>
    ColorNotFinite = 5,

    /// <summary>Clip rectangle is not finite.</summary>
    ClipNotFinite = 6,

    /// <summary>Slice source size is not positive.</summary>
    SliceSourceInvalid = 7,

    /// <summary>Slice border is negative.</summary>
    SliceBorderNegative = 8,

    /// <summary>Slice borders exceed the source size.</summary>
    SliceBorderTooLarge = 9,

    /// <summary>Mask size is not positive.</summary>
    MaskSizeInvalid = 10,

    /// <summary>Mask state is not finite.</summary>
    MaskNotFinite = 11,

    /// <summary>One submission needs more quads than MaxBatchQuads.</summary>
    SubmissionExceedsBatchQuads = 12,

    /// <summary>Total vertex count exceeds UInt32 draw capacity.</summary>
    VertexCapacityExceeded = 13,
}

/// <summary>Validation failure raised by the throwing build path.</summary>
public sealed class Render2DValidationException : Exception
{
    /// <summary>Creates an empty validation exception.</summary>
    public Render2DValidationException()
        : base("Sprite submission is invalid.")
    {
    }

    /// <summary>Creates a validation exception with a message.</summary>
    public Render2DValidationException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a validation exception with a message and inner failure.</summary>
    public Render2DValidationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Creates a typed validation exception.</summary>
    public Render2DValidationException(Render2DValidationErrorCode code)
        : base(MessageFor(code))
    {
        Code = code;
    }

    /// <summary>Gets the typed failure code.</summary>
    public Render2DValidationErrorCode Code { get; }

    private static string MessageFor(Render2DValidationErrorCode code) => code switch
    {
        Render2DValidationErrorCode.WorldMatrixNotFinite => "Sprite world matrix must be finite.",
        Render2DValidationErrorCode.SizeNotFinite => "Sprite size must be finite.",
        Render2DValidationErrorCode.AnchorNotFinite => "Sprite anchor must be finite.",
        Render2DValidationErrorCode.UvNotFinite => "Sprite UV rectangle must be finite.",
        Render2DValidationErrorCode.ColorNotFinite => "Sprite color must be finite.",
        Render2DValidationErrorCode.ClipNotFinite => "Sprite clip rectangle must be finite.",
        Render2DValidationErrorCode.SliceSourceInvalid => "Sprite slice source size must be positive.",
        Render2DValidationErrorCode.SliceBorderNegative => "Sprite slice borders must not be negative.",
        Render2DValidationErrorCode.SliceBorderTooLarge => "Sprite slice borders must fit inside the source size.",
        Render2DValidationErrorCode.MaskSizeInvalid => "Sprite mask size must be positive.",
        Render2DValidationErrorCode.MaskNotFinite => "Sprite mask state must be finite.",
        Render2DValidationErrorCode.SubmissionExceedsBatchQuads => "A sprite submission exceeds the configured MaxBatchQuads limit.",
        Render2DValidationErrorCode.VertexCapacityExceeded => "Sprite vertex count exceeds UInt32 draw capacity.",
        _ => "Sprite submission is invalid.",
    };
}

internal static class Render2DThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowValidation(Render2DValidationErrorCode code) =>
        throw new Render2DValidationException(code);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgument(string parameter, string message) =>
        throw new ArgumentException(message, parameter);
}
