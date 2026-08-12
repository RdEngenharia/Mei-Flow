/**
 * ============================================================================
 * RÉGUA DE ACOMPANHAMENTO — os três contatos depois do orçamento
 * ============================================================================
 *
 * O QUE ISTO É
 *
 * Proposta enviada e não respondida quase nunca é um "não". Costuma ser um
 * "esqueci". A régua transforma esse esquecimento em três lembretes espaçados,
 * cada um com um tom diferente:
 *
 *   1º contato — dois dias depois do envio. Confirma que o arquivo abriu e que
 *      a proposta foi entendida. É a pergunta mais fácil de responder.
 *
 *   2º contato — cinco dias depois do primeiro. Dá um MOTIVO para o cliente
 *      voltar (preço e prazo mudam), em vez de só cobrar resposta.
 *
 *   3º contato — onze dias depois do segundo. A despedida educada. Ela tira a
 *      pressão do cliente — e é justamente por isso que costuma ser a que mais
 *      responde: quem estava sem graça de sumir agora tem uma saída simples.
 *
 * ⚠️ ISTO NÃO ENVIA NADA SOZINHO. De propósito.
 *
 * Uma régua que dispara mensagem automática vira spam no dia em que der
 * qualquer defeito, e quem paga o preço é a reputação do MEI com o cliente
 * dele. Aqui o sistema só diz "hoje é dia de falar com fulano" e entrega o
 * texto pronto. Quem aperta o botão é uma pessoa.
 *
 * ⚠️ E NÃO EXISTE NADA PARA CONFIGURAR. Também de propósito. Uma ferramenta de
 *    acompanhamento que precisa ser configurada antes de servir nunca chega a
 *    ser usada.
 */

/** Um contato já feito, registrado pelo usuário. */
export type ContatoFeito = { etapa: number; quando: string };

/** O mínimo que a régua precisa saber de um orçamento. */
export type OrcamentoParaRegua = {
  id?: string;
  clienteNome?: string;
  clienteTelefone?: string;
  createdAt?: string;
  situacao?: string;
  acompanhamento?: ContatoFeito[];
  acompanhamentoEncerrado?: boolean;
};

/**
 * Os três passos. `dias` conta a partir do PASSO ANTERIOR — do envio, no caso
 * do primeiro. Contar sempre a partir do envio faria os três lembretes se
 * amontoarem quando o usuário atrasa um deles.
 */
export const PASSOS: { etapa: number; dias: number; titulo: string; porque: string }[] = [
  {
    etapa: 1,
    dias: 2,
    titulo: "Confirmar que a proposta chegou",
    porque: "Pergunta fácil de responder — só quer saber se o arquivo abriu.",
  },
  {
    etapa: 2,
    dias: 5,
    titulo: "Dar um motivo para retomar",
    porque: "Preço e prazo mudam; isso é assunto, não cobrança.",
  },
  {
    etapa: 3,
    dias: 11,
    titulo: "Encerrar com elegância",
    porque: "Tira a pressão do cliente — e é a que mais traz resposta.",
  },
];

/** Só quem ainda está em jogo entra na régua. */
const EM_JOGO = ["enviado", "negociando"];

/** "SAILANDIA LIMA DE JESUS" vira "Sailandia" — tratamento de gente, não de cadastro. */
export function primeiroNome(nome?: string): string {
  const bruto = String(nome || "").trim().split(/\s+/)[0] || "";
  if (!bruto) return "tudo bem";
  return bruto.charAt(0).toUpperCase() + bruto.slice(1).toLowerCase();
}

/**
 * As três mensagens.
 *
 * Redação propositalmente neutra quanto ao ramo: o MEI Flow não é só de energia
 * solar, e uma mensagem que fala em "projeto solar" para um cabeleireiro é pior
 * do que mensagem nenhuma.
 */
export const MENSAGENS_PADRAO: [string, string, string] = [
  "Olá, {nome}! Confirmando se você conseguiu abrir o arquivo do orçamento. " +
    "Ficou alguma dúvida inicial sobre a proposta?",
  "Olá, {nome}, tudo bem? Como os prazos e os preços de tabela costumam oscilar, " +
    "passando só para saber se você quer fazer alguma adaptação no projeto para alinharmos os próximos passos.",
  "Olá, {nome}! Imagino que sua rotina esteja corrida por aí. Para não te incomodar com mensagens, " +
    "vou guardar a sua proposta por aqui. Quando decidir retomar, é só me chamar. Um abraço!",
];

/** Os textos que o usuário pode ter escrito por conta própria. */
export type MensagensContato = Partial<Record<1 | 2 | 3, string>>;

/**
 * Troca as marcações do modelo pelos dados reais.
 *
 * Só existe uma marcação, `{nome}`, e isso é de propósito: quanto mais
 * marcações, mais chance de a pessoa errar uma e mandar "{nome}" literal para
 * o cliente. Uma só, escrita na tela ao lado do campo, ninguém erra.
 */
export function aplicarModelo(modelo: string, nome?: string): string {
  return String(modelo || "").replace(/\{nome\}/gi, primeiroNome(nome));
}

/**
 * O texto da mensagem daquela etapa.
 *
 * ⚠️ OS TEXTOS PADRÃO SÃO PONTO DE PARTIDA, NÃO REGRA.
 *
 * A redação de fábrica é neutra quanto ao ramo de propósito — o MEI Flow não é
 * só de energia solar, e falar em "projeto solar" para um cabeleireiro é pior
 * do que não mandar nada. Mas neutro também quer dizer impessoal, e quem
 * conhece o próprio cliente escreve melhor que qualquer texto genérico. Por
 * isso os três são editáveis; o padrão entra só enquanto ninguém escreveu o
 * seu.
 *
 * Modelo em branco cai no padrão — apagar o texto não pode virar mensagem
 * vazia enviada ao cliente.
 */
export function mensagemDoContato(
  etapa: number,
  nome?: string,
  modelos?: MensagensContato
): string {
  const i = etapa >= 1 && etapa <= 3 ? (etapa as 1 | 2 | 3) : 3;
  const escolhido = String(modelos?.[i] || "").trim() || MENSAGENS_PADRAO[i - 1];
  return aplicarModelo(escolhido, nome);
}

/** Data em ISO curto, sem hora — a régua conta dias, não minutos. */
const soDia = (iso?: string) => String(iso || "").slice(0, 10);

/**
 * Diferença em dias entre duas datas, contada pelo calendário.
 *
 * ⚠️ Nada de dividir milissegundos por 86.400.000: no dia da virada do horário
 *    de verão o dia tem 23 ou 25 horas e a conta erra por um. Aqui comparamos
 *    datas ao meio-dia, que é imune a isso — o mesmo cuidado que o resto do
 *    sistema toma ao ler data sem hora.
 */
export function diasEntre(de: string, ate: string): number {
  const a = new Date(`${soDia(de)}T12:00:00`);
  const b = new Date(`${soDia(ate)}T12:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export type ProximoContato = {
  etapa: number;
  titulo: string;
  porque: string;
  /** Dia em que este contato deveria acontecer (ISO curto). */
  venceEm: string;
  /** Negativo = ainda falta; 0 = hoje; positivo = atrasado. */
  diasDeAtraso: number;
  vencido: boolean;
  mensagem: string;
  /** Quantos dias o cliente está sem resposta desde o envio. */
  diasDesdeOEnvio: number;
};

/**
 * Qual contato está na vez para este orçamento — ou null, se não há o que fazer.
 *
 * Devolve null quando: o orçamento saiu de jogo (aceito ou recusado), o
 * acompanhamento foi encerrado, os três contatos já foram feitos, ou não há
 * data de envio para contar a partir.
 */
export function proximoContato(
  orc: OrcamentoParaRegua,
  hojeISO?: string,
  modelos?: MensagensContato
): ProximoContato | null {
  const hoje = soDia(hojeISO || new Date().toISOString());
  const situacao = String(orc.situacao || "enviado");
  if (!EM_JOGO.includes(situacao)) return null;
  if (orc.acompanhamentoEncerrado) return null;

  const feitos = Array.isArray(orc.acompanhamento) ? orc.acompanhamento : [];
  const jaFeitas = feitos.map((c) => Number(c.etapa)).filter((n) => n >= 1 && n <= 3);
  const proxima = Math.max(0, ...jaFeitas) + 1;
  if (proxima > PASSOS.length) return null;

  const passo = PASSOS[proxima - 1];

  // A contagem parte do último contato feito; se não houve nenhum, do envio.
  const ultimo = feitos
    .slice()
    .sort((a, b) => soDia(a.quando).localeCompare(soDia(b.quando)))
    .pop();
  const base = soDia(ultimo?.quando || orc.createdAt);
  if (!base) return null;

  const vence = new Date(`${base}T12:00:00`);
  if (isNaN(vence.getTime())) return null;
  vence.setDate(vence.getDate() + passo.dias);
  const venceEm = vence.toISOString().slice(0, 10);

  return {
    etapa: passo.etapa,
    titulo: passo.titulo,
    porque: passo.porque,
    venceEm,
    diasDeAtraso: diasEntre(venceEm, hoje),
    vencido: diasEntre(venceEm, hoje) >= 0,
    mensagem: mensagemDoContato(passo.etapa, orc.clienteNome, modelos),
    diasDesdeOEnvio: orc.createdAt ? diasEntre(orc.createdAt, hoje) : 0,
  };
}

/**
 * A lista do dia: quem já está no prazo de ser contatado, do mais atrasado
 * para o menos. Quem ainda não venceu fica de fora — a lista de hoje é sobre
 * hoje, senão vira mais uma tela cheia de coisa.
 */
export function tarefasDeHoje<T extends OrcamentoParaRegua>(
  orcamentos: T[],
  hojeISO?: string,
  modelos?: MensagensContato
): { orcamento: T; contato: ProximoContato }[] {
  return (orcamentos || [])
    .map((o) => ({ orcamento: o, contato: proximoContato(o, hojeISO, modelos) }))
    .filter((x): x is { orcamento: T; contato: ProximoContato } => !!x.contato && x.contato.vencido)
    .sort((a, b) => b.contato.diasDeAtraso - a.contato.diasDeAtraso);
}

/** Texto curto para o selo do cartão: "contato 1 hoje", "atrasado 3 dias"... */
export function rotuloDoPrazo(c: ProximoContato): string {
  if (c.diasDeAtraso === 0) return `Contato ${c.etapa} é hoje`;
  if (c.diasDeAtraso === 1) return `Contato ${c.etapa} atrasado 1 dia`;
  if (c.diasDeAtraso > 1) return `Contato ${c.etapa} atrasado ${c.diasDeAtraso} dias`;
  if (c.diasDeAtraso === -1) return `Contato ${c.etapa} amanhã`;
  return `Contato ${c.etapa} em ${Math.abs(c.diasDeAtraso)} dias`;
}

/**
 * Registra um contato e devolve o orçamento atualizado.
 *
 * Depois do terceiro, o acompanhamento se encerra sozinho: a régua tem fim.
 * Insistir depois da mensagem de despedida desfaz justamente o efeito que ela
 * produz.
 */
export function registrarContato<T extends OrcamentoParaRegua>(
  orc: T,
  etapa: number,
  quandoISO?: string
): T {
  const quando = soDia(quandoISO || new Date().toISOString());
  const feitos = Array.isArray(orc.acompanhamento) ? orc.acompanhamento.slice() : [];
  if (!feitos.some((c) => Number(c.etapa) === etapa)) feitos.push({ etapa, quando });
  return {
    ...orc,
    acompanhamento: feitos,
    acompanhamentoEncerrado: etapa >= PASSOS.length ? true : orc.acompanhamentoEncerrado,
  };
}

/**
 * Link do WhatsApp com a mensagem já escrita.
 *
 * Devolve string vazia quando não há telefone com cara de telefone — aí a tela
 * oferece só o "copiar", em vez de abrir uma conversa com número inválido.
 */
export function linkWhatsApp(telefone?: string, mensagem?: string): string {
  const n = String(telefone || "").replace(/\D/g, "");
  if (n.length < 10 || n.length > 13) return "";
  const comPais = n.length <= 11 ? `55${n}` : n;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(String(mensagem || ""))}`;
}
