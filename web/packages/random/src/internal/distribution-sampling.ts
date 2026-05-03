import type { DistributionSample, IRandomState, RandomResult } from '../types';

const validateSampleCount = (count: number): void => {
    if (count <= 0 || !Number.isInteger(count)) {
        throw new RangeError('Count must be a positive integer');
    }
};

export const sampleManyFromDistribution = <T>(
    state: IRandomState,
    count: number,
    sample: (state: IRandomState) => RandomResult<T>
): RandomResult<readonly T[]> => {
    validateSampleCount(count);

    const result: T[] = [];
    let currentState = state;

    for (let index = 0; index < count; index += 1) {
        const [value, nextState] = sample(currentState);
        result.push(value);
        currentState = nextState;
    }

    return [result, currentState];
};

export const sampleWithDistributionMetadata = <T>(
    state: IRandomState,
    sample: (state: IRandomState) => RandomResult<T>,
    createSample: (value: T) => DistributionSample<T>
): RandomResult<DistributionSample<T>> => {
    const [value, nextState] = sample(state);
    return [createSample(value), nextState];
};

export const sampleManyWithDistributionMetadata = <T>(
    state: IRandomState,
    count: number,
    sampleMany: (state: IRandomState, count: number) => RandomResult<readonly T[]>,
    createSample: (value: T) => DistributionSample<T>
): RandomResult<readonly DistributionSample<T>[]> => {
    const [values, nextState] = sampleMany(state, count);
    return [values.map((value) => createSample(value)), nextState];
};