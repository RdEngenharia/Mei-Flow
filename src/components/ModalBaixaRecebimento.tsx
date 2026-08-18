/**
 * ============================================================================
 * BAIXA DE RECEBIMENTO — "o dinheiro caiu"
 * ============================================================================
 *
 * Duas coisas que esta janela precisa acertar, e que quase todo sistema erra:
 *
 * 1. A DATA É A DO RECEBIMENTO, NÃO A DA VENDA. A entrada caiu em julho e o
 *    saldo em setembro: cada um tem que aparecer no seu mês. É essa data que
 *    `valorNoPeriodo()` usa para dividir o faturamento entre os meses, e é o
 *    que faz o relatório do MEI bater com o extrato bancário.
 *
 * 2. O CLIENTE PODE MANDAR MENOS. Devia R$ 15.000 e depositou R$ 10.000 — não
 *    quitou nem deixou de pagar. Sem o valor editável, a única saída seria
 *    mentir para um dos dois lados; com ele, a parcela se parte em "o que caiu"
 *    e "o que ainda falta", e as duas continuam rastreadas.
 */

import React, { useState } from "react";
import { X } from "lucide-react";
import type { Recebimento, Transacao } from "../types";
import { arredondar, hojeBR } from "../utils/recebimentos";

const FORMAS = [
  "Pix",
  "Dinheiro",
  "Boleto Bancário",
  "Cartão de Crédito",
  "Cartão de Débito",
  "Transferência",
];

const emReais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const rotulo = "block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1";
const campo =
  "w-full border border-slate-200 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function ModalBaixaRecebimento({
  venda,
  parcela,
  onCancelar,
  onConfirmar,
}: {
  venda: Transacao;
  parcela: Recebimento;
  onCancelar: () => void;
  onConfirmar: (dados: { valor: number; data: string; forma: string }) => void;
}) {
  const [valor, setValor] = useState(String(parcela.valor));
  const [data, setData] = useState(hojeBR());
  const [forma, setForma] = useState(parcela.forma || "Pix");

  const recebido = Math.max(0, arredondar(valor.replace(",", ".")));
  const restante = arredondar(parcela.valor - recebido);
  const dataValida = /^\d{2}\/\d{2}\/\d{4}$/.test(data.trim());

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
        <div className="pt-safe px-6 pb-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            Registrar recebimento
          </h3>
          <button
            onClick={onCancelar}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <p className="text-sm font-semibold text-slate-800">
              {venda.clienteNome || "Cliente não identificado"}
            </p>
            <p className="text-[11px] text-slate-400">{venda.descricao}</p>
            <p className="text-[11px] text-slate-500 mt-1.5 font-semibold">
              {parcela.rotulo || "Parcela"} de {emReais(parcela.valor)}
              {parcela.gatilho && !parcela.previsao ? ` · aguardava: ${parcela.gatilho}` : ""}
            </p>
          </div>

          <div>
            <label className={rotulo}>Quanto caiu na conta</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">
                R$
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className={`${campo} pl-10 font-bold`}
              />
            </div>

            {restante > 0 && recebido > 0 && (
              <p className="text-[11px] text-amber-700 font-semibold mt-1.5">
                Recebimento parcial: ficam {emReais(restante)} ainda a receber, com o
                combinado preservado.
              </p>
            )}
          </div>

          <div>
            <label className={rotulo}>Data em que o dinheiro entrou</label>
            <input
              type="text"
              placeholder="dd/mm/aaaa"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className={`${campo} font-mono`}
            />
            {/*
              O relatório mensal do MEI se apoia nesta data. Deixá-la errada é
              jogar faturamento para o mês vizinho, e é o tipo de erro que só
              aparece na conferência do contador.
            */}
            <p className="text-[10px] text-slate-400 mt-1">
              É esta data que decide em qual mês o valor entra no seu faturamento.
            </p>
            {!dataValida && (
              <p className="text-[10px] text-rose-600 font-semibold mt-1">
                Escreva no formato dd/mm/aaaa.
              </p>
            )}
          </div>

          <div>
            <label className={rotulo}>Como você recebeu</label>
            <select
              value={forma}
              onChange={(e) => setForma(e.target.value)}
              className={`${campo} bg-white`}
            >
              {FORMAS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="pt-2 border-t border-slate-100 flex gap-3">
            <button
              type="button"
              onClick={onCancelar}
              className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={recebido <= 0 || !dataValida}
              onClick={() => onConfirmar({ valor: recebido, data: data.trim(), forma })}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
            >
              Confirmar recebimento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
