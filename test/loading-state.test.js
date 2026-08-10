import { component } from 'riot';
import observable from '@riotjs/observable';
import { bytesToSize, PENDING_LABEL, UNAVAILABLE_LABEL } from '../src/scripts/utils.js';
import ImageSize from '../src/components/tag-list/image-size.riot';
import ImageDate from '../src/components/tag-list/image-date.riot';
import Architectures from '../src/components/tag-list/architectures.riot';
import assert from 'node:assert';

const pendingImage = () => {
  const inner = observable({});
  const image = {
    name: 'repo',
    tag: 'v1',
    // Each returns `image` rather than the inner observable, so callers can
    // chain the way riot's own observable does.
    on: (e, f) => {
      inner.on(e, f);
      return image;
    },
    one: (e, f) => {
      inner.one(e, f);
      return image;
    },
    off: (e, f) => {
      inner.off(e, f);
      return image;
    },
    trigger: (e, ...args) => {
      inner.trigger(e, ...args);
      return image;
    },
  };
  return image;
};

const mount = (Component, props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(Component)(root, props);
};

const text = (instance) => instance.root.textContent.replace(/\s+/g, ' ').trim();

describe('loading and failure states', () => {
  afterEach(() => document.body.replaceChildren());

  // The catalog badge already draws this distinction: undefined is still in
  // flight, null could not be fetched. Same rule everywhere.
  describe('bytesToSize', () => {
    it('should report a pending size distinctly from a failed one', () => {
      assert.equal(bytesToSize(undefined), PENDING_LABEL);
      assert.equal(bytesToSize(null), UNAVAILABLE_LABEL);
      assert.notEqual(PENDING_LABEL, UNAVAILABLE_LABEL);
    });

    it('should still format real sizes', () => {
      assert.equal(bytesToSize(0), '0 Byte');
      assert.match(bytesToSize(4096), /4(\.0+)? KB/);
    });
  });

  describe('image-size', () => {
    it('should show the pending label before the size arrives', () => {
      const instance = mount(ImageSize, { image: pendingImage() });
      assert.equal(text(instance), PENDING_LABEL);
    });

    it('should show the unavailable label when the size cannot be fetched', () => {
      const image = pendingImage();
      const instance = mount(ImageSize, { image });
      image.size = null;
      image.trigger('size', null);
      assert.equal(text(instance), UNAVAILABLE_LABEL);
    });
  });

  describe('image-date', () => {
    // Rendered `${dateFormat(date)} ago`, so a missing date produced a bare
    // " ago" sitting in the column.
    it('should not render a bare ago while the date is pending', () => {
      const instance = mount(ImageDate, { image: pendingImage() });
      assert.equal(text(instance), PENDING_LABEL);
    });

    it('should show the unavailable label when the date cannot be fetched', () => {
      const image = pendingImage();
      const instance = mount(ImageDate, { image });
      image.creationDate = null;
      image.trigger('creation-date', null);
      assert.equal(text(instance), UNAVAILABLE_LABEL);
    });

    // DockerImage answers `get-date` for an already-resolved date by re-emitting
    // `creation-date`. A component that re-asks on every render then recurses
    // until the stack gives out, which is what a failed date used to do.
    it('should not re-ask for a date that already resolved', () => {
      const image = pendingImage();
      // Mirror DockerImage's get-date contract.
      image.on('get-date', () => {
        if (image.creationDate !== undefined) {
          image.trigger('creation-date', image.creationDate);
        }
      });
      const instance = mount(ImageDate, { image });
      image.creationDate = null;
      assert.doesNotThrow(() => image.trigger('creation-date', null), RangeError);
      assert.equal(text(instance), UNAVAILABLE_LABEL);
    });
  });

  describe('architectures', () => {
    it('should show the pending label before the manifest arrives', () => {
      const instance = mount(Architectures, { image: pendingImage() });
      assert.equal(text(instance), PENDING_LABEL);
    });

    // platformToString(null) returns 'unknown', so a failed fetch would print
    // a plausible-looking architecture instead of admitting it failed.
    it('should show the unavailable label rather than unknown when blobs fail', () => {
      const image = pendingImage();
      const instance = mount(Architectures, { image });
      image.trigger('blobs', null);
      assert.equal(text(instance), UNAVAILABLE_LABEL);
    });

    it('should still render real architectures', () => {
      const image = pendingImage();
      const instance = mount(Architectures, { image });
      image.trigger('list', [{ platform: { architecture: 'amd64' } }]);
      assert.match(text(instance), /amd64/);
    });
  });
});
