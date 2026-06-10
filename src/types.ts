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
}

export interface MEIProfile {
  uid: string;
  nomeComercial: string;
  faturamentoAcumulado: number;
  limiteAnual: number; // Padrão R$ 81.000,00
}
