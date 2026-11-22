import { ITween, TweenableValue, TweenConfig } from './types';
import { PrimitiveTween } from './implementations/primitive-tween';
import { ArrayTween } from './implementations/array-tween';
import { ObjectTween } from './implementations/object-tween';

export class TweenFactory {
    static create<T extends TweenableValue>(object: T, config?: TweenConfig<T>): ITween<T> {
        // Runtime dispatch narrows `T` to a concrete tweenable shape that the
        // generic signature cannot express; each branch re-widens through
        // `unknown` so no branch silently accepts an unrelated type.
        let tween: ITween<T>;

        if (typeof object === 'number') {
            tween = new PrimitiveTween(
                object,
                config as TweenConfig<number>
            ) as unknown as ITween<T>;
        } else if (Array.isArray(object) || ArrayBuffer.isView(object)) {
            tween = new ArrayTween(
                object as unknown as ArrayLike<number>,
                config as unknown as TweenConfig<ArrayLike<number>>
            ) as unknown as ITween<T>;
        } else if (object && typeof object === 'object') {
            tween = new ObjectTween(
                object as object,
                config as TweenConfig<object>
            ) as unknown as ITween<T>;
        } else {
            throw new Error(`Cannot tween value of type ${typeof object}`);
        }

        if (config?.autoStart) {
            tween.start();
        }

        return tween;
    }
}
