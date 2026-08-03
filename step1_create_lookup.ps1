New-Item -ItemType Directory -Force -Path "api\cnpj" | Out-Null
$content = @'
/**
 * Proxy de consulta de CNPJ. Em vez do front-end chamar diretamente
 * brasilapi.com.br ou api-publica.speedio.com.br, ele chama esta rota do
 * nosso próprio backend, que por sua vez consulta essas APIs externas.
 *
 * POR QUE ISSO É NECESSÁRIO: dentro do WebView do Capacitor (APK Android),
 * a página roda a partir da origem fixa "https://localhost". APIs de
 * terceiros como a Speedio não liberam essa origem no CORS delas (e nós
 * não temos controle sobre isso), então a chamada é bloqueada pelo
 * navegador antes mesmo de sair do dispositivo. Como esta rota roda no
 * NOSSO backend (servidor para servidor), CORS de terceiros nunca entra
 * em jogo — só precisamos liberar CORS para o NOSSO próprio domínio
 * (já feito abaixo), que é o que o app realmente precisa.
 */
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET." });
  }

  const cnpj = String(req.query?.cnpj || "").replace(/\D/g, "");
  if (!cnpj || cnpj.length !== 14) {
    return res.status(400).json({ success: false, message: "CNPJ inválido. Informe 14 dígitos numéricos." });
  }

  // 1. Tenta a BrasilAPI primeiro (fonte primária, geralmente mais estável)
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (response.ok) {
      const data = await response.json();
      return res.status(200).json({
        success: true,
        source: "brasilapi",
        nome_fantasia: data.nome_fantasia || data.razao_social || "",
        razao_social: data.razao_social || "",
        ddd_telefone_1: data.ddd_telefone_1 || ""
      });
    }
  } catch (err: any) {
    console.warn("[CNPJ Proxy] BrasilAPI bypassed:", err.message);
  }

  // 2. Fallback: Speedio
  try {
    const response = await fetch(`https://api-publica.speedio.com.br/buscarcnpj?cnpj=${cnpj}`);
    if (response.ok) {
      const speedioData = await response.json();
      if (speedioData && !speedioData.error) {
        return res.status(200).json({
          success: true,
          source: "speedio",
          nome_fantasia: speedioData["NOME FANTASIA"] || speedioData["RAZAO SOCIAL"] || "",
          razao_social: speedioData["RAZAO SOCIAL"] || "",
          ddd_telefone_1: speedioData["TELEFONE"] || ""
        });
      }
    }
  } catch (err: any) {
    console.warn("[CNPJ Proxy] Speedio bypassed:", err.message);
  }

  return res.status(404).json({ success: false, message: "CNPJ não encontrado em nenhuma fonte disponível." });
}

'@
Set-Content -Path "api\cnpj\lookup.ts" -Value $content -Encoding UTF8
Write-Host "OK: api/cnpj/lookup.ts criado/atualizado com sucesso."