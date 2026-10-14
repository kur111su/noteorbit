'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PRODUCT_NAME, packagedUserDataPath } = require('../electron/identity.cjs');

test('the new brand keeps existing settings and selects NoteOrbit for new installs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noteorbit-identity-'));
  t.after(() => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert(path.basename(absolute).startsWith('noteorbit-identity-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  assert.equal(PRODUCT_NAME, 'NoteOrbit');
  assert.equal(packagedUserDataPath(root), path.join(root, 'NoteOrbit'));
  for (const name of ['knowledge-galaxy', '知识星系', 'NoteOrbit']) {
    const destination = path.join(root, name);
    fs.mkdirSync(destination);
    const settings = JSON.stringify({ path: path.join(root, 'my-library') });
    fs.writeFileSync(path.join(destination, 'library.json'), settings);
    assert.equal(packagedUserDataPath(root), destination);
    assert.equal(fs.readFileSync(path.join(destination, 'library.json'), 'utf8'), settings);
  }
});
