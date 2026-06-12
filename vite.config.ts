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
            } else if (req.url && (req.url.startsWith('/api/asaas/cobranca') || req.url.startsWith('/api/asaas/cobranca/'))) {
              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk;
                });
                req.on('end', async () => {
                  try {
                    const data = JSON.parse(body);
                    const {
                      customerName,
                      customerCpfCnpj,
                      customerEmail,
                      value,
                      dueDate,
                      isInstallment,
                      installmentCount,
                      description
                    } = data;

                    // Resolve token safely (use header if provided by client, else env)
                    const rawHeaderToken = req.headers['access_token'] || req.headers['access-token'];
                    const clientToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken;
                    const systemToken = process.env.ASAAS_API_KEY;
                    const asaasToken = (clientToken || systemToken || '').trim();

                    if (!asaasToken) {
                      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                      res.end(JSON.stringify({ 
                        success: false, 
                        mensagem: 'Token de acesso do Asaas não configurado no servidor nem enviado.' 
                      }));
                      return;
                    }

                    // Auto detect Sandbox vs Production
                    // Production tokens do not contain sandbox or dollar keywords typically
                    const isProd = !asaasToken.startsWith('$') && !asaasToken.toLowerCase().includes('sandbox') && !asaasToken.toLowerCase().includes('test');
                    const asaasBaseUrl = isProd ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/v3';

                    const cleanDoc = (customerCpfCnpj || '').replace(/\D/g, '');

                    // 1. Search Customer by Doc
                    let customerId = '';
                    if (cleanDoc) {
                      try {
                        const searchRes = await fetch(`${asaasBaseUrl}/customers?cpfCnpj=${cleanDoc}`, {
                          headers: { 'access_token': asaasToken }
                        });
                        if (searchRes.ok) {
                          const searchJson: any = await searchRes.json();
                          if (searchJson.data && searchJson.data.length > 0) {
                            customerId = searchJson.data[0].id;
                          }
                        }
                      } catch (err) {
                        console.error('Asaas customer search warning:', err);
                      }
                    }

                    // 2. Create customer if not found
                    if (!customerId) {
                      const createCustomerRes = await fetch(`${asaasBaseUrl}/customers`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'access_token': asaasToken
                        },
                        body: JSON.stringify({
                          name: customerName,
                          cpfCnpj: cleanDoc,
                          email: customerEmail || undefined,
                          notificationDisabled: true
                        })
                      });

                      if (!createCustomerRes.ok) {
                        const errText = await createCustomerRes.text();
                        let parsedErr: any = {};
                        try { parsedErr = JSON.parse(errText); } catch(e){}
                        const asaasDesc = parsedErr?.errors?.[0]?.description || errText;
                        res.writeHead(createCustomerRes.status, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ 
                          success: false, 
                          mensagem: `Asaas: Falha ao cadastrar cliente: ${asaasDesc}` 
                        }));
                        return;
                      }

                      const customerJson: any = await createCustomerRes.json();
                      customerId = customerJson.id;
                    }

                    // 3. Process Charge / Cobrança
                    const chargePayload: any = {
                      customer: customerId,
                      billingType: 'UNDEFINED', // Let customer pay via Boleto, Pix, or Card in the slip
                      value: Number(value),
                      dueDate: dueDate,
                      description: description || 'Cobrança Avulsa via MEI Flow'
                    };

                    if (isInstallment && Number(installmentCount) > 1) {
                      chargePayload.billingType = 'BOLETO'; // Set specifically to BOLETO for sequential installments / Carnê
                      chargePayload.installmentCount = Number(installmentCount);
                      // In installments, value is either the individual installmentValue or we provide totalValue. Let's make sure:
                      chargePayload.value = Number(value); // This will represent the value of EACH installment
                    }

                    const createChargeRes = await fetch(`${asaasBaseUrl}/payments`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'access_token': asaasToken
                      },
                      body: JSON.stringify(chargePayload)
                    });

                    if (!createChargeRes.ok) {
                      const errText = await createChargeRes.text();
                      let parsedErr: any = {};
                      try { parsedErr = JSON.parse(errText); } catch(e){}
                      const asaasDesc = parsedErr?.errors?.[0]?.description || errText;
                      res.writeHead(createChargeRes.status, { 'Content-Type': 'application/json; charset=utf-8' });
                      res.end(JSON.stringify({ 
                        success: false, 
                        mensagem: `Asaas: Falha ao gerar cobrança: ${asaasDesc}` 
                      }));
                      return;
                    }

                    const chargeJson: any = await createChargeRes.json();

                    // 4. Fetch Pix Copy 'n Paste if single payment
                    let pixCode: any = null;
                    if (!isInstallment && chargeJson.id) {
                      try {
                        const pixRes = await fetch(`${asaasBaseUrl}/payments/${chargeJson.id}/pixQrCode`, {
                          headers: { 'access_token': asaasToken }
                        });
                        if (pixRes.ok) {
                          pixCode = await pixRes.json();
                        }
                      } catch (err) {
                        console.error('Pix QR creation warning:', err);
                      }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                      success: true,
                      id: chargeJson.id,
                      invoiceUrl: chargeJson.invoiceUrl,
                      bankSlipUrl: chargeJson.bankSlipUrl || chargeJson.invoiceUrl,
                      barCode: chargeJson.nossoNumero || chargeJson.invoiceNumber,
                      pixQrCode: pixCode,
                      installmentId: chargeJson.installment,
                      raw: chargeJson
                    }));

                  } catch (err: any) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, mensagem: 'Erro interno no Proxy Asaas: ' + err.message }));
                  }
                });
              } else {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, mensagem: 'Método não permitido' }));
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
