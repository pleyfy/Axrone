namespace Axrone.Physics2D;

using Axrone.Utility.Identifiers;

/// <summary>Domain metadata tag for simulated bodies (1-based; zero is invalid).</summary>
public readonly struct BodyTag : IIdentifierTag<BodyTag>
{
    /// <inheritdoc/>
    public static string TagName => "Body";

    /// <inheritdoc/>
    public static string Prefix => "b";

    /// <inheritdoc/>
    public static bool IsOneBased => true;
}

/// <summary>Domain metadata tag for attached colliders (1-based; zero is invalid).</summary>
public readonly struct ShapeTag : IIdentifierTag<ShapeTag>
{
    /// <inheritdoc/>
    public static string TagName => "Shape";

    /// <inheritdoc/>
    public static string Prefix => "s";

    /// <inheritdoc/>
    public static bool IsOneBased => true;
}

/// <summary>
/// 4-byte identity of a simulated body. The zero value is the invalid
/// sentinel, so a default-initialized slot can never name a live body.
/// Backed by the centralized identifier engine.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct BodyId(StrongId<BodyTag, uint> Handle) : IStrongId<BodyId, uint>
{
    /// <summary>Invalid sentinel; never a registered body.</summary>
    public static BodyId Invalid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(StrongId<BodyTag, uint>.Invalid);
    }

    /// <summary>The backing value.</summary>
    public uint RawValue
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Handle.RawValue;
    }

    /// <summary>Whether this identity names a registered body.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Handle.IsValid;
    }

    /// <summary>Wraps a raw value without validation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static BodyId FromRaw(uint value) => new(StrongId<BodyTag, uint>.FromRaw(value));

    /// <summary>Converts a 0-based slot index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static BodyId FromIndex(int index) => new(StrongId<BodyTag, uint>.FromIndex(index));

    /// <summary>Converts back to a 0-based slot index, or -1 while invalid.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int ToIndex() => Handle.ToIndex();

    /// <summary>Converts a 1-based identity to its 0-based slot index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SlotIndex ToSlotIndex() => IsValid ? SlotIndex.FromIndex(ToIndex()) : SlotIndex.Invalid;

    /// <summary>Wraps a 0-based slot index as a 1-based identity.</summary>
    /// <param name="slot">The slot index.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static BodyId FromSlotIndex(SlotIndex slot) => FromIndex(slot.ToIndex());

    /// <summary>Wraps an engine handle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator StrongId<BodyTag, uint>(BodyId id) => id.Handle;

    /// <summary>Unwraps an engine handle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator BodyId(StrongId<BodyTag, uint> handle) => new(handle);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int CompareTo(BodyId other) => Handle.CompareTo(other.Handle);

    /// <summary>Determines whether the left identity sorts before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(BodyId left, BodyId right) => left.Handle < right.Handle;

    /// <summary>Determines whether the left identity sorts after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(BodyId left, BodyId right) => left.Handle > right.Handle;

    /// <summary>Determines whether the left identity sorts at or before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(BodyId left, BodyId right) => left.Handle <= right.Handle;

    /// <summary>Determines whether the left identity sorts at or after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(BodyId left, BodyId right) => left.Handle >= right.Handle;

    /// <inheritdoc/>
    public bool TryFormat(
        Span<char> destination,
        out int charsWritten,
        ReadOnlySpan<char> format = default,
        IFormatProvider? provider = null)
    {
        if (!IsValid)
        {
            ReadOnlySpan<char> invalid = "Body(Invalid)";
            if (destination.Length < invalid.Length)
            {
                charsWritten = 0;
                return false;
            }

            invalid.CopyTo(destination);
            charsWritten = invalid.Length;
            return true;
        }

        if (destination.Length < 7)
        {
            charsWritten = 0;
            return false;
        }

        "Body(".AsSpan().CopyTo(destination);
        if (RawValue.TryFormat(destination.Slice(5), out int valueChars, format, provider) &&
            5 + valueChars < destination.Length)
        {
            destination[5 + valueChars] = ')';
            charsWritten = 6 + valueChars;
            return true;
        }

        charsWritten = 0;
        return false;
    }

    /// <inheritdoc/>
    public bool TryFormat(
        Span<byte> utf8Destination,
        out int bytesWritten,
        ReadOnlySpan<char> format = default,
        IFormatProvider? provider = null)
    {
        if (utf8Destination.Length < 7)
        {
            bytesWritten = 0;
            return false;
        }

        utf8Destination[0] = (byte)'B';
        utf8Destination[1] = (byte)'o';
        utf8Destination[2] = (byte)'d';
        utf8Destination[3] = (byte)'y';
        utf8Destination[4] = (byte)'(';
        if (RawValue.TryFormat(utf8Destination.Slice(5), out int valueBytes, format, provider) &&
            5 + valueBytes < utf8Destination.Length)
        {
            utf8Destination[5 + valueBytes] = (byte)')';
            bytesWritten = 6 + valueBytes;
            return true;
        }

        bytesWritten = 0;
        return false;
    }

    /// <inheritdoc/>
    public string ToString(string? format, IFormatProvider? formatProvider)
    {
        if (!IsValid)
        {
            return "Body(Invalid)";
        }

        Span<char> buffer = stackalloc char[32];
        if (TryFormat(buffer, out int charsWritten, format, formatProvider))
        {
            return buffer.Slice(0, charsWritten).ToString();
        }

        return $"Body({RawValue})";
    }

    /// <inheritdoc/>
    public override string ToString() => ToString(null, null);
}

/// <summary>
/// 4-byte identity of a collider attached to a body. The zero value is the
/// invalid sentinel, so a default-initialized slot can never name a live shape.
/// Backed by the centralized identifier engine.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ShapeId(StrongId<ShapeTag, uint> Handle) : IStrongId<ShapeId, uint>
{
    /// <summary>Invalid sentinel; never a registered shape.</summary>
    public static ShapeId Invalid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(StrongId<ShapeTag, uint>.Invalid);
    }

    /// <summary>The backing value.</summary>
    public uint RawValue
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Handle.RawValue;
    }

    /// <summary>Whether this identity names a registered shape.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Handle.IsValid;
    }

    /// <summary>Wraps a raw value without validation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ShapeId FromRaw(uint value) => new(StrongId<ShapeTag, uint>.FromRaw(value));

    /// <summary>Converts a 0-based slot index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ShapeId FromIndex(int index) => new(StrongId<ShapeTag, uint>.FromIndex(index));

    /// <summary>Converts back to a 0-based slot index, or -1 while invalid.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int ToIndex() => Handle.ToIndex();

    /// <summary>Wraps an engine handle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator StrongId<ShapeTag, uint>(ShapeId id) => id.Handle;

    /// <summary>Unwraps an engine handle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator ShapeId(StrongId<ShapeTag, uint> handle) => new(handle);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int CompareTo(ShapeId other) => Handle.CompareTo(other.Handle);

    /// <summary>Determines whether the left identity sorts before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(ShapeId left, ShapeId right) => left.Handle < right.Handle;

    /// <summary>Determines whether the left identity sorts after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(ShapeId left, ShapeId right) => left.Handle > right.Handle;

    /// <summary>Determines whether the left identity sorts at or before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(ShapeId left, ShapeId right) => left.Handle <= right.Handle;

    /// <summary>Determines whether the left identity sorts at or after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(ShapeId left, ShapeId right) => left.Handle >= right.Handle;

    /// <inheritdoc/>
    public bool TryFormat(
        Span<char> destination,
        out int charsWritten,
        ReadOnlySpan<char> format = default,
        IFormatProvider? provider = null)
    {
        if (!IsValid)
        {
            ReadOnlySpan<char> invalid = "Shape(Invalid)";
            if (destination.Length < invalid.Length)
            {
                charsWritten = 0;
                return false;
            }

            invalid.CopyTo(destination);
            charsWritten = invalid.Length;
            return true;
        }

        if (destination.Length < 8)
        {
            charsWritten = 0;
            return false;
        }

        "Shape(".AsSpan().CopyTo(destination);
        if (RawValue.TryFormat(destination.Slice(6), out int valueChars, format, provider) &&
            6 + valueChars < destination.Length)
        {
            destination[6 + valueChars] = ')';
            charsWritten = 7 + valueChars;
            return true;
        }

        charsWritten = 0;
        return false;
    }

    /// <inheritdoc/>
    public bool TryFormat(
        Span<byte> utf8Destination,
        out int bytesWritten,
        ReadOnlySpan<char> format = default,
        IFormatProvider? provider = null)
    {
        if (utf8Destination.Length < 8)
        {
            bytesWritten = 0;
            return false;
        }

        utf8Destination[0] = (byte)'S';
        utf8Destination[1] = (byte)'h';
        utf8Destination[2] = (byte)'a';
        utf8Destination[3] = (byte)'p';
        utf8Destination[4] = (byte)'e';
        utf8Destination[5] = (byte)'(';
        if (RawValue.TryFormat(utf8Destination.Slice(6), out int valueBytes, format, provider) &&
            6 + valueBytes < utf8Destination.Length)
        {
            utf8Destination[6 + valueBytes] = (byte)')';
            bytesWritten = 7 + valueBytes;
            return true;
        }

        bytesWritten = 0;
        return false;
    }

    /// <inheritdoc/>
    public string ToString(string? format, IFormatProvider? formatProvider)
    {
        if (!IsValid)
        {
            return "Shape(Invalid)";
        }

        Span<char> buffer = stackalloc char[32];
        if (TryFormat(buffer, out int charsWritten, format, formatProvider))
        {
            return buffer.Slice(0, charsWritten).ToString();
        }

        return $"Shape({RawValue})";
    }

    /// <inheritdoc/>
    public override string ToString() => ToString(null, null);
}

/// <summary>How a body moves: fixed scenery, script-driven kinematics, or simulated dynamics.</summary>
public enum BodyType : byte
{
    /// <summary>Immovable scenery; infinite mass, never integrated.</summary>
    Static = 0,

    /// <summary>Script-driven motion; infinite mass, pushes dynamics but never reacts.</summary>
    Kinematic = 1,

    /// <summary>Fully simulated; finite mass, integrated and resolved.</summary>
    Dynamic = 2,
}

/// <summary>
/// Contact response of a shape pair: static friction resists the onset of
/// sliding and caps the Coulomb cone, dynamic friction (when set) scales the
/// sliding resistance, restitution returns bounce, tangent speed drives the
/// contact like a conveyor, and the combine modes decide how the two sides
/// of a contact merge each coefficient. All guards live in the constructor,
/// so an invalid material can never enter the solver; dynamic friction
/// mirrors static friction unless a distinct value is given.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct PhysicsMaterial
{
    /// <summary>Headline Coulomb friction; never negative.</summary>
    public readonly float Friction;

    /// <summary>Restitution; the closed interval [0, 1].</summary>
    public readonly float Restitution;

    /// <summary>Static friction feeding the Coulomb cone; never negative.</summary>
    public readonly float StaticFriction;

    /// <summary>
    /// Dynamic friction while sliding; zero mirrors <see cref="StaticFriction"/>.
    /// </summary>
    public readonly float DynamicFriction;

    /// <summary>Conveyor surface speed along the contact tangent; finite.</summary>
    public readonly float TangentSpeed;

    /// <summary>How a pair merges friction.</summary>
    public readonly CombineMode FrictionCombine;

    /// <summary>How a pair merges restitution.</summary>
    public readonly CombineMode RestitutionCombine;

    /// <summary>Balanced default: slight friction, no bounce.</summary>
    public static PhysicsMaterial Default => new(0.2f, 0.0f);

    /// <summary>Creates a material from the two headline coefficients.</summary>
    /// <param name="friction">Coulomb friction; must not be negative.</param>
    /// <param name="restitution">Restitution; must lie in [0, 1].</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public PhysicsMaterial(float friction, float restitution)
        : this(friction, restitution, friction, 0.0f, 0.0f, CombineMode.Max, CombineMode.Max)
    {
    }

    /// <summary>Creates a fully specified material.</summary>
    /// <param name="friction">Headline Coulomb friction; must not be negative.</param>
    /// <param name="restitution">Restitution; must lie in [0, 1].</param>
    /// <param name="staticFriction">Static friction for the Coulomb cone; defaults to <paramref name="friction"/>.</param>
    /// <param name="dynamicFriction">
    /// Dynamic friction while sliding; zero mirrors <paramref name="staticFriction"/>
    /// (Box2D convention: a zero coefficient still resists at its own value).
    /// </param>
    /// <param name="tangentSpeed">Conveyor surface speed along the contact tangent.</param>
    /// <param name="frictionCombine">How a pair merges friction.</param>
    /// <param name="restitutionCombine">How a pair merges restitution.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public PhysicsMaterial(
        float friction,
        float restitution,
        float staticFriction,
        float dynamicFriction,
        float tangentSpeed,
        CombineMode frictionCombine,
        CombineMode restitutionCombine)
    {
        if (friction < 0.0f || float.IsNaN(friction))
        {
            ThrowHelper.ThrowInvalidOperation("Friction must not be negative.");
        }

        if (restitution < 0.0f || restitution > 1.0f || float.IsNaN(restitution))
        {
            ThrowHelper.ThrowInvalidOperation("Restitution must lie in [0, 1].");
        }

        if (staticFriction < 0.0f || float.IsNaN(staticFriction))
        {
            ThrowHelper.ThrowInvalidOperation("Static friction must not be negative.");
        }

        if (dynamicFriction < 0.0f || float.IsNaN(dynamicFriction))
        {
            ThrowHelper.ThrowInvalidOperation("Dynamic friction must not be negative.");
        }

        if (float.IsNaN(tangentSpeed) || float.IsInfinity(tangentSpeed))
        {
            ThrowHelper.ThrowInvalidOperation("Tangent speed must be finite.");
        }

        Friction = friction;
        Restitution = restitution;
        StaticFriction = staticFriction;
        DynamicFriction = dynamicFriction > 0.0f ? dynamicFriction : staticFriction;
        TangentSpeed = tangentSpeed;
        FrictionCombine = frictionCombine;
        RestitutionCombine = restitutionCombine;
    }
}
