/**
 * ============================================================================
 * PLANO FREE E PLANO PREMIUM — a regra, num lugar só
 * ============================================================================
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *
 * Até aqui, "o que é do Premium" estava escrito em quatro lugares diferentes:
 * no texto da tela de assinatura, no botão que a tela escondia, no cartão de
 * convite da Visão Geral e, uma única vez, no servidor (criar usuários). Os
 * três primeiros são CONFORTO: escondem o botão de quem não pagou. Nenhum
 * deles é TRAVA — quem souber o endereço da rota emite a nota do mesmo jeito,
 * porque o servidor nunca perguntou o plano de ninguém.
 *
 * A partir daqui a lista vive aqui, e é o SERVIDOR que confere. A tela lê esta
 * mesma lista pela rota /api/plano, então ela nunca mais promete uma coisa e o
 * servidor faz outra.
 *
 * ----------------------------------------------------------------------------
 * O QUE O GRATUITO FAZ — E ELE FAZ MUITA COISA
 *
 * Livro caixa, clientes, orçamento em PDF, funil de vendas, relatório de
 * faturamento, agenda de cobranças, mensagens de WhatsApp. Sem prazo, sem
 * "período de teste". É de propósito: é essa parte que faz o MEI entrar e
 * ficar. O que ele não faz é o que custa dinheiro para o sistema (certificado,
 * banco, armazenamento fiscal) ou o que só faz sentido para quem já faturou.
 *
 * ----------------------------------------------------------------------------
 * A MARCA D'ÁGUA
 *
 * Os PDFs do plano gratuito saem com a chancela "Gerado eletronicamente via
 * MEI Flow" no rodapé; os do Premium saem com o nome e a logo do próprio MEI.
 * Isso é decidido na hora de desenhar o PDF, no navegador — está em
 * orcamentoPdf.ts e no App.tsx (comprovante e relatório). Não é decidido aqui,
 * mas está anotado aqui para ninguém procurar em dois lugares.
 */

// ============================================================================
// A LISTA
// ============================================================================

export type Recurso =
  | "notafiscal"
  | "certificado"
  | "boleto"
  | "usuarios"
  | "arquivosfiscais"
  | "catalogo"
  | "logo";

/**
 * Cada recurso do Premium com o nome que o usuário vê e a frase que ele lê
 * quando esbarra na trava. A frase fica AQUI e não na rota, para o convite
 * chegar igual venha de onde vier.
 */
export const RECURSOS_PREMIUM: { id: Recurso; nome: string; convite: string }[] = [
  {
    id: "notafiscal",
    nome: "Emitir nota fiscal (NFS-e)",
    convite: "Emitir nota fiscal eletrônica é um recurso do plano Premium.",
  },
  {
    id: "certificado",
    nome: "Certificado digital A1",
    convite: "Guardar seu certificado digital A1 é um recurso do plano Premium.",
  },
  {
    id: "boleto",
    nome: "Emitir boleto e carnê",
    convite: "Emitir boleto pelo seu banco é um recurso do plano Premium.",
  },
  {
    id: "usuarios",
    nome: "Criar usuários para a equipe",
    convite: "Criar usuários para a sua equipe é um recurso do plano Premium.",
  },
  {
    id: "arquivosfiscais",
    nome: "Arquivos Fiscais na nuvem",
    convite: "Guardar seus documentos fiscais na nuvem é um recurso do plano Premium.",
  },
  {
    id: "catalogo",
    nome: "Catálogo de produtos e serviços",
    convite: "O catálogo de itens é um recurso do plano Premium.",
  },
  {
    id: "logo",
    nome: "PDF com sua logo, sem marca d'água",
    convite: "Usar sua própria logo nos documentos é um recurso do plano Premium.",
  },
];

/** O que o gratuito faz. Serve para a tela de assinatura e para o site. */
export const RECURSOS_GRATUITOS = [
  "Livro caixa completo, com entradas e saídas",
  "Cadastro de clientes sem limite",
  "Orçamentos em PDF (com a chancela do MEI Flow no rodapé)",
  "Funil de vendas e agenda de contatos",
  "Relatório de faturamento para o DASN",
  "Mensagens de cobrança pelo WhatsApp",
];

const CONVITE_POR_RECURSO = new Map(RECURSOS_PREMIUM.map((r) => [r.id, r.convite]));

/** A frase que a tela mostra quando o servidor recusa por causa do plano. */
export function convitePremium(recurso: Recurso): string {
  return CONVITE_POR_RECURSO.get(recurso) || "Este recurso é do plano Premium.";
}

// ============================================================================
// DE ONDE SAI O PLANO DE ALGUÉM
// ============================================================================

/**
 * ⚠️ TRÊS CAMPOS, NÃO UM.
 *
 * O perfil do usuário acumulou três jeitos de dizer a mesma coisa ao longo do
 * tempo: `planType`, o antigo `plan`, e `isPremium` (que o Mercado Pago
 * gravava). Tem cadastro em produção com só um dos três preenchido. Se aqui
 * eu olhasse apenas `planType`, um assinante antigo perderia o acesso que
 * pagou — que é um estrago pior do que deixar passar quem não pagou.
 *
 * O App.tsx já lê os três (linha do `docPlanValue`); esta função é a mesma
 * regra, do lado do servidor.
 */
export function ehPremiumPeloPerfil(dados: any): boolean {
  if (!dados) return false;
  if (dados.planType === "premium") return true;
  if (dados.plan === "premium") return true;
  if (dados.isPremium === true) return true;
  // `status: "active"` sozinho é a marca da assinatura ativa do Mercado Pago.
  if (dados.status === "active") return true;
  return false;
}

/**
 * ⚠️ O CACHE É POR EMPRESA. NUNCA GLOBAL.
 *
 * Esta é a quarta vez que este projeto guarda algo em memória entre as
 * chamadas — antes foram o certificado, o token de cobranças e o token do Pix.
 * Nas três, a primeira versão foi um valor solto, que na Vercel vale para o
 * processo INTEIRO: o segundo usuário a chamar a rota recebia a resposta do
 * primeiro. Aqui isso significaria um MEI gratuito herdando o Premium de outro
 * — ou, pior, um assinante sendo barrado.
 *
 * Por isso: chave é o identificador da empresa, e a validade é curta. Trinta
 * segundos só existem para não consultar o banco duas vezes dentro do mesmo
 * clique; passou disso, pergunta de novo. Quem acabou de pagar não fica
 * trancado do lado de fora esperando um cache expirar.
 */
const CACHE_TTL_MS = 30_000;
const cachePlano = new Map<string, { premium: boolean; em: number }>();

/** Esquece o que estava guardado. Chame depois de aprovar um pagamento. */
export function limparCachePlano(empresaId?: string) {
  if (empresaId) cachePlano.delete(empresaId);
  else cachePlano.clear();
}

/**
 * Descobre se a empresa é Premium.
 *
 * ⚠️ QUANDO O BANCO NÃO RESPONDE, A RESPOSTA É "PREMIUM".
 *
 * Parece errado e é de propósito. Se o Firestore piscar, a alternativa seria
 * recusar a emissão de todo mundo — inclusive de quem paga — e o usuário veria
 * "assine o Premium" já sendo assinante. Um sistema que acusa o cliente pagante
 * de caloteiro por causa de uma falha nossa perde o cliente. Deixar passar
 * alguns segundos de emissão indevida numa falha rara é o erro barato dos dois.
 */
export async function ehPremium(db: any, empresaId: string): Promise<boolean> {
  if (!empresaId) return false;

  const guardado = cachePlano.get(empresaId);
  if (guardado && Date.now() - guardado.em < CACHE_TTL_MS) return guardado.premium;

  let premium = true; // ver o aviso acima: a falha não pode barrar quem paga
  try {
    const perfil = await db.collection("users").doc(empresaId).get();
    if (perfil.exists) {
      premium = ehPremiumPeloPerfil(perfil.data());
    } else {
      // Coleção legada: contas antigas ainda vivem em `usuarios`.
      const legado = await db.collection("usuarios").doc(empresaId).get();
      premium = legado.exists ? ehPremiumPeloPerfil(legado.data()) : false;
    }
    cachePlano.set(empresaId, { premium, em: Date.now() });
  } catch (err: any) {
    console.error("[Plano] Não consegui ler o perfil de", empresaId, "-", err?.message || err);
    // Não guarda no cache: no próximo clique tenta de novo.
  }

  return premium;
}

// ============================================================================
// A TRAVA
// ============================================================================

/**
 * O erro que as rotas lançam. O nome carrega o recurso, para a rota não
 * precisar montar a mensagem — e para o teste conseguir dizer QUAL trava bateu.
 */
export class PrecisaPremium extends Error {
  recurso: Recurso;
  constructor(recurso: Recurso) {
    super("PRECISA_PREMIUM");
    this.name = "PrecisaPremium";
    this.recurso = recurso;
  }
}

/**
 * Barra a chamada se a empresa não for Premium.
 *
 * Usa-se numa linha, no começo da rota, DEPOIS de saber de quem são os dados:
 *
 *     const uid = await exigirUsuario(req);
 *     await exigirPremium(db, uid, "notafiscal");
 *
 * ⚠️ A ordem importa. `exigirUsuario` devolve a EMPRESA, não o login — então um
 * ajudante herda o plano do dono, que é o certo: quem pagou foi a empresa.
 */
export async function exigirPremium(db: any, empresaId: string, recurso: Recurso): Promise<void> {
  if (!db) return; // sem banco, o servidor está capenga de outro jeito
  const premium = await ehPremium(db, empresaId);
  if (!premium) throw new PrecisaPremium(recurso);
}

/**
 * Traduz o erro para a resposta HTTP. Devolve `null` se o erro for outro.
 *
 * O código é 428 ("Precondition Required") e não 403 de propósito: 403 é "você
 * não pode", 428 é "falta uma condição para poder". A tela usa isso para saber
 * que deve abrir a assinatura em vez de mostrar um erro seco — é o mesmo
 * combinado que já funciona hoje em criar usuários.
 */
export function respostaDoPlano(err: any): { status: number; corpo: any } | null {
  if (!err || err.message !== "PRECISA_PREMIUM") return null;
  const recurso: Recurso = err.recurso || "notafiscal";
  return {
    status: 428,
    corpo: {
      success: false,
      erro: "PRECISA_PREMIUM",
      recurso,
      mensagem: convitePremium(recurso),
    },
  };
}

/** Atalho para as rotas que hoje respondem erro na mão. */
export function responderSePlano(res: any, err: any): boolean {
  const r = respostaDoPlano(err);
  if (!r) return false;
  res.status(r.status).json(r.corpo);
  return true;
}

// ============================================================================
// A ROTA QUE A TELA LÊ
// ============================================================================

export function registrarRotasPlano(app: any, db: any) {
  /**
   * O que cada plano faz, e em qual deles esta conta está.
   *
   * A tela desenha os cadeados a partir daqui, em vez de repetir a lista no
   * código dela. Responde sem login também: o site de vendas usa a mesma rota
   * para montar a tabela de planos.
   */
  app.get("/api/plano", async (req: any, res: any) => {
    let premium: boolean | null = null;
    let empresaId = "";

    try {
      const { exigirUsuario } = await import("./auth-firebase.js");
      empresaId = await exigirUsuario(req);
      premium = await ehPremium(db, empresaId);
    } catch {
      // Sem login: devolve só a tabela dos planos, sem dizer de quem.
    }

    res.json({
      success: true,
      plano: premium === null ? null : premium ? "premium" : "free",
      premium: premium === true,
      recursosPremium: RECURSOS_PREMIUM,
      recursosGratuitos: RECURSOS_GRATUITOS,
    });
  });
}
