import assert from 'node:assert';
import observable from '@riotjs/observable';
import { component } from 'riot';
import Architectures from '../src/components/tag-list/architectures.riot';
import ImageContentDigest from '../src/components/tag-list/image-content-digest.riot';
import ImageSize from '../src/components/tag-list/image-size.riot';

// An image whose manifest never arrives -- the window in which these components
// used to re-subscribe on every render. Delegates to a real observable, since
// its methods are defined non-writable, so dispatch keeps its true semantics
// while the wrapper counts how often each event is subscribed to.
const pendingImage = () => {
  const inner = observable({});
  const registrations = {};
  const image = {
    name: 'repo',
    tag: 'v1',
    on(event, fn) {
      registrations[event] = (registrations[event] || 0) + 1;
      inner.on(event, fn);
      return image;
    },
    one(event, fn) {
      registrations[event] = (registrations[event] || 0) + 1;
      inner.one(event, fn);
      return image;
    },
    off(event, fn) {
      inner.off(event, fn);
      return image;
    },
    trigger(event, ...args) {
      inner.trigger(event, ...args);
      return image;
    },
  };
  return { image, registrations };
};

const mount = (Component, props) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return component(Component)(root, props);
};

describe('tag list image subscriptions', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  describe('image-size', () => {
    it('should subscribe once however many times it re-renders in flight', () => {
      const { image, registrations } = pendingImage();
      const instance = mount(ImageSize, { image });
      for (let i = 0; i < 5; i++) {
        instance.update();
      }
      assert.equal(registrations.size, 1);
    });

    it('should still render the size once it arrives', () => {
      const { image } = pendingImage();
      const instance = mount(ImageSize, { image });
      instance.update();
      image.size = 4096;
      image.trigger('size', 4096);
      assert.match(instance.root.textContent, /4(\.0+)?\s?KB/i);
    });
  });

  describe('architectures', () => {
    it('should subscribe once however many times it re-renders in flight', () => {
      const { image, registrations } = pendingImage();
      const instance = mount(Architectures, { image });
      for (let i = 0; i < 5; i++) {
        instance.update();
      }
      assert.equal(registrations.blobs, 1);
      assert.equal(registrations.list, 1);
    });

    it('should still render the architectures once the manifest list arrives', () => {
      const { image } = pendingImage();
      const instance = mount(Architectures, { image });
      instance.update();
      image.trigger('list', [
        { platform: { architecture: 'amd64' } },
        { platform: { architecture: 'arm64', variant: 'v8' } },
      ]);
      assert.match(instance.root.textContent, /amd64/);
      assert.match(instance.root.textContent, /arm64v8/);
    });
  });

  describe('image-content-digest', () => {
    it('should subscribe once however many times it re-renders in flight', () => {
      const { image, registrations } = pendingImage();
      const instance = mount(ImageContentDigest, { image });
      for (let i = 0; i < 5; i++) {
        instance.update();
      }
      assert.equal(registrations['content-digest'], 1);
    });

    it('should still render the digest once it arrives', () => {
      const { image } = pendingImage();
      const instance = mount(ImageContentDigest, { image });
      image.contentDigest = `sha256:${'ab'.repeat(32)}`;
      image.trigger('content-digest', image.contentDigest);
      image.trigger('content-digest-chars', 70);
      assert.match(instance.root.textContent, /^sha256:(ab)+$/);
    });

    // Guards a coupling that is currently invisible: this is safe today only
    // because DockerImage.markUnavailable() deliberately does not report a
    // failed content digest. A truthiness guard cannot tell `null` (failed)
    // from `undefined` (pending), and `get-content-digest` answers an already
    // resolved value by re-emitting it -- which is how the same shape turned
    // into unbounded recursion in image-date.
    it('should not re-ask for a digest that already resolved to a failure', () => {
      const { image } = pendingImage();
      // Mirror the two DockerImage contracts this component drives, since the
      // loop only closes if both are present: `get-content-digest` answers an
      // already-resolved value by re-emitting it, and `get-content-digest-chars`
      // answers with the stored width.
      image.chars = 0;
      image.on('get-content-digest', () => {
        if (image.contentDigest !== undefined) {
          image.trigger('content-digest', image.contentDigest);
        }
      });
      image.on('content-digest-chars', (chars) => {
        image.chars = chars;
      });
      image.on('get-content-digest-chars', () => image.trigger('content-digest-chars', image.chars));

      const instance = mount(ImageContentDigest, { image });
      image.contentDigest = null;
      assert.doesNotThrow(() => image.trigger('content-digest', null), RangeError);
      assert.ok(instance.root);
    });
  });
});
