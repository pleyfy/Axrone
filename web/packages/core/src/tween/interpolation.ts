import { BINOMIAL } from './binomial-cache';

function linearInterpolate(p0: number, p1: number, t: number): number {
    return (p1 - p0) * t + p0;
}

function catmullRomInterpolate(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t * t2;

    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

function bernstein(n: number, i: number): number {
    if (BINOMIAL[n]?.[i] !== undefined) {
        return BINOMIAL[n][i];
    }

    let a = 1;
    let b = 1;

    for (let j = 0; j < i; j++) {
        a *= n - j;
        b *= j + 1;
    }

    return a / b;
}

export const Interpolation = {
    Linear: (v: ArrayLike<number>, k: number): number => {
        const m = v.length - 1;
        const f = m * k;
        const i = Math.floor(f);

        if (k < 0) {
            return linearInterpolate(v[0], v[1], f);
        }

        if (k > 1) {
            return linearInterpolate(v[m], v[m - 1], m - f);
        }

        return linearInterpolate(v[i], v[i + 1 > m ? m : i + 1], f - i);
    },

    Bezier: (v: ArrayLike<number>, k: number): number => {
        let b = 0;
        const n = v.length - 1;

        for (let i = 0; i <= n; i++) {
            const binomialCoeff = BINOMIAL[n]?.[i] ?? bernstein(n, i);
            b += Math.pow(1 - k, n - i) * Math.pow(k, i) * v[i] * binomialCoeff;
        }

        return b;
    },

    CatmullRom: (v: ArrayLike<number>, k: number): number => {
        const m = v.length - 1;
        let f = m * k;
        let i = Math.floor(f);

        if (v[0] === v[m]) {
            if (k < 0) {
                i = Math.floor((f = m * (1 + k)));
            }

            return catmullRomInterpolate(
                v[(i - 1 + m) % m],
                v[i],
                v[(i + 1) % m],
                v[(i + 2) % m],
                f - i
            );
        } else {
            if (k < 0) {
                return v[0] - (catmullRomInterpolate(v[0], v[0], v[1], v[1], -f) - v[0]);
            }

            if (k > 1) {
                return v[m] - (catmullRomInterpolate(v[m], v[m], v[m - 1], v[m - 1], f - m) - v[m]);
            }

            return catmullRomInterpolate(
                v[i ? i - 1 : 0],
                v[i],
                v[m < i + 1 ? m : i + 1],
                v[m < i + 2 ? m : i + 2],
                f - i
            );
        }
    },

    Step: (v: ArrayLike<number>, k: number): number => {
        const m = v.length - 1;
        if (m === 0) return v[0];

        return k > 0 ? v[m] : v[0];
    },

    Smoothstep: (v: ArrayLike<number>, k: number): number => {
        const m = v.length - 1;
        const f = m * k;
        const i = Math.floor(f);
        const t = f - i;

        const smoothT = t * t * (3 - 2 * t);

        if (i === m) return v[m];
        return v[i] + smoothT * (v[i + 1] - v[i]);
    },
} as const;
