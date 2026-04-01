import './styles.css';
import type { ExampleHandle, SceneExample } from './example-types';

type ExampleModule = {
    readonly default: SceneExample;
};

const loaders = import.meta.glob('./*.ts') as Record<string, () => Promise<ExampleModule>>;
const ignoredModules = new Set(['./main.ts', './example-types.ts', './example-runtime.ts']);

const resolveExamples = async (): Promise<readonly SceneExample[]> => {
    const entries = Object.entries(loaders).filter(([path]) => !ignoredModules.has(path));
    const modules = await Promise.all(entries.map(async ([, load]) => (await load()).default));

    return modules.sort((left, right) => {
        const orderDelta =
            (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
        if (orderDelta !== 0) {
            return orderDelta;
        }

        return left.title.localeCompare(right.title);
    });
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
    throw new Error('Examples app root was not found');
}

app.innerHTML = `
    <div class="shell">
        <aside class="sidebar">
            <div class="brand-block">
                <span class="eyebrow">Axrone</span>
                <h1>Example Runner</h1>
                <p>Yeni example dosyalari ekleyip otomatik olarak listede gorebilir, sahneleri izole sekilde mount edebilirsin.</p>
            </div>
            <div class="command-block">
                <span class="command-label">Commands</span>
                <code>npm run examples:dev</code>
                <code>npm run examples:build</code>
            </div>
            <nav class="example-list" aria-label="Examples"></nav>
        </aside>
        <main class="stage-layout">
            <header class="stage-header">
                <div>
                    <span class="eyebrow">Live Preview</span>
                    <h2 id="example-title">Select an example</h2>
                </div>
                <p id="example-description">Engine yuzeyini sahne bazli scriptlerle dogrudan denemek icin bir example sec.</p>
            </header>
            <section class="stage-frame">
                <div id="example-host" class="example-host"></div>
                <div id="stage-status" class="stage-status">Loading examples...</div>
            </section>
        </main>
    </div>
`;

const list = app.querySelector<HTMLElement>('.example-list');
const host = app.querySelector<HTMLElement>('#example-host');
const title = app.querySelector<HTMLElement>('#example-title');
const description = app.querySelector<HTMLElement>('#example-description');
const status = app.querySelector<HTMLElement>('#stage-status');

if (!list || !host || !title || !description || !status) {
    throw new Error('Examples UI failed to initialize');
}

let currentHandle: ExampleHandle | undefined;
let currentId = '';

const setStatus = (message: string, mode: 'loading' | 'ready' | 'error' = 'ready') => {
    status.textContent = message;
    status.dataset.mode = mode;
};

const unmountCurrentExample = async () => {
    if (!currentHandle) {
        host.replaceChildren();
        return;
    }

    await currentHandle.dispose();
    currentHandle = undefined;
    host.replaceChildren();
};

const selectExample = async (example: SceneExample) => {
    if (currentId === example.id) {
        return;
    }

    currentId = example.id;
    title.textContent = example.title;
    description.textContent = example.description;
    setStatus('Preparing scene...', 'loading');

    list.querySelectorAll<HTMLButtonElement>('button[data-example-id]').forEach((button) => {
        button.dataset.active = String(button.dataset.exampleId === example.id);
    });

    try {
        await unmountCurrentExample();
        const maybeHandle = await example.mount({ container: host });
        currentHandle = maybeHandle ?? undefined;
        location.hash = example.id;
        setStatus('Scene ready', 'ready');
    } catch (error) {
        currentHandle = undefined;
        host.replaceChildren();
        setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
};

const bootstrap = async () => {
    const examples = await resolveExamples();

    for (const example of examples) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'example-card';
        button.dataset.exampleId = example.id;
        button.dataset.active = 'false';
        button.innerHTML = `
            <span class="example-title">${example.title}</span>
            <span class="example-description">${example.description}</span>
            <span class="example-tags">${(example.tags ?? []).join(' • ')}</span>
        `;
        button.addEventListener('click', () => {
            void selectExample(example);
        });
        list.appendChild(button);
    }

    if (examples.length === 0) {
        setStatus('No examples were discovered in the examples folder.', 'error');
        return;
    }

    const hashMatch = examples.find((example) => example.id === location.hash.slice(1));
    await selectExample(hashMatch ?? examples[0]);

    globalThis.addEventListener('hashchange', () => {
        const nextExample = examples.find((example) => example.id === location.hash.slice(1));
        if (nextExample) {
            void selectExample(nextExample);
        }
    });
};

void bootstrap().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
});
