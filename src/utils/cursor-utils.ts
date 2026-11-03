
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { logger } from './logger.js';
import { toBmpSafe } from './bmp-safe.js';
import { parseJsonWithBom } from '../shared/atomic-json.js';

export interface CursorProjectRegistry {
  [projectName: string]: {
    workspacePath: string;
    installedAt: string;
  };
}

export interface CursorMcpConfig {
  mcpServers: {
    [name: string]: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
}

export function readCursorRegistry(registryFile: string): CursorProjectRegistry {
  try {
    if (!existsSync(registryFile)) return {};
    return parseJsonWithBom<CursorProjectRegistry>(readFileSync(registryFile, 'utf-8'));
  } catch (error) {
    logger.error('CONFIG', 'Failed to read Cursor registry, using empty registry', {
      file: registryFile,
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
}

export function writeCursorRegistry(registryFile: string, registry: CursorProjectRegistry): void {
  const dir = join(registryFile, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

export function registerCursorProject(
  registryFile: string,
  projectName: string,
  workspacePath: string
): void {
  const registry = readCursorRegistry(registryFile);
  registry[projectName] = {
    workspacePath,
    installedAt: new Date().toISOString()
  };
  writeCursorRegistry(registryFile, registry);
}

export function unregisterCursorProject(registryFile: string, projectName: string): void {
  const registry = readCursorRegistry(registryFile);
  if (registry[projectName]) {
    delete registry[projectName];
    writeCursorRegistry(registryFile, registry);
  }
}

export function writeContextFile(workspacePath: string, context: string): void {
  const rulesDir = join(workspacePath, '.cursor', 'rules');
  const rulesFile = join(rulesDir, 'claude-mem-context.mdc');
  // Random name + exclusive create, as in claude-md-utils (#5145): a fixed
  // `.tmp` sibling can be committed to the workspace as a symlink, and the
  // write would follow it.
  const tempFile = `${rulesFile}.${randomUUID()}.tmp`;

  mkdirSync(rulesDir, { recursive: true });

  const content = `---
alwaysApply: true
description: "Claude-mem context from past sessions (auto-updated)"
---

# Memory Context from Past Sessions

The following context is from claude-mem, a persistent memory system that tracks your coding sessions.

${toBmpSafe(context)}

---
*Updated after last session. Use claude-mem's MCP search tools for more detailed queries.*
`;

  writeFileSync(tempFile, content, { flag: 'wx' });
  try {
    renameSync(tempFile, rulesFile);
  } catch (error) {
    try { unlinkSync(tempFile); } catch { /* best effort */ }
    throw error;
  }
}

export function configureCursorMcp(mcpJsonPath: string, mcpServerScriptPath: string): void {
  const dir = join(mcpJsonPath, '..');
  mkdirSync(dir, { recursive: true });

  let config: CursorMcpConfig = { mcpServers: {} };
  if (existsSync(mcpJsonPath)) {
    try {
      config = parseJsonWithBom<CursorMcpConfig>(readFileSync(mcpJsonPath, 'utf-8'));
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
    } catch (error) {
      // Rewriting it would drop every other MCP server the user configured.
      throw new Error(`Corrupt JSON in ${mcpJsonPath}, refusing to overwrite (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  config.mcpServers['claude-mem'] = {
    command: 'node',
    args: [mcpServerScriptPath]
  };

  writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2));
}
