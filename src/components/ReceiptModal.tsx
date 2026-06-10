/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { X, Printer, Receipt, FileText, CheckCircle2, Download } from "lucide-react";
import { Transacao } from "../types";

interface ReceiptModalProps {
  transaction: Transacao | null;
  meiName: string;
  meiUid: string;
  meiCnpj?: string;
  meiInscricao?: string;
  meiTelefone?: string;
  onClose: () => void;
}

export default function ReceiptModal({
  transaction,
  meiName,
  meiUid,
  meiCnpj = "",
  meiInscricao = "",
  meiTelefone = "",
  onClose,
}: ReceiptModalProps) {
  if (!transaction) return null;

  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.warn("Bloqueio de impressora devido a limitações de iframe sandbox:", e);
    }
  };

  const handleDownload = () => {
    const isEntrada = transaction.tipo === "entrada";
    const receiptText = `==========================================================
             COMPROVANTE DE OPERAÇÃO - MEI FLOW
==========================================================
EMITENTE / EMISSOR MEI (PRESTADOR DO SERVIÇO):
Nome/Razão: ${meiName}
CNPJ: ${meiCnpj || "Não cadastrado"}
${meiInscricao ? `Inscrição Municipal: ${meiInscricao}` : ""}
${meiTelefone ? `Telefone: ${meiTelefone}` : ""}
Registro ID: ${meiUid}

DADOS DA TRANSAÇÃO:
Lançamento ID: ${transaction.id}
Tipo: ${isEntrada ? "Receita / Prestação de Serviço (ENTRADA)" : "Registro de Despesa (SAÍDA)"}
Data: ${transaction.data}
Valor Registrado: R$ ${transaction.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
Descrição/Histórico: ${transaction.descricao}
Categoria Fiscal: ${transaction.categoria}

${isEntrada && transaction.clienteNome ? `DADOS DO CLIENTE TOMADOR:
Nome/Razão Social: ${transaction.clienteNome}
${transaction.clienteDocumento ? `CPF/CNPJ Tomador: ${transaction.clienteDocumento}` : ""}` : ""}

==========================================================
Este documento atesta a sincronização fiscal do lançamento financeiro 
para relatórios fiscais do MEI.
Data de Geração: ${new Date().toLocaleString("pt-BR")}
Sistema MEI Flow - Gestão Inteligente
==========================================================`;

    const blob = new Blob([receiptText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `comprovante_mei_flow_${transaction.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const isEntrada = transaction.tipo === "entrada";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800">
            <Receipt className="w-5 h-5 text-blue-600" />
            <span className="font-bold tracking-tight">Comprovante de Operação</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Recibo para Impressão */}
        <div className="p-8 overflow-y-auto flex-1 print-area" id="receipt-print-container">
          <style>
            {`
              @media print {
                body * {
                  visibility: hidden;
                }
                #receipt-print-container, #receipt-print-container * {
                  visibility: visible;
                }
                #receipt-print-container {
                   position: absolute;
                   left: 0;
                   top: 0;
                   width: 100%;
                }
              }
            `}
          </style>

          <div className="border border-dashed border-slate-300 rounded-xl p-6 bg-slate-50/50 space-y-6">
            {/* Header do Recibo */}
            <div className="text-center pb-6 border-b border-slate-200">
              <div className="inline-flex w-12 h-12 bg-blue-600 rounded-xl items-center justify-center text-white font-bold text-xl shadow mb-2">
                M
              </div>
              <h2 className="text-lg font-bold text-slate-900 uppercase tracking-tight">
                {meiName}
              </h2>
              {meiCnpj && (
                <p className="text-[11px] text-slate-600 font-semibold font-mono mt-0.5">
                  CNPJ: {meiCnpj} {meiInscricao ? `| IM: ${meiInscricao}` : ""}
                </p>
              )}
              {meiTelefone && (
                <p className="text-[11px] text-slate-500 font-medium font-mono">
                  Telefone: {meiTelefone}
                </p>
              )}
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                MEI Sincronizado - UID: {meiUid.substring(0, 15)}...
              </p>
              <div className="mt-2 inline-block px-3 py-1 bg-white border border-slate-100 rounded-full text-xs font-semibold text-slate-600 shadow-sm">
                Recibo de {isEntrada ? "Prestação de Serviço" : "Registro de Despesa"}
              </div>
            </div>

            {/* Valor do Recibo */}
            <div className="text-center py-4 bg-white border border-slate-100 rounded-xl shadow-sm">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Valor Registrado</span>
              <p className={`text-3xl font-extrabold ${isEntrada ? "text-emerald-600" : "text-rose-600"} mt-1`}>
                R$ {transaction.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            </div>

            {/* Informações Gerais */}
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium">Data de Emissão:</span>
                <span className="text-slate-800 font-semibold">{transaction.data}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium">Lançamento ID:</span>
                <span className="text-slate-800 font-mono text-xs">{transaction.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium font-sans">Descrição / Item:</span>
                <span className="text-slate-800 font-semibold">{transaction.descricao}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium">Categoria Fiscal:</span>
                <span className="text-slate-800 font-semibold">{transaction.categoria}</span>
              </div>
            </div>

            {/* Detalhes do Cliente (Somente Entradas) */}
            {isEntrada && transaction.clienteNome && (
              <div className="pt-2">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">Dados do Cliente Tomador</p>
                <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-xs space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nome/Razão:</span>
                    <span className="text-slate-800 font-medium">{transaction.clienteNome}</span>
                  </div>
                  {transaction.clienteDocumento && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">CPF/CNPJ Do Tomador:</span>
                      <span className="text-slate-800 font-mono">{transaction.clienteDocumento}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Declaração Fiscal MEI */}
            <div className="p-3 bg-blue-50/50 rounded-lg text-[11px] text-slate-600 leading-relaxed text-center">
              <p className="font-semibold text-blue-800 flex items-center justify-center gap-1 mb-1">
                <FileText className="w-3.5 h-3.5" /> Declaratório de Sincronia Fiscal
              </p>
              Este documento serve como comprovação interna para o preenchimento do Relatório Mensal de Receitas Brutas nos termos do art. 26 da Lei Complementar nº 123/2006.
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-2 justify-end">
          <button
            onClick={onClose}
            className="flex-1 sm:flex-initial bg-white border border-slate-200 text-slate-700 font-bold py-2 px-4 rounded-xl hover:bg-slate-100 transition-all text-xs cursor-pointer"
          >
            Fechar
          </button>
          
          <button
            onClick={handleDownload}
            className="flex-1 sm:flex-initial bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs shadow-md cursor-pointer"
          >
            <Download className="w-4 h-4" /> Baixar Comprovante (.txt)
          </button>

          <button
            onClick={handlePrint}
            className="flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs shadow-md cursor-pointer"
            title="Abre a caixa de impressão do navegador (DICA: Se estiver bloqueado pelo iframe sandbox, clique em 'Baixar' ou abra o sistema em nova guia!"
          >
            <Printer className="w-4 h-4" /> Impressão Direta
          </button>
        </div>
      </div>
    </div>
  );
}
