using SilkKey = Silk.NET.Input.Key;
using SilkMouseButton = Silk.NET.Input.MouseButton;

namespace Axrone.Input;

/// <summary>
/// Live Silk.NET attachment: subscribes an <see cref="Silk.NET.Input.IInputContext"/>
/// and forwards keyboard and mouse callbacks into the transport queue.
/// Gamepads attach in the follow-up; touch has no Silk.NET.Input API.
/// </summary>
public sealed class SilkInputAttachment : IDisposable
{
    private readonly Silk.NET.Input.IInputContext _context;
    private readonly IInputEventQueue _queue;
    private readonly PointerLockController? _pointerLock;
    private Vector2 _lockedAnchor;
    private bool _hasLockedAnchor;
    private bool _disposed;

    /// <summary>Creates an attachment.</summary>
    /// <param name="context">Silk input context.</param>
    /// <param name="queue">Transport queue.</param>
    /// <param name="pointerLock">
    /// Pointer-lock controller whose policy decides whether motion is forwarded as an absolute
    /// position or as a relative delta. The platform hooks are the host's, because locking a cursor
    /// is a window-server operation, not an input-context one.
    /// </param>
    private SilkInputAttachment(
        Silk.NET.Input.IInputContext context,
        IInputEventQueue queue,
        PointerLockController? pointerLock)
    {
        _context = context;
        _queue = queue;
        _pointerLock = pointerLock;
    }

    /// <summary>Attaches to a Silk input context.</summary>
    /// <param name="context">Silk input context.</param>
    /// <param name="queue">Transport queue.</param>
    /// <param name="pointerLock">Optional pointer-lock controller.</param>
    public static SilkInputAttachment Attach(
        Silk.NET.Input.IInputContext context,
        IInputEventQueue queue,
        PointerLockController? pointerLock = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(queue);
        var attachment = new SilkInputAttachment(context, queue, pointerLock);
        attachment.SubscribeAll();
        return attachment;
    }

    /// <summary>Subscribes every known device.</summary>
    private void SubscribeAll()
    {
        for (int i = 0; i < _context.Keyboards.Count; i++)
        {
            SubscribeKeyboard(_context.Keyboards[i]);
        }

        for (int i = 0; i < _context.Mice.Count; i++)
        {
            SubscribeMouse(_context.Mice[i]);
        }

        for (int i = 0; i < _context.Gamepads.Count; i++)
        {
            SubscribeGamepad(_context.Gamepads[i]);
        }

        _context.ConnectionChanged += OnConnectionChanged;
    }

    /// <summary>Subscribes one keyboard.</summary>
    /// <param name="keyboard">Silk keyboard.</param>
    private void SubscribeKeyboard(Silk.NET.Input.IKeyboard keyboard)
    {
        keyboard.KeyDown += OnKeyDown;
        keyboard.KeyUp += OnKeyUp;
        keyboard.KeyChar += OnKeyChar;
    }

    /// <summary>Subscribes one mouse.</summary>
    /// <param name="mouse">Silk mouse.</param>
    private void SubscribeMouse(Silk.NET.Input.IMouse mouse)
    {
        mouse.MouseDown += OnMouseDown;
        mouse.MouseUp += OnMouseUp;
        mouse.MouseMove += OnMouseMove;
        mouse.Scroll += OnScroll;
    }

    /// <summary>Forwards a key press.</summary>
    private void OnKeyDown(Silk.NET.Input.IKeyboard keyboard, SilkKey key, int scancode) =>
        _queue.TryWrite(RawInputEvent.CreateKeyDown(DeviceIndex.Primary, SilkInputMapping.ToKey(key), (ushort)scancode, InputTimestamp.Now()));

    /// <summary>Forwards a key release.</summary>
    private void OnKeyUp(Silk.NET.Input.IKeyboard keyboard, SilkKey key, int scancode) =>
        _queue.TryWrite(RawInputEvent.CreateKeyUp(DeviceIndex.Primary, SilkInputMapping.ToKey(key), (ushort)scancode, InputTimestamp.Now()));

    /// <summary>Forwards a typed character.</summary>
    private void OnKeyChar(Silk.NET.Input.IKeyboard keyboard, char character) =>
        _queue.TryWrite(RawInputEvent.CreateKeyChar(DeviceIndex.Primary, character, InputTimestamp.Now()));

    /// <summary>Forwards a mouse-button press.</summary>
    private void OnMouseDown(Silk.NET.Input.IMouse mouse, SilkMouseButton button)
    {
        _pointerLock?.OnMouseDown();
        if (SilkInputMapping.TryToMouseButton(button, out MouseButton mapped))
        {
            _queue.TryWrite(RawInputEvent.CreateMouseDown(DeviceIndex.Primary, mapped, InputTimestamp.Now()));
        }
    }

    /// <summary>Forwards a mouse-button release.</summary>
    private void OnMouseUp(Silk.NET.Input.IMouse mouse, SilkMouseButton button)
    {
        if (SilkInputMapping.TryToMouseButton(button, out MouseButton mapped))
        {
            _queue.TryWrite(RawInputEvent.CreateMouseUp(DeviceIndex.Primary, mapped, InputTimestamp.Now()));
        }
    }

    /// <summary>
    /// Forwards pointer motion. While the lock reports relative motion the position is turned into
    /// a delta against the previous reading and the absolute coordinate is never updated, because
    /// a locked cursor has no absolute coordinate worth hit-testing against.
    /// </summary>
    private void OnMouseMove(Silk.NET.Input.IMouse mouse, Vector2 position)
    {
        if (_pointerLock?.ReportsRelativeMotion is not true)
        {
            _hasLockedAnchor = false;
            _queue.TryWrite(RawInputEvent.CreateMouseMove(DeviceIndex.Primary, position.X, position.Y, InputTimestamp.Now()));
            return;
        }

        if (!_hasLockedAnchor)
        {
            _lockedAnchor = position;
            _hasLockedAnchor = true;
            return;
        }

        float deltaX = position.X - _lockedAnchor.X;
        float deltaY = position.Y - _lockedAnchor.Y;
        _lockedAnchor = position;
        _queue.TryWrite(RawInputEvent.CreateMouseDelta(DeviceIndex.Primary, deltaX, deltaY, InputTimestamp.Now()));
    }

    /// <summary>Forwards a wheel scroll.</summary>
    private void OnScroll(Silk.NET.Input.IMouse mouse, Silk.NET.Input.ScrollWheel wheel) =>
        _queue.TryWrite(RawInputEvent.CreateMouseScroll(DeviceIndex.Primary, wheel.X, wheel.Y, InputTimestamp.Now()));

    /// <summary>Subscribes one gamepad and feeds its connection.</summary>
    /// <param name="gamepad">Silk gamepad.</param>
    private void SubscribeGamepad(Silk.NET.Input.IGamepad gamepad)
    {
        gamepad.ButtonDown += OnGamepadButtonDown;
        gamepad.ButtonUp += OnGamepadButtonUp;
        gamepad.ThumbstickMoved += OnThumbstickMoved;
        gamepad.TriggerMoved += OnTriggerMoved;
        _queue.TryWrite(RawInputEvent.CreateGamepadConnection(GamepadSlot(gamepad), true, InputTimestamp.Now()));
    }

    /// <summary>Clamps a gamepad index to a slot.</summary>
    /// <param name="gamepad">Silk gamepad.</param>
    private static byte GamepadSlot(Silk.NET.Input.IGamepad gamepad) =>
        gamepad.Index < 0 || gamepad.Index > 3 ? (byte)0 : (byte)gamepad.Index;

    /// <summary>Forwards a gamepad-button press.</summary>
    private void OnGamepadButtonDown(Silk.NET.Input.IGamepad gamepad, Silk.NET.Input.Button button)
    {
        if (SilkInputMapping.TryToGamepadButton(button.Name, out ushort engine))
        {
            byte slot = GamepadSlot(gamepad);
            _queue.TryWrite(new RawInputEvent(InputTimestamp.Now(), RawInputType.GamepadButtonDown, (DeviceIndex)slot, engine));
        }
    }

    /// <summary>Forwards a gamepad-button release.</summary>
    private void OnGamepadButtonUp(Silk.NET.Input.IGamepad gamepad, Silk.NET.Input.Button button)
    {
        if (SilkInputMapping.TryToGamepadButton(button.Name, out ushort engine))
        {
            byte slot = GamepadSlot(gamepad);
            _queue.TryWrite(new RawInputEvent(InputTimestamp.Now(), RawInputType.GamepadButtonUp, (DeviceIndex)slot, engine));
        }
    }

    /// <summary>Forwards thumbstick axes.</summary>
    private void OnThumbstickMoved(Silk.NET.Input.IGamepad gamepad, Silk.NET.Input.Thumbstick stick)
    {
        byte slot = GamepadSlot(gamepad);
        if (stick.Index is < 0 or > 1)
        {
            return;
        }

        byte axis = (byte)(stick.Index * 2);
        _queue.TryWrite(RawInputEvent.CreateGamepadAxis((DeviceIndex)slot, axis, stick.X, InputTimestamp.Now()));
        _queue.TryWrite(RawInputEvent.CreateGamepadAxis((DeviceIndex)slot, (byte)(axis + 1), stick.Y, InputTimestamp.Now()));
    }

    /// <summary>Forwards a trigger axis.</summary>
    private void OnTriggerMoved(Silk.NET.Input.IGamepad gamepad, Silk.NET.Input.Trigger trigger)
    {
        byte slot = GamepadSlot(gamepad);
        if (trigger.Index is < 0 or > 1)
        {
            return;
        }

        _queue.TryWrite(RawInputEvent.CreateGamepadAxis((DeviceIndex)slot, (byte)(4 + trigger.Index), trigger.Position, InputTimestamp.Now()));
    }

    /// <summary>Tracks hot-plug connections.</summary>
    private void OnConnectionChanged(Silk.NET.Input.IInputDevice device, bool connected)
    {
        if (device is Silk.NET.Input.IGamepad gamepad)
        {
            _queue.TryWrite(RawInputEvent.CreateGamepadConnection(GamepadSlot(gamepad), connected, InputTimestamp.Now()));
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _pointerLock?.OnDisposed();
        for (int i = 0; i < _context.Keyboards.Count; i++)
        {
            Silk.NET.Input.IKeyboard keyboard = _context.Keyboards[i];
            keyboard.KeyDown -= OnKeyDown;
            keyboard.KeyUp -= OnKeyUp;
            keyboard.KeyChar -= OnKeyChar;
        }

        for (int i = 0; i < _context.Mice.Count; i++)
        {
            Silk.NET.Input.IMouse mouse = _context.Mice[i];
            mouse.MouseDown -= OnMouseDown;
            mouse.MouseUp -= OnMouseUp;
            mouse.MouseMove -= OnMouseMove;
            mouse.Scroll -= OnScroll;
        }

        for (int i = 0; i < _context.Gamepads.Count; i++)
        {
            Silk.NET.Input.IGamepad gamepad = _context.Gamepads[i];
            gamepad.ButtonDown -= OnGamepadButtonDown;
            gamepad.ButtonUp -= OnGamepadButtonUp;
            gamepad.ThumbstickMoved -= OnThumbstickMoved;
            gamepad.TriggerMoved -= OnTriggerMoved;
        }

        _context.ConnectionChanged -= OnConnectionChanged;
    }
}
