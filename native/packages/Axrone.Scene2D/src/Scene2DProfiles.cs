namespace Axrone.Scene2D;

/// <summary>Profile identities carried by the 2D scene surface.</summary>
public static class Scene2DProfiles
{
    /// <summary>Sprites and 2D cameras only; no lighting, terrain or 3D paths.</summary>
    public const string LeanTwoD = "scene/2d-lean";

    /// <summary>Whether the profile id addresses the lean 2D surface.</summary>
    public static bool IsLeanTwoD(string profileId) =>
        string.Equals(profileId, LeanTwoD, StringComparison.Ordinal);
}
