namespace Axrone.Ui.Assets;

using System.Text.Encodings.Web;

/// <summary>
/// v1 <c>.ui.json</c> codec. Reads decode into reusable storage (two buffers
/// are swapped so a failed read leaves the previous document valid) and writes
/// reuse one <see cref="Utf8JsonWriter"/>; warm reads and writes allocate no
/// managed memory. Not thread-safe.
/// </summary>
public sealed class UiDocumentJsonCodec : IUiDocumentCodec, IDisposable
{
    /// <summary>Stable format identifier.</summary>
    public const string CodecFormatId = UiDocumentJsonSchema.FormatId;

    /// <summary>Schema version written by this codec.</summary>
    public const int SchemaVersion = UiDocumentJsonSchema.Version;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = false,
        MaxDepth = UiDocumentJsonSchema.MaxJsonDepth,
        SkipValidation = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly UiDocumentMigrationPipeline _migrations;
    private readonly bool _reuseStorage;
    private readonly Utf8JsonWriter _writer;
    private readonly ArrayBufferWriter<byte> _seedBuffer = new(1);
    private readonly ArrayBufferWriter<byte> _migrationBuffer = new(1024);
    private readonly Utf8StringCache _assetIdCache = new();
    private readonly Utf8StringCache _nameCache = new();

    private UiDocumentStorage? _live;
    private UiDocumentStorage? _staging;
    private UiAssetDocument? _document;
    private bool _disposed;

    /// <summary>Creates a codec with no migrations and reusable storage.</summary>
    public UiDocumentJsonCodec()
        : this(null, true)
    {
    }

    /// <summary>Creates a codec with no migrations.</summary>
    public UiDocumentJsonCodec(bool reuseStorage)
        : this(null, reuseStorage)
    {
    }

    /// <summary>Creates a codec.</summary>
    /// <param name="migrations">Optional migration chain for older payloads.</param>
    /// <param name="reuseStorage">
    /// When true, reads reuse two internal buffers and the returned document is
    /// invalidated by the next successful read. When false, every read returns
    /// an independent document.
    /// </param>
    public UiDocumentJsonCodec(UiDocumentMigrationPipeline? migrations, bool reuseStorage = true)
    {
        _migrations = migrations ?? UiDocumentMigrationPipeline.Empty;
        _reuseStorage = reuseStorage;
        _writer = new Utf8JsonWriter(_seedBuffer, WriterOptions);
        if (reuseStorage)
        {
            _live = new UiDocumentStorage(8, 8, 256);
            _staging = new UiDocumentStorage(8, 8, 256);
            _document = new UiAssetDocument(_live, default, string.Empty);
        }
    }

    /// <inheritdoc/>
    public string FormatId => CodecFormatId;

    /// <inheritdoc/>
    public int Version => SchemaVersion;

    /// <inheritdoc/>
    public bool TryRead(ReadOnlySpan<byte> data, out IUiDocument? document, out UiDocumentError failure)
    {
        ThrowIfDisposed();
        document = null;
        if (data.IsEmpty)
        {
            failure = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Payload is empty.");
            return false;
        }

        if (!UiDocumentJsonReader.TryProbeVersion(data, out int version, out failure))
        {
            return false;
        }

        if (version != SchemaVersion)
        {
            if (version > SchemaVersion || version < 0)
            {
                failure = new UiDocumentError(
                    UiDocumentErrorCode.UnsupportedVersion,
                    0,
                    "Document version is not supported.");
                return false;
            }

            _migrationBuffer.Clear();
            if (!_migrations.TryMigrate(data, version, SchemaVersion, _migrationBuffer, out failure))
            {
                return false;
            }

            data = _migrationBuffer.WrittenSpan;
            if (!UiDocumentJsonReader.TryProbeVersion(data, out version, out failure))
            {
                return false;
            }

            if (version != SchemaVersion)
            {
                failure = new UiDocumentError(
                    UiDocumentErrorCode.UnsupportedVersion,
                    0,
                    "Migrated document version is not supported.");
                return false;
            }
        }

        UiDocumentStorage target = _reuseStorage ? _staging! : new UiDocumentStorage(8, 8, 256);
        target.Reset();
        var reader = new UiDocumentJsonReader(target);
        if (!reader.TryParse(data, out UiParsedDocument parsed, out failure))
        {
            return false;
        }

        ReadOnlySpan<byte> assetIdBytes = target.GetUtf8(parsed.AssetId);
        ReadOnlySpan<byte> nameBytes = target.GetUtf8(parsed.Name);
        string assetId = _assetIdCache.Get(assetIdBytes);
        string name = _nameCache.Get(nameBytes);
        uint documentId = (uint)Fnv1a64.Compute(assetIdBytes);
        if (documentId == 0)
        {
            documentId = 1;
        }

        var info = new UiDocumentInfo(new UiDocumentId(documentId), name, parsed.Version, parsed.Canvas);
        if (_reuseStorage)
        {
            (_live, _staging) = (_staging, _live);
            _document!.Attach(_live!, in info, assetId);
            document = _document;
        }
        else
        {
            document = new UiAssetDocument(target, in info, assetId);
        }

        failure = UiDocumentError.None;
        return true;
    }

    /// <inheritdoc/>
    public void Write(IUiDocument document, IBufferWriter<byte> destination)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(destination);
        if (document.Info.Version != SchemaVersion)
        {
            throw new ArgumentException("Only the current schema version can be written.", nameof(document));
        }

        if (!document.Nodes.Root.IsValid)
        {
            throw new ArgumentException("Document root is invalid.", nameof(document));
        }

        _writer.Reset(destination);
        UiDocumentJsonWriter.Write(_writer, document);
        _writer.Flush();
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _writer.Dispose();
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
