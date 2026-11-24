namespace Axrone.Scene.Rendering;

/// <summary>Read-only view over one particle system's dense storage.</summary>
public readonly ref struct SceneParticleSnapshot
{
    /// <summary>Creates a snapshot over dense storage streams.</summary>
    public SceneParticleSnapshot(
        SceneEntity entity,
        int count,
        ReadOnlySpan<float> posX,
        ReadOnlySpan<float> posY,
        ReadOnlySpan<float> posZ,
        ReadOnlySpan<float> colR,
        ReadOnlySpan<float> colG,
        ReadOnlySpan<float> colB,
        ReadOnlySpan<float> colA,
        ReadOnlySpan<float> size)
    {
        Entity = entity;
        Count = count;
        PosX = posX;
        PosY = posY;
        PosZ = posZ;
        ColR = colR;
        ColG = colG;
        ColB = colB;
        ColA = colA;
        Size = size;
    }

    /// <summary>Owning entity.</summary>
    public SceneEntity Entity { get; }

    /// <summary>Live particle count.</summary>
    public int Count { get; }

    /// <summary>Position X stream.</summary>
    public ReadOnlySpan<float> PosX { get; }

    /// <summary>Position Y stream.</summary>
    public ReadOnlySpan<float> PosY { get; }

    /// <summary>Position Z stream.</summary>
    public ReadOnlySpan<float> PosZ { get; }

    /// <summary>Red stream.</summary>
    public ReadOnlySpan<float> ColR { get; }

    /// <summary>Green stream.</summary>
    public ReadOnlySpan<float> ColG { get; }

    /// <summary>Blue stream.</summary>
    public ReadOnlySpan<float> ColB { get; }

    /// <summary>Alpha stream.</summary>
    public ReadOnlySpan<float> ColA { get; }

    /// <summary>Uniform size stream.</summary>
    public ReadOnlySpan<float> Size { get; }
}

/// <summary>Source of particle systems for a backend renderer.</summary>
public interface ISceneParticleSource
{
    /// <summary>Number of live particle systems.</summary>
    int SystemCount { get; }

    /// <summary>Returns a render view over one system's dense storage.</summary>
    SceneParticleSnapshot GetSnapshot(int index);
}
