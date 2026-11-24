namespace Axrone.Scene;

using Axrone.Ecs;

/// <summary>
/// Stable entity handle into a <c>SceneWorld</c>. The payload is an
/// <see cref="Entity"/> handle so scene entities and data-oriented ECS entities
/// share one 64-bit identity across package boundaries.
/// </summary>
/// <remarks>
/// The scene world owns its own slot table and validates the generation on
/// every access. A handle whose slot was recycled resolves as stale rather
/// than aliasing the new occupant.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneEntity(Entity Entity) :
    IComparable<SceneEntity>,
    IComparisonOperators<SceneEntity, SceneEntity, bool>
{
    /// <summary>Null entity handle; never names live storage.</summary>
    public static SceneEntity Null
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(Entity.Null);
    }

    /// <summary>Whether this handle is the null sentinel.</summary>
    public bool IsNull
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Entity.IsNull;
    }

    /// <summary>Whether this handle names a non-null entity.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => !Entity.IsNull;
    }

    /// <summary>Zero-based entity slot, or <c>-1</c> for the null handle.</summary>
    public int Slot
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Entity.IsNull ? -1 : Entity.Id.Value - 1;
    }

    /// <summary>Generation fence stored in the handle.</summary>
    public Generation Generation
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(unchecked((uint)Entity.Version.Value));
    }

    /// <summary>Wraps a raw ECS entity handle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneEntity FromEntity(in Entity entity) => new(entity);

    /// <summary>
    /// Builds a handle from a zero-based slot and a live generation.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">
    /// The slot is negative, the generation is zero, or the generation does
    /// not fit the entity-version payload.
    /// </exception>
    public static SceneEntity FromSlot(int slot, Generation generation)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(slot);
        ArgumentOutOfRangeException.ThrowIfZero(generation.Value);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(generation.Value, (uint)int.MaxValue);

        return new SceneEntity(new Entity(
            new EntityId(slot + 1),
            new EntityVersion((int)generation.Value)));
    }

    /// <summary>Whether the handle carries <paramref name="generation"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool HasGeneration(Generation generation) => Generation == generation;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(SceneEntity other) => Entity.CompareTo(other.Entity);

    /// <summary>Determines whether the left handle sorts before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(SceneEntity left, SceneEntity right) => left.CompareTo(right) < 0;

    /// <summary>Determines whether the left handle sorts at or before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(SceneEntity left, SceneEntity right) => left.CompareTo(right) <= 0;

    /// <summary>Determines whether the left handle sorts after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(SceneEntity left, SceneEntity right) => left.CompareTo(right) > 0;

    /// <summary>Determines whether the left handle sorts at or after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(SceneEntity left, SceneEntity right) => left.CompareTo(right) >= 0;

    /// <inheritdoc/>
    public override string ToString() => Entity.IsNull
        ? "SceneEntity[Null]"
        : string.Create(
            CultureInfo.InvariantCulture,
            $"SceneEntity[{Entity.Id.Value - 1}v{Entity.Version.Value}]");
}
