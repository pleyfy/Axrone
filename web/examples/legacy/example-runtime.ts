import type { Scene } from '@axrone/scene-3d';

export const bindSceneToContainer = (
    scene: Scene,
    container: HTMLElement,
    fallbackWidth: number,
    fallbackHeight: number
): (() => void) => {
    const resize = () => {
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width || fallbackWidth));
        const height = Math.max(1, Math.floor(rect.height || fallbackHeight));
        scene.resize(width, height);
    };

    resize();

    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => resize());
        observer.observe(container);
        return () => observer.disconnect();
    }

    const handleResize = () => resize();
    globalThis.addEventListener('resize', handleResize);

    return () => {
        globalThis.removeEventListener('resize', handleResize);
    };
};
