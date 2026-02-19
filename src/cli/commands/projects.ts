import chalk from 'chalk';
import ora from 'ora';
import { ChatGPTClient } from '../../api/client.js';
import { BackupService } from '../../services/backup-service.js';
import { StorageService } from '../../services/storage-service.js';

export interface ProjectsCommandOptions {
  token: string;
  verbose: boolean;
  json: boolean;
}

export async function projectsCommand(options: ProjectsCommandOptions): Promise<void> {
  const { token, verbose, json } = options;

  const client = new ChatGPTClient(token, { verbose });
  const storage = new StorageService('./chatgpt-export');
  const service = new BackupService(client, storage);

  const spinner = ora('Authenticating...').start();

  try {
    await client.initialize();
    spinner.text = 'Fetching projects...';

    const projects = await service.listProjects();
    spinner.succeed(`Found ${projects.length} projects`);

    if (json) {
      const output = projects.map((p) => ({
        id: p.gizmo.id,
        name: p.gizmo.display.name,
        num_interactions: p.gizmo.num_interactions,
        last_interacted_at: p.gizmo.last_interacted_at,
        is_archived: p.gizmo.is_archived,
      }));
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log();
      for (const project of projects) {
        const gizmo = project.gizmo;
        const name = gizmo.display.name;
        const id = gizmo.id;
        const lastInteracted = gizmo.last_interacted_at
          ? new Date(gizmo.last_interacted_at).toLocaleDateString()
          : 'never';

        console.log(
          `${chalk.cyan(id)} ${chalk.bold(name)} ${chalk.dim(`[last: ${lastInteracted}]`)}`
        );
      }
      console.log();
      console.log(chalk.green(`Total: ${projects.length} projects`));
    }
  } catch (error) {
    spinner.fail('Failed to list projects');

    if (error instanceof Error) {
      if (error.name === 'AuthenticationError') {
        console.error(chalk.red(`\nAuthentication failed: ${error.message}`));
        console.error(chalk.yellow('\nTo get a new access token:'));
        console.error('  1. Open chatgpt.com in your browser and log in');
        console.error('  2. Open DevTools (F12) → Network tab');
        console.error('  3. Refresh the page or send a message');
        console.error('  4. Find any request to /backend-api/*');
        console.error('  5. Look in Request Headers for "Authorization: Bearer <token>"');
        console.error('  6. Copy the token (starts with "eyJhbG...")');
      } else {
        console.error(chalk.red(`\nError: ${error.message}`));
      }
    }

    process.exit(1);
  }
}
