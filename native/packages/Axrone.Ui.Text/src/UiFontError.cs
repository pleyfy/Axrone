namespace Axrone.Ui.Text;

/// <summary>Failure classification for font parsing, lookup and rasterization.</summary>
public enum UiFontErrorCode
{
    /// <summary>No failure.</summary>
    None,

    /// <summary>The sfnt container header is malformed.</summary>
    MalformedContainer,

    /// <summary>The sfnt version tag is not supported.</summary>
    UnsupportedSfntVersion,

    /// <summary>The payload ends before a required field.</summary>
    Truncated,

    /// <summary>A required table is absent.</summary>
    MissingTable,

    /// <summary>A table range falls outside the font buffer.</summary>
    InvalidTableRange,

    /// <summary>The head table is invalid.</summary>
    InvalidHead,

    /// <summary>The maxp table is invalid.</summary>
    InvalidMaxp,

    /// <summary>The hhea table is invalid.</summary>
    InvalidHhea,

    /// <summary>The hmtx table is invalid.</summary>
    InvalidHmtx,

    /// <summary>The cmap table is invalid or unsupported.</summary>
    InvalidCmap,

    /// <summary>The kern table is invalid.</summary>
    InvalidKern,

    /// <summary>The loca table is invalid.</summary>
    InvalidLoca,

    /// <summary>The glyf table or a glyph record is invalid.</summary>
    InvalidGlyph,

    /// <summary>The outline format (for example CFF) is not supported by the consumer.</summary>
    UnsupportedOutlineFormat,

    /// <summary>The glyph uses a feature this implementation does not support.</summary>
    UnsupportedGlyph,

    /// <summary>An implementation resource limit was exceeded.</summary>
    ResourceLimit,

    /// <summary>A face with the same family, weight and style is already registered.</summary>
    DuplicateFace,

    /// <summary>The face descriptor is invalid.</summary>
    InvalidDescriptor,

    /// <summary>The face identity is not registered.</summary>
    FaceNotFound,

    /// <summary>The code point has no glyph in the resolved face or fallbacks.</summary>
    GlyphNotFound,

    /// <summary>The requested pixel size is not finite or positive.</summary>
    InvalidPixelSize,

    /// <summary>The requested raster size exceeds the implementation limit.</summary>
    RasterTooLarge,

    /// <summary>The outline exceeds the point or edge limit.</summary>
    OutlineTooComplex,
}

/// <summary>Font failure with an optional byte offset into the font buffer.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontError(UiFontErrorCode Code, int Offset, string Message)
{
    /// <summary>Gets the success sentinel.</summary>
    public static UiFontError None => new(UiFontErrorCode.None, -1, string.Empty);

    /// <summary>Gets whether this value describes a failure.</summary>
    public bool HasError => Code != UiFontErrorCode.None;

    internal static UiFontError At(UiFontErrorCode code, int offset, string message) => new(code, offset, message);
}
