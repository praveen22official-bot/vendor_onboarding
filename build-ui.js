// node build-ui.js  ->  dist/vendor-onboarding-desk.html  (one self-contained file: engine + scenarios + UI inlined)
const fs = require('fs'), path = require('path');
const r = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const wrap = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
let html = r('ui.src.html');
html = html.replace('<!--ENGINE-->', () => wrap(r('engine.js')))
  .replace('<!--SCENARIOS-->', () => wrap(r('scenarios.js')))
  .replace('<!--UI-->', () => wrap(r('ui.js')));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/vendor-onboarding-desk.html'), html);
console.log('built', (html.length / 1024).toFixed(0) + ' KB');
