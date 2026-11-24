namespace Axrone.Scene;

/// <summary>
/// 128-bit presence mask over data component types. Two words are enough for
/// the built-in scene profile plus a large user extension budget, and keep the
/// mask register-sized for entity-table scans.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct SceneComponentMask(ulong Low, ulong High) :
    IEquatable<SceneComponentMask>
{
    /// <summary>Number of component slots representable by the mask.</summary>
    public const int Capacity = 128;

    /// <summary>Empty mask.</summary>
    public static SceneComponentMask Empty
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => default;
    }

    /// <summary>Whether no component bit is set.</summary>
    public bool IsEmpty
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => (Low | High) == 0UL;
    }

    /// <summary>Whether <paramref name="typeId"/> is present.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsSet(SceneComponentTypeId typeId)
    {
        uint index = typeId.Value;
        if (index >= Capacity)
        {
            return false;
        }

        return index < 64U
            ? ((Low >> (int)index) & 1UL) != 0UL
            : ((High >> (int)(index - 64U)) & 1UL) != 0UL;
    }

    /// <summary>Returns a mask with <paramref name="typeId"/> set.</summary>
    /// <exception cref="SceneValidationException">The type id exceeds the mask capacity.</exception>
    public SceneComponentMask With(SceneComponentTypeId typeId)
    {
        uint index = typeId.Value;
        if (index >= Capacity)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ComponentLimit,
                $"Component type id {index} exceeds the {Capacity}-slot presence mask.");
        }

        return index < 64U
            ? this with { Low = Low | (1UL << (int)index) }
            : this with { High = High | (1UL << (int)(index - 64U)) };
    }

    /// <summary>Returns a mask with <paramref name="typeId"/> cleared.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneComponentMask Without(SceneComponentTypeId typeId)
    {
        uint index = typeId.Value;
        if (index >= Capacity)
        {
            return this;
        }

        return index < 64U
            ? this with { Low = Low & ~(1UL << (int)index) }
            : this with { High = High & ~(1UL << (int)(index - 64U)) };
    }

    /// <summary>Whether every bit in <paramref name="required"/> is present.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool ContainsAll(in SceneComponentMask required) =>
        (Low & required.Low) == required.Low &&
        (High & required.High) == required.High;

    /// <summary>Whether any bit in <paramref name="other"/> is present.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Intersects(in SceneComponentMask other) =>
        (Low & other.Low) != 0UL || (High & other.High) != 0UL;

    /// <summary>Intersection of two masks.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneComponentMask operator &(in SceneComponentMask left, in SceneComponentMask right) =>
        new(left.Low & right.Low, left.High & right.High);

    /// <summary>Union of two masks.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneComponentMask operator |(in SceneComponentMask left, in SceneComponentMask right) =>
        new(left.Low | right.Low, left.High | right.High);

    /// <summary>Symmetric difference of two masks.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneComponentMask operator ^(in SceneComponentMask left, in SceneComponentMask right) =>
        new(left.Low ^ right.Low, left.High ^ right.High);

    /// <summary>Complement of a mask.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneComponentMask operator ~(in SceneComponentMask value) =>
        new(~value.Low, ~value.High);

    /// <inheritdoc/>
    public override string ToString() => string.Create(
        CultureInfo.InvariantCulture,
        $"SceneComponentMask[{High:X16}:{Low:X16}]");
}
