'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PRODUCT_NAME = 'NoteOrbit';

// Keep the existing settings and library selection when upgrading a renamed app.
function packagedUserDataPath(appDataRoot) {
  const candidates = [PRODUCT_NAME, '知识星系', 'knowledge-galaxy'].map(name => path.join(appDataRoot, name));
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'library.json'))) || candidates[0];
}

module.exports = { PRODUCT_NAME, packagedUserDataPath };
