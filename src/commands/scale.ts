import { AppRepo, AppConfigRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';
import path from 'path';
import { ensureDirectories } from '../utils/file-utils.js';
import chalk from 'chalk';

interface ScaleParams {
  name: string;
  instances?: number;
  memory?: string;
  autorestart?: boolean;
  maxRestarts?: number;
  minUptime?: string;
  restartDelay?: number;
  nodeArgs?: string;
  killTimeout?: number;
  show?: boolean;
  resetOptional?: boolean;
}

function validateMemoryFormat(memory: string): void {
  if (!/^\d+[KMG]$/i.test(memory)) {
    throw new Error(
      'Invalid memory format. Use format like: 250M, 1G, 512M, 100K'
    );
  }
}

function validateTimeFormat(time: string): void {
  if (!/^\d+(ms|s|m|h)$/.test(time)) {
    throw new Error(
      'Invalid time format. Use format like: 10s, 1m, 5000ms, 1h'
    );
  }
}

export const scale = async (params: ScaleParams) => {
  const { name, show, resetOptional } = params;

  // Find the app with config
  const app = await AppRepo.findByNameWithConfig(name);

  // Show current configuration
  if (show) {
    Logger.info(`\nConfiguration for ${Logger.highlight(name)}:\n`);
    Logger.info(`  Project Type: ${Logger.highlight(app.projectType)}`);
    Logger.info(`  Instances: ${Logger.highlight(app.config.instances.toString())}`);
    Logger.info(`  Max Memory: ${Logger.highlight(app.config.maxMemory)}`);
    Logger.info(
      `  Auto Restart: ${app.config.autorestart === null ? chalk.dim('default (PM2: true)') : Logger.highlight(String(app.config.autorestart))}`
    );
    Logger.info(
      `  Max Restarts: ${app.config.maxRestarts === null ? chalk.dim('default (PM2: 15)') : Logger.highlight(app.config.maxRestarts?.toString() ?? '')}`
    );
    Logger.info(
      `  Min Uptime: ${app.config.minUptime === null ? chalk.dim('default (PM2: 1000ms)') : Logger.highlight(app.config.minUptime ?? '')}`
    );
    Logger.info(
      `  Restart Delay: ${app.config.restartDelay === null ? chalk.dim('default (PM2: 0ms)') : Logger.highlight(app.config.restartDelay + 'ms')}`
    );
    Logger.info(
      `  Kill Timeout: ${app.config.killTimeout === null ? chalk.dim('default (PM2: 1600ms)') : Logger.highlight(app.config.killTimeout + 'ms')}`
    );
    Logger.info(
      `  Node Args: ${app.config.nodeArgs === null ? chalk.dim('none') : Logger.highlight(app.config.nodeArgs ?? '')}`
    );
    return;
  }

  // Reset optional parameters to PM2 defaults
  if (resetOptional) {
    Logger.info('Resetting optional parameters to PM2 defaults...');
    await AppConfigRepo.update(app.id, {
      autorestart: null,
      maxRestarts: null,
      minUptime: null,
      restartDelay: null,
      nodeArgs: null,
      killTimeout: null,
    });
    Logger.success('Optional parameters reset. Instances and memory unchanged.');
    return;
  }

  // Validate and prepare update data
  const updates: any = {};
  let needsRestart = false;

  // Validate instances for dotnet
  if (params.instances !== undefined) {
    if (app.projectType === 'dotnet' && params.instances > 1) {
      throw new Error(
        '.NET apps do not support multiple instances (cluster mode). Use instances=1.'
      );
    }
    if (app.projectType === 'static' && params.instances > 1) {
      Logger.warn(
        'Static apps typically run in fork mode with a single instance.'
      );
    }
    if (params.instances < 1) {
      throw new Error('Instances must be at least 1');
    }
    updates.instances = params.instances;
    needsRestart = true;
  }

  // Validate memory format
  if (params.memory !== undefined) {
    validateMemoryFormat(params.memory);
    updates.maxMemory = params.memory;
    needsRestart = true;
  }

  // Validate node_args only for Node.js apps
  if (params.nodeArgs !== undefined) {
    if (app.projectType === 'dotnet') {
      throw new Error(
        '--node-args is only valid for Node.js apps (nextjs/nestjs), not dotnet'
      );
    }
    if (app.projectType === 'static') {
      Logger.warn(
        'Node arguments for static apps are rarely needed. Ensure your static server uses them.'
      );
    }
    updates.nodeArgs = params.nodeArgs || null;
    needsRestart = true;
  }

  // Validate time formats
  if (params.minUptime !== undefined) {
    if (params.minUptime) {
      validateTimeFormat(params.minUptime);
    }
    updates.minUptime = params.minUptime || null;
    needsRestart = true;
  }

  // Optional parameters
  if (params.autorestart !== undefined) {
    updates.autorestart = params.autorestart;
    needsRestart = true;
  }

  if (params.maxRestarts !== undefined) {
    if (params.maxRestarts < 0) {
      throw new Error('Max restarts must be 0 or greater');
    }
    updates.maxRestarts = params.maxRestarts;
    needsRestart = true;
  }

  if (params.restartDelay !== undefined) {
    if (params.restartDelay < 0) {
      throw new Error('Restart delay must be 0 or greater (milliseconds)');
    }
    updates.restartDelay = params.restartDelay;
    needsRestart = true;
  }

  if (params.killTimeout !== undefined) {
    if (params.killTimeout < 0) {
      throw new Error('Kill timeout must be 0 or greater (milliseconds)');
    }
    if (params.killTimeout > 0 && params.killTimeout < 1000) {
      Logger.warn(
        'Kill timeout < 1000ms may not allow graceful shutdown. Consider 5000ms or higher.'
      );
    }
    updates.killTimeout = params.killTimeout;
    needsRestart = true;
  }

  // Check if any updates were provided
  if (Object.keys(updates).length === 0) {
    Logger.info(
      'No changes specified. Use --show to see current configuration.'
    );
    return;
  }

  // Update the configuration
  Logger.info(`Updating configuration for ${Logger.highlight(name)}...`);
  const updatedConfig = await AppConfigRepo.update(app.id, updates);

  // Display what changed
  Logger.success('Configuration updated:');
  if (updates.instances !== undefined) {
    Logger.info(
      `  Instances: ${app.config.instances} → ${Logger.highlight(updatedConfig.instances.toString())}`
    );
  }
  if (updates.maxMemory !== undefined) {
    Logger.info(
      `  Max Memory: ${app.config.maxMemory} → ${Logger.highlight(updatedConfig.maxMemory)}`
    );
  }
  if (updates.autorestart !== undefined) {
    Logger.info(
      `  Auto Restart: ${app.config.autorestart ?? 'default'} → ${Logger.highlight(String(updatedConfig.autorestart))}`
    );
  }
  if (updates.maxRestarts !== undefined) {
    Logger.info(
      `  Max Restarts: ${app.config.maxRestarts ?? 'default'} → ${Logger.highlight(updatedConfig.maxRestarts?.toString() ?? 'default')}`
    );
  }
  if (updates.minUptime !== undefined) {
    Logger.info(
      `  Min Uptime: ${app.config.minUptime ?? 'default'} → ${Logger.highlight(updatedConfig.minUptime ?? 'default')}`
    );
  }
  if (updates.restartDelay !== undefined) {
    Logger.info(
      `  Restart Delay: ${app.config.restartDelay ?? 'default'} → ${Logger.highlight(updatedConfig.restartDelay?.toString() ?? 'default')}ms`
    );
  }
  if (updates.killTimeout !== undefined) {
    Logger.info(
      `  Kill Timeout: ${app.config.killTimeout ?? 'default'} → ${Logger.highlight(updatedConfig.killTimeout?.toString() ?? 'default')}ms`
    );
  }
  if (updates.nodeArgs !== undefined) {
    Logger.info(
      `  Node Args: ${app.config.nodeArgs ?? 'none'} → ${Logger.highlight(updatedConfig.nodeArgs ?? 'none')}`
    );
  }

  // Restart the app if it's running
  if (needsRestart) {
    const status = await getAppStatus(name);
    if (status === 'online') {
      Logger.info('Restarting app with new configuration...');

      const activeBuild = await AppRepo.resolveActiveBuild(name);
      if (!activeBuild) {
        throw new Error(
          `No active build found for ${name}. Deploy the app first.`
        );
      }

      const { logDir } = ensureDirectories(app.appDir);

      await runApp(activeBuild, {
        name: app.name,
        port: app.port,
        status,
        output: path.join(logDir, 'pm2.out.log'),
        error: path.join(logDir, 'pm2.error.log'),
        projectType: app.projectType,
        config: updatedConfig,
      });

      Logger.success(`${Logger.highlight(name)} restarted with new configuration.`);
    } else {
      Logger.info(
        `App is not running (status: ${status}). Changes will apply on next start.`
      );
    }
  }
};
