/*
 * The tag list broadcasts one character budget to every row, but a row that
 * subscribes before the first broadcast is handed `undefined`. Every comparison
 * against undefined is false, so the old code fell through to
 * `slice(0, undefined)` -- which returns the whole string -- and rendered a full
 * digest plus an ellipsis. The column's `overflow: hidden` then clipped it
 * mid-hash, leaving one row visibly wider than the rest with its copy button
 * pushed onto a second line.
 */
import assert from 'node:assert';
import ImageContentDigest from '../src/components/tag-list/image-content-digest.riot';

const { getContentDigest } = ImageContentDigest.exports;
const DIGEST = `sha256:${'ab'.repeat(32)}`;
const image = { contentDigest: DIGEST };

describe('content digest truncation', () => {
  it('should render nothing until a width has been measured', () => {
    // Not the full digest: this is the case that produced the wide row.
    assert.equal(getContentDigest(image, undefined), '');
    assert.equal(getContentDigest(image, null), '');
    assert.equal(getContentDigest(image, Number.NaN), '');
  });

  it('should truncate to the measured width', () => {
    assert.equal(getContentDigest(image, 20), `${DIGEST.slice(0, 20)}...`);
    assert.ok(getContentDigest(image, 20).length < DIGEST.length);
  });

  it('should show the whole digest once there is room', () => {
    assert.equal(getContentDigest(image, 71), DIGEST);
  });

  it('should render nothing when there is no room at all', () => {
    assert.equal(getContentDigest(image, 0), '');
    assert.equal(getContentDigest(image, -5), '');
  });
});
