#!/usr/bin/env node
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createSkillMetadata} from '../lib/skill-metadata.js';
import pkg from '../package.json' with {type: 'json'};
const source = fileURLToPath(new URL('../skills/slothvault-mcp', import.meta.url));
const target = fileURLToPath(new URL('../skill-release.json', import.meta.url));
const text = `${JSON.stringify(createSkillMetadata(source, pkg.version), null, 2)}\n`;
if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error('Run node scripts/skill-metadata.js before packaging.');
} else fs.writeFileSync(target, text);
