// Loads the DOM-free rules module into node.
// v23: pre-v23 suites assume the vehicle kit is at primary staging from turn 0; pass { real: true } for the v23 arrival rules.
const fs = require('fs'), path = require('path');
module.exports = function load(opt) { const src = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8'); const Core = new Function(src + ';return Core;')();
  if (!(opt && opt.real) && Core.V23) Core.V23.eqAtStart = true; return Core; };
