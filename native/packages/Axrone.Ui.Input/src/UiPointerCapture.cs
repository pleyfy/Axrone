namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>One pointer capture transition.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiPointerCaptureEvent(
    int PointerId,
    UiNodeId Previous,
    UiNodeId Current,
    bool Captured);

/// <summary>Receives pointer capture transitions.</summary>
public interface IUiPointerCaptureSink
{
    /// <summary>Called for every capture, release or owner-loss transition.</summary>
    void OnCaptureChanged(in UiPointerCaptureEvent args);
}

/// <summary>
/// Fixed-slot per-pointer capture registry. Slots are indexed by pointer id, so
/// capture and release are O(1), allocation-free and deterministic; release sweeps
/// always run in ascending pointer order.
/// </summary>
/// <remarks>
/// <see cref="ReleaseNode(UiNodeId)"/> is the owner-loss path: when a captured node is
/// destroyed, its pointers are released and focus is cleared if that node owned it.
/// </remarks>
public sealed class UiPointerCapture : IUiPointerCapture
{
    private readonly UiNodeId[] _owners;
    private readonly IUiPointerCaptureSink? _sink;
    private readonly IUiFocusManager? _focus;
    private int _capturedCount;

    /// <summary>Creates a capture registry with a bounded pointer-slot count.</summary>
    /// <param name="maxPointers">Pointer slots; between 1 and 64.</param>
    /// <param name="sink">Optional transition sink.</param>
    /// <param name="focus">Optional focus owner cleared when a captured node is lost.</param>
    public UiPointerCapture(int maxPointers = 8, IUiPointerCaptureSink? sink = null, IUiFocusManager? focus = null)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxPointers, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(maxPointers, 64);
        _owners = new UiNodeId[maxPointers];
        _sink = sink;
        _focus = focus;
    }

    /// <summary>Gets the number of pointers currently captured.</summary>
    public int CapturedCount => _capturedCount;

    /// <inheritdoc/>
    public UiNodeId GetCaptured(int pointerId)
    {
        if ((uint)pointerId >= (uint)_owners.Length)
        {
            return UiNodeId.Invalid;
        }

        return _owners[pointerId];
    }

    /// <inheritdoc/>
    public bool TryCapture(int pointerId, UiNodeId node)
    {
        if ((uint)pointerId >= (uint)_owners.Length || !node.IsValid)
        {
            return false;
        }

        UiNodeId previous = _owners[pointerId];
        if (previous == node)
        {
            return true;
        }

        _owners[pointerId] = node;
        if (!previous.IsValid)
        {
            _capturedCount++;
        }

        Notify(pointerId, previous, node);
        return true;
    }

    /// <inheritdoc/>
    public bool Release(int pointerId)
    {
        if ((uint)pointerId >= (uint)_owners.Length)
        {
            return false;
        }

        UiNodeId previous = _owners[pointerId];
        if (!previous.IsValid)
        {
            return false;
        }

        _owners[pointerId] = UiNodeId.Invalid;
        _capturedCount--;
        Notify(pointerId, previous, UiNodeId.Invalid);
        return true;
    }

    /// <inheritdoc/>
    public void ReleaseAll()
    {
        for (int pointerId = 0; pointerId < _owners.Length; pointerId++)
        {
            Release(pointerId);
        }
    }

    /// <summary>
    /// Releases every pointer captured by a node, clears focus when that node owned it,
    /// and returns the number of released pointers.
    /// </summary>
    public int ReleaseNode(UiNodeId node)
    {
        if (!node.IsValid)
        {
            return 0;
        }

        int released = 0;
        for (int pointerId = 0; pointerId < _owners.Length; pointerId++)
        {
            if (_owners[pointerId] == node)
            {
                Release(pointerId);
                released++;
            }
        }

        if (released > 0 && _focus is not null && _focus.Focused == node)
        {
            _focus.ClearFocus(UiFocusReason.Window);
        }

        return released;
    }

    private void Notify(int pointerId, UiNodeId previous, UiNodeId current)
    {
        if (_sink is not null)
        {
            var args = new UiPointerCaptureEvent(pointerId, previous, current, current.IsValid);
            _sink.OnCaptureChanged(in args);
        }
    }
}
