import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText, X, Loader2, AlertTriangle, CheckCircle2, ShieldCheck, Upload,
  Trash2, ChevronRight, Lock, RefreshCw, CalendarClock, ExternalLink,
  Search, Plus, Star,
} from "lucide-react";
import { auth } from "../firebase";
import { getApiUrl } from "../utils/nativeFile";
import {
  buscarServicos, formatarCodigoServico, descricaoDoCodigo, ServicoNacional,
} from "../data/servicosNfse";

/**
 * NOTA FISCAL — certificado digital A1 e dados fiscais do MEI.
 *
 * ----------------------------------------------------------------------------
 * POR QUE O CERTIFICADO SOBE POR AQUI, E NÃO POR VARIÁVEL DE AMBIENTE
 *
 * Antes o certificado morava numa variável de ambiente da Vercel. Isso atende
 * exatamente um MEI: o dono do sistema. Para vender o MEI Flow para outros, cada
 * um precisa do seu — e ninguém vai mexer em painel de hospedagem. Aqui ele
 * escolhe o arquivo, digita a senha, e acabou.
 *
 * A senha NÃO fica guardada. Ela viaja uma vez, o servidor abre o arquivo com
 * ela, extrai o que precisa para assinar, cifra isso e joga a senha fora.
 *
 * ⚠️ O arquivo .pfx nunca é lido aqui no navegador além de virar base64. Toda
 *    validação é no servidor — validar no cliente seria teatro, já que qualquer
 *    um pode chamar a rota direto.
 */

interface Props {
  triggerToast?: (msg: string) => void;
  /** Abre a gaveta a partir de fora — usado pelo botão "Emitir Nota Fiscal" do topo. */
  abrirExterno?: boolean;
  /** Avisa quem abriu de fora que a gaveta fechou, para ele poder abrir de novo depois. */
  onFechado?: () => void;
  /**
   * Renderiza SÓ a gaveta, sem o cartão.
   *
   * A gaveta precisa existir em qualquer tela — o botão NFS-e do Livro Caixa
   * está numa tela, o cartão está em outra. Então o App monta duas vezes: o
   * cartão na Home (sem controle externo) e uma gaveta invisível fora de todas
   * as telas, que é a que os botões espalhados pelo sistema abrem.
   */
  semCartao?: boolean;
}

/** Um serviço que o usuário pré-configurou. O apelido é como ele chama. */
type ServicoConfig = {
  codigo: string;
  apelido: string;
  nbs: string;
  descricao: string;
  padrao: boolean;
};

type Cert = {
  configurado: boolean;
  titular?: string;
  cnpj?: string;
  validoAte?: string;
  diasRestantes?: number;
  alerta?: string | null;
  ambiente?: string;
};

async function comToken(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Você precisa estar logado.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

const dataBR = (iso?: string) =>
  iso ? iso.split("-").reverse().join("/") : "—";

const cnpjBR = (v?: string) => {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length !== 14) return v || "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

export default function NotaFiscalPanel({ triggerToast, abrirExterno, onFechado, semCartao }: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [cert, setCert] = useState<Cert | null>(null);

  // Envio do certificado
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement | null>(null);

  // Dados fiscais
  const [cnpj, setCnpj] = useState("");
  const [codMunicipio, setCodMunicipio] = useState("");
  const [servicos, setServicos] = useState<ServicoConfig[]>([]);
  const [serie, setSerie] = useState("");
  const [proximoNumero, setProximoNumero] = useState("");
  const [descricaoPadrao, setDescricaoPadrao] = useState("");
  const [emitirAoPagar, setEmitirAoPagar] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Busca de serviço
  const [buscandoServico, setBuscandoServico] = useState(false);
  const [termo, setTermo] = useState("");
  const [escolhido, setEscolhido] = useState<ServicoNacional | null>(null);
  const [apelidoNovo, setApelidoNovo] = useState("");
  const [descricaoNova, setDescricaoNova] = useState("");
  const resultados = buscarServicos(termo, 30);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const h = await comToken();
      const [rc, rcfg] = await Promise.all([
        fetch(getApiUrl("/api/nfse/certificado"), { headers: h }),
        fetch(getApiUrl("/api/nfse/config"), { headers: h }),
      ]);
      const dc = await rc.json();
      if (!rc.ok && !dc.configurado) throw new Error(dc.mensagem || "Não consegui ler o certificado.");
      setCert(dc);

      const dcfg = await rcfg.json();
      const c = dcfg.config;
      if (c) {
        setCnpj(c.cnpj || "");
        setCodMunicipio(c.codMunicipio || "");
        // Quem configurou antes desta tela tinha um código só, solto. Viramos
        // ele num serviço da lista para ninguém perder configuração.
        const lista: ServicoConfig[] = Array.isArray(c.servicos) && c.servicos.length
          ? c.servicos.map((s: any) => ({
              codigo: String(s.codigo || ""),
              apelido: String(s.apelido || ""),
              nbs: String(s.nbs || ""),
              descricao: String(s.descricao || ""),
              padrao: s.padrao === true,
            }))
          : c.codigoServico
            ? [{
                codigo: String(c.codigoServico),
                apelido: descricaoDoCodigo(c.codigoServico).slice(0, 40) || "Meu serviço",
                nbs: String(c.codigoNbs || ""),
                descricao: String(c.descricaoPadrao || ""),
                padrao: true,
              }]
            : [];
        setServicos(lista);
        setSerie(c.serie || "");
        setProximoNumero(String(dcfg.proximoNumero || 1));
        setDescricaoPadrao(c.descricaoPadrao || "");
        setEmitirAoPagar(c.emitirAoPagar !== false);
      } else {
        setProximoNumero("1");
      }
      if (!c && dc.cnpj) {
        // Primeira vez: o CNPJ já veio dentro do certificado, não faz sentido
        // pedir de novo.
        setCnpj(dc.cnpj);
      }
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (aberto) carregar();
  }, [aberto, carregar]);

  // O botão do topo levanta a bandeira; aqui a gaveta responde.
  useEffect(() => {
    if (abrirExterno) setAberto(true);
  }, [abrirExterno]);

  function fechar() {
    setAberto(false);
    onFechado?.();
  }

  /** Converte o arquivo escolhido em base64 para viajar dentro do JSON. */
  function lerBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || "").replace(/^data:[^,]*,/, ""));
      r.onerror = () => reject(new Error("Não consegui ler o arquivo."));
      r.readAsDataURL(f);
    });
  }

  async function enviarCertificado(e: React.FormEvent) {
    e.preventDefault();
    if (!arquivo) return setErro("Escolha o arquivo do seu certificado.");
    setEnviando(true);
    setErro(null);
    setAviso(null);
    try {
      const arquivoBase64 = await lerBase64(arquivo);
      const r = await fetch(getApiUrl("/api/nfse/certificado"), {
        method: "POST",
        headers: await comToken(),
        body: JSON.stringify({ arquivoBase64, senha }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.mensagem || "Não consegui guardar o certificado.");

      setCert({ ...d, configurado: true });
      setSenha("");
      setArquivo(null);
      setTrocando(false);
      if (inputArquivo.current) inputArquivo.current.value = "";
      if (!cnpj && d.cnpj) setCnpj(d.cnpj);
      if (d.alerta) setAviso(d.alerta);
      triggerToast?.("Certificado digital configurado.");
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function removerCertificado() {
    if (!window.confirm("Remover seu certificado digital? Você para de emitir notas até enviar outro.")) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(getApiUrl("/api/nfse/certificado"), {
        method: "DELETE",
        headers: await comToken(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.mensagem || "Não consegui remover.");
      setCert({ configurado: false });
      setTrocando(false);
      triggerToast?.("Certificado removido.");
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  function adicionarServico() {
    if (!escolhido) return;
    if (servicos.some((s) => s.codigo === escolhido.c)) {
      setErro("Esse serviço já está na sua lista.");
      return;
    }
    setServicos([
      ...servicos,
      {
        codigo: escolhido.c,
        // Sem apelido, o nome oficial serve — mas cortado, senão vira parágrafo.
        apelido: (apelidoNovo.trim() || escolhido.d).slice(0, 60),
        nbs: "",
        descricao: descricaoNova.trim(),
        padrao: servicos.length === 0,
      },
    ]);
    setEscolhido(null);
    setApelidoNovo("");
    setDescricaoNova("");
    setTermo("");
    setBuscandoServico(false);
    setErro(null);
  }

  function removerServico(codigo: string) {
    const resto = servicos.filter((s) => s.codigo !== codigo);
    // Se o habitual saiu, alguém precisa assumir o posto.
    if (resto.length && !resto.some((s) => s.padrao)) resto[0].padrao = true;
    setServicos(resto);
  }

  function marcarHabitual(codigo: string) {
    setServicos(servicos.map((s) => ({ ...s, padrao: s.codigo === codigo })));
  }

  async function salvarConfig(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(getApiUrl("/api/nfse/config"), {
        method: "PUT",
        headers: await comToken(),
        body: JSON.stringify({
          cnpj, codMunicipio, serie, servicos,
          proximoNumero: Number(proximoNumero || 1), descricaoPadrao, emitirAoPagar,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.mensagem || "Não consegui salvar.");
      triggerToast?.("Dados fiscais salvos.");
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  const pronto = !!cert?.configurado;
  // Em produção cada clique gera documento fiscal de verdade. A tela precisa
  // dizer isso sem que o usuário tenha que lembrar de conferir.
  const emProducao = (cert?.ambiente || "").toLowerCase().startsWith("produ");
  const vencendo = pronto && typeof cert?.diasRestantes === "number" && cert.diasRestantes < 30;

  return (
    <div className="w-full">
      {/* ------------------------------------------------------ cartão fechado */}
      {!semCartao && (
      <button
        onClick={() => setAberto(true)}
        className="w-full bg-white p-6 rounded-3xl border border-slate-200/50 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all duration-300 flex items-center justify-between group"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 group-hover:scale-105 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
          <div className="text-left space-y-0.5">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              Nota Fiscal
              {pronto && !vencendo && (
                <span className="inline-flex items-center gap-1 bg-emerald-100/60 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                  <ShieldCheck className="w-2.5 h-2.5" /> Ativo
                </span>
              )}
              {vencendo && (
                <span className="inline-flex items-center gap-1 bg-amber-100/60 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                  <CalendarClock className="w-2.5 h-2.5" /> Vencendo
                </span>
              )}
            </h4>
            <p className="text-xs text-slate-400 font-medium">
              {pronto
                ? `Certificado válido até ${dataBR(cert?.validoAte)}`
                : "Configure seu certificado digital A1"}
            </p>
            {pronto && (
              <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-widest border ${
                emProducao
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-slate-100 text-slate-500 border-slate-200"
              }`}>
                {emProducao ? "Produção — notas valem de verdade" : "Homologação — notas de teste"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs shrink-0 pl-2">
          {pronto ? "Gerenciar" : "Configurar"}
          <ChevronRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
        </div>
      </button>
      )}

      {/* ------------------------------------------------------------- gaveta */}
      {aberto && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end animate-fade-in">
          <div className="w-full max-w-2xl bg-slate-50 h-full overflow-y-auto relative">
            <div className="pt-safe bg-white border-b border-slate-100 px-6 pb-5 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-xl text-slate-900 tracking-tight">Nota Fiscal</h3>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                    {cert?.ambiente || "Portal Nacional NFS-e"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={carregar}
                  disabled={carregando}
                  className="w-9 h-9 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${carregando ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={fechar}
                  className="w-9 h-9 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {pronto && emProducao && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-2xl text-red-800 text-xs text-left leading-relaxed">
                  <strong className="block mb-1">Você está em produção.</strong>
                  As notas emitidas daqui valem para a Receita. Cancelar uma NFS-e exige justificativa e
                  tem prazo, então confira valor e cliente antes de emitir.
                </div>
              )}
              {pronto && !emProducao && (
                <div className="bg-slate-100 border border-slate-200 p-4 rounded-2xl text-slate-600 text-xs text-left leading-relaxed">
                  <strong className="block mb-1">Ambiente de teste (homologação).</strong>
                  As notas daqui não existem para a Receita e não servem para o cliente. Servem para
                  conferir que tudo funciona antes de valer.
                </div>
              )}
              {erro && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-start gap-3 text-red-700 text-xs text-left">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span>{erro}</span>
                </div>
              )}
              {aviso && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3 text-amber-800 text-xs text-left">
                  <CalendarClock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>{aviso}</span>
                </div>
              )}

              {carregando && !cert && (
                <div className="flex justify-center py-10 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              )}

              {/* ------------------------------------------- certificado ativo */}
              {pronto && !trocando && (
                <div className="bg-white border border-slate-200/60 rounded-3xl p-5 text-left space-y-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                      vencendo
                        ? "bg-amber-50 text-amber-600 border-amber-100"
                        : "bg-emerald-50 text-emerald-600 border-emerald-100"
                    }`}>
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-800 truncate">{cert?.titular || "Certificado A1"}</p>
                      <p className="text-xs text-slate-400 font-medium">{cnpjBR(cert?.cnpj)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3.5">
                      <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Válido até</span>
                      <p className="text-sm font-extrabold text-slate-800 mt-1">{dataBR(cert?.validoAte)}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3.5">
                      <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Dias restantes</span>
                      <p className={`text-sm font-extrabold mt-1 ${vencendo ? "text-amber-600" : "text-slate-800"}`}>
                        {cert?.diasRestantes ?? "—"}
                      </p>
                    </div>
                  </div>

                  {vencendo && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                      Renove seu certificado A1 antes do vencimento. Depois que ele vence, o Portal Nacional
                      recusa qualquer nota — e a renovação leva alguns dias.
                    </p>
                  )}

                  <div className="flex gap-2.5">
                    <button
                      onClick={() => setTrocando(true)}
                      className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-2xl transition-colors cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide"
                    >
                      <Upload className="w-4 h-4" /> Substituir
                    </button>
                    <button
                      onClick={removerCertificado}
                      disabled={enviando}
                      className="py-3 px-4 bg-red-50 hover:bg-red-100 text-red-600 font-extrabold text-xs rounded-2xl transition-colors cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* ------------------------------------------ envio do certificado */}
              {(!pronto || trocando) && !carregando && (
                <form onSubmit={enviarCertificado} className="bg-white border border-slate-200/60 rounded-3xl p-5 space-y-4 text-left">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-slate-800">
                      {trocando ? "Substituir certificado" : "Enviar certificado digital"}
                    </h4>
                    {trocando && (
                      <button
                        type="button"
                        onClick={() => { setTrocando(false); setErro(null); }}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    É o mesmo arquivo que você usa no Portal Nacional: um <strong>.pfx</strong> ou <strong>.p12</strong>,
                    entregue pela certificadora junto com uma senha. Ele fica guardado cifrado no servidor, e a senha
                    não é gravada em lugar nenhum.
                  </p>

                  <div>
                    <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                      Arquivo do certificado
                    </label>
                    <input
                      ref={inputArquivo}
                      type="file"
                      accept=".pfx,.p12,application/x-pkcs12"
                      onChange={(e) => { setArquivo(e.target.files?.[0] || null); setErro(null); }}
                      className="mt-1.5 w-full text-xs text-slate-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-extrabold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 file:cursor-pointer cursor-pointer"
                    />
                    {arquivo && (
                      <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        {arquivo.name} ({Math.round(arquivo.size / 1024)} KB)
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                      Senha do certificado
                    </label>
                    <div className="relative mt-1.5">
                      <Lock className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        placeholder="A senha que a certificadora te deu"
                        autoComplete="off"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 focus:bg-white transition-colors"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={enviando || !arquivo}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {enviando ? "Conferindo..." : "Enviar certificado"}
                  </button>
                </form>
              )}

              {/* ------------------------------------------------ dados fiscais */}
              <form onSubmit={salvarConfig} className="bg-white border border-slate-200/60 rounded-3xl p-5 space-y-3.5 text-left">
                <h4 className="text-sm font-extrabold text-slate-800">Meus serviços</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Cadastre uma vez o que você faz, com o nome que você usa. Depois, para emitir uma nota,
                  é só escolher esse nome — nada de procurar código.
                </p>

                {servicos.length === 0 && !buscandoServico && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
                    Você ainda não cadastrou nenhum serviço. Sem isso o Portal não sabe o que você presta
                    e recusa a nota.
                  </p>
                )}

                {/* lista dos servicos ja cadastrados */}
                {servicos.map((s) => (
                  <div key={s.codigo} className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3.5 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => marcarHabitual(s.codigo)}
                      title={s.padrao ? "É o seu serviço habitual" : "Marcar como habitual"}
                      className={`mt-0.5 shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                        s.padrao
                          ? "bg-amber-100 text-amber-600 border border-amber-200"
                          : "bg-white text-slate-300 border border-slate-200 hover:text-amber-500"
                      }`}
                    >
                      <Star className={`w-4 h-4 ${s.padrao ? "fill-amber-500" : ""}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-slate-800 truncate">{s.apelido}</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        {formatarCodigoServico(s.codigo)} · {descricaoDoCodigo(s.codigo).slice(0, 60) || "código informado manualmente"}
                      </p>
                      {s.descricao && (
                        <p className="text-[10px] text-slate-500 mt-1 italic truncate">"{s.descricao}"</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removerServico(s.codigo)}
                      className="mt-0.5 shrink-0 w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {/* busca de servico novo */}
                {!buscandoServico ? (
                  <button
                    type="button"
                    onClick={() => { setBuscandoServico(true); setErro(null); }}
                    className="w-full py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs rounded-2xl transition-colors cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide"
                  >
                    <Plus className="w-4 h-4" /> Adicionar serviço
                  </button>
                ) : (
                  <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-3">
                    {!escolhido ? (
                      <>
                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            autoFocus
                            value={termo}
                            onChange={(e) => setTermo(e.target.value)}
                            placeholder="O que você faz? Ex.: energia solar, unha, aula, frete"
                            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 transition-colors"
                          />
                        </div>

                        {termo.trim().length > 0 && resultados.length === 0 && (
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Nada encontrado para "{termo}". Tente uma palavra mais simples — "solar" em vez de
                            "usina fotovoltaica", "cabelo" em vez de "hairstylist". Dá para buscar pelo número
                            também, se você já souber.
                          </p>
                        )}

                        <div className="max-h-72 overflow-y-auto space-y-1.5">
                          {resultados.map((r) => (
                            <button
                              key={r.c}
                              type="button"
                              onClick={() => { setEscolhido(r); setApelidoNovo(""); }}
                              className="w-full text-left bg-white border border-slate-200 hover:border-indigo-300 rounded-xl p-3 transition-colors cursor-pointer"
                            >
                              <p className="text-[11px] text-slate-700 leading-snug">{r.d}</p>
                              <p className="text-[10px] text-slate-400 font-bold mt-1">{formatarCodigoServico(r.c)}</p>
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => { setBuscandoServico(false); setTermo(""); }}
                          className="w-full py-2.5 text-slate-500 hover:text-slate-700 font-bold text-[11px] cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="bg-white border border-indigo-200 rounded-xl p-3">
                          <p className="text-[11px] text-slate-700 leading-snug">{escolhido.d}</p>
                          <p className="text-[10px] text-indigo-600 font-bold mt-1">{formatarCodigoServico(escolhido.c)}</p>
                        </div>

                        <div>
                          <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                            Como você chama esse serviço?
                          </label>
                          <input
                            autoFocus
                            value={apelidoNovo}
                            onChange={(e) => setApelidoNovo(e.target.value)}
                            placeholder="Ex.: Compensação de energia solar"
                            maxLength={60}
                            className="mt-1.5 w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 transition-colors"
                          />
                          <p className="text-[10px] text-slate-400 mt-1.5">
                            É esse nome que vai aparecer na hora de emitir a nota. Só você vê.
                          </p>
                        </div>

                        <div>
                          <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                            Texto que sai na nota (opcional)
                          </label>
                          <input
                            value={descricaoNova}
                            onChange={(e) => setDescricaoNova(e.target.value)}
                            placeholder="Ex.: Referente a compensacao de energia de usina fotovoltaica"
                            maxLength={300}
                            className="mt-1.5 w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 transition-colors"
                          />
                          <p className="text-[10px] text-slate-400 mt-1.5">
                            Se o lançamento tiver descrição própria, ela tem preferência sobre esta.
                          </p>
                        </div>

                        <div className="flex gap-2.5">
                          <button
                            type="button"
                            onClick={() => setEscolhido(null)}
                            className="px-4 py-3 bg-white border border-slate-200 text-slate-600 font-extrabold text-xs rounded-2xl cursor-pointer"
                          >
                            Voltar
                          </button>
                          <button
                            type="button"
                            onClick={adicionarServico}
                            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl transition-colors cursor-pointer uppercase tracking-wide"
                          >
                            Salvar serviço
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="h-px bg-slate-100 my-1" />

                <h4 className="text-sm font-extrabold text-slate-800">Dados da empresa</h4>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">CNPJ</label>
                    <input
                      value={cnpj}
                      onChange={(e) => setCnpj(e.target.value)}
                      placeholder="Ex.: 00000000000000"
                      inputMode="numeric"
                      className="mt-1.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 focus:bg-white transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Código do município</label>
                    <input
                      value={codMunicipio}
                      onChange={(e) => setCodMunicipio(e.target.value)}
                      placeholder="Ex.: 2925303"
                      inputMode="numeric"
                      maxLength={7}
                      className="mt-1.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                <details className="bg-slate-50 border border-slate-200/60 rounded-2xl px-4 py-3">
                  <summary className="text-[11px] font-extrabold text-slate-600 cursor-pointer">
                    Já emitia nota em outro sistema?
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Só mexa aqui se estiver migrando. A série do MEI Flow tem que ser sua, entre 1 e 49999.
                      Não copie a série da nota emitida no site do governo — as de 50000 a 79999 são reservadas
                      a ele e o Portal recusa.
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Série</label>
                        <input
                          value={serie}
                          onChange={(e) => setSerie(e.target.value)}
                          placeholder="Ex.: 00001"
                          inputMode="numeric"
                          maxLength={5}
                          className="mt-1.5 w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Próxima nota</label>
                        <input
                          value={proximoNumero}
                          onChange={(e) => setProximoNumero(e.target.value.replace(/\D/g, ""))}
                          placeholder="Ex.: 1"
                          inputMode="numeric"
                          className="mt-1.5 w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-400 transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                </details>

                <label className="flex items-start gap-3 bg-slate-50 border border-slate-200/60 rounded-2xl p-3.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={emitirAoPagar}
                    onChange={(e) => setEmitirAoPagar(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-xs text-slate-600 leading-relaxed">
                    <strong className="text-slate-800">Emitir nota automaticamente</strong> assim que o boleto for pago.
                    Se desmarcar, você emite quando quiser, na tela de cobranças.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={salvando}
                  className="w-full py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide disabled:opacity-50"
                >
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {salvando ? "Salvando..." : "Salvar dados fiscais"}
                </button>
              </form>

              {/* Rota de fuga: enquanto a emissão automática não estiver 100%, o
                  caminho manual continua a um clique de distância. */}
              <div className="bg-white border border-slate-200/60 rounded-3xl p-5 text-left">
                <h4 className="text-sm font-extrabold text-slate-800">Prefere emitir na mão?</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1.5">
                  O Emissor Nacional continua disponível. Abre em outra aba, sem sair do MEI Flow.
                </p>
                <button
                  type="button"
                  onClick={() => window.open("https://www.nfse.gov.br/EmissorNacional/Login", "_blank")}
                  className="mt-3.5 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-2xl transition-colors cursor-pointer flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  <ExternalLink className="w-4 h-4" /> Abrir o portal do governo
                </button>
              </div>

              <p className="text-[10px] text-slate-400 text-center leading-relaxed px-4">
                Seu certificado é guardado cifrado e usado somente para assinar as suas notas.
                Você pode removê-lo a qualquer momento.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
