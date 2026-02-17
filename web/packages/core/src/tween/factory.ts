import { ITween, TweenableValue, TweenConfig } from './types';
import { PrimitiveTween } from './implementations/primitive-tween';
import { ArrayTween } from './implementations/array-tween';
import { ObjectTween } from './implementations/object-tween';

export class TweenFactory {
    static create<T extends TweenableValue>(object: T, config?: TweenConfig<T>): ITween<T> {
        if (typeof object === 'number') {
            return new PrimitiveTween(
                object,
                config as TweenConfig<number>
            ) as unknown as ITween<T>;
        } else if (Array.isArray(object) || ArrayBuffer.isView(object)) {
            return new ArrayTween(object as any, config) as unknown as ITween<T>;
        } else if (object && typeof object === 'object') {
            return new ObjectTween(
                object as object,
                config as TweenConfig<object>
            ) as unknown as ITween<T>;
        }

        throw new Error(`Cannot tween value of type ${typeof object}`);
    }
}
