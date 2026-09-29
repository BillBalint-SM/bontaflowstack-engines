import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function ensure(value, message) { if (!value) throw new Error(message); }
export function options(args) {
  const values = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { rest.push(args[i]); continue; }
    const key = args[i].slice(2);
    values[key] = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : true;
  }
  return { values, rest };
}
export function noLinks(file) {
  let current = path.resolve(file);
  for (;;) {
    ensure(!fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink(), `Linked state path: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export function writeJson(file, value) {
  noLinks(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`, data = JSON.stringify(value, null, 2) + '\n';
  const previous = fs.existsSync(file) ? fs.readFileSync(file) : null;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    ensure(fs.readFileSync(temporary, 'utf8') === data, 'State write verification failed');
    fs.renameSync(temporary, file);
    try { ensure(fs.readFileSync(file, 'utf8') === data, 'Saved state verification failed'); }
    catch(error) {
      if(previous) {fs.writeFileSync(temporary,previous,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
      else fs.unlinkSync(file);
      throw error;
    }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function readJson(file, fallback = null) {
  noLinks(file);
  if (!fs.existsSync(file)) return fallback;
  ensure(fs.statSync(file).size < 8 * 1024 * 1024, 'State exceeds 8 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function outputFile(cwd, value) {
  ensure(typeof value === 'string' && value.trim(), 'An output path is required');
  const file = path.resolve(cwd, value); noLinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true }); return file;
}
export function webUrl(value) {
  const url = new URL(value);
  ensure(['http:', 'https:', 'file:', 'about:'].includes(url.protocol), 'Unsupported URL protocol');
  ensure(!url.username && !url.password, 'Use browser login rather than URL credentials');
  ensure(url.protocol !== 'about:' || value === 'about:blank', 'Unsupported about page');
  return url.href;
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function imageData(file) {
  const bytes = fs.readFileSync(file);
  ensure(bytes.length <= 30 * 1024 * 1024, 'Image exceeds 30 MiB');
  const kind = path.extname(file).toLowerCase();
  ensure(['.png','.jpg','.jpeg','.webp'].includes(kind), 'Use PNG, JPEG or WebP');
  return `data:image/${kind === '.jpg' || kind === '.jpeg' ? 'jpeg' : kind.slice(1)};base64,${bytes.toString('base64')}`;
}
export function print(value) { process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value)) + '\n'); }
export function fail(error) { process.stderr.write(JSON.stringify({status:'failed',error:error.message})+'\n'); process.exitCode = error.exitCode || 1; }
