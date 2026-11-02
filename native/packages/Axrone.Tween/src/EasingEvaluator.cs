namespace Axrone.Tween;

/// <summary>Dispatches normalized time to the selected curve.</summary>
public static class EasingEvaluator
{
    /// <summary>Evaluates the curve, clamping time to the unit interval.</summary>
    /// <remarks>Unknown kinds (including bare <see cref="EasingKind.Custom"/>) fall back to linear.</remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float Evaluate(EasingKind kind, float t)
    {
        t = Math.Clamp(t, 0.0f, 1.0f);

        return kind switch
        {
            EasingKind.Linear => LinearCurve.Evaluate(t),
            EasingKind.EaseInQuad => EaseInQuadCurve.Evaluate(t),
            EasingKind.EaseOutQuad => EaseOutQuadCurve.Evaluate(t),
            EasingKind.EaseInOutQuad => EaseInOutQuadCurve.Evaluate(t),
            EasingKind.EaseInCubic => EaseInCubicCurve.Evaluate(t),
            EasingKind.EaseOutCubic => EaseOutCubicCurve.Evaluate(t),
            EasingKind.EaseInOutCubic => EaseInOutCubicCurve.Evaluate(t),
            EasingKind.EaseInQuart => EaseInQuartCurve.Evaluate(t),
            EasingKind.EaseOutQuart => EaseOutQuartCurve.Evaluate(t),
            EasingKind.EaseInOutQuart => EaseInOutQuartCurve.Evaluate(t),
            EasingKind.EaseInQuint => EaseInQuintCurve.Evaluate(t),
            EasingKind.EaseOutQuint => EaseOutQuintCurve.Evaluate(t),
            EasingKind.EaseInOutQuint => EaseInOutQuintCurve.Evaluate(t),
            EasingKind.EaseInExpo => EaseInExpoCurve.Evaluate(t),
            EasingKind.EaseOutExpo => EaseOutExpoCurve.Evaluate(t),
            EasingKind.EaseInOutExpo => EaseInOutExpoCurve.Evaluate(t),
            EasingKind.EaseInCirc => EaseInCircCurve.Evaluate(t),
            EasingKind.EaseOutCirc => EaseOutCircCurve.Evaluate(t),
            EasingKind.EaseInOutCirc => EaseInOutCircCurve.Evaluate(t),
            EasingKind.EaseInElastic => EaseInElasticCurve.Evaluate(t),
            EasingKind.EaseOutElastic => EaseOutElasticCurve.Evaluate(t),
            EasingKind.EaseInOutElastic => EaseInOutElasticCurve.Evaluate(t),
            EasingKind.EaseInBack => EaseInBackCurve.Evaluate(t),
            EasingKind.EaseOutBack => EaseOutBackCurve.Evaluate(t),
            EasingKind.EaseInOutBack => EaseInOutBackCurve.Evaluate(t),
            EasingKind.EaseInBounce => EaseInBounceCurve.Evaluate(t),
            EasingKind.EaseOutBounce => EaseOutBounceCurve.Evaluate(t),
            EasingKind.EaseInOutBounce => EaseInOutBounceCurve.Evaluate(t),
            EasingKind.EaseInSine => EaseInSineCurve.Evaluate(t),
            EasingKind.EaseOutSine => EaseOutSineCurve.Evaluate(t),
            EasingKind.EaseInOutSine => EaseInOutSineCurve.Evaluate(t),
            _ => t,
        };
    }
}
