import React from "react";
import { Menu, LogIn, LogOut, RefreshCw, Bell } from "lucide-react";

/**
 * ============================================================================
 * CABEÇALHO — enxuto de propósito
 * ============================================================================
 *
 * O QUE SAIU DAQUI, E POR QUÊ
 *
 * O cabeçalho carregava a marca, o nome da empresa, o CNPJ, um selo "Nuvem
 * Ativa" e o botão de sair. Cinco coisas ocupando a faixa mais cara da tela —
 * a única que fica visível o tempo inteiro, em todas as telas, para sempre.
 *
 *   • Nome e CNPJ desceram para o pé do menu lateral. São identidade, não
 *     ação: a pessoa confere uma vez que está na conta certa e segue a vida.
 *   • O selo "Nuvem Ativa" saiu inteiro. Ele dizia que estava tudo bem — e a
 *     ausência de aviso já diz isso. Indicador que nunca muda de estado é
 *     enfeite; quando a sincronização falhar, aí sim vale avisar, e aí o aviso
 *     terá o peso que merece por não competir com um selo verde permanente.
 *
 * Ficou o que a pessoa precisa em qualquer tela: saber onde está, abrir o menu
 * no celular, e sair da conta.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ RESISTA A ENCHER ISTO DE NOVO
 *
 * Toda ação nova parece merecer um lugar no topo. Quase nenhuma merece: o
 * lugar certo de uma ação é a tela onde ela é usada. Foi assim que o cabeçalho
 * chegou a cinco elementos da primeira vez.
 */

interface Props {
  logado: boolean;
  sincronizando?: boolean;
  onEntrar?: () => void;
  onSair?: () => void;
  /** Só aparece no celular, onde o menu lateral é uma gaveta. */
  onAbrirMenu?: () => void;
  mostrarMenu?: boolean;
  /** Quantidade de avisos pendentes na Central de Notificações — badge só aparece quando > 0. */
  notificacoesCount?: number;
  onAbrirNotificacoes?: () => void;
}

export default function Navbar({
  logado, sincronizando, onEntrar, onSair, onAbrirMenu, mostrarMenu,
  notificacoesCount, onAbrirNotificacoes,
}: Props) {
  return (
    // `sticky top-0` mantém o cabeçalho colado ao rolar. O z-40 fica acima do
    // conteúdo e abaixo das gavetas e janelas (z-50), que precisam cobri-lo.
    <header className="h-20 bg-white/95 backdrop-blur-sm border-b border-slate-200/80 sticky top-0 z-40 shrink-0">
      <div className="h-full max-w-[100rem] mx-auto px-4 md:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {mostrarMenu && (
            <button
              onClick={onAbrirMenu}
              className="md:hidden w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 cursor-pointer"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-md shrink-0">
            M
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-lg font-bold tracking-tight text-slate-900 leading-tight">MEI Flow</span>
            <span className="text-[11px] text-slate-400 font-medium truncate hidden sm:block">
              Gestão financeira e fiscal
            </span>
          </div>
        </div>

        {logado ? (
          <div className="flex items-center gap-2 shrink-0">
            {onAbrirNotificacoes && (
              <button
                onClick={onAbrirNotificacoes}
                className="relative w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer border border-slate-200"
                title="Notificações"
                aria-label="Notificações"
              >
                <Bell className="w-4 h-4" />
                {!!notificacoesCount && notificacoesCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[9px] font-extrabold flex items-center justify-center leading-none">
                    {notificacoesCount > 9 ? "9+" : notificacoesCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={onSair}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 px-3.5 font-bold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer border border-slate-200 shrink-0"
              title="Sair da conta"
            >
              <LogOut className="w-4 h-4 text-slate-500" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        ) : (
          <button
            onClick={onEntrar}
            disabled={sincronizando}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center gap-2 transition-all shadow-md shrink-0 cursor-pointer disabled:opacity-60"
          >
            {sincronizando
              ? <RefreshCw className="w-4 h-4 text-blue-100 animate-spin" />
              : <LogIn className="w-4 h-4 text-blue-100" />}
            <span>Acessar conta</span>
          </button>
        )}
      </div>
    </header>
  );
}
