namespace Axrone.Scene.Runtime;

using Axrone.Animation;

/// <summary>
/// Minimal CPU pose consumer. The bridge publishes the animated local pose and
/// the composed world palette once per updated actor; GPU skinning stays a
/// renderer concern and is deliberately not part of this contract.
/// </summary>
public interface IScenePoseSink
{
    /// <summary>Receives one actor's pose after a successful update.</summary>
    /// <param name="actor">Animated actor.</param>
    /// <param name="localPose">Local-space bone transforms, one per bone.</param>
    /// <param name="worldPalette">World bone matrices, one per bone.</param>
    void ApplyPose(SceneActor actor, ReadOnlySpan<LocalTransform> localPose, ReadOnlySpan<Mat4> worldPalette);
}

/// <summary>
/// Bridges <see cref="SceneAnimator"/> components onto
/// <see cref="AnimationController"/> instances. Controllers stay caller-owned;
/// the bridge only tracks the generation-safe binding, advances bound animators
/// in deterministic slot order and publishes poses to an optional sink.
/// </summary>
/// <remarks>
/// One failure (controller update or pose sink) faults only that slot; other
/// animators keep advancing. Steady-state stepping allocates nothing once the
/// per-slot event list and pose buffers have warmed up.
/// </remarks>
public sealed class SceneAnimatorBridge : IDisposable
{
    private const int InitialSlots = 8;

    private readonly SceneWorld _world;
    private AnimatorSlot?[] _slots = new AnimatorSlot?[InitialSlots];
    private uint[] _generations = new uint[InitialSlots];
    private int[] _freeSlots = new int[InitialSlots];
    private int _freeCount;
    private int _slotCount;
    private bool _disposed;

    /// <summary>Creates an animator bridge over a scene world.</summary>
    public SceneAnimatorBridge(SceneWorld world)
    {
        ArgumentNullException.ThrowIfNull(world);
        _world = world;
    }

    /// <summary>Gets the number of bound animators.</summary>
    public int Count => _slotCount - _freeCount;

    /// <summary>
    /// Binds a controller to an actor that carries a <see cref="SceneAnimator"/>
    /// component and returns the generation-safe handle.
    /// </summary>
    public bool Bind(SceneActor actor, AnimationController controller)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(controller);

        if (!actor.IsValid || !_world.TryGetData(actor, out SceneAnimator component))
        {
            return false;
        }

        if (component.Handle.IsValid)
        {
            Unbind(actor);
        }

        int index = AllocateSlot();
        AnimatorSlot slot = new(index, _generations[index], actor, controller);
        _slots[index] = slot;
        controller.BindAll();

        ref SceneAnimator live = ref _world.GetData<SceneAnimator>(actor);
        live.Handle = new SceneAnimatorHandle(index, slot.Generation);
        return true;
    }

    /// <summary>Binds a layer reference so its weight is reachable by index.</summary>
    public bool BindLayer(SceneActor actor, AnimationLayer layer)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(layer);

        if (!TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        slot.Layers ??= new List<AnimationLayer>();
        slot.Layers.Add(layer);
        return true;
    }

    /// <summary>Releases the animator bound to an actor.</summary>
    public bool Unbind(SceneActor actor)
    {
        ThrowIfDisposed();

        if (!TryResolve(actor, out int index, out AnimatorSlot slot))
        {
            return false;
        }

        if (_world.HasData<SceneAnimator>(actor))
        {
            ref SceneAnimator component = ref _world.GetData<SceneAnimator>(actor);
            if (component.Handle == new SceneAnimatorHandle(index, slot.Generation))
            {
                component.Handle = SceneAnimatorHandle.Invalid;
            }
        }

        ReleaseSlot(index);
        return true;
    }

    /// <summary>Removes bindings whose actor or component disappeared.</summary>
    public void Sync()
    {
        ThrowIfDisposed();

        for (int i = 0; i < _slotCount; i++)
        {
            AnimatorSlot? slot = _slots[i];
            if (slot is null)
            {
                continue;
            }

            if (!_world.TryGetData(slot.Actor, out SceneAnimator component) ||
                component.Handle != new SceneAnimatorHandle(i, slot.Generation))
            {
                ReleaseSlot(i);
            }
        }
    }

    /// <summary>
    /// Advances every bound animator by the scaled delta and publishes poses.
    /// Completed, faulted, paused, disabled and inactive actors are skipped.
    /// </summary>
    public void Step(float deltaSeconds, IScenePoseSink? poseSink = null)
    {
        ThrowIfDisposed();
        if (!(deltaSeconds > 0.0f))
        {
            return;
        }

        Sync();

        for (int i = 0; i < _slotCount; i++)
        {
            AnimatorSlot? slot = _slots[i];
            if (slot is null ||
                slot.Status is SceneAnimatorStatus.Completed or SceneAnimatorStatus.Faulted)
            {
                continue;
            }

            if (!_world.IsActiveInHierarchy(slot.Actor) ||
                !_world.TryGetData(slot.Actor, out SceneAnimator component))
            {
                continue;
            }

            if (!component.Enabled)
            {
                slot.Status = SceneAnimatorStatus.Disabled;
                continue;
            }

            if (component.Paused)
            {
                slot.Status = SceneAnimatorStatus.Paused;
                continue;
            }

            if (!(deltaSeconds * component.Speed > 0.0f))
            {
                slot.Status = SceneAnimatorStatus.Paused;
                continue;
            }

            try
            {
                StepSlot(slot, in component, deltaSeconds, poseSink);
                slot.Status = SceneAnimatorStatus.Playing;
            }
            catch (Exception exception)
            {
                slot.Status = SceneAnimatorStatus.Faulted;
                slot.Fault = exception;
            }
        }
    }

    /// <summary>Moves an animator into its terminal completed state.</summary>
    public bool Complete(SceneActor actor)
    {
        ThrowIfDisposed();

        if (!TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        slot.Status = SceneAnimatorStatus.Completed;
        slot.Fault = null;
        return true;
    }

    /// <summary>Clears a completed or faulted status and resumes playback.</summary>
    public bool Reset(SceneActor actor)
    {
        ThrowIfDisposed();

        if (!TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        slot.Status = SceneAnimatorStatus.Playing;
        slot.Fault = null;
        return true;
    }

    /// <summary>Gets the status of an animator.</summary>
    public SceneAnimatorStatus GetStatus(SceneActor actor) =>
        TryResolve(actor, out _, out AnimatorSlot slot) ? slot.Status : SceneAnimatorStatus.Unbound;

    /// <summary>Gets the fault captured by the isolated update path.</summary>
    public bool TryGetFault(SceneActor actor, [NotNullWhen(true)] out Exception? fault)
    {
        if (TryResolve(actor, out _, out AnimatorSlot slot) && slot.Fault is not null)
        {
            fault = slot.Fault;
            return true;
        }

        fault = null;
        return false;
    }

    /// <summary>Reads the state machine view of the component's active layer.</summary>
    public bool TryGetState(SceneActor actor, out SceneAnimatorStateSnapshot state)
    {
        state = default;
        if (!TryResolve(actor, out _, out AnimatorSlot slot) ||
            !_world.TryGetData(actor, out SceneAnimator component) ||
            slot.Layers is null)
        {
            return false;
        }

        int layerIndex = component.ActiveLayer;
        if ((uint)layerIndex >= (uint)slot.Layers.Count)
        {
            return false;
        }

        StateMachineInstance machine = slot.Layers[layerIndex].Machine;
        state = new SceneAnimatorStateSnapshot(
            layerIndex,
            machine.CurrentStateIndex,
            machine.StateNormalizedTime,
            machine.HasActiveTransition,
            slot.Status);
        return true;
    }

    /// <summary>Snaps the active layer to a state without blending.</summary>
    public bool TrySetState(SceneActor actor, int stateIndex, float normalizedTime)
    {
        ThrowIfDisposed();

        if (!float.IsFinite(normalizedTime) ||
            !TryResolve(actor, out _, out AnimatorSlot slot) ||
            !_world.TryGetData(actor, out SceneAnimator component) ||
            slot.Layers is null ||
            (uint)component.ActiveLayer >= (uint)slot.Layers.Count)
        {
            return false;
        }

        try
        {
            slot.Layers[component.ActiveLayer].Machine.ForceState(stateIndex, normalizedTime);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Reads a layer weight.</summary>
    public bool TryGetLayerWeight(SceneActor actor, int layerIndex, out float weight)
    {
        weight = 0.0f;
        if (!TryResolve(actor, out _, out AnimatorSlot slot) ||
            slot.Layers is null ||
            (uint)layerIndex >= (uint)slot.Layers.Count)
        {
            return false;
        }

        weight = slot.Layers[layerIndex].Weight;
        return true;
    }

    /// <summary>Writes a layer weight.</summary>
    public bool TrySetLayerWeight(SceneActor actor, int layerIndex, float weight)
    {
        ThrowIfDisposed();

        if (!float.IsFinite(weight) ||
            !TryResolve(actor, out _, out AnimatorSlot slot) ||
            slot.Layers is null ||
            (uint)layerIndex >= (uint)slot.Layers.Count)
        {
            return false;
        }

        slot.Layers[layerIndex].Weight = Math.Clamp(weight, 0.0f, 1.0f);
        return true;
    }

    /// <summary>Writes a float parameter by resolved handle.</summary>
    public bool TrySetFloat(SceneActor actor, in ParameterHandle handle, float value)
    {
        ThrowIfDisposed();

        if (!handle.IsValid || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            slot.Controller.Parameters.SetFloat(in handle, value);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Reads a float parameter by resolved handle.</summary>
    public bool TryGetFloat(SceneActor actor, in ParameterHandle handle, out float value)
    {
        value = 0.0f;
        if (!handle.IsValid || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            value = slot.Controller.Parameters.GetFloat(in handle);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Writes an int parameter by resolved handle.</summary>
    public bool TrySetInt(SceneActor actor, in ParameterHandle handle, int value)
    {
        ThrowIfDisposed();

        if (!handle.IsValid || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            slot.Controller.Parameters.SetInt(in handle, value);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Reads an int parameter by resolved handle.</summary>
    public bool TryGetInt(SceneActor actor, in ParameterHandle handle, out int value)
    {
        value = 0;
        if (!handle.IsValid || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            value = slot.Controller.Parameters.GetInt(in handle);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Writes a bool parameter by resolved handle.</summary>
    public bool TrySetBool(SceneActor actor, in ParameterHandle handle, bool value)
    {
        ThrowIfDisposed();

        if (!handle.IsValid || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            slot.Controller.Parameters.SetBool(in handle, value);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Reads a bool parameter by resolved handle.</summary>
    public bool TryGetBool(SceneActor actor, in ParameterHandle handle, out bool value)
    {
        value = false;
        if (!handle.IsValid || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            value = slot.Controller.Parameters.GetBool(in handle);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Fires a trigger parameter by name.</summary>
    public bool TrySetTrigger(SceneActor actor, string name)
    {
        ThrowIfDisposed();

        if (string.IsNullOrEmpty(name) || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            slot.Controller.Parameters.SetTrigger(name);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Clears a trigger without consuming it.</summary>
    public bool TryResetTrigger(SceneActor actor, string name)
    {
        ThrowIfDisposed();

        if (string.IsNullOrEmpty(name) || !TryResolve(actor, out _, out AnimatorSlot slot))
        {
            return false;
        }

        try
        {
            slot.Controller.Parameters.ResetTrigger(name);
            return true;
        }
        catch (AnimationException)
        {
            return false;
        }
    }

    /// <summary>Gets the rig driven by an animator.</summary>
    public bool TryGetRig(SceneActor actor, [NotNullWhen(true)] out Rig? rig)
    {
        if (TryResolve(actor, out _, out AnimatorSlot slot))
        {
            rig = slot.Controller.Rig;
            return true;
        }

        rig = null;
        return false;
    }

    /// <summary>
    /// Copies the last published pose into caller spans. Both spans must hold at
    /// least one entry per bone.
    /// </summary>
    public bool TryCopyPose(SceneActor actor, Span<LocalTransform> localPose, Span<Mat4> worldPalette)
    {
        if (!TryResolve(actor, out _, out AnimatorSlot slot) || !slot.HasPose)
        {
            return false;
        }

        int boneCount = slot.BoneCount;
        if (localPose.Length < boneCount || worldPalette.Length < boneCount)
        {
            return false;
        }

        slot.LocalPose.AsSpan(0, boneCount).CopyTo(localPose);
        slot.Palette.AsSpan(0, boneCount).CopyTo(worldPalette);
        return true;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        for (int i = 0; i < _slotCount; i++)
        {
            ReleaseSlot(i);
        }

        _slotCount = 0;
        _freeCount = 0;
        _disposed = true;
    }

    private void StepSlot(AnimatorSlot slot, in SceneAnimator component, float deltaSeconds, IScenePoseSink? poseSink)
    {
        AnimationController controller = slot.Controller;
        controller.Update(
            deltaSeconds * component.Speed,
            slot.Events,
            out Vec3 rootMotionPosition,
            out Quat rootMotionRotation);

        if (component.ApplyRootMotion && _world.HasData<SceneTransform3D>(slot.Actor))
        {
            ref SceneTransform3D transform = ref _world.GetData<SceneTransform3D>(slot.Actor);
            transform.SetPosition(transform.Position + rootMotionPosition);
            transform.SetRotation(Quat.Normalize(transform.Rotation * rootMotionRotation));
        }

        AnimationFrame frame = controller.CurrentFrame;
        ReadOnlySpan<Vec3> translations = frame.ReadTranslations();
        ReadOnlySpan<Quat> rotations = frame.ReadRotations();
        ReadOnlySpan<Vec3> scales = frame.ReadScales();
        int boneCount = slot.BoneCount;
        for (int bone = 0; bone < boneCount; bone++)
        {
            slot.LocalPose[bone] = new LocalTransform(translations[bone], rotations[bone], scales[bone]);
        }

        ReadOnlySpan<LocalTransform> localPose = slot.LocalPose.AsSpan(0, boneCount);
        Span<Mat4> palette = slot.Palette.AsSpan(0, boneCount);
        controller.Rig.EvaluatePose(localPose, palette);
        slot.HasPose = true;

        poseSink?.ApplyPose(slot.Actor, localPose, palette);
    }

    private bool TryResolve(SceneActor actor, out int index, out AnimatorSlot slot)
    {
        index = -1;
        slot = null!;
        if (!actor.IsValid ||
            !_world.TryGetData(actor, out SceneAnimator component) ||
            !component.Handle.IsValid)
        {
            return false;
        }

        int candidateIndex = component.Handle.Slot;
        if ((uint)candidateIndex >= (uint)_slotCount)
        {
            return false;
        }

        AnimatorSlot? candidate = _slots[candidateIndex];
        if (candidate is null ||
            candidate.Generation != component.Handle.Generation ||
            candidate.Actor != actor)
        {
            return false;
        }

        index = candidateIndex;
        slot = candidate;
        return true;
    }

    private int AllocateSlot()
    {
        if (_freeCount > 0)
        {
            return _freeSlots[--_freeCount];
        }

        if (_slotCount == _slots.Length)
        {
            int capacity = _slots.Length * 2;
            Array.Resize(ref _slots, capacity);
            Array.Resize(ref _generations, capacity);
            Array.Resize(ref _freeSlots, capacity);
        }

        int index = _slotCount++;
        _generations[index] = 1;
        return index;
    }

    private void ReleaseSlot(int index)
    {
        AnimatorSlot? slot = _slots[index];
        if (slot is null)
        {
            return;
        }

        uint generation = slot.Generation + 1;
        _generations[index] = generation == 0 ? 1 : generation;
        _slots[index] = null;

        if (_freeCount == _freeSlots.Length)
        {
            Array.Resize(ref _freeSlots, _freeSlots.Length * 2);
        }

        _freeSlots[_freeCount++] = index;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneAnimatorBridge));
        }
    }

    private sealed class AnimatorSlot
    {
        public AnimatorSlot(int index, uint generation, SceneActor actor, AnimationController controller)
        {
            _ = index;
            Generation = generation;
            Actor = actor;
            Controller = controller;
            BoneCount = controller.Rig.BoneCount;
            LocalPose = new LocalTransform[BoneCount];
            Palette = new Mat4[BoneCount];
            Events = new List<ClipEvent>();
        }

        public uint Generation { get; }

        public SceneActor Actor { get; }

        public AnimationController Controller { get; }

        public int BoneCount { get; }

        public LocalTransform[] LocalPose { get; }

        public Mat4[] Palette { get; }

        public List<ClipEvent> Events { get; }

        public List<AnimationLayer>? Layers { get; set; }

        public SceneAnimatorStatus Status { get; set; } = SceneAnimatorStatus.Playing;

        public Exception? Fault { get; set; }

        public bool HasPose { get; set; }
    }
}
