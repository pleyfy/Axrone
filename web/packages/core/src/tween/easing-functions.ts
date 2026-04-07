export type EasingFunction = (t: number) => number;

interface EasingCategory {
    readonly In: EasingFunction;
    readonly Out: EasingFunction;
    readonly InOut: EasingFunction;
}

export const Easing = {
    Linear: Object.freeze({
        None: (t: number): number => t,
    }),

    Quadratic: Object.freeze({
        In: (t: number): number => t * t,
        Out: (t: number): number => t * (2 - t),
        InOut: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    } as EasingCategory),

    Cubic: Object.freeze({
        In: (t: number): number => t * t * t,
        Out: (t: number): number => --t * t * t + 1,
        InOut: (t: number): number =>
            t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    } as EasingCategory),

    Quartic: Object.freeze({
        In: (t: number): number => t * t * t * t,
        Out: (t: number): number => 1 - --t * t * t * t,
        InOut: (t: number): number => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),
    } as EasingCategory),

    Quintic: Object.freeze({
        In: (t: number): number => t * t * t * t * t,
        Out: (t: number): number => 1 + --t * t * t * t * t,
        InOut: (t: number): number =>
            t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t,
    } as EasingCategory),

    Sinusoidal: Object.freeze({
        In: (t: number): number => 1 - Math.cos((t * Math.PI) / 2),
        Out: (t: number): number => Math.sin((t * Math.PI) / 2),
        InOut: (t: number): number => 0.5 * (1 - Math.cos(Math.PI * t)),
    } as EasingCategory),

    Exponential: Object.freeze({
        In: (t: number): number => (t === 0 ? 0 : Math.pow(1024, t - 1)),
        Out: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
        InOut: (t: number): number => {
            if (t === 0) return 0;
            if (t === 1) return 1;
            return t < 0.5 ? 0.5 * Math.pow(2, 20 * t - 10) : 0.5 * (2 - Math.pow(2, -20 * t + 10));
        },
    } as EasingCategory),

    Circular: Object.freeze({
        In: (t: number): number => 1 - Math.sqrt(1 - t * t),
        Out: (t: number): number => Math.sqrt(1 - --t * t),
        InOut: (t: number): number =>
            t < 0.5
                ? 0.5 * (1 - Math.sqrt(1 - 4 * t * t))
                : 0.5 * (Math.sqrt(1 - 4 * (t - 1) * (t - 1)) + 1),
    } as EasingCategory),

    Elastic: Object.freeze({
        In: (t: number): number => {
            if (t === 0) return 0;
            if (t === 1) return 1;
            return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
        },
        Out: (t: number): number => {
            if (t === 0) return 0;
            if (t === 1) return 1;
            return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
        },
        InOut: (t: number): number => {
            if (t === 0) return 0;
            if (t === 1) return 1;
            t *= 2;
            if (t < 1) {
                return -0.5 * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
            }
            return 0.5 * Math.pow(2, -10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI) + 1;
        },
    } as EasingCategory),

    Back: Object.freeze({
        In: (t: number): number => {
            const s = 1.70158;
            return t * t * ((s + 1) * t - s);
        },
        Out: (t: number): number => {
            const s = 1.70158;
            return --t * t * ((s + 1) * t + s) + 1;
        },
        InOut: (t: number): number => {
            const s = 1.70158 * 1.525;
            if ((t *= 2) < 1) {
                return 0.5 * (t * t * ((s + 1) * t - s));
            }
            return 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
        },
    } as EasingCategory),

    Bounce: Object.freeze({
        In: (t: number): number => 1 - Easing.Bounce.Out(1 - t),
        Out: (t: number): number => {
            if (t < 1 / 2.75) {
                return 7.5625 * t * t;
            } else if (t < 2 / 2.75) {
                return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
            } else if (t < 2.5 / 2.75) {
                return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
            } else {
                return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
            }
        },
        InOut: (t: number): number =>
            t < 0.5 ? Easing.Bounce.In(t * 2) * 0.5 : Easing.Bounce.Out(t * 2 - 1) * 0.5 + 0.5,
    } as EasingCategory),
} as const;
