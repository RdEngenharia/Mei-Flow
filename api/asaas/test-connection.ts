import axios from "axios";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  try {
    const systemToken = process.env.ASAAS_API_KEY;
    const asaasToken = (systemToken || "").trim();

    if (!asaasToken) {
      res.status(401).json({
        success: false,
        mensagem: "Erro de Conexão: Chave de API do Asaas (ASAAS_API_KEY) não configurada no servidor Vercel."
      });
      return;
    }

    const isProd = !asaasToken.startsWith("$") && !asaasToken.toLowerCase().includes("sandbox") && !asaasToken.toLowerCase().includes("test");
    const asaasBaseUrl = isProd ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";

    console.log(`[Asaas Connection Test Serverless]: Checking connection via ${asaasBaseUrl}/finance/balance`);

    const response = await axios.get(`${asaasBaseUrl}/finance/balance`, {
      headers: {
        "access_token": asaasToken
      },
      timeout: 10000
    });

    res.status(200).json({
      success: true,
      balance: response.data.balance || 0,
      mensagem: "Conexão com o Asaas realizada com sucesso! Chave válida."
    });
  } catch (err: any) {
    console.error("[Asaas Connection Test Serverless Crash]:", err.message);
    res.status(401).json({
      success: false,
      mensagem: "Erro de Conexão: Verifique se a chave na Vercel está correta ou se as políticas de sandbox/produção batem."
    });
  }
}
