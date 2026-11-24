namespace Axrone.Scene.Runtime;

/// <summary>
/// Generation-safe reference to a bridge-owned animator slot. A recycled slot
/// carries a new generation, so a stale handle fails resolution instead of
/// addressing another actor's controller.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneAnimatorHandle(int Slot, uint Generation)
{
    /// <summary>Handle that names no animator.</summary>
    public static SceneAnimatorHandle Invalid => new(-1, 0);

    /// <summary>Whether the handle can name a live slot.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Slot >= 0 && Generation != 0;
    }
}

/// <summary>Runtime state of one bound animator.</summary>
public enum SceneAnimatorStatus
{
    /// <summary>No controller is bound.</summary>
    Unbound = 0,

    /// <summary>Advancing every step.</summary>
    Playing = 1,

    /// <summary>Suspended by the component or a zero speed.</summary>
    Paused = 2,

    /// <summary>Terminal state set through <c>SceneAnimatorBridge.Complete</c>.</summary>
    Completed = 3,

    /// <summary>Update or pose-sink failure; isolated from other animators.</summary>
    Faulted = 4,

    /// <summary>Component disabled.</summary>
    Disabled = 5
}

/// <summary>
/// Animator data component. The bridge owns the controller and rig; this record
/// carries the generation-safe reference plus the playback controls that scene
/// serialization must preserve.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneAnimator : ISceneDataComponent
{
    /// <summary>Bridge slot reference; invalid until bound.</summary>
    public SceneAnimatorHandle Handle;

    /// <summary>Playback speed multiplier.</summary>
    public float Speed;

    /// <summary>Whether time advancement is suspended.</summary>
    public bool Paused;

    /// <summary>Whether the animator participates at all.</summary>
    public bool Enabled;

    /// <summary>Whether extracted root motion is applied to the actor transform.</summary>
    public bool ApplyRootMotion;

    /// <summary>Layer queried by state accessors.</summary>
    public int ActiveLayer;

    /// <summary>First curve slot holding this actor's morph weights.</summary>
    public int MorphCurveOffset;

    /// <summary>Number of contiguous morph-weight curve slots.</summary>
    public int MorphCurveCount;

    /// <summary>Default enabled animator at unit speed without root motion.</summary>
    public static SceneAnimator Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Handle = SceneAnimatorHandle.Invalid,
            Speed = 1.0f,
            Paused = false,
            Enabled = true,
            ApplyRootMotion = false,
            ActiveLayer = 0,
            MorphCurveOffset = 0,
            MorphCurveCount = 0
        };
    }
}

/// <summary>State machine view of one animator layer.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneAnimatorStateSnapshot(
    int LayerIndex,
    int StateIndex,
    float NormalizedTime,
    bool InTransition,
    SceneAnimatorStatus Status);
