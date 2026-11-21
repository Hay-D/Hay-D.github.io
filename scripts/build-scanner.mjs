import {spawnSync} from 'node:child_process';
import {chmodSync, renameSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../public/scanner/recognizer.wasm', import.meta.url);
const temporary = new URL('./recognizer.wasm.tmp', output);

try {
  const result = spawnSync('rustc', [
    '--edition', '2021', '--crate-type', 'cdylib', '--target', 'wasm32-unknown-unknown',
    '-C', 'opt-level=3', '-C', 'lto=fat', '-C', 'panic=abort', '-C', 'strip=symbols',
    'scanner-rust/src/lib.rs', '-o', fileURLToPath(temporary)
  ], {cwd: root, stdio: 'inherit'});
  if (result.error || result.status !== 0) {
    throw new Error('Install Rust and run rustup target add wasm32-unknown-unknown before building the scanner.');
  }
  chmodSync(temporary, 0o644);
  renameSync(temporary, output);
  console.log('Built public/scanner/recognizer.wasm');
} finally {
  rmSync(temporary, {force: true});
}
