export const PHYSICS_ITERATION_POLICY = {
    velocityIterations: 10,
    positionIterations: 4
} as const;

export type PhysicsIterationPolicy = typeof PHYSICS_ITERATION_POLICY;
