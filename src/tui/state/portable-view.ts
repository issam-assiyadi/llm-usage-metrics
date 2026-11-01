// A view that survives a new report. The share report's view holds dictionary indexes, which
// change whenever a reload or the next launch adds or drops a label, so filters and the
// drilled project are carried by their labels and matched again in the new report.

import {
  decodeViewState,
  DIMENSION_DICTIONARY,
  encodeViewState,
  type ShareDimension,
  type ShareReport,
  type ShareViewState,
} from '../../share-report/client/core/index.js';
import { asRecord } from '../../../packages/core/src/utils/as-record.js';

export type PortableView = {
  /** The view's other fields, as the share report's URL hash writes them. */
  hash: string;
  /** Per dimension, the labels the filter keeps; empty keeps all. */
  labels: Record<ShareDimension, string[]>;
  /** The drilled project's label; null for the project table. */
  drill: string | null;
};

export function toPortableView(view: ShareViewState, report: ShareReport): PortableView {
  const { dictionaries } = report.data;
  const labelsOf = (dimension: ShareDimension) =>
    view[dimension].flatMap((index) => {
      const label = dictionaries[DIMENSION_DICTIONARY[dimension]].at(index);
      return label === undefined ? [] : [label];
    });

  return {
    hash: encodeViewState(
      { ...view, source: [], model: [], project: [], machine: [], drill: null },
      report,
    ),
    labels: {
      source: labelsOf('source'),
      model: labelsOf('model'),
      project: labelsOf('project'),
      machine: labelsOf('machine'),
    },
    drill: view.drill === null ? null : (dictionaries.projects[view.drill] ?? null),
  };
}

/**
 * The view in `report`: every field the hash holds that is still valid there, and the filter
 * labels that still exist. A filter whose labels are all gone is cleared rather than left to
 * match nothing; a drilled project that is gone returns to the project table.
 */
export function fromPortableView(portable: PortableView, report: ShareReport): ShareViewState {
  const view = decodeViewState(portable.hash, report);
  const { dictionaries } = report.data;
  const indexesOf = (dimension: ShareDimension) => {
    const dictionary = dictionaries[DIMENSION_DICTIONARY[dimension]];
    return portable.labels[dimension]
      .map((label) => dictionary.indexOf(label))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right);
  };
  const drill = portable.drill === null ? -1 : dictionaries.projects.indexOf(portable.drill);

  return {
    ...view,
    source: indexesOf('source'),
    model: indexesOf('model'),
    project: indexesOf('project'),
    machine: indexesOf('machine'),
    drill: drill >= 0 ? drill : null,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** A portable view read back from JSON, or undefined when it is not one. */
export function parsePortableView(value: unknown): PortableView | undefined {
  const record = asRecord(value);
  const labels = asRecord(record?.labels);

  if (
    record === undefined ||
    labels === undefined ||
    typeof record.hash !== 'string' ||
    !(record.drill === null || typeof record.drill === 'string')
  ) {
    return undefined;
  }

  const { source, model, project, machine } = labels;

  if (
    !isStringArray(source) ||
    !isStringArray(model) ||
    !isStringArray(project) ||
    !isStringArray(machine)
  ) {
    return undefined;
  }

  return { hash: record.hash, labels: { source, model, project, machine }, drill: record.drill };
}
