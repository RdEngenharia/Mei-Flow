/**
 * ============================================================================
 * MEI FLOW — Painel de gestão de boletos
 * ============================================================================
 *
 * O QUE FAZ
 *
 * Responde, a qualquer momento: quanto foi emitido, quanto já entrou, quanto
 * ainda vai vencer e quanto está vencido — com as listas por trás de cada
 * número e o ranking de quem mais deve.
 *
 * Não envia mensagem nenhuma. A régua de cobrança automática está desenhada e
 * documentada na especificação, para ser ligada quando você decidir o canal.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  cobrancas.ts  na raiz (junto de server.ts e efi.ts).
 * 2. No server.ts, no topo:      import { registrarRotasCobrancas } from "./cobrancas";
 *    e dentro de startServer():  registrarRotasCobrancas(app, db);
 *
 * ----------------------------------------------------------------------------
 * DE ONDE VÊM OS DADOS
 *
 * Da coleção `cobrancas`, alimentada pelo efi.ts: cada boleto emitido entra
 * ali, e o webhook da Efí marca como pago quando o cliente paga. Enquanto a
 * Efí não estiver ligada, o painel responde com tudo zerado — o que é o
 * correto, e não um erro.
 *
 * Nenhuma variável de ambiente é necessária.
 */

import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

// ============================================================================
// CLASSIFICAÇÃO DE STATUS
// ============================================================================
//
// Cada gateway usa um vocabulário. Concentrar a tradução aqui evita espalhar
// comparação de texto solto pelo código.
// ============================================================================

const STATUS_PAGO = ["paid", "settled", "received", "confirmed", "approved"];
const STATUS_MORTO = ["canceled", "cancelled", "unpaid", "expired", "refunded", "declined"];

export type Situacao = "pago" | "pendente" | "vencido" | "cancelado";

export function classificar(status: string, diasParaVencer: number): Situacao {
  const s = String(status || "").toLowerCase();
  if (STATUS_PAGO.includes(s)) return "pago";
  if (STATUS_MORTO.includes(s)) return "cancelado";
  if (!isNaN(diasParaVencer) && diasParaVencer < 0) return "vencido";
  return "pendente";
}

// ============================================================================
// AUXILIARES
// ============================================================================

async function exigirUsuario(req: any): Promise<string> {
  // Verificacao feita em auth-firebase.ts, sem firebase-admin/auth:
  // aquele pacote arrasta jwks-rsa + jose 6, que quebram na Vercel.
  return verificarLogin(req);
}

/**
 * Dias inteiros entre hoje e a data, comparando só a data (sem hora).
 * Negativo = já venceu. Zero = vence hoje.
 */
export function diasAte(data: string): number {
  const d = new Date(data);
  if (isNaN(d.getTime())) return NaN;
  const alvo = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const hoje = new Date();
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo.getTime() - base.getTime()) / 86400000);
}

const arred = (n: number) => Math.round(n * 100) / 100;

function dataBR(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** "Agosto/2026" — mesmo vocabulário de meses do Arquivo Digital. */
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function competencia(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${MESES[d.getMonth()]}/${d.getFullYear()}`;
}

function montarItem(c: any) {
  const dias = diasAte(c.vencimento);
  const situacao = classificar(c.status, dias);
  return {
    id: c.id,
    cliente: c.clienteNome || "Sem nome",
    clienteId: c.customerId || "",
    documento: c.clienteDocumento || "",
    valor: Number(c.valor || 0),
    vencimento: c.vencimento,
    vencimentoBR: dataBR(c.vencimento),
    competencia: competencia(c.vencimento),
    situacao,
    diasParaVencer: isNaN(dias) ? null : dias,
    diasEmAtraso: situacao === "vencido" ? Math.abs(dias) : 0,
    statusOriginal: c.status,
    link: c.link || c.pdfUrl || "",
    pdf: c.pdfUrl || "",
    criadoEm: c.criadoEm || null,
    pagoEm: c.pagoEm || null,
  };
}

// ============================================================================
// ROTAS
// ============================================================================

export function registrarRotasCobrancas(app: any, db: any) {
  async function carregar(uid: string) {
    const snap = await db.collection("cobrancas").where("userId", "==", uid).get();
    return snap.docs.map((d: any) => montarItem(d.data()));
  }

  // --------------------------------------------------------------------------
  // PAINEL — os números do topo + as listas por trás de cada um
  // --------------------------------------------------------------------------
  app.get("/api/cobrancas/painel", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const itens = await carregar(uid);

      const grupos: Record<Situacao, any[]> = { pago: [], pendente: [], vencido: [], cancelado: [] };
      const totais: Record<Situacao, number> = { pago: 0, pendente: 0, vencido: 0, cancelado: 0 };

      for (const it of itens) {
        grupos[it.situacao].push(it);
        totais[it.situacao] += it.valor;
      }

      // Vencidos primeiro os mais antigos (mais urgentes);
      // pendentes primeiro os que vencem antes.
      grupos.vencido.sort((a, b) => b.diasEmAtraso - a.diasEmAtraso);
      grupos.pendente.sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
      grupos.pago.sort((a, b) => String(b.pagoEm || "").localeCompare(String(a.pagoEm || "")));

      // "Emitido" exclui cancelados: cobrança cancelada nunca foi receita.
      const emitido = arred(totais.pago + totais.pendente + totais.vencido);
      const recebido = arred(totais.pago);

      // Quem mais deve — o ranking que faz o MEI saber para quem ligar.
      const porDevedor: Record<string, { cliente: string; valor: number; titulos: number; maiorAtraso: number }> = {};
      for (const it of grupos.vencido) {
        const k = it.clienteId || it.cliente;
        porDevedor[k] = porDevedor[k] || { cliente: it.cliente, valor: 0, titulos: 0, maiorAtraso: 0 };
        porDevedor[k].valor = arred(porDevedor[k].valor + it.valor);
        porDevedor[k].titulos++;
        porDevedor[k].maiorAtraso = Math.max(porDevedor[k].maiorAtraso, it.diasEmAtraso);
      }

      // Vencendo nos próximos 7 dias — o que exige atenção esta semana.
      const proximos = grupos.pendente.filter(
        (i) => i.diasParaVencer !== null && i.diasParaVencer <= 7
      );

      res.json({
        success: true,
        resumo: {
          emitido,
          recebido,
          aReceber: arred(totais.pendente),
          vencido: arred(totais.vencido),
          cancelado: arred(totais.cancelado),
          // De tudo que virou cobrança válida, quanto de fato entrou.
          taxaRecebimento: emitido > 0 ? Math.round((recebido / emitido) * 1000) / 10 : 0,
          // Quanto do que já deveria ter sido pago está em atraso.
          inadimplencia:
            recebido + totais.vencido > 0
              ? Math.round((totais.vencido / (recebido + totais.vencido)) * 1000) / 10
              : 0,
          quantidade: {
            pagos: grupos.pago.length,
            pendentes: grupos.pendente.length,
            vencidos: grupos.vencido.length,
            cancelados: grupos.cancelado.length,
            total: itens.length,
          },
        },
        atencao: {
          venceEmAte7Dias: proximos,
          maioresDevedores: Object.values(porDevedor)
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 10),
        },
        grupos,
        vazio: itens.length === 0,
        mensagem:
          itens.length === 0
            ? "Nenhum boleto emitido ainda. Os boletos aparecem aqui automaticamente assim que você começar a emitir."
            : undefined,
      });
    } catch (err: any) {
      const s = err.message === "NAO_AUTENTICADO" ? 401 : 500;
      res.status(s).json({
        success: false,
        mensagem: s === 401 ? "Faça login para ver suas cobranças." : err.message,
      });
    }
  });

  // --------------------------------------------------------------------------
  // LISTA com filtros — para a tela de "todos os boletos"
  //   ?situacao=vencido&cliente=maria&de=2026-01-01&ate=2026-12-31
  // --------------------------------------------------------------------------
  app.get("/api/cobrancas", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      let itens = await carregar(uid);

      const { situacao, cliente, de, ate } = req.query;
      if (situacao) itens = itens.filter((i: any) => i.situacao === String(situacao));
      if (cliente) {
        const busca = String(cliente).toLowerCase();
        itens = itens.filter((i: any) => String(i.cliente).toLowerCase().includes(busca));
      }
      if (de) itens = itens.filter((i: any) => String(i.vencimento) >= String(de));
      if (ate) itens = itens.filter((i: any) => String(i.vencimento) <= String(ate));

      itens.sort((a: any, b: any) => String(b.vencimento).localeCompare(String(a.vencimento)));

      res.json({
        success: true,
        total: itens.length,
        somaValores: arred(itens.reduce((s: number, i: any) => s + i.valor, 0)),
        cobrancas: itens,
      });
    } catch (err: any) {
      const s = err.message === "NAO_AUTENTICADO" ? 401 : 500;
      res.status(s).json({ success: false, mensagem: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // EVOLUÇÃO MÊS A MÊS — alimenta o gráfico de emitido x recebido
  // --------------------------------------------------------------------------
  app.get("/api/cobrancas/evolucao", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const itens = await carregar(uid);
      const meses = Math.min(Number(req.query.meses) || 12, 36);

      const mapa: Record<string, { rotulo: string; emitido: number; recebido: number; vencido: number }> = {};
      const hoje = new Date();
      for (let i = meses - 1; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        mapa[chave] = { rotulo: `${MESES[d.getMonth()]}/${d.getFullYear()}`, emitido: 0, recebido: 0, vencido: 0 };
      }

      for (const it of itens) {
        if (it.situacao === "cancelado") continue;
        const d = new Date(it.vencimento);
        if (isNaN(d.getTime())) continue;
        const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!mapa[chave]) continue;
        mapa[chave].emitido = arred(mapa[chave].emitido + it.valor);
        if (it.situacao === "pago") mapa[chave].recebido = arred(mapa[chave].recebido + it.valor);
        if (it.situacao === "vencido") mapa[chave].vencido = arred(mapa[chave].vencido + it.valor);
      }

      res.json({ success: true, meses: Object.values(mapa) });
    } catch (err: any) {
      const s = err.message === "NAO_AUTENTICADO" ? 401 : 500;
      res.status(s).json({ success: false, mensagem: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // DETALHE de uma cobrança
  // --------------------------------------------------------------------------
  app.get("/api/cobrancas/:id", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await db.collection("cobrancas").doc(String(req.params.id)).get();
      if (!snap.exists || snap.data().userId !== uid) {
        return res.status(404).json({ success: false, mensagem: "Cobrança não encontrada." });
      }
      res.json({ success: true, cobranca: montarItem(snap.data()) });
    } catch (err: any) {
      const s = err.message === "NAO_AUTENTICADO" ? 401 : 500;
      res.status(s).json({ success: false, mensagem: err.message });
    }
  });

  console.log(
    "[Cobranças] Painel registrado: /api/cobrancas/painel, /api/cobrancas, /api/cobrancas/evolucao"
  );
}
