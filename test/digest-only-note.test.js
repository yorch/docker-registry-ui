// The registry API cannot list the parents of a digest, so an untagged index
// that references an image cannot be detected. The UI says so before deleting.
import assert from 'node:assert';
import { component } from 'riot';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';
import ConfirmDeleteImage from '../src/components/dialogs/confirm-delete-image.riot';
import { summarizeRegistry } from '../src/scripts/registry-analysis.js';

const NOTE =
  /Images referenced only by digest \(for example an untagged multi-architecture index\) cannot be detected; if you pull by digest, check before deleting\./;
const flat = (element) => element.textContent.replace(/\s+/g, ' ');

describe('untagged index limitation note', () => {
  afterEach(() => document.body.replaceChildren());

  it('is shown in the delete dialog', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    component(ConfirmDeleteImage)(root, {
      registryUrl: 'https://r.example',
      opened: true,
      tags: [],
      toDelete: new Set(),
    });
    assert.match(flat(root), NOTE);
  });

  it('is shown with the retention plan and in its confirmation', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const instance = component(RegistryOperations)(root, { registryUrl: 'https://r.example', onNotify: () => {} });
    instance.update({
      expanded: true,
      summary: summarizeRegistry([], [], []),
      plan: { registryUrl: 'https://r.example', candidates: [], skipped: [] },
    });
    assert.match(flat(root.querySelector('.retention-results')), NOTE);
    assert.match(flat(root), NOTE);
  });
});
