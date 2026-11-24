namespace Axrone.Input;

/// <summary>
/// Raw input event discriminants. Values are wire-stable.
/// </summary>
public enum RawInputType : byte
{
    /// <summary>No event.</summary>
    None = 0,

    /// <summary>Key pressed.</summary>
    KeyDown = 1,

    /// <summary>Key released.</summary>
    KeyUp = 2,

    /// <summary>Text character typed.</summary>
    KeyChar = 3,

    /// <summary>Mouse button pressed.</summary>
    MouseDown = 4,

    /// <summary>Mouse button released.</summary>
    MouseUp = 5,

    /// <summary>Mouse moved to an absolute position.</summary>
    MouseMove = 6,

    /// <summary>Wheel scrolled.</summary>
    MouseScroll = 7,

    /// <summary>Gamepad button pressed.</summary>
    GamepadButtonDown = 8,

    /// <summary>Gamepad button released.</summary>
    GamepadButtonUp = 9,

    /// <summary>Gamepad axis moved.</summary>
    GamepadAxis = 10,

    /// <summary>Touch contact started.</summary>
    TouchStart = 11,

    /// <summary>Touch contact moved.</summary>
    TouchMove = 12,

    /// <summary>Touch contact ended or cancelled.</summary>
    TouchEnd = 13,

    /// <summary>Gamepad connection changed.</summary>
    GamepadConnection = 14,

    /// <summary>
    /// Relative pointer motion while the cursor is locked. The absolute position is deliberately
    /// not carried: under a lock the platform has no meaningful cursor coordinates to report, and
    /// folding a locked reading as a position would freeze the hit-test point at wherever the
    /// pointer happened to be when the lock was taken.
    /// </summary>
    MouseDelta = 15,
}

/// <summary>
/// Millisecond timestamp of a raw event, sampled at enqueue time.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct InputTimestamp(uint Milliseconds) :
    IComparable<InputTimestamp>,
    IComparisonOperators<InputTimestamp, InputTimestamp, bool>
{
    /// <summary>Samples the current timestamp.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static InputTimestamp Now() => new((uint)Environment.TickCount);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(InputTimestamp other) => Milliseconds.CompareTo(other.Milliseconds);

    /// <summary>Determines whether the left timestamp sorts before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(InputTimestamp left, InputTimestamp right) => left.Milliseconds < right.Milliseconds;

    /// <summary>Determines whether the left timestamp sorts after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(InputTimestamp left, InputTimestamp right) => left.Milliseconds > right.Milliseconds;

    /// <summary>Determines whether the left timestamp sorts at or before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(InputTimestamp left, InputTimestamp right) => left.Milliseconds <= right.Milliseconds;

    /// <summary>Determines whether the left timestamp sorts at or after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(InputTimestamp left, InputTimestamp right) => left.Milliseconds >= right.Milliseconds;

    /// <summary>Unwraps the millisecond count.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator uint(InputTimestamp timestamp) => timestamp.Milliseconds;

    /// <summary>Wraps a millisecond count.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static explicit operator InputTimestamp(uint milliseconds) => new(milliseconds);
}

/// <summary>
/// Device slot index: keyboard/mouse slot or gamepad slot.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly record struct DeviceIndex(byte Value) :
    IComparable<DeviceIndex>,
    IComparisonOperators<DeviceIndex, DeviceIndex, bool>
{
    /// <summary>First device.</summary>
    public static DeviceIndex Primary => new(0);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(DeviceIndex other) => Value.CompareTo(other.Value);

    /// <summary>Determines whether the left index sorts before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(DeviceIndex left, DeviceIndex right) => left.Value < right.Value;

    /// <summary>Determines whether the left index sorts after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(DeviceIndex left, DeviceIndex right) => left.Value > right.Value;

    /// <summary>Determines whether the left index sorts at or before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(DeviceIndex left, DeviceIndex right) => left.Value <= right.Value;

    /// <summary>Determines whether the left index sorts at or after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(DeviceIndex left, DeviceIndex right) => left.Value >= right.Value;

    /// <summary>Unwraps the slot.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator byte(DeviceIndex index) => index.Value;

    /// <summary>Wraps a slot.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static explicit operator DeviceIndex(byte value) => new(value);

    /// <summary>Wraps a slot, truncating to a byte.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static explicit operator DeviceIndex(int value) => new((byte)value);
}

/// <summary>
/// One raw input event: 16 bytes, register-passable. Float and integer
/// payloads overlap in a union: key/char/gamepad-button events read the
/// integer view, pointer/axis events read the float view.
/// </summary>
[StructLayout(LayoutKind.Explicit, Size = 16)]
public readonly struct RawInputEvent : IEquatable<RawInputEvent>
{
    /// <summary>Sampled timestamp.</summary>
    [FieldOffset(0)]
    public readonly InputTimestamp Timestamp;

    /// <summary>Event discriminant.</summary>
    [FieldOffset(4)]
    public readonly RawInputType EventType;

    /// <summary>Source device slot.</summary>
    [FieldOffset(5)]
    public readonly DeviceIndex Device;

    /// <summary>Key, button or axis code.</summary>
    [FieldOffset(6)]
    public readonly ushort KeyCode;

    /// <summary>Float payload X (position, delta or axis value).</summary>
    [FieldOffset(8)]
    public readonly float ValueX;

    /// <summary>Float payload Y.</summary>
    [FieldOffset(12)]
    public readonly float ValueY;

    /// <summary>Integer payload low word (scancode, char or button index).</summary>
    [FieldOffset(8)]
    public readonly int IntValue0;

    /// <summary>Integer payload high word.</summary>
    [FieldOffset(12)]
    public readonly int IntValue1;

    /// <summary>Creates a float-payload event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public RawInputEvent(InputTimestamp timestamp, RawInputType type, DeviceIndex deviceIndex, ushort keyCode, float x = 0.0f, float y = 0.0f)
    {
        IntValue0 = 0;
        IntValue1 = 0;
        Timestamp = timestamp;
        EventType = type;
        Device = deviceIndex;
        KeyCode = keyCode;
        ValueX = x;
        ValueY = y;
    }

    /// <summary>Creates an integer-payload event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public RawInputEvent(InputTimestamp timestamp, RawInputType type, DeviceIndex deviceIndex, ushort keyCode, int int0, int int1)
    {
        ValueX = 0.0f;
        ValueY = 0.0f;
        Timestamp = timestamp;
        EventType = type;
        Device = deviceIndex;
        KeyCode = keyCode;
        IntValue0 = int0;
        IntValue1 = int1;
    }

    /// <summary>Creates a key-down event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateKeyDown(DeviceIndex device, Key key, ushort scancode, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.KeyDown, device, (ushort)key, scancode, 0);

    /// <summary>Creates a key-up event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateKeyUp(DeviceIndex device, Key key, ushort scancode, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.KeyUp, device, (ushort)key, scancode, 0);

    /// <summary>Creates a text-character event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateKeyChar(DeviceIndex device, char character, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.KeyChar, device, character, 0, 0);

    /// <summary>Creates a mouse-down event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateMouseDown(DeviceIndex device, MouseButton button, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.MouseDown, device, (ushort)button, 0.0f, 0.0f);

    /// <summary>Creates a mouse-up event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateMouseUp(DeviceIndex device, MouseButton button, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.MouseUp, device, (ushort)button, 0.0f, 0.0f);

    /// <summary>Creates a mouse-move event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateMouseMove(DeviceIndex device, float x, float y, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.MouseMove, device, 0, x, y);

    /// <summary>Creates a locked-pointer relative-motion event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateMouseDelta(DeviceIndex device, float deltaX, float deltaY, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.MouseDelta, device, 0, deltaX, deltaY);

    /// <summary>Creates a mouse-scroll event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateMouseScroll(DeviceIndex device, float x, float y, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.MouseScroll, device, 0, x, y);

    /// <summary>Creates a gamepad-button-down event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateGamepadButtonDown(DeviceIndex device, ButtonName name, ushort index, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.GamepadButtonDown, device, (ushort)name, index, 0);

    /// <summary>Creates a gamepad-button-up event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateGamepadButtonUp(DeviceIndex device, ButtonName name, ushort index, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.GamepadButtonUp, device, (ushort)name, index, 0);

    /// <summary>Creates a gamepad-axis event.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateGamepadAxis(DeviceIndex device, byte axisIndex, float position, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.GamepadAxis, device, axisIndex, position, 0.0f);

    /// <summary>Creates a touch-contact event.</summary>
    /// <param name="contactId">Contact slot.</param>
    /// <param name="phase">Contact phase.</param>
    /// <param name="x">Contact X.</param>
    /// <param name="y">Contact Y.</param>
    /// <param name="timestamp">Sample time.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateTouch(byte contactId, TouchPhase phase, float x, float y, InputTimestamp timestamp) =>
        new(timestamp, phase switch
        {
            TouchPhase.Move => RawInputType.TouchMove,
            TouchPhase.End or TouchPhase.Cancel => RawInputType.TouchEnd,
            _ => RawInputType.TouchStart,
        }, DeviceIndex.Primary, contactId, x, y);

    /// <summary>Creates a gamepad-connection event.</summary>
    /// <param name="slot">Gamepad slot.</param>
    /// <param name="connected">Whether connected.</param>
    /// <param name="timestamp">Sample time.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RawInputEvent CreateGamepadConnection(byte slot, bool connected, InputTimestamp timestamp) =>
        new(timestamp, RawInputType.GamepadConnection, (DeviceIndex)slot, 0, connected ? 1.0f : 0.0f, 0.0f);

    /// <summary>Deconstructs the event fields.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Deconstruct(out RawInputType type, out DeviceIndex device, out ushort keyCode, out float x, out float y, out InputTimestamp timestamp)
    {
        type = EventType;
        device = Device;
        keyCode = KeyCode;
        x = ValueX;
        y = ValueY;
        timestamp = Timestamp;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(RawInputEvent other) =>
        Timestamp == other.Timestamp &&
        EventType == other.EventType &&
        Device == other.Device &&
        KeyCode == other.KeyCode &&
        IntValue0 == other.IntValue0 &&
        IntValue1 == other.IntValue1;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is RawInputEvent other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(Timestamp, (byte)EventType, Device, KeyCode, IntValue0, IntValue1);

    /// <summary>Determines whether two events match.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator ==(RawInputEvent left, RawInputEvent right) => left.Equals(right);

    /// <summary>Determines whether two events differ.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator !=(RawInputEvent left, RawInputEvent right) => !left.Equals(right);
}
