/**
 * ============================================================================
 * CONDIÇÃO DE PAGAMENTO E COMISSÃO — o mesmo combinado, agora no orçamento
 * ============================================================================
 *
 * Irmão de BlocoRecebimentoVenda.tsx, com uma diferença que reflete o momento:
 * aqui NADA foi recebido ainda. Não existe "entra no caixa agora" — existe só
 * o que fica combinado na proposta. Por isso:
 *
 *   • não há forma de pagamento da "entrada recebida", só a forma prevista;
 *   • a comissão só pode incidir sobre o total (não existe "recebido" para
 *     incidir sobre);
 *   • o texto final (`textoDaCondicao`) é o que vai impresso na proposta —
 *     é a frase que o cliente lê e assina, então tem que estar correta aqui
 *     ANTES de gerar o PDF, não depois.
 *
 * Quando o orçamento é aceito, `planoDoOrcamento()` (utils/recebimentos.ts)
 * lê esta mesma condição e monta o plano de recebimento da venda — nada é
 * redigitado.
 */

import React from "react";
import { HandCoins, Percent, Clock, Users, Truck } from "lucide-react";
import type { CondicaoPagamento, ComposicaoValor, RepasseFornecedor } from "../types";
import { arredondar, entradaDaCondicao, textoDaCondicao } from "../utils/recebimentos";
import { textoComposicao } from "../utils/composicaoValor";
import { mascararDocumento } from "../utils/documentoBR";

export type CondicaoForm = {
  ativa: boolean;
  entradaValor: string;
  entradaPct: string;
  formaEntrada: string;
  formaSaldo: string;
  previsaoSaldo: string;
  gatilhoSaldo: string;

  comissaoAtiva: boolean;
  comBeneficiario: string;
  comBase: "percentual" | "fixo";
  comPercentual: string;
  comValor: string;

  /**
   * MATERIAL E FORNECEDOR — ver types.ts (`RepasseFornecedor`) e
   * utils/composicaoValor.ts. A composição em si (quanto é produto, quanto é
   * serviço) não mora aqui: vem sempre de `itens`, recalculada na hora.
   */
  mostrarComposicao: boolean;
  repasseAtiva: boolean;
  fornecedorNome: string;
  fornecedorDocumento: string;
};

export const condicaoVazia: CondicaoForm = {
  ativa: false,
  entradaValor: "",
  entradaPct: "50",
  formaEntrada: "Pix",
  formaSaldo: "Pix",
  previsaoSaldo: "",
  gatilhoSaldo: "",

  comissaoAtiva: false,
  comBeneficiario: "",
  comBase: "percentual",
  comPercentual: "10",
  comValor: "",

  // `true` por padrão: preserva o comportamento de sempre (itens um a um no
  // PDF) para quem já usava orçamento com produto e serviço misturados antes
  // deste recurso existir.
  mostrarComposicao: true,
  repasseAtiva: false,
  fornecedorNome: "",
  fornecedorDocumento: "",
};

const FORMAS = ["Pix", "Dinheiro", "Boleto Bancário", "Cartão de Crédito", "Cartão de Débito", "Transferência"];
const GATILHOS = [
  "Aprovação na concessionária",
  "Entrega do material",
  "Conclusão da instalação",
  "Assinatura do contrato",
  "Liberação do financiamento",
];

const emReais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const rotulo = "block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1";
const campo = "w-full border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

/** Converte o formulário na tela para o tipo que é gravado no orçamento. */
export function condicaoParaSalvar(f: CondicaoForm): CondicaoPagamento | undefined {
  if (!f.ativa) return undefined;
  const entradaValor = arredondar(f.entradaValor.replace(",", "."));
  return {
    entradaValor: entradaValor > 0 ? entradaValor : undefined,
    entradaPercentual: entradaValor > 0 ? undefined : Number(f.entradaPct.replace(",", ".")) || undefined,
    formaEntrada: f.formaEntrada || undefined,
    formaSaldo: f.formaSaldo || undefined,
    previsaoSaldo: f.previsaoSaldo.trim() || undefined,
    gatilhoSaldo: f.gatilhoSaldo.trim() || undefined,
  };
}

/** Converte o formulário no repasse gravado no orçamento — ausente quando desligado. */
export function repasseParaSalvar(f: CondicaoForm): RepasseFornecedor | undefined {
  if (!f.repasseAtiva || !f.fornecedorNome.trim()) return undefined;
  return {
    ativo: true,
    fornecedorNome: f.fornecedorNome.trim(),
    fornecedorDocumento: f.fornecedorDocumento.trim() || undefined,
  };
}

export default function BlocoCondicaoPagamento({
  total,
  form,
  onChange,
  composicao,
}: {
  total: number;
  form: CondicaoForm;
  onChange: (f: CondicaoForm) => void;
  /** Soma dos itens por tipo (produto × serviço) — vem de `composicaoDosItens(itens)`. */
  composicao?: ComposicaoValor;
}) {
  const cheio = arredondar(total);
  const alterar = (m: Partial<CondicaoForm>) => onChange({ ...form, ...m });

  const condicaoAtual = condicaoParaSalvar(form);
  const entrada = entradaDaCondicao(cheio, condicaoAtual);
  const saldo = arredondar(cheio - entrada);

  const mudarValor = (texto: string) => {
    const v = arredondar(texto.replace(",", "."));
    alterar({ entradaValor: texto, entradaPct: cheio > 0 ? String(Math.round((v / cheio) * 1000) / 10) : form.entradaPct });
  };
  const mudarPct = (texto: string) => {
    const p = Number(texto.replace(",", ".")) || 0;
    alterar({ entradaPct: texto, entradaValor: cheio > 0 ? String(arredondar((cheio * p) / 100)) : form.entradaValor });
  };

  const comissao = (() => {
    if (!form.comissaoAtiva || !form.comBeneficiario.trim()) return 0;
    if (form.comBase === "fixo") return arredondar(form.comValor.replace(",", "."));
    return arredondar((cheio * (Number(form.comPercentual.replace(",", ".")) || 0)) / 100);
  })();

  return (
    <div className="space-y-4 pt-2 border-t border-slate-50">
      <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
        <HandCoins className="w-3.5 h-3.5" /> Condição de pagamento
        <span className="font-medium text-slate-400 normal-case">(opcional)</span>
      </h4>

      <button
        type="button"
        onClick={() => alterar({ ativa: !form.ativa })}
        className={`w-full text-left rounded-xl p-3 border text-xs font-bold transition-colors ${
          form.ativa ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-slate-50 border-slate-200 text-slate-500"
        }`}
      >
        {form.ativa ? "Entrada + saldo combinados nesta proposta" : "À vista (padrão) — clique para combinar entrada e saldo"}
      </button>

      {form.ativa && (
        <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
          <div>
            <label className={rotulo}>Entrada prevista</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                <input
                  type="number" step="0.01" min="0" placeholder="0,00"
                  value={form.entradaValor}
                  onChange={(e) => mudarValor(e.target.value)}
                  className={`${campo} pl-9 font-bold`}
                />
              </div>
              <div className="relative w-24">
                <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input
                  type="number" step="1" min="0" max="100" placeholder="50"
                  value={form.entradaPct}
                  onChange={(e) => mudarPct(e.target.value)}
                  className={`${campo} pr-8 font-bold text-center`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[20, 30, 40, 50, 60].map((p) => (
                <button
                  key={p} type="button" onClick={() => mudarPct(String(p))}
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-bold transition-all ${
                    Number(form.entradaPct) === p ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Forma da entrada</label>
              <select value={form.formaEntrada} onChange={(e) => alterar({ formaEntrada: e.target.value })} className={`${campo} bg-white`}>
                {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className={rotulo}>Forma do saldo</label>
              <select value={form.formaSaldo} onChange={(e) => alterar({ formaSaldo: e.target.value })} className={`${campo} bg-white`}>
                {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={rotulo}><Clock className="w-3 h-3 inline mr-1 -mt-0.5" />Previsão do saldo — deixe em branco se não souber</label>
            <input
              type="text" placeholder="dd/mm/aaaa (opcional)"
              value={form.previsaoSaldo} onChange={(e) => alterar({ previsaoSaldo: e.target.value })}
              className={`${campo} font-mono`}
            />
          </div>

          <div>
            <label className={rotulo}>O que destrava o saldo</label>
            <input
              type="text" placeholder="Ex.: aprovação na Coelba"
              value={form.gatilhoSaldo} onChange={(e) => alterar({ gatilhoSaldo: e.target.value })}
              className={campo}
            />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {GATILHOS.map((g) => (
                <button key={g} type="button" onClick={() => alterar({ gatilhoSaldo: g })}
                  className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-[11px] font-semibold text-blue-900">
            {textoDaCondicao(cheio, condicaoAtual)}
          </div>
        </div>
      )}

      {/* ---- Comissão prevista ---- */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => alterar({ comissaoAtiva: !form.comissaoAtiva })}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-left"
        >
          <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-600" />
            Comissão prevista <span className="font-medium text-slate-400 normal-case">(opcional)</span>
          </span>
          <span className={`w-9 h-5 rounded-full p-0.5 transition-all ${form.comissaoAtiva ? "bg-violet-600" : "bg-slate-300"}`}>
            <span className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-all ${form.comissaoAtiva ? "translate-x-4" : ""}`} />
          </span>
        </button>

        {form.comissaoAtiva && (
          <div className="p-4 space-y-3">
            <div>
              <label className={rotulo}>Quem recebe</label>
              <input
                type="text" placeholder="Nome do vendedor, parceiro ou quem indicou"
                value={form.comBeneficiario} onChange={(e) => alterar({ comBeneficiario: e.target.value })}
                className={campo}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10px] font-bold shrink-0">
                <button type="button" onClick={() => alterar({ comBase: "percentual" })}
                  className={`px-2.5 py-1 rounded-md ${form.comBase === "percentual" ? "bg-violet-600 text-white" : "text-slate-500"}`}>%</button>
                <button type="button" onClick={() => alterar({ comBase: "fixo" })}
                  className={`px-2.5 py-1 rounded-md ${form.comBase === "fixo" ? "bg-violet-600 text-white" : "text-slate-500"}`}>R$ fixo</button>
              </div>
              {form.comBase === "percentual" ? (
                <input type="number" step="0.5" min="0" placeholder="10" value={form.comPercentual}
                  onChange={(e) => alterar({ comPercentual: e.target.value })} className={`${campo} font-bold`} />
              ) : (
                <input type="number" step="0.01" min="0" placeholder="0,00" value={form.comValor}
                  onChange={(e) => alterar({ comValor: e.target.value })} className={`${campo} font-bold`} />
              )}
            </div>
            <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 text-[11px] font-semibold text-violet-900 flex items-center justify-between">
              <span>Comissão sobre o total da proposta</span>
              <span className="font-bold">{emReais(comissao)}</span>
            </div>
          </div>
        )}
      </div>

      {/*
        ---- Material e fornecedor ----

        Só aparece quando o orçamento realmente mistura produto e serviço —
        proposta só de serviço (a maioria) não ganha campo a mais. Ver o
        comentário de `RepasseFornecedor` em types.ts.
      */}
      {!!composicao && composicao.material > 0 && (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-1.5">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
              <Truck className="w-4 h-4 text-sky-600" />
              Material e fornecedor
            </span>
            <p className="text-[11px] text-slate-500 font-semibold">
              {textoComposicao(composicao)}
            </p>
          </div>

          <div className="p-4 space-y-4">
            <button
              type="button"
              onClick={() => alterar({ mostrarComposicao: !form.mostrarComposicao })}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <span className="text-[11px] font-bold text-slate-600">
                Mostrar material e serviço separados para o cliente no PDF
              </span>
              <span className={`w-9 h-5 rounded-full p-0.5 transition-all shrink-0 ${form.mostrarComposicao ? "bg-sky-600" : "bg-slate-300"}`}>
                <span className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-all ${form.mostrarComposicao ? "translate-x-4" : ""}`} />
              </span>
            </button>
            <p className="text-[10px] text-slate-400 leading-relaxed -mt-2">
              {form.mostrarComposicao
                ? "O cliente vê os itens um a um, como já era."
                : "O cliente vê só o valor total do projeto, numa linha só — sem o preço do material aparecer separado."}
            </p>

            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => alterar({ repasseAtiva: !form.repasseAtiva })}
                className="w-full flex items-center justify-between gap-3 text-left"
              >
                <span className="text-[11px] font-bold text-slate-600">
                  O fornecedor fatura e recebe o material direto do cliente (repasse)
                </span>
                <span className={`w-9 h-5 rounded-full p-0.5 transition-all shrink-0 ${form.repasseAtiva ? "bg-sky-600" : "bg-slate-300"}`}>
                  <span className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-all ${form.repasseAtiva ? "translate-x-4" : ""}`} />
                </span>
              </button>

              {form.repasseAtiva && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className={rotulo}>Nome do fornecedor</label>
                    <input
                      type="text" placeholder="Quem fatura e recebe o material"
                      value={form.fornecedorNome} onChange={(e) => alterar({ fornecedorNome: e.target.value })}
                      className={campo}
                    />
                  </div>
                  <div>
                    <label className={rotulo}>CNPJ/CPF do fornecedor (opcional)</label>
                    <input
                      type="text" placeholder="Só para referência sua"
                      value={form.fornecedorDocumento} onChange={(e) => alterar({ fornecedorDocumento: mascararDocumento(e.target.value) })}
                      className={campo}
                    />
                  </div>
                  <div className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-[11px] font-semibold text-sky-900 leading-relaxed">
                    Só {emReais(composicao.servico)} vai entrar no seu Livro Caixa quando esta proposta virar
                    venda. O material ({emReais(composicao.material)}) nunca passa pela sua mão — emita a nota de
                    serviço para {form.fornecedorNome.trim() || "o fornecedor"}, não para o cliente.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
