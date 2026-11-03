namespace Axrone.Animation;

/// <summary>
/// Immutable view over the authored curve-slot table: the mapping that turns a
/// <see cref="CurveId"/> into the dense runtime slot a <see cref="CurveStore"/>
/// lane lives at. The table is authored once at import time and read-only for the
/// rest of the session, so the layout is shared by the controller, every pooled
/// frame, and the binding context instead of being re-passed as a raw dictionary.
///
/// The layout owns resolution, not data: it hands out <see cref="CurveHandle"/>
/// slots (the build-time resolved address) and deliberately offers no mutation
/// path, so a slot resolved at bind time stays valid for the lifetime of the
/// table.
/// </summary>
public sealed class CurveLayout
{
    /// <summary>Backing slot table, shared by reference with the authoring code.</summary>
    public IReadOnlyDictionary<CurveId, int> Slots { get; }

    /// <summary>
    /// Mapped curve count, which is also the width of every
    /// <see cref="CurveStore"/> buffer built over this layout.
    /// </summary>
    public int Count => Slots.Count;

    /// <summary>Creates a layout over a slot table.</summary>
    /// <param name="slots">Curve id to dense slot table; must not be null.</param>
    /// <exception cref="ArgumentNullException"><paramref name="slots"/> is null.</exception>
    public CurveLayout(IReadOnlyDictionary<CurveId, int> slots)
    {
        ArgumentNullException.ThrowIfNull(slots);
        Slots = slots;
    }

    /// <summary>
    /// Tries to resolve a curve id to its raw dense slot. Present so that callers
    /// already typed against <see cref="IReadOnlyDictionary{TKey,TValue}"/> keep
    /// compiling unchanged.
    /// </summary>
    /// <param name="id">Curve to resolve.</param>
    /// <param name="slot">Resolved dense slot, or <c>-1</c> when unmapped.</param>
    /// <returns>True when the curve is mapped.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetValue(CurveId id, out int slot)
    {
        if (Slots.TryGetValue(id, out int raw))
        {
            slot = raw;
            return true;
        }

        slot = -1;
        return false;
    }

    /// <summary>
    /// Tries to resolve a curve id to a typed slot handle, yielding
    /// <see cref="CurveHandle.Invalid"/> for unmapped curves so bind paths never
    /// have to carry a separate presence flag.
    /// </summary>
    /// <param name="id">Curve to resolve.</param>
    /// <param name="slot">Resolved handle, or <see cref="CurveHandle.Invalid"/>.</param>
    /// <returns>True when the curve is mapped.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetSlot(CurveId id, out CurveHandle slot)
    {
        if (Slots.TryGetValue(id, out int raw))
        {
            slot = new CurveHandle(raw);
            return true;
        }

        slot = CurveHandle.Invalid;
        return false;
    }

    /// <summary>Resolves a curve id to a typed slot handle.</summary>
    /// <param name="id">Curve to resolve.</param>
    /// <returns>The resolved handle.</returns>
    /// <exception cref="ResolutionException">The curve is not mapped by this layout.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public CurveHandle ResolveSlot(CurveId id)
    {
        if (!Slots.TryGetValue(id, out int raw))
        {
            AnimationThrowHelper.ThrowCurveNotFound(id);
        }

        return new CurveHandle(raw);
    }

    /// <summary>
    /// Wraps a raw authoring dictionary, mapping null to null. This is the named
    /// alternate for <see cref="op_Implicit(Dictionary{CurveId,int})"/>: an absent
    /// layout stays absent (the compat path in <see cref="MotionBindingContext"/>
    /// treats a missing layout as "resolve nothing"), while a present one is
    /// promoted to the typed view.
    /// </summary>
    /// <param name="slots">Raw authoring dictionary, or null.</param>
    /// <returns>A layout over <paramref name="slots"/>, or null when it is null.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static CurveLayout? FromDictionary(Dictionary<CurveId, int>? slots) =>
        slots is null ? null : new CurveLayout(slots);

    /// <summary>
    /// Wraps a raw authoring dictionary, mapping null to null so that every
    /// existing call site — including the ones that pass an explicit null for
    /// "no curves" — keeps compiling and keeps its exact meaning.
    /// </summary>
    /// <param name="slots">Raw authoring dictionary, or null.</param>
    /// <returns>A layout over <paramref name="slots"/>, or null when it is null.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator CurveLayout?(Dictionary<CurveId, int>? slots) => FromDictionary(slots);
}
