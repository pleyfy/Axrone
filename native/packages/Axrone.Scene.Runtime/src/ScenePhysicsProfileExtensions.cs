namespace Axrone.Scene.Runtime;

/// <summary>Profile composition helpers for 3D physics components.</summary>
public static class ScenePhysicsProfileExtensions
{
    /// <summary>Registers the 3D rigidbody, collider and joint components.</summary>
    public static SceneProfileBuilder AddPhysics3D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneRigidbody3D>(
            "Rigidbody3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 200);

        builder.AddData<SceneCollider3D>(
            "Collider3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 150);

        return builder.AddJoints3D();
    }

    /// <summary>Registers the 2D rigidbody, collider and joint components.</summary>
    public static SceneProfileBuilder AddPhysics2D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneRigidbody2D>(
            "Rigidbody2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 200);

        builder.AddData<SceneCollider2D>(
            "Collider2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 150);

        return builder.AddJoints2D();
    }

    /// <summary>Registers the 3D joint data components on top of a physics profile.</summary>
    public static SceneProfileBuilder AddJoints3D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneFixedJoint3D>(
            "FixedJoint3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneHingeJoint3D>(
            "HingeJoint3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneSliderJoint3D>(
            "SliderJoint3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneSpringJoint3D>(
            "SpringJoint3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneCharacterJoint3D>(
            "CharacterJoint3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneConfigurableJoint3D>(
            "ConfigurableJoint3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        return builder;
    }

    /// <summary>Registers the 2D joint data components on top of a physics profile.</summary>
    public static SceneProfileBuilder AddJoints2D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneDistanceJoint2D>(
            "DistanceJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneHingeJoint2D>(
            "HingeJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneFixedJoint2D>(
            "FixedJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneSliderJoint2D>(
            "SliderJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneSpringJoint2D>(
            "SpringJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneMotorJoint2D>(
            "MotorJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneWheelJoint2D>(
            "WheelJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneRopeJoint2D>(
            "RopeJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneMouseJoint2D>(
            "MouseJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        builder.AddData<SceneGearJoint2D>(
            "GearJoint2D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        return builder;
    }
}
