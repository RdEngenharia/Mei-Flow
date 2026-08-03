/**
 * Ponto de entrada dos módulos do MEI Flow na Vercel.
 *
 * POR QUE NÃO USAR NOME COM COLCHETES:
 * A rota curinga api/[...path].ts chegou a ser publicada, mas a Vercel não a
 * roteou neste projeto (Vite + funções avulsas). Em vez de depender desse
 * comportamento, usamos um nome simples e declaramos as rotas no vercel.json.
 * Fica previsível e continua sendo UMA única função, respeitando o limite de
 * 12 do plano gratuito.
 *
 * COMO FUNCIONA:
 * O vercel.json manda /api/efi/..., /api/cobrancas/... e /api/creditos/...
 * para cá, guardando o caminho original em __rota. Aqui reconstruímos a URL
 * e entregamos ao mesmo aplicativo Express usado pelo server.ts local.
 */
import app from "../meiflow-server";

export default function handler(req: any, res: any) {
  try {
    const url = new URL(req.url || "/", "http://local");

    // A rota original pode vir por req.query (a Vercel preenche) ou pela URL.
    const rota = String(req.query?.__rota || url.searchParams.get("__rota") || "");

    if (rota) {
      // Remove o parâmetro interno e devolve os demais (?token=, ?dias=...).
      url.searchParams.delete("__rota");
      const resto = url.searchParams.toString();
      req.url = `/api/${rota.replace(/^\/+/, "")}${resto ? `?${resto}` : ""}`;
      if (req.query) delete req.query.__rota;
    }
  } catch (err: any) {
    console.warn("[MEI Flow] Falha ao reconstruir a rota:", err.message);
  }

  return (app as any)(req, res);
}
