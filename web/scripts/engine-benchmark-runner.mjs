import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const VALID_WORKLOADS = ['draw-call', 'triangle', 'mixed'];
const VALID_COMPARISON_MODES = ['no-culling', 'three-culling'];
const DEFAULT_OBJECT_COUNTS = [2600, 19600];
const DEFAULT_VIEWPORT = { width: 1600, height: 900 };
const DEFAULT_TIMEOUT_MS = 120000;
const MIN_UNSTABLE_METRIC_MEDIAN_MS = 5;
const MIN_UNSTABLE_METRIC_SPAN_MS = 10;

const metricNames = [
    'averageFps',
    'p95FrameTimeMs',
    'frameCount',
    'drawCalls',
    'triangles',
    'setupBuildTimeMs',
    'firstRenderTimeMs',
    'setupTimeMs',
];

const summarizePhaseMetrics = (runs, engineName) => {
    const phaseNames = new Set(
        runs.flatMap((run) => Object.keys(run.engines[engineName].buildPhases ?? {}))
    );

    return Object.fromEntries(
        [...phaseNames]
            .sort((left, right) => left.localeCompare(right))
            .map((phaseName) => [
                phaseName,
                summarizeMetric(
                    runs.map((run) => run.engines[engineName].buildPhases?.[phaseName] ?? 0)
                ),
            ])
    );
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '..');
const viteBinPath = path.resolve(workspaceDir, 'node_modules', 'vite', 'bin', 'vite.js');

const fail = (message) => {
    throw new Error(message);
};

const round = (value, digits = 2) => Number(value.toFixed(digits));

const mean = (values) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values, ratio) => {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
};

const standardDeviation = (values) => {
    if (values.length <= 1) {
        return 0;
    }

    const average = mean(values);
    const variance =
        values.reduce((sum, value) => sum + (value - average) * (value - average), 0) /
        values.length;
    return Math.sqrt(variance);
};

const parseInteger = (value, label) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        fail(`Invalid ${label}: ${value}`);
    }
    return parsed;
};

const parseNumberList = (value, label) =>
    value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => parseInteger(item, label));

const parseEnumList = (value, label, allowedValues) => {
    const values = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    for (const entry of values) {
        if (!allowedValues.includes(entry)) {
            fail(`Invalid ${label}: ${entry}. Allowed values: ${allowedValues.join(', ')}`);
        }
    }

    return values;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatMetric = (value, suffix) => `${value.toFixed(2)}${suffix}`;

const printHelp = () => {
    console.log(`Axrone engine benchmark runner

Options:
  --iterations=5            Measured repetitions per scenario
  --warmup=1                Warmup runs discarded before measurement
  --durationSec=15          Benchmark duration per run in seconds
  --objectCounts=2600,19600 Object counts to measure
  --workloads=draw-call,triangle,mixed
  --comparisonModes=no-culling,three-culling
  --host=127.0.0.1          Local examples server host
  --port=4173               Local examples server port
  --url=http://...          Reuse an existing benchmark page instead of starting Vite
  --headless                Run Chromium headless
    --reuseBrowser            Reuse one browser across scenarios instead of isolating each scenario
    --isolateRuns             Launch a fresh browser per warmup/measured run
  --keepServer              Leave the spawned Vite server running after completion
  --output=.tmp/benchmarks/engine-benchmark-report.json
  --help                    Show this help
`);
};

const { values: cli } = parseArgs({
    options: {
        iterations: { type: 'string' },
        warmup: { type: 'string' },
        durationSec: { type: 'string' },
        objectCounts: { type: 'string' },
        workloads: { type: 'string' },
        comparisonModes: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        url: { type: 'string' },
        output: { type: 'string' },
        headless: { type: 'boolean' },
        reuseBrowser: { type: 'boolean' },
        isolateRuns: { type: 'boolean' },
        keepServer: { type: 'boolean' },
        help: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
});

if (cli.help) {
    printHelp();
    process.exit(0);
}

const options = {
    iterations: parseInteger(cli.iterations ?? '5', 'iterations'),
    warmup: parseInteger(cli.warmup ?? '1', 'warmup'),
    durationSec: parseInteger(cli.durationSec ?? '15', 'durationSec'),
    objectCounts: cli.objectCounts
        ? parseNumberList(cli.objectCounts, 'objectCounts')
        : DEFAULT_OBJECT_COUNTS,
    workloads: cli.workloads
        ? parseEnumList(cli.workloads, 'workloads', VALID_WORKLOADS)
        : VALID_WORKLOADS,
    comparisonModes: cli.comparisonModes
        ? parseEnumList(cli.comparisonModes, 'comparisonModes', VALID_COMPARISON_MODES)
        : VALID_COMPARISON_MODES,
    host: cli.host ?? '127.0.0.1',
    port: parseInteger(cli.port ?? '4173', 'port'),
    url: cli.url ?? null,
    output: path.resolve(workspaceDir, cli.output ?? '.tmp/benchmarks/engine-benchmark-report.json'),
    headless: Boolean(cli.headless),
    reuseBrowser: Boolean(cli.reuseBrowser),
    isolateRuns: Boolean(cli.isolateRuns),
    keepServer: Boolean(cli.keepServer),
};

if (options.reuseBrowser && options.isolateRuns) {
    fail('reuseBrowser and isolateRuns cannot be used together.');
}

if (options.iterations <= 0) {
    fail('iterations must be greater than zero.');
}
if (options.warmup < 0) {
    fail('warmup must be zero or greater.');
}
if (options.durationSec <= 0) {
    fail('durationSec must be greater than zero.');
}
if (options.objectCounts.length === 0) {
    fail('At least one object count is required.');
}

const scenarios = options.workloads.flatMap((workload) =>
    options.comparisonModes.flatMap((comparisonMode) =>
        options.objectCounts.map((objectCount) => ({
            workload,
            comparisonMode,
            objectCount,
            durationSeconds: options.durationSec,
        }))
    )
);

const benchmarkPageUrl = (baseUrl) => `${baseUrl.replace(/\/$/, '')}/engine-benchmark.html`;

const startExamplesServer = async () => {
    if (!fs.existsSync(viteBinPath)) {
        fail('Missing local Vite binary. Run yarn install in Axrone/web before starting benchmark automation.');
    }

    const server = spawn(
        process.execPath,
        [viteBinPath, '--config', 'vite.examples.config.ts', '--host', options.host, '--port', String(options.port), '--strictPort'],
        {
            cwd: workspaceDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    const output = [];
    let ready = false;
    const pushOutput = (chunk) => {
        const text = chunk.toString();
        output.push(text);
        if (output.length > 30) {
            output.shift();
        }

        if (text.includes('ready in') || text.includes('Local:')) {
            ready = true;
        }
    };

    server.stdout.on('data', pushOutput);
    server.stderr.on('data', pushOutput);

    const url = `http://${options.host}:${options.port}`;
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
        const combinedOutput = output.join('');

        if (server.exitCode !== null) {
            fail(`Examples server exited early: ${combinedOutput.trim() || 'unknown error'}`);
        }

        if (
            combinedOutput.includes('Port ') &&
            combinedOutput.includes(' is already in use')
        ) {
            server.kill('SIGTERM');
            fail(`Examples server could not claim ${url}: ${combinedOutput.trim()}`);
        }

        if (ready) {
            try {
                const response = await fetch(benchmarkPageUrl(url), { cache: 'no-store' });
                if (response.ok) {
                    return { server, url };
                }
            } catch (error) {}
        } else {
            try {
                const response = await fetch(benchmarkPageUrl(url), { cache: 'no-store' });
                if (response.ok) {
                    // Another process is already serving this port. Wait for the spawned Vite
                    // process to prove ownership or fail explicitly instead of attaching to it.
                }
            }
            catch (error) {}
        }

        await delay(250);
    }

    server.kill('SIGTERM');
    fail(`Timed out waiting for examples server at ${url}. Last output:\n${output.join('').trim()}`);
};

const closeServer = async (server) => {
    if (!server || server.exitCode !== null) {
        return;
    }

    server.kill('SIGTERM');
    const deadline = Date.now() + 5_000;
    while (server.exitCode === null && Date.now() < deadline) {
        await delay(100);
    }

    if (server.exitCode === null) {
        server.kill('SIGKILL');
    }
};

const waitForBenchmarkApi = async (page, baseUrl) => {
    const errors = [];
    const recordError = (message) => {
        if (typeof message !== 'string' || message.length === 0) {
            return;
        }

        errors.push(message);
        if (errors.length > 10) {
            errors.shift();
        }
    };
    const handleConsole = (message) => {
        if (message.type() === 'error') {
            recordError(message.text());
        }
    };
    const handlePageError = (error) => {
        recordError(error instanceof Error ? error.stack ?? error.message : String(error));
    };

    page.on('console', handleConsole);
    page.on('pageerror', handlePageError);

    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await page.goto(benchmarkPageUrl(baseUrl), {
                waitUntil: 'domcontentloaded',
                timeout: DEFAULT_TIMEOUT_MS,
            });

            try {
                await page.waitForFunction(
                    () => Boolean(window.__AXRONE_ENGINE_BENCHMARK__),
                    undefined,
                    { timeout: DEFAULT_TIMEOUT_MS }
                );
                return;
            } catch (error) {
                if (attempt === 1) {
                    const detail = errors.length > 0 ? ` Recent page errors: ${errors.join(' | ')}` : '';
                    throw new Error(
                        `Benchmark automation API did not become available at ${benchmarkPageUrl(baseUrl)} within ${DEFAULT_TIMEOUT_MS} ms.${detail}`,
                    );
                }
            }
        }
    } finally {
        page.off('console', handleConsole);
        page.off('pageerror', handlePageError);
    }
};

const runSingleBenchmark = async (browser, baseUrl, scenario) => {
    const context = await browser.newContext({
        viewport: DEFAULT_VIEWPORT,
        deviceScaleFactor: 1,
        serviceWorkers: 'block',
    });
    const page = await context.newPage();

    try {
        await waitForBenchmarkApi(page, baseUrl);

        return await page.evaluate(async (payload) => {
            const api = window.__AXRONE_ENGINE_BENCHMARK__;
            if (!api) {
                throw new Error('Benchmark automation API is not available on the page.');
            }

            return api.runOnce({
                ...payload,
                timeoutMs: payload.durationSeconds * 1000 + 20_000,
            });
        }, scenario);
    } finally {
        await context.close();
    }
};

const summarizeMetric = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    const average = mean(sorted);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const stdev = standardDeviation(sorted);

    return {
        mean: round(average),
        median: round(median),
        p95: round(p95),
        min: round(min),
        max: round(max),
        stdev: round(stdev),
        coefficientOfVariationPct: average === 0 ? 0 : round((stdev / average) * 100),
        maxOverMedianRatio: median === 0 ? 0 : round(max / median),
    };
};

const summarizeEngine = (runs, engineName) => ({
    ...Object.fromEntries(
        metricNames.map((metricName) => [
            metricName,
            summarizeMetric(runs.map((run) => run.engines[engineName][metricName])),
        ])
    ),
    buildPhases: summarizePhaseMetrics(runs, engineName),
});

const getTopBuildPhases = (engineSummary, count = 3) =>
    Object.entries(engineSummary.buildPhases ?? {})
        .sort(([, left], [, right]) => right.mean - left.mean)
        .slice(0, count);

const collectUnstableMetrics = (engineSummary, engineName) => {
    const warnings = [];
    const considerMetric = (metricPath, metricSummary) => {
        if (!metricSummary || typeof metricSummary !== 'object' || !('coefficientOfVariationPct' in metricSummary)) {
            return;
        }

        if (
            metricSummary.coefficientOfVariationPct >= 25 &&
            metricSummary.maxOverMedianRatio >= 2.5 &&
            (
                metricSummary.median >= MIN_UNSTABLE_METRIC_MEDIAN_MS ||
                metricSummary.max - metricSummary.min >= MIN_UNSTABLE_METRIC_SPAN_MS
            )
        ) {
            warnings.push({
                engine: engineName,
                metric: metricPath,
                coefficientOfVariationPct: metricSummary.coefficientOfVariationPct,
                maxOverMedianRatio: metricSummary.maxOverMedianRatio,
            });
        }
    };

    for (const metricName of metricNames) {
        considerMetric(metricName, engineSummary[metricName]);
    }

    for (const [phaseName, phaseSummary] of Object.entries(engineSummary.buildPhases ?? {})) {
        considerMetric(`buildPhases.${phaseName}`, phaseSummary);
    }

    return warnings;
};

const compareMetricMeans = (axroneMetric, threeMetric, higherIsBetter) => {
    const axroneMean = axroneMetric.mean;
    const threeMean = threeMetric.mean;
    const delta = round(axroneMean - threeMean);
    const percentVsThree = threeMean === 0 ? 0 : round((delta / threeMean) * 100);
    const leader =
        Math.abs(delta) < 0.0001
            ? 'tie'
            : higherIsBetter
              ? axroneMean > threeMean
                  ? 'axrone'
                  : 'three'
              : axroneMean < threeMean
                ? 'axrone'
                : 'three';

    return {
        axroneMean,
        threeMean,
        delta,
        percentVsThree,
        leader,
    };
};

const summarizeScenario = (runs) => {
    const axrone = summarizeEngine(runs, 'axrone');
    const three = summarizeEngine(runs, 'three');
    const qualityFlags = [
        ...collectUnstableMetrics(axrone, 'axrone'),
        ...collectUnstableMetrics(three, 'three'),
    ];

    return {
        runCount: runs.length,
        engines: {
            axrone,
            three,
        },
        qualityFlags,
        deltas: {
            averageFps: compareMetricMeans(axrone.averageFps, three.averageFps, true),
            p95FrameTimeMs: compareMetricMeans(axrone.p95FrameTimeMs, three.p95FrameTimeMs, false),
            setupBuildTimeMs: compareMetricMeans(axrone.setupBuildTimeMs, three.setupBuildTimeMs, false),
            firstRenderTimeMs: compareMetricMeans(axrone.firstRenderTimeMs, three.firstRenderTimeMs, false),
            setupTimeMs: compareMetricMeans(axrone.setupTimeMs, three.setupTimeMs, false),
        },
    };
};

const printScenarioSummary = (scenarioReport) => {
    const { scenario, summary } = scenarioReport;
    const axroneTopPhases = getTopBuildPhases(summary.engines.axrone);
    const threeTopPhases = getTopBuildPhases(summary.engines.three);

    console.log(
        `\n${scenario.workload} | ${scenario.comparisonMode} | ${scenario.objectCount.toLocaleString('en-US')} objects | ${summary.runCount} measured run(s)`
    );
    console.log(
        `  Build mean   Axrone ${formatMetric(summary.engines.axrone.setupBuildTimeMs.mean, ' ms')} | Three ${formatMetric(summary.engines.three.setupBuildTimeMs.mean, ' ms')} | leader ${summary.deltas.setupBuildTimeMs.leader}`
    );
    console.log(
        `  First render Axrone ${formatMetric(summary.engines.axrone.firstRenderTimeMs.mean, ' ms')} | Three ${formatMetric(summary.engines.three.firstRenderTimeMs.mean, ' ms')} | leader ${summary.deltas.firstRenderTimeMs.leader}`
    );
    console.log(
        `  FPS mean     Axrone ${formatMetric(summary.engines.axrone.averageFps.mean, '')} | Three ${formatMetric(summary.engines.three.averageFps.mean, '')} | leader ${summary.deltas.averageFps.leader}`
    );
    console.log(
        `  P95 mean     Axrone ${formatMetric(summary.engines.axrone.p95FrameTimeMs.mean, ' ms')} | Three ${formatMetric(summary.engines.three.p95FrameTimeMs.mean, ' ms')} | leader ${summary.deltas.p95FrameTimeMs.leader}`
    );

    if (axroneTopPhases.length > 0) {
        console.log(
            `  Axrone top build phases ${axroneTopPhases
                .map(([phaseName, phase]) => `${phaseName}=${formatMetric(phase.mean, ' ms')}`)
                .join(' | ')}`
        );
    }

    if (threeTopPhases.length > 0) {
        console.log(
            `  Three top build phases  ${threeTopPhases
                .map(([phaseName, phase]) => `${phaseName}=${formatMetric(phase.mean, ' ms')}`)
                .join(' | ')}`
        );
    }

    if (summary.qualityFlags.length > 0) {
        console.log(
            `  Stability warnings ${summary.qualityFlags
                .map(
                    (warning) =>
                        `${warning.engine}.${warning.metric} cv=${warning.coefficientOfVariationPct.toFixed(2)}% ratio=${warning.maxOverMedianRatio.toFixed(2)}`
                )
                .join(' | ')}`
        );
    }
};

let browser;
let server;

try {
    const startedServer = options.url ? null : await startExamplesServer();
    const baseUrl = options.url ? options.url.replace(/\/$/, '') : startedServer.url;
    server = startedServer?.server ?? null;
    const launchBrowser = () =>
        chromium.launch({
            headless: options.headless,
            args: [
                '--enable-webgl',
                '--enable-accelerated-2d-canvas',
                '--disable-web-security',
                '--allow-running-insecure-content',
            ],
        });
    const getScenarioBrowser = async () => {
        if (options.reuseBrowser) {
            browser ??= await launchBrowser();
            return browser;
        }

        return launchBrowser();
    };
    const runWithBrowser = async (callback) => {
        if (options.isolateRuns) {
            const isolatedBrowser = await launchBrowser();

            try {
                return await callback(isolatedBrowser);
            } finally {
                await isolatedBrowser.close();
            }
        }

        const scenarioBrowser = await getScenarioBrowser();
        return callback(scenarioBrowser);
    };

    let browserVersion = '';
    let userAgent = '';

    const scenarioReports = [];

    for (const scenario of scenarios) {
        await runWithBrowser(async (probeBrowser) => {
            if (browserVersion && userAgent) {
                return;
            }

            const context = await probeBrowser.newContext({
                viewport: DEFAULT_VIEWPORT,
                deviceScaleFactor: 1,
            });
            const page = await context.newPage();

            try {
                await waitForBenchmarkApi(page, baseUrl);
                browserVersion = probeBrowser.version();
                userAgent = await page.evaluate(() => navigator.userAgent);
            } finally {
                await context.close();
            }
        });

        console.log(
            `Running ${scenario.workload} / ${scenario.comparisonMode} / ${scenario.objectCount} objects (${options.warmup} warmup + ${options.iterations} measured)`
        );

        try {
            for (let warmupIndex = 0; warmupIndex < options.warmup; warmupIndex += 1) {
                await runWithBrowser((benchmarkBrowser) =>
                    runSingleBenchmark(benchmarkBrowser, baseUrl, scenario)
                );
            }

            const measuredRuns = [];
            for (let runIndex = 0; runIndex < options.iterations; runIndex += 1) {
                const snapshot = await runWithBrowser((benchmarkBrowser) =>
                    runSingleBenchmark(benchmarkBrowser, baseUrl, scenario)
                );
                measuredRuns.push(snapshot);
            }

            const scenarioReport = {
                scenario,
                summary: summarizeScenario(measuredRuns),
                rawRuns: measuredRuns,
            };
            scenarioReports.push(scenarioReport);
            printScenarioSummary(scenarioReport);
        } finally {
            if (!options.reuseBrowser && !options.isolateRuns) {
                await scenarioBrowser.close();
            }
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        environment: {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            browserVersion,
            userAgent,
            headless: options.headless,
            viewport: DEFAULT_VIEWPORT,
        },
        config: {
            iterations: options.iterations,
            warmup: options.warmup,
            durationSec: options.durationSec,
            workloads: options.workloads,
            comparisonModes: options.comparisonModes,
            objectCounts: options.objectCounts,
            isolateRuns: options.isolateRuns,
            baseUrl,
        },
        scenarios: scenarioReports,
    };

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`\nBenchmark report written to ${path.relative(workspaceDir, options.output)}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    if (browser) {
        await browser.close();
    }

    if (server && !options.keepServer) {
        await closeServer(server);
    }
}