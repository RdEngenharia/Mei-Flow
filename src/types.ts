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

export interface Orcamento {
  id: string;
  clienteId: string;
  clienteNome: string;
  clienteDocumento?: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  itemTipo: "produto" | "serviço";
  itemNome: string;
  itemValor: number;
  validade: string;
  createdAt: string;
}

