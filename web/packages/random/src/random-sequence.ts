import { validateInteger, validateNonNegative } from './constants';
import type { IRandomSequence } from './types';

export class RandomSequence<T> implements IRandomSequence<T> {
    constructor(private readonly _generator: () => T) {}

    public next = (): T => {
        return this._generator();
    };

    public take = (count: number): T[] => {
        validateNonNegative(count, 'count');
        validateInteger(count, 'count');

        const result: T[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this._generator());
        }
        return result;
    };

    public skip = (count: number): void => {
        validateNonNegative(count, 'count');
        validateInteger(count, 'count');

        for (let i = 0; i < count; i++) {
            this._generator();
        }
    };

    public map = <U>(fn: (value: T) => U): IRandomSequence<U> => {
        return new RandomSequence<U>(() => fn(this._generator()));
    };

    public filter = (
        predicate: (value: T) => boolean,
        maxAttempts: number = 100
    ): IRandomSequence<T> => {
        return new RandomSequence<T>(() => {
            let attempts = 0;
            while (attempts < maxAttempts) {
                const value = this._generator();
                if (predicate(value)) {
                    return value;
                }
                attempts++;
            }
            throw new Error(
                `RandomSequence.filter: No value matched the predicate after ${maxAttempts} attempts.`
            );
        });
    };
}