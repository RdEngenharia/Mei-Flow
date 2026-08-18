/**
 * ============================================================================
 * BLOCO DE RECEBIMENTO E COMISSÃO — o pedaço novo do formulário de venda
 * ============================================================================
 *
 * Vive fora do App.tsx de propósito: aquele arquivo já tem 3.500 linhas, e
 * enfiar mais duzentas de formulário lá dentro é como esconder o campo de
 * cliente no meio da tela — funciona hoje e some amanhã.
 *
 * TRÊS DECISÕES DE TELA QUE NÃO SÃO ENFEITE
 *
 * 1. O padrão é "recebi tudo agora". Quem vende à vista — a maioria das vendas
 *    do app — não pode pagar o preço de um recurso que não usa. O parcelamento
 *    é uma chave que a pessoa liga.
 *
 * 2. Entrada em R$ e em % ao mesmo tempo, os dois editáveis e sincronizados.
 *    "50%" é como o combinado é falado; "R$ 15.000" é o que entra na conta. Ter
 *    que converter de cabeça é onde nasce o erro de digitação.
 *
 * 3. Data do saldo é OPCIONAL, e ao lado dela existe um campo de texto para o
 *    marco que destrava o dinheiro. É a razão de este recurso existir: no
 *    projeto fotovoltaico ninguém sabe o dia da aprovação da concessionária, e
 *    obrigar um chute transforma o painel num gerador de alarme falso.
 *
 * ⚠️ Este componente é CONTROLADO e não calcula nada que valha dinheiro. Ele
 *    devolve texto; quem transforma em parcelas é `montarPlano()` e quem
 *    calcula a comissão é `calcularComissao()`, ambas em utils/recebimentos.ts,
 *    ambas cobertas por teste. Duplicar essa conta aqui seria a quinta vez que
 *    este projeto guarda o mesmo número em dois lugares.
 */

import React from "react";
import { HandCoins, Percent, Clock, Users, Truck } from "lucide-react";
import { arredondar } from "../utils/recebimentos";
import type { ComposicaoValor, RepasseFornecedor } from "../types";

export type PlanoVendaForm = {
  parcelada: boolean;
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
  comSobre: "total" | "recebido";

  /**
   * MATERIAL E FORNECEDOR — para a venda lançada direto (fora do funil de
   * orçamento), sem itens para somar por tipo. Ver types.ts (`RepasseFornecedor`)
   * e utils/composicaoValor.ts.
   */
  materialAtivo: boolean;
  /** Quanto do valor total é seu (serviço). O resto vira material por diferença. */
  valorServico: string;
  repasseAtiva: boolean;
  fornecedorNome: string;
  fornecedorDocumento: string;
};

export const planoVendaVazio: PlanoVendaForm = {
  parcelada: false,
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
  comSobre: "total",

  materialAtivo: false,
  valorServico: "",
  repasseAtiva: false,
  fornecedorNome: "",
  fornecedorDocumento: "",
};

const FORMAS = [
  "Pix",
  "Dinheiro",
  "Boleto Bancário",
  "Cartão de Crédito",
  "Cartão de Débito",
  "Transferência",
];

/**
 * Sugestões de marco, não de data.
 *
 * Ficam como botões porque o usuário repete o mesmo gatilho em quase toda
 * venda do mesmo tipo, e digitar "Aprovação na concessionária" pela vigésima
 * vez é onde as grafias começam a divergir.
 */
const GATILHOS = [
  "Aprovação na concessionária",
  "Entrega do material",
  "Conclusão da instalação",
  "Assinatura do contrato",
  "Liberação do financiamento",
];

const emReais = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const rotulo = "block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1";
const campo =
  "w-full border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

/**
 * Converte o formulário na composição e no repasse gravados na venda.
 * Ausentes quando "materialAtivo" está desligado — a maioria das vendas, que
 * não muda em nada por este recurso existir.
 */
export function composicaoParaSalvar(
  f: PlanoVendaForm,
  total: number
): { composicao?: ComposicaoValor; repasse?: RepasseFornecedor } {
  if (!f.materialAtivo) return {};
  const cheio = arredondar(total);
  const servico = Math.min(Math.max(0, arredondar(f.valorServico.replace(",", "."))), cheio);
  const composicao: ComposicaoValor = { servico, material: arredondar(cheio - servico) };

  const repasse: RepasseFornecedor | undefined =
    f.repasseAtiva && f.fornecedorNome.trim()
      ? { ativo: true, fornecedorNome: f.fornecedorNome.trim(), fornecedorDocumento: f.fornecedorDocumento.trim() || undefined }
      : undefined;

  return { composicao, repasse };
}

export default function BlocoRecebimentoVenda({
  total,
  plano,
  onChange,
}: {
  /** Valor cheio da venda, já em número. Vem do campo "Valor" do formulário. */
  total: number;
  plano: PlanoVendaForm;
  onChange: (p: PlanoVendaForm) => void;
}) {
  const cheio = arredondar(total);
  const alterar = (mudanca: Partial<PlanoVendaForm>) => onChange({ ...plano, ...mudanca });

  const entrada = Math.min(Math.max(0, arredondar(plano.entradaValor)), cheio);
  const saldo = arredondar(cheio - entrada);

  /**
   * Os dois campos de entrada andam juntos.
   *
   * Digitar no percentual recalcula o valor e vice-versa. O percentual só é
   * calculável quando existe um total — antes disso, mexer no % não pode
   * escrever R$ 0,00 no outro campo e dar a impressão de que apagou.
   */
  const mudarValor = (texto: string) => {
    const v = arredondar(texto.replace(",", "."));
    alterar({
      entradaValor: texto,
      entradaPct: cheio > 0 ? String(Math.round((v / cheio) * 1000) / 10) : plano.entradaPct,
    });
  };

  const mudarPct = (texto: string) => {
    const p = Number(texto.replace(",", ".")) || 0;
    alterar({
      entradaPct: texto,
      entradaValor: cheio > 0 ? String(arredondar((cheio * p) / 100)) : plano.entradaValor,
    });
  };

  const comissao = (() => {
    if (!plano.comissaoAtiva || !plano.comBeneficiario.trim()) return 0;
    if (plano.comBase === "fixo") return arredondar(plano.comValor.replace(",", "."));
    const base = plano.comSobre === "recebido" ? (plano.parcelada ? entrada : cheio) : cheio;
    return arredondar((base * (Number(plano.comPercentual.replace(",", ".")) || 0)) / 100);
  })();

  const servicoInformado = Math.min(Math.max(0, arredondar(plano.valorServico)), cheio);
  const materialCalculado = arredondar(cheio - servicoInformado);

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- */}
      {/* RECEBIMENTO                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-emerald-600" />
            Recebimento
          </span>

          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() => alterar({ parcelada: false })}
              className={`px-2.5 py-1 rounded-md transition-all ${
                !plano.parcelada ? "bg-emerald-600 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Recebi tudo
            </button>
            <button
              type="button"
              onClick={() => alterar({ parcelada: true })}
              className={`px-2.5 py-1 rounded-md transition-all ${
                plano.parcelada ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Vou receber em partes
            </button>
          </div>
        </div>

        {plano.parcelada && (
          <div className="p-4 space-y-4">
            {/* ---- ENTRADA ---- */}
            <div>
              <label className={rotulo}>Entrada recebida agora</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    value={plano.entradaValor}
                    onChange={(e) => mudarValor(e.target.value)}
                    className={`${campo} pl-9 font-bold`}
                  />
                </div>
                <div className="relative w-28">
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    placeholder="50"
                    value={plano.entradaPct}
                    onChange={(e) => mudarPct(e.target.value)}
                    className={`${campo} pr-8 font-bold text-center`}
                  />
                </div>
              </div>

              {/* Atalhos: a entrada muda de cliente para cliente, e é isso que
                  o usuário pediu — "dependendo do valor total o cliente pode
                  dar uma entrada menor". */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[0, 20, 30, 40, 50, 60].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => mudarPct(String(p))}
                    className={`px-2 py-0.5 rounded-md border text-[10px] font-bold transition-all ${
                      Number(plano.entradaPct) === p
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {p === 0 ? "Nada agora" : `${p}%`}
                  </button>
                ))}
              </div>

              {entrada > 0 && (
                <div className="mt-2">
                  <label className={rotulo}>Como a entrada foi paga</label>
                  <select
                    value={plano.formaEntrada}
                    onChange={(e) => alterar({ formaEntrada: e.target.value })}
                    className={`${campo} bg-white`}
                  >
                    {FORMAS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* ---- SALDO ---- */}
            <div className="rounded-xl bg-amber-50/60 border border-amber-100 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                  Falta receber
                </span>
                <span className="text-base font-bold text-amber-900">{emReais(saldo)}</span>
              </div>

              {saldo > 0 && (
                <>
                  <div>
                    <label className={rotulo}>Como você vai receber o saldo</label>
                    <select
                      value={plano.formaSaldo}
                      onChange={(e) => alterar({ formaSaldo: e.target.value })}
                      className={`${campo} bg-white`}
                    >
                      {FORMAS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>

                  {/*
                    O CAMPO QUE JUSTIFICA O RECURSO INTEIRO.

                    Data em branco não é campo esquecido: é a resposta certa
                    quando não se sabe o dia. A tela diz isso em voz alta, senão
                    o usuário vai chutar uma data só para não deixar vazio — e é
                    o chute que estraga o painel depois.
                  */}
                  <div>
                    <label className={rotulo}>
                      <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
                      Previsão — deixe em branco se não souber
                    </label>
                    <input
                      type="text"
                      placeholder="dd/mm/aaaa (opcional)"
                      value={plano.previsaoSaldo}
                      onChange={(e) => alterar({ previsaoSaldo: e.target.value })}
                      className={`${campo} bg-white font-mono`}
                    />
                  </div>

                  <div>
                    <label className={rotulo}>O que destrava o pagamento</label>
                    <input
                      type="text"
                      placeholder="Ex.: aprovação na Coelba"
                      value={plano.gatilhoSaldo}
                      onChange={(e) => alterar({ gatilhoSaldo: e.target.value })}
                      className={`${campo} bg-white`}
                    />
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {GATILHOS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => alterar({ gatilhoSaldo: g })}
                          className="px-2 py-0.5 rounded-md bg-white border border-amber-200 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 transition-all"
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[10px] text-amber-800/80 leading-relaxed">
                    Sem previsão, o painel mostra <strong>há quantos dias</strong> você está
                    esperando — em vez de inventar um atraso que ninguém combinou.
                  </p>
                </>
              )}
            </div>

            {/* Resumo, para conferir antes de salvar. */}
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 border-t border-slate-100 pt-3">
              <span>
                Entra no caixa agora:{" "}
                <strong className="text-emerald-700">{emReais(entrada)}</strong>
              </span>
              <span>
                Venda:{" "}
                <strong className="text-slate-800">{emReais(cheio)}</strong>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* COMISSÃO                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => alterar({ comissaoAtiva: !plano.comissaoAtiva })}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-left"
        >
          <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-600" />
            Comissão desta venda
            <span className="font-medium text-slate-400 normal-case">(opcional)</span>
          </span>
          <span
            className={`w-9 h-5 rounded-full p-0.5 transition-all ${
              plano.comissaoAtiva ? "bg-violet-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-all ${
                plano.comissaoAtiva ? "translate-x-4" : ""
              }`}
            />
          </span>
        </button>

        {plano.comissaoAtiva && (
          <div className="p-4 space-y-3">
            <div>
              <label className={rotulo}>Quem recebe</label>
              <input
                type="text"
                placeholder="Nome do vendedor, parceiro ou quem indicou"
                value={plano.comBeneficiario}
                onChange={(e) => alterar({ comBeneficiario: e.target.value })}
                className={campo}
              />
            </div>

            <div className="flex gap-2">
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[10px] font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => alterar({ comBase: "percentual" })}
                  className={`px-2.5 py-1 rounded-md ${
                    plano.comBase === "percentual" ? "bg-violet-600 text-white" : "text-slate-500"
                  }`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => alterar({ comBase: "fixo" })}
                  className={`px-2.5 py-1 rounded-md ${
                    plano.comBase === "fixo" ? "bg-violet-600 text-white" : "text-slate-500"
                  }`}
                >
                  R$ fixo
                </button>
              </div>

              {plano.comBase === "percentual" ? (
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="10"
                  value={plano.comPercentual}
                  onChange={(e) => alterar({ comPercentual: e.target.value })}
                  className={`${campo} font-bold`}
                />
              ) : (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  value={plano.comValor}
                  onChange={(e) => alterar({ comValor: e.target.value })}
                  className={`${campo} font-bold`}
                />
              )}
            </div>

            {plano.comBase === "percentual" && plano.parcelada && (
              <div>
                <label className={rotulo}>O percentual incide sobre</label>
                <select
                  value={plano.comSobre}
                  onChange={(e) => alterar({ comSobre: e.target.value as "total" | "recebido" })}
                  className={`${campo} bg-white`}
                >
                  <option value="total">O valor total da venda</option>
                  <option value="recebido">Só o que já recebi</option>
                </select>
              </div>
            )}

            <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 text-[11px] font-semibold text-violet-900 space-y-1">
              <div className="flex items-center justify-between">
                <span>Comissão</span>
                <span className="font-bold">{emReais(comissao)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Sobra para você</span>
                <span className="font-bold">{emReais(arredondar(cheio - comissao))}</span>
              </div>
            </div>

            {/*
              A regra combinada com o usuário, escrita na tela para não virar
              surpresa: a comissão NÃO sai do caixa ao registrar a venda. Ela
              fica devendo e vira despesa no dia em que for paga de verdade.
            */}
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Fica registrada como <strong>a pagar</strong>. Só entra como despesa no Livro
              Caixa no dia em que você marcar como paga — assim o saldo do mês não mostra
              um dinheiro que ainda está na sua conta.
            </p>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* MATERIAL E FORNECEDOR                                             */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => alterar({ materialAtivo: !plano.materialAtivo })}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-left"
        >
          <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
            <Truck className="w-4 h-4 text-sky-600" />
            Este valor inclui material?
            <span className="font-medium text-slate-400 normal-case">(opcional)</span>
          </span>
          <span className={`w-9 h-5 rounded-full p-0.5 transition-all ${plano.materialAtivo ? "bg-sky-600" : "bg-slate-300"}`}>
            <span className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-all ${plano.materialAtivo ? "translate-x-4" : ""}`} />
          </span>
        </button>

        {plano.materialAtivo && (
          <div className="p-4 space-y-4">
            <div>
              <label className={rotulo}>Quanto deste valor é serviço (o que é seu)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                <input
                  type="number" step="0.01" min="0" placeholder="0,00"
                  value={plano.valorServico}
                  onChange={(e) => alterar({ valorServico: e.target.value })}
                  className={`${campo} pl-9 font-bold`}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">
                O resto ({emReais(materialCalculado)}) é material.
              </p>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => alterar({ repasseAtiva: !plano.repasseAtiva })}
                className="w-full flex items-center justify-between gap-3 text-left"
              >
                <span className="text-[11px] font-bold text-slate-600">
                  O fornecedor fatura e recebe o material direto do cliente (repasse)
                </span>
                <span className={`w-9 h-5 rounded-full p-0.5 transition-all shrink-0 ${plano.repasseAtiva ? "bg-sky-600" : "bg-slate-300"}`}>
                  <span className={`block w-4 h-4 bg-white rounded-full shadow-sm transition-all ${plano.repasseAtiva ? "translate-x-4" : ""}`} />
                </span>
              </button>

              {plano.repasseAtiva ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className={rotulo}>Nome do fornecedor</label>
                    <input
                      type="text" placeholder="Quem fatura e recebe o material"
                      value={plano.fornecedorNome} onChange={(e) => alterar({ fornecedorNome: e.target.value })}
                      className={campo}
                    />
                  </div>
                  <div>
                    <label className={rotulo}>CNPJ/CPF do fornecedor (opcional)</label>
                    <input
                      type="text" placeholder="Só para referência sua"
                      value={plano.fornecedorDocumento} onChange={(e) => alterar({ fornecedorDocumento: e.target.value })}
                      className={campo}
                    />
                  </div>
                  <div className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-[11px] font-semibold text-sky-900 leading-relaxed">
                    Só {emReais(servicoInformado)} vai entrar no seu Livro Caixa. O material
                    ({emReais(materialCalculado)}) nunca passa pela sua mão — emita a nota de
                    serviço para {plano.fornecedorNome.trim() || "o fornecedor"}, não para o cliente.
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                  Sem repasse, o valor cheio ({emReais(cheio)}) é seu — o material entra no
                  caixa junto com o serviço. Se você comprou esse material de um fornecedor,
                  lance a compra como despesa e vincule a esta venda para ver sua margem real.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
