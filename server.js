import http from 'http';
import { fork } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function parseHeaders(headersInput) {
  if (!headersInput) return '{}';
  if (typeof headersInput === 'object') {
    return JSON.stringify(headersInput);
  }
  try {
    // Validate JSON string prior to passing
    JSON.parse(headersInput);
    return headersInput;
  } catch (err) {
    console.error(`[Bridge] Failed to parse headers JSON: ${err.message}`);
    return '{}';
  }
}

function getMcpIndexPath() {
  try {
    const installedPath = require.resolve('@letoribo/mcp-graphql-enhanced');
    console.log(`[Bridge] Using package path: ${installedPath}`);
    return installedPath;
  } catch (err) {
    const localDevPath = path.resolve('../mcp-graphql-enhanced/dist/index.js');
    if (fs.existsSync(localDevPath)) {
      return localDevPath;
    }
    const explicitHomePath = path.resolve('/home/mcp-graphql-enhanced/dist/index.js');
    if (fs.existsSync(explicitHomePath)) {
      return explicitHomePath;
    }
    throw new Error('Could not resolve @letoribo/mcp-graphql-enhanced package.');
  }
}

const mcpIndexPath = getMcpIndexPath();

let currentEndpoint = process.env.ENDPOINT || '';
let currentHeaders = process.env.HEADERS ? parseHeaders(process.env.HEADERS) : '{}';
let childProcess = null;

function isValidUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function startBridge(endpoint, headersInput) {
  return new Promise((resolve, reject) => {
    const rawHeaders = parseHeaders(headersInput);

    // Determine target endpoint: from supplied arguments or process.env.ENDPOINT without fallback
    const targetEndpoint = (endpoint && isValidUrl(endpoint)) 
      ? endpoint 
      : process.env.ENDPOINT;

    if (!targetEndpoint) {
      console.log(`[Bridge] No valid endpoint provided. Bridge spawn deferred.`);
      return resolve();
    }

    const childEnv = Object.assign({}, process.env, {
      ENABLE_HTTP: 'true',
      ALLOW_MUTATIONS: 'true',
      ENDPOINT: targetEndpoint,
      HEADERS: rawHeaders
    });

    currentEndpoint = targetEndpoint;
    currentHeaders = rawHeaders;

    console.log(`[Bridge] Spawning bridge for: ${targetEndpoint}`);
    if (rawHeaders && rawHeaders !== '{}') {
      console.log(`[Bridge] Raw HEADERS string passed successfully.`);
    }

    if (childProcess) {
      console.log(`[Bridge] Terminating previous process...`);
      childProcess.kill('SIGTERM');
    }

    const child = fork(mcpIndexPath, [], {
      env: childEnv,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    childProcess = child;

    child.once('error', (err) => {
      reject(err);
    });

    process.nextTick(() => {
      resolve();
    });
  });
}

startBridge(currentEndpoint, currentHeaders).catch(err => console.error(`[BOOT ERROR] ${err.message}`));

const CONFIG_PORT = process.env.MCP_PORT || 3000;

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'HEAD') return res.end();
    return res.end(JSON.stringify({ 
      defaultEndpoint: currentEndpoint,
      defaultHeaders: currentHeaders ? JSON.parse(currentHeaders) : {},
      bridgeUrl: 'http://localhost:6274/graphiql'
    }));
  }

  if (req.method === 'POST' && req.url === '/api/switch-endpoint') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { endpoint, headers } = JSON.parse(body);
        
        if (!endpoint || !isValidUrl(endpoint)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            success: false, 
            error: 'ENDPOINT must be a valid URL' 
          }));
        }

        await startBridge(endpoint, headers);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          endpoint, 
          headers: parseHeaders(headers) 
        }));
      } catch (err) {
        console.error(`[SYNC-WARN] Failed to reach ${url}:`, err?.message || err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404).end();
}).listen(CONFIG_PORT, () => {
  console.log(`[Config Server] Listening at http://localhost:${CONFIG_PORT}`);
});