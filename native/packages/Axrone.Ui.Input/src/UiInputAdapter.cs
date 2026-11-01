namespace Axrone.Ui.Input;

using Axrone.Input;
using Axrone.Ui;

/// <summary>
/// Maps engine <see cref="RawInputEvent"/> stream entries into UI input events.
/// </summary>
/// <remarks>
/// The adapter owns the transient device state the raw stream does not carry: pointer
/// position, held buttons, modifier keys, per-contact touch positions and key repeat
/// detection. It maps one raw event to at most one UI event, never allocates for pointer
/// or key mapping, and allocates only the single-character string a text event requires.
/// Call <see cref="Reset"/> when the host loses window focus.
/// </remarks>
public sealed class UiInputAdapter : IUiInputAdapter
{
    /// <summary>Pointer id used for the mouse.</summary>
    public const int MousePointerId = 0;

    private const int TouchContactLimit = 8;
    private const int KeyBitCount = 512;

    private static readonly string[] AsciiStrings = BuildAsciiStrings();

    private readonly ulong[] _keysDown = new ulong[KeyBitCount / 64];
    private readonly float[] _touchX = new float[TouchContactLimit];
    private readonly float[] _touchY = new float[TouchContactLimit];
    private Vec2 _position;
    private UiPointerButtons _buttons;
    private UiKeyModifiers _modifiers;
    private uint _touchMask;

    /// <summary>Gets the last pointer position in UI space.</summary>
    public Vec2 Position => _position;

    /// <summary>Gets the held pointer button mask.</summary>
    public UiPointerButtons Buttons => _buttons;

    /// <summary>Gets the held keyboard modifiers.</summary>
    public UiKeyModifiers Modifiers => _modifiers;

    /// <summary>Clears every tracked device bit; call when the host window loses focus.</summary>
    public void Reset()
    {
        _buttons = UiPointerButtons.None;
        _modifiers = UiKeyModifiers.None;
        _touchMask = 0;
        Array.Clear(_keysDown);
    }

    /// <inheritdoc/>
    public bool TryMapPointer(in RawInputEvent raw, out UiPointerEvent args)
    {
        long timestamp = raw.Timestamp.Milliseconds;
        switch (raw.EventType)
        {
            case RawInputType.MouseMove:
                {
                    var movePosition = new Vec2(raw.ValueX, raw.ValueY);
                    Vec2 moveDelta = movePosition - _position;
                    _position = movePosition;
                    args = new UiPointerEvent(UiNodeId.Invalid, UiPointerPhase.Move, movePosition, moveDelta, MousePointerId, -1, _buttons, _modifiers, timestamp);
                    return true;
                }

            case RawInputType.MouseDown:
                {
                    UiPointerButtons downBit = ToButton(raw.KeyCode);
                    _buttons |= downBit;
                    args = new UiPointerEvent(UiNodeId.Invalid, UiPointerPhase.Down, _position, Vec2.Zero, MousePointerId, raw.KeyCode, _buttons, _modifiers, timestamp);
                    return true;
                }

            case RawInputType.MouseUp:
                {
                    UiPointerButtons upBit = ToButton(raw.KeyCode);
                    _buttons &= ~upBit;
                    args = new UiPointerEvent(UiNodeId.Invalid, UiPointerPhase.Up, _position, Vec2.Zero, MousePointerId, raw.KeyCode, _buttons, _modifiers, timestamp);
                    return true;
                }

            case RawInputType.MouseScroll:
                args = new UiPointerEvent(UiNodeId.Invalid, UiPointerPhase.Wheel, _position, new Vec2(raw.ValueX, raw.ValueY), MousePointerId, -1, _buttons, _modifiers, timestamp);
                return true;

            default:
                return TryMapTouch(in raw, timestamp, out args);
        }
    }

    /// <inheritdoc/>
    public bool TryMapKey(in RawInputEvent raw, out UiKeyEvent args)
    {
        long timestamp = raw.Timestamp.Milliseconds;
        if (raw.KeyCode >= KeyBitCount)
        {
            args = default;
            return false;
        }

        var key = (Key)raw.KeyCode;
        switch (raw.EventType)
        {
            case RawInputType.KeyDown:
                {
                    UiKeyModifiers pressed = ToModifier(key);
                    _modifiers |= pressed;
                    bool repeat = IsKeyDown(raw.KeyCode);
                    SetKey(raw.KeyCode, true);
                    args = new UiKeyEvent(UiNodeId.Invalid, UiKeyPhase.Down, raw.KeyCode, repeat, _modifiers, timestamp);
                    return true;
                }

            case RawInputType.KeyUp:
                args = new UiKeyEvent(UiNodeId.Invalid, UiKeyPhase.Up, raw.KeyCode, false, _modifiers, timestamp);
                SetKey(raw.KeyCode, false);
                _modifiers &= ~ToModifier(key);
                return true;

            default:
                args = default;
                return false;
        }
    }

    /// <inheritdoc/>
    public bool TryMapText(in RawInputEvent raw, out UiTextInputEvent args)
    {
        if (raw.EventType != RawInputType.KeyChar)
        {
            args = default;
            return false;
        }

        args = new UiTextInputEvent(UiNodeId.Invalid, GetCharacterText((char)raw.KeyCode), false, null);
        return true;
    }

    private bool TryMapTouch(in RawInputEvent raw, long timestamp, out UiPointerEvent args)
    {
        bool start = raw.EventType == RawInputType.TouchStart;
        bool move = raw.EventType == RawInputType.TouchMove;
        bool end = raw.EventType == RawInputType.TouchEnd;
        if ((!start && !move && !end) || raw.KeyCode >= TouchContactLimit)
        {
            args = default;
            return false;
        }

        int contact = raw.KeyCode;
        int pointerId = contact + 1;
        var touchPosition = new Vec2(raw.ValueX, raw.ValueY);
        Vec2 touchDelta = Vec2.Zero;
        if (move)
        {
            touchDelta = touchPosition - new Vec2(_touchX[contact], _touchY[contact]);
        }

        if (start || move)
        {
            _touchX[contact] = touchPosition.X;
            _touchY[contact] = touchPosition.Y;
            _touchMask |= 1u << contact;
        }
        else
        {
            _touchMask &= ~(1u << contact);
        }

        _position = touchPosition;
        UiPointerPhase phase = start ? UiPointerPhase.Down : move ? UiPointerPhase.Move : UiPointerPhase.Up;
        UiPointerButtons buttons = _touchMask != 0 ? UiPointerButtons.Left : UiPointerButtons.None;
        args = new UiPointerEvent(UiNodeId.Invalid, phase, touchPosition, touchDelta, pointerId, 0, buttons, _modifiers, timestamp);
        return true;
    }

    private bool IsKeyDown(ushort keyCode) =>
        (_keysDown[keyCode >> 6] & (1UL << (keyCode & 63))) != 0;

    private void SetKey(ushort keyCode, bool down)
    {
        int word = keyCode >> 6;
        ulong bit = 1UL << (keyCode & 63);
        if (down)
        {
            _keysDown[word] |= bit;
        }
        else
        {
            _keysDown[word] &= ~bit;
        }
    }

    private static string GetCharacterText(char character)
    {
        int index = character - 32;
        return (uint)index < (uint)AsciiStrings.Length ? AsciiStrings[index] : new string(character, 1);
    }

    private static UiPointerButtons ToButton(ushort buttonCode) => buttonCode switch
    {
        0 => UiPointerButtons.Left,
        1 => UiPointerButtons.Right,
        2 => UiPointerButtons.Middle,
        3 => UiPointerButtons.Extra1,
        4 => UiPointerButtons.Extra2,
        _ => UiPointerButtons.None,
    };

    private static UiKeyModifiers ToModifier(Key key) => key switch
    {
        Key.ShiftLeft or Key.ShiftRight => UiKeyModifiers.Shift,
        Key.ControlLeft or Key.ControlRight => UiKeyModifiers.Control,
        Key.AltLeft or Key.AltRight => UiKeyModifiers.Alt,
        Key.SuperLeft or Key.SuperRight => UiKeyModifiers.Meta,
        _ => UiKeyModifiers.None,
    };

    private static string[] BuildAsciiStrings()
    {
        var values = new string[95];
        for (int i = 0; i < values.Length; i++)
        {
            values[i] = new string((char)(i + 32), 1);
        }

        return values;
    }
}
