/*
 * The last check standing between a retention preview and an irreversible
 * delete. Exercised directly rather than through a mounted component: it is
 * pure comparison, and it is the one place where being wrong destroys tags that
 * were never shown to anyone.
 */

import assert from 'node:assert';
import RegistryOperations from '../src/components/catalog/registry-operations.riot';

const { assertPreviewStillHolds } = RegistryOperations.exports;

// The guard now takes the whole snapshot: tag aliases plus the digests indexes reference.
const check = (aliases, target, referenced = new Map()) => assertPreviewStillHolds({ aliases, referenced }, target);

const candidate = (tags, digest = 'sha256:abc') => ({ repository: 'team/app', digest, tags });

describe('retention delete guard', () => {
  it('should accept a candidate whose tags are unchanged', () => {
    const aliases = new Map([['sha256:abc', ['v1', 'v2']]]);
    // Order is an artefact of tag listing, not a change.
    assert.doesNotThrow(() => check(aliases, candidate(['v2', 'v1'])));
  });

  it('should refuse when a tag was added to the digest since the preview', () => {
    const aliases = new Map([['sha256:abc', ['v1', 'v2', 'pushed-since']]]);
    assert.throws(
      () => check(aliases, candidate(['v1', 'v2'])),
      /re-analyze before deleting/,
      'deleting this digest would take a tag the preview never showed',
    );
  });

  it('should refuse when a tag was removed from the digest since the preview', () => {
    const aliases = new Map([['sha256:abc', ['v1']]]);
    assert.throws(() => check(aliases, candidate(['v1', 'v2'])), /re-analyze before deleting/);
  });

  it('should refuse when the digest no longer exists in the repository', () => {
    assert.throws(() => check(new Map(), candidate(['v1'])), /re-analyze before deleting/);
  });

  it('should refuse a digest that an index references, even when its tags are unchanged', () => {
    const aliases = new Map([['sha256:abc', ['v1']]]);
    const referenced = new Map([['sha256:abc', 'latest']]);
    assert.throws(() => check(aliases, candidate(['v1']), referenced), /referenced by index latest/);
  });

  it('should not confuse one digest with another in the same repository', () => {
    const aliases = new Map([
      ['sha256:abc', ['v1']],
      ['sha256:def', ['v2']],
    ]);
    assert.doesNotThrow(() => check(aliases, candidate(['v1'], 'sha256:abc')));
    assert.throws(() => check(aliases, candidate(['v1'], 'sha256:def')), /re-analyze/);
  });
});
