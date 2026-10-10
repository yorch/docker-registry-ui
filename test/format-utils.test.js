import assert from 'node:assert';
import { bytesToSize, dateFormat } from '../src/scripts/utils.js';

describe('bytesToSize', () => {
  it('should format zero, as a number or a numeric string', () => {
    assert.equal(bytesToSize(0), '0 Byte');
    assert.equal(bytesToSize('0'), '0 Byte');
  });

  it('should keep a unit name for sizes of a petabyte and above', () => {
    assert.equal(bytesToSize(1024 ** 5), '1.0 PB');
    assert.equal(bytesToSize(3 * 1024 ** 6), '3.0 EB');
    assert.ok(!/undefined|NaN/.test(bytesToSize(1024 ** 8)));
  });

  it('should keep formatting ordinary sizes', () => {
    assert.equal(bytesToSize(512), '512 Bytes');
    assert.equal(bytesToSize(1536), '1.5 KB');
  });
});

describe('dateFormat', () => {
  it('should render nothing for a missing or invalid date rather than "undefined"', () => {
    assert.equal(dateFormat(undefined), '');
    assert.equal(dateFormat(null), '');
    assert.equal(dateFormat(new Date('nonsense')), '');
  });

  it('should still describe a real date', () => {
    assert.equal(dateFormat(new Date(Date.now() - 3 * 86400000)), '3 days');
  });
});
