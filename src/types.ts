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

