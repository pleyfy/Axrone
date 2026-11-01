namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Virtualized row/column grid with cell selection.</summary>
internal sealed class DataGridBehavior : ControlBehavior
{
    private const float WheelStep = 20.0f;

    public override ControlKind Kind => ControlKind.DataGrid;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(200.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int columns = entry.Grid?.ColumnCount ?? 0;
        var metrics = new float[columns + 1];
        for (int i = 0; i < columns; i++)
        {
            metrics[i + 1] = metrics[i] + MathF.Max(1.0f, entry.Grid!.GetColumnWidth(i));
        }

        entry.Metrics = metrics;
        entry.Index = Math.Clamp(definition.SelectedIndex, 0, Math.Max(0, (entry.Grid?.RowCount ?? 0) - 1));
        entry.CrossIndex = 0;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Primary)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                runtime.SetPointerInside(index, true);
                return false;
            case UiPointerPhase.Leave:
                runtime.SetPointerInside(index, false);
                return false;
            case UiPointerPhase.Down:
                if (args.Button != 0)
                {
                    return false;
                }

                runtime.SetPressed(index, true);
                SelectAt(runtime, index, args.Position.X, args.Position.Y);
                return true;
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (wasPressed)
                    {
                        runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
                    }

                    return wasPressed;
                }

            case UiPointerPhase.Wheel:
                return ScrollBy(runtime, index, -args.Delta.Y * WheelStep, args.Delta.X * WheelStep);
            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        int rows = entry.Grid?.RowCount ?? 0;
        int columns = Math.Max(0, (entry.Metrics?.Length ?? 1) - 1);
        if (rows == 0 || columns == 0)
        {
            return false;
        }

        switch (args.KeyCode)
        {
            case ControlKeys.Up:
                return Move(runtime, index, entry.Index - 1, entry.CrossIndex);
            case ControlKeys.Down:
                return Move(runtime, index, entry.Index + 1, entry.CrossIndex);
            case ControlKeys.Left:
                return Move(runtime, index, entry.Index, entry.CrossIndex - 1);
            case ControlKeys.Right:
                return Move(runtime, index, entry.Index, entry.CrossIndex + 1);
            case ControlKeys.Home:
                return Move(runtime, index, 0, 0);
            case ControlKeys.End:
                return Move(runtime, index, rows - 1, columns - 1);
            case ControlKeys.Enter:
                runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
                return true;
            default:
                return false;
        }
    }

    private static void SelectAt(UiControlRuntime runtime, int index, float pointerX, float pointerY)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int rows = entry.Grid?.RowCount ?? 0;
        if (rows == 0 || !runtime.TryGetBounds(entry.Node, out Rect box) || entry.Metrics is not { Length: > 1 } metrics)
        {
            return;
        }

        float rowHeight = runtime.RowHeight();
        int row = Math.Clamp((int)MathF.Floor((pointerY - box.Y + entry.ScrollOffset) / rowHeight), 0, rows - 1);
        int column = ColumnAt(metrics, pointerX - box.X + entry.CrossOffset);
        Move(runtime, index, row, column);
    }

    private static int ColumnAt(float[] cumulative, float x)
    {
        int low = 0;
        int high = cumulative.Length - 2;
        while (low <= high)
        {
            int mid = low + ((high - low) >> 1);
            if (x < cumulative[mid])
            {
                high = mid - 1;
            }
            else if (x >= cumulative[mid + 1])
            {
                low = mid + 1;
            }
            else
            {
                return mid;
            }
        }

        return Math.Clamp(low, 0, cumulative.Length - 2);
    }

    private static bool Move(UiControlRuntime runtime, int index, int row, int column)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int rows = entry.Grid?.RowCount ?? 0;
        int columns = Math.Max(0, (entry.Metrics?.Length ?? 1) - 1);
        if (rows == 0 || columns == 0)
        {
            return false;
        }

        int nextRow = Math.Clamp(row, 0, rows - 1);
        int nextColumn = Math.Clamp(column, 0, columns - 1);
        if (nextRow != entry.Index || nextColumn != entry.CrossIndex)
        {
            entry.Index = nextRow;
            entry.CrossIndex = nextColumn;
            runtime.ApplySelection(index);
        }

        EnsureVisible(runtime, index);
        return true;
    }

    private static void EnsureVisible(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box) || entry.Metrics is not { Length: > 1 } metrics)
        {
            return;
        }

        float rowHeight = runtime.RowHeight();
        float top = entry.Index * rowHeight;
        float bottom = top + rowHeight;
        float nextVertical = entry.ScrollOffset;
        if (top < entry.ScrollOffset)
        {
            nextVertical = top;
        }
        else if (bottom > entry.ScrollOffset + box.Height)
        {
            nextVertical = bottom - box.Height;
        }

        float left = metrics[entry.CrossIndex];
        float right = metrics[entry.CrossIndex + 1];
        float nextHorizontal = entry.CrossOffset;
        if (left < entry.CrossOffset)
        {
            nextHorizontal = left;
        }
        else if (right > entry.CrossOffset + box.Width)
        {
            nextHorizontal = right - box.Width;
        }

        bool changed = nextVertical != entry.ScrollOffset || nextHorizontal != entry.CrossOffset;
        entry.ScrollOffset = MathF.Max(0.0f, nextVertical);
        entry.CrossOffset = MathF.Max(0.0f, nextHorizontal);
        if (changed)
        {
            runtime.Emit(index, UiControlEventKind.ScrollChanged, entry.ScrollOffset, entry.Checked, entry.Index, null);
            runtime.InvalidateVisual(index);
        }
    }

    private static bool ScrollBy(UiControlRuntime runtime, int index, float vertical, float horizontal)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int rows = entry.Grid?.RowCount ?? 0;
        if (rows == 0 || !runtime.TryGetBounds(entry.Node, out Rect box) || entry.Metrics is not { Length: > 1 } metrics)
        {
            return false;
        }

        float maxVertical = MathF.Max(0.0f, (rows * runtime.RowHeight()) - box.Height);
        float maxHorizontal = MathF.Max(0.0f, metrics[^1] - box.Width);
        float nextVertical = Math.Clamp(entry.ScrollOffset + vertical, 0.0f, maxVertical);
        float nextHorizontal = Math.Clamp(entry.CrossOffset + horizontal, 0.0f, maxHorizontal);
        if (nextVertical == entry.ScrollOffset && nextHorizontal == entry.CrossOffset)
        {
            return false;
        }

        entry.ScrollOffset = nextVertical;
        entry.CrossOffset = nextHorizontal;
        runtime.Emit(index, UiControlEventKind.ScrollChanged, nextVertical, entry.Checked, entry.Index, null);
        runtime.InvalidateVisual(index);
        return true;
    }
}

/// <summary>Calendar date selector with month navigation and a seven-column grid.</summary>
internal sealed class DatePickerBehavior : ControlBehavior
{
    private const int Columns = 7;
    private const int Rows = 6;

    public override ControlKind Kind => ControlKind.DatePicker;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Px(280.0f),
            Height = UiLength.Px(240.0f),
            Padding = new UiEdgeInsets(4.0f, 4.0f, 4.0f, 4.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        float packed = definition.Value > 0.0f ? definition.Value : UiDateCodec.Pack(2026, 1, 1);
        UiDateCodec.Unpack(packed, out int year, out int month, out int day);
        year = Math.Clamp(year, 1, 9999);
        month = Math.Clamp(month, 1, 12);
        day = Math.Clamp(day, 1, DateTime.DaysInMonth(year, month));
        entry.Value = packed;
        entry.Index = day;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Primary)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                runtime.SetPointerInside(index, true);
                return false;
            case UiPointerPhase.Leave:
                runtime.SetPointerInside(index, false);
                return false;
            case UiPointerPhase.Down:
                if (args.Button != 0 || !runtime.TryGetBounds(entry.Node, out Rect box))
                {
                    return false;
                }

                runtime.SetPressed(index, true);
                UiDateCodec.Unpack(entry.Value, out int year, out int month, out _);
                float headerHeight = runtime.RowHeight();
                if (args.Position.Y - box.Y < headerHeight)
                {
                    ShiftMonth(runtime, index, args.Position.X - box.X < box.Width * 0.5f ? -1 : 1);
                    return true;
                }

                float cellWidth = box.Width / Columns;
                float cellHeight = MathF.Max(1.0f, (box.Height - headerHeight) / Rows);
                int column = Math.Clamp((int)MathF.Floor((args.Position.X - box.X) / cellWidth), 0, Columns - 1);
                int row = Math.Clamp((int)MathF.Floor((args.Position.Y - box.Y - headerHeight) / cellHeight), 0, Rows - 1);
                int leading = (int)new DateTime(year, month, 1).DayOfWeek;
                int day = (row * Columns) + column - leading + 1;
                int days = DateTime.DaysInMonth(year, month);
                if (day >= 1 && day <= days)
                {
                    SetDate(runtime, index, year, month, day);
                }

                return true;
            case UiPointerPhase.Up:
                return runtime.SetPressed(index, false);
            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        UiDateCodec.Unpack(entry.Value, out int year, out int month, out int day);
        switch (args.KeyCode)
        {
            case ControlKeys.Left:
                return SetDate(runtime, index, year, month, day - 1);
            case ControlKeys.Right:
                return SetDate(runtime, index, year, month, day + 1);
            case ControlKeys.Up:
                return SetDate(runtime, index, year, month, day - 7);
            case ControlKeys.Down:
                return SetDate(runtime, index, year, month, day + 7);
            case ControlKeys.PageUp:
                return ShiftMonth(runtime, index, -1);
            case ControlKeys.PageDown:
                return ShiftMonth(runtime, index, 1);
            case ControlKeys.Home:
                return SetDate(runtime, index, year, month, 1);
            case ControlKeys.End:
                return SetDate(runtime, index, year, month, DateTime.DaysInMonth(year, month));
            default:
                return false;
        }
    }

    private static bool ShiftMonth(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        UiDateCodec.Unpack(entry.Value, out int year, out int month, out int day);
        int code = (year * 12) + (month - 1) + delta;
        int nextYear = Math.Clamp(code / 12, 1, 9999);
        int nextMonth = code % 12;
        if (nextMonth < 0)
        {
            nextMonth += 12;
            nextYear--;
        }

        nextMonth++;
        int nextDay = Math.Clamp(day, 1, DateTime.DaysInMonth(nextYear, nextMonth));
        return SetDate(runtime, index, nextYear, nextMonth, nextDay);
    }

    private static bool SetDate(UiControlRuntime runtime, int index, int year, int month, int day)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int code = (year * 12) + (month - 1);
        int days = DateTime.DaysInMonth(year, month);
        int normalizedDay = day;
        int normalizedCode = code;
        if (day < 1)
        {
            normalizedCode--;
            int priorYear = Math.Clamp(normalizedCode / 12, 1, 9999);
            int priorMonth = normalizedCode % 12;
            if (priorMonth < 0)
            {
                priorMonth += 12;
                priorYear--;
            }

            normalizedDay = DateTime.DaysInMonth(priorYear, priorMonth + 1);
            year = priorYear;
            month = priorMonth + 1;
        }
        else if (day > days)
        {
            normalizedCode++;
            int nextYear = Math.Clamp(normalizedCode / 12, 1, 9999);
            int nextMonth = normalizedCode % 12;
            if (nextMonth < 0)
            {
                nextMonth += 12;
                nextYear--;
            }

            normalizedDay = 1;
            year = nextYear;
            month = nextMonth + 1;
        }

        float packed = UiDateCodec.Pack(year, month, normalizedDay);
        if (packed == entry.Value)
        {
            return false;
        }

        entry.Value = packed;
        entry.Index = normalizedDay;
        runtime.InvalidateVisual(index);
        runtime.Emit(index, UiControlEventKind.ValueChanged, packed, entry.Checked, entry.Index, null);
        return true;
    }
}

/// <summary>HSV/alpha color picker writing a packed RGBA integer.</summary>
internal sealed class ColorPickerBehavior : ControlBehavior
{
    private const float ValueStep = 1.0f / 32.0f;

    public override ControlKind Kind => ControlKind.ColorPicker;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(160.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Index = UiColorCodec.Pack(255, 255, 255, 255);
        entry.Value = 1.0f;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Primary)
        {
            return false;
        }

        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                runtime.SetPointerInside(index, true);
                return false;
            case UiPointerPhase.Leave:
                runtime.SetPointerInside(index, false);
                return false;
            case UiPointerPhase.Down:
                if (args.Button != 0)
                {
                    return false;
                }

                runtime.SetPressed(index, true);
                Update(runtime, index, args.Position.X, args.Position.Y);
                return true;
            case UiPointerPhase.Move:
                return runtime.Entry(index).Pressed && Update(runtime, index, args.Position.X, args.Position.Y);
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (wasPressed)
                    {
                        runtime.Emit(index, UiControlEventKind.ValueCommitted, runtime.Entry(index).Value, false, -1, null);
                    }

                    return wasPressed;
                }

            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        UiColorCodec.Unpack(entry.Index, out byte r, out byte g, out byte b, out byte a);
        RgbToHsv(r, g, b, out float hue, out float saturation, out float value);
        float alpha = a / 255.0f;
        switch (args.KeyCode)
        {
            case ControlKeys.Left:
                hue = Wrap(hue - 5.0f, 360.0f);
                break;
            case ControlKeys.Right:
                hue = Wrap(hue + 5.0f, 360.0f);
                break;
            case ControlKeys.Up:
                value = Math.Clamp(value + ValueStep, 0.0f, 1.0f);
                break;
            case ControlKeys.Down:
                value = Math.Clamp(value - ValueStep, 0.0f, 1.0f);
                break;
            case ControlKeys.Home:
                alpha = 0.0f;
                break;
            case ControlKeys.End:
                alpha = 1.0f;
                break;
            default:
                return false;
        }

        Apply(runtime, index, hue, saturation, value, alpha);
        runtime.Emit(index, UiControlEventKind.ValueCommitted, alpha, false, -1, null);
        return true;
    }

    private static bool Update(UiControlRuntime runtime, int index, float pointerX, float pointerY)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box) || box.Width <= 0.0f || box.Height <= 0.0f)
        {
            return false;
        }

        UiColorCodec.Unpack(entry.Index, out byte r, out byte g, out byte b, out byte a);
        RgbToHsv(r, g, b, out float hue, out float saturation, out float value);
        float alpha = a / 255.0f;
        float x = (pointerX - box.X) / box.Width;
        float y = Math.Clamp((pointerY - box.Y) / box.Height, 0.0f, 1.0f);
        if (x < 0.75f)
        {
            saturation = Math.Clamp(x / 0.75f, 0.0f, 1.0f);
            value = 1.0f - y;
        }
        else if (x < 0.875f)
        {
            hue = Wrap(y * 360.0f, 360.0f);
        }
        else
        {
            alpha = 1.0f - y;
        }

        return Apply(runtime, index, hue, saturation, value, alpha);
    }

    private static bool Apply(
        UiControlRuntime runtime,
        int index,
        float hue,
        float saturation,
        float value,
        float alpha)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        HsvToRgb(hue, saturation, value, out byte r, out byte g, out byte b);
        byte a = (byte)Math.Clamp((int)MathF.Round(alpha * 255.0f), 0, 255);
        int packed = UiColorCodec.Pack(r, g, b, a);
        if (packed == entry.Index && alpha == entry.Value)
        {
            return false;
        }

        entry.Index = packed;
        entry.Value = alpha;
        runtime.InvalidateVisual(index);
        runtime.Emit(index, UiControlEventKind.ValueChanged, alpha, false, -1, null);
        return true;
    }

    private static float Wrap(float value, float maximum)
    {
        float wrapped = value % maximum;
        return wrapped < 0.0f ? wrapped + maximum : wrapped;
    }

    private static void RgbToHsv(byte r, byte g, byte b, out float hue, out float saturation, out float value)
    {
        float rf = r / 255.0f;
        float gf = g / 255.0f;
        float bf = b / 255.0f;
        float max = MathF.Max(rf, MathF.Max(gf, bf));
        float min = MathF.Min(rf, MathF.Min(gf, bf));
        float delta = max - min;
        value = max;
        saturation = max <= 0.0f ? 0.0f : delta / max;
        if (delta <= 0.0f)
        {
            hue = 0.0f;
        }
        else if (max == rf)
        {
            hue = 60.0f * (((gf - bf) / delta) % 6.0f);
        }
        else if (max == gf)
        {
            hue = 60.0f * (((bf - rf) / delta) + 2.0f);
        }
        else
        {
            hue = 60.0f * (((rf - gf) / delta) + 4.0f);
        }

        if (hue < 0.0f)
        {
            hue += 360.0f;
        }
    }

    private static void HsvToRgb(float hue, float saturation, float value, out byte r, out byte g, out byte b)
    {
        float c = value * saturation;
        float h = hue / 60.0f;
        float x = c * (1.0f - MathF.Abs((h % 2.0f) - 1.0f));
        float m = value - c;
        float rf;
        float gf;
        float bf;
        if (h < 1.0f)
        {
            rf = c;
            gf = x;
            bf = 0.0f;
        }
        else if (h < 2.0f)
        {
            rf = x;
            gf = c;
            bf = 0.0f;
        }
        else if (h < 3.0f)
        {
            rf = 0.0f;
            gf = c;
            bf = x;
        }
        else if (h < 4.0f)
        {
            rf = 0.0f;
            gf = x;
            bf = c;
        }
        else if (h < 5.0f)
        {
            rf = x;
            gf = 0.0f;
            bf = c;
        }
        else
        {
            rf = c;
            gf = 0.0f;
            bf = x;
        }

        r = (byte)Math.Clamp((int)MathF.Round((rf + m) * 255.0f), 0, 255);
        g = (byte)Math.Clamp((int)MathF.Round((gf + m) * 255.0f), 0, 255);
        b = (byte)Math.Clamp((int)MathF.Round((bf + m) * 255.0f), 0, 255);
    }
}

/// <summary>Packs calendar dates into the float carried by date controls.</summary>
public static class UiDateCodec
{
    /// <summary>Packs a year, one-based month and day.</summary>
    public static float Pack(int year, int month, int day) =>
        (((year * 12) + (month - 1)) * 100) + day;

    /// <summary>Unpacks a packed date.</summary>
    public static void Unpack(float packed, out int year, out int month, out int day)
    {
        int code = (int)packed / 100;
        day = (int)packed % 100;
        year = code / 12;
        month = (code % 12) + 1;
    }
}
