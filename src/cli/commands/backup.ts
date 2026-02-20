import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { ChatGPTClient } from '../../api/client.js';
import {
  BackupService,
  type BackupResult
} from '../../services/backup-service.js';
import {
  scanAllConversations,
  downloadFiles
} from '../../services/file-service.js';
import { convertDirectory } from '../../services/markdown-service.js';
import { StorageService } from '../../services/storage-service.js';
import { createProgressBar } from '../../utils/progress.js';

export interface BackupCommandOptions {
  token: string;
  output: string;
  concurrency: number;
  delay: number;
  incremental: boolean;
  downloadFiles: boolean;
  verbose: boolean;
  project?: string;
}

function runBackupWithProgress(
  service: BackupService,
  spinner: ReturnType<typeof ora>,
  options: {
    concurrency: number;
    delay: number;
    incremental: boolean;
    verbose: boolean;
    projectGizmoId?: string;
  }
): Promise<BackupResult> {
  let listProgressBar: ReturnType<typeof createProgressBar> | null = null;
  let downloadProgressBar: ReturnType<typeof createProgressBar> | null = null;
  let listingDone = false;

  return service
    .backup({
      ...options,
      onListProgress: (fetched, totalList) => {
        if (!listingDone) {
          if (!listProgressBar) {
            spinner.stop();
            listProgressBar = createProgressBar(totalList, 'Listing    ');
          }
          listProgressBar.setTotal(totalList);
          listProgressBar.update(fetched);

          if (fetched >= totalList) {
            listProgressBar.stop();
            listingDone = true;
            console.log();
          }
        }
      },
      onDownloadProgress: (completed, totalDownload) => {
        if (listingDone) {
          if (!downloadProgressBar) {
            downloadProgressBar = createProgressBar(
              totalDownload,
              'Downloading'
            );
          }
          downloadProgressBar.update(completed);
        }
      },
      onError: (id, error) => {
        if (options.verbose) {
          console.error(
            chalk.red(`\nFailed to download ${id}: ${error.message}`)
          );
        }
      }
    })
    .then(result => {
      downloadProgressBar?.stop();
      return result;
    });
}

export async function backupCommand(
  options: BackupCommandOptions
): Promise<void> {
  const {
    token,
    output,
    concurrency,
    delay,
    incremental,
    downloadFiles: shouldDownloadFiles,
    verbose,
    project
  } = options;

  const client = new ChatGPTClient(token, { verbose });
  const spinner = ora('Authenticating...').start();

  try {
    await client.initialize();
    spinner.succeed('Authenticated');

    console.log(chalk.dim(`\nBackup settings:`));
    console.log(chalk.dim(`  Output: ${output}`));
    console.log(chalk.dim(`  Concurrency: ${concurrency}`));
    console.log(chalk.dim(`  Delay: ${delay}ms`));
    console.log(chalk.dim(`  Incremental: ${incremental}`));
    console.log(chalk.dim(`  Download files: ${shouldDownloadFiles}`));
    if (project) {
      console.log(chalk.dim(`  Project: ${project}`));
    }
    console.log();

    if (project) {
      // Single project backup
      const baseService = new BackupService(client, new StorageService(output));
      spinner.start('Resolving project...');
      const { gizmoId, name } = await baseService.resolveProjectId(project);
      spinner.succeed(`Project: ${name}`);

      const storage = new StorageService(output, name);
      const service = new BackupService(client, storage);

      spinner.start(`Backing up project "${name}"...`);
      const result = await runBackupWithProgress(service, spinner, {
        concurrency,
        delay,
        incremental,
        verbose,
        projectGizmoId: gizmoId
      });

      if (shouldDownloadFiles) {
        await runFileDownloads(client, output, { concurrency, delay, verbose });
      }

      const filesDir = shouldDownloadFiles
        ? path.join(output, 'files')
        : undefined;
      const md = await convertDirectory(output, filesDir);

      printResult(result, output);
      console.log(`Converted ${md.converted} conversations to markdown.`);
      if (md.errors > 0) {
        console.log(`Markdown conversion errors: ${chalk.red(md.errors)}`);
      }
    } else {
      // Full backup: main conversations + all projects
      let totalDownloaded = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      let totalConversations = 0;

      // 1. Main conversations
      console.log(chalk.bold('Main conversations\n'));
      const mainStorage = new StorageService(output);
      const mainService = new BackupService(client, mainStorage);

      spinner.start('Fetching conversation list...');
      const mainResult = await runBackupWithProgress(mainService, spinner, {
        concurrency,
        delay,
        incremental,
        verbose
      });

      totalDownloaded += mainResult.downloaded;
      totalSkipped += mainResult.skipped;
      totalFailed += mainResult.failed;
      totalConversations += mainResult.totalConversations;

      console.log();
      console.log(
        `  Downloaded: ${chalk.green(mainResult.downloaded)}, Skipped: ${chalk.yellow(mainResult.skipped)}, Failed: ${chalk.red(mainResult.failed)}`
      );
      console.log();

      // 2. Projects
      spinner.start('Fetching projects...');
      const projects = await mainService.listProjects();
      spinner.succeed(`Found ${projects.length} projects`);

      for (const proj of projects) {
        const name = proj.gizmo.display.name;
        const gizmoId = proj.gizmo.id;

        console.log();
        console.log(chalk.bold(`Project: ${name}\n`));

        const projStorage = new StorageService(output, name);
        const projService = new BackupService(client, projStorage);

        spinner.start(`Backing up "${name}"...`);
        const projResult = await runBackupWithProgress(projService, spinner, {
          concurrency,
          delay,
          incremental,
          verbose,
          projectGizmoId: gizmoId
        });

        totalDownloaded += projResult.downloaded;
        totalSkipped += projResult.skipped;
        totalFailed += projResult.failed;
        totalConversations += projResult.totalConversations;

        console.log();
        console.log(
          `  Downloaded: ${chalk.green(projResult.downloaded)}, Skipped: ${chalk.yellow(projResult.skipped)}, Failed: ${chalk.red(projResult.failed)}`
        );
      }

      if (shouldDownloadFiles) {
        await runFileDownloads(client, output, { concurrency, delay, verbose });
      }

      const filesDir = shouldDownloadFiles
        ? path.join(output, 'files')
        : undefined;
      const md = await convertDirectory(output, filesDir);

      console.log();
      console.log(chalk.green('\nBackup completed!'));
      console.log(`  Total conversations: ${totalConversations}`);
      console.log(`  Downloaded: ${chalk.green(totalDownloaded)}`);
      if (totalSkipped > 0) {
        console.log(`  Skipped (unchanged): ${chalk.yellow(totalSkipped)}`);
      }
      if (totalFailed > 0) {
        console.log(`  Failed: ${chalk.red(totalFailed)}`);
      }
      console.log(`  Converted ${md.converted} conversations to markdown`);
      if (md.errors > 0) {
        console.log(`  Markdown errors: ${chalk.red(md.errors)}`);
      }
      console.log(`\nOutput directory: ${chalk.cyan(output)}`);
    }
  } catch (error) {
    spinner.fail('Backup failed');

    if (error instanceof Error) {
      if (error.name === 'AuthenticationError') {
        console.error(chalk.red(`\nAuthentication failed: ${error.message}`));
        console.error(chalk.yellow('\nTo get a new access token:'));
        console.error('  1. Open chatgpt.com in your browser and log in');
        console.error('  2. Open DevTools (F12) → Network tab');
        console.error('  3. Refresh the page or send a message');
        console.error('  4. Find any request to /backend-api/*');
        console.error(
          '  5. Look in Request Headers for "Authorization: Bearer <token>"'
        );
        console.error('  6. Copy the token (starts with "eyJhbG...")');
      } else {
        console.error(chalk.red(`\nError: ${error.message}`));
      }
    }

    process.exit(1);
  }
}

function printResult(result: BackupResult, output: string): void {
  console.log();
  console.log(chalk.green('\nBackup completed!'));
  console.log(`  Total conversations: ${result.totalConversations}`);
  console.log(`  Downloaded: ${chalk.green(result.downloaded)}`);
  if (result.skipped > 0) {
    console.log(`  Skipped (unchanged): ${chalk.yellow(result.skipped)}`);
  }
  if (result.failed > 0) {
    console.log(`  Failed: ${chalk.red(result.failed)}`);
    console.log(chalk.dim(`  See ${output}/backup.log for details`));
  }
  console.log(`\nOutput directory: ${chalk.cyan(output)}`);
}

async function loadFailedFiles(output: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(output, 'metadata.json'), 'utf-8');
    const metadata = JSON.parse(raw);
    if (Array.isArray(metadata.failedFiles)) {
      return new Set(metadata.failedFiles as string[]);
    }
  } catch {
    // No metadata yet
  }
  return new Set();
}

async function saveFailedFiles(
  output: string,
  failedFileIds: string[]
): Promise<void> {
  const metadataPath = path.join(output, 'metadata.json');
  let metadata: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(metadataPath, 'utf-8');
    metadata = JSON.parse(raw);
  } catch {
    // No metadata yet
  }
  metadata.failedFiles = failedFileIds;
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

async function runFileDownloads(
  client: ChatGPTClient,
  output: string,
  options: { concurrency: number; delay: number; verbose: boolean }
): Promise<void> {
  console.log();
  const spinner = ora('Scanning conversations for file references...').start();
  const refs = await scanAllConversations(output);
  const skipFileIds = await loadFailedFiles(output);
  const skippedKnown = skipFileIds.size > 0
    ? refs.filter(r => skipFileIds.has(r.fileId)).length
    : 0;
  const activeCount = refs.length - skippedKnown;
  spinner.succeed(
    `Found ${refs.length} file references` +
      (skippedKnown > 0
        ? ` (${skippedKnown} previously failed, skipped)`
        : '') +
      '\n'
  );

  if (activeCount === 0) return;

  const state = { bar: null as ReturnType<typeof createProgressBar> | null };
  const errors: Array<{ fileId: string; message: string }> = [];

  const result = await downloadFiles(client, refs, output, {
    concurrency: options.concurrency,
    delay: options.delay,
    verbose: options.verbose,
    skipFileIds,
    onProgress: (completed, total) => {
      if (!state.bar) {
        state.bar = createProgressBar(total, 'Files      ');
      }
      state.bar.update(completed);
    },
    onError: (fileId, error) => {
      errors.push({ fileId, message: error.message });
    }
  });

  state.bar?.stop();
  console.log();
  console.log(
    `  Downloaded: ${chalk.green(result.downloaded)}, Skipped: ${chalk.yellow(result.skipped)}, Failed: ${chalk.red(result.failed)}`
  );

  // Merge new failures with previously known ones
  const allFailed = [...skipFileIds, ...result.failedFileIds];
  await saveFailedFiles(output, allFailed);

  if (errors.length > 0) {
    // Group errors by message
    const grouped = new Map<string, string[]>();
    for (const e of errors) {
      const list = grouped.get(e.message) ?? [];
      list.push(e.fileId);
      grouped.set(e.message, list);
    }
    for (const [message, fileIds] of grouped) {
      console.log(chalk.red(`    ${fileIds.length} files: ${message}`));
      if (options.verbose) {
        for (const id of fileIds) {
          console.log(chalk.dim(`      ${id}`));
        }
      }
    }
  }
}
