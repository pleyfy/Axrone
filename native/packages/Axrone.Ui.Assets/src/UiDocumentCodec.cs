namespace Axrone.Ui.Assets;

using System.Buffers;

/// <summary>Failure classification of a document codec operation.</summary>
public enum UiDocumentErrorCode
{
    /// <summary>No failure.</summary>
    None,

    /// <summary>The payload is not a valid document.</summary>
    Malformed,

    /// <summary>The payload version is not supported.</summary>
    UnsupportedVersion,

    /// <summary>The payload has no root node.</summary>
    MissingRoot,

    /// <summary>The payload repeats a node identifier.</summary>
    DuplicateNode,

    /// <summary>A parent/child/sibling reference does not resolve.</summary>
    InvalidReference,

    /// <summary>The node graph contains a cycle.</summary>
    Cycle,

    /// <summary>The payload exceeds an implementation resource limit.</summary>
    ResourceLimit,

    /// <summary>The payload uses a feature this codec does not support.</summary>
    UnsupportedFeature,
}

/// <summary>
/// Codec failure with optional byte offset. <see cref="UiDocumentErrorCode.None"/>
/// means success; every other code means the operation produced no document.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiDocumentError(UiDocumentErrorCode Code, int Offset, string Message)
{
    /// <summary>Gets the success sentinel.</summary>
    public static UiDocumentError None => new(UiDocumentErrorCode.None, -1, string.Empty);

    /// <summary>Gets whether this error describes a failure.</summary>
    public bool HasError => Code != UiDocumentErrorCode.None;
}

/// <summary>
/// Document serialization contract. Reads are span-based and allocation-free
/// at the API boundary; writes go through a caller-owned buffer writer so the
/// caller controls pooling and output size.
/// </summary>
public interface IUiDocumentCodec
{
    /// <summary>Gets the stable format identifier.</summary>
    string FormatId { get; }

    /// <summary>Gets the format version this codec writes.</summary>
    int Version { get; }

    /// <summary>Reads one document from a payload.</summary>
    bool TryRead(ReadOnlySpan<byte> data, out IUiDocument? document, out UiDocumentError failure);

    /// <summary>Writes one document into a buffer writer.</summary>
    void Write(IUiDocument document, IBufferWriter<byte> destination);
}
