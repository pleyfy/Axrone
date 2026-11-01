namespace Axrone.Scene.Runtime;

/// <summary>
/// Generation-safe reference to a bridge-owned waypoint path. Released and
/// recycled paths carry a new generation, so stale handles fail resolution.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ScenePathHandle(int Slot, uint Generation)
{
    /// <summary>Handle that names no path.</summary>
    public static ScenePathHandle Invalid => new(-1, 0);

    /// <summary>Whether the handle can name a live path.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Slot >= 0 && Generation != 0;
    }
}

/// <summary>Movement state of one path agent.</summary>
public enum ScenePathAgentStatus
{
    /// <summary>No usable path or no transform.</summary>
    Idle = 0,

    /// <summary>Steering toward the current waypoint.</summary>
    Moving = 1,

    /// <summary>Non-looping path finished.</summary>
    Completed = 2
}

/// <summary>
/// Path follower data component. Waypoints live in the bridge-owned path table;
/// this record carries the generation-safe path reference and the steering
/// configuration that prefab and snapshot serialization must preserve.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct ScenePathAgent : ISceneDataComponent
{
    /// <summary>Bridge path reference; invalid until a path is assigned.</summary>
    public ScenePathHandle Path;

    /// <summary>Travel speed in units per second.</summary>
    public float Speed;

    /// <summary>Distance at which a waypoint counts as reached.</summary>
    public float ArrivalThreshold;

    /// <summary>Maximum yaw change in radians per second; zero disables steering.</summary>
    public float TurnRateRadians;

    /// <summary>Lateral avoidance radius around registered obstacles.</summary>
    public float AvoidanceRadius;

    /// <summary>Whether the path wraps after the last waypoint.</summary>
    public bool Loop;

    /// <summary>Whether the agent participates at all.</summary>
    public bool Enabled;

    /// <summary>Waypoint index used when the path is bound.</summary>
    public int StartWaypoint;

    /// <summary>Default enabled looping agent: 3 u/s, 0.1 arrival radius, 6 rad/s turn rate.</summary>
    public static ScenePathAgent Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Path = ScenePathHandle.Invalid,
            Speed = 3.0f,
            ArrivalThreshold = 0.1f,
            TurnRateRadians = 6.0f,
            AvoidanceRadius = 0.5f,
            Loop = true,
            Enabled = true,
            StartWaypoint = 0
        };
    }
}

/// <summary>Progress view of one path agent.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ScenePathAgentState(
    ScenePathAgentStatus Status,
    int WaypointIndex,
    int WaypointCount);
