import { HeapIndex, QueueSize, Capacity, Comparator } from './types';

export const createHeapIndex = (value: number): HeapIndex => value as HeapIndex;
export const createQueueSize = (value: number): QueueSize => value as QueueSize;
export const createCapacity = (value: number): Capacity => value as Capacity;

export const getParentIndex = (index: HeapIndex): HeapIndex =>
    (((index as number) - 1) >>> 1) as HeapIndex;

export const getLeftChildIndex = (index: HeapIndex): HeapIndex =>
    (((index as number) << 1) + 1) as HeapIndex;

export const getRightChildIndex = (index: HeapIndex): HeapIndex =>
    (((index as number) + 1) << 1) as HeapIndex;

export const hasParent = (index: HeapIndex): boolean => (index as number) > 0;

export const hasLeftChild = (index: HeapIndex, size: QueueSize): boolean =>
    ((index as number) << 1) + 1 < (size as number);

export const hasRightChild = (index: HeapIndex, size: QueueSize): boolean =>
    ((index as number) + 1) << 1 < (size as number);

export const defaultComparator = <T>(a: T, b: T): number => {
    return a < b ? -1 : a > b ? 1 : 0;
};

export const numericComparator = (a: number, b: number): number => {
    return a - b;
};

export const reverseComparator =
    <T>(comparator: Comparator<T>): Comparator<T> =>
    (a: T, b: T): number =>
        comparator(b, a);

export const compoundComparator = <T, U>(
    primaryExtractor: (item: T) => U,
    primaryComparator: Comparator<U>,
    secondaryExtractor?: (item: T) => U,
    secondaryComparator?: Comparator<U>
): Comparator<T> => {
    return (a: T, b: T): number => {
        const primaryResult = primaryComparator(primaryExtractor(a), primaryExtractor(b));

        if (primaryResult !== 0 || !secondaryExtractor || !secondaryComparator) {
            return primaryResult;
        }

        return secondaryComparator(secondaryExtractor(a), secondaryExtractor(b));
    };
};
