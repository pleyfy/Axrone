export const createDefaultRandomGenerator = (): DefaultRandomGenerator =>
    new DefaultRandomGenerator();

export class DefaultRandomGenerator {
    private static instance: DefaultRandomGenerator | null = null;

    constructor() {}

    static getInstance(): DefaultRandomGenerator {
        if (!DefaultRandomGenerator.instance) {
            DefaultRandomGenerator.instance = new DefaultRandomGenerator();
        }
        return DefaultRandomGenerator.instance;
    }

    next(): number {
        return Math.random();
    }

    nextInRange(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    nextInt(min: number, max: number): number {
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    float(): number {
        return Math.random();
    }

    floatBetween(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    int(min: number, max: number): number {
        return Math.floor(min + Math.random() * (max - min + 1));
    }
}