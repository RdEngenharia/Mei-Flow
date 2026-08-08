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

export interface Transacao {
  id: string;
  tipo: "entrada" | "saida";
  valor: number;
  data: string; // ISO string ou YYYY-MM-DD
  descricao: string;
  categoria: string; // ex: "Consultoria", "DAS", "Hospedagem", "Materiais"
  clienteId?: string; // nulo para saídas/despesas genéricas
  clienteNome?: string; // guardado denormalizado para evitar joins pesados
  clienteDocumento?: string; // guardado denormalizado para o recibo rápido
  formaPagamento?: string; // ex: "Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", etc.
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

