import http from 'http';
import { fork } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const PUBLIC_PORT = process.env.MCP_PORT || 6274;
const INTERNAL_BRIDGE_PORT = 6279;

function parseHeaders(headersInput) {
  if (!headersInput) return '{}';
  if (typeof headersInput === 'object') return JSON.stringify(headersInput);
  try { JSON.parse(headersInput); return headersInput; } catch { return '{}'; }
}

function isValidUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}

function getMcpIndexPath() {
  try {
    return require.resolve('@letoribo/mcp-graphql-enhanced');
  } catch (err) {
    const localDevPath = path.resolve('../mcp-graphql-enhanced/dist/index.js');
    if (fs.existsSync(localDevPath)) return localDevPath;
    throw new Error('Could not resolve @letoribo/mcp-graphql-enhanced package.');
  }
}

const mcpIndexPath = getMcpIndexPath();

let currentEndpoint = process.env.ENDPOINT || '';
let currentHeaders = process.env.HEADERS ? parseHeaders(process.env.HEADERS) : '{}';
let currentQuery = '';
let currentVariables = {};
let childProcess = null;

const sseClients = new Set();

function broadcastToUI(payloadData) { console.log(`[Bridge] Broadcasting to UI:`, payloadData);
  if (!payloadData) return;

  if (payloadData.endpoint && isValidUrl(payloadData.endpoint)) {
    currentEndpoint = payloadData.endpoint;
  }
  if (payloadData.headers !== undefined) {
    currentHeaders = typeof payloadData.headers === 'string' ? payloadData.headers : JSON.stringify(payloadData.headers);
  }
  if (payloadData.query !== undefined) {
    currentQuery = payloadData.query;
  }
  if (payloadData.variables !== undefined) {
    currentVariables = payloadData.variables;
  }

  const fullPayload = {
    type: payloadData.type || 'SYNC_ALL',
    endpoint: currentEndpoint,
    headers: currentHeaders ? JSON.parse(currentHeaders) : {},
    query: currentQuery,
    variables: currentVariables
  };

  const data = JSON.stringify(fullPayload);
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

function filterAndWrite(data, targetStream) {
  const lines = data.toString().split(/\r?\n/);
  for (const line of lines) {
    const cleanLine = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
    const isNoise = cleanLine.includes('Federated Bridge active') ||
                    cleanLine.includes(String(INTERNAL_BRIDGE_PORT)) ||
                    cleanLine.includes('MCP Endpoint:') ||
                    cleanLine.includes('GraphiQL:');

    if (!isNoise && cleanLine.length > 0) {
      targetStream.write(line + '\n');
    }
  }
}

async function startBridge(endpoint, headersInput) {
  console.log(`[Bridge] Starting bridge for endpoint: ${endpoint || currentEndpoint}`);

  const rawHeaders = parseHeaders((headersInput !== undefined && headersInput !== null) ? headersInput : currentHeaders);
  const targetEndpoint = (endpoint && isValidUrl(endpoint)) ? endpoint : process.env.ENDPOINT;

  if (!targetEndpoint) {
    console.log(`[Bridge] No valid endpoint provided. Bridge spawn deferred.`);
    return;
  }

  const childEnv = Object.assign({}, process.env, {
    ENABLE_HTTP: 'true',
    ALLOW_MUTATIONS: 'true',
    ENDPOINT: targetEndpoint,
    HEADERS: rawHeaders,
    MCP_PORT: String(INTERNAL_BRIDGE_PORT)
  });

  currentEndpoint = targetEndpoint;
  currentHeaders = rawHeaders;

  if (childProcess) {
    console.log(`[Bridge] Killing existing child process...`);
    childProcess.removeAllListeners();
    childProcess.kill('SIGKILL');
    childProcess = null;
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`[Bridge] Initializing MCP engine for: ${targetEndpoint}`);

  const child = fork(mcpIndexPath, [], {
    env: childEnv,
    silent: true
  });

  childProcess = child;

  child.stdout.on('data', (data) => filterAndWrite(data, process.stdout));
  child.stderr.on('data', (data) => filterAndWrite(data, process.stderr));

  child.on('message', async (msg) => {
    console.log(`[Bridge] Received message:`, msg);
    if (msg && msg.type === 'MCP_TOOL_CALL') {
      const targetUrl = msg.args?.endpoint || currentEndpoint;
      const targetHeaders = msg.args?.headers || currentHeaders;

      if (msg.args?.endpoint && msg.args.endpoint !== currentEndpoint) {
        await startBridge(targetUrl, targetHeaders);
      }

      if (msg.args?.query) {
        const eventPayload = {
          type: 'SYNC_ALL',
          endpoint: targetUrl,
          headers: typeof targetHeaders === 'string' ? JSON.parse(targetHeaders) : targetHeaders,
          query: msg.args.query,
          variables: msg.args.variables ?? {}
        };
        broadcastToUI(eventPayload);
      }
    }
  });

  // Wait briefly for the bridge to bind port 6279
  await new Promise((r) => setTimeout(r, 300));

  broadcastToUI({
    type: 'SYNC_ALL',
    endpoint: currentEndpoint,
    headers: currentHeaders ? JSON.parse(currentHeaders) : {}
  });
}

startBridge(currentEndpoint, currentHeaders).catch(err => console.error(`[BOOT ERROR]`, err));

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-target-endpoint, authorization');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (req.url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    sseClients.add(res);

    const pinger = setInterval(() => {
      res.write(':\n\n');
    }, 15000);

    const initialPayload = JSON.stringify({
      type: 'SYNC_ALL',
      endpoint: currentEndpoint,
      headers: currentHeaders ? JSON.parse(currentHeaders) : {},
      query: currentQuery,
      variables: currentVariables
    });
    res.write(`data: ${initialPayload}\n\n`);

    req.on('close', () => {
      clearInterval(pinger);
      sseClients.delete(res);
    });
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'HEAD') return res.end();
    return res.end(JSON.stringify({ 
      defaultEndpoint: currentEndpoint,
      defaultHeaders: currentHeaders ? JSON.parse(currentHeaders) : {},
      bridgeUrl: `http://localhost:${PUBLIC_PORT}/graphiql`
    }));
  }

  if (req.method === 'POST' && req.url === '/api/schema-updated') {
    console.log(`[Bridge] Webhook /api/schema-updated triggered. Reloading MCP engine and notifying UI...`);
    try {
      await startBridge(currentEndpoint, currentHeaders);

      broadcastToUI({
        type: 'SCHEMA_UPDATED',
        endpoint: currentEndpoint
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Bridge reloaded and UI notified.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/switch-endpoint') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { endpoint, headers } = JSON.parse(body);
        if (!endpoint || !isValidUrl(endpoint)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'ENDPOINT must be a valid URL' }));
        }

        await startBridge(endpoint, headers);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, endpoint: currentEndpoint, headers: currentHeaders }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', async () => {
      try {
        let payload = {};
        try { payload = JSON.parse(rawBody); } catch (e) {}

        const reqEndpoint = payload?.params?.arguments?.endpoint;
        const reqHeaders = payload?.params?.arguments?.headers;
        const parsedReqHeaders = reqHeaders ? parseHeaders(reqHeaders) : currentHeaders;

        const isEndpointChanged = reqEndpoint && isValidUrl(reqEndpoint) && reqEndpoint !== currentEndpoint;
        const isHeadersChanged = reqHeaders && parsedReqHeaders !== currentHeaders;

        if (isEndpointChanged || isHeadersChanged) {
          const targetUrl = (reqEndpoint && isValidUrl(reqEndpoint)) ? reqEndpoint : currentEndpoint;
          await startBridge(targetUrl, parsedReqHeaders);
        } else if (!childProcess) {
          const initialEndpoint = reqEndpoint || currentEndpoint;
          if (initialEndpoint && isValidUrl(initialEndpoint)) {
            await startBridge(initialEndpoint, parsedReqHeaders);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              jsonrpc: "2.0",
              id: payload?.id || null,
              error: { code: -32602, message: "No valid GraphQL endpoint provided or active." }
            }));
          }
        }

        let response = null;
        let lastError = null;

        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            response = await fetch(`http://127.0.0.1:${INTERNAL_BRIDGE_PORT}/mcp`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
              },
              body: rawBody
            });
            if (response && response.ok) break;
          } catch (err) {
            lastError = err;
          }
          await new Promise(r => setTimeout(r, 500));
        }

        if (!response) {
          throw lastError || new Error("Engine initialization timeout");
        }

        const data = await response.text();

        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: `MCP Engine offline or syncing: ${err.message}` }
        }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/graphql') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const headerTarget = req.headers['x-target-endpoint'];
        const targetUrl = (headerTarget && isValidUrl(headerTarget)) ? headerTarget : currentEndpoint;

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ errors: [{ message: 'No valid target GraphQL endpoint.' }] }));
        }

        // 1. Make a proxy request to the target backend bypassing cache
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache',
            ...(currentHeaders ? JSON.parse(currentHeaders) : {})
          },
          cache: 'no-store', // <-- Force a fresh request in Node fetch
          body
        });

        const data = await response.text();

        // 2. Prevent client/browser from caching the introspection response
        res.writeHead(response.status, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(data);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: err.message }] }));
      }
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PUBLIC_PORT, () => {
  console.log(`[Server] Running on http://localhost:${PUBLIC_PORT}`);
  console.log(`📡 MCP Endpoint: http://localhost:${PUBLIC_PORT}/mcp`);
  console.log(`🎨 GraphiQL: http://localhost:${PUBLIC_PORT}/graphiql`);
});