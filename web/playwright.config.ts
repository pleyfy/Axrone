import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './packages',
    testMatch: '**/*.browser.{test,spec}.{js,ts}',

    use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },

        launchOptions: {
            args: [
                '--enable-webgl',
                '--enable-accelerated-2d-canvas',
                '--disable-web-security',
                '--allow-running-insecure-content',
            ],
        },
    },

    projects: [
        {
            name: 'webgl-tests',
            use: {
                browserName: 'chromium',

                headless: false,
            },
            testMatch: '**/webgl/**/*.browser.{test,spec}.{js,ts}',
        },
        {
            name: 'renderer-tests',
            use: {
                browserName: 'chromium',
                headless: false,
            },
            testMatch: '**/renderer/**/*.browser.{test,spec}.{js,ts}',
        },
        {
            name: 'integration-tests',
            use: {
                browserName: 'chromium',
                headless: false,
            },
            testMatch: '**/integration/**/*.browser.{test,spec}.{js,ts}',
        },
    ],

    reporter: [['html'], ['list']],

    timeout: 30000,
    expect: {
        timeout: 10000,
    },
});
