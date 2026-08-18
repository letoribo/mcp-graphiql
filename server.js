import http from 'http';
import { fork } from 'child_process';
import path from 'path';

let childProcess = null;
let currentEndpoint = process.env.ENDPOINT || '';
const mcpIndexPath = path.resolve('/home/mcp-graphql-enhanced/dist/index.js');

function isValidUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function startBridge(endpoint) {
  return new Promise((resolve, reject) => {
    if (!isValidUrl(endpoint)) {
      return reject(new Error('ENDPOINT must be a valid HTTP/HTTPS URL'));
    }

    if (childProcess) {
      console.log(`[Bridge] Terminating previous bridge process...`);
      childProcess.kill('SIGTERM');
    }

    currentEndpoint = endpoint;
    console.log(`[Bridge] Spawning bridge for: ${endpoint}`);

    const child = fork(mcpIndexPath, [], {
      env: {
        ...process.env,
        ENABLE_HTTP: 'true',
        ENDPOINT: endpoint
      },
      stdio: 'inherit'
    });

    let isSettled = false;

    child.on('exit', (code) => {
      if (!isSettled && code !== 0) {
        isSettled = true;
        childProcess = null;
        reject(new Error('Failed to start bridge: ENDPOINT must be a valid URL'));
      }
    });

    // Allow time for the bridge process to initialize successfully
    setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        childProcess = child;
        resolve();
      }
    }, 1200);
  });
}

// Initial boot if ENDPOINT is provided via CLI/env
if (currentEndpoint) {
  startBridge(currentEndpoint).catch(err => console.error(`[BOOT ERROR] ${err.message}`));
}

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
      bridgeUrl: 'http://localhost:6274/graphiql'
    }));
  }

  if (req.method === 'POST' && req.url === '/api/switch-endpoint') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { endpoint } = JSON.parse(body);
        
        if (!endpoint || !isValidUrl(endpoint)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            success: false, 
            error: 'ENDPOINT must be a valid URL' 
          }));
        }

        if (endpoint !== currentEndpoint || !childProcess) {
          await startBridge(endpoint);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, endpoint }));
      } catch (err) {
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