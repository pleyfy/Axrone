/**
 * Monotonic "something render-relevant changed in this world" counter.
 *
 * Components already bump their own `revision` from `touch()` whenever their
 * render-visible state changes, and the world bumps its structural mutations.
 * This clock is the single integer those events also advance, so a render
 * cache can answer "can anything I derived have changed?" with one comparison
 * instead of revalidating every cached entry (transform, visibility, texture,
 * mask, material) once per frame.
 *
 * The clock is a shared mutable box rather than a method on `World` so the
 * bump costs one field write on the per-component hot path — a 50k-sprite
 * dynamic frame bumps it once per moving sprite.
 *
 * A world always owns exactly one clock; components receive a reference when
 * they are attached to an actor and drop it when they are removed. Standalone
 * components (never added to an actor) have no clock and simply skip the bump.
 */
export interface RenderMutationClock {
    value: number;
}

export const createRenderMutationClock = (): RenderMutationClock => ({ value: 1 });

/** Advances a clock, tolerating components that outlive their world. */
export const bumpRenderMutationClock = (clock: RenderMutationClock | null): void => {
    if (clock !== null) {
        clock.value = (clock.value + 1) >>> 0;
    }
};
