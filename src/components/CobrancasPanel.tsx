import React, { useState, useEffect, useCallback } from "react";
import {
  Receipt, Plus, X, Loader2, AlertTriangle, CheckCircle2, Copy, ExternalLink,
  TrendingUp, Clock, AlertOctagon, Wallet, ChevronRight, RefreshCw, Search, Sparkles,
} from "lucide-react";
import { auth } from "../firebase";
import { montarAgenda, ordemDaAba } from "../utils/agendaCobrancas";
import { getApiUrl } from "../utils/nativeFile";
import { Cliente } from "../types";

/**
 * PAINEL DE COBRANÇAS — emitir boletos e acompanhar o que foi pago.
 *
 * Conversa com as rotas /api/cobrancas/painel e /api/efi/boleto, que rodam no
 * servidor. Toda chamada leva o token do Firebase: o back-end nunca aceita um
 * userId vindo do navegador.
 */

interface Props {
  clientes: Cliente[];
  planType?: "free" | "premium";
  onTriggerUpgrade?: () => void;
  triggerToast?: (msg: string) => void;
}

type Item = {
  id: string;
  cliente: string;
  valor: number;
  /**
   * ISO curto. O servidor sempre mandou, mas o tipo não declarava — então a
   * tela só tinha a data em texto (dd/mm/aaaa), que não serve para ordenar nem
   * para agrupar. A agenda precisa dela.
   */
  vencimento?: string;
  vencimentoBR: string;
  situacao: "pago" | "pendente" | "vencido" | "cancelado";
  diasParaVencer: number | null;
  diasEmAtraso: number;
  link: string;
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Token do usuário logado, exigido por todas as rotas de cobrança. */
async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

export default function CobrancasPanel({ clientes, planType = "free", onTriggerUpgrade, triggerToast }: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<any>(null);
  const [grupos, setGrupos] = useState<Record<string, Item[]>>({});
  const [aba, setAba] = useState<"pendente" | "vencido" | "pago">("pendente");
  const [busca, setBusca] = useState("");

  // Formulário de emissão
  const [emitindo, setEmitindo] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [clienteId, setClienteId] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [descricao, setDescricao] = useState("");
  const [gerado, setGerado] = useState<any>(null);
  const [modo, setModo] = useState<"avista" | "carne">("avista");
  const [parcelas, setParcelas] = useState(3);
  const [sincronizando, setSincronizando] = useState(false);

  // Endereço: só aparece quando o banco exige (boleto registrado em produção).
  const [pedirEndereco, setPedirEndereco] = useState(false);
  const [end, setEnd] = useState({ cep: "", logradouro: "", numero: "", bairro: "", cidade: "", uf: "" });
  const [buscandoCep, setBuscandoCep] = useState(false);

  /** Preenche o endereço pelo CEP, para o usuário digitar o mínimo. */
  const buscarCep = async (cepDigitado: string) => {
    const cep = cepDigitado.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (!d.erro) {
        setEnd((a) => ({
          ...a, cep,
          logradouro: d.logradouro || a.logradouro,
          bairro: d.bairro || a.bairro,
          cidade: d.localidade || a.cidade,
          uf: d.uf || a.uf,
        }));
      }
    } catch {
      /* sem internet ou CEP fora do ar: o usuário preenche à mão */
    } finally {
      setBuscandoCep(false);
    }
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(getApiUrl("/api/cobrancas/painel"), { headers: await comToken() });
      const d = await r.json();
      if (!d.success) throw new Error(d.mensagem || "Não foi possível carregar.");
      setResumo(d.resumo);
      setGrupos(d.grupos || {});
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (aberto) carregar();
  }, [aberto, carregar]);

  /**
   * Pergunta o status direto à Efí, em vez de esperar o aviso automático.
   * Webhook pode falhar ou nem ter sido cadastrado — isto sempre funciona.
   */
  const sincronizar = async () => {
    setSincronizando(true);
    setErro(null);
    try {
      const r = await fetch(getApiUrl("/api/efi/sincronizar"), {
        method: "POST",
        headers: await comToken(),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.mensagem || "Não foi possível sincronizar.");
      triggerToast?.(d.mensagem);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSincronizando(false);
    }
  };

  // Vencimento padrão: 7 dias à frente, que é o mais comum.
  useEffect(() => {
    if (!vencimento) {
      const d = new Date(Date.now() + 7 * 86400000);
      setVencimento(d.toISOString().slice(0, 10));
    }
  }, [vencimento]);

  const emitir = async (e: React.FormEvent) => {
    e.preventDefault();
    const valorNum = parseFloat(String(valor).replace(",", "."));
    if (!clienteId || !valorNum || valorNum <= 0 || !vencimento) {
      setErro("Preencha o cliente, o valor e a data de vencimento.");
      return;
    }
    setEmitindo(true);
    setErro(null);
    try {
      const carne = modo === "carne";
      const r = await fetch(getApiUrl(carne ? "/api/efi/carne" : "/api/efi/boleto"), {
        method: "POST",
        headers: await comToken(),
        body: JSON.stringify(
          carne
            ? {
                customerId: clienteId,
                valorTotal: valorNum,
                parcelas,
                primeiroVencimento: vencimento,
                descricao: descricao || undefined,
                ...(pedirEndereco ? { endereco: end } : {}),
              }
            : {
                customerId: clienteId,
                vencimento,
                itens: [{ nome: descricao || "Serviço prestado", valor: valorNum, quantidade: 1 }],
                mensagem: descricao || undefined,
                ...(pedirEndereco ? { endereco: end } : {}),
              }
        ),
      });
      const d = await r.json();
      if (!d.success) {
        // O banco exige endereço do pagador no boleto registrado.
        if (d.precisaEndereco) setPedirEndereco(true);
        throw new Error(d.mensagem || "Falha ao gerar o boleto.");
      }

      setGerado(d);
      setValor("");
      setDescricao("");
      triggerToast?.(modo === "carne"
        ? `✓ Carnê com ${d.parcelas} parcelas gerado!`
        : "✓ Boleto gerado com sucesso!");
      carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEmitindo(false);
    }
  };

  const copiar = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      triggerToast?.("Link copiado!");
    } catch {
      /* alguns navegadores bloqueiam; o usuário ainda pode abrir o link */
    }
  };

  const lista = (grupos[aba] || []).filter((i) =>
    busca ? String(i.cliente).toLowerCase().includes(busca.toLowerCase()) : true
  );

  const Tile = ({ rotulo, valor, cor, Icone }: any) => (
    <div className="bg-white border border-slate-200/60 rounded-2xl p-3.5 text-left">
      <div className="flex items-center gap-1.5 mb-1">
        <Icone className={`w-3.5 h-3.5 ${cor}`} />
        <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">{rotulo}</span>
      </div>
      <p className={`text-base font-extrabold tracking-tight ${cor}`}>{brl(valor)}</p>
    </div>
  );

  return (
    <div className="w-full">
      {/* CARD NA DASHBOARD */}
      <div
        onClick={() => (planType === "free" ? onTriggerUpgrade?.() : setAberto(true))}
        className="w-full bg-white p-6 rounded-3xl border border-slate-200/50 shadow-xs cursor-pointer hover:border-emerald-300 hover:shadow-md transition-all duration-300 flex items-center justify-between group"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100 group-hover:scale-105 transition-transform">
            <Receipt className="w-6 h-6" />
          </div>
          <div className="text-left space-y-0.5">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>Cobranças e Boletos</span>
              {planType === "free" ? (
                <span className="inline-flex items-center gap-1 bg-amber-100/60 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                  🔒 Premium
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-emerald-100/60 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                  Ativo
                </span>
              )}
            </h4>
            <p className="text-xs text-slate-400 font-medium">
              Emita boletos para seus clientes e acompanhe o que foi pago, o que vence e o que está atrasado.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-emerald-600 font-semibold text-xs shrink-0 pl-2">
          <span>{planType === "free" ? "Desbloquear" : "Abrir"}</span>
          <ChevronRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>

      {/* GAVETA */}
      {aberto && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end animate-fade-in">
          <div className="w-full max-w-2xl bg-slate-50 h-full overflow-y-auto relative">
            {/* Cabeçalho */}
            <div className="pt-safe bg-white border-b border-slate-100 px-6 pb-5 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100">
                  <Receipt className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-xl text-slate-900 tracking-tight">Cobranças</h3>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                    Boletos emitidos
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={sincronizar}
                  disabled={sincronizando}
                  className="w-9 h-9 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                  title="Conferir pagamentos"
                >
                  <RefreshCw className={`w-4 h-4 ${carregando || sincronizando ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => { setAberto(false); setShowForm(false); setGerado(null); }}
                  className="w-9 h-9 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {erro && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-start gap-3 text-red-700 text-xs text-left">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>{erro}</div>
                </div>
              )}

              {/* NÚMEROS */}
              {resumo && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Tile rotulo="Emitido" valor={resumo.emitido} cor="text-slate-800" Icone={Wallet} />
                    <Tile rotulo="Recebido" valor={resumo.recebido} cor="text-emerald-600" Icone={CheckCircle2} />
                    <Tile rotulo="A receber" valor={resumo.aReceber} cor="text-blue-600" Icone={Clock} />
                    <Tile rotulo="Vencido" valor={resumo.vencido} cor="text-rose-600" Icone={AlertOctagon} />
                  </div>

                  {resumo.emitido > 0 && (
                    <div className="bg-white border border-slate-200/60 rounded-2xl p-4 text-left">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                          Taxa de recebimento
                        </span>
                        <span className="text-sm font-extrabold text-slate-800">{resumo.taxaRecebimento}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(resumo.taxaRecebimento, 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2 font-medium">
                        De tudo que você emitiu, {resumo.taxaRecebimento}% já entrou.
                        {resumo.inadimplencia > 0 && ` Inadimplência: ${resumo.inadimplencia}%.`}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* BOTÃO EMITIR */}
              {!showForm && (
                <button
                  onClick={() => { setShowForm(true); setGerado(null); setErro(null); }}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  <Plus className="w-4 h-4" />
                  <span>Emitir boleto ou carnê</span>
                </button>
              )}

              {/* FORMULÁRIO */}
              {showForm && !gerado && (
                <form onSubmit={emitir} className="bg-white border border-slate-200/60 rounded-3xl p-5 space-y-3.5 text-left">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-slate-800">
                      {modo === "carne" ? "Novo carnê" : "Novo boleto"}
                    </h4>
                    <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-400 hover:text-slate-600 font-bold">
                      Cancelar
                    </button>
                  </div>

                  {/* À vista ou parcelado */}
                  <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
                    {([["avista", "À vista"], ["carne", "Parcelado"]] as const).map(([k, r]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setModo(k as any)}
                        className={`flex-1 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          modo === k ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                      Cliente *
                    </label>
                    <select
                      required
                      value={clienteId}
                      onChange={(e) => setClienteId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none focus:bg-white"
                    >
                      <option value="">Selecione um cliente cadastrado</option>
                      {clientes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}{c.documento ? ` — ${c.documento}` : ""}
                        </option>
                      ))}
                    </select>
                    {clientes.length === 0 && (
                      <p className="text-[9px] text-amber-600 font-bold mt-1">
                        Você ainda não tem clientes cadastrados. Cadastre um antes de emitir.
                      </p>
                    )}
                    <p className="text-[9px] text-slate-400 mt-1 font-medium">
                      O cliente precisa ter CPF ou CNPJ preenchido — é exigência do banco.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                        {modo === "carne" ? "Valor TOTAL (R$) *" : "Valor (R$) *"}
                      </label>
                      <input
                        required
                        type="text"
                        inputMode="decimal"
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        placeholder="150,00"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none focus:bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                        {modo === "carne" ? "1ª parcela *" : "Vencimento *"}
                      </label>
                      <input
                        required
                        type="date"
                        value={vencimento}
                        onChange={(e) => setVencimento(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none focus:bg-white"
                      />
                    </div>
                  </div>

                  {modo === "carne" && (
                    <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-3 space-y-2">
                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-emerald-800">
                        Número de parcelas
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range" min={2} max={24} step={1}
                          value={parcelas}
                          onChange={(e) => setParcelas(Number(e.target.value))}
                          className="flex-1 accent-emerald-600 cursor-pointer"
                        />
                        <span className="text-sm font-extrabold text-emerald-800 w-10 text-right">{parcelas}x</span>
                      </div>
                      {(() => {
                        const total = parseFloat(String(valor).replace(",", ".")) || 0;
                        const p = total > 0 ? total / parcelas : 0;
                        const baixo = p > 0 && p < 5;
                        return (
                          <p className={`text-[11px] font-bold ${baixo ? "text-rose-600" : "text-emerald-700"}`}>
                            {total > 0
                              ? baixo
                                ? `Parcela de ${brl(p)} — abaixo do mínimo de R$ 5,00. Reduza as parcelas.`
                                : `${parcelas} boletos de ${brl(p)}, um por mês.`
                              : "Digite o valor total acima para ver o valor de cada parcela."}
                          </p>
                        );
                      })()}
                      <p className="text-[9px] text-emerald-700/70 font-medium leading-relaxed">
                        O valor digitado é o <strong>total</strong> — ele é dividido entre as parcelas.
                        A data escolhida é o vencimento da primeira; as demais caem de mês em mês.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                      Descrição do serviço
                    </label>
                    <input
                      type="text"
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      placeholder="Ex: Consultoria de agosto"
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none focus:bg-white"
                    />
                  </div>

                  {pedirEndereco && (
                    <div className="pt-3 border-t border-slate-100 space-y-2.5">
                      <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 font-medium leading-relaxed">
                        O banco exige o endereço do cliente para registrar o boleto. Preencha uma
                        vez — fica salvo no cadastro dele para as próximas.
                      </p>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="relative">
                          <input
                            type="text" inputMode="numeric" placeholder="CEP"
                            value={end.cep}
                            onChange={(e) => setEnd({ ...end, cep: e.target.value })}
                            onBlur={(e) => buscarCep(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono"
                          />
                          {buscandoCep && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
                          )}
                        </div>
                        <input
                          type="text" placeholder="Número"
                          value={end.numero}
                          onChange={(e) => setEnd({ ...end, numero: e.target.value })}
                          className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                        <input
                          type="text" placeholder="UF" maxLength={2}
                          value={end.uf}
                          onChange={(e) => setEnd({ ...end, uf: e.target.value.toUpperCase() })}
                          className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none uppercase"
                        />
                      </div>

                      <input
                        type="text" placeholder="Rua / logradouro"
                        value={end.logradouro}
                        onChange={(e) => setEnd({ ...end, logradouro: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text" placeholder="Bairro"
                          value={end.bairro}
                          onChange={(e) => setEnd({ ...end, bairro: e.target.value })}
                          className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                        <input
                          type="text" placeholder="Cidade"
                          value={end.cidade}
                          onChange={(e) => setEnd({ ...end, cidade: e.target.value })}
                          className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={emitindo || clientes.length === 0}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wide"
                  >
                    {emitindo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{modo === "carne" ? "Gerando carnê..." : "Gerando boleto..."}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>{modo === "carne" ? `Gerar carnê ${parcelas}x` : "Gerar boleto"}</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* BOLETO GERADO */}
              {gerado && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-5 space-y-3 text-left">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <h4 className="text-sm font-extrabold">
                      {gerado.carneId ? "Carnê gerado!" : "Boleto gerado!"}
                    </h4>
                  </div>
                  <p className="text-xs text-emerald-700 font-medium">
                    {gerado.carneId
                      ? `${gerado.parcelas} parcelas de ${brl(gerado.valorParcela)}, totalizando ${brl(gerado.valorTotal)}. Envie o link do carnê para o seu cliente — todas as parcelas ficam nele.`
                      : `Valor de ${brl(gerado.valor)}. Envie o link abaixo para o seu cliente.`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copiar(gerado.link || gerado.pdf || "")}
                      className="flex-1 py-2.5 bg-white border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copiar link
                    </button>
                    <button
                      onClick={() => window.open(gerado.link || gerado.pdf, "_blank")}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Abrir boleto
                    </button>
                  </div>
                  <button
                    onClick={() => { setGerado(null); setShowForm(true); }}
                    className="w-full py-2 text-emerald-700 hover:text-emerald-900 text-xs font-bold cursor-pointer"
                  >
                    Emitir outro
                  </button>
                </div>
              )}

              {/* LISTA */}
              <div className="space-y-2.5">
                <div className="flex gap-1.5">
                  {([
                    ["pendente", "A vencer", grupos.pendente?.length || 0],
                    ["vencido", "Vencidos", grupos.vencido?.length || 0],
                    ["pago", "Pagos", grupos.pago?.length || 0],
                  ] as const).map(([chave, rotulo, qtd]) => (
                    <button
                      key={chave}
                      onClick={() => setAba(chave as any)}
                      className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                        aba === chave
                          ? "bg-slate-900 text-white"
                          : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {rotulo} {qtd > 0 && `(${qtd})`}
                    </button>
                  ))}
                </div>

                {(grupos[aba]?.length || 0) > 4 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por cliente"
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                )}

                {carregando && !resumo ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                    <p className="text-xs font-semibold">Carregando cobranças...</p>
                  </div>
                ) : lista.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-slate-200 rounded-2xl bg-white/40">
                    <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs text-slate-400 mt-2 font-semibold">
                      {resumo?.quantidade?.total === 0
                        ? "Nenhum boleto emitido ainda."
                        : "Nada nesta aba."}
                    </p>
                    {resumo?.quantidade?.total === 0 && (
                      <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto">
                        Emita o primeiro boleto no botão acima e ele aparece aqui.
                      </p>
                    )}
                  </div>
                ) : (
                  /*
                    ============================================================
                    AGENDA — mês, depois dia
                    ============================================================

                    Era uma pilha só. Com trinta boletos vira um paredão de
                    nomes em que ninguém acha nada, e o usuário viu isso
                    chegando: "vai começar a gerar histórico, vai ficar
                    bagunçado assim".

                    Ele citou a Cora, que agrupa por faixa de semana. Semana é
                    um corte arbitrário — ninguém pensa "o boleto da semana do
                    dia 13". Pensa em mês, e dentro do mês, em dia. Os dias
                    próximos aparecem por nome (Hoje, Amanhã, Ontem), que é como
                    a pessoa fala.
                  */
                  <div className="space-y-5">
                    {montarAgenda(lista, ordemDaAba(aba)).map((mes) => (
                      <div key={mes.chave} className="space-y-2">
                        <div className="flex items-baseline justify-between gap-2 sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-1.5 -mx-1 px-1 rounded-lg">
                          <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
                            {mes.rotulo}
                          </h4>
                          <span className="text-[10px] font-bold text-slate-400 shrink-0">
                            {mes.quantidade} boleto{mes.quantidade > 1 ? "s" : ""} · {brl(mes.total)}
                          </span>
                        </div>

                        {mes.dias.map((dia) => (
                          <div key={dia.chave} className="flex gap-2.5">
                            {/*
                              Coluna do dia à esquerda, como numa agenda de
                              papel: o olho desce pela data e para no dia certo.
                            */}
                            <div className="w-16 shrink-0 pt-3 text-right">
                              <p className={`text-[10px] font-extrabold uppercase tracking-wide ${
                                dia.ehHoje ? "text-emerald-600" : "text-slate-400"
                              }`}>
                                {dia.rotulo}
                              </p>
                              {dia.itens.length > 1 && (
                                <p className="text-[9px] text-slate-300 font-bold mt-0.5">{brl(dia.total)}</p>
                              )}
                            </div>

                            <div className={`flex-1 min-w-0 space-y-2 border-l-2 pl-2.5 ${
                              dia.ehHoje ? "border-emerald-300" : "border-slate-150"
                            }`}>
                              {dia.itens.map((it) => (
                                <div
                                  key={it.id}
                                  className="bg-white border border-slate-200/60 p-3 rounded-xl flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="text-left min-w-0">
                                    <p className="font-bold text-slate-800 truncate">{it.cliente}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                                      Vence {it.vencimentoBR}
                                      {it.situacao === "vencido" && (
                                        <span className="text-rose-600 font-bold"> · {it.diasEmAtraso} dias em atraso</span>
                                      )}
                                      {it.situacao === "pendente" && it.diasParaVencer === 0 && (
                                        <span className="text-amber-600 font-bold"> · vence hoje</span>
                                      )}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span
                                      className={`font-extrabold ${
                                        it.situacao === "pago" ? "text-emerald-600"
                                        : it.situacao === "vencido" ? "text-rose-600"
                                        : "text-slate-700"
                                      }`}
                                    >
                                      {brl(it.valor)}
                                    </span>
                                    {it.link && (
                                      <button
                                        onClick={() => window.open(it.link, "_blank")}
                                        className="w-8 h-8 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center text-slate-500 cursor-pointer"
                                        title="Abrir boleto"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
