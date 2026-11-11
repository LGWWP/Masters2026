/*
 * Packages the built Vite output (`dist/`) into a Crestron `.ch5z` archive
 * without depending on the Crestron `ch5-cli` tool.
 *
 * A `.ch5z` is a two-level zip:
 *
 *   <name>.ch5z (zip)
 *   ├── <name>_manifest.json   { projectname, modifiedtime, sha-256 }
 *   └── <name>.ch5 (zip)
 *       ├── index.html
 *       ├── assets/...
 *       └── appui/manifest      (text file: "apptype:ch5")
 *
 * Usage:
 *   node scripts/pack-ch5z.mjs [--name <projectName>] [--dist <dir>] [--out <dir>]
 *
 * Defaults come from package.json (`name`) and standard Vite paths.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { name: null, dist: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--dist') args.dist = argv[++i];
    else if (a === '--out') args.out = argv[++i];
  }
  return args;
}

async function loadDefaults() {
  const pkgRaw = await readFile(path.join(projectRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  return {
    name: pkg.name || 'ch5-project',
    dist: path.join(projectRoot, 'dist'),
    out: path.join(projectRoot, 'release')
  };
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Zip the contents of `srcDir` into `outFile`. Adds an extra virtual entry
 * `appui/manifest` containing the CH5 apptype marker.
 */
function zipDist(srcDir, outFile) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') console.warn('[pack-ch5z]', err);
      else reject(err);
    });
    archive.on('error', reject);

    archive.pipe(output);
    // Everything from dist/ goes at the archive root
    archive.directory(srcDir, false);
    // CH5 runtime marker — required so the panel recognizes the payload
    archive.append('apptype:ch5', { name: 'appui/manifest' });
    archive.finalize();
  });
}

/** Zip the outer `.ch5z` containing the inner `.ch5` and its manifest json. */
function zipOuter(innerCh5Path, manifestJsonPath, outFile) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') console.warn('[pack-ch5z]', err);
      else reject(err);
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.file(innerCh5Path, { name: path.basename(innerCh5Path) });
    archive.file(manifestJsonPath, { name: path.basename(manifestJsonPath) });
    archive.finalize();
  });
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const defaults = await loadDefaults();

  const name = cli.name || defaults.name;
  const distDir = path.resolve(cli.dist || defaults.dist);
  const outDir = path.resolve(cli.out || defaults.out);

  if (!(await pathExists(distDir))) {
    console.error(
      `[pack-ch5z] dist directory not found: ${distDir}\n` +
        'Run `npm run build` first (or pass --dist <dir>).'
    );
    process.exit(1);
  }

  await ensureDir(outDir);

  const stagingDir = path.join(outDir, '.staging');
  await rm(stagingDir, { recursive: true, force: true });
  await ensureDir(stagingDir);

  const innerCh5 = path.join(stagingDir, `${name}.ch5`);
  const manifestJson = path.join(stagingDir, `${name}_manifest.json`);
  const outerCh5z = path.join(outDir, `${name}.ch5z`);

  console.log(`[pack-ch5z] packing dist -> ${path.relative(projectRoot, innerCh5)}`);
  await zipDist(distDir, innerCh5);

  const sha = await sha256File(innerCh5);
  const manifest = {
    projectname: `${name}.ch5`,
    modifiedtime: new Date().toISOString(),
    'sha-256': sha
  };
  await writeFile(manifestJson, JSON.stringify(manifest));

  console.log(`[pack-ch5z] wrapping -> ${path.relative(projectRoot, outerCh5z)}`);
  await zipOuter(innerCh5, manifestJson, outerCh5z);

  await rm(stagingDir, { recursive: true, force: true });

  const finalStat = await stat(outerCh5z);
  console.log(
    `[pack-ch5z] done: ${outerCh5z} (${(finalStat.size / 1024).toFixed(1)} KB, sha256=${sha.slice(0, 12)}...)`
  );
}

main().catch((err) => {
  console.error('[pack-ch5z] failed:', err);
  process.exit(1);
});
