import React from "react";
import {
  LayoutDashboard, Users, BookOpen, FileText, Package,
  Building, Calendar, Receipt, X, Crown, Barcode, FolderArchive, Landmark, UserCog, Boxes,
  CalendarClock,
} from "lucide-react";

/**
 * ============================================================================
 * MENU LATERAL — a navegação sai do corpo da página e vem para cá
 * ============================================================================
 *
 * POR QUE ESTA TELA MUDOU
 *
 * A navegação morava dentro do conteúdo: oito botões numa fileira no topo da
 * Visão Geral, misturando coisas de naturezas diferentes — "Registrar Venda"
 * (ação que abre uma janelinha) ao lado de "Gerador Orçamentos" (ir para outra
 * tela) e de "Catálogo" (idem). Fileira longa demais para escolher rápido, e o
 * usuário precisava voltar para o início toda vez que quisesse trocar de tela,
 * porque só de lá dava para navegar. Três botões "Voltar para o Início"
 * existiam só por causa disso.
 *
 * Aqui a regra fica clara e vale para sempre:
 *   • MENU LATERAL   → para ONDE eu vou (telas)
 *   • TOPO DA TELA   → o que eu FAÇO ali (ações daquela tela)
 *
 * ----------------------------------------------------------------------------
 * ESTE COMPONENTE NÃO PENSA
 *
 * Ele recebe qual aba está ativa e avisa quando alguém clica. Quem guarda a
 * tela atual é o App — e isso não é preferência de estilo: é o que faz o botão
 * voltar do navegador continuar funcionando, porque existe UM lugar só que
 * decide qual tela aparece.
 */

export type TelaMeiFlow =
  | "home"
  | "clientes"
  | "financeiro"
  | "orcamentos"
  | "catalogo"
  | "cobrancas"
  | "notafiscal"
  | "arquivos"
  | "banco"
  | "usuarios"
  | "estoque"
  | "agendamentos";

/**
 * ============================================================================
 * PERMISSÕES — a estrutura já existe, a tela de cadastro virá depois
 * ============================================================================
 *
 * O plano é ter usuários por conta, criados com senha master, cada um vendo só
 * o que lhe cabe. Isso não muda nada no menu quando chegar — porque cada
 * serviço já é um CAMINHO próprio, e caminho se esconde com uma linha.
 *
 * Enquanto ninguém definir permissões, `undefined` quer dizer "pode tudo": o
 * dono da conta nunca fica trancado do próprio sistema por um campo que ainda
 * não existe no cadastro dele.
 *
 * ⚠️ Esconder no menu é a PRIMEIRA camada, não a única. A tela precisa conferir
 *    de novo antes de renderizar — senão basta o estado de navegação ficar
 *    velho, ou alguém chamar `irPara`, para o conteúdo aparecer para quem não
 *    deveria vê-lo.
 */
export type PermissoesUsuario = Partial<Record<TelaMeiFlow, boolean>>;

interface Props {
  ativa: TelaMeiFlow;
  onSelecionar: (tela: TelaMeiFlow) => void;

  /** Números ao lado de cada item. Ajudam a decidir sem entrar na tela. */
  totalClientes: number;
  totalLancamentos: number;

  planType?: "free" | "premium";
  onUpgrade?: () => void;

  /** Quando ausente, o usuário vê tudo. Ver o comentário de PermissoesUsuario. */
  permissoes?: PermissoesUsuario;

  /**
   * "mestre" é o dono da conta. Só ele gerencia usuários — e isso não é uma
   * permissão que se marque numa caixinha: é condição do papel.
   */
  papel?: "mestre" | "membro";

  /**
   * As duas ações que fazem dinheiro entrar.
   *
   * Ficam no topo do menu, e não junto da navegação, porque não são lugares —
   * são o trabalho. Antes moravam só na Visão Geral, o que obrigava a voltar
   * para lá toda vez que a pessoa quisesse emitir algo estando em outra tela.
   */
  onEmitirNota?: () => void;
  onEmitirBoleto?: () => void;

  /** Obrigações do MEI — são ações recorrentes, não telas. */
  onDas?: () => void;
  onDasn?: () => void;

  /** Rodapé: a empresa. */
  meiName?: string;
  cnpj?: string;
  onConfig?: () => void;

  /** No celular o menu é uma gaveta. No computador, fica sempre visível. */
  aberto?: boolean;
  onFechar?: () => void;
}

type ItemMenu = {
  id: TelaMeiFlow;
  rotulo: string;
  icone: any;
  contador?: number;
  /** Premium: mostra cadeado e leva para o upgrade em vez de abrir. */
  bloqueado?: boolean;
  /** Título do grupo em que o item entra. */
  grupo: "trabalho" | "cadastro" | "fiscal" | "empresa";
  /**
   * ⚠️ NEM TODO ITEM DO MENU É UMA TELA.
   *
   * Nota Fiscal e Cobranças já tinham painel próprio, que abre por cima e
   * funciona. Ao dar "caminho próprio" a eles eu criei uma SEGUNDA tela do
   * mesmo assunto — e as duas apareceram juntas: a de trás pedindo o
   * certificado que a da frente já mostrava cadastrado. Duplicar tela é pior
   * que não ter caminho.
   *
   * Com `acao`, o item continua sendo um item do menu — some por permissão
   * como qualquer outro — mas abre o painel que já existe em vez de navegar
   * para uma cópia dele.
   */
  acao?: () => void;
};

export default function Sidebar({
  ativa, onSelecionar, totalClientes, totalLancamentos,
  planType = "free", onUpgrade, permissoes, papel = "mestre", onEmitirNota, onEmitirBoleto, onDas, onDasn,
  meiName, cnpj, onConfig, aberto = false, onFechar,
}: Props) {
  /**
   * A lista como DADO, e não como um bloco visual repetido oito vezes.
   *
   * Acrescentar uma tela passa a ser uma linha aqui. E esconder um item por
   * regra de negócio é um campo, não um `{condição && (<button>…</button>)}`
   * envolvendo trinta linhas de JSX duplicado.
   */
  /**
   * ⚠️ O CADEADO AQUI É CONFORTO, NÃO TRAVA.
   *
   * Ele evita que a pessoa clique num botão que vai recusar — e só. Quem
   * realmente barra é o servidor, em plano.ts: as rotas de emitir nota, emitir
   * boleto, criar usuário e ler os documentos fiscais conferem o plano antes de
   * fazer qualquer coisa. Se um dia esta linha aqui sumir por descuido, o
   * sistema continua correto; só fica feio.
   *
   * A lista de quais recursos são do Premium é a mesma de plano.ts. Ela está
   * repetida aqui porque o menu precisa desenhar antes de a resposta do
   * servidor chegar — mas a rota /api/plano devolve essa lista, e é ela que
   * manda quando as duas discordarem.
   */
  const free = planType === "free";

  const TODOS: ItemMenu[] = [
    // O dia a dia
    { id: "home", rotulo: "Visão Geral", icone: LayoutDashboard, grupo: "trabalho" },
    { id: "orcamentos", rotulo: "Orçamentos", icone: FileText, grupo: "trabalho" },
    { id: "cobrancas", rotulo: "Cobranças e boletos", icone: Barcode, bloqueado: free, grupo: "trabalho", acao: onEmitirBoleto },
    { id: "financeiro", rotulo: "Livro Caixa", icone: BookOpen, contador: totalLancamentos, grupo: "trabalho" },
    { id: "estoque", rotulo: "Estoque", icone: Boxes, grupo: "trabalho" },

    // Cadastros
    { id: "clientes", rotulo: "Clientes", icone: Users, contador: totalClientes, grupo: "cadastro" },
    { id: "catalogo", rotulo: "Catálogo", icone: Package, bloqueado: free, grupo: "cadastro" },
    /*
      Fase 1 do agendamento: só cadastro (tipos de serviço + horários de
      atendimento), por isso mora em "Cadastros" por enquanto. Quando a Fase 3
      trouxer a agenda ao vivo (visitas confirmadas, "a caminho", etc.), este
      item deve migrar para o grupo "trabalho" — é lá que vive o dia a dia.
    */
    { id: "agendamentos", rotulo: "Agendamento", icone: CalendarClock, grupo: "cadastro" },

    // Fiscal — cada serviço com caminho próprio, e não empilhado numa tela só
    { id: "notafiscal", rotulo: "Nota fiscal", icone: Receipt, bloqueado: free, grupo: "fiscal", acao: onEmitirNota },
    { id: "arquivos", rotulo: "Arquivos Fiscais", icone: FolderArchive, bloqueado: free, grupo: "fiscal" },
    /*
      Banco NÃO leva cadeado.

      Cadastrar a conta é o passo que a pessoa dá ANTES de assinar, quando está
      decidindo se vale a pena. Trancar aqui seria pedir que ela pague para
      descobrir se o banco dela funciona. O que o gratuito não faz é EMITIR — e
      isso quem impede é a rota do boleto, não este item.
    */
    { id: "banco", rotulo: "Banco", icone: Landmark, grupo: "fiscal" },

    // Gestão de equipe é sempre exclusiva do dono — nem um membro com todas as
    // áreas marcadas entra aqui.
    { id: "usuarios", rotulo: "Usuários", icone: UserCog, bloqueado: free, grupo: "empresa" },
  ];

  /*
    Uma linha, e o serviço some do menu para quem não tem permissão. Era esse o
    ponto de dar caminho próprio a cada um: o que é tela, se esconde.
  */
  const itens = TODOS
    .filter((i) => permissoes?.[i.id] !== false)
    // Papel vem antes de permissão: gerenciar equipe não é área delegável.
    .filter((i) => i.id !== "usuarios" || papel === "mestre");

  const GRUPOS: { chave: ItemMenu["grupo"]; titulo: string }[] = [
    { chave: "trabalho", titulo: "" },
    { chave: "cadastro", titulo: "Cadastros" },
    { chave: "fiscal", titulo: "Fiscal" },
    { chave: "empresa", titulo: "Empresa" },
  ];

  const abrir = (item: ItemMenu) => {
    if (item.bloqueado) return onUpgrade?.();
    if (item.acao) item.acao();
    else onSelecionar(item.id);
    onFechar?.();
  };

  const conteudo = (
    <div className="flex flex-col h-full">
      {/*
        Os dois botões grandes de emitir saíram daqui.

        Com "Nota fiscal" e "Cobranças e boletos" abrindo os painéis direto do
        menu, eles viraram o mesmo comando escrito duas vezes na mesma coluna.
      */}
      <nav className="p-3 space-y-1">
        {GRUPOS.map(({ chave, titulo }) => {
          const doGrupo = itens.filter((i) => i.grupo === chave);
          if (!doGrupo.length) return null;
          return (
            <div key={chave} className={titulo ? "pt-3" : ""}>
              {titulo && (
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 px-3 pb-1.5">
                  {titulo}
                </p>
              )}
              <div className="space-y-1">
                {doGrupo.map((item) => {
          const Icone = item.icone;
          const ativo = ativa === item.id && !item.bloqueado && !item.acao;
          return (
            <button
              key={item.id}
              onClick={() => abrir(item)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                ativo
                  ? "bg-slate-900 text-white font-semibold shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {/*
                  Ícone com cor própria quando ativo. Detalhe pequeno que dá
                  contraste sem precisar de mais um fundo colorido na tela.
                */}
                <Icone className={`w-4 h-4 shrink-0 ${ativo ? "text-blue-400" : "text-slate-400"}`} />
                <span className="truncate">{item.rotulo}</span>
                {item.bloqueado && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
              </span>

              {typeof item.contador === "number" && item.contador > 0 && (
                /*
                  O número acompanha o estado do botão. Se ficasse com a mesma
                  cor sempre, pareceria colado por cima quando o item está ativo.
                */
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    ativo ? "bg-slate-800 text-blue-300" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.contador}
                </span>
              )}
            </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/*
        OBRIGAÇÕES — separadas de propósito.

        DAS e Declaração Anual não são telas: são deveres com prazo. Misturá-las
        com a navegação faria a pessoa procurá-las como se fossem seções, e
        deixá-las no meio dos botões da Visão Geral fazia elas sumirem no
        amontoado. Aqui ficam sempre à vista, sem competir com o resto.
      */}
      <div className="px-3 pt-4 pb-2">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 px-3 pb-2">
          Obrigações do MEI
        </p>
        <div className="space-y-1">
          <button
            onClick={() => { onDas?.(); onFechar?.(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all cursor-pointer"
          >
            <Receipt className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Guia mensal (DAS)</span>
          </button>
          <button
            onClick={() => { onDasn?.(); onFechar?.(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all cursor-pointer"
          >
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Declaração anual</span>
          </button>
        </div>
      </div>

      <div className="flex-1" />

      {/*
        A EMPRESA NO PÉ, E NÃO NO CABEÇALHO.

        Nome e CNPJ são identidade, não ação: a pessoa olha uma vez para
        conferir que está na conta certa. No topo, ocupavam o espaço mais caro
        da tela o tempo inteiro.
      */}
      {onConfig && (
        <button
          onClick={() => { onConfig(); onFechar?.(); }}
          className="m-3 p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 transition-all text-left flex items-center gap-2.5 cursor-pointer group"
          title="Dados da sua empresa"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-all">
            <Building className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-800 truncate">{meiName || "Sua empresa"}</p>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {cnpj || "CNPJ não cadastrado"}
            </p>
          </div>
        </button>
      )}

      {planType === "free" && onUpgrade && (
        <button
          onClick={() => { onUpgrade(); onFechar?.(); }}
          className="mx-3 mb-4 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          Conhecer o Premium
        </button>
      )}
    </div>
  );

  return (
    <>
      {/*
        No computador: coluna fixa, sempre visível.
        `shrink-0` impede o flexbox de espremer o menu quando a tabela ao lado
        for larga — sem isso, os rótulos quebram linha em telas apertadas.
      */}
      <aside className="hidden md:flex md:w-60 shrink-0 bg-white border-r border-slate-200/80 flex-col">
        <div className="sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto flex flex-col flex-1">
          {conteudo}
        </div>
      </aside>

      {/*
        No celular: gaveta. Empilhar o menu inteiro acima do conteúdo — que é o
        caminho mais simples — empurraria o painel financeiro para baixo da
        dobra, e a primeira coisa que a pessoa veria ao abrir o sistema seria
        uma lista de links.
      */}
      {aberto && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85%] bg-white h-full shadow-2xl flex flex-col animate-fade-in">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
              <span className="text-sm font-bold text-slate-800">Menu</span>
              <button
                onClick={onFechar}
                className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
                aria-label="Fechar menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{conteudo}</div>
          </div>
          <div className="flex-1 bg-slate-900/40 backdrop-blur-xs" onClick={onFechar} />
        </div>
      )}
    </>
  );
}
