import Table from "cli-table3";
import chalk from "chalk";
import { AppRepo } from "../db/repos.js";
import {
  getAllAppStatuses,
  openSharedPm2,
  closeSharedPm2
} from "../utils/pm2-helper.js";
import { supportsUnicode } from "../utils/terminal-capabilities.js";
import { formatRelative } from "../utils/date-helper.js";
import { CERT_EXPIRY_WARNING_DAYS } from "../utils/ssl-helper.js";
import { getHandler } from "../app-types/index.js";
import { Logger } from "../utils/logger.js";
function formatAppRoutes(app) {
  if (!app.routes || app.routes.length === 0) return [];
  const lines = [];
  for (const route of app.routes) {
    const domain = route.domain;
    const pathPart = route.path === "" ? "/" : `/${route.path}`;
    const ssl = domain.ssl;
    const protocol = ssl.mode === "none" ? "http" : "https";
    const url = `${protocol}://${domain.name}${pathPart}`;
    let sslLabel;
    if (ssl.mode === "none") {
      sslLabel = chalk.gray("no SSL");
    } else if (ssl.mode === "custom" && ssl.expiresAt) {
      const expiry = new Date(ssl.expiresAt);
      const now = /* @__PURE__ */ new Date();
      const warning = new Date(
        now.getTime() + CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1e3
      );
      const distance = formatRelative(ssl.expiresAt);
      if (expiry < now) sslLabel = chalk.red(`SSL expired ${distance}`);
      else if (expiry < warning)
        sslLabel = chalk.yellow(`SSL expires ${distance}`);
      else sslLabel = chalk.green(`SSL valid \xB7 expires ${distance}`);
    } else if (ssl.mode === "custom") {
      sslLabel = chalk.yellow("custom SSL (no cert)");
    } else {
      sslLabel = chalk.cyan(ssl.mode);
    }
    lines.push(`${chalk.magenta(url)}  ${sslLabel}`);
  }
  return lines;
}
const listApps = async (filterType, showStorages, showRoutes) => {
  let apps = await AppRepo.getAllWithStoragesAndRoutes();
  if (filterType) {
    const normalized = filterType.toLowerCase();
    apps = apps.filter((a) => a.projectType.toLowerCase() === normalized);
    if (apps.length === 0) {
      Logger.warn(`No apps found with type "${filterType}".`);
      return;
    }
  }
  await openSharedPm2();
  try {
    const statusMap = await getAllAppStatuses();
    for (const app of apps) {
      app.status = statusMap.get(app.name) || "not-found";
      if (showRoutes) {
        app.routeDisplay = formatAppRoutes(app);
      }
    }
  } finally {
    closeSharedPm2();
  }
  const headers = [
    chalk.cyan("Name"),
    chalk.cyan("Port"),
    chalk.cyan("Status"),
    chalk.cyan("Type")
  ];
  const termWidth = process.stdout.columns || 120;
  const colWidths = [];
  if (showStorages && showRoutes) {
    const fixedWidth = 8 + 12 + 12 + 18;
    const remaining = Math.max(termWidth - fixedWidth, 60);
    const nameW = Math.max(15, Math.floor(remaining * 0.25));
    const storageW = Math.max(18, Math.floor(remaining * 0.3));
    const routesW = Math.max(24, remaining - nameW - storageW);
    colWidths.push(nameW, 8, 12, 12, storageW, routesW);
    headers.push(chalk.cyan("Storages"), chalk.cyan("Routes"));
  } else if (showStorages) {
    const fixedWidth = 8 + 12 + 12 + 18;
    const remaining = Math.max(termWidth - fixedWidth, 40);
    const nameW = Math.max(15, Math.floor(remaining * 0.4));
    const storageW = Math.max(18, remaining - nameW);
    colWidths.push(nameW, 8, 12, 12, storageW);
    headers.push(chalk.cyan("Storages"));
  } else if (showRoutes) {
    const fixedWidth = 8 + 12 + 12 + 18;
    const remaining = Math.max(termWidth - fixedWidth, 40);
    const nameW = Math.max(15, Math.floor(remaining * 0.4));
    const routesW = Math.max(24, remaining - nameW);
    colWidths.push(nameW, 8, 12, 12, routesW);
    headers.push(chalk.cyan("Routes"));
  } else {
    const longestName = Math.max(
      ...apps.map((a) => a.name.length),
      "Name".length
    );
    const nameW = Math.min(
      Math.max(longestName + 2, 20),
      // at least 20
      35
      // never exceed 35
    );
    colWidths.push(nameW, 8, 12, 12);
  }
  const table = new Table({
    head: headers,
    colWidths,
    wordWrap: true,
    style: { "padding-left": 1, "padding-right": 1 }
  });
  for (const app of apps) {
    const statusColor = app.status === "online" ? chalk.green : app.status === "offline" ? chalk.red : app.status === "stopped" ? chalk.yellow : chalk.gray;
    const typeDisplay = (() => {
      try {
        return getHandler(app.projectType).getDisplayName(supportsUnicode);
      } catch {
        return app.projectType ?? "N/A";
      }
    })();
    const row = [
      chalk.white(app.name),
      chalk.white(app.port.toString()),
      statusColor(app.status || "unknown"),
      chalk.white(typeDisplay)
    ];
    if (showStorages) {
      const storageDisplay = app.storages && app.storages.length > 0 ? app.storages.map((s) => s.name).join("\n") : chalk.gray("None");
      row.push(storageDisplay);
    }
    if (showRoutes) {
      const routesDisplay = app.routeDisplay && app.routeDisplay.length > 0 ? app.routeDisplay.join("\n") : chalk.gray("None");
      row.push(routesDisplay);
    }
    table.push(row);
  }
  Logger.table(table.toString());
};
export {
  listApps
};
