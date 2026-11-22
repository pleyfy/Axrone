import { Component, script } from '@axrone/ecs-runtime';
import TestComponent from './TestComponent';

@script({
    scriptName: 'DependentComponent',
    dependencies: [TestComponent],
    priority: 50,
    version: '1.1.0',
    tags: ['test', 'dependent'],
})
export default class DependentComponent extends Component {
    public testComponent?: TestComponent;

    onLoad(): void {
        this.testComponent = this.requireComponent(TestComponent);
    }
}