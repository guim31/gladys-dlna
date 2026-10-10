import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG, parseUrlList } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values and refuses an unknown language', () => {
  assert.equal(normalizeConfig({ language: 'fr' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'en');
  assert.equal(normalizeConfig({ description_urls: 'http://a/' }).description_urls, 'http://a/');
});

test('the URL list accepts commas, spaces and new lines, http(s) only', () => {
  assert.deepEqual(
    parseUrlList(
      'http://192.0.2.1:8200/rootDesc.xml, https://h/d.xml\nftp://x  junk http://192.0.2.1:8200/rootDesc.xml',
    ),
    ['http://192.0.2.1:8200/rootDesc.xml', 'https://h/d.xml'],
  );
  assert.deepEqual(parseUrlList(''), []);
  assert.deepEqual(parseUrlList(undefined), []);
});
