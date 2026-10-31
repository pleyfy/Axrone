namespace Axrone.Ui.Assets;

using System.Threading;

/// <summary>
/// In-memory editor document host. <see cref="TryOpen"/> serves the currently
/// decoded document; <see cref="TryReload"/> re-reads the stored bytes and
/// short-circuits on an unchanged CRC-32 instead of decoding again.
/// </summary>
public sealed class InMemoryUiEditorDocumentHost : IUiEditorDocumentHost, IDisposable
{
    private readonly Func<IUiDocumentCodec> _codecFactory;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, StoredDocument> _files = new(StringComparer.Ordinal);
    private readonly Dictionary<UiDocumentId, string> _pathById = new();
    private bool _disposed;

    /// <summary>Creates a host backed by isolated JSON codecs.</summary>
    public InMemoryUiEditorDocumentHost()
        : this(static () => new UiDocumentJsonCodec(reuseStorage: false))
    {
    }

    /// <summary>Creates a host with a custom codec factory.</summary>
    public InMemoryUiEditorDocumentHost(Func<IUiDocumentCodec> codecFactory)
    {
        ArgumentNullException.ThrowIfNull(codecFactory);
        _codecFactory = codecFactory;
    }

    /// <summary>Adds or replaces the raw bytes of a path without closing the open document.</summary>
    public void AddFile(string path, ReadOnlySpan<byte> utf8)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        using (_gate.EnterScope())
        {
            ThrowIfDisposed();
            ReplaceBytes(path, utf8.ToArray());
        }
    }

    /// <summary>Replaces the raw bytes of an existing path; <see cref="TryReload"/> observes the change.</summary>
    public bool ReplaceFile(string path, ReadOnlySpan<byte> utf8)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        using (_gate.EnterScope())
        {
            ThrowIfDisposed();
            if (!_files.ContainsKey(path))
            {
                return false;
            }

            ReplaceBytes(path, utf8.ToArray());
            return true;
        }
    }

    /// <inheritdoc/>
    public bool TryOpen(string path, out IUiDocument? document)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        using (_gate.EnterScope())
        {
            ThrowIfDisposed();
            document = null;
            if (!_files.TryGetValue(path, out StoredDocument? stored))
            {
                return false;
            }

            if (stored.Document is not null)
            {
                document = stored.Document;
                return true;
            }

            if (!TryDecode(stored, path))
            {
                return false;
            }

            document = stored.Document;
            return true;
        }
    }

    /// <inheritdoc/>
    public bool TrySave(IUiDocument document, string path)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentException.ThrowIfNullOrEmpty(path);
        using (_gate.EnterScope())
        {
            ThrowIfDisposed();

            var buffer = new ArrayBufferWriter<byte>(1024);
            IUiDocumentCodec writer = _codecFactory();
            byte[] bytes;
            try
            {
                writer.Write(document, buffer);
                bytes = buffer.WrittenSpan.ToArray();
            }
            finally
            {
                (writer as IDisposable)?.Dispose();
            }

            ReplaceBytes(path, bytes);
            if (!_files.TryGetValue(path, out StoredDocument? stored))
            {
                return false;
            }

            stored.Dispose();
            return TryDecode(stored, path);
        }
    }

    /// <inheritdoc/>
    public bool TryReload(UiDocumentId document, out IUiDocument? reloaded)
    {
        using (_gate.EnterScope())
        {
            ThrowIfDisposed();
            reloaded = null;
            if (!_pathById.TryGetValue(document, out string? path) ||
                !_files.TryGetValue(path, out StoredDocument? stored))
            {
                return false;
            }

            uint crc = ComputeCrc(stored.Bytes);
            if (stored.Document is not null && stored.Crc == crc)
            {
                reloaded = stored.Document;
                return true;
            }

            stored.Dispose();
            if (!TryDecode(stored, path))
            {
                return false;
            }

            if (stored.Document is null || stored.Document.Info.Id != document)
            {
                stored.Dispose();
                _pathById.Remove(document);
                return false;
            }

            reloaded = stored.Document;
            return true;
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        using (_gate.EnterScope())
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            foreach (StoredDocument stored in _files.Values)
            {
                stored.Dispose();
            }

            _files.Clear();
            _pathById.Clear();
        }

        GC.SuppressFinalize(this);
    }

    private void ReplaceBytes(string path, byte[] bytes)
    {
        if (!_files.TryGetValue(path, out StoredDocument? stored))
        {
            stored = new StoredDocument();
            _files.Add(path, stored);
        }

        stored.Bytes = bytes;
    }

    private bool TryDecode(StoredDocument stored, string path)
    {
        IUiDocumentCodec codec = _codecFactory();
        bool retained = false;
        try
        {
            if (!codec.TryRead(stored.Bytes, out IUiDocument? document, out _) || document is null)
            {
                return false;
            }

            if (_pathById.TryGetValue(document.Info.Id, out string? mapped) &&
                !string.Equals(mapped, path, StringComparison.Ordinal))
            {
                return false;
            }

            stored.Document = document;
            stored.Owner = codec as IDisposable;
            stored.Crc = ComputeCrc(stored.Bytes);
            _pathById[document.Info.Id] = path;
            retained = true;
            return true;
        }
        finally
        {
            if (!retained)
            {
                (codec as IDisposable)?.Dispose();
            }
        }
    }

    private static uint ComputeCrc(ReadOnlySpan<byte> bytes) => Crc32Algorithm.Hash(bytes).Value;

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private sealed class StoredDocument : IDisposable
    {
        public byte[] Bytes { get; set; } = [];

        public uint Crc { get; set; }

        public IUiDocument? Document { get; set; }

        public IDisposable? Owner { get; set; }

        public void Dispose()
        {
            Owner?.Dispose();
            Owner = null;
            Document = null;
            Crc = 0;
        }
    }
}
