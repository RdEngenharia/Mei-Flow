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

    const cleanToken = asaasToken.replace(/^["']|["']$/g, "").trim();

    let asaasBaseUrl = "https://sandbox.asaas.com/v3";
    let balance = 0;
    let success = false;
    let detectedEnv = "Sandbox";

    // 1. Try Production first, unless it specifically contains sandbox or test keywords
    if (!cleanToken.toLowerCase().includes("sandbox") && !cleanToken.toLowerCase().includes("test")) {
      try {
        console.log("[Asaas Connection Test Serverless]: Probing Production endpoint...");
        const prodResponse = await axios.get("https://api.asaas.com/v3/finance/balance", {
          headers: { "access_token": cleanToken },
          timeout: 4000
        });
        if (prodResponse.status === 200) {
          balance = prodResponse.data.balance || 0;
          success = true;
          asaasBaseUrl = "https://api.asaas.com/v3";
          detectedEnv = "Produção";
          console.log("[Asaas Connection Test Serverless]: Production connection successful!");
        }
      } catch (prodErr: any) {
        console.log(`[Asaas Connection Test Serverless]: Production probe failed (${prodErr.response?.status || prodErr.message}), trying Sandbox...`);
      }
    }

    // 2. Fallback to Sandbox if not already successful
    if (!success) {
      try {
        console.log(`[Asaas Connection Test Serverless]: Pulling from Sandbox: ${asaasBaseUrl}/finance/balance`);
        const sandboxResponse = await axios.get(`${asaasBaseUrl}/finance/balance`, {
          headers: { "access_token": cleanToken },
          timeout: 6000
        });
        balance = sandboxResponse.data.balance || 0;
        success = true;
        detectedEnv = "Sandbox";
      } catch (sandboxErr: any) {
        console.error("[Asaas Connection Test Serverless SandBox Fail]:", sandboxErr.response?.data || sandboxErr.message);
        return res.status(401).json({
          success: false,
          mensagem: "Erro de Conexão: Chave de API inválida tanto em Produção quanto em Sandbox. Verifique sua chave no painel do Asaas."
        });
      }
    }

    res.status(200).json({
      success: true,
      balance,
      mensagem: `Conexão Master com Asaas: OK! Ambiente detectado: ${detectedEnv}.`
    });
  } catch (err: any) {
    console.error("[Asaas Connection Test Serverless Crash]:", err.message);
    res.status(500).json({
      success: false,
      mensagem: "Erro inesperado ao realizar teste de conexão: " + err.message
    });
  }
}
