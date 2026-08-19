import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Receipt, Plus, X, Loader2, AlertTriangle, CheckCircle2, Copy, ExternalLink,
  TrendingUp, Clock, AlertOctagon, Wallet, ChevronRight, ChevronDown, RefreshCw, Search, Sparkles,
  Trash2, CreditCard,
} from "lucide-react";
import { auth } from "../firebase";
import { montarAgenda, ordemDaAba } from "../utils/agendaCobrancas";
import { getApiUrl } from "../utils/nativeFile";
import { Cliente } from "../types";
import { simularRecebimentoCartao } from "../utils/taxasAsaas";

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
  /**
   * Avisa o aplicativo de que dinheiro entrou.
   *
   * ⚠️ SEM ISTO O SALDO DA TELA INICIAL NÃO MUDA. Os lançamentos são
   * carregados uma vez, quando o usuário entra. Quando o pagamento é
   * processado aqui — no servidor —, o aplicativo não fica sabendo, e o
   * faturamento continua mostrando o valor de antes até um F5. Foi
   * exatamente esse o relato: "o boleto já mostra como pago, mas não mudou o
   * saldo na tela inicial".
   */
  onRecebimento?: () => void;
  /**
   * Avisa o aplicativo de que uma cobrança mudou de status por aqui — pago,
   * vencido ou cancelado. A Central de Notificações busca o resumo de
   * boletos vencidos uma vez só, num componente à parte; sem este aviso, um
   * boleto cancelado aqui continuava aparecendo vencido no sino até a
   * próxima vez que o usuário entrasse no sistema.
   */
  onMudancaCobrancas?: () => void;
  /**
   * MODO PÁGINA — o painel deixa de ser gaveta e vira tela.
   *
   * Cada serviço passou a ter caminho próprio no menu lateral. Gaveta que abre
   * por cima faz sentido quando a ação é um desvio rápido; não faz quando
   * aquele é o destino. E a separação por tela é o que vai permitir ligar ou
   * desligar serviços por permissão de usuário: o que é uma tela pode ser
   * escondido de quem não deve ver.
   */
  modoPagina?: boolean;
  /**
   * Abre a gaveta a partir de fora — hoje, do botão "Emitir boleto" do menu
   * lateral. Mesma ideia já usada no painel de Nota Fiscal: o botão que a
   * pessoa procura fica onde ela olha, e o painel continua morando onde mora.
   */
  /** Renderiza só a gaveta, sem o cartão — quando o painel é aberto de fora. */
  semCartao?: boolean;
  abrirExterno?: boolean;
  onFechado?: () => void;
  /** Já entra com o formulário de emissão aberto, sem um clique a mais. */
  emitirDireto?: boolean;
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

export default function CobrancasPanel({
  clientes, planType = "free", onTriggerUpgrade, triggerToast, onRecebimento, onMudancaCobrancas,
  abrirExterno, onFechado, emitirDireto, modoPagina, semCartao,
}: Props) {

  /*
    Em modo página não há sobreposição nem largura travada: o painel ocupa o
    espaço do conteúdo, ao lado do menu. Fora dele, tudo continua exatamente
    como era — gaveta escura por cima, presa à direita.
  */
  const classeFora = modoPagina
    ? "w-full animate-fade-in"
    : "fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end animate-fade-in";
  const classeDentro = modoPagina
    ? "w-full bg-transparent"
    : "w-full max-w-2xl bg-slate-50 h-full overflow-y-auto relative";
  const [aberto, setAberto] = useState(false);

  /*
    Abertura vinda de fora. O plano gratuito continua caindo na tela de
    assinatura — a porta de entrada muda, a regra não.
  */
  useEffect(() => {
    if (!abrirExterno) return;
    if (planType === "free") return onTriggerUpgrade?.();
    setAberto(true);
    if (emitirDireto) setShowForm(true);
  }, [abrirExterno, emitirDireto, planType]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<any>(null);
  const [grupos, setGrupos] = useState<Record<string, Item[]>>({});
  const [aba, setAba] = useState<"pendente" | "vencido" | "pago">("pendente");
  const [busca, setBusca] = useState("");
  /** Id do boleto sendo cancelado agora — trava só o botão dele, não a tela toda. */
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  // Formulário de emissão
  const [emitindo, setEmitindo] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [clienteId, setClienteId] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [descricao, setDescricao] = useState("");
  const [gerado, setGerado] = useState<any>(null);
  const [modo, setModo] = useState<"avista" | "carne" | "cartao">("avista");
  const [parcelas, setParcelas] = useState(3);
  /** Parcelas do cartão — faixa diferente da do carnê (1 a 21, não 2 a 24 boletos mensais). */
  const [parcelasCartao, setParcelasCartao] = useState(1);
  /**
   * Só importa quando parcelasCartao > 1. Padrão da Asaas é `false`: o
   * dinheiro cai mês a mês, a cada ~32 dias, por parcela — sem taxa extra.
   * `true` pede a ANTECIPAÇÃO: tudo de uma vez, com uma taxa maior por isso.
   */
  const [antecipar, setAntecipar] = useState(false);
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

  /**
   * ⚠️ EM MODO PÁGINA NÃO EXISTE "ABRIR" — E ISSO QUASE PASSOU DESPERCEBIDO.
   *
   * A carga dos dados dependia de a gaveta ser aberta. Quando o painel virou
   * tela, `aberto` continua falso para sempre: a tela montava e NUNCA buscava
   * nada. O resultado enganava — em vez de erro, aparecia o estado de "ainda
   * não configurado": certificado pedindo upload, nenhum serviço cadastrado,
   * CNPJ em branco. O usuário viu isso e tentou cadastrar o certificado de
   * novo, que já estava lá.
   *
   * Regra que fica: quando um componente ganha um modo novo de aparecer, todo
   * efeito preso ao modo antigo precisa ser revisto. "Se abriu" virou "se está
   * à mostra".
   */
  useEffect(() => {
    if (aberto || modoPagina) carregar();
  }, [aberto, modoPagina, carregar]);

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

      /**
       * ⚠️ PENDÊNCIA NÃO PODE VIRAR MENSAGEM DE SUCESSO.
       *
       * O servidor agora avisa quando a cobrança foi paga mas alguma etapa não
       * pôde ser concluída — lançamento, comprovante ou nota fiscal. Antes
       * isso não existia e o usuário via "Tudo já estava em dia" enquanto o
       * faturamento não mexia e a nota não saía. Aqui a pendência aparece na
       * tela, escrita, e não some sozinha.
       */
      if (Array.isArray(d.pendencias) && d.pendencias.length) {
        setErro(
          d.pendencias
            .map((p: any) => `${p.cliente || p.id}: ${(p.falhas || []).join("; ")}`)
            .join(" — ")
        );
      }

      triggerToast?.(d.mensagem);
      await carregar();

      // Entrou dinheiro? O resto do aplicativo precisa saber.
      if ((d.pagas || 0) > 0) onRecebimento?.();
      // Qualquer status mudou (pago, vencido, cancelado)? O sino também precisa saber.
      if ((d.atualizadas || 0) > 0 || (d.pagas || 0) > 0) onMudancaCobrancas?.();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSincronizando(false);
    }
  };

  /**
   * CANCELA O BOLETO NO BANCO — não é só apagar da tela.
   *
   * ⚠️ Boleto pago não pode ser excluído por aqui: o servidor recusa antes de
   * chamar Efí/Asaas, porque cancelar não devolve o dinheiro que já entrou.
   * O botão nem aparece nessa situação (ver a lista mais abaixo).
   *
   * ⚠️ BANCO DIFERENTE DE QUEM EMITIU (status 428): o servidor tenta cancelar
   * sempre no banco que emitiu aquele boleto específico, não no que está
   * conectado hoje — quem trocou de banco tem cobranças antigas do outro. Sem
   * as credenciais de volta não dá para chamar a API dele. Para não travar
   * quem já foi lá e cancelou direto no painel do banco, oferecemos marcar
   * como cancelado só aqui — ver `/cancelar-local` em efi.ts.
   */
  const excluirBoleto = async (it: Item) => {
    if (!window.confirm(
      `Cancelar o boleto de ${it.cliente} (${brl(it.valor)})? Ele deixa de poder ser pago.`
    )) return;
    setExcluindoId(it.id);
    setErro(null);
    try {
      const r = await fetch(getApiUrl(`/api/efi/boleto/${encodeURIComponent(it.id)}`), {
        method: "DELETE",
        headers: await comToken(),
      });
      const d = await r.json();

      if (!d.success) {
        if (r.status === 428 && window.confirm(
          `${d.mensagem}\n\nVocê já cancelou este boleto direto no painel do banco? ` +
          `Posso só atualizar o registro aqui, sem falar com o banco de novo.`
        )) {
          const r2 = await fetch(getApiUrl(`/api/efi/boleto/${encodeURIComponent(it.id)}/cancelar-local`), {
            method: "POST",
            headers: await comToken(),
          });
          const d2 = await r2.json();
          if (!d2.success) throw new Error(d2.mensagem || "Não foi possível atualizar aqui.");
          triggerToast?.("✓ Marcado como cancelado.");
          await carregar();
          onMudancaCobrancas?.();
          return;
        }
        throw new Error(d.mensagem || "Não foi possível cancelar o boleto.");
      }

      triggerToast?.("✓ Boleto cancelado.");
      await carregar();
      onMudancaCobrancas?.();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setExcluindoId(null);
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
      const rota = modo === "carne" ? "/api/efi/carne" : modo === "cartao" ? "/api/efi/cartao" : "/api/efi/boleto";
      const corpo =
        modo === "carne"
          ? {
              customerId: clienteId,
              valorTotal: valorNum,
              parcelas,
              primeiroVencimento: vencimento,
              descricao: descricao || undefined,
              ...(pedirEndereco ? { endereco: end } : {}),
            }
          : modo === "cartao"
          ? {
              customerId: clienteId,
              valor: valorNum,
              vencimento,
              parcelas: parcelasCartao,
              mensagem: descricao || undefined,
              // Só o back-end decide se isso é aplicável (parcelasCartao > 1);
              // mandar sempre é inofensivo para à vista, ele ignora.
              antecipar,
            }
          : {
              customerId: clienteId,
              vencimento,
              itens: [{ nome: descricao || "Serviço prestado", valor: valorNum, quantidade: 1 }],
              mensagem: descricao || undefined,
              ...(pedirEndereco ? { endereco: end } : {}),
            };

      const r = await fetch(getApiUrl(rota), {
        method: "POST",
        headers: await comToken(),
        body: JSON.stringify(corpo),
      });
      const d = await r.json();
      if (!d.success) {
        // O banco exige endereço do pagador no boleto registrado.
        if (d.precisaEndereco) setPedirEndereco(true);
        throw new Error(d.mensagem || "Falha ao gerar a cobrança.");
      }

      setGerado(d);
      setValor("");
      setDescricao("");
      triggerToast?.(
        modo === "carne"
          ? `✓ Carnê com ${d.parcelas} parcelas gerado!`
          : modo === "cartao"
          ? d.parcelas > 1
            ? antecipar
              ? d.antecipacao?.solicitada
                ? `✓ Cobrança em ${d.parcelas}x gerada — antecipação pedida!`
                : `✓ Cobrança em ${d.parcelas}x gerada, mas a antecipação não pôde ser confirmada — veja abaixo.`
              : `✓ Cobrança em cartão gerada — ${d.parcelas}x no link!`
            : "✓ Cobrança em cartão gerada!"
          : "✓ Boleto gerado com sucesso!"
      );
      carregar();
      onMudancaCobrancas?.();
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
      {/* CARD NA DASHBOARD — some quando o painel é aberto pelo menu lateral */}
      {!semCartao && (
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
      )}

      {/* GAVETA */}
      {(aberto || modoPagina) && (
        <div className={classeFora}>
          <div className={classeDentro}>
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
                  onClick={() => { setAberto(false); setShowForm(false); setGerado(null); onFechado?.(); }}
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

                  {/* À vista, boleto parcelado (carnê) ou cartão de crédito */}
                  <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
                    {([
                      ["avista", "À vista"],
                      ["carne", "Boleto parcelado"],
                      ["cartao", "Cartão"],
                    ] as const).map(([k, r]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setModo(k as any)}
                        className={`flex-1 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                          modo === k ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {k === "cartao" && <CreditCard className="w-3 h-3" />}
                        {r}
                      </button>
                    ))}
                  </div>

                  {/*
                    A rota de cartão recusa quem não estiver com a Asaas conectada — mensagem clara
                    em vez de deixar o usuário só descobrir depois de preencher tudo.
                  */}
                  {modo === "cartao" && (
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed -mt-1">
                      O cliente recebe um link e digita o cartão numa página segura da Asaas — o MEI Flow
                      nunca vê o número do cartão. Disponível só para conta conectada via Asaas.
                    </p>
                  )}

                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                      Cliente *
                    </label>
                    <SeletorClienteCobranca clientes={clientes} value={clienteId} onChange={setClienteId} />
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
                        {modo === "carne" ? "Valor TOTAL (R$) *" : modo === "cartao" ? "Valor da venda (R$) *" : "Valor (R$) *"}
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

                  {/*
                    SIMULADOR DE VENDAS — o mesmo que a Asaas tem no painel dela, aqui dentro.

                    Taxa fixa + percentual descontados uma vez, sobre o valor total — nunca por
                    parcela. Tabela padrão publicada pela Asaas (ver utils/taxasAsaas.ts); a taxa
                    contratada da conta pode ser um pouco diferente, e o texto abaixo avisa isso.
                  */}
                  {modo === "cartao" && (
                    <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-3 space-y-2">
                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-indigo-800">
                        Parcelas oferecidas ao cliente
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range" min={1} max={21} step={1}
                          value={parcelasCartao}
                          onChange={(e) => setParcelasCartao(Number(e.target.value))}
                          className="flex-1 accent-indigo-600 cursor-pointer"
                        />
                        <span className="text-sm font-extrabold text-indigo-800 w-14 text-right">
                          {parcelasCartao === 1 ? "à vista" : `até ${parcelasCartao}x`}
                        </span>
                      </div>

                      {(() => {
                        const total = parseFloat(String(valor).replace(",", ".")) || 0;
                        if (total <= 0) {
                          return (
                            <p className="text-[11px] font-bold text-indigo-700">
                              Digite o valor da venda acima para ver quanto sobra líquido.
                            </p>
                          );
                        }
                        const sim = simularRecebimentoCartao(total, parcelasCartao);
                        return (
                          <div className="bg-white border border-indigo-100 rounded-xl p-2.5 space-y-1">
                            <p className="text-[11px] font-bold text-indigo-800">
                              {sim.parcelas === 1
                                ? `Cliente paga ${brl(total)} à vista.`
                                : `Cliente paga em até ${sim.parcelas}x de ${brl(sim.valorParcela)}.`}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Taxa estimada: {brl(sim.taxaFixa)} + {sim.taxaPercentual}% ={" "}
                              <span className="font-bold text-rose-600">{brl(sim.valorTaxas)}</span>
                            </p>
                            <p className="text-[12px] font-extrabold text-emerald-700">
                              Você recebe líquido: {brl(sim.valorLiquido)}
                            </p>
                          </div>
                        );
                      })()}

                      <p className="text-[9px] text-indigo-700/70 font-medium leading-relaxed">
                        Estimativa com a tabela padrão da Asaas — a taxa da sua conta pode ser um pouco
                        diferente. O cliente escolhe, na página de pagamento, quantas parcelas quer usar
                        (até este limite e até o que a bandeira do cartão dele permitir).
                      </p>

                      {/*
                        RECEBIMENTO: mês a mês (padrão, taxa menor) vs de uma vez (antecipação,
                        taxa maior). Só faz sentido quando é parcelado — à vista a Asaas já paga
                        no prazo mais curto que ela tem, não há "mês a mês" para adiantar.
                      */}
                      {parcelasCartao > 1 && (
                        <div className="pt-2 border-t border-indigo-100 space-y-1.5">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-indigo-800">
                            Quando você quer receber
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => setAntecipar(false)}
                              className={`text-[10px] font-bold rounded-xl py-2 px-2 border transition-colors ${
                                !antecipar
                                  ? "bg-indigo-600 border-indigo-600 text-white"
                                  : "bg-white border-indigo-200 text-indigo-700"
                              }`}
                            >
                              Mês a mês (padrão)
                            </button>
                            <button
                              type="button"
                              onClick={() => setAntecipar(true)}
                              className={`text-[10px] font-bold rounded-xl py-2 px-2 border transition-colors ${
                                antecipar
                                  ? "bg-indigo-600 border-indigo-600 text-white"
                                  : "bg-white border-indigo-200 text-indigo-700"
                              }`}
                            >
                              Tudo de uma vez
                            </button>
                          </div>
                          <p className="text-[9px] text-indigo-700/70 font-medium leading-relaxed">
                            {antecipar
                              ? "Antecipação: você recebe o valor de uma vez, logo após a venda, mas a taxa " +
                                "descontada é maior que a padrão. A gente pede a antecipação assim que a " +
                                "cobrança é gerada."
                              : "Padrão da Asaas: cada parcela cai separada, a cada ~32 dias, com a taxa " +
                                "normal (a mesma da simulação acima)."}
                          </p>
                        </div>
                      )}
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
                        <span>
                          {modo === "carne" ? "Gerando carnê..." : modo === "cartao" ? "Gerando cobrança..." : "Gerando boleto..."}
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>
                          {modo === "carne"
                            ? `Gerar carnê ${parcelas}x`
                            : modo === "cartao"
                            ? parcelasCartao > 1
                              ? `Gerar cobrança em até ${parcelasCartao}x`
                              : "Gerar cobrança em cartão"
                            : "Gerar boleto"}
                        </span>
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
                      {gerado.carneId ? "Carnê gerado!" : modo === "cartao" ? "Cobrança em cartão gerada!" : "Boleto gerado!"}
                    </h4>
                  </div>
                  <p className="text-xs text-emerald-700 font-medium">
                    {gerado.carneId
                      ? `${gerado.parcelas} parcelas de ${brl(gerado.valorParcela)}, totalizando ${brl(gerado.valorTotal)}. Envie o link do carnê para o seu cliente — todas as parcelas ficam nele.`
                      : modo === "cartao"
                      ? `Valor de ${brl(gerado.valor)}${gerado.parcelas > 1 ? `, em até ${gerado.parcelas}x` : " à vista"}. Envie o link abaixo — o cliente digita o cartão numa página segura da Asaas.`
                      : `Valor de ${brl(gerado.valor)}. Envie o link abaixo para o seu cliente.`}
                  </p>

                  {modo === "cartao" && gerado.parcelas > 1 && antecipar && (
                    <div
                      className={`rounded-xl p-2.5 text-[11px] font-medium leading-relaxed ${
                        gerado.antecipacao?.solicitada
                          ? "bg-emerald-100 border border-emerald-200 text-emerald-800"
                          : "bg-amber-50 border border-amber-200 text-amber-800"
                      }`}
                    >
                      {gerado.antecipacao?.solicitada
                        ? `Antecipação pedida — você recebe o valor de uma vez, sem esperar as parcelas caírem mês a mês.${
                            gerado.antecipacao?.valorLiquidoEstimado != null
                              ? ` Valor líquido estimado: ${brl(gerado.antecipacao.valorLiquidoEstimado)}.`
                              : ""
                          }`
                        : gerado.antecipacao?.aviso ||
                          gerado.antecipacao?.erro ||
                          "Não foi possível confirmar a antecipação automaticamente — a cobrança em si foi gerada normalmente."}
                    </div>
                  )}

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
                                    {/*
                                      Pago não cancela por aqui — o servidor recusaria de
                                      qualquer forma, mas nem oferecer o botão evita o
                                      usuário achar que "excluir" devolveria o dinheiro.
                                    */}
                                    {it.situacao !== "pago" && (
                                      <button
                                        onClick={() => excluirBoleto(it)}
                                        disabled={excluindoId === it.id}
                                        className="w-8 h-8 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 cursor-pointer disabled:opacity-50"
                                        title="Cancelar boleto"
                                      >
                                        {excluindoId === it.id
                                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          : <Trash2 className="w-3.5 h-3.5" />}
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

/* ============================================================================
   SELETOR DE CLIENTE — com busca por nome
   ============================================================================
   Um <select> comum vira inutilizável a partir de umas 20-30 opções: a pessoa
   tem que rolar lendo nome por nome. Aqui é um campo de busca que filtra a
   lista conforme digita, igual um combobox. Mesmo padrão usado em
   EstoquePanel.tsx — vale copiar de novo se aparecer o mesmo problema em
   outra tela.
*/

function SeletorClienteCobranca({
  clientes,
  value,
  onChange,
}: {
  clientes: Cliente[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selecionado = clientes.find((c) => c.id === value);

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, []);

  const termo = busca.trim().toLowerCase();
  const filtrados = termo ? clientes.filter((c) => c.nome.toLowerCase().includes(termo)) : clientes;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setAberto((a) => !a); setBusca(""); }}
        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none focus:bg-white text-left flex items-center justify-between gap-2 cursor-pointer"
      >
        <span className={selecionado ? "text-slate-800 truncate" : "text-slate-400 truncate"}>
          {selecionado ? `${selecionado.nome}${selecionado.documento ? ` — ${selecionado.documento}` : ""}` : "Selecione um cliente cadastrado"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                type="text"
                placeholder="Buscar por nome..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full pl-8 pr-2.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtrados.length === 0 ? (
              <p className="px-3.5 py-3 text-xs text-slate-400 text-center">Nenhum cliente encontrado.</p>
            ) : (
              filtrados.map((c) => (
                <div
                  key={c.id}
                  onClick={() => { onChange(c.id); setAberto(false); }}
                  className={`px-3.5 py-2 text-xs cursor-pointer hover:bg-emerald-50 ${c.id === value ? "bg-emerald-50 font-bold text-emerald-700" : "text-slate-700"}`}
                >
                  {c.nome}{c.documento ? ` — ${c.documento}` : ""}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
