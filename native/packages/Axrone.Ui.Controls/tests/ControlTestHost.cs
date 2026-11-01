namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

internal sealed class TestTextMeasurer : IUiTextMeasurer
{
    public float CharWidth { get; set; } = 8.0f;

    public float LineHeight { get; set; } = 16.0f;

    public UiTextMetrics Measure(ReadOnlySpan<char> text, in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        float scale = style.Size > 0.0f ? style.Size / 15.0f : 1.0f;
        int lines = 1;
        float widest = 0.0f;
        float current = 0.0f;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                lines++;
                widest = MathF.Max(widest, current);
                current = 0.0f;
            }
            else
            {
                current += CharWidth * scale;
            }
        }

        widest = MathF.Max(widest, current);
        float height = lines * LineHeight * scale;
        if (float.IsFinite(constraints.MaxWidth))
        {
            widest = MathF.Min(widest, MathF.Max(0.0f, constraints.MaxWidth));
        }

        if (float.IsFinite(constraints.MaxHeight))
        {
            height = MathF.Min(height, MathF.Max(0.0f, constraints.MaxHeight));
        }

        return new UiTextMetrics(widest, height, LineHeight * scale, LineHeight * scale * 0.8f, lines, false);
    }
}

internal sealed class TestImageMetrics : IUiImageMetrics
{
    private readonly Dictionary<UiResourceId, UiSize> _sizes = new();

    public void Set(UiResourceId image, float width, float height) =>
        _sizes[image] = new UiSize(width, height);

    public bool TryGetSize(UiResourceId image, out UiSize size) => _sizes.TryGetValue(image, out size);
}

internal sealed class RecordingControlSink : IUiControlEventSink
{
    public List<UiControlEvent> Events { get; } = [];

    public void OnControlEvent(in UiControlEvent args) => Events.Add(args);

    public void Clear() => Events.Clear();

    public int Count(UiControlEventKind kind)
    {
        int count = 0;
        for (int i = 0; i < Events.Count; i++)
        {
            if (Events[i].EventKind == kind)
            {
                count++;
            }
        }

        return count;
    }

    public UiControlEvent Last(UiControlEventKind kind) => Events.FindLast(e => e.EventKind == kind);
}

internal sealed class CountingControlSink : IUiControlEventSink
{
    public int Count { get; private set; }

    public int Clicks { get; private set; }

    public void OnControlEvent(in UiControlEvent args)
    {
        Count++;
        if (args.EventKind == UiControlEventKind.Click)
        {
            Clicks++;
        }
    }
}

internal sealed class ControlHost
{
    public static readonly UiTextStyle DefaultTextStyle = new(
        new UiFontFaceId(1),
        15.0f,
        0.0f,
        0.0f,
        UiTextWrap.None,
        UiTextOverflow.Clip,
        UiTextAlign.Start,
        UiTextDirection.Ltr,
        1);

    public static readonly UiViewport DefaultViewport = new(new UiSize(400.0f, 400.0f));

    public ControlHost(IUiControlEventSink? events = null, IUiImageMetrics? images = null, IUiTextMeasurer? measurer = null)
    {
        Runtime = new UiControlRuntime(new UiControlRuntimeOptions(
            TextMeasurer: measurer ?? new TestTextMeasurer(),
            Events: events,
            Images: images,
            Theme: UiControlTheme.CreateDefaultTheme(),
            ThemeTokens: UiControlTheme.Default,
            DefaultTextStyle: DefaultTextStyle,
            Viewport: DefaultViewport));
    }

    public UiControlRuntime Runtime { get; }

    public UiControl Create(
        ControlKind kind,
        string? text = null,
        UiControl parent = default,
        float value = 0.0f,
        int index = 0,
        bool isChecked = false,
        UiResourceId image = default,
        float min = 0.0f,
        float max = 1.0f,
        float step = 0.1f)
    {
        var definition = new UiControlDefinition(
            Text: text,
            Image: image,
            Value: value,
            Checked: isChecked,
            SelectedIndex: index,
            MinValue: min,
            MaxValue: max,
            Step: step);
        return parent.IsValid
            ? Runtime.CreateControl(kind, in definition, parent)
            : Runtime.CreateControl(kind, in definition);
    }

    public void Layout() => Runtime.UpdateLayout(DefaultViewport);

    public bool Pointer(UiPointerPhase phase, float x, float y)
    {
        var args = new UiPointerEvent(
            UiNodeId.Invalid,
            phase,
            new Vec2(x, y),
            Vec2.Zero,
            PointerId: 0,
            Button: phase is UiPointerPhase.Down or UiPointerPhase.Up ? 0 : -1,
            UiPointerButtons.Left,
            UiKeyModifiers.None,
            Timestamp: 0);
        return Runtime.DispatchPointer(in args);
    }

    public bool Wheel(float x, float y, float deltaY)
    {
        var args = new UiPointerEvent(
            UiNodeId.Invalid,
            UiPointerPhase.Wheel,
            new Vec2(x, y),
            new Vec2(0.0f, deltaY),
            PointerId: 0,
            Button: -1,
            UiPointerButtons.None,
            UiKeyModifiers.None,
            Timestamp: 0);
        return Runtime.DispatchPointer(in args);
    }

    public void Click(float x = 10.0f, float y = 10.0f)
    {
        Pointer(UiPointerPhase.Move, x, y);
        Pointer(UiPointerPhase.Down, x, y);
        Pointer(UiPointerPhase.Up, x, y);
    }

    public bool Key(ushort code, bool shift = false)
    {
        var args = new UiKeyEvent(UiNodeId.Invalid, UiKeyPhase.Down, code, false, shift ? UiKeyModifiers.Shift : UiKeyModifiers.None, 0);
        return Runtime.DispatchKey(in args);
    }

    public bool Text(string value)
    {
        var args = new UiTextInputEvent(UiNodeId.Invalid, value, false, null);
        return Runtime.DispatchText(in args);
    }

    public bool TryGetBounds(UiControl control, out Rect bounds) => Runtime.TryGetBounds(control.Node, out bounds);
}
