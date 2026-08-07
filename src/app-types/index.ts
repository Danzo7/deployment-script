// Import all handlers so they self-register with the registry on first import.
// Any file that needs getHandler() or detectAppType() should import from here
// (or from registry.ts after importing this file).
import './nextjs.js';
import './nestjs.js';
import './dotnet.js';
import './static.js';

export * from './registry.js';
