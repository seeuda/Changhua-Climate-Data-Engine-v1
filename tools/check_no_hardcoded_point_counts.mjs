#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenCounts = ['14' + '0', '8' + '8', '5' + '2'];
const sourceFiles = [
    'app.js',
    ...fs.readdirSync(path.join(repoRoot, 'tools'))
        .filter(name => /\.(?:mjs|js|py)$/.test(name) && name !== path.basename(fileURLToPath(import.meta.url)))
        .map(name => `tools/${name}`)
];
const violations = [];

for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    source.split(/\r?\n/).forEach((line, index) => {
        for (const count of forbiddenCounts) {
            const pattern = new RegExp(`(^|[^0-9])${count}([^0-9]|$)`);
            if (pattern.test(line)) violations.push(`${relativePath}:${index + 1}: forbidden permanent point count ${count}`);
        }
    });
}

if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`No permanent point-count constants found in ${sourceFiles.length} source files.`);
}
