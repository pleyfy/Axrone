namespace Axrone.Particles;

/// <summary>Emitter shape.</summary>
public enum EmitterShape : byte
{
    /// <summary>Single point.</summary>
    Point = 0,

    /// <summary>Sphere volume.</summary>
    Sphere = 1,

    /// <summary>Hemisphere volume.</summary>
    Hemisphere = 2,

    /// <summary>Cone.</summary>
    Cone = 3,

    /// <summary>Circle.</summary>
    Circle = 4,

    /// <summary>Box volume.</summary>
    Box = 5,

    /// <summary>Rectangle.</summary>
    Rectangle = 6,

    /// <summary>Line.</summary>
    Line = 7,

    /// <summary>Mesh surface.</summary>
    Mesh = 8,

    /// <summary>Edge.</summary>
    Edge = 9,

    /// <summary>Donut.</summary>
    Donut = 10,
}

/// <summary>Simulation space.</summary>
public enum SimulationSpace : byte
{
    /// <summary>Local space.</summary>
    Local = 0,

    /// <summary>World space.</summary>
    World = 1,

    /// <summary>Custom space.</summary>
    Custom = 2,
}

/// <summary>Sort mode.</summary>
public enum SortMode : byte
{
    /// <summary>No sorting.</summary>
    None = 0,

    /// <summary>By distance.</summary>
    Distance = 1,

    /// <summary>Oldest first.</summary>
    OldestFirst = 2,

    /// <summary>Youngest first.</summary>
    YoungestFirst = 3,

    /// <summary>Custom order.</summary>
    Custom = 4,
}

/// <summary>Render mode.</summary>
public enum RenderMode : byte
{
    /// <summary>Billboard.</summary>
    Billboard = 0,

    /// <summary>Stretched billboard.</summary>
    Stretch = 1,

    /// <summary>Horizontal billboard.</summary>
    HorizontalBillboard = 2,

    /// <summary>Vertical billboard.</summary>
    VerticalBillboard = 3,

    /// <summary>Mesh.</summary>
    Mesh = 4,

    /// <summary>Trail.</summary>
    Trail = 5,

    /// <summary>Ribbon.</summary>
    Ribbon = 6,
}

/// <summary>Stop action.</summary>
public enum StopAction : byte
{
    /// <summary>No action.</summary>
    None = 0,

    /// <summary>Disable.</summary>
    Disable = 1,

    /// <summary>Destroy.</summary>
    Destroy = 2,

    /// <summary>Callback.</summary>
    Callback = 3,
}

/// <summary>Culling mode.</summary>
public enum CullingMode : byte
{
    /// <summary>Automatic.</summary>
    Automatic = 0,

    /// <summary>Pause.</summary>
    Pause = 1,

    /// <summary>Pause and catch up.</summary>
    PauseAndCatchup = 2,

    /// <summary>Always simulate.</summary>
    AlwaysSimulate = 3,
}

/// <summary>Ring buffer mode.</summary>
public enum RingBufferMode : byte
{
    /// <summary>Disabled.</summary>
    Disabled = 0,

    /// <summary>Pause until replaced.</summary>
    PauseUntilReplaced = 1,

    /// <summary>Loop until replaced.</summary>
    LoopUntilReplaced = 2,
}

/// <summary>Curve mode.</summary>
public enum CurveMode : byte
{
    /// <summary>Constant value.</summary>
    Constant = 0,

    /// <summary>Single curve.</summary>
    Curve = 1,

    /// <summary>Two random curves.</summary>
    TwoCurves = 2,

    /// <summary>Two random constants.</summary>
    TwoConstants = 3,
}

/// <summary>Gradient mode.</summary>
public enum GradientMode : byte
{
    /// <summary>Single color.</summary>
    Color = 0,

    /// <summary>Gradient.</summary>
    Gradient = 1,

    /// <summary>Two random colors.</summary>
    TwoColors = 2,

    /// <summary>Two random gradients.</summary>
    TwoGradients = 3,

    /// <summary>Random hue.</summary>
    RandomColor = 4,
}

/// <summary>Module flags.</summary>
[Flags]
public enum ModuleFlags : ushort
{
    /// <summary>No flags.</summary>
    None = 0,

    /// <summary>Start lifetime.</summary>
    StartLifetime = 1 << 0,

    /// <summary>Start speed.</summary>
    StartSpeed = 1 << 1,

    /// <summary>Start size.</summary>
    StartSize = 1 << 2,

    /// <summary>Start rotation.</summary>
    StartRotation = 1 << 3,

    /// <summary>Start color.</summary>
    StartColor = 1 << 4,

    /// <summary>Gravity modifier.</summary>
    GravityModifier = 1 << 5,

    /// <summary>Simulation space.</summary>
    SimulationSpace = 1 << 6,

    /// <summary>Simulation speed.</summary>
    SimulationSpeed = 1 << 7,

    /// <summary>Scaling mode.</summary>
    ScalingMode = 1 << 8,

    /// <summary>Play when the component loads.</summary>
    PlayOnLoad = 1 << 9,

    /// <summary>Max particles.</summary>
    MaxParticles = 1 << 10,

    /// <summary>All flags.</summary>
    All = 2047,
}

/// <summary>Lighting mode.</summary>
public enum LightingMode : byte
{
    /// <summary>No lighting.</summary>
    None = 0,

    /// <summary>Simple.</summary>
    Simple = 1,

    /// <summary>Advanced.</summary>
    Advanced = 2,

    /// <summary>Volumetric.</summary>
    Volumetric = 3,
}

/// <summary>Light attenuation mode.</summary>
public enum LightAttenuationMode : byte
{
    /// <summary>Linear.</summary>
    Linear = 0,

    /// <summary>Inverse square.</summary>
    InverseSquare = 1,

    /// <summary>Exponential.</summary>
    Exponential = 2,

    /// <summary>Smooth.</summary>
    Smooth = 3,
}

/// <summary>Force type.</summary>
public enum ForceType : byte
{
    /// <summary>Gravity.</summary>
    Gravity = 0,

    /// <summary>Drag.</summary>
    Drag = 1,

    /// <summary>Turbulence.</summary>
    Turbulence = 2,

    /// <summary>Vortex.</summary>
    Vortex = 3,

    /// <summary>Directional.</summary>
    Directional = 4,

    /// <summary>Point.</summary>
    Point = 5,

    /// <summary>Custom.</summary>
    Custom = 6,
}

/// <summary>Falloff mode.</summary>
public enum FalloffMode : byte
{
    /// <summary>No falloff.</summary>
    None = 0,

    /// <summary>Linear.</summary>
    Linear = 1,

    /// <summary>Quadratic.</summary>
    Quadratic = 2,

    /// <summary>Custom.</summary>
    Custom = 3,
}

/// <summary>Noise type.</summary>
public enum NoiseType : byte
{
    /// <summary>Perlin.</summary>
    Perlin = 0,

    /// <summary>Simplex.</summary>
    Simplex = 1,

    /// <summary>Worley.</summary>
    Worley = 2,

    /// <summary>Curl.</summary>
    Curl = 3,

    /// <summary>Turbulence.</summary>
    Turbulence = 4,

    /// <summary>Fractal.</summary>
    Fractal = 5,
}

/// <summary>Collision primitive.</summary>
public enum CollisionPrimitive : byte
{
    /// <summary>Plane.</summary>
    Plane = 0,

    /// <summary>Sphere.</summary>
    Sphere = 1,

    /// <summary>Box.</summary>
    Box = 2,

    /// <summary>Cylinder.</summary>
    Cylinder = 3,

    /// <summary>Mesh.</summary>
    Mesh = 4,
}

/// <summary>Collision mode.</summary>
public enum CollisionMode : byte
{
    /// <summary>Ignore.</summary>
    Ignore = 0,

    /// <summary>Kill.</summary>
    Kill = 1,

    /// <summary>Callback.</summary>
    Callback = 2,
}

/// <summary>Trail mode.</summary>
public enum TrailMode : byte
{
    /// <summary>Particles.</summary>
    Particles = 0,

    /// <summary>Ribbon.</summary>
    Ribbon = 1,
}

/// <summary>Particle death reason.</summary>
public enum ParticleDeathReason : byte
{
    /// <summary>Expired.</summary>
    Expired = 0,

    /// <summary>Killed.</summary>
    Killed = 1,

    /// <summary>Collision.</summary>
    Collision = 2,

    /// <summary>Out of bounds.</summary>
    Bounds = 3,
}

/// <summary>Particle system error code.</summary>
public enum ParticleSystemErrorCode : uint
{
    /// <summary>No error.</summary>
    None = 0,

    /// <summary>System not initialized.</summary>
    SystemNotInitialized = 1,

    /// <summary>Particle not found.</summary>
    ParticleNotFound = 2,

    /// <summary>Module not found.</summary>
    ModuleNotFound = 3,

    /// <summary>Capacity exceeded.</summary>
    CapacityExceeded = 4,

    /// <summary>Invalid configuration.</summary>
    InvalidConfiguration = 5,

    /// <summary>Resource not available.</summary>
    ResourceNotAvailable = 6,

    /// <summary>Operation not supported.</summary>
    OperationNotSupported = 7,

    /// <summary>Memory allocation failed.</summary>
    MemoryAllocationFailed = 8,

    /// <summary>Invalid state.</summary>
    InvalidState = 9,

    /// <summary>Thread safety violation.</summary>
    ThreadSafetyViolation = 10,
}

/// <summary>Gradient color space.</summary>
public enum ColorSpace : byte
{
    /// <summary>RGB.</summary>
    Rgb = 0,

    /// <summary>HSV.</summary>
    Hsv = 1,

    /// <summary>HSL.</summary>
    Hsl = 2,

    /// <summary>LAB.</summary>
    Lab = 3,

    /// <summary>LCH.</summary>
    Lch = 4,
}

/// <summary>Gradient blend mode.</summary>
public enum BlendMode : byte
{
    /// <summary>Normal.</summary>
    Normal = 0,

    /// <summary>Additive.</summary>
    Additive = 1,

    /// <summary>Multiply.</summary>
    Multiply = 2,

    /// <summary>Screen.</summary>
    Screen = 3,

    /// <summary>Overlay.</summary>
    Overlay = 4,

    /// <summary>Soft light.</summary>
    SoftLight = 5,

    /// <summary>Hard light.</summary>
    HardLight = 6,

    /// <summary>Color dodge.</summary>
    ColorDodge = 7,

    /// <summary>Color burn.</summary>
    ColorBurn = 8,

    /// <summary>Darken.</summary>
    Darken = 9,

    /// <summary>Lighten.</summary>
    Lighten = 10,

    /// <summary>Difference.</summary>
    Difference = 11,

    /// <summary>Exclusion.</summary>
    Exclusion = 12,
}
