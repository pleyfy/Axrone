import {
    Subject,
    BehaviorSubject,
    ReplaySubject,
    ObserverChain,
    SubjectGroup,
    chain,
    merge,
    combineLatest,
    IObservableSubject,
    ObserverCallback,
    ObserverOptions,
    SubjectOptions,
} from './index';

type UserEvent = { userId: string; action: string; timestamp: number };
type MessageEvent = { messageId: string; userId: string; content: string; timestamp: number };
type SystemEvent = { type: string; message: string; timestamp: number };
type SensorData = { sensor: string; value: number; timestamp: number };
type ProcessedData = { sensor: string; processedValue: number; alert?: boolean; timestamp: number };
type AlertData = { level: 'warning' | 'critical'; message: string; timestamp: number };
type MetricData = {
    metric: string;
    value: number;
    timestamp: number;
    tags?: Record<string, string>;
};
type ActionData = { type: string; payload?: any };

export class ChatEventSystem {
    private userEvents = new Subject<UserEvent>();
    private messageEvents = new Subject<MessageEvent>();
    private systemEvents = new ReplaySubject<SystemEvent>({
        replay: { enabled: true, bufferSize: 10 },
    });

    private onlineUsers = new BehaviorSubject<string[]>([]);

    constructor() {
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.userEvents.addObserver((event: UserEvent) => {
            console.log(
                `User Event: ${event.userId} ${event.action} at ${new Date(event.timestamp).toISOString()}`
            );
        });

        this.userEvents.addObserver((event: UserEvent) => {
            const currentUsers = this.onlineUsers.value;
            if (event.action === 'login' && !currentUsers.includes(event.userId)) {
                this.onlineUsers.notify([...currentUsers, event.userId]);
            } else if (event.action === 'logout') {
                this.onlineUsers.notify(currentUsers.filter((id: string) => id !== event.userId));
            }
        });

        const messageChain = chain(this.messageEvents);
        messageChain
            .throttle(100)
            .filter((msg: MessageEvent) => msg.content.length > 0)
            .subscribe((message: MessageEvent) => {
                this.broadcastMessage(message);
            });

        const userChain = chain(this.userEvents);
        userChain
            .filter((event: UserEvent) => event.action === 'login')
            .buffer(5, 10000)
            .subscribe((events: UserEvent[]) => {
                if (events.length >= 5) {
                    this.systemEvents.notify({
                        type: 'high_activity',
                        message: `High login activity detected: ${events.length} logins in 10 seconds`,
                        timestamp: Date.now(),
                    });
                }
            });
    }

    public userLogin(userId: string): void {
        this.userEvents.notify({
            userId,
            action: 'login',
            timestamp: Date.now(),
        });
    }

    public userLogout(userId: string): void {
        this.userEvents.notify({
            userId,
            action: 'logout',
            timestamp: Date.now(),
        });
    }

    public sendMessage(userId: string, content: string): void {
        this.messageEvents.notify({
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId,
            content,
            timestamp: Date.now(),
        });
    }

    public subscribeToMessages(callback: ObserverCallback<MessageEvent>): () => boolean {
        return this.messageEvents.addObserver(callback);
    }

    public subscribeToOnlineUsers(callback: ObserverCallback<string[]>): () => boolean {
        return this.onlineUsers.addObserver(callback);
    }

    public subscribeToSystemEvents(callback: ObserverCallback<SystemEvent>): () => boolean {
        return this.systemEvents.addObserver(callback);
    }

    private broadcastMessage(message: MessageEvent): void {
        console.log(`Broadcasting message from ${message.userId}: ${message.content}`);
    }

    public dispose(): void {
        this.userEvents.dispose();
        this.messageEvents.dispose();
        this.systemEvents.dispose();
        this.onlineUsers.dispose();
    }
}

export class DataProcessingPipeline {
    private rawDataSource = new Subject<SensorData>();
    private processedData = new Subject<ProcessedData>();
    private alerts = new Subject<AlertData>();

    constructor() {
        this.setupPipeline();
    }

    private setupPipeline(): void {
        const validatedData = chain(this.rawDataSource)
            .filter((data: SensorData) => data.value >= 0 && data.value <= 1000) // Valid range
            .filter((data: SensorData) => Boolean(data.sensor && data.sensor.length > 0));

        validatedData
            .debounce(100)
            .map(
                (data: SensorData) =>
                    ({
                        ...data,
                        processedValue: this.calculateMovingAverage(data.sensor, data.value),
                    }) as ProcessedData
            )
            .subscribe((data: ProcessedData) => {
                this.processedData.notify(data);
            });

        validatedData
            .filter((data: SensorData) => data.value > 800)
            .subscribe((data: SensorData) => {
                this.alerts.notify({
                    level: data.value > 950 ? 'critical' : 'warning',
                    message: `High ${data.sensor} reading: ${data.value}`,
                    timestamp: Date.now(),
                });
            });

        validatedData.buffer(100, 5000).subscribe((batch: SensorData[]) => {
            this.processBatch(batch);
        });
    }

    private movingAverages = new Map<string, number[]>();

    private calculateMovingAverage(sensor: string, value: number): number {
        if (!this.movingAverages.has(sensor)) {
            this.movingAverages.set(sensor, []);
        }

        const values = this.movingAverages.get(sensor)!;
        values.push(value);

        if (values.length > 10) {
            values.shift();
        }

        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    private processBatch(batch: SensorData[]): void {
        const analytics = {
            count: batch.length,
            avgValue: batch.reduce((sum, item) => sum + item.value, 0) / batch.length,
            sensors: [...new Set(batch.map((item) => item.sensor))],
            timestamp: Date.now(),
        };

        console.log('Batch Analytics:', analytics);
    }

    public ingestData(sensor: string, value: number): void {
        this.rawDataSource.notify({
            sensor,
            value,
            timestamp: Date.now(),
        });
    }

    public subscribeToProcessedData(callback: ObserverCallback<ProcessedData>): () => boolean {
        return this.processedData.addObserver(callback);
    }

    public subscribeToAlerts(callback: ObserverCallback<AlertData>): () => boolean {
        return this.alerts.addObserver(callback);
    }

    public dispose(): void {
        this.rawDataSource.dispose();
        this.processedData.dispose();
        this.alerts.dispose();
    }
}

interface AppState {
    user: { id: string; name: string; role: string } | null;
    notifications: Array<{ id: string; message: string; type: string; timestamp: number }>;
    settings: { theme: 'light' | 'dark'; language: string; notifications: boolean };
    loading: boolean;
}

export class StateManager {
    private userState = new BehaviorSubject<AppState['user']>(null);
    private notificationsState = new BehaviorSubject<AppState['notifications']>([]);
    private settingsState = new BehaviorSubject<AppState['settings']>({
        theme: 'light',
        language: 'en',
        notifications: true,
    });
    private loadingState = new BehaviorSubject<boolean>(false);

    private appState: IObservableSubject<AppState>;

    private userActions = new Subject<ActionData>();
    private notificationActions = new Subject<ActionData>();
    private settingActions = new Subject<ActionData>();

    constructor() {
        this.setupReducers();
        this.appState = this.createCombinedState();
        this.setupMiddleware();
    }

    private setupReducers(): void {
        this.userActions.addObserver((action: ActionData) => {
            const currentUser = this.userState.value;

            switch (action.type) {
                case 'LOGIN':
                    this.userState.notify(action.payload);
                    break;
                case 'LOGOUT':
                    this.userState.notify(null);
                    break;
                case 'UPDATE_PROFILE':
                    if (currentUser) {
                        this.userState.notify({ ...currentUser, ...action.payload });
                    }
                    break;
            }
        });

        this.notificationActions.addObserver((action: ActionData) => {
            const currentNotifications = this.notificationsState.value;

            switch (action.type) {
                case 'ADD_NOTIFICATION':
                    this.notificationsState.notify([...currentNotifications, action.payload]);
                    break;
                case 'REMOVE_NOTIFICATION':
                    this.notificationsState.notify(
                        currentNotifications.filter((n: any) => n.id !== action.payload.id)
                    );
                    break;
                case 'CLEAR_NOTIFICATIONS':
                    this.notificationsState.notify([]);
                    break;
            }
        });

        this.settingActions.addObserver((action: ActionData) => {
            const currentSettings = this.settingsState.value;

            switch (action.type) {
                case 'UPDATE_SETTINGS':
                    this.settingsState.notify({ ...currentSettings, ...action.payload });
                    break;
                case 'RESET_SETTINGS':
                    this.settingsState.notify({
                        theme: 'light',
                        language: 'en',
                        notifications: true,
                    });
                    break;
            }
        });
    }

    private createCombinedState(): IObservableSubject<AppState> {
        const combinedState = new Subject<AppState>();

        const updateCombinedState = () => {
            const state: AppState = {
                user: this.userState.value,
                notifications: this.notificationsState.value,
                settings: this.settingsState.value,
                loading: this.loadingState.value,
            };
            combinedState.notify(state);
        };

        this.userState.addObserver(updateCombinedState);
        this.notificationsState.addObserver(updateCombinedState);
        this.settingsState.addObserver(updateCombinedState);
        this.loadingState.addObserver(updateCombinedState);

        return combinedState;
    }

    private setupMiddleware(): void {
        const logAction = (action: ActionData) => {
            console.log('Action dispatched:', action);
        };

        this.userActions.addObserver(logAction);
        this.notificationActions.addObserver(logAction);
        this.settingActions.addObserver(logAction);

        this.notificationActions.addObserver((action: ActionData) => {
            if (action.type === 'ADD_NOTIFICATION') {
                setTimeout(() => {
                    this.removeNotification(action.payload.id);
                }, 5000);
            }
        });

        this.settingsState.addObserver((settings: AppState['settings']) => {
            localStorage.setItem('app_settings', JSON.stringify(settings));
        });

        const savedSettings = localStorage.getItem('app_settings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                this.settingsState.notify(settings);
            } catch (error) {
                console.error('Failed to load saved settings:', error);
            }
        }
    }

    public getState(): AppState {
        return {
            user: this.userState.value,
            notifications: this.notificationsState.value,
            settings: this.settingsState.value,
            loading: this.loadingState.value,
        };
    }

    public subscribe(callback: ObserverCallback<AppState>): () => boolean {
        return this.appState.addObserver(callback);
    }

    public subscribeToUser(callback: ObserverCallback<AppState['user']>): () => boolean {
        return this.userState.addObserver(callback);
    }

    public subscribeToNotifications(
        callback: ObserverCallback<AppState['notifications']>
    ): () => boolean {
        return this.notificationsState.addObserver(callback);
    }

    public subscribeToSettings(callback: ObserverCallback<AppState['settings']>): () => boolean {
        return this.settingsState.addObserver(callback);
    }

    public login(user: AppState['user']): void {
        this.userActions.notify({ type: 'LOGIN', payload: user });
    }

    public logout(): void {
        this.userActions.notify({ type: 'LOGOUT' });
    }

    public updateProfile(updates: Partial<NonNullable<AppState['user']>>): void {
        this.userActions.notify({ type: 'UPDATE_PROFILE', payload: updates });
    }

    public addNotification(notification: Omit<AppState['notifications'][0], 'timestamp'>): void {
        this.notificationActions.notify({
            type: 'ADD_NOTIFICATION',
            payload: {
                ...notification,
                timestamp: Date.now(),
            },
        });
    }

    public removeNotification(id: string): void {
        this.notificationActions.notify({ type: 'REMOVE_NOTIFICATION', payload: { id } });
    }

    public updateSettings(updates: Partial<AppState['settings']>): void {
        this.settingActions.notify({ type: 'UPDATE_SETTINGS', payload: updates });
    }

    public setLoading(loading: boolean): void {
        this.loadingState.notify(loading);
    }

    public dispose(): void {
        this.userState.dispose();
        this.notificationsState.dispose();
        this.settingsState.dispose();
        this.loadingState.dispose();
        this.userActions.dispose();
        this.notificationActions.dispose();
        this.settingActions.dispose();
        this.appState.dispose();
    }
}

export class PerformanceMonitor {
    private metricsSubject = new Subject<MetricData>();
    private aggregatedMetrics = new BehaviorSubject<
        Record<string, { avg: number; min: number; max: number; count: number }>
    >({});

    constructor() {
        this.setupMetricsAggregation();
        this.setupAutomaticCollection();
    }

    private setupMetricsAggregation(): void {
        const metricsChain = chain(this.metricsSubject);
        metricsChain.buffer(100, 10000).subscribe((metrics: MetricData[]) => {
            const aggregated = this.aggregateMetrics(metrics);
            this.aggregatedMetrics.notify(aggregated);
        });

        this.metricsSubject.addObserver((metric: MetricData) => {
            if (metric.metric === 'response_time' && metric.value > 1000) {
                console.warn(`Slow response detected: ${metric.value}ms`, metric.tags);
            }
        });
    }

    private setupAutomaticCollection(): void {
        setInterval(() => {
            if (
                typeof window !== 'undefined' &&
                'performance' in window &&
                'memory' in window.performance
            ) {
                const memory = (window.performance as any).memory;
                this.recordMetric('memory_used', memory.usedJSHeapSize);
                this.recordMetric('memory_total', memory.totalJSHeapSize);
                this.recordMetric('memory_limit', memory.jsHeapSizeLimit);
            }
        }, 30000);

        if (typeof window !== 'undefined' && 'performance' in window) {
            const perfObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.entryType === 'navigation') {
                        const nav = entry as PerformanceNavigationTiming;
                        this.recordMetric('page_load_time', nav.loadEventEnd - nav.fetchStart);
                        this.recordMetric(
                            'dom_content_loaded',
                            nav.domContentLoadedEventEnd - nav.fetchStart
                        );
                        this.recordMetric('first_paint', nav.responseStart - nav.fetchStart);
                    }
                }
            });
            perfObserver.observe({ entryTypes: ['navigation'] });
        }
    }

    private aggregateMetrics(
        metrics: MetricData[]
    ): Record<string, { avg: number; min: number; max: number; count: number }> {
        const grouped = metrics.reduce(
            (acc, metric) => {
                if (!acc[metric.metric]) {
                    acc[metric.metric] = [];
                }
                acc[metric.metric].push(metric.value);
                return acc;
            },
            {} as Record<string, number[]>
        );

        const aggregated: Record<string, { avg: number; min: number; max: number; count: number }> =
            {};

        for (const [metricName, values] of Object.entries(grouped)) {
            aggregated[metricName] = {
                avg: values.reduce((sum: number, val: number) => sum + val, 0) / values.length,
                min: Math.min(...values),
                max: Math.max(...values),
                count: values.length,
            };
        }

        return aggregated;
    }

    public recordMetric(metric: string, value: number, tags?: Record<string, string>): void {
        this.metricsSubject.notify({
            metric,
            value,
            timestamp: Date.now(),
            tags,
        });
    }

    public subscribeToMetrics(callback: ObserverCallback<MetricData>): () => boolean {
        return this.metricsSubject.addObserver(callback);
    }

    public subscribeToAggregatedMetrics(
        callback: ObserverCallback<
            Record<string, { avg: number; min: number; max: number; count: number }>
        >
    ): () => boolean {
        return this.aggregatedMetrics.addObserver(callback);
    }

    public getLatestMetrics(): Record<
        string,
        { avg: number; min: number; max: number; count: number }
    > {
        return this.aggregatedMetrics.value;
    }

    public dispose(): void {
        this.metricsSubject.dispose();
        this.aggregatedMetrics.dispose();
    }
}

export function runExamples(): void {
    console.log('=== Observer Library Examples ===\n');

    console.log('1. Chat Event System:');
    const chatSystem = new ChatEventSystem();

    chatSystem.subscribeToOnlineUsers((users) => {
        console.log('Online users updated:', users);
    });

    chatSystem.userLogin('user1');
    chatSystem.userLogin('user2');
    chatSystem.sendMessage('user1', 'Hello everyone!');
    chatSystem.userLogout('user1');

    setTimeout(() => chatSystem.dispose(), 1000);

    console.log('\n2. Data Processing Pipeline:');
    const pipeline = new DataProcessingPipeline();

    pipeline.subscribeToAlerts((alert) => {
        console.log(`ALERT [${alert.level}]: ${alert.message}`);
    });

    for (let i = 0; i < 20; i++) {
        setTimeout(() => {
            pipeline.ingestData('temperature', Math.random() * 1000);
            pipeline.ingestData('pressure', Math.random() * 1000);
        }, i * 100);
    }

    setTimeout(() => pipeline.dispose(), 3000);

    console.log('\n3. State Management:');
    const stateManager = new StateManager();

    stateManager.subscribe((state) => {
        console.log('State updated:', state);
    });

    stateManager.login({ id: '123', name: 'John Doe', role: 'admin' });
    stateManager.addNotification({ id: '1', message: 'Welcome!', type: 'info' });
    stateManager.updateSettings({ theme: 'dark' });

    setTimeout(() => stateManager.dispose(), 2000);

    console.log('\n4. Performance Monitoring:');
    const perfMonitor = new PerformanceMonitor();

    perfMonitor.subscribeToAggregatedMetrics((metrics) => {
        console.log('Performance metrics:', metrics);
    });

    for (let i = 0; i < 10; i++) {
        perfMonitor.recordMetric('response_time', Math.random() * 2000, { endpoint: '/api/users' });
        perfMonitor.recordMetric('cpu_usage', Math.random() * 100, { server: 'web-1' });
    }

    setTimeout(() => perfMonitor.dispose(), 5000);

    console.log('\n=== Examples completed ===');
}

console.log('Observer library examples loaded successfully!');
