/*
 * The last check standing between a retention preview and an irreversible
 * delete. Exercised directly rather than through a mounted component: it is
 * pure comparison, and it is the one place where being wrong destroys tags that
 * were never shown to anyone.
 */
import RegistryOperations from '../src/components/catalog/registry-operations.riot';
import assert from 'node:assert';

const { assertPreviewStillHolds } = RegistryOperations.exports;

const candidate = (tags, digest = 'sha256:abc') => ({ repository: 'team/app', digest, tags });

describe('retention delete guard', () => {
  it('should accept a candidate whose tags are unchanged', () => {
    const aliases = new Map([['sha256:abc', ['v1', 'v2']]]);
    // Order is an artefact of tag listing, not a change.
    assert.doesNotThrow(() => assertPreviewStillHolds(aliases, candidate(['v2', 'v1'])));
  });

  it('should refuse when a tag was added to the digest since the preview', () => {
    const aliases = new Map([['sha256:abc', ['v1', 'v2', 'pushed-since']]]);
    assert.throws(
      () => assertPreviewStillHolds(aliases, candidate(['v1', 'v2'])),
      /re-analyze before deleting/,
      'deleting this digest would take a tag the preview never showed',
    );
  });

  it('should refuse when a tag was removed from the digest since the preview', () => {
    const aliases = new Map([['sha256:abc', ['v1']]]);
    assert.throws(() => assertPreviewStillHolds(aliases, candidate(['v1', 'v2'])), /re-analyze before deleting/);
  });

  it('should refuse when the digest no longer exists in the repository', () => {
    assert.throws(() => assertPreviewStillHolds(new Map(), candidate(['v1'])), /re-analyze before deleting/);
  });

  it('should not confuse one digest with another in the same repository', () => {
    const aliases = new Map([
      ['sha256:abc', ['v1']],
      ['sha256:def', ['v2']],
    ]);
    assert.doesNotThrow(() => assertPreviewStillHolds(aliases, candidate(['v1'], 'sha256:abc')));
    assert.throws(() => assertPreviewStillHolds(aliases, candidate(['v1'], 'sha256:def')), /re-analyze/);
  });
});
