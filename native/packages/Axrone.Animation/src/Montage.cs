namespace Axrone.Animation;

/// <summary>Lifecycle state of a played montage.</summary>
public enum AnimationMontageStatus
{
    /// <summary>Advancing and contributing to the pose.</summary>
    Playing = 0,

    /// <summary>Reached its end and was removed from the controller.</summary>
    Completed = 1,

    /// <summary>Cancelled before its end.</summary>
    Stopped = 2,
}

/// <summary>Authoring knobs for <see cref="AnimationController.PlayMontage"/>.</summary>
/// <param name="FadeInSeconds">Fade-in length; clamped to half the clip.</param>
/// <param name="FadeOutSeconds">Fade-out length; clamped to half the clip.</param>
/// <param name="Loop">Whether the montage repeats until stopped.</param>
/// <param name="Speed">Playback rate; the sign is ignored, reverse is not a montage feature.</param>
/// <param name="ReplaceExisting">Whether starting this montage stops the others.</param>
/// <param name="Mode">Whether the montage overrides or adds onto lower layers.</param>
/// <param name="BoneMask">Optional override mask for the montage layer.</param>
public readonly record struct AnimationMontageOptions(
    float FadeInSeconds = 0.1f,
    float FadeOutSeconds = 0.1f,
    bool Loop = false,
    float Speed = 1.0f,
    bool ReplaceExisting = true,
    LayerMode Mode = LayerMode.Override,
    AnimationMask? BoneMask = null);

/// <summary>
/// Authored one-shot layered playback. A montage owns a controller layer with a
/// single clip state, fades in and out, and reports completion through its status;
/// events still flow through the controller's normal clip-event sink.
/// </summary>
/// <remarks>
/// A montage is created through <see cref="AnimationController.PlayMontage"/> and
/// stays valid after completion as a status handle. Layer ownership stays with
/// the controller, so a host never removes layers by index.
/// </remarks>
public sealed class AnimationMontage
{
    private readonly float _durationSeconds;
    private readonly float _fadeInSeconds;
    private readonly float _fadeOutSeconds;
    private readonly float _speed;
    private readonly bool _loop;
    private float _elapsedSeconds;

    internal AnimationMontage(
        AnimationLayer layer,
        float durationSeconds,
        in AnimationMontageOptions options)
    {
        Layer = layer;
        _durationSeconds = MathF.Max(0.0f, durationSeconds);
        _fadeInSeconds = MathF.Max(0.0f, options.FadeInSeconds);
        _fadeOutSeconds = MathF.Max(0.0f, options.FadeOutSeconds);
        _speed = MathF.Max(MathF.Abs(options.Speed), AnimationConstants.SoaEpsilon);
        _loop = options.Loop;
        Status = AnimationMontageStatus.Playing;
    }

    /// <summary>Owning controller layer.</summary>
    internal AnimationLayer Layer { get; }

    /// <summary>Current lifecycle state.</summary>
    public AnimationMontageStatus Status { get; private set; }

    /// <summary>Normalized playhead in the unit interval; wraps for a looping montage.</summary>
    public float NormalizedTime
    {
        get
        {
            if (_durationSeconds <= AnimationConstants.SoaEpsilon)
            {
                return 1.0f;
            }

            float ratio = _elapsedSeconds / _durationSeconds;
            if (_loop)
            {
                ratio -= MathF.Floor(ratio);
            }

            return FastMath.Clamp01(ratio);
        }
    }

    /// <summary>Current layer weight after fades.</summary>
    public float Weight => Layer.Weight;

    /// <summary>Whether the controller should release the layer on its next update.</summary>
    internal bool RemoveRequested { get; private set; }

    /// <summary>Cancels playback; the layer is released on the next controller update.</summary>
    public void Stop()
    {
        if (Status != AnimationMontageStatus.Playing)
        {
            return;
        }

        Status = AnimationMontageStatus.Stopped;
        Layer.Weight = 0.0f;
        RemoveRequested = true;
    }

    internal void Advance(float deltaSeconds)
    {
        if (Status != AnimationMontageStatus.Playing)
        {
            return;
        }

        if (_durationSeconds <= AnimationConstants.SoaEpsilon)
        {
            Complete();
            return;
        }

        if (deltaSeconds > 0.0f)
        {
            _elapsedSeconds += deltaSeconds * _speed;
        }

        float weight = 1.0f;
        float fadeIn = MathF.Min(_fadeInSeconds, _durationSeconds * 0.5f);
        if (fadeIn > AnimationConstants.SoaEpsilon)
        {
            weight = MathF.Min(weight, _elapsedSeconds / fadeIn);
        }

        if (!_loop)
        {
            float fadeOut = MathF.Min(_fadeOutSeconds, _durationSeconds * 0.5f);
            if (fadeOut > AnimationConstants.SoaEpsilon)
            {
                weight = MathF.Min(weight, (_durationSeconds - _elapsedSeconds) / fadeOut);
            }

            if (_elapsedSeconds >= _durationSeconds)
            {
                Complete();
                return;
            }
        }

        Layer.Weight = FastMath.Clamp01(weight);
    }

    private void Complete()
    {
        Status = AnimationMontageStatus.Completed;
        Layer.Weight = 0.0f;
        RemoveRequested = true;
    }
}
