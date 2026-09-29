/**
 * @file skill-metadata.js
 * @project SlothVault
 * @module SlothVault Skill Distribution
 * @description Builds Skill version and file-digest metadata for the Vault toolkit Release.
 * @logic Read the semantic version from frontmatter, hash every regular bundled file, and compare the manifest during installation.
 * @dependencies node:fs/path/crypto
 * @index_tags skill,version,release,sha256
 * @author holic512
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function readSkillVersion(sourcePath, fileSystem = fs) {
    const source = fileSystem.readFileSync(path.join(sourcePath, 'SKILL.md'), 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] || '';
    return frontmatter.match(/^\s+version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/mu)?.[1] || null;
}
export function createSkillMetadata(sourcePath, pluginVersion, fileSystem = fs) {
    const version = readSkillVersion(sourcePath, fileSystem);
    if (!version) throw new Error('Bundled Skill has no semantic metadata.version.');
    const files = {};
    function visit(directory) {
        for (const name of fileSystem.readdirSync(directory).sort()) {
            const file = path.join(directory, name);
            const stat = fileSystem.lstatSync(file);
            if (stat.isSymbolicLink()) throw new Error('Bundled Skill must contain regular files only.');
            if (stat.isDirectory()) visit(file);
            else if (stat.isFile()) files[path.relative(sourcePath, file).split(path.sep).join('/')] = createHash('sha256').update(fileSystem.readFileSync(file)).digest('hex');
        }
    }
    visit(sourcePath);
    return {schema: 1, name: 'slothvault-mcp', skillVersion: version, pluginVersion, files};
}
export function verifySkillMetadata(sourcePath, metadata, pluginVersion, fileSystem = fs) {
    const actual = createSkillMetadata(sourcePath, pluginVersion, fileSystem);
    if (metadata?.schema !== 1 || metadata?.name !== actual.name || metadata.skillVersion !== actual.skillVersion || metadata.pluginVersion !== pluginVersion || JSON.stringify(metadata.files) !== JSON.stringify(actual.files)) {
        throw new Error('Skill metadata does not match bundled files.');
    }
    return actual;
}
