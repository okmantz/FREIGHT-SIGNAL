import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipMap } from '../../js/core/zipmap.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const fixture = (n) => fs.readFileSync(path.join(root, 'tests/fixtures', n), 'utf8');
let zm;
export const realZipMap = () => (zm ||= ZipMap.fromCsv(fs.readFileSync(path.join(root, 'data/uszips.csv'), 'utf8')));
