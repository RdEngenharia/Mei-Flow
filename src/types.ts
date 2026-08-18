/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Cliente {
  id: string;
  nome: string;
  documento?: string; // CPF ou CNPJ
  email?: string;
  telefone?: string;
  /** Endereço do pagador — exigido pelo banco no boleto registrado. */
  endereco?: {
    cep?: string; logradouro?: string; numero?: string;
    bairro?: string; cidade?: string; uf?: string; complemento?: string;
  };
  /**
   * Texto que vai no campo "Informações Complementares" da NFS-e deste cliente.
   * Serve para o que se repete todo mês e é próprio dele — número da unidade
   * consumidora, nome da usina, contrato. Na hora de emitir ele vem preenchido
   * e pode ser ajustado.
   */
  observacaoNfse?: string;
  createdAt: string;
}

/* ==========================================================================
   RECEBIMENTO PARCELADO — a venda que entra no caixa em pedaços
   ==========================================================================

   O CASO REAL QUE ORIGINOU ISTO

   Projeto fotovoltaico: 50% de entrada na assinatura, o restante quando a
   concessionária aprova. Entre uma coisa e outra passam-se até 40 dias — e
   ninguém sabe quantos. Pedir "data do recebimento" nesse cenário é pedir um
   chute, e chute vira alarme falso de atraso duas semanas depois.

   Por isso `previsao` é OPCIONAL e existe o campo `gatilho`: em vez de uma data
   inventada, escreve-se o marco que destrava o dinheiro ("Aprovação na Coelba").
   A venda a prazo comum continua atendida — quem tem data, preenche a data.

   ⚠️ O INVARIANTE QUE SEGURA O SISTEMA INTEIRO

   `Transacao.valor` continua sendo O QUE JÁ ENTROU NO CAIXA: sempre igual à
   soma dos recebimentos com situacao "recebido". É isso que faz o faturamento
   consolidado, o percentual do limite de R$ 81.000, os gráficos e o relatório
   em PDF continuarem certos SEM UMA LINHA ALTERADA — todos eles somam `valor`.

   O valor cheio da venda mora em `valorTotal`. Venda antiga não tem nenhum dos
   dois campos novos, e por isso `normalizarVenda()` (src/utils/recebimentos.ts)
   trata ausência como "recebido tudo à vista" — que é exatamente o que essas
   vendas foram.

   Quem mexer aqui: leia src/utils/recebimentos.ts antes. O invariante é
   mantido num lugar só, a função `aplicarRecebimentos`.
   ========================================================================== */

export type SituacaoRecebimento = "recebido" | "aguardando";

/** Uma parcela do recebimento de uma venda. */
export interface Recebimento {
  id: string;
  valor: number;
  situacao: SituacaoRecebimento;
  /** Como aparece na tela: "Entrada", "Saldo na aprovação", "2ª parcela". */
  rotulo?: string;
  /** Pix, Dinheiro, Boleto, Cartão... Pode ser diferente em cada parcela. */
  forma?: string;
  /** dd/mm/aaaa — só existe depois de confirmado. É a data que vai para o caixa. */
  dataRecebimento?: string;
  /**
   * dd/mm/aaaa — OPCIONAL de propósito. Vazio significa "sem previsão", e a
   * tela mostra há quantos dias está em aberto em vez de inventar atraso.
   */
  previsao?: string;
  /** O marco que destrava o dinheiro, quando não há data. Ex.: "Aprovação na Coelba". */
  gatilho?: string;
  /** Id da cobrança gerada pelo app (Efí), quando o saldo virou boleto/Pix. */
  cobrancaId?: string;
}

/* --------------------------------------------------------------------------
   COMISSÃO

   Ela nasce "aPagar" e só vira saída no Livro Caixa quando marcada como paga —
   com a data real do pagamento. Lançar no ato da venda deixaria o saldo do mês
   mostrando um dinheiro que ainda está na conta.

   `valor` é sempre o valor em reais JÁ CALCULADO e congelado. O percentual fica
   guardado só para a tela explicar de onde veio o número: se amanhã a base
   mudar, a comissão combinada ontem não muda junto.
   -------------------------------------------------------------------------- */

export type BaseComissao = "percentual" | "fixo";
export type SituacaoComissao = "aPagar" | "paga";

export interface Comissao {
  /** Quem recebe. Texto livre — vendedor, indicador, parceiro. */
  beneficiario: string;
  base: BaseComissao;
  /** Só quando base === "percentual". Ex.: 10 para 10%. */
  percentual?: number;
  /** Sobre o valor cheio da venda ou só sobre o que já foi recebido. */
  sobre?: "total" | "recebido";
  /** Valor em R$, congelado no momento em que foi definido. */
  valor: number;
  situacao: SituacaoComissao;
  /** dd/mm/aaaa — preenchida na baixa. */
  dataPagamento?: string;
  formaPagamento?: string;
  /** Id da despesa gerada no Livro Caixa. Presente ⇒ já foi lançada. */
  despesaId?: string;
  observacao?: string;
}

/* --------------------------------------------------------------------------
   CONDIÇÃO DE PAGAMENTO — o combinado, antes de virar venda

   Vive no orçamento, é impressa na proposta em PDF e, quando o orçamento é
   aceito, vira os `recebimentos` da venda sem ninguém redigitar nada.
   -------------------------------------------------------------------------- */

export interface CondicaoPagamento {
  /** Ex.: 50 para 50%. Personalizável por proposta. */
  entradaPercentual?: number;
  /** Alternativa ao percentual, para entrada combinada em valor fechado. */
  entradaValor?: number;
  formaEntrada?: string;
  formaSaldo?: string;
  /** O marco que libera o saldo, quando não há data. */
  gatilhoSaldo?: string;
  /** dd/mm/aaaa — previsão do saldo, quando existir. */
  previsaoSaldo?: string;
}

export interface Transacao {
  id: string;
  tipo: "entrada" | "saida";
  /**
   * ⚠️ EM VENDA PARCELADA, ISTO É O QUE JÁ FOI RECEBIDO — não o valor da venda.
   * Ver o bloco de comentário acima. O valor cheio está em `valorTotal`.
   */
  valor: number;
  data: string; // ISO string ou YYYY-MM-DD
  descricao: string;
  categoria: string; // ex: "Consultoria", "DAS", "Hospedagem", "Materiais"
  clienteId?: string; // nulo para saídas/despesas genéricas
  clienteNome?: string; // guardado denormalizado para evitar joins pesados
  clienteDocumento?: string; // guardado denormalizado para o recibo rápido
  formaPagamento?: string; // ex: "Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", etc.

  // ---- Campos novos. Todos opcionais: venda antiga não tem nenhum deles. ----
  /** Valor cheio da venda. Ausente ⇒ venda à vista, valorTotal === valor. */
  valorTotal?: number;
  /** Plano de recebimento. Ausente ⇒ recebido tudo no ato. */
  recebimentos?: Recebimento[];
  /** Comissão paga a terceiro por esta venda. */
  comissao?: Comissao;
  /** Orçamento que originou a venda, quando veio do funil. */
  orcamentoId?: string;
  /** Despesa de comissão aponta para a venda de origem, para o estorno achar. */
  vendaOrigemId?: string;
}

export interface MEIProfile {
  uid: string;
  nomeComercial: string;
  faturamentoAcumulado: number;
  limiteAnual: number; // Padrão R$ 81.000,00
}

export interface CatalogItem {
  id: string;
  title: string;
  type: "produto" | "serviço";
  price: number;
}

/** Uma linha do orçamento. Quantidade × valor unitário. */
export interface ItemOrcamento {
  id: string;
  tipo: "produto" | "serviço";
  nome: string;
  quantidade: number;
  valorUnitario: number;
}

/**
 * Onde o orçamento está no funil de vendas.
 *
 * "negociando" é o degrau que a maioria dos sistemas esquece, e é onde mora
 * quem pediu desconto ou ficou de pensar. Sem ele, tudo que não foi respondido
 * some junto com o que foi recusado.
 */
export type SituacaoOrcamento = "enviado" | "negociando" | "aceito" | "recusado";

export interface Orcamento {
  id: string;
  /** Número sequencial por usuário, para o cliente poder citar a proposta. */
  numero?: number;
  clienteId: string;
  clienteNome: string;
  clienteDocumento?: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  /** Itens da proposta. */
  itens?: ItemOrcamento[];
  /** Soma dos itens menos o desconto — gravada para não recalcular no histórico. */
  total?: number;
  desconto?: number;
  observacoes?: string;
  validade: string;
  situacao?: SituacaoOrcamento;
  createdAt: string;
  atualizadoEm?: string;
  /** Preenchido quando o orçamento aceito virou lançamento no Livro Caixa. */
  vendaId?: string;

  /**
   * RÉGUA DE ACOMPANHAMENTO — os contatos já feitos com o cliente.
   *
   * Proposta sem resposta quase nunca é um "não"; costuma ser um "esqueci".
   * Estes dois campos guardam o que já foi feito para o sistema saber o que
   * lembrar amanhã. Quem calcula tudo é src/utils/reguaContato.ts.
   */
  acompanhamento?: { etapa: number; quando: string }[];
  /** Verdadeiro depois do terceiro contato — a régua tem fim, e para de cobrar. */
  acompanhamentoEncerrado?: boolean;

  /**
   * CONDIÇÃO DE PAGAMENTO combinada nesta proposta. Sai impressa no PDF e vira
   * o plano de recebimento da venda quando o orçamento é aceito.
   */
  condicaoPagamento?: CondicaoPagamento;

  /**
   * COMISSÃO PREVISTA. Aqui ela é só previsão — serve para o orçamento mostrar
   * a margem líquida antes de você aceitar o desconto que o cliente pediu.
   * Vira comissão de verdade (a pagar) quando o orçamento vira venda.
   */
  comissao?: Comissao;

  // --------------------------------------------------------------------------
  // LEGADO — orçamentos de um item só, salvos antes de `itens` existir.
  //
  // Ficam opcionais de propósito: quem já tinha orçamento no navegador não
  // perde nada, e a função normalizarOrcamento converte para `itens` na leitura.
  // Não escreva nestes campos em código novo.
  // --------------------------------------------------------------------------
  itemTipo?: "produto" | "serviço";
  itemNome?: string;
  itemValor?: number;
}

