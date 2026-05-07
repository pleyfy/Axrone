import { startPlaygroundApp } from './playground-app';

export const bootstrapPlayground = async (): Promise<void> => {
    const app = document.querySelector<HTMLDivElement>('#app');

    if (!app) {
        throw new Error('Examples app root was not found');
    }

    await startPlaygroundApp(app);
};