namespace Axrone.Ui.Text;

/// <summary>
/// Owns immutable font bytes. The default path copies into a pinned object heap
/// array so the span handed to the parser and faces never moves; the native path
/// allocates aligned unmanaged memory for very large fonts. Disposal is
/// deterministic and idempotent.
/// </summary>
public sealed class UiFontBuffer : IDisposable
{
    private byte[]? _pinned;
    private IntPtr _native;
    private int _length;
    private bool _disposed;

    private UiFontBuffer(byte[]? pinned, IntPtr native, int length)
    {
        _pinned = pinned;
        _native = native;
        _length = length;
    }

    /// <summary>Gets the buffer byte length.</summary>
    public int Length
    {
        get
        {
            ThrowIfDisposed();
            return _length;
        }
    }

    /// <summary>Gets whether the bytes live in unmanaged memory.</summary>
    public bool IsNative
    {
        get
        {
            ThrowIfDisposed();
            return _native != IntPtr.Zero;
        }
    }

    /// <summary>Gets a read-only view over the font bytes.</summary>
    public unsafe ReadOnlySpan<byte> Span
    {
        get
        {
            ThrowIfDisposed();
            return _pinned is not null
                ? _pinned
                : new ReadOnlySpan<byte>((void*)_native, _length);
        }
    }

    /// <summary>Copies font bytes into a pinned object heap array.</summary>
    public static UiFontBuffer FromSpan(ReadOnlySpan<byte> data)
    {
        if (data.IsEmpty)
        {
            throw new ArgumentException("Font data must not be empty.", nameof(data));
        }

        byte[] pinned = GC.AllocateArray<byte>(data.Length, pinned: true);
        data.CopyTo(pinned);
        return new UiFontBuffer(pinned, IntPtr.Zero, data.Length);
    }

    /// <summary>Copies font bytes into aligned unmanaged memory.</summary>
    public static unsafe UiFontBuffer FromNative(ReadOnlySpan<byte> data)
    {
        if (data.IsEmpty)
        {
            throw new ArgumentException("Font data must not be empty.", nameof(data));
        }

        byte* memory = (byte*)NativeMemory.AlignedAlloc((nuint)data.Length, 16);
        if (memory is null)
        {
            throw new InvalidOperationException("Font buffer allocation failed.");
        }

        data.CopyTo(new Span<byte>(memory, data.Length));
        return new UiFontBuffer(null, (IntPtr)memory, data.Length);
    }

    /// <summary>Copies an owned byte array into a pinned object heap buffer.</summary>
    public static UiFontBuffer FromOwned(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
        return FromSpan(data);
    }

    /// <inheritdoc/>
    public unsafe void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_native != IntPtr.Zero)
        {
            NativeMemory.AlignedFree((void*)_native);
            _native = IntPtr.Zero;
        }

        _pinned = null;
        _length = 0;
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
