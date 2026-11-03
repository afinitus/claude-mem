import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, resolve } from 'path';
import { replaceTaggedContent } from './claude-md-utils.js';
import { ensureDirectoryExists, resolveSymlinkWriteTarget } from '../shared/atomic-json.js';
import { logger } from './logger.js';

export function writeAgentsMd(agentsPath: string, context: string): void {
  if (!agentsPath) return;

  const resolvedPath = resolve(agentsPath);
  if (resolvedPath.includes('/.git/') || resolvedPath.includes('\\.git\\') || resolvedPath.endsWith('/.git') || resolvedPath.endsWith('\\.git')) return;

  const dir = dirname(agentsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let existingContent = '';
  if (existsSync(agentsPath)) {
    existingContent = readFileSync(agentsPath, 'utf-8');
  }

  const contentBlock = `# Memory Context\n\n${context}`;
  const finalContent = replaceTaggedContent(existingContent, contentBlock);

  try {
    const writeTarget = resolveSymlinkWriteTarget(agentsPath);
    ensureDirectoryExists(dirname(writeTarget));
    // Random name + exclusive create, as in claude-md-utils (#5145): a fixed
    // `AGENTS.md.tmp` can be committed to a checkout as a symlink, and the write
    // would follow it.
    const tempFile = `${writeTarget}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, finalContent, { flag: 'wx' });
    try {
      renameSync(tempFile, writeTarget);
    } catch (error) {
      try { unlinkSync(tempFile); } catch { /* best effort */ }
      throw error;
    }
  } catch (error: unknown) {
    logger.error('AGENTS_MD', 'Failed to write AGENTS.md', { agentsPath }, error instanceof Error ? error : new Error(String(error)));
  }
}
