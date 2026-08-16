import http from 'http';
import { queryGraphqlHandler } from '@letoribo/mcp-graphql-enhanced';

const PORT = process.env.MCP_PORT || 3000;

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { query, variables } = JSON.parse(body || '{}');

        if (!query || typeof query !== 'string' || !query.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ errors: [{ message: 'Query is required.' }] }));
        }

        // Передаем только изолированные/минимальные заголовки без браузерного мусора
        const mcpResult = await queryGraphqlHandler({
          query,
          variables,
          headers: '{}',
          _request_meta: { host: req.headers.host }
        });

        let responsePayload = mcpResult;
        const textContent = mcpResult?.content?.[0]?.text;

        if (textContent) {
          try {
            responsePayload = JSON.parse(textContent);
          } catch {
            responsePayload = mcpResult;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responsePayload));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: err.message }] }));
      }
    });
  } else {
    res.writeHead(200).end('MCP Bridge Active');
  }
}).listen(PORT, () => console.log(`[Bridge] http://localhost:${PORT}`));