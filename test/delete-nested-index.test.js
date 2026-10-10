// currentAliases must classify a nested child by its fetched body, not by the
// mediaType its descriptor declares: an index whose nested-index descriptor omits
// or mislabels mediaType must still protect its grandchildren in the dialog.
import assert from 'node:assert';
import { component } from 'riot';
import ConfirmDeleteImage from '../src/components/dialogs/confirm-delete-image.riot';
import { RegistryClient } from '../src/scripts/registry-client.js';
import { createFake, OCI_I, OCI_M } from './support/fake-registry.js';

const OLD = '2020-01-01T00:00:00Z';

describe('nested index descriptor without index mediaType', () => {
  let reg;
  let notes;
  afterEach(async () => {
    document.body.replaceChildren();
    sessionStorage.clear();
    await reg?.close();
  });

  const setup = async (descriptorMediaType) => {
    reg = await createFake();
    const grandchild = reg.image('amd64', OLD);
    const sibling = reg.image('arm64', OLD);
    const inner = reg.index([grandchild, sibling], OCI_I);
    reg.tag('latest', reg.index([{ ...inner, mediaType: descriptorMediaType }], OCI_I));
    reg.tag('amd64-old', grandchild);
    return { grandchild, inner };
  };

  for (const label of [undefined, OCI_M]) {
    it(`currentAliases.referenced includes the grandchild (descriptor mediaType=${label})`, async () => {
      const { grandchild, inner } = await setup(label);
      const client = new RegistryClient({ registryUrl: reg.url });
      const { referenced } = await client.currentAliases('app');
      assert.ok(referenced.has(inner.digest), 'inner index itself should be referenced');
      assert.ok(referenced.has(grandchild.digest), 'grandchild missing from referenced');
    });

    it(`dialog refuses to delete the grandchild (descriptor mediaType=${label})`, async () => {
      const { grandchild } = await setup(label);
      notes = [];
      const shown = [{ name: 'app', tag: 'amd64-old', contentDigest: grandchild.digest }];
      const root = document.createElement('div');
      document.body.appendChild(root);
      const instance = component(ConfirmDeleteImage)(root, {
        registryUrl: reg.url,
        onNotify: (m, e) => notes.push({ m, e }),
        onAuthentication: () => {},
        onClick: () => {},
        onImageDeleted: async () => {},
        opened: true,
        tags: shown,
        toDelete: new Set(shown),
      });
      await instance.deleteImages();
      assert.ok(
        reg.exists(grandchild.digest),
        `grandchild of kept index "latest" deleted; notes=${JSON.stringify(notes)}`,
      );
    });
  }
});
