/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { X, Printer, Receipt, FileText, CheckCircle2, Download } from "lucide-react";
import { Transacao } from "../types";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface ReceiptModalProps {
  transaction: Transacao | null;
  meiName: string;
  meiUid: string;
  meiCnpj?: string;
  meiInscricao?: string;
  meiTelefone?: string;
  planType?: "free" | "premium";
  companyLogo?: string;
  isCpfEmissor?: boolean;
  onClose: () => void;
}

export default function ReceiptModal({
  transaction,
  meiName,
  meiUid,
  meiCnpj = "",
  meiInscricao = "",
  meiTelefone = "",
  planType = "free",
  companyLogo = "",
  isCpfEmissor = false,
  onClose,
}: ReceiptModalProps) {
  if (!transaction) return null;

  const [formaPgto, setFormaPgto] = React.useState<string>(transaction.formaPagamento || "Pix");
  const [parcelado, setParcelado] = React.useState<string>("Não (À vista)");

  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.warn("Bloqueio de impressora devido a limitações de iframe sandbox:", e);
    }
  };

  const handleDownload = () => {
    try {
      const doc = new jsPDF();
      const isEntrada = transaction.tipo === "entrada";

      // Header Banner
      doc.setFillColor(15, 23, 42); // slate-900 (deep navy)
      doc.rect(0, 0, 210, 42, "F");

      // App Title or Custom Premium Logo
      doc.setTextColor(255, 255, 255);
      if (planType === "premium" && companyLogo) {
        try {
          doc.addImage(companyLogo, "PNG", 15, 5, 32, 32);
        } catch (e) {
          console.error("Erro ao desenhar logotipo no PDF, fallback para texto:", e);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(24);
          doc.text("MEI Flow", 15, 24);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.text("Controle Tributário & Serviços de Apoio ao MEI", 15, 32);
        }
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.text("MEI Flow", 15, 24);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Controle Tributário & Serviços de Apoio ao MEI", 15, 32);
      }

      // Right aligned registered company info in header (identical to reports!)
      doc.setFontSize(8.5);
      doc.setTextColor(203, 213, 225); // slate-300
      doc.text(`${isCpfEmissor ? "Emissor" : "Empresa"}: ${meiName || "Não Informada"}`, 195, 12, { align: "right" });
      doc.text(`${isCpfEmissor ? "CPF" : "CNPJ"}: ${meiCnpj || "Não Informado"}`, 195, 18, { align: "right" });
      if (!isCpfEmissor) {
        doc.text(`Insc. Mun.: ${meiInscricao || "Não Informada"}`, 195, 24, { align: "right" });
      } else {
        doc.text(`Perfil: Usuário Pessoa Física`, 195, 24, { align: "right" });
      }
      doc.text(`Telefone: ${meiTelefone || "Não Informado"}`, 195, 30, { align: "right" });
      doc.text(`Emitido em: ${new Date().toLocaleDateString("pt-BR")}`, 195, 36, { align: "right" });

      // Centered Title
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("RECIBO DE PAGAMENTO & COMPROVANTE FISCAL", 105, 52, { align: "center" });

      // Clean metadata table/rows
      // 1. BLOC TOMADOR / CLIENTE (Substitui o emitente, pois a empresa já está no cabeçalho dos relatórios)
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("1. DADOS DO TOMADOR DO SERVIÇO / CLIENTE", 15, 64);
      
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(15, 66, 195, 66);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      if (isEntrada) {
        doc.text(`Nome / Razão Social: ${transaction.clienteNome || "Consumidor Final"}`, 15, 73);
        doc.text(`CNPJ / CPF do Tomador: ${transaction.clienteDocumento || "Não Informado"}`, 15, 79);
      } else {
        doc.text(`Fornecedor / Destinatário: ${transaction.clienteNome || "Fornecedor / Destinatário não especificado"}`, 15, 73);
        if (transaction.clienteDocumento) {
          doc.text(`CNPJ / CPF do Destinatário: ${transaction.clienteDocumento}`, 15, 79);
        }
      }

      // 2. BLOC TRANSAÇÃO
      const startTransacaoy = 88;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("2. INFORMAÇÕES DO LANÇAMENTO E PAGAMENTO", 15, startTransacaoy);
      doc.line(15, startTransacaoy + 2, 195, startTransacaoy + 2);

      const tableRows = [
        ["Data da Operação", transaction.data],
        ["Descrição / Item", transaction.descricao],
        ["Categoria", transaction.categoria],
        ["Forma de Pagamento", formaPgto],
        ["Parcelamento", parcelado],
        ["Valor Consolidado", `R$ ${transaction.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`]
      ];

      autoTable(doc, {
        startY: startTransacaoy + 5,
        margin: { left: 15, right: 15 },
        head: [["Campo / Parâmetro", "Informação Registrada"]],
        body: tableRows,
        theme: "striped",
        styles: {
          fontSize: 8.5,
          cellPadding: 3.5,
        },
        headStyles: {
          fillColor: [15, 23, 42], // slate-900
          textColor: 255,
        },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 50 },
        }
      });

      let currentY = (doc as any).lastAutoTable.finalY + 12;

      // Check footer overflow
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }

      // Financial highlights box
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(15, currentY, 180, 18, "F");
      doc.setDrawColor(14, 165, 233); // sky-500
      doc.line(15, currentY, 15, currentY + 18);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text("VALOR TOTAL DECLARADO:", 20, currentY + 10.5);
      
      doc.setFontSize(13);
      doc.setTextColor(isEntrada ? "#10b981" : "#ef4444"); // emerald or red
      doc.text(`R$ ${transaction.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 125, currentY + 11.5);

      // Fiscal disclaimer bottom
      doc.setTextColor(148, 163, 184); // slate-400
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      
      const textY = currentY + 28;
      doc.text("Este recibo serve de lastro documental para fins do preenchimento obrigatório do Relatório", 15, textY);
      doc.text("Mensal de Receitas Brutas, conforme diretivas do Art. 26 da Lei Complementar nº 123/2006.", 15, textY + 4);

      // MARCA D'ÁGUA (PLANO FREE): identifica que o documento foi gerado pelo
      // MEI Flow quando o usuário não tem o plano Premium (que usa logo própria).
      if (planType !== "premium") {
        doc.setTextColor(180, 188, 200);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("Gerado eletronicamente via MEI Flow • Ative o Premium para usar sua própria logo", 105, 287, { align: "center" });
      }

      doc.save(`comprovante_mei_flow_${transaction.id}.pdf`);
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
    }
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

        {/* Configurações do Recibo (Não saem na impressão/PDF, puramente interativas) */}
        <div className="px-6 py-4 bg-blue-50/50 border-b border-slate-100 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Forma de Pagamento</label>
            <select
              value={formaPgto}
              onChange={(e) => setFormaPgto(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium"
            >
              <option value="Dinheiro">Dinheiro</option>
              <option value="Pix">Pix</option>
              <option value="Cartão de Crédito">Cartão de Crédito</option>
              <option value="Cartão de Débito">Cartão de Débito</option>
              <option value="Boleto Bancário">Boleto Bancário</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Parcelado?</label>
            <select
              value={parcelado}
              onChange={(e) => setParcelado(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium"
            >
              <option value="Não (À vista)">Não (À vista)</option>
              <option value="Sim (2x Sem Juros)">Sim (2x)</option>
              <option value="Sim (3x Sem Juros)">Sim (3x)</option>
              <option value="Sim (4x Sem Juros)">Sim (4x)</option>
              <option value="Sim (5x Sem Juros)">Sim (5x)</option>
              <option value="Sim (6x Sem Juros)">Sim (6x)</option>
              <option value="Sim (10x)">Sim (10x)</option>
              <option value="Sim (12x)">Sim (12x)</option>
            </select>
          </div>
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
              {planType === "premium" && companyLogo ? (
                <div className="inline-flex items-center justify-center mb-2 bg-white p-1 rounded-xl border border-slate-200 shadow-xs">
                  <img src={companyLogo} alt="Logo" className="h-14 w-auto object-contain rounded-lg max-w-[150px]" />
                </div>
              ) : (
                <div className="inline-flex w-12 h-12 bg-blue-600 rounded-xl items-center justify-center text-white font-bold text-xl shadow mb-2">
                  M
                </div>
              )}
              <h2 className="text-lg font-bold text-slate-900 uppercase tracking-tight">
                {meiName}
              </h2>
              {meiCnpj && (
                <p className="text-[11px] text-slate-600 font-semibold font-mono mt-0.5">
                  {isCpfEmissor ? "CPF" : "CNPJ"}: {meiCnpj} {!isCpfEmissor && meiInscricao ? `| IM: ${meiInscricao}` : ""}
                </p>
              )}
              {meiTelefone && (
                <p className="text-[11px] text-slate-500 font-medium font-mono">
                  Telefone: {meiTelefone}
                </p>
              )}
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {isCpfEmissor ? "Perfil Autônomo Sincronizado" : "MEI Sincronizado"} - UID: {meiUid.substring(0, 15)}...
              </p>
              <div className="mt-2 inline-block px-3 py-1 bg-white border border-slate-100 rounded-full text-xs font-semibold text-slate-600 shadow-sm font-mono">
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
                <span className="text-slate-400 font-medium font-sans">Descrição / Item:</span>
                <span className="text-slate-800 font-semibold">{transaction.descricao}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium">Categoria Fiscal:</span>
                <span className="text-slate-800 font-semibold">{transaction.categoria}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium">Forma de Pagamento:</span>
                <span className="text-slate-800 font-semibold">{formaPgto}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400 font-medium font-sans">Parcelado?</span>
                <span className="text-slate-800 font-semibold">{parcelado}</span>
              </div>
            </div>

            {/* Detalhes do Cliente (Somente Entradas) - Colocado onde estava a informação duplicada do MEI */}
            <div className="pt-2">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">Dados do Tomador do Serviço / Cliente</p>
              <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-xs space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Nome / Razão:</span>
                  <span className="text-slate-800 font-bold">{isEntrada ? (transaction.clienteNome || "Consumidor Final") : (transaction.clienteNome || "Fornecedor / Destinatário")}</span>
                </div>
                {(transaction.clienteDocumento) && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">CNPJ / CPF do Tomador:</span>
                    <span className="text-slate-800 font-mono font-bold">{transaction.clienteDocumento}</span>
                  </div>
                )}
              </div>
            </div>

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
            className="flex-1 sm:flex-initial bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs shadow-md cursor-pointer"
          >
            <Download className="w-4 h-4" /> Baixar Comprovante (PDF)
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
