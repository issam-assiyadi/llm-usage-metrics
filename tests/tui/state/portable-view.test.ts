import { describe, expect, it } from 'vitest';

import { getDefaultViewState } from '../../../src/share-report/client/core/index.js';
import {
  fromPortableView,
  parsePortableView,
  toPortableView,
} from '../../../src/tui/state/portable-view.js';
import { loadFixtureReport } from '../tui-fixture.js';

describe('portable views', () => {
  it('carries filters and the drilled project by label into a report whose indexes moved', () => {
    const report = loadFixtureReport();
    const projects = report.data.dictionaries.projects;
    const view = {
      ...getDefaultViewState(report),
      project: [1],
      drill: 1,
      granularity: 'month' as const,
    };
    const portable = toPortableView(view, report);

    expect(portable.labels.project).toEqual([projects[1]]);
    expect(portable.drill).toBe(projects[1]);

    // The next report lists the projects in another order.
    const moved = loadFixtureReport((data) => {
      data.dictionaries.projects = [...data.dictionaries.projects].reverse();
    });
    const restored = fromPortableView(portable, moved);
    const index = moved.data.dictionaries.projects.indexOf(projects[1]);

    expect(restored.project).toEqual([index]);
    expect(restored.drill).toBe(index);
    expect(restored.granularity).toBe('month');
  });

  it('clears filters and the drill whose labels are gone', () => {
    const report = loadFixtureReport();
    const restored = fromPortableView(
      {
        hash: '',
        labels: { source: ['gone'], model: [], project: [], machine: [] },
        drill: 'gone',
      },
      report,
    );

    expect(restored.source).toEqual([]);
    expect(restored.drill).toBeNull();
  });

  it('reads back only well-formed views', () => {
    const portable = {
      hash: 'g=day',
      labels: { source: [], model: ['x'], project: [], machine: [] },
      drill: null,
    };

    expect(parsePortableView(JSON.parse(JSON.stringify(portable)))).toEqual(portable);
    expect(parsePortableView(null)).toBeUndefined();
    expect(parsePortableView({ hash: 1, labels: {}, drill: null })).toBeUndefined();
    expect(
      parsePortableView({ ...portable, labels: { ...portable.labels, model: [1] } }),
    ).toBeUndefined();
  });
});
