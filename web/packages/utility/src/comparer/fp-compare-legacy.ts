export class FpCompare {
    private readonly epsilon: number;
    private readonly absThreshold: number;

    /**
     * Creates a new FpCompare instance with the specified epsilon and absolute
     * threshold.
     *
     * @param epsilon The maximum allowed relative difference for considering
     * numbers equal.
     * @param absThreshold The minimum absolute difference for considering very
     * small numbers equal.
     */
    constructor(
        epsilon: number = Number.EPSILON,
        absThreshold: number = Math.min(Math.abs(Number.MIN_VALUE), epsilon)
    ) {
        if (epsilon <= 0 || epsilon >= 1) {
            throw new RangeError('Epsilon must be between 0 and 1 (exclusive)');
        }
        if (absThreshold <= 0) {
            throw new RangeError('absThreshold must be positive');
        }
        this.epsilon = epsilon;
        this.absThreshold = absThreshold;
    }

    /**
     * Compares two floating-point numbers for near equality using relative
     * comparison.
     *
     * @param a The first number.
     * @param b The second number.
     * @returns True if the absolute difference between a and b is less than
     * epsilon times their combined magnitude, false otherwise.
     */
    public nearlyEqual(a: number, b: number): boolean {
        const absDiff = Math.abs(a - b);
        const norm = Math.min(Math.abs(a) + Math.abs(b), Number.MAX_VALUE);
        return absDiff < Math.max(this.absThreshold, this.epsilon * norm);
    }

    /**
     * Compares two floating-point numbers for near equality using absolute
     * comparison. This is useful for very small numbers where relative comparison
     * might be unreliable.
     *
     * @param a The first number.
     * @param b The second number.
     * @returns True if the absolute difference between a and b is less than the
     * absThreshold, false otherwise.
     */
    public absolutelyEqual(a: number, b: number): boolean {
        return Math.abs(a - b) <= this.absThreshold;
    }

    /**
     * Compares two floating-point numbers for order with epsilon tolerance.
     *
     * @param a The first number.
     * @param b The second number.
     * @returns
     *  - 0 if a is equal to b within epsilon.
     *  - -1 if a is less than b within epsilon.
     *  - 1 if a is greater than b within epsilon.
     */
    public compare(a: number, b: number): number {
        const absDiff = Math.abs(a - b);
        if (absDiff < this.epsilon * Math.min(Math.abs(a) + Math.abs(b), Number.MAX_VALUE)) {
            return 0;
        } else if (a < b) {
            return -1;
        } else {
            return 1;
        }
    }

    /**
     * Returns the epsilon value used for comparisons.
     *
     * @returns The epsilon value.
     */
    public getEpsilon(): number {
        return this.epsilon;
    }

    /**
     * Returns the absolute threshold value used for comparisons.
     *
     * @returns The absolute threshold value.
     */
    public getAbsThreshold(): number {
        return this.absThreshold;
    }
}
