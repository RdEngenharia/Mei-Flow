import React, { useEffect, useState, useCallback } from "react";
import { Bell, X, AlertTriangle, Clock, FileWarning, Receipt, Gauge, ChevronRight, Boxes } from "lucide-react";
import { auth, fetchEstoqueFromFirebase } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";
import type { Transacao } from "../types";
import { recebimentosDa, paraISO } from "../utils/recebimentos";
import { itensComEstoqueBaixo } from "../utils/estoque";
import {
  type Notificacao,
  notificacaoDas,
  notificacoesRecebimento,
  notificacaoLimiteMei,
  notificacaoCertificado,
  notificacaoCobrancasVencidas,
  notificacaoEstoqueBaixo,
  ordenarNotificacoes,
} from "../utils/notificacoes";

/**
 * ============================================================================
 * CENTRAL DE NOTIFICAÇÕES — o painel que abre pelo sino do cabeçalho
 * ============================================================================
 *
 * IRMÃ DO PainelAcompanhamento.tsx, NÃO SUBSTITUTA DELE
 *
 * O funil de vendas já tinha o seu lembrete próprio — a régua de três
 * contatos, num painel flutuante que abre sozinho quando há proposta parada.
 * Aquele continua exatamente como está. Este aqui é o lugar para os avisos
 * que não são sobre "falar com um cliente": prazo de imposto, dinheiro que
 * devia ter caído e não caiu, documento fiscal perto de vencer.
 *
 * QUEM CALCULA O QUÊ
 *
 * As REGRAS (quando algo vira aviso, e com que severidade) moram em
 * utils/notificacoes.ts, puras e testadas — DAS, recebimento em atraso,
 * limite do MEI, certificado A1, boletos vencidos. Este componente só faz
 * três coisas que uma função pura não pode fazer sozinha: buscar os dois
 * dados que vêm do servidor (certificado e cobranças), transformar as
 * `Transacao[]` do app no formato que as regras esperam, e desenhar a tela.
 *
 * ⚠️ O SINO FICA NO Navbar — O PAINEL FICA AQUI.
 *
 * O Navbar.tsx tem um comentário explícito pedindo para resistir a encher o
 * cabeçalho de novo. Por isso ele ganhou só o botão (ícone + contador); a
 * lista inteira, com as buscas ao servidor, mora neste arquivo à parte,
 * desenhada como um cartão fixo logo abaixo do cabeçalho.
 *
 * ⚠️ A BUSCA AO SERVIDOR RODA MESMO COM O PAINEL FECHADO.
 *
 * O contador do sino (quantos avisos existem) precisa aparecer ANTES de o
 * usuário clicar — senão o sino nunca mostraria nada de novo, só descobriria
 * ao abrir. Por isso os `useEffect` de busca não dependem de `aberto`.
 */

type Props = {
  aberto: boolean;
  onFechar: () => void;
  /** Sobe a contagem atual para o Navbar poder desenhar o selo no sino. */
  onContagem: (n: number) => void;

  transacoes: Transacao[];
  faturamentoBrutoTotal: number;
  limiteAnual: number;
  planType: "free" | "premium";
  cnpjPrestador: string;
  isCpfEmissor: boolean;
  logado: boolean;
  /** Para buscar o próprio estoque, do mesmo jeito que EstoquePanel busca o dele. */
  userId: string;
  /**
   * SINAL DE "ALGO MUDOU NAS COBRANÇAS", vindo de fora.
   *
   * A busca de boletos vencidos aqui roda uma vez só (ver o comentário grande
   * no topo do arquivo — o contador precisa existir mesmo com o painel
   * fechado, então não recarrega quando o usuário abre e fecha o sino). Sem
   * isto, cancelar um boleto na tela de Cobranças deixava o aviso de
   * "vencido" preso no sino até o próximo login — o painel de Cobranças sabia
   * que mudou, mas este componente, montado à parte, nunca ficava sabendo.
   * Basta o número mudar (qualquer valor novo) para refazer a busca.
   */
  sinalCobrancas?: number;

  onAbrirDas: () => void;
  onAbrirCertificado: () => void;
  onAbrirCobrancasVencidas: () => void;
  onAbrirRecebimento: (vendaId: string, parcelaId: string) => void;
  onAbrirEstoque: () => void;
};

const ICONE: Record<Notificacao["categoria"], React.ElementType> = {
  das: FileWarning,
  recebimento: Clock,
  certificado: AlertTriangle,
  cobranca: Receipt,
  limite: Gauge,
  estoque: Boxes,
};

export default function CentralNotificacoes({
  aberto,
  onFechar,
  onContagem,
  transacoes,
  faturamentoBrutoTotal,
  limiteAnual,
  planType,
  cnpjPrestador,
  isCpfEmissor,
  logado,
  userId,
  sinalCobrancas,
  onAbrirDas,
  onAbrirCertificado,
  onAbrirCobrancasVencidas,
  onAbrirRecebimento,
  onAbrirEstoque,
}: Props) {
  /**
   * Certificado A1 — só faz sentido buscar quem pode ter um: logado,
   * Premium (é o plano que emite NFS-e) e com CNPJ (CPF nunca emite nota,
   * então nunca tem certificado — buscar aqui seria uma chamada ao servidor
   * que sempre volta vazia).
   */
  const [certificado, setCertificado] = useState<{ diasRestantes: number | null; validoAte?: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    if (!logado || planType !== "premium" || isCpfEmissor || !cnpjPrestador) {
      setCertificado(null);
      return;
    }
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const r = await fetch(getApiUrl("/api/nfse/certificado"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json();
        if (vivo && d?.configurado) {
          setCertificado({ diasRestantes: typeof d.diasRestantes === "number" ? d.diasRestantes : null, validoAte: d.validoAte });
        }
      } catch {
        // Sem conexão ou servidor fora: o aviso de certificado simplesmente
        // não aparece desta vez. Não é crítico o bastante para virar erro de
        // tela — o próximo carregamento tenta de novo.
      }
    })();
    return () => { vivo = false; };
  }, [logado, planType, isCpfEmissor, cnpjPrestador]);

  /** Boletos vencidos emitidos a clientes — mesma rota que o painel de cobranças usa. */
  const [cobrancasVencidas, setCobrancasVencidas] = useState<{ quantidade: number; valor: number }>({ quantidade: 0, valor: 0 });

  useEffect(() => {
    let vivo = true;
    if (!logado) { setCobrancasVencidas({ quantidade: 0, valor: 0 }); return; }
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const r = await fetch(getApiUrl("/api/cobrancas/painel"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json();
        if (vivo && d?.success) {
          setCobrancasVencidas({
            quantidade: Number(d?.resumo?.quantidade?.vencidos) || 0,
            valor: Number(d?.resumo?.vencido) || 0,
          });
        }
      } catch {
        // Efí/Asaas fora do ar, ou carteira ainda não configurada: sem aviso
        // de boleto vencido desta vez. O painel de cobranças, se aberto,
        // mostra o erro de verdade — aqui o silêncio é o correto.
      }
    })();
    return () => { vivo = false; };
  }, [logado, sinalCobrancas]);

  /**
   * Estoque no limite mínimo — busca a lista de itens do usuário, do mesmo
   * jeito self-contained que EstoquePanel.tsx já faz, e filtra localmente com
   * a mesma função pura (`itensComEstoqueBaixo`) que a tela de Estoque usa.
   * Não guardamos o estoque inteiro em estado global só para isto rodar.
   */
  const [estoqueBaixo, setEstoqueBaixo] = useState<{ nome: string }[]>([]);

  useEffect(() => {
    let vivo = true;
    if (!logado || !userId) { setEstoqueBaixo([]); return; }
    (async () => {
      try {
        const itens = await fetchEstoqueFromFirebase(userId);
        if (vivo) setEstoqueBaixo(itensComEstoqueBaixo(itens).map((i) => ({ nome: i.nome })));
      } catch {
        // Sem conexão: o aviso de estoque simplesmente não aparece desta vez,
        // mesmo padrão do certificado e das cobranças acima.
      }
    })();
    return () => { vivo = false; };
  }, [logado, userId]);

  /**
   * TRANSAÇÃO → PARCELA "CRUA" PARA A REGRA PURA.
   *
   * `utils/notificacoes.ts` não conhece `Transacao` nem `Recebimento` — só um
   * formato mínimo. Achatar aqui, num lugar só, é o que permite testar as
   * regras sem precisar simular o app inteiro.
   */
  const parcelasParaAvisar = (transacoes || [])
    .filter((tx) => tx.tipo === "entrada")
    .flatMap((tx) =>
      recebimentosDa(tx).map((r) => ({
        vendaId: tx.id,
        parcelaId: r.id,
        clienteNome: tx.clienteNome,
        valor: r.valor,
        previsaoISO: r.previsao ? paraISO(r.previsao) || undefined : undefined,
        situacao: r.situacao,
      }))
    );

  const notificacoes = ordenarNotificacoes([
    ...notificacaoDas(),
    ...notificacoesRecebimento(parcelasParaAvisar),
    ...notificacaoLimiteMei(faturamentoBrutoTotal, limiteAnual),
    ...notificacaoCertificado(certificado?.diasRestantes, certificado?.validoAte),
    ...notificacaoCobrancasVencidas(cobrancasVencidas.quantidade, cobrancasVencidas.valor),
    ...notificacaoEstoqueBaixo(estoqueBaixo),
  ]);

  // Reporta a contagem para o sino no cabeçalho. Preso ao tamanho da lista, não
  // ao array em si — evita reportar de novo quando o conteúdo é o mesmo mas a
  // referência mudou por causa de um re-render qualquer do App.
  const contagem = notificacoes.length;
  useEffect(() => {
    onContagem(contagem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contagem]);

  const clicar = useCallback((n: Notificacao) => {
    if (n.categoria === "das") onAbrirDas();
    else if (n.categoria === "certificado") onAbrirCertificado();
    else if (n.categoria === "cobranca") onAbrirCobrancasVencidas();
    else if (n.categoria === "estoque") onAbrirEstoque();
    else if (n.categoria === "recebimento" && n.vendaId && n.parcelaId) onAbrirRecebimento(n.vendaId, n.parcelaId);
    onFechar();
  }, [onAbrirDas, onAbrirCertificado, onAbrirCobrancasVencidas, onAbrirEstoque, onAbrirRecebimento, onFechar]);

  if (!aberto) return null;

  return (
    <>
      {/* Fundo clicável — fechar ao tocar fora, sem escurecer a tela (não é um
          modal bloqueante, é um painel de consulta rápida). */}
      <div className="fixed inset-0 z-40" onClick={onFechar} aria-hidden="true" />

      <div className="fixed top-[4.5rem] sm:top-20 right-2 sm:right-6 z-50 w-[calc(100vw-1rem)] sm:w-96 max-h-[75vh] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden text-left animate-fade-in">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2 shrink-0">
          <Bell className="w-4 h-4 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold uppercase tracking-wider">Notificações</p>
            <p className="text-[10px] text-slate-400 font-medium truncate">
              {notificacoes.length === 0
                ? "Tudo em dia por aqui"
                : `${notificacoes.length} ${notificacoes.length === 1 ? "aviso pendente" : "avisos pendentes"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-100">
          {notificacoes.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-slate-400 font-medium">
                Nenhum DAS vencendo, recebimento em atraso ou pendência fiscal agora.
              </p>
            </div>
          ) : (
            notificacoes.map((n) => {
              const Icone = ICONE[n.categoria];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => clicar(n)}
                  className="w-full px-4 py-3 flex items-start gap-2.5 hover:bg-slate-50 transition-colors cursor-pointer text-left"
                >
                  <span
                    className={`shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center ${
                      n.severidade === "urgente" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    <Icone className="w-3.5 h-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-800">{n.titulo}</span>
                    <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{n.detalhe}</span>
                    {n.acao && (
                      <span className="inline-block mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-blue-600">
                        {n.acao}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
