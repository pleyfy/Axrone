namespace Axrone.Lighting;

/// <summary>Cache topology constants.</summary>
public static class CacheTopology
{
    /// <summary>Cache line size in bytes.</summary>
    public const int CacheLineSize = 64;

    /// <summary>Double cache line size in bytes.</summary>
    public const int DoubleCacheLineSize = 128;
}

/// <summary>Nominal light identity.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct LightId(ulong Value) :
    IEquatable<LightId>,
    IComparable<LightId>,
    IComparisonOperators<LightId, LightId, bool>
{
    /// <summary>Creates an identity.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static LightId From(ulong value) => new(value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(LightId other) => Value == other.Value;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(LightId other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public override string ToString() => $"LightId({Value.ToString(CultureInfo.InvariantCulture)})";

    /// <inheritdoc/>
    public static bool operator <(LightId left, LightId right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(LightId left, LightId right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(LightId left, LightId right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(LightId left, LightId right) => left.Value >= right.Value;
}

/// <summary>Nominal rig identity.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct RigId(ulong Value) :
    IEquatable<RigId>,
    IComparable<RigId>,
    IComparisonOperators<RigId, RigId, bool>
{
    /// <summary>Creates an identity.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RigId From(ulong value) => new(value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(RigId other) => Value == other.Value;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(RigId other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public override string ToString() => $"RigId({Value.ToString(CultureInfo.InvariantCulture)})";

    /// <inheritdoc/>
    public static bool operator <(RigId left, RigId right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(RigId left, RigId right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(RigId left, RigId right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(RigId left, RigId right) => left.Value >= right.Value;
}

/// <summary>Monotonic rig version.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct RigVersion(ulong Value) :
    IEquatable<RigVersion>,
    IComparable<RigVersion>,
    IComparisonOperators<RigVersion, RigVersion, bool>
{
    /// <summary>Initial version.</summary>
    public static readonly RigVersion Initial = new(1);

    /// <summary>Next version.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public RigVersion Next() => new(Value + 1);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(RigVersion other) => Value == other.Value;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(RigVersion other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public override string ToString() => $"RigVersion({Value.ToString(CultureInfo.InvariantCulture)})";

    /// <inheritdoc/>
    public static bool operator <(RigVersion left, RigVersion right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(RigVersion left, RigVersion right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(RigVersion left, RigVersion right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(RigVersion left, RigVersion right) => left.Value >= right.Value;
}

/// <summary>Validated light priority.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct LightPriority :
    IEquatable<LightPriority>,
    IComparable<LightPriority>,
    IComparisonOperators<LightPriority, LightPriority, bool>
{
    /// <summary>Priority value.</summary>
    public readonly float Value;

    /// <summary>Zero priority.</summary>
    public static readonly LightPriority Zero = new(0.0f);

    /// <summary>Creates a priority.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public LightPriority(float value)
    {
        if (!LightingGuards.IsFinite(value))
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-priority", "Priority must be finite.");
        }

        Value = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(LightPriority other) => Value.Equals(other.Value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(LightPriority other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public static bool operator <(LightPriority left, LightPriority right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(LightPriority left, LightPriority right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(LightPriority left, LightPriority right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(LightPriority left, LightPriority right) => left.Value >= right.Value;
}

/// <summary>Validated non-negative light intensity.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct LightIntensity :
    IEquatable<LightIntensity>,
    IComparable<LightIntensity>,
    IComparisonOperators<LightIntensity, LightIntensity, bool>
{
    /// <summary>Intensity value.</summary>
    public readonly float Value;

    /// <summary>Default intensity.</summary>
    public static readonly LightIntensity Default = new(1.0f);

    /// <summary>Creates an intensity.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public LightIntensity(float value)
    {
        if (!LightingGuards.IsFinite(value) || value < 0.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.light.out-of-range", "Intensity must be non-negative and finite.");
        }

        Value = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(LightIntensity other) => Value.Equals(other.Value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(LightIntensity other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public static bool operator <(LightIntensity left, LightIntensity right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(LightIntensity left, LightIntensity right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(LightIntensity left, LightIntensity right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(LightIntensity left, LightIntensity right) => left.Value >= right.Value;
}

/// <summary>Validated strictly-positive light range.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct LightRange :
    IEquatable<LightRange>,
    IComparable<LightRange>,
    IComparisonOperators<LightRange, LightRange, bool>
{
    /// <summary>Range value.</summary>
    public readonly float Value;

    /// <summary>Default range.</summary>
    public static readonly LightRange Default = new(8.0f);

    /// <summary>Creates a range.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public LightRange(float value)
    {
        if (!LightingGuards.IsFinite(value) || value <= 0.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.light.out-of-range", "Range must be strictly positive and finite.");
        }

        Value = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(LightRange other) => Value.Equals(other.Value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(LightRange other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public static bool operator <(LightRange left, LightRange right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(LightRange left, LightRange right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(LightRange left, LightRange right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(LightRange left, LightRange right) => left.Value >= right.Value;
}

/// <summary>Validated non-negative attenuation factor.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AttenuationFactor :
    IEquatable<AttenuationFactor>,
    IComparable<AttenuationFactor>,
    IComparisonOperators<AttenuationFactor, AttenuationFactor, bool>
{
    /// <summary>Attenuation value.</summary>
    public readonly float Value;

    /// <summary>Default attenuation.</summary>
    public static readonly AttenuationFactor Default = new(2.0f);

    /// <summary>Creates an attenuation factor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public AttenuationFactor(float value)
    {
        if (!LightingGuards.IsFinite(value) || value < 0.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.light.out-of-range", "Attenuation must be non-negative and finite.");
        }

        Value = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(AttenuationFactor other) => Value.Equals(other.Value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(AttenuationFactor other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public static bool operator <(AttenuationFactor left, AttenuationFactor right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(AttenuationFactor left, AttenuationFactor right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(AttenuationFactor left, AttenuationFactor right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(AttenuationFactor left, AttenuationFactor right) => left.Value >= right.Value;
}

/// <summary>Validated spot cone cosine in [0, 1].</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ConeCosine :
    IEquatable<ConeCosine>,
    IComparable<ConeCosine>,
    IComparisonOperators<ConeCosine, ConeCosine, bool>
{
    /// <summary>Cone cosine value.</summary>
    public readonly float Value;

    /// <summary>Default inner cone cosine.</summary>
    public static readonly ConeCosine DefaultInner = new(MathF.Cos(MathF.PI / 8.0f));

    /// <summary>Default outer cone cosine.</summary>
    public static readonly ConeCosine DefaultOuter = new(MathF.Cos(MathF.PI / 4.0f));

    /// <summary>Creates a cone cosine.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ConeCosine(float value)
    {
        if (!LightingGuards.IsFinite(value) || value < 0.0f || value > 1.0f)
        {
            ThrowHelper.ThrowValidationError("lighting.light.invalid-cone", "Cone cosine must be bounded within [0, 1].");
        }

        Value = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(ConeCosine other) => Value.Equals(other.Value);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(ConeCosine other) => Value.CompareTo(other.Value);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public static bool operator <(ConeCosine left, ConeCosine right) => left.Value < right.Value;

    /// <inheritdoc/>
    public static bool operator <=(ConeCosine left, ConeCosine right) => left.Value <= right.Value;

    /// <inheritdoc/>
    public static bool operator >(ConeCosine left, ConeCosine right) => left.Value > right.Value;

    /// <inheritdoc/>
    public static bool operator >=(ConeCosine left, ConeCosine right) => left.Value >= right.Value;
}
