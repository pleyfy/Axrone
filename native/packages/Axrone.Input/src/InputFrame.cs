namespace Axrone.Input;

/// <summary>
/// Frame coordinator: drains the transport queue into a debounced snapshot
/// and answers held/pressed/released queries. One <see cref="NewFrame"/>
/// per tick: previous becomes current, deltas reset, queued events apply.
/// </summary>
/// <typeparam name="TBackoff">Queue contention backoff policy.</typeparam>
/// <typeparam name="TMetrics">Queue telemetry sink.</typeparam>
public sealed class InputFrameCoordinator<TBackoff, TMetrics> : IInputStateQuery, IDisposable
    where TBackoff : struct, ISpinBackoff
    where TMetrics : struct, IInputMetricsSink
{
    private readonly LockFreeInputRingBuffer<TBackoff, TMetrics> _ringBuffer;
    private readonly List<char> _frameText = new();
    private InputSnapshot _current;
    private InputSnapshot _previous;
    private float _previousPinch;
    private int _isDisposed;

    /// <summary>Transport queue feeding this coordinator.</summary>
    public LockFreeInputRingBuffer<TBackoff, TMetrics> RingBuffer => _ringBuffer;

    /// <summary>Debounced state for the current frame.</summary>
    public InputSnapshot CurrentSnapshot
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _current;
    }

    /// <summary>Writes a polled full gamepad frame into the current snapshot.</summary>
    /// <param name="slot">Gamepad slot.</param>
    /// <param name="buttons">Button bits in engine numbering.</param>
    /// <param name="axes">Up to six axis positions.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void SetGamepadFrame(byte slot, uint buttons, ReadOnlySpan<float> axes)
    {
        if (slot >= 4)
        {
            return;
        }

        GetGamepadButtons(ref _current, slot) = buttons;
        int count = axes.Length < 6 ? axes.Length : 6;
        for (int i = 0; i < count; i++)
        {
            _current.GamepadAxes[(slot * 6) + i] = axes[i];
        }
    }

    /// <summary>Typed characters drained this frame.</summary>
    public IReadOnlyList<char> FrameText => _frameText;

    /// <summary>Creates a coordinator with the given queue capacity.</summary>
    public InputFrameCoordinator(BufferCapacity capacity)
    {
        _ringBuffer = new LockFreeInputRingBuffer<TBackoff, TMetrics>(capacity);
        _current = default;
        _previous = default;
    }

    /// <summary>Creates a coordinator with a raw slot count.</summary>
    /// <param name="queueCapacity">Power-of-two slot count.</param>
    public InputFrameCoordinator(uint queueCapacity = 4096)
        : this(new BufferCapacity(queueCapacity))
    {
    }

    /// <summary>Advances one frame: snapshots roll, deltas clear, queued events apply.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void NewFrame()
    {
        _previous = _current;
        _current.MouseDeltaX = 0.0f;
        _current.MouseDeltaY = 0.0f;
        _current.ScrollDeltaX = 0.0f;
        _current.ScrollDeltaY = 0.0f;
        _frameText.Clear();

        Span<RawInputEvent> batch = stackalloc RawInputEvent[128];
        int read;

        while ((read = _ringBuffer.Drain(batch)) > 0)
        {
            for (int i = 0; i < read; i++)
            {
                ApplyEvent(ref _current, batch[i], _frameText);
            }
        }

        ComputePinch();
    }

    /// <summary>Derives pinch distance and delta from the first two contacts.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private void ComputePinch()
    {
        int found = 0;
        float x0 = 0.0f;
        float y0 = 0.0f;
        float x1 = 0.0f;
        float y1 = 0.0f;
        for (int i = 0; i < 8 && found < 2; i++)
        {
            TouchContact contact = _current.TouchContacts[i];
            if (!contact.Active)
            {
                continue;
            }

            if (found == 0)
            {
                x0 = contact.X;
                y0 = contact.Y;
            }
            else
            {
                x1 = contact.X;
                y1 = contact.Y;
            }

            found++;
        }

        if (found < 2)
        {
            _current.TouchPinch = 0.0f;
            _current.TouchPinchDelta = 0.0f;
            _previousPinch = 0.0f;
            return;
        }

        float dx = x1 - x0;
        float dy = y1 - y0;
        float distance = MathF.Sqrt((dx * dx) + (dy * dy));
        _current.TouchPinch = distance;
        _current.TouchPinchDelta = distance - _previousPinch;
        _previousPinch = distance;
    }

    /// <summary>Folds one raw event into a snapshot.</summary>
    /// <param name="snapshot">Snapshot to update.</param>
    /// <param name="evt">Raw event to fold.</param>
    /// <param name="frameText">Typed characters collected this frame.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void ApplyEvent(ref InputSnapshot snapshot, in RawInputEvent evt, List<char> frameText)
    {
        switch (evt.EventType)
        {
            case RawInputType.KeyDown:
                snapshot.Keys.Set(evt.KeyCode);
                break;

            case RawInputType.KeyUp:
                snapshot.Keys.Clear(evt.KeyCode);
                break;

            case RawInputType.MouseDown:
                if (evt.KeyCode < 16)
                {
                    snapshot.MouseButtons |= (ushort)(1U << evt.KeyCode);
                }
                break;

            case RawInputType.MouseUp:
                if (evt.KeyCode < 16)
                {
                    snapshot.MouseButtons &= (ushort)~(1U << evt.KeyCode);
                }
                break;

            case RawInputType.MouseMove:
                snapshot.MouseDeltaX += evt.ValueX - snapshot.MouseX;
                snapshot.MouseDeltaY += evt.ValueY - snapshot.MouseY;
                snapshot.MouseX = evt.ValueX;
                snapshot.MouseY = evt.ValueY;
                break;

            case RawInputType.MouseDelta:
                snapshot.MouseDeltaX += evt.ValueX;
                snapshot.MouseDeltaY += evt.ValueY;
                break;

            case RawInputType.MouseScroll:
                snapshot.ScrollDeltaX += evt.ValueX;
                snapshot.ScrollDeltaY += evt.ValueY;
                break;

            case RawInputType.GamepadButtonDown:
                SetGamepadButton(ref snapshot, evt.Device, evt.KeyCode, true);
                break;

            case RawInputType.GamepadButtonUp:
                SetGamepadButton(ref snapshot, evt.Device, evt.KeyCode, false);
                break;

            case RawInputType.GamepadAxis:
                SetGamepadAxis(ref snapshot, evt.Device, (byte)evt.KeyCode, evt.ValueX);
                break;

            case RawInputType.KeyChar:
                frameText.Add((char)evt.KeyCode);
                break;

            case RawInputType.TouchStart:
            case RawInputType.TouchMove:
                if (evt.KeyCode < 8)
                {
                    snapshot.TouchContacts[evt.KeyCode] = new TouchContact { Active = true, X = evt.ValueX, Y = evt.ValueY };
                }

                break;

            case RawInputType.TouchEnd:
                if (evt.KeyCode < 8)
                {
                    snapshot.TouchContacts[evt.KeyCode] = default;
                }

                break;

            case RawInputType.GamepadConnection:
                if (evt.Device.Value < 4)
                {
                    if (evt.ValueX != 0.0f)
                    {
                        snapshot.GamepadConnectedMask |= 1u << evt.Device.Value;
                    }
                    else
                    {
                        snapshot.GamepadConnectedMask &= ~(1u << evt.Device.Value);
                        GetGamepadButtons(ref snapshot, evt.Device.Value) = 0;
                        for (int axis = 0; axis < 6; axis++)
                        {
                            snapshot.GamepadAxes[(evt.Device.Value * 6) + axis] = 0.0f;
                        }
                    }
                }

                break;

            case RawInputType.None:
            default:
                break;
        }
    }

    /// <summary>Sets or clears a gamepad button bit in engine numbering.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void SetGamepadButton(ref InputSnapshot snapshot, DeviceIndex deviceIndex, ushort buttonCode, bool down)
    {
        if (deviceIndex.Value >= 4 || buttonCode >= 32)
        {
            return;
        }

        ref uint buttons = ref GetGamepadButtons(ref snapshot, deviceIndex.Value);
        uint mask = 1u << buttonCode;
        if (down)
        {
            buttons |= mask;
        }
        else
        {
            buttons &= ~mask;
        }
    }

    /// <summary>Selects the button word for a gamepad slot.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static ref uint GetGamepadButtons(ref InputSnapshot snapshot, byte slot)
    {
        if (slot == 0)
        {
            return ref snapshot.GamepadButtons0;
        }

        if (slot == 1)
        {
            return ref snapshot.GamepadButtons1;
        }

        if (slot == 2)
        {
            return ref snapshot.GamepadButtons2;
        }

        return ref snapshot.GamepadButtons3;
    }

    /// <summary>Writes a gamepad axis value.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void SetGamepadAxis(ref InputSnapshot snapshot, DeviceIndex deviceIndex, byte axisIndex, float value)
    {
        if (deviceIndex.Value >= 4 || axisIndex >= 6)
        {
            return;
        }

        int flatIndex = (deviceIndex.Value * 6) + axisIndex;
        snapshot.GamepadAxes[flatIndex] = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsKeyDown(Key key) => _current.Keys.IsSet((uint)key);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsKeyPressed(Key key)
    {
        uint code = (uint)key;
        return code < 512 && _current.Keys.IsSet(code) && !PreviousKeys().IsSet(code);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsKeyReleased(Key key)
    {
        uint code = (uint)key;
        return code < 512 && !_current.Keys.IsSet(code) && PreviousKeys().IsSet(code);
    }

    /// <summary>Previous frame keyboard bits.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private KeyStateBitset PreviousKeys() => _previous.Keys;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool AreAllKeysDown(params ReadOnlySpan<Key> keys)
    {
        for (int i = 0; i < keys.Length; i++)
        {
            if (!IsKeyDown(keys[i]))
            {
                return false;
            }
        }
        return true;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsAnyKeyDown(params ReadOnlySpan<Key> keys)
    {
        for (int i = 0; i < keys.Length; i++)
        {
            if (IsKeyDown(keys[i]))
            {
                return true;
            }
        }
        return false;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsMouseButtonDown(MouseButton button)
    {
        uint code = (uint)button;
        return code < 16 && (_current.MouseButtons & (1U << (int)code)) != 0;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsMouseButtonPressed(MouseButton button)
    {
        uint code = (uint)button;
        if (code >= 16)
        {
            return false;
        }

        uint bit = 1U << (int)code;
        return ((_current.MouseButtons & ~_previous.MouseButtons) & bit) != 0;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsMouseButtonReleased(MouseButton button)
    {
        uint code = (uint)button;
        if (code >= 16)
        {
            return false;
        }

        uint bit = 1U << (int)code;
        return ((~_current.MouseButtons & _previous.MouseButtons) & bit) != 0;
    }

    /// <inheritdoc/>
    public Vector2 MousePosition
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(_current.MouseX, _current.MouseY);
    }

    /// <inheritdoc/>
    public Vector2 MouseDelta
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(_current.MouseDeltaX, _current.MouseDeltaY);
    }

    /// <inheritdoc/>
    public Vector2 ScrollDelta
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(_current.ScrollDeltaX, _current.ScrollDeltaY);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsGamepadButtonDown(DeviceIndex gamepad, ButtonName name)
    {
        ushort code = InputControlReader.MapSilkButton((ushort)name);
        if (gamepad.Value >= 4 || code >= 32)
        {
            return false;
        }

        uint buttons = ReadGamepadButtons(in _current, gamepad.Value);
        return (buttons & (1u << code)) != 0;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool IsGamepadButtonPressed(DeviceIndex gamepad, ButtonName name)
    {
        ushort code = InputControlReader.MapSilkButton((ushort)name);
        if (gamepad.Value >= 4 || code >= 32)
        {
            return false;
        }

        uint bit = 1u << code;
        return ((ReadGamepadButtons(in _current, gamepad.Value) & ~ReadGamepadButtons(in _previous, gamepad.Value)) & bit) != 0;
    }

    /// <summary>Reads a gamepad button word from a snapshot.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint ReadGamepadButtons(in InputSnapshot snapshot, byte slot) => slot switch
    {
        0 => snapshot.GamepadButtons0,
        1 => snapshot.GamepadButtons1,
        2 => snapshot.GamepadButtons2,
        _ => snapshot.GamepadButtons3,
    };

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public float GetGamepadAxis(DeviceIndex gamepad, int axisIndex)
    {
        if (gamepad.Value >= 4 || (uint)axisIndex >= 6)
        {
            return 0.0f;
        }

        return _current.GamepadAxes[(gamepad.Value * 6) + axisIndex];
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _isDisposed, 1) == 0)
        {
            _ringBuffer.Dispose();
            GC.SuppressFinalize(this);
        }
    }
}

/// <summary>
/// Frame coordinator with default policies: adaptive backoff, no telemetry.
/// </summary>
public sealed class InputFrameCoordinator : IInputStateQuery, IDisposable
{
    private readonly InputFrameCoordinator<AdaptiveBackoff, NullMetricsPolicy> _impl;

    /// <summary>Transport queue feeding this coordinator.</summary>
    public LockFreeInputRingBuffer<AdaptiveBackoff, NullMetricsPolicy> RingBuffer => _impl.RingBuffer;

    /// <summary>Debounced state for the current frame.</summary>
    public InputSnapshot CurrentSnapshot => _impl.CurrentSnapshot;

    /// <summary>Writes a polled full gamepad frame into the current snapshot.</summary>
    /// <param name="slot">Gamepad slot.</param>
    /// <param name="buttons">Button bits in engine numbering.</param>
    /// <param name="axes">Up to six axis positions.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetGamepadFrame(byte slot, uint buttons, ReadOnlySpan<float> axes) =>
        _impl.SetGamepadFrame(slot, buttons, axes);

    /// <summary>Typed characters drained this frame.</summary>
    public IReadOnlyList<char> FrameText => _impl.FrameText;

    /// <summary>Creates a coordinator with a raw slot count.</summary>
    /// <param name="queueCapacity">Power-of-two slot count.</param>
    public InputFrameCoordinator(uint queueCapacity = 4096)
    {
        _impl = new InputFrameCoordinator<AdaptiveBackoff, NullMetricsPolicy>(queueCapacity);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void NewFrame() => _impl.NewFrame();

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsKeyDown(Key key) => _impl.IsKeyDown(key);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsKeyPressed(Key key) => _impl.IsKeyPressed(key);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsKeyReleased(Key key) => _impl.IsKeyReleased(key);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool AreAllKeysDown(params ReadOnlySpan<Key> keys) => _impl.AreAllKeysDown(keys);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsAnyKeyDown(params ReadOnlySpan<Key> keys) => _impl.IsAnyKeyDown(keys);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsMouseButtonDown(MouseButton button) => _impl.IsMouseButtonDown(button);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsMouseButtonPressed(MouseButton button) => _impl.IsMouseButtonPressed(button);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsMouseButtonReleased(MouseButton button) => _impl.IsMouseButtonReleased(button);

    /// <inheritdoc/>
    public Vector2 MousePosition => _impl.MousePosition;

    /// <inheritdoc/>
    public Vector2 MouseDelta => _impl.MouseDelta;

    /// <inheritdoc/>
    public Vector2 ScrollDelta => _impl.ScrollDelta;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsGamepadButtonDown(DeviceIndex gamepad, ButtonName name) => _impl.IsGamepadButtonDown(gamepad, name);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsGamepadButtonPressed(DeviceIndex gamepad, ButtonName name) => _impl.IsGamepadButtonPressed(gamepad, name);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float GetGamepadAxis(DeviceIndex gamepad, int axisIndex) => _impl.GetGamepadAxis(gamepad, axisIndex);

    /// <inheritdoc/>
    public void Dispose() => _impl.Dispose();
}
