import path from 'path';
import { AppRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { writeFileSync } from 'fs';

/**
 * Generate IIS Configuration for an Application
 * @param {Object} options - Options for IIS configuration generation
 * @param {string} options.name - Application name
 * @param {boolean} options.https - Include HTTPS redirection rules
 * @param {boolean} options.nonWww - Redirect all traffic to non-WWW
 */
export const generateIISConfig = async ({
  name,
  https,
  nonWww,
}: {
  name: string;
  https?: boolean;
  nonWww?: boolean;
}) => {
  Logger.info(`Starting IIS configuration generation for ${Logger.highlight(name)}...`);

  const app = AppRepo.getAll().find((app) => app.name === name);
  if (!app) {
    throw new Error(
      `App "${Logger.highlight(name)}" not found in the repository.\n` +
      `To initialize the app use: ${Logger.highlight(`dm init`)}`,
    );
  }

  const configFilePath = path.join(app.appDir, `web.config`);

  const configContent = `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <httpProtocol>
      <customHeaders>
        <add name="X-Frame-Options" value="DENY" />
        ${https?`<add name=Strict-Transport-Security value=max-age=31536000; includeSubDomains; preload />`:''}
        <add name="X-Content-Type-Options" value="nosniff" />
      </customHeaders>
    </httpProtocol>
    <rewrite>
      <rules>
        ${nonWww ? `
        <rule name="Redirect to non-WWW" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTP_HOST}" pattern="^www\\.(.*)$" />
          </conditions>
          <action type="Redirect" url="https://{C:1}/{R:1}" redirectType="Permanent" />
        </rule>
        ` : ''}
        ${https ? `
        <rule name="Redirect to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        ` : ''}
        <rule name="ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:${app.port}/{R:1}" logRewrittenUrl="true" appendQueryString="true" /> 
          <serverVariables>
            <set name="HTTP_X_Original_Host" value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
    <httpLogging logAllRequests="true" />
  </system.webServer>
</configuration>`;

  writeFileSync(configFilePath, configContent);

  Logger.success(
    `IIS configuration file for ${Logger.highlight(name)} created at: ${Logger.highlight(configFilePath)}`,
  );
};
