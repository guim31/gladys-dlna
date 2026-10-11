// -----------------------------------------------------------------------------
// Translations: Gladys exists in English, French, German and Spanish. Every
// multi-language text of the manifest and of the code carries exactly these
// four languages, none empty, none longer than the place it is shown allows.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES, localize } from '../src/i18n.js';
import { MESSAGES } from '../src/messages.js';
import { MESSAGE_TABLES } from '../src/errors.js';
import { TEXTS as WIDGET_TEXTS, favoritesContent, playerContent } from '../src/widgets.js';
import { TEXTS as ACTION_TEXTS } from '../src/actions.js';
import { NAMES, rendererFeatureKeys } from '../src/devices/renderer.js';
import { SERVER_SUFFIX } from '../src/devices/server.js';
import { favoritesOf } from '../src/favorites.js';
import { normalizeConfig } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const EXPECTED = [...LANGUAGES].sort();
// The core's language key grammar: an object made only of such keys is a
// multi-language text.
const LANGUAGE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;

const isLocalized = (value) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((key) => LANGUAGE_KEY.test(key));

/** Every multi-language text under `root`, with its path. */
function collect(root, path = '') {
  if (isLocalized(root)) return [{ path, text: root }];
  if (Array.isArray(root)) return root.flatMap((item, index) => collect(item, `${path}[${index}]`));
  if (root && typeof root === 'object') {
    return Object.entries(root).flatMap(([key, value]) =>
      collect(value, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function checkText({ path, text }, max = Infinity, min = 1) {
  assert.deepEqual(Object.keys(text).sort(), EXPECTED, `${path}: languages`);
  for (const lang of LANGUAGES) {
    assert.equal(typeof text[lang], 'string', `${path}.${lang}`);
    assert.ok(text[lang].trim().length >= min, `${path}.${lang} is empty or too short`);
    assert.ok(
      text[lang].length <= max,
      `${path}.${lang} has ${text[lang].length} characters (${max} at most)`,
    );
  }
}

// What the core and the store allow, by place in the manifest.
function maxLengthOf(path) {
  if (path === 'description') return 100; // catalog card
  if (/^widgets\[\d+\]\.label$/.test(path)) return 30;
  if (/^widgets\[\d+\]\.description$/.test(path)) return 100;
  if (/\.description$/.test(path)) return 1000; // a section text
  return 200;
}

test('the configuration offers exactly the languages of the code', () => {
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(
    language.options.map((option) => option.value),
    LANGUAGES,
  );
  assert.deepEqual(LANGUAGES, ['en', 'fr', 'de', 'es']);
});

test('every manifest text exists in English, French, German and Spanish', () => {
  const texts = collect(manifest);
  // Nothing skipped: every label of every field, option, widget, scene card…
  const labels = JSON.stringify(manifest).match(/"label":/g).length;
  assert.equal(texts.filter(({ path }) => path.endsWith('.label')).length, labels);
  assert.ok(texts.length > 250, `only ${texts.length} texts found`);
  for (const entry of texts) {
    checkText(entry, maxLengthOf(entry.path), entry.path === 'description' ? 10 : 1);
  }
});

test('no plain string where the manifest expects a translated text', () => {
  const textKeys = new Set(['label', 'description', 'placeholder']);
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (textKeys.has(key)) {
        assert.ok(isLocalized(value), `${path}.${key} is not a multi-language text`);
      } else {
        walk(value, `${path}.${key}`);
      }
    }
  };
  walk(manifest, 'manifest');
});

test('every message table of the code is translated', () => {
  const tables = { MESSAGES, ...MESSAGE_TABLES, WIDGET_TEXTS, ACTION_TEXTS, SERVER_SUFFIX };
  let count = 0;
  const visit = (value, path) => {
    if (typeof value === 'function') {
      // Templates: filled with a sample value.
      return visit(value('Sample 42'), `${path}()`);
    }
    if (isLocalized(value)) {
      count += 1;
      // A toast or an error is truncated at 200 characters by the core.
      return checkText({ path, text: value }, 200);
    }
    assert.equal(typeof value, 'object', `${path} is not a translated text`);
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    return undefined;
  };
  for (const [name, table] of Object.entries(tables)) visit(table, name);
  assert.ok(count > 60, `only ${count} texts checked`);
});

test('the feature names exist in every language of the configuration', () => {
  assert.deepEqual(Object.keys(NAMES).sort(), EXPECTED);
  const keys = rendererFeatureKeys().sort();
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(NAMES[lang]).sort(), keys, `NAMES.${lang}`);
    for (const key of keys) assert.ok(NAMES[lang][key].trim(), `NAMES.${lang}.${key}`);
  }
});

test('the widget contents are translated and fit the core budget in every language', () => {
  const view = {
    name: 'Living room',
    reachable: true,
    status: {
      playback: 'playing',
      title: 'T',
      artist: 'A',
      album: 'B',
      muted: true,
    },
    queue: { index: 0, length: 3 },
    hasVolume: true,
    hasMute: true,
    favorite: null,
  };
  const config = normalizeConfig({
    favorite_1_name: 'A radio with a very long name indeed',
    favorite_1_url: 'http://radio.example/live.mp3',
    favorite_2_query: 'Jazz',
  });
  const contents = [
    playerContent('ext:dlna:renderer:x', view),
    playerContent('ext:dlna:renderer:x', null),
    playerContent('ext:dlna:renderer:x', { ...view, reachable: false }),
    favoritesContent(view, favoritesOf(config)),
    favoritesContent(view, []),
    favoritesContent(null, []),
  ];
  for (const content of contents) {
    assert.deepEqual(validateWidgetContent(content), []);
    for (const entry of collect(content)) checkText(entry);
    // Each language on its own, as the front resolves it.
    for (const lang of LANGUAGES) {
      const resolved = JSON.parse(
        JSON.stringify(content, (key, value) =>
          isLocalized(value) ? localize(value, lang) : value,
        ),
      );
      assert.deepEqual(validateWidgetContent(resolved), [], lang);
    }
  }
});

test('no text of the code is left in English and French only', async () => {
  // A literal `{ en, fr }` written without German and Spanish, or a text
  // picked by `language === 'fr'`, would slip past the tables above.
  const dir = new URL('../src/', import.meta.url);
  const files = (await readdir(dir, { recursive: true })).filter((name) => name.endsWith('.js'));
  for (const name of files) {
    const source = await readFile(new URL(name, dir), 'utf8');
    const count = (key) =>
      (source.match(new RegExp(`^\\s*${key}:|[{,]\\s*${key}:`, 'gm')) ?? []).length;
    assert.equal(count('de'), count('fr'), `${name}: French texts without German`);
    assert.equal(count('es'), count('fr'), `${name}: French texts without Spanish`);
    assert.doesNotMatch(source, /===\s*'fr'\s*\?/, `${name}: a text chosen by language`);
  }
});

test('German speaks to the user with "du", as the recent screens of Gladys do', async () => {
  // The polite forms only: "Sie" (capitalized, a whole word) and the
  // possessive "Ihr…". A lowercase "sie" (she, they, it) is fine.
  const polite = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
  const german = collect(manifest).map(({ path, text }) => [path, text.de]);
  const tables = { MESSAGES, ...MESSAGE_TABLES, WIDGET_TEXTS, ACTION_TEXTS, SERVER_SUFFIX, NAMES };
  const visit = (value, path) => {
    if (typeof value === 'function') return visit(value('Sample 42'), `${path}()`);
    // Feature names: one table of strings per language.
    if (path === 'NAMES') return visit(value.de, `${path}.de`);
    if (isLocalized(value)) return german.push([path, value.de]);
    if (typeof value === 'string') return german.push([path, value]);
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    return undefined;
  };
  for (const [name, table] of Object.entries(tables)) visit(table, name);
  // Every `de:` literal of the code, wherever it lives.
  const dir = new URL('../src/', import.meta.url);
  for (const name of (await readdir(dir, { recursive: true })).filter((n) => n.endsWith('.js'))) {
    const source = await readFile(new URL(name, dir), 'utf8');
    for (const [line] of source.matchAll(/^\s*de:.*$/gm)) german.push([name, line]);
  }
  assert.ok(german.length > 300, `only ${german.length} German texts checked`);
  for (const [path, text] of german) {
    assert.doesNotMatch(text, polite, `${path}: "${text}" uses the polite form`);
  }
});
