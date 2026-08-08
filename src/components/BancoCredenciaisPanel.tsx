import React, { useState, useEffect, useCallback } from "react";
import {
  Landmark, X, Loader2, AlertTriangle, CheckCircle2, ShieldCheck,
  Trash2, ChevronRight, Lock, Info, Save,
} from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";

/**
 * ============================================================================
 * BANCO — onde cada usuário cadastra a conta que vai emitir os boletos DELE
 * ============================================================================
 *
 * POR QUE ESTA TELA EXISTE
 *
 * As credenciais do banco moravam em variáveis de ambiente do servidor. Isso
 * atende exatamente uma pessoa: o dono do sistema. Qualquer outro MEI que
 * emitisse um boleto emitiria na conta dele — e o dinheiro do cliente cairia
 * no banco de outra pessoa. É o mesmo motivo pelo qual o certificado digital
 * saiu da variável de ambiente e virou upload: sistema que se vende precisa
 * que cada usuário traga o que é dele.
 *
 * ----------------------------------------------------------------------------
 * O SEGREDO NÃO VOLTA — E ISSO É DE PROPÓSITO
 *
 * O servidor devolve um RESUMO: qual banco, qual ambiente, quando foi
 * cadastrado, e as pontas do identificador para a pessoa reconhecer. O Client
 * Secret nunca volta, nem para o dono. Por isso o campo aparece vazio quando
 * já existe algo guardado, com a legenda "deixe em branco para manter" — se
 * ele voltasse preenchido, bastaria uma captura de tela para vazar.
 *
 * ----------------------------------------------------------------------------
 * A LISTA DE BANCOS VEM DO SERVIDOR, NÃO DAQUI
 *
 * Cada banco fala uma língua diferente, e o sistema só sabe conversar com
 * alguns. Se a lista morasse nesta tela, um dia ela ofereceria um banco que o
 * servidor não sabe operar, e o usuário descobriria isso na hora de cobrar o
 * cliente. Vindo do servidor, o que a tela oferece é sempre o que o sistema
 * cumpre — e os que ainda não emitem aparecem dizendo isso, em vez de
 * fingirem que funcionam.
 */

interface Props {
  triggerToast?: (msg: string) => void;
  /** Abre a gaveta a partir de fora (por exemplo, de um aviso em Cobranças). */
  abrirExterno?: boolean;
  onFechado?: () => void;
  /** Renderiza só a gaveta, sem o cartão da Home. */
  semCartao?: boolean;
  /** Avisa quem cuida das cobranças que a conta mudou. */
  onAtualizado?: () => void;
}

type Provedor = {
  id: string;
  nome: string;
  emiteBoleto: boolean;
  situacao: string;
  campos: { credenciais: string[]; conta: string[] };
};

type Resumo = {
  cadastrado: boolean;
  provedor?: string;
  provedorNome?: string;
  emiteBoleto?: boolean;
  ambiente?: "homologacao" | "producao";
  identificacao?: string;
  temSegredo?: boolean;
  banco?: string;
  agencia?: string;
  conta?: string;
  convenio?: string;
  carteira?: string;
  cedente?: string;
  chavePix?: string;
  observacoes?: string;
  cadastradoEm?: string;
  atualizadoEm?: string;
};

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

const dataHoraBR = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/** Rótulos dos campos de conta, num lugar só. */
const ROTULOS: Record<string, { label: string; dica?: string }> = {
  banco: { label: "Banco", dica: "Nome ou código, como aparece no seu contrato" },
  agencia: { label: "Agência" },
  conta: { label: "Conta" },
  convenio: { label: "Convênio de cobrança", dica: "O número que o banco informa ao liberar a cobrança" },
  carteira: { label: "Carteira" },
  cedente: { label: "Beneficiário", dica: "O nome que sai no boleto, como está no banco" },
  chavePix: { label: "Chave Pix" },
};

const vazio = {
  provedor: "efi",
  ambiente: "producao" as "producao" | "homologacao",
  clientId: "",
  clientSecret: "",
  banco: "",
  agencia: "",
  conta: "",
  convenio: "",
  carteira: "",
  cedente: "",
  chavePix: "",
  observacoes: "",
};

export default function BancoCredenciaisPanel({
  triggerToast,
  abrirExterno,
  onFechado,
  semCartao,
  onAtualizado,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [provedores, setProvedores] = useState<Provedor[]>([]);
  const [cofreDisponivel, setCofreDisponivel] = useState(true);
  const [resumo, setResumo] = useState<Resumo>({ cadastrado: false });
  const [form, setForm] = useState({ ...vazio });

  const provedorAtual = provedores.find((p) => p.id === form.provedor) || null;

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const h = await comToken();
      const [rProv, rCred] = await Promise.all([
        fetch(getApiUrl("/api/banco/provedores"), { headers: h }),
        fetch(getApiUrl("/api/banco/credenciais"), { headers: h }),
      ]);

      const dProv = await rProv.json();
      if (dProv?.success) {
        setProvedores(dProv.provedores || []);
        setCofreDisponivel(dProv.cofreDisponivel !== false);
      }

      const dCred = await rCred.json();
      if (dCred?.success) {
        setResumo(dCred);
        // O formulário começa com o que já está guardado — menos os segredos,
        // que o servidor não devolve.
        setForm({
          ...vazio,
          provedor: dCred.provedor || "efi",
          ambiente: dCred.ambiente || "producao",
          banco: dCred.banco || "",
          agencia: dCred.agencia || "",
          conta: dCred.conta || "",
          convenio: dCred.convenio || "",
          carteira: dCred.carteira || "",
          cedente: dCred.cedente || "",
          chavePix: dCred.chavePix || "",
          observacoes: dCred.observacoes || "",
        });
      } else if (rCred.status === 401) {
        setErro("Faça login para ver as credenciais do seu banco.");
      }
    } catch (e: any) {
      setErro(e?.message || "Não foi possível carregar.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (abrirExterno) setAberto(true);
  }, [abrirExterno]);

  const fechar = () => {
    setAberto(false);
    onFechado?.();
  };

  const salvar = async () => {
    // A validação de verdade é no servidor — esta aqui só evita a viagem à toa
    // e a mensagem genérica que voltaria dela.
    if (!resumo.temSegredo && (!form.clientId.trim() || !form.clientSecret.trim())) {
      setErro("Informe o identificador e o segredo que o seu banco forneceu.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/banco/credenciais"), {
        method: "PUT",
        headers: h,
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível guardar.");

      setResumo(d);
      // Limpa os segredos da memória da tela assim que saem daqui.
      setForm((f) => ({ ...f, clientId: "", clientSecret: "" }));
      triggerToast?.("Credenciais do banco guardadas com segurança.");
      onAtualizado?.();
    } catch (e: any) {
      setErro(e?.message || "Não foi possível guardar.");
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const h = await comToken();
      const r = await fetch(getApiUrl("/api/banco/credenciais"), { method: "DELETE", headers: h });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.mensagem || "Não foi possível remover.");
      setResumo({ cadastrado: false });
      setForm({ ...vazio });
      triggerToast?.("Credenciais removidas.");
      onAtualizado?.();
    } catch (e: any) {
      setErro(e?.message || "Não foi possível remover.");
    } finally {
      setSalvando(false);
    }
  };

  const campo = (
    chave: keyof typeof form,
    label: string,
    dica?: string,
    tipo: "text" | "password" = "text"
  ) => (
    <div key={chave}>
      <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
        {label}
      </label>
      <input
        type={tipo}
        value={String(form[chave] ?? "")}
        onChange={(e) => setForm((f) => ({ ...f, [chave]: e.target.value }))}
        autoComplete={tipo === "password" ? "new-password" : "off"}
        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
      />
      {dica && <p className="text-[10px] text-slate-400 mt-1">{dica}</p>}
    </div>
  );

  const cartao = (
    <button
      onClick={() => setAberto(true)}
      className="w-full bg-white p-6 rounded-3xl border border-slate-200/50 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all duration-300 flex items-center justify-between group"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 group-hover:scale-105 transition-transform">
          <Landmark className="w-6 h-6" />
        </div>
        <div className="text-left space-y-0.5">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            Banco
            {resumo.cadastrado && resumo.emiteBoleto && (
              <span className="inline-flex items-center gap-1 bg-emerald-100/60 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                <ShieldCheck className="w-2.5 h-2.5" /> Ativo
              </span>
            )}
            {resumo.cadastrado && !resumo.emiteBoleto && (
              <span className="inline-flex items-center gap-1 bg-amber-100/60 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                <Info className="w-2.5 h-2.5" /> Guardado
              </span>
            )}
          </h4>
          <p className="text-xs text-slate-400 font-medium">
            {resumo.cadastrado
              ? `${resumo.provedorNome} • cadastrado em ${dataHoraBR(resumo.cadastradoEm)}`
              : "Cadastre a conta que vai emitir os seus boletos"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs shrink-0 pl-2">
        {resumo.cadastrado ? "Ver" : "Cadastrar"}
        <ChevronRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
      </div>
    </button>
  );

  return (
    <div className="w-full">
      {!semCartao && cartao}

      {aberto && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end animate-fade-in">
          <div className="w-full max-w-2xl bg-slate-50 h-full overflow-y-auto relative">
            <div className="pt-safe bg-white border-b border-slate-100 px-6 pb-5 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                  <Landmark className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-xl text-slate-900 tracking-tight">Banco</h3>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                    A conta que emite os seus boletos
                  </p>
                </div>
              </div>
              <button
                onClick={fechar}
                className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Por que estamos pedindo isso. Sem esta explicação, a tela
                  parece burocracia; com ela, a pessoa entende que é a conta
                  DELA que vai receber. */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 flex gap-3">
                <Lock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-900/80 leading-relaxed">
                  O boleto que você emite precisa estar registrado numa conta bancária —
                  e essa conta tem que ser a sua, para o dinheiro do seu cliente cair no
                  seu banco. As credenciais ficam guardadas cifradas e não voltam para a
                  tela, nem para você: se precisar trocar, é só cadastrar de novo.
                </p>
              </div>

              {!cofreDisponivel && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 leading-relaxed">
                    O servidor está sem a chave de segurança, então ainda não é possível
                    guardar credenciais aqui. Avise o suporte antes de cadastrar.
                  </p>
                </div>
              )}

              {erro && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-900 leading-relaxed">{erro}</p>
                </div>
              )}

              {carregando ? (
                <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-xs font-medium">Carregando…</p>
                </div>
              ) : (
                <>
                  {resumo.cadastrado && (
                    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <p className="text-sm font-bold text-slate-800">
                          {resumo.provedorNome}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500">
                        Identificador {resumo.identificacao || "—"} • ambiente{" "}
                        {resumo.ambiente === "producao" ? "produção" : "homologação"}
                      </p>
                      <p className="text-xs text-slate-400">
                        Cadastrado em {dataHoraBR(resumo.cadastradoEm)}
                        {resumo.atualizadoEm && resumo.atualizadoEm !== resumo.cadastradoEm
                          ? ` • atualizado em ${dataHoraBR(resumo.atualizadoEm)}`
                          : ""}
                      </p>
                      {!resumo.emiteBoleto && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2 leading-relaxed">
                          Guardado com segurança. A emissão por este banco ainda depende de
                          uma integração que não está pronta — quando estiver, não será
                          preciso cadastrar nada de novo.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Banco */}
                  <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-4">
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                        Qual banco
                      </label>
                      <select
                        value={form.provedor}
                        onChange={(e) => setForm((f) => ({ ...f, provedor: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                      >
                        {provedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                            {p.emiteBoleto ? "" : " — ainda não emite"}
                          </option>
                        ))}
                      </select>
                      {provedorAtual && (
                        <p
                          className={`text-[11px] mt-2 leading-relaxed rounded-xl p-3 border ${
                            provedorAtual.emiteBoleto
                              ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                              : "text-amber-800 bg-amber-50 border-amber-200"
                          }`}
                        >
                          {provedorAtual.situacao}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                        Ambiente
                      </label>
                      <select
                        value={form.ambiente}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, ambiente: e.target.value as any }))
                        }
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
                      >
                        <option value="producao">Produção — cobra de verdade</option>
                        <option value="homologacao">Homologação — só para testar</option>
                      </select>
                      {/* Esta é a confusão nº 1 de quem cadastra: usar a chave de
                          teste achando que é a definitiva, e o boleto não ser pago. */}
                      <p className="text-[10px] text-slate-400 mt-1">
                        As chaves de teste não funcionam em produção, e vice-versa. Use o par
                        que o banco entregou para o ambiente escolhido aqui.
                      </p>
                    </div>
                  </div>

                  {/* Credenciais */}
                  <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-4">
                    <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
                      Credenciais
                    </h4>
                    {campo(
                      "clientId",
                      "Identificador (Client ID)",
                      resumo.temSegredo ? "Deixe em branco para manter o atual" : undefined
                    )}
                    {campo(
                      "clientSecret",
                      "Segredo (Client Secret)",
                      resumo.temSegredo
                        ? "Deixe em branco para manter o atual"
                        : "Nunca é mostrado de volta depois de guardado",
                      "password"
                    )}
                  </div>

                  {/* Dados do convênio — só os que o banco escolhido usa */}
                  {provedorAtual && provedorAtual.campos.conta.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-4">
                      <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
                        Dados da conta
                      </h4>
                      {provedorAtual.campos.conta.map((c) =>
                        campo(c as any, ROTULOS[c]?.label || c, ROTULOS[c]?.dica)
                      )}
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1.5">
                          Observações
                        </label>
                        <textarea
                          value={form.observacoes}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, observacoes: e.target.value }))
                          }
                          rows={2}
                          placeholder="Ex.: contato do gerente, número do protocolo do convênio"
                          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-none"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={salvar}
                      disabled={salvando || !cofreDisponivel}
                      className="flex-1 bg-indigo-600 text-white font-bold text-sm rounded-2xl py-3.5 flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {salvando ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {resumo.cadastrado ? "Salvar alterações" : "Guardar credenciais"}
                    </button>

                    {resumo.cadastrado && (
                      <button
                        onClick={apagar}
                        disabled={salvando}
                        className="w-12 h-12 rounded-2xl bg-white border border-red-200 text-red-600 flex items-center justify-center hover:bg-red-50 disabled:opacity-50 transition shrink-0"
                        title="Remover credenciais"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-4">
                    As credenciais são guardadas cifradas e usadas apenas para registrar as
                    suas cobranças. Nenhum outro usuário do sistema tem acesso a elas.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
