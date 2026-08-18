/**
 * ============================================================================
 * PAINEL "A RECEBER" — o dinheiro que já é seu e ainda não caiu
 * ============================================================================
 *
 * POR QUE ELE NÃO É UMA AGENDA
 *
 * A Agenda de Cobranças (utils/agendaCobrancas.ts) agrupa por mês e dia, porque
 * boleto tem vencimento. Aqui a maioria das linhas NÃO TEM DATA — é o saldo que
 * cai "quando a concessionária aprovar". Agrupar por mês colocaria quase tudo
 * numa gaveta chamada "Sem vencimento", que é a pior tela possível: o dado mais
 * importante virando exceção.
 *
 * Então a ordem aqui é OUTRA, e é a ordem da ligação de hoje:
 *   1º  o que passou da previsão combinada (atraso de verdade, em vermelho);
 *   2º  o que está esperando há mais tempo (fato, não palpite);
 *   3º  o de maior valor.
 *
 * "Há 40 dias" é uma frase que faz a pessoa pegar o telefone. "Vence em algum
 * momento" não é.
 *
 * A COMISSÃO APARECE AQUI DE PROPÓSITO
 *
 * É o outro lado da mesma pergunta — "o que ainda vai mexer no meu caixa". Ver
 * as duas listas juntas evita a conta de cabeça que todo mundo erra: entra
 * 15 mil, mas 3 mil já têm dono.
 */

import React from "react";
import { Clock, AlertTriangle, HandCoins, Users, Check } from "lucide-react";
import type { Recebimento, Transacao } from "../types";
import { montarAReceber, comissoesAPagar, arredondar } from "../utils/recebimentos";

const emReais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PainelAReceber({
  transacoes,
  onBaixar,
  onPagarComissao,
}: {
  transacoes: Transacao[];
  onBaixar: (venda: Transacao, parcela: Recebimento) => void;
  onPagarComissao: (venda: Transacao) => void;
}) {
  const { linhas, total } = montarAReceber(transacoes);
  const comissoes = comissoesAPagar(transacoes);
  const totalComissoes = arredondar(comissoes.reduce((s, c) => s + c.comissao.valor, 0));

  // Nada pendente não merece um painel vazio ocupando a tela.
  if (linhas.length === 0 && comissoes.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
      {/* ------------------------------------------------------------------ */}
      {/* A RECEBER                                                           */}
      {/* ------------------------------------------------------------------ */}
      {linhas.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <HandCoins className="w-3.5 h-3.5 text-amber-500" />
                A receber
              </span>
              <h3 className="text-3xl font-display font-light text-slate-900 tracking-tight mt-1">
                {emReais(total)}
              </h3>
              <p className="text-[11px] text-slate-400 font-medium mt-1">
                {linhas.length} {linhas.length === 1 ? "recebimento" : "recebimentos"} em aberto ·
                não entra no faturamento até cair
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {linhas.map(({ venda, parcela, diasEmAberto, diasDeAtraso }) => (
              <div
                key={`${venda.id}_${parcela.id}`}
                className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {venda.clienteNome || "Cliente não identificado"}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {parcela.rotulo ? `${parcela.rotulo} · ` : ""}
                    {venda.descricao}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {/*
                      Vermelho SÓ com previsão estourada. Sem data combinada não
                      existe atraso — existe espera, e espera é cinza.
                    */}
                    {diasDeAtraso > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-bold">
                        <AlertTriangle className="w-3 h-3" />
                        {diasDeAtraso} {diasDeAtraso === 1 ? "dia" : "dias"} de atraso
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                        <Clock className="w-3 h-3" />
                        esperando há {diasEmAberto} {diasEmAberto === 1 ? "dia" : "dias"}
                      </span>
                    )}

                    {parcela.previsao && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold font-mono">
                        previsto {parcela.previsao}
                      </span>
                    )}

                    {!parcela.previsao && parcela.gatilho && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[10px] font-bold">
                        aguarda: {parcela.gatilho}
                      </span>
                    )}

                    {parcela.forma && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-50 text-slate-500 text-[10px] font-semibold">
                        {parcela.forma}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900 whitespace-nowrap">
                    {emReais(parcela.valor)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onBaixar(venda, parcela)}
                    className="mt-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-all"
                  >
                    Recebi
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* COMISSÕES A PAGAR                                                   */}
      {/* ------------------------------------------------------------------ */}
      {comissoes.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-violet-500" />
              Comissões a pagar
            </span>
            <h3 className="text-3xl font-display font-light text-slate-900 tracking-tight mt-1">
              {emReais(totalComissoes)}
            </h3>
            <p className="text-[11px] text-slate-400 font-medium mt-1">
              ainda não saiu do caixa · vira despesa quando você marcar como paga
            </p>
          </div>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {comissoes.map(({ venda, comissao }) => (
              <div
                key={venda.id}
                className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {comissao.beneficiario}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {venda.clienteNome || "venda"} · {venda.descricao}
                  </p>
                  {comissao.base === "percentual" && (
                    <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-[10px] font-bold">
                      {comissao.percentual}% sobre{" "}
                      {comissao.sobre === "recebido" ? "o recebido" : "o total"}
                    </span>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900 whitespace-nowrap">
                    {emReais(comissao.valor)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onPagarComissao(venda)}
                    className="mt-1.5 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold transition-all inline-flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" />
                    Paguei
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
