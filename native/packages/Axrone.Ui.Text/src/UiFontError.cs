namespace Axrone.Ui.Text;

public enum UiFontErrorCode
{
    None,

    MalformedContainer,

    UnsupportedSfntVersion,

    Truncated,

    MissingTable,

    InvalidTableRange,

    ChecksumMismatch,

    InvalidHead,

    InvalidMaxp,

    InvalidHhea,

    InvalidHmtx,

    InvalidCmap,

    InvalidKern,

    InvalidLoca,

    InvalidGlyph,

    InvalidCff,

    InvalidLayout,

    InvalidVariation,

    InvalidColor,

    InvalidHinting,

    UnsupportedOutlineFormat,

    UnsupportedGlyph,

    ResourceLimit,

    DuplicateFace,

    InvalidDescriptor,

    FaceNotFound,

    GlyphNotFound,

    InvalidPixelSize,

    RasterTooLarge,

    OutlineTooComplex,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontError(UiFontErrorCode Code, int Offset, string Message)
{
    public static UiFontError None => new(UiFontErrorCode.None, -1, string.Empty);

    public bool HasError => Code != UiFontErrorCode.None;

    internal static UiFontError At(UiFontErrorCode code, int offset, string message) => new(code, offset, message);
}
