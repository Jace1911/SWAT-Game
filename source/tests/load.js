// Loads the DOM-free rules module into node.
const fs = require('fs'), path = require('path');
module.exports = function load() { const src = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8'); return new Function(src + ';return Core;')(); };
