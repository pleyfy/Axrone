import { describe, expect, it } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import {
  asArray,
  asColorString,
  asFiniteNumber,
  hitTestBoundWidget,
  isPointInside,
} from '../controls/internals';
import {
  RADIO_GROUP_CONTROLLER_TYPE,
  getRadioGroupSelectedIndex,
  radioGroupController,
} from '../controls/radio-group-controller';
import {
  SEGMENTED_CONTROL_CONTROLLER_TYPE,
  getSegmentedSelectedIndex,
  segmentedController,
} from '../controls/segmented-controller';
import {
  TAB_VIEW_CONTROLLER_TYPE,
  getTabSelectedIndex,
  tabViewController,
} from '../controls/tab-controller';
import type { WidgetId } from '../types';

const pointer = (phase: 'down' | 'up' | 'move', x: number, y: number) => ({
  type: 'pointer' as const,
  phase,
  x,
  y,
  pointerId: 1,
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  deltaX: 0,
  deltaY: 0,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
});

const boxItem = (key: string, left: number, top: number, width: number, height: number) => ({
  role: 'container',
  key,
  enabled: true,
  interactive: false,
  layout: {
    position: 'absolute',
    inset: { left, top },
    width,
    height,
  },
  style: { background: '#334155ff' },
  children: [],
});

const buildGroupAsset = (
  kind: string,
  controller: string,
  props: Record<string, unknown>,
  items: Array<{ key: string; left: number; top: number; width: number; height: number }>,
  panels: Array<{ key: string; left: number; top: number; width: number; height: number }> = [],
) => {
  const bindings: Record<string, string> = { root: 'root', host: 'host' };
  for (const item of items) bindings[item.key] = item.key;
  for (const panel of panels) bindings[panel.key] = panel.key;
  return JSON.stringify({
    id: `ui.${kind}-hit-test`,
    name: `${kind}-hit-test`,
    version: 1,
    canvas: {
      referenceWidth: 400,
      referenceHeight: 300,
      scaleMode: 'fixed',
      matchBias: 0.5,
    },
    bindings,
    root: {
      role: 'root',
      key: 'root',
      enabled: true,
      interactive: false,
      layout: { display: 'overlay', width: '100%', height: '100%' },
      children: [
        {
          role: kind,
          key: 'host',
          enabled: true,
          interactive: true,
          controller,
          props,
          layout: {
            position: 'absolute',
            inset: { left: 0, top: 0 },
            width: 400,
            height: 300,
          },
          children: [
            ...items.map((item) => boxItem(item.key, item.left, item.top, item.width, item.height)),
            ...panels.map((panel) =>
              boxItem(panel.key, panel.left, panel.top, panel.width, panel.height),
            ),
          ],
        },
      ],
    },
  });
};

describe('hitTestBoundWidget shared helper', () => {
  it('hits interior points and misses exterior points', () => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    const widget = runtime.createWidget({
      layout: { position: 'absolute', inset: { left: 0, top: 0 }, width: 100, height: 50 },
    });
    runtime.appendChild(runtime.root, widget);
    runtime.commit();
    const box = runtime.getLayoutBox(widget);
    expect(box.width).toBeCloseTo(100, 5);
    expect(box.height).toBeCloseTo(50, 5);
    expect(hitTestBoundWidget(runtime, widget, box.x, box.y)).toBe(true);
    expect(hitTestBoundWidget(runtime, widget, box.x + 50, box.y + 25)).toBe(true);
    expect(hitTestBoundWidget(runtime, widget, box.x + 200, box.y + 200)).toBe(false);
  });

  it('excludes the upper bound edge', () => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    const widget = runtime.createWidget({
      layout: { position: 'absolute', inset: { left: 0, top: 0 }, width: 100, height: 50 },
    });
    runtime.appendChild(runtime.root, widget);
    runtime.commit();
    const box = runtime.getLayoutBox(widget);
    expect(hitTestBoundWidget(runtime, widget, box.x + box.width, box.y + 10)).toBe(false);
    expect(hitTestBoundWidget(runtime, widget, box.x + 10, box.y + box.height)).toBe(false);
    expect(hitTestBoundWidget(runtime, widget, box.x + box.width - 0.5, box.y + 10)).toBe(true);
    expect(isPointInside(runtime, widget, box.x + box.width, box.y + 10)).toBe(true);
  });

  it('exposes moved dropdown coercion helpers', () => {
    expect(asArray(['a', 1, 'b', null])).toEqual(['a', 'b']);
    expect(asArray('nope')).toEqual([]);
    expect(asFiniteNumber(3.5)).toBe(3.5);
    expect(asFiniteNumber(Number.NaN)).toBeNull();
    expect(asFiniteNumber('3')).toBeNull();
    expect(asColorString('  #ff0000ff  ')).toBe('  #ff0000ff  ');
    expect(asColorString('   ')).toBeNull();
    expect(asColorString(42)).toBeNull();
  });
});

describe('radio-group hit testing through shared helper', () => {
  const createRuntime = () => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.registry.register(radioGroupController);
    runtime.loadFromAsset(
      deserializeUIAsset(
        buildGroupAsset(
          'custom:radio-group',
          RADIO_GROUP_CONTROLLER_TYPE,
          { selectedIndex: 0, itemCount: 2, dotPrefix: 'radio-', circlePrefix: 'radio-' },
          [
            { key: 'radio-0-circle', left: 0, top: 0, width: 100, height: 30 },
            { key: 'radio-1-circle', left: 100, top: 0, width: 100, height: 30 },
          ],
        ),
      ),
    );
    runtime.commit();
    return runtime;
  };

  it('selects the segment whose box contains the interior point', () => {
    const runtime = createRuntime();
    const host = runtime.getBoundWidget('host') as WidgetId;
    runtime.dispatchInput(pointer('down', 150, 15));
    runtime.commit();
    expect(getRadioGroupSelectedIndex(runtime, host)).toBe(1);
  });

  it('resolves a shared edge to the next item with exclusive upper bound', () => {
    const runtime = createRuntime();
    const host = runtime.getBoundWidget('host') as WidgetId;
    runtime.dispatchInput(pointer('down', 100, 15));
    runtime.commit();
    expect(getRadioGroupSelectedIndex(runtime, host)).toBe(1);
  });
});

describe('segmented hit testing through shared helper', () => {
  const createRuntime = () => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.registry.register(segmentedController);
    runtime.loadFromAsset(
      deserializeUIAsset(
        buildGroupAsset(
          'custom:segmented',
          SEGMENTED_CONTROL_CONTROLLER_TYPE,
          { selectedIndex: 0, segmentCount: 2, segmentPrefix: 'seg-' },
          [
            { key: 'seg-0', left: 0, top: 0, width: 100, height: 30 },
            { key: 'seg-1', left: 100, top: 0, width: 100, height: 30 },
          ],
        ),
      ),
    );
    runtime.commit();
    return runtime;
  };

  it('selects the segment whose box contains the interior point', () => {
    const runtime = createRuntime();
    const host = runtime.getBoundWidget('host') as WidgetId;
    runtime.dispatchInput(pointer('down', 150, 15));
    runtime.commit();
    expect(getSegmentedSelectedIndex(runtime, host)).toBe(1);
  });

  it('resolves a shared edge to the next segment with exclusive upper bound', () => {
    const runtime = createRuntime();
    const host = runtime.getBoundWidget('host') as WidgetId;
    runtime.dispatchInput(pointer('down', 100, 15));
    runtime.commit();
    expect(getSegmentedSelectedIndex(runtime, host)).toBe(1);
  });
});

describe('tab-view hit testing through shared helper', () => {
  const createRuntime = () => {
    const runtime = new UIRuntime({ width: 400, height: 300 });
    runtime.registry.register(tabViewController);
    runtime.loadFromAsset(
      deserializeUIAsset(
        buildGroupAsset(
          'custom:tab-view',
          TAB_VIEW_CONTROLLER_TYPE,
          { selectedIndex: 0, tabCount: 2, tabPrefix: 'tab-', panelPrefix: 'panel-' },
          [
            { key: 'tab-0', left: 0, top: 0, width: 100, height: 30 },
            { key: 'tab-1', left: 100, top: 0, width: 100, height: 30 },
          ],
          [
            { key: 'panel-0', left: 0, top: 40, width: 400, height: 260 },
            { key: 'panel-1', left: 0, top: 40, width: 400, height: 260 },
          ],
        ),
      ),
    );
    runtime.commit();
    return runtime;
  };

  it('selects the tab whose box contains the interior point', () => {
    const runtime = createRuntime();
    const host = runtime.getBoundWidget('host') as WidgetId;
    runtime.dispatchInput(pointer('up', 150, 15));
    runtime.commit();
    expect(getTabSelectedIndex(runtime, host)).toBe(1);
  });

  it('resolves a shared edge to the next tab with exclusive upper bound', () => {
    const runtime = createRuntime();
    const host = runtime.getBoundWidget('host') as WidgetId;
    runtime.dispatchInput(pointer('up', 100, 15));
    runtime.commit();
    expect(getTabSelectedIndex(runtime, host)).toBe(1);
  });
});
