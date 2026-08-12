import React, { useEffect, useState } from "react";
import { BellRing, X, ChevronRight, MessageCircle, Copy, CheckCheck, Clock } from "lucide-react";
import { Orcamento } from "../types";
import {
  tarefasDeHoje, rotuloDoPrazo, registrarContato, linkWhatsApp, PASSOS,
  type MensagensContato,
} from "../utils/reguaContato";
import { fetchOrcamentosFromFirebase, saveOrcamentoToFirebase } from "../firebase";

/**
 * ============================================================================
 * PAINEL DE ACOMPANHAMENTO — o lembrete que abre junto com o sistema
 * ============================================================================
 *
 * POR QUE ELE EXISTE
 *
 * A régua dos três contatos já existia dentro do funil, mas o usuário resumiu o
 * problema com precisão: "não basta apenas estar lá escrito". Um aviso que só
 * aparece quando alguém entra na tela certa é um aviso que não acontece. Este
 * painel vem junto com o sistema, todo dia, e fica até a tarefa ser resolvida.
 *
 * COMO ELE SE COMPORTA
 *
 * Abre encostado na lateral esquerda quando há alguém para contatar. Dá para
 * minimizar — vira uma bolinha com o número de pendências, sempre à mão. Cada
 * cliente atendido some da lista na hora, então ele esvazia sozinho conforme o
 * dia anda, e some por completo quando não há mais ninguém.
 *
 * ⚠️ MINIMIZAR É POR DIA, NÃO PARA SEMPRE.
 *
 * A escolha de fechar fica guardada com a data de hoje. Amanhã ele abre de
 * novo — que é o ponto do acompanhamento diário. Fechar para sempre seria o
 * mesmo que não ter o painel.
 *
 * ⚠️ E NADA É ENVIADO SOZINHO. O painel diz com quem falar e entrega o texto
 *    pronto; quem aperta o botão é uma pessoa. Régua automática vira spam no
 *    dia em que der defeito, e quem paga é a reputação do MEI.
 */

interface Props {
  /**
   * Os textos que o usuário escreveu para os três contatos. Vazio = usa o
   * padrão. Passa reto por aqui: este painel não decide redação, só mostra.
   */
  mensagens?: MensagensContato;
  userId: string;
  /** Avisa o resto do app quando um contato é registrado, para as telas recarregarem. */
  onAtualizou?: () => void;
  triggerToast?: (msg: string) => void;
}

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const hojeISO = () => new Date().toISOString().slice(0, 10);

export default function PainelAcompanhamento({ userId, onAtualizou, triggerToast, mensagens}: Props) {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);

  const chaveMinimizado = `meiflow_acompanhamento_minimizado_${userId || "anon"}`;

  // Se ele minimizou HOJE, respeita. Amanhã abre de novo.
  useEffect(() => {
    try {
      setAberto(localStorage.getItem(chaveMinimizado) !== hojeISO());
    } catch {
      setAberto(true);
    }
  }, [chaveMinimizado]);

  useEffect(() => {
    let vivo = true;
    if (!userId) { setCarregando(false); return; }
    fetchOrcamentosFromFirebase(userId)
      .then((lista) => { if (vivo) setOrcamentos(lista || []); })
      .catch(() => { /* sem nuvem, o painel simplesmente não aparece */ })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [userId]);

  const tarefas = tarefasDeHoje(orcamentos, undefined, mensagens);

  const minimizar = () => {
    setAberto(false);
    try { localStorage.setItem(chaveMinimizado, hojeISO()); } catch { /* sem espaço */ }
  };

  const abrir = () => {
    setAberto(true);
    try { localStorage.removeItem(chaveMinimizado); } catch { /* sem espaço */ }
  };

  /**
   * Registra o contato e tira o cliente da lista na hora.
   *
   * A lista é recalculada a partir dos próprios orçamentos, então não existe
   * um segundo estado para ficar desatualizado: marcou, sumiu.
   */
  const marcar = async (orc: Orcamento, etapa: number) => {
    const atualizado = registrarContato(
      { ...orc, atualizadoEm: new Date().toISOString() } as any,
      etapa
    ) as Orcamento;
    setOrcamentos((atual) => atual.map((o) => (o.id === orc.id ? atualizado : o)));
    setExpandido(null);
    try {
      await saveOrcamentoToFirebase(userId, atualizado);
      onAtualizou?.();
    } catch {
      triggerToast?.("⚠ Contato registrado aqui, mas não subiu para a nuvem.");
    }
    triggerToast?.(
      etapa >= PASSOS.length
        ? "✓ Último contato registrado. A bola está com o cliente."
        : `✓ Contato ${etapa} registrado. O próximo já está agendado.`
    );
  };

  const encerrar = async (orc: Orcamento) => {
    const atualizado = { ...orc, acompanhamentoEncerrado: true, atualizadoEm: new Date().toISOString() };
    setOrcamentos((atual) => atual.map((o) => (o.id === orc.id ? atualizado : o)));
    setExpandido(null);
    try { await saveOrcamentoToFirebase(userId, atualizado); onAtualizou?.(); } catch { /* já saiu da lista */ }
    triggerToast?.("✓ Não vou mais lembrar deste orçamento.");
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      triggerToast?.("✓ Mensagem copiada.");
    } catch {
      triggerToast?.("⚠ Não consegui copiar. Selecione o texto e copie à mão.");
    }
  };

  // Sem tarefas, o painel não existe. Silêncio é o estado correto quando não há
  // nada a fazer — caixa vazia na tela é ruído.
  if (carregando || tarefas.length === 0) return null;

  // ------------------------------------------------------------- minimizado
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={abrir}
        aria-label={`${tarefas.length} cliente(s) esperando retorno`}
        className="fixed left-4 bottom-24 sm:bottom-6 z-40 w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30 flex items-center justify-center cursor-pointer transition-colors"
      >
        <BellRing className="w-5 h-5" />
        <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-slate-900 text-white text-[11px] font-extrabold flex items-center justify-center border-2 border-white">
          {tarefas.length}
        </span>
      </button>
    );
  }

  // ----------------------------------------------------------------- aberto
  return (
    <div className="fixed left-0 bottom-0 sm:bottom-4 sm:left-4 z-40 w-full sm:w-[360px] max-h-[70vh] flex flex-col bg-white border border-slate-200 sm:rounded-2xl shadow-2xl overflow-hidden text-left animate-fade-in">
      <div className="px-4 py-3 bg-slate-900 text-white flex items-center gap-2 shrink-0">
        <BellRing className="w-4 h-4 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-wider">Acompanhar hoje</p>
          <p className="text-[10px] text-slate-400 font-medium truncate">
            {tarefas.length} proposta(s) esperando um retorno seu
          </p>
        </div>
        <button
          type="button"
          onClick={minimizar}
          title="Minimizar — volta amanhã"
          className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto divide-y divide-slate-100">
        {tarefas.map(({ orcamento: orc, contato }) => {
          const aberto = expandido === orc.id;
          const link = linkWhatsApp(orc.clienteTelefone, contato.mensagem);
          return (
            <div key={orc.id} className="text-left">
              {/*
                Fechado, cada linha é um resumo clicável. Aberto, mostra a
                mensagem inteira e os botões. Um cliente por vez, que foi o
                pedido: "assim vou conseguir acompanhar um por vez".
              */}
              <button
                type="button"
                onClick={() => setExpandido(aberto ? null : orc.id)}
                className="w-full px-4 py-3 flex items-start gap-2.5 hover:bg-slate-50 transition-colors cursor-pointer text-left"
              >
                <span className={`shrink-0 mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-extrabold ${
                  contato.diasDeAtraso > 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                }`}>
                  {contato.etapa}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-slate-800 truncate">{orc.clienteNome}</span>
                  <span className="block text-[10px] text-slate-400 font-medium mt-0.5">
                    {rotuloDoPrazo(contato)} · {brl(Number(orc.total) || 0)}
                  </span>
                </span>
                <ChevronRight className={`w-4 h-4 text-slate-300 shrink-0 mt-0.5 transition-transform ${aberto ? "rotate-90" : ""}`} />
              </button>

              {aberto && (
                <div className="px-4 pb-4 space-y-2.5">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    {contato.titulo}
                  </p>
                  <p className="text-[11px] text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3">
                    {contato.mensagem}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1 cursor-pointer"
                      >
                        <MessageCircle className="w-3 h-3" /> WhatsApp
                      </a>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">Sem telefone no cadastro</span>
                    )}
                    <button
                      type="button"
                      onClick={() => copiar(contato.mensagem)}
                      className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => marcar(orc, contato.etapa)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCheck className="w-3 h-3" /> Já falei
                    </button>
                  </div>

                  {/*
                    Marcar contato fora de ordem.

                    O caminho normal é o botão acima, que registra o contato da
                    vez. Mas acontece de o usuário ter falado com o cliente por
                    fora e estar em outro ponto da régua — sem isto, ele teria
                    que marcar os anteriores um a um só para chegar ao certo.
                  */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      Já tinha feito:
                    </span>
                    {PASSOS.map((p) => (
                      <button
                        key={p.etapa}
                        type="button"
                        onClick={() => marcar(orc, p.etapa)}
                        title={p.titulo}
                        className={`w-6 h-6 rounded-lg border text-[10px] font-extrabold cursor-pointer transition-colors ${
                          p.etapa === contato.etapa
                            ? "bg-amber-50 border-amber-300 text-amber-700"
                            : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
                        }`}
                      >
                        {p.etapa}
                      </button>
                    ))}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => encerrar(orc)}
                      className="text-[10px] text-slate-400 hover:text-slate-700 font-bold cursor-pointer flex items-center gap-1"
                      title="Para de lembrar deste orçamento"
                    >
                      <Clock className="w-3 h-3" /> Não lembrar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
