import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const mock = process.argv.includes('--mock');
const out = mock ? 'dist-mock' : 'docs';
const BUILD = Date.now().toString(36);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: ['src/app.js'], bundle: true, format: 'esm', splitting: true, minify: true,
  outdir: out, target: ['es2020', 'safari15'], legalComments: 'none',
  alias: { store: path.resolve(mock ? 'src/store-mock.js' : 'src/store-firebase.js') },
  chunkNames: 'chunk-[hash]',
});
fs.copyFileSync('src/styles.css', path.join(out, 'styles.css'));
for (const f of fs.readdirSync('public')) {
  let buf = fs.readFileSync(path.join('public', f));
  if (/\.(html|js|webmanifest)$/.test(f)) buf = Buffer.from(buf.toString().replaceAll('__BUILD__', BUILD));
  fs.writeFileSync(path.join(out, f), buf);
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('built', out, BUILD);
