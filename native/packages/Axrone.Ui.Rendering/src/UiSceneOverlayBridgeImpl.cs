namespace Axrone.Ui.Rendering;

using Axrone.Scene;

/// <summary>
/// Owns which UI documents are mounted on which scene actors and forwards their
/// frames to the render host. Attachments are validated on mount: a document id
/// must be valid and unique, and a world-space mount must name a live actor and
/// a positive pixels-per-unit scale. Screen-space mounts ignore the actor.
/// </summary>
/// <remarks>
/// Attachment order is stable: detaching preserves the relative order of the
/// remaining documents, so overlay submission order is reproducible.
/// </remarks>
public sealed class UiSceneOverlayBridge : IUiSceneOverlayBridge, IDisposable
{
    private const int InitialCapacity = 8;

    private readonly IUiRenderHost _host;
    private UiOverlayAttachment[] _attachments;
    private int _count;
    private int _disposed;

    /// <summary>Initializes the bridge over a render host.</summary>
    /// <param name="host">Frame sink for mounted documents.</param>
    public UiSceneOverlayBridge(IUiRenderHost host)
    {
        ArgumentNullException.ThrowIfNull(host);
        _host = host;
        _attachments = new UiOverlayAttachment[InitialCapacity];
        _count = 0;
    }

    /// <inheritdoc/>
    public int AttachmentCount => _count;

    /// <summary>Gets the number of frames forwarded to the host.</summary>
    public long SubmittedFrames { get; private set; }

    /// <summary>Gets whether the bridge is disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <inheritdoc/>
    public bool TryAttach(in UiOverlayAttachment attachment)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        if (!attachment.Document.IsValid || !IsValidAttachment(in attachment))
        {
            return false;
        }

        if (IndexOf(attachment.Document) >= 0)
        {
            return false;
        }

        if (_count == _attachments.Length)
        {
            Array.Resize(ref _attachments, _attachments.Length * 2);
        }

        _attachments[_count++] = attachment;
        return true;
    }

    /// <inheritdoc/>
    public bool TryDetach(UiDocumentId document)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        int index = IndexOf(document);
        if (index < 0)
        {
            return false;
        }

        int last = _count - 1;
        if (index != last)
        {
            Array.Copy(_attachments, index + 1, _attachments, index, last - index);
        }

        _attachments[last] = default;
        _count = last;
        return true;
    }

    /// <inheritdoc/>
    public bool TryGetAttachment(UiDocumentId document, out UiOverlayAttachment attachment)
    {
        int index = IndexOf(document);
        if (index < 0)
        {
            attachment = default;
            return false;
        }

        attachment = _attachments[index];
        return true;
    }

    /// <inheritdoc/>
    public bool TrySubmitFrame(UiDocumentId document, IUiFrame frame)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        if (frame is null || IndexOf(document) < 0)
        {
            return false;
        }

        _host.Submit(frame);
        SubmittedFrames++;
        return true;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Array.Clear(_attachments);
        _count = 0;
    }

    private static bool IsValidAttachment(in UiOverlayAttachment attachment)
    {
        if (attachment.PixelsPerUnit < 0.0f)
        {
            return false;
        }

        return attachment.Space switch
        {
            UiOverlaySpace.Screen => true,
            UiOverlaySpace.World => attachment.Host.IsValid && attachment.PixelsPerUnit > 0.0f,
            _ => false,
        };
    }

    private int IndexOf(UiDocumentId document)
    {
        if (!document.IsValid)
        {
            return -1;
        }

        for (int i = 0; i < _count; i++)
        {
            if (_attachments[i].Document == document)
            {
                return i;
            }
        }

        return -1;
    }
}
