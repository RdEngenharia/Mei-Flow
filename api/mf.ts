/**
 * Ponto de entrada dos módulos do MEI Flow na Vercel.
 *
 * O carregamento dos módulos acontece DENTRO de um try/catch e sob demanda.
 * Se algo falhar ao carregar — dependência ausente, erro de import, variável
 * de ambiente quebrando alguma inicialização — a rota responde um JSON legível
 * explicando o que houve, em vez da tela genérica de "function crashed" da
 * Vercel, que não diz nada.
 */

let appCache: any = null;
let erroCarregamento: any = null;

async function carregarApp() {
  if (appCache) return appCache;
  if (erroCarregamento) throw erroCarregamento;
  try {
    const mod: any = await import("../meiflow-server.js");
    appCache = mod.default || mod;
    return appCache;
  } catch (err: any) {
    erroCarregamento = err;
    throw err;
  }
}

export default async function handler(req: any, res: any) {
  let app: any;
  try {
    app = await carregarApp();
  } catch (err: any) {
    // Diagnóstico legível em vez de tela em branco.
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify(
        {
          success: false,
          etapa: "carregamento dos modulos",
          mensagem: String(err?.message || err),
          codigo: err?.code || null,
          pista:
            err?.code === "ERR_MODULE_NOT_FOUND"
              ? "A Vercel nao encontrou um arquivo importado. Confira se efi.ts, cobrancas.ts, creditos.ts e meiflow-server.ts estao na raiz e foram enviados ao GitHub."
              : "Veja a mensagem acima. Se citar uma dependencia, ela precisa estar no package.json.",
          stack: String(err?.stack || "").split("\n").slice(0, 8),
        },
        null,
        2
      )
    );
  }

  try {
    const url = new URL(req.url || "/", "http://local");
    const rota = String(req.query?.__rota || url.searchParams.get("__rota") || "");
    if (rota) {
      url.searchParams.delete("__rota");
      const resto = url.searchParams.toString();
      req.url = `/api/${rota.replace(/^\/+/, "")}${resto ? `?${resto}` : ""}`;
      if (req.query) delete req.query.__rota;
    }
  } catch {
    // se falhar, segue com a URL original
  }

  return app(req, res);
}
