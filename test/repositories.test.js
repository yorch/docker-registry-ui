import assert from 'node:assert';
import { DockerRegistryUIError } from '../src/scripts/error.js';
import { getBranching } from '../src/scripts/repositories.js';

describe('repositories', () => {
  describe('getBranching', () => {
    it('should not branch for no levels', () => {
      const branching = getBranching(0, 0);
      assert.deepEqual(branching(['alpine', 'debian', 'nginx']), ['alpine', 'debian', 'nginx']);
      assert.deepEqual(branching(['alpine', 'joxit/docker-registry-ui', 'joxit/docker-registry-ui/amd64', 'nginx']), [
        'alpine',
        'joxit/docker-registry-ui',
        'joxit/docker-registry-ui/amd64',
        'nginx',
      ]);
    });

    it('should branch for one level', () => {
      const branching = getBranching(1, 1);
      assert.deepEqual(branching(['alpine', 'debian', 'nginx']), ['alpine', 'debian', 'nginx']);
      assert.deepEqual(branching(['alpine', 'joxit/docker-registry-ui', 'nginx']), [
        'alpine',
        { repositories: ['joxit/docker-registry-ui'], namespace: 'joxit/' },
        'nginx',
      ]);
      assert.deepEqual(
        branching(['alpine', 'joxit/docker-registry-ui', 'joxit/kokai', 'joxit/docker-registry-ui/amd64', 'nginx']),
        [
          'alpine',
          {
            repositories: ['joxit/docker-registry-ui', 'joxit/docker-registry-ui/amd64', 'joxit/kokai'],
            namespace: 'joxit/',
          },
          'nginx',
        ],
      );
    });

    it('should branch for two level', () => {
      const branching = getBranching(2, 2);
      assert.deepEqual(branching(['alpine', 'debian', 'nginx']), ['alpine', 'debian', 'nginx']);
      assert.deepEqual(branching(['alpine', 'joxit/docker-registry-ui', 'nginx']), [
        'alpine',
        'joxit/docker-registry-ui',
        'nginx',
      ]);
      assert.deepEqual(
        branching([
          'alpine',
          'joxit/docker-registry-ui',
          'joxit/kokai',
          'joxit/docker-registry-ui/amd64',
          'joxit/docker-registry-ui/amd64/latest',
          'joxit/docker-registry-ui/armv7',
          'joxit/docker-registry-ui/armv7/latest',
          'nginx',
        ]),
        [
          'alpine',
          'joxit/docker-registry-ui',
          {
            repositories: [
              'joxit/docker-registry-ui/amd64',
              'joxit/docker-registry-ui/amd64/latest',
              'joxit/docker-registry-ui/armv7',
              'joxit/docker-registry-ui/armv7/latest',
            ],
            namespace: 'joxit/docker-registry-ui/',
          },
          'joxit/kokai',
          'nginx',
        ],
      );
    });

    it('should branch from one to two level', () => {
      const branching = getBranching(1, 2);
      assert.deepEqual(branching(['alpine', 'debian', 'nginx']), ['alpine', 'debian', 'nginx']);
      assert.deepEqual(branching(['alpine', 'joxit/docker-registry-ui', 'nginx']), [
        'alpine',
        { repositories: ['joxit/docker-registry-ui'], namespace: 'joxit/' },
        'nginx',
      ]);
      assert.deepEqual(
        branching([
          'alpine',
          'joxit/docker-registry-ui',
          'joxit/kokai',
          'joxit/docker-registry-ui/amd64',
          'joxit/docker-registry-ui/amd64/latest',
          'joxit/docker-registry-ui/armv7',
          'joxit/docker-registry-ui/armv7/latest',
          'nginx',
        ]),
        [
          'alpine',
          {
            repositories: [
              'joxit/docker-registry-ui',
              {
                repositories: [
                  'joxit/docker-registry-ui/amd64',
                  'joxit/docker-registry-ui/amd64/latest',
                  'joxit/docker-registry-ui/armv7',
                  'joxit/docker-registry-ui/armv7/latest',
                ],
                namespace: 'joxit/docker-registry-ui/',
              },
              'joxit/kokai',
            ],
            namespace: 'joxit/',
          },
          'nginx',
        ],
      );
    });
  });

  describe('getBranching tree shape', () => {
    // The tree used to depend on whether a shorter namespace happened to sort
    // before a longer one it contains.
    it('should nest a deeper namespace under its parent whichever sorts first', () => {
      const branching = getBranching(1, 2);
      const expected = [
        {
          namespace: 'a/',
          repositories: [{ namespace: 'a/b/', repositories: ['a/b/x'] }, 'a/c'],
        },
      ];
      assert.deepEqual(branching(['a/b/x', 'a/c']), expected);
      const nested = branching(['a/aa', 'a/b/x']);
      assert.deepEqual(nested, [
        { namespace: 'a/', repositories: ['a/aa', { namespace: 'a/b/', repositories: ['a/b/x'] }] },
      ]);
    });

    it('should not depend on input order', () => {
      const names = ['a/b/x', 'a/c', 'a/b/y', 'a/b-z/q', 'a/d/e/f', 'solo'];
      const reference = JSON.stringify(getBranching(1, 3)([...names]));
      assert.equal(JSON.stringify(getBranching(1, 3)([...names].reverse())), reference);
    });
  });

  it('should branch from one to two level', () => {
    assert.throws(() => getBranching(2, 1), DockerRegistryUIError, `Did not throw on min > max`);
    assert.throws(() => getBranching(-2, 1), DockerRegistryUIError, `Did not throw on min < 0`);
    assert.throws(() => getBranching(2, -1), DockerRegistryUIError, `Did not throw on max < 0`);
    assert.throws(() => getBranching('foo', 'bar'), DockerRegistryUIError, `Did not throw on max < 0`);
  });
});
