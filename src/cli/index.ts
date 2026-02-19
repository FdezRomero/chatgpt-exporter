import { Command } from 'commander';
import { backupCommand } from './commands/backup.js';
import { listCommand } from './commands/list.js';
import { projectsCommand } from './commands/projects.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('chatgpt-exporter')
    .description('Export your ChatGPT conversations')
    .version('1.0.0')
    .action(() => {
      program.help();
    });

  const getToken = (options: { token?: string }): string => {
    const token = options.token ?? process.env.CHATGPT_TOKEN;
    if (!token) {
      console.error('Error: Access token required. Use --token or set CHATGPT_TOKEN env variable.');
      console.error('\nTo get your access token:');
      console.error('  1. Open chatgpt.com in your browser and log in');
      console.error('  2. Open DevTools (F12) → Network tab');
      console.error('  3. Refresh the page or send a message');
      console.error('  4. Find any request to /backend-api/*');
      console.error('  5. Look in Request Headers for "Authorization: Bearer <token>"');
      console.error('  6. Copy the token (starts with "eyJhbG...")');
      process.exit(1);
    }
    return token;
  };

  program
    .command('backup')
    .description('Download all conversations')
    .option('-t, --token <token>', 'Access token (or CHATGPT_TOKEN env)')
    .option('-o, --output <dir>', 'Output directory', './chatgpt-export')
    .option('--concurrency <n>', 'Parallel downloads', (v) => parseInt(v, 10), 3)
    .option('--delay <ms>', 'Delay between requests in ms', (v) => parseInt(v, 10), 500)
    .option('--incremental', 'Only download new/updated conversations', false)
    .option('--project <name-or-id>', 'Only backup conversations from a specific project')
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (options) => {
      const token = getToken(options);
      await backupCommand({
        token,
        output: options.output,
        concurrency: options.concurrency,
        delay: options.delay,
        incremental: options.incremental,
        verbose: options.verbose,
        project: options.project,
      });
    });

  program
    .command('list')
    .description('List conversations without downloading')
    .option('-t, --token <token>', 'Access token (or CHATGPT_TOKEN env)')
    .option('--delay <ms>', 'Delay between requests in ms', (v) => parseInt(v, 10), 500)
    .option('--project <name-or-id>', 'List conversations from a specific project')
    .option('-v, --verbose', 'Verbose logging', false)
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
      const token = getToken(options);
      await listCommand({
        token,
        delay: options.delay,
        verbose: options.verbose,
        json: options.json,
        project: options.project,
      });
    });

  program
    .command('projects')
    .description('List all projects')
    .option('-t, --token <token>', 'Access token (or CHATGPT_TOKEN env)')
    .option('-v, --verbose', 'Verbose logging', false)
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
      const token = getToken(options);
      await projectsCommand({
        token,
        verbose: options.verbose,
        json: options.json,
      });
    });

  return program;
}
