import { component } from 'riot';
import observable from '@riotjs/observable';
import ImageSize from '../src/components/tag-list/image-size.riot';
import Architectures from '../src/components/tag-list/architectures.riot';
import assert from 'assert';

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
});
