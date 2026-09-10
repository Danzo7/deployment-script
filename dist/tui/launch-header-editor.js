import { jsx } from "react/jsx-runtime";
import { render } from "ink";
import { HeaderEditor } from "./HeaderEditor.js";
import { Logger } from "../utils/logger.js";
import { pauseRepl, resumeRepl } from "../utils/repl-context.js";
async function applyDomainChanges(domainName, rows) {
  const { domainSetHeader } = await import("../commands/domain-set-header.js");
  const { domainRemoveHeader } = await import("../commands/domain-remove-header.js");
  for (const row of rows) {
    if (row.state === "new" || row.state === "modified") {
      await domainSetHeader(domainName, row.key, row.value);
    } else if (row.state === "deleted") {
      await domainRemoveHeader(domainName, row.key);
    }
  }
}
async function applyRouteChanges(domainName, location, rows) {
  const { routeSetHeader } = await import("../commands/route-set-header.js");
  const { routeRemoveHeader } = await import("../commands/route-remove-header.js");
  for (const row of rows) {
    if (row.state === "new" || row.state === "modified") {
      await routeSetHeader(domainName, location, row.key, row.value);
    } else if (row.state === "deleted") {
      await routeRemoveHeader(domainName, location, row.key);
    }
  }
}
async function launchDomainHeaderEditor(domainName) {
  const { DomainRepo } = await import("../db/repos.js");
  const { normalizeDomainName } = await import("../utils/route-validation.js");
  pauseRepl();
  Logger.isMuted = true;
  const normalized = normalizeDomainName(domainName);
  const domain = await DomainRepo.findByName(normalized);
  const initial = domain.headers ?? {};
  Logger.isMuted = false;
  let savedCount = 0;
  const { waitUntilExit } = render(
    /* @__PURE__ */ jsx(
      HeaderEditor,
      {
        target: normalized,
        initial,
        onSave: async (rows, count) => {
          await applyDomainChanges(normalized, rows);
          savedCount = count;
        }
      }
    )
  );
  await waitUntilExit();
  resumeRepl();
  if (savedCount > 0) {
    Logger.success(
      `Saved ${savedCount} header change${savedCount === 1 ? "" : "s"} to domain "${normalized}".`
    );
    Logger.advice(
      `Run ${Logger.highlight(`dm domain push ${normalized}`)} to apply the changes.`
    );
  }
}
async function launchRouteHeaderEditor(domainName, location) {
  const { DomainRepo, RouteRepo } = await import("../db/repos.js");
  const { normalizeDomainName, normalizePath } = await import("../utils/route-validation.js");
  pauseRepl();
  Logger.isMuted = true;
  const normalizedDomain = normalizeDomainName(domainName);
  const normalizedPath = normalizePath(location);
  const domain = await DomainRepo.findByName(normalizedDomain);
  const route = await RouteRepo.findByDomainAndPath(domain.id, normalizedPath);
  if (!route) {
    Logger.isMuted = false;
    resumeRepl();
    throw new Error(
      `No route found for "/${normalizedPath}" on domain "${normalizedDomain}"`
    );
  }
  const initial = route.headers ?? {};
  const target = normalizedPath ? `${normalizedDomain} /${normalizedPath}` : `${normalizedDomain} /`;
  Logger.isMuted = false;
  let savedCount = 0;
  const { waitUntilExit } = render(
    /* @__PURE__ */ jsx(
      HeaderEditor,
      {
        target,
        initial,
        onSave: async (rows, count) => {
          await applyRouteChanges(normalizedDomain, normalizedPath, rows);
          savedCount = count;
        }
      }
    )
  );
  await waitUntilExit();
  resumeRepl();
  if (savedCount > 0) {
    Logger.success(
      `Saved ${savedCount} header change${savedCount === 1 ? "" : "s"} to route "${target}".`
    );
    Logger.advice(
      `Run ${Logger.highlight(`dm domain push ${normalizedDomain}`)} to apply the changes.`
    );
  }
}
export {
  launchDomainHeaderEditor,
  launchRouteHeaderEditor
};
