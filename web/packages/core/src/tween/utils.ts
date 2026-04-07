import { DeepPartial } from '@axrone/utility';
import { TweenFactory } from './factory';
import { Timeline } from './timeline';
import { TweenGroup } from './group';
import { TweenChain } from './chain';
import { Spring } from './spring';
import { TweenSystem } from './system';
import { Easing, EasingFunction } from './easing-functions';
import { ITween, ITimeline, TweenableValue, TweenConfig, SpringConfig } from './types';

export const TWEEN = new TweenSystem();

export function tween<T extends TweenableValue>(object: T, config?: TweenConfig<T>): ITween<T> {
    const tween = TweenFactory.create(object, config);
    if (config?.autoStart) {
        TWEEN.add(tween);
    }
    return tween;
}

export function timeline(): ITimeline {
    return new Timeline();
}

export function group(): TweenGroup {
    return new TweenGroup();
}

export function chain(): TweenChain {
    return new TweenChain();
}

export function spring<T extends TweenableValue>(initial: T, config?: SpringConfig): Spring<T> {
    return new Spring<T>(initial, config);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function to<T extends TweenableValue>(
    object: T,
    properties: DeepPartial<T>,
    duration = 1000,
    easing: EasingFunction = Easing.Linear.None
): ITween<T> {
    return TweenFactory.create(object, {
        to: properties,
        duration,
        easing,
    });
}

export function from<T extends TweenableValue>(
    object: T,
    properties: DeepPartial<T>,
    duration = 1000,
    easing: EasingFunction = Easing.Linear.None
): ITween<T> {
    const targetState = JSON.parse(JSON.stringify(object));

    return TweenFactory.create(object, {
        from: properties,
        to: targetState,
        duration,
        easing,
    });
}

export function fromTo<T extends TweenableValue>(
    object: T,
    fromProperties: DeepPartial<T>,
    toProperties: DeepPartial<T>,
    duration = 1000,
    easing: EasingFunction = Easing.Linear.None
): ITween<T> {
    return TweenFactory.create(object, {
        from: fromProperties,
        to: toProperties,
        duration,
        easing,
    });
}

export async function waitFor(tween: ITween<any>): Promise<void> {
    if (tween.getStatus() === 'completed') {
        return;
    }

    return new Promise((resolve) => {
        tween.on('complete', () => resolve());
    });
}
