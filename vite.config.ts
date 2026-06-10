import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'focusnfe-proxy',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url && (req.url.startsWith('/api/focusnfe') || req.url.startsWith('/api/focusnfe/'))) {
              const urlObj = new URL(req.url, 'http://localhost:3000');
              const ref = urlObj.searchParams.get('ref') || req.url.split('/').pop()?.split('?')[0];

              const authHeader = 'Basic ' + Buffer.from('wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w:').toString('base64');

              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk;
                });
                req.on('end', async () => {
                  try {
                    const focusRes = await fetch('https://homologacao.focusnfe.com.br/v2/nfse', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authHeader
                      },
                      body: body
                    });
                    const status = focusRes.status;
                    let json = {};
                    try {
                      json = await focusRes.json();
                    } catch (e) {
                      json = { alert: "Retorno não é um JSON válido", rawStatus: status };
                    }
                    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(json));
                  } catch (err: any) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ mensagem: 'Erro de proxy para Focus NFe: ' + err.message }));
                  }
                });
              } else if (req.method === 'GET') {
                try {
                  const targetUrl = (ref && ref !== 'focusnfe')
                    ? `https://homologacao.focusnfe.com.br/v2/nfse/${ref}`
                    : 'https://homologacao.focusnfe.com.br/v2/nfse';

                  const focusRes = await fetch(targetUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': authHeader
                    }
                  });
                  const status = focusRes.status;
                  let json = {};
                  try {
                    json = await focusRes.json();
                  } catch (e) {
                    json = { alert: "Retorno não é um JSON válido", rawStatus: status };
                  }
                  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify(json));
                } catch (err: any) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ mensagem: 'Erro de proxy para Focus NFe: ' + err.message }));
                }
              } else {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ mensagem: 'Metodo nao permitido' }));
              }
            } else {
              next();
            }
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
