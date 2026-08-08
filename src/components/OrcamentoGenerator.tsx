import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles, Plus, Trash2, Loader2, Search, Package, Wrench, FileText, Calendar,
  User, CheckCircle2, Printer, X, Phone, Bookmark, ArrowRight, ArrowLeft,
  TrendingUp, Clock, XCircle, ShoppingCart, Cloud, CloudOff, Download,
  MessageCircle, Copy, CheckCheck, BellRing,
} from "lucide-react";
import { db, saveOrcamentoToFirebase, fetchOrcamentosFromFirebase,
         deleteOrcamentoFromFirebase, normalizarOrcamento } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { savePdfCrossPlatform, isNativePlatform } from "../utils/nativeFile";
import { desenharOrcamento, nomeArquivoOrcamento } from "../utils/orcamentoPdf";
import { carregarLogoBase64 } from "../utils/logoImagem";
import {
  tarefasDeHoje, proximoContato, rotuloDoPrazo, registrarContato, linkWhatsApp,
} from "../utils/reguaContato";
import { CatalogItem, Cliente, Orcamento, ItemOrcamento, SituacaoOrcamento } from "../types";

/**
 * ============================================================================
 * GERADOR DE ORÇAMENTOS + FUNIL DE VENDAS
 * ============================================================================
 *
 * TRÊS COISAS MUDARAM AQUI, E VALE SABER POR QUÊ.
 *
 * 1. OS ORÇAMENTOS AGORA MORAM NA NUVEM.
 *    Antes viviam só no localStorage. Abrir o MEI Flow no celular mostrava
 *    histórico vazio, e limpar o navegador apagava tudo. Agora vão para
 *    usuarios/{uid}/orcamentos. O localStorage continua sendo lido UMA vez, na
 *    primeira carga, para subir o que já existia — ninguém perde histórico.
 *
 * 2. VÁRIOS ITENS POR ORÇAMENTO.
 *    O formato antigo tinha um item só, em campos soltos. Os antigos continuam
 *    abrindo: `normalizarOrcamento` converte na leitura.
 *
 * 3. FUNIL.
 *    Cada orçamento tem situação — enviado, negociando, aceito, recusado — e o
 *    aceito vira lançamento no Livro Caixa com um clique, de onde sai a nota
 *    fiscal. É o que fecha o ciclo orçamento → venda → boleto → nota.
 *
 * ⚠️ SOBRE O PDF: a folha é o elemento com `data-folha="orcamento"`, e é ele
 *    que o `index.css` transforma em papel na impressão. Se renomear esse
 *    atributo, a impressão do navegador volta a sair cortada. No aplicativo, o
 *    caminho é outro (foto da tela → PDF), com `umaPagina: true`.
 */

interface OrcamentoGeneratorProps {
  userId: string;
  planType: "free" | "premium";
  companyLogo?: string;
  meiName: string;
  cnpjPrestador?: string;
  inscricaoMunicipal?: string;
  telefonePrestador?: string;
  clientes: Cliente[];
  onTriggerUpgrade: () => void;
  onGoBack: () => void;
  triggerToast: (msg: string) => void;
  /**
   * Transforma o orçamento aceito em lançamento de entrada no Livro Caixa.
   * Devolve o id da venda criada, ou null se não deu.
   */
  onConverterEmVenda?: (orc: Orcamento) => Promise<string | null>;
}

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBR = (iso?: string) => {
  if (!iso) return "—";
  // Data sem hora vira meio-dia para não escorregar um dia por fuso.
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};

const somaItens = (itens: ItemOrcamento[]) =>
  itens.reduce((s, it) => s + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0), 0);

/** As etapas do funil, na ordem em que a vida acontece. */
const ETAPAS: { chave: SituacaoOrcamento; rotulo: string; cor: string; icone: any }[] = [
  { chave: "enviado",    rotulo: "Enviado",    cor: "blue",    icone: Clock },
  { chave: "negociando", rotulo: "Negociando", cor: "amber",   icone: TrendingUp },
  { chave: "aceito",     rotulo: "Aceito",     cor: "emerald", icone: CheckCircle2 },
  { chave: "recusado",   rotulo: "Recusado",   cor: "slate",   icone: XCircle },
];

const CORES: Record<string, { chip: string; caixa: string; texto: string }> = {
  blue:    { chip: "bg-blue-50 text-blue-700 border-blue-100",          caixa: "border-blue-200",    texto: "text-blue-600" },
  amber:   { chip: "bg-amber-50 text-amber-700 border-amber-100",       caixa: "border-amber-200",   texto: "text-amber-600" },
  emerald: { chip: "bg-emerald-50 text-emerald-700 border-emerald-100", caixa: "border-emerald-200", texto: "text-emerald-600" },
  slate:   { chip: "bg-slate-100 text-slate-600 border-slate-200",      caixa: "border-slate-200",   texto: "text-slate-500" },
};

export default function OrcamentoGenerator({
  userId,
  planType,
  companyLogo,
  meiName,
  cnpjPrestador,
  inscricaoMunicipal,
  telefonePrestador,
  clientes,
  onTriggerUpgrade,
  onGoBack,
  triggerToast,
  onConverterEmVenda,
}: OrcamentoGeneratorProps) {
  const [activeTab, setActiveTab] = useState<"criar" | "funil">("criar");
  const [historico, setHistorico] = useState<Orcamento[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [naNuvem, setNaNuvem] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [convertendo, setConvertendo] = useState<string | null>(null);
  // Orçamento recém-marcado como aceito, esperando a decisão sobre faturamento.
  const [perguntarVenda, setPerguntarVenda] = useState<Orcamento | null>(null);

  // Cliente
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null);
  const [clienteNome, setClienteNome] = useState("");
  const [clienteDocumento, setClienteDocumento] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");

  // Itens
  const novoItem = (): ItemOrcamento => ({
    // Contador simples: dois itens criados no mesmo milissegundo teriam o mesmo
    // id, então somamos um número aleatório curto.
    id: `it_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    tipo: "serviço",
    nome: "",
    quantidade: 1,
    valorUnitario: 0,
  });
  const [itens, setItens] = useState<ItemOrcamento[]>([novoItem()]);
  const [desconto, setDesconto] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [validade, setValidade] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });

  // Catálogo (premium)
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [itemDestino, setItemDestino] = useState<string | null>(null);

  // Visualização
  const [activePreviewQuote, setActivePreviewQuote] = useState<Orcamento | null>(null);
  const printableRef = useRef<HTMLDivElement>(null);
  const [isSavingQuotePdf, setIsSavingQuotePdf] = useState(false);

  /**
   * LOGO PRONTA PARA DESENHAR.
   *
   * `companyLogo` chega como URL do Firebase Storage (a imagem em si não cabe
   * no documento do Firestore, que tem teto de ~1 MiB). URL serve para a tag
   * <img> mas NÃO serve para o jsPDF, que precisa dos bytes. Buscamos uma vez
   * e guardamos como data URI — é isso que faz a logo finalmente aparecer no
   * PDF do orçamento.
   */
  const [logoPronta, setLogoPronta] = useState<string | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    if (planType !== "premium" || !companyLogo) { setLogoPronta(undefined); return; }
    carregarLogoBase64(companyLogo).then((b64) => { if (vivo) setLogoPronta(b64); });
    return () => { vivo = false; };
  }, [companyLogo, planType]);

  const subtotal = somaItens(itens);
  const descontoNum = Math.max(0, Number(desconto) || 0);
  const total = Math.max(0, subtotal - descontoNum);

  // --------------------------------------------------------------------------
  // CARGA E MIGRAÇÃO
  // --------------------------------------------------------------------------

  const chaveLocal = `meiflow_quotes_${userId || "anonymous"}`;

  const carregar = useCallback(async () => {
    if (!userId) return;
    setCarregando(true);
    try {
      const daNuvem = await fetchOrcamentosFromFirebase(userId);
      setNaNuvem(true);

      /**
       * MIGRAÇÃO DO LOCALSTORAGE, UMA VEZ SÓ.
       *
       * Quem já usava tem orçamentos guardados no navegador. Em vez de pedir
       * para ele redigitar, subimos o que só existe local. O critério é o id:
       * o que já está na nuvem fica como está, para não sobrescrever uma
       * mudança de situação feita no celular.
       */
      const bruto = localStorage.getItem(chaveLocal);
      const locais: Orcamento[] = bruto ? (JSON.parse(bruto) || []).map(normalizarOrcamento) : [];
      const idsNuvem = new Set(daNuvem.map((o) => o.id));
      const faltando = locais.filter((o) => o.id && !idsNuvem.has(o.id));

      if (faltando.length) {
        let n = Math.max(0, ...daNuvem.map((o) => Number(o.numero) || 0));
        for (const o of faltando) {
          if (!o.numero) o.numero = ++n;
          try { await saveOrcamentoToFirebase(userId, o); } catch { /* segue com os outros */ }
        }
        triggerToast(`✓ ${faltando.length} orçamento(s) do navegador enviados para a nuvem.`);
        const juntos = [...faltando, ...daNuvem]
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setHistorico(juntos);
      } else {
        setHistorico(daNuvem);
      }
    } catch (err) {
      // Sem nuvem, o histórico local ainda serve para consultar e imprimir.
      console.warn("Orçamentos: caindo para o armazenamento local.", err);
      setNaNuvem(false);
      const bruto = localStorage.getItem(chaveLocal);
      if (bruto) {
        try { setHistorico((JSON.parse(bruto) || []).map(normalizarOrcamento)); } catch { /* nada */ }
      }
    } finally {
      setCarregando(false);
    }
  }, [userId, chaveLocal, triggerToast]);

  useEffect(() => { carregar(); }, [carregar]);

  /** Espelha no navegador o que está na memória, como rede de segurança offline. */
  const espelharLocal = (lista: Orcamento[]) => {
    try { localStorage.setItem(chaveLocal, JSON.stringify(lista)); } catch { /* cota cheia */ }
  };

  // --------------------------------------------------------------------------
  // FORMULÁRIO
  // --------------------------------------------------------------------------

  const selectClientData = (cli: Cliente) => {
    setSelectedClient(cli);
    setClienteNome(cli.nome);
    setClienteDocumento(cli.documento || "");
    setClienteEmail(cli.email || "");
    setClienteTelefone(cli.telefone || "");
    setShowClientDropdown(false);
    triggerToast(`✓ Cliente ${cli.nome} vinculado!`);
  };

  const alterarItem = (id: string, campo: keyof ItemOrcamento, valor: any) => {
    setItens((atual) => atual.map((it) => (it.id === id ? { ...it, [campo]: valor } : it)));
  };

  const removerItem = (id: string) => {
    setItens((atual) => (atual.length <= 1 ? atual : atual.filter((it) => it.id !== id)));
  };

  const handleOpenCatalogPicker = async (destinoId: string) => {
    if (planType !== "premium") { onTriggerUpgrade(); return; }
    setItemDestino(destinoId);
    setShowCatalogModal(true);
    setLoadingCatalog(true);
    try {
      const snap = await getDocs(collection(db, "users", userId, "catalog"));
      setCatalogItems(snap.docs.map((s) => {
        const data = s.data();
        return { id: s.id, title: data.title || "", type: data.type || "serviço", price: Number(data.price) || 0 };
      }));
    } catch (err) {
      console.warn("Catálogo indisponível, usando cópia local:", err);
      const local = localStorage.getItem(`meiflow_catalog_${userId}`);
      if (local) { try { setCatalogItems(JSON.parse(local)); } catch { /* nada */ } }
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleSelectCatalogItem = (item: CatalogItem) => {
    if (itemDestino) {
      setItens((atual) => atual.map((it) => it.id === itemDestino
        ? { ...it, nome: item.title, tipo: item.type, valorUnitario: item.price }
        : it));
    }
    setShowCatalogModal(false);
    setItemDestino(null);
    triggerToast(`✓ Item "${item.title}" carregado do catálogo!`);
  };

  const handleCreateOrcamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;

    const limpos = itens
      .map((it) => ({ ...it, nome: it.nome.trim(), quantidade: Math.max(1, Number(it.quantidade) || 1), valorUnitario: Math.max(0, Number(it.valorUnitario) || 0) }))
      .filter((it) => it.nome);

    if (!clienteNome.trim()) { triggerToast("⚠ Informe o nome do cliente."); return; }
    if (!limpos.length) { triggerToast("⚠ Descreva pelo menos um item."); return; }
    if (somaItens(limpos) <= 0) { triggerToast("⚠ O orçamento precisa ter valor maior que zero."); return; }
    if (!validade) { triggerToast("⚠ Informe até quando a proposta vale."); return; }

    const totalFinal = Math.max(0, somaItens(limpos) - descontoNum);
    const proximoNumero = Math.max(0, ...historico.map((o) => Number(o.numero) || 0)) + 1;

    const novo: Orcamento = {
      id: "orc_" + Date.now(),
      numero: proximoNumero,
      clienteId: selectedClient?.id || "manual_input",
      clienteNome: clienteNome.trim(),
      clienteDocumento: clienteDocumento.trim() || undefined,
      clienteEmail: clienteEmail.trim() || undefined,
      clienteTelefone: clienteTelefone.trim() || undefined,
      itens: limpos,
      desconto: descontoNum,
      total: totalFinal,
      observacoes: observacoes.trim() || undefined,
      validade,
      situacao: "enviado",
      createdAt: new Date().toISOString(),
    };

    setSalvando(true);
    const lista = [novo, ...historico];
    setHistorico(lista);
    espelharLocal(lista);

    try {
      await saveOrcamentoToFirebase(userId, novo);
      setNaNuvem(true);
      triggerToast(`✓ Orçamento nº ${proximoNumero} salvo no funil!`);
    } catch {
      setNaNuvem(false);
      triggerToast("⚠ Orçamento gerado, mas não foi para a nuvem. Ficou salvo aqui.");
    } finally {
      setSalvando(false);
    }

    setActivePreviewQuote(novo);

    setSelectedClient(null);
    setClienteNome(""); setClienteDocumento(""); setClienteEmail(""); setClienteTelefone("");
    setItens([novoItem()]);
    setDesconto(""); setObservacoes("");
  };

  // --------------------------------------------------------------------------
  // FUNIL
  // --------------------------------------------------------------------------

  const moverPara = async (orc: Orcamento, situacao: SituacaoOrcamento) => {
    const atualizado = { ...orc, situacao, atualizadoEm: new Date().toISOString() };
    const lista = historico.map((o) => (o.id === orc.id ? atualizado : o));
    setHistorico(lista);
    espelharLocal(lista);
    try {
      await saveOrcamentoToFirebase(userId, atualizado);
    } catch {
      triggerToast("⚠ Mudança salva aqui, mas não subiu para a nuvem.");
    }

    /**
     * ACEITO SIGNIFICA VENDA FEITA.
     *
     * Marcar aceito e depois ter que lembrar de clicar em "lançar venda" é
     * pedir para o faturamento ficar errado — a pessoa marca, sai da tela e
     * esquece. Então perguntamos na hora.
     *
     * Perguntar em vez de lançar direto é de propósito: isso entra no
     * faturamento anual do MEI, que tem teto e reflete no DAS e na DASN. Valor
     * que aparece sozinho no faturamento é pior do que um clique a mais.
     */
    if (situacao === "aceito" && !atualizado.vendaId && onConverterEmVenda) {
      setPerguntarVenda(atualizado);
    }
  };

  /**
   * RÉGUA DE ACOMPANHAMENTO — registrar que falei com o cliente.
   *
   * Só isso: registra e agenda o próximo. Nada é enviado sozinho — quem manda a
   * mensagem é o usuário, pelo WhatsApp dele, com o texto que ele leu antes.
   */
  const marcarContatoFeito = async (orc: Orcamento, etapa: number) => {
    const atualizado = registrarContato(
      { ...orc, atualizadoEm: new Date().toISOString() },
      etapa
    ) as Orcamento;
    const lista = historico.map((o) => (o.id === orc.id ? atualizado : o));
    setHistorico(lista);
    espelharLocal(lista);
    try {
      await saveOrcamentoToFirebase(userId, atualizado);
    } catch {
      triggerToast("⚠ Contato registrado aqui, mas não subiu para a nuvem.");
    }
    triggerToast(
      etapa >= 3
        ? "✓ Último contato registrado. A bola está com o cliente."
        : `✓ Contato ${etapa} registrado. O próximo já está agendado.`
    );
  };

  /** Encerra o acompanhamento antes da hora, sem mexer na etapa do funil. */
  const encerrarAcompanhamento = async (orc: Orcamento) => {
    const atualizado = { ...orc, acompanhamentoEncerrado: true, atualizadoEm: new Date().toISOString() };
    const lista = historico.map((o) => (o.id === orc.id ? atualizado : o));
    setHistorico(lista);
    espelharLocal(lista);
    try { await saveOrcamentoToFirebase(userId, atualizado); } catch { /* já está na tela */ }
    triggerToast("✓ Não vou mais lembrar deste orçamento.");
  };

  const copiarMensagem = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      triggerToast("✓ Mensagem copiada.");
    } catch {
      triggerToast("⚠ Não consegui copiar. Selecione o texto e copie à mão.");
    }
  };

  const converter = async (orc: Orcamento) => {
    if (!onConverterEmVenda || convertendo) return;
    if (orc.vendaId) { triggerToast("ℹ Este orçamento já virou venda."); return; }
    setConvertendo(orc.id);
    try {
      const vendaId = await onConverterEmVenda(orc);
      if (!vendaId) return;
      const atualizado = { ...orc, vendaId, situacao: "aceito" as SituacaoOrcamento, atualizadoEm: new Date().toISOString() };
      const lista = historico.map((o) => (o.id === orc.id ? atualizado : o));
      setHistorico(lista);
      espelharLocal(lista);
      try { await saveOrcamentoToFirebase(userId, atualizado); } catch { /* já avisado */ }
      setPerguntarVenda(null);
      triggerToast("✓ Venda lançada no faturamento! Já pode emitir a nota fiscal.");
    } catch (err: any) {
      triggerToast(`⚠ ${err?.message || "Não consegui lançar a venda."}`);
    } finally {
      setConvertendo(null);
    }
  };

  const excluir = async (orc: Orcamento) => {
    if (!window.confirm(`Excluir o orçamento de ${orc.clienteNome}? Isso não apaga a venda, se já houver.`)) return;
    const lista = historico.filter((o) => o.id !== orc.id);
    setHistorico(lista);
    espelharLocal(lista);
    try { await deleteOrcamentoFromFirebase(userId, orc.id); } catch { /* já saiu da tela */ }
    triggerToast("✓ Orçamento excluído.");
  };

  /**
   * A LISTA DO DIA.
   *
   * Recalculada a cada render, a partir do próprio histórico — não há estado
   * paralelo para ficar desatualizado. Se o usuário marcar um contato, o item
   * some da lista na hora, porque a régua reconta.
   */
  const paraFazerHoje = tarefasDeHoje(historico);

  const porEtapa = (chave: SituacaoOrcamento) =>
    historico.filter((o) => (o.situacao || "enviado") === chave);

  // --------------------------------------------------------------------------
  // PDF
  // --------------------------------------------------------------------------

  /**
   * ⚠️ ESTAS DUAS LINHAS PRECISAM FICAR ANTES DE `baixarPdf`.
   *
   * Já perdemos uma tela inteira para isso noutro painel: um `const` usado por
   * uma função declarada acima dele quebra com "Cannot access before
   * initialization" assim que alguém mexe na ordem. Declarar antes custa nada e
   * tira o risco de vez.
   */
  const itensDaFolha = activePreviewQuote?.itens?.length
    ? activePreviewQuote.itens
    : normalizarOrcamento(activePreviewQuote || {}).itens || [];
  const subtotalFolha = somaItens(itensDaFolha);

  /**
   * BAIXAR PDF — desenhado, não fotografado.
   *
   * ⚠️ NÃO VOLTE A USAR html2canvas AQUI.
   *
   * A versão anterior chamava `saveHtmlElementAsPdf`, que fotografa o elemento
   * da tela. O usuário recebeu o resultado assim: texto miúdo, fonte serifada,
   * sem bordas, amontoado num canto da folha. A prova ficou no próprio arquivo
   * — a imagem embutida tinha 3808 px de largura para uma folha que na tela tem
   * 672 px. O html2canvas clona a página num quadro à parte e precisa recarregar
   * a folha de estilo; quando a captura acontece antes de o CSS chegar, ele
   * fotografa HTML cru. É uma corrida: funciona às vezes, falha outras. E a logo
   * nunca aparecia, porque a imagem vem do Storage e a resposta não traz o
   * cabeçalho que permitiria ao html2canvas desenhá-la.
   *
   * Agora o PDF é DESENHADO com jsPDF, pelo mesmo módulo em qualquer ambiente.
   * Sai sempre igual, em uma folha, com a logo, e o texto é selecionável.
   *
   * O botão Imprimir continua existindo para quem quiser mandar direto para a
   * impressora — e para esse caso o index.css deixa a folha apresentável.
   */
  const baixarPdf = async () => {
    if (!activePreviewQuote || isSavingQuotePdf) return;
    setIsSavingQuotePdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });

      const dados = {
        numero: activePreviewQuote.numero,
        createdAt: activePreviewQuote.createdAt,
        validade: activePreviewQuote.validade,
        clienteNome: activePreviewQuote.clienteNome,
        clienteDocumento: activePreviewQuote.clienteDocumento,
        clienteEmail: activePreviewQuote.clienteEmail,
        clienteTelefone: activePreviewQuote.clienteTelefone,
        itens: itensDaFolha,
        observacoes: activePreviewQuote.observacoes,
        desconto: Number(activePreviewQuote.desconto) || 0,
        total: Number(activePreviewQuote.total) || subtotalFolha,
      };

      desenharOrcamento(doc, dados, {
        meiName,
        cnpjPrestador,
        inscricaoMunicipal,
        telefonePrestador,
        // Se a logo ainda não terminou de baixar, buscamos agora em vez de
        // entregar um PDF sem ela.
        logoBase64: logoPronta || (planType === "premium" ? await carregarLogoBase64(companyLogo) : undefined),
        premium: planType === "premium",
      });

      await savePdfCrossPlatform(doc, nomeArquivoOrcamento(dados));
      triggerToast(isNativePlatform() ? "✓ PDF salvo em Downloads." : "✓ PDF gerado.");
    } catch (err) {
      console.error("Erro ao gerar PDF do orçamento:", err);
      triggerToast("⚠ Não consegui gerar o PDF.");
    } finally {
      setIsSavingQuotePdf(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in text-left font-sans">

      {/* ------------------------------------------------------------- topo */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onGoBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
        >
          <span>&larr; Voltar para o Início (Home)</span>
        </button>

        <div className="inline-flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/50">
          <button
            onClick={() => setActiveTab("criar")}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "criar" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Novo Orçamento
          </button>
          <button
            onClick={() => { setActiveTab("funil"); carregar(); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "funil" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Funil de Vendas ({historico.length})
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 pb-6 border-b border-slate-100">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
            <span>{activeTab === "criar" ? "Gerador de Orçamentos" : "Funil de Vendas"}</span>
            {planType === "premium" && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[9px] font-extrabold uppercase tracking-widest border border-blue-100">
                Premium Ativo
              </span>
            )}
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
            {activeTab === "criar"
              ? "Monte a proposta com quantos itens precisar. Ela entra no funil automaticamente."
              : "Acompanhe cada proposta até virar venda. O orçamento aceito lança no Livro Caixa com um clique."}
          </p>
        </div>

        {/* Onde os orçamentos estão guardados — informação que evita susto */}
        <div className="shrink-0">
          {naNuvem === false ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
              <CloudOff className="w-3.5 h-3.5" /> Salvo só neste aparelho
            </span>
          ) : naNuvem ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
              <Cloud className="w-3.5 h-3.5" /> Sincronizado na nuvem
            </span>
          ) : null}
        </div>
      </div>

      {activeTab === "criar" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          <form onSubmit={handleCreateOrcamento} className="lg:col-span-8 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/50 shadow-xs space-y-6">

            {/* -------------------------------------------------- cliente */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> 1. Cliente
                </h4>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowClientDropdown(!showClientDropdown)}
                    className="text-[10.5px] font-bold text-blue-600 hover:text-blue-800 transition-all cursor-pointer hover:underline"
                  >
                    Vincular Cliente Cadastrado &darr;
                  </button>

                  {showClientDropdown && (
                    <div className="absolute right-0 top-6 w-60 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2 text-xs divide-y divide-slate-100 max-h-48 overflow-y-auto">
                      {clientes.length === 0 ? (
                        <p className="p-2 text-slate-400 italic text-center">Nenhum cliente cadastrado.</p>
                      ) : (
                        clientes.map((cli) => (
                          <div
                            key={cli.id}
                            onClick={() => selectClientData(cli)}
                            className="p-2 hover:bg-slate-50 cursor-pointer rounded-lg text-left truncate"
                          >
                            <span className="font-bold text-slate-800 block truncate">{cli.nome}</span>
                            <span className="text-[10px] text-slate-400 font-mono block">{cli.documento || "Sem documento"}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {selectedClient && (
                <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
                  Vinculado a <strong>{selectedClient.nome}</strong>. Se este orçamento for aceito, a venda já
                  nasce com o cliente certo — e a nota fiscal também.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Nome ou Razão Social *</label>
                  <input
                    type="text" required placeholder="Ex.: Ana Souza Martins"
                    value={clienteNome} onChange={(e) => setClienteNome(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">CPF ou CNPJ (opcional)</label>
                  <input
                    type="text" placeholder="Ex.: 123.456.789-00"
                    value={clienteDocumento} onChange={(e) => setClienteDocumento(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">E-mail (opcional)</label>
                  <input
                    type="email" placeholder="Ex.: cliente@email.com"
                    value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Telefone (opcional)</label>
                  <input
                    type="text" placeholder="Ex.: (11) 98888-7777"
                    value={clienteTelefone} onChange={(e) => setClienteTelefone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* ---------------------------------------------------- itens */}
            <div className="space-y-3 pt-2 border-t border-slate-50">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Bookmark className="w-3.5 h-3.5" /> 2. Itens da Proposta
                </h4>
                <button
                  type="button"
                  onClick={() => setItens((a) => [...a, novoItem()])}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar item
                </button>
              </div>

              {itens.map((it, idx) => (
                <div key={it.id} className="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                      Item {idx + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      {planType === "premium" && (
                        <button
                          type="button"
                          onClick={() => handleOpenCatalogPicker(it.id)}
                          className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3 text-yellow-500" /> Catálogo
                        </button>
                      )}
                      {itens.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removerItem(it.id)}
                          className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1 bg-white p-1 rounded-xl border border-slate-200/60">
                    <button
                      type="button"
                      onClick={() => alterarItem(it.id, "tipo", "serviço")}
                      className={`py-1.5 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer transition-all ${
                        it.tipo === "serviço" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Wrench className="w-3.5 h-3.5" /> Serviço
                    </button>
                    <button
                      type="button"
                      onClick={() => alterarItem(it.id, "tipo", "produto")}
                      className={`py-1.5 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer transition-all ${
                        it.tipo === "produto" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Package className="w-3.5 h-3.5" /> Produto
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="Descrição — ex.: Instalação de 12 placas fotovoltaicas"
                    value={it.nome}
                    onChange={(e) => alterarItem(it.id, "nome", e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 outline-hidden"
                  />

                  <div className="grid grid-cols-3 gap-2.5 items-end">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Qtd.</label>
                      <input
                        type="number" min="1" step="1"
                        value={it.quantidade}
                        onChange={(e) => alterarItem(it.id, "quantidade", Math.max(1, Number(e.target.value) || 1))}
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 outline-hidden font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Valor unitário</label>
                      <input
                        type="number" step="0.01" min="0" placeholder="0,00"
                        value={it.valorUnitario || ""}
                        onChange={(e) => alterarItem(it.id, "valorUnitario", Math.max(0, Number(e.target.value) || 0))}
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 outline-hidden font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Subtotal</label>
                      <div className="px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-800 text-xs font-mono font-bold truncate">
                        {brl(it.quantidade * it.valorUnitario)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* --------------------------------------------- fechamento */}
            <div className="space-y-4 pt-2 border-t border-slate-50">
              <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" /> 3. Fechamento
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Desconto (R$)</label>
                  <input
                    type="number" step="0.01" min="0" placeholder="0,00"
                    value={desconto} onChange={(e) => setDesconto(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Proposta válida até *</label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="date" required value={validade}
                      onChange={(e) => setValidade(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Observações (aparecem na proposta)</label>
                <textarea
                  rows={3} maxLength={1000}
                  placeholder="Ex.: Prazo de execução de 20 dias após aprovação. Material incluso."
                  value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-hidden resize-y"
                />
              </div>

              <div className="bg-slate-900 text-white rounded-2xl p-4 flex items-center justify-between gap-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 space-y-0.5">
                  <div>Subtotal: <span className="font-mono text-slate-200">{brl(subtotal)}</span></div>
                  {descontoNum > 0 && <div>Desconto: <span className="font-mono text-slate-200">- {brl(descontoNum)}</span></div>}
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block">Total</span>
                  <span className="text-2xl font-bold font-mono tracking-tight">{brl(total)}</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={salvando}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider disabled:opacity-60"
            >
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 shrink-0" />}
              <span>{salvando ? "Salvando..." : "Gerar proposta e salvar no funil"}</span>
            </button>
          </form>

          {/* ------------------------------------------------- lateral */}
          <div className="lg:col-span-4 bg-slate-50 p-6 rounded-3xl border border-slate-200/40 text-left space-y-4 h-fit">
            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-500" /> Como funciona
            </h4>

            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              A proposta é salva na nuvem e entra no funil como <strong>Enviado</strong>. Conforme o cliente
              responde, você move para Negociando, Aceito ou Recusado. O aceito vira venda no Livro Caixa
              com um clique — e de lá sai a nota fiscal.
            </p>

            <div className="space-y-2 border-t border-slate-200/50 pt-3">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Marca d'água:</span>
              <p className="text-[11px] text-slate-500 leading-normal">
                {planType === "premium"
                  ? "✓ Conta Premium: PDF sem marca d'água e com seu logotipo."
                  : "⚠ No plano gratuito o rodapé traz a chancela “Gerado via MEI Flow”."}
              </p>
            </div>

            <div className="space-y-2 border-t border-slate-200/50 pt-3">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Seus dados na proposta:</span>
              <div className="space-y-1 font-mono text-[10px] text-slate-500 bg-white p-3 rounded-xl border border-slate-200/40">
                <div className="truncate"><strong className="text-slate-700">Emissor:</strong> {meiName}</div>
                <div className="truncate"><strong className="text-slate-700">CNPJ:</strong> {cnpjPrestador || "Não cadastrado"}</div>
                {inscricaoMunicipal && <div className="truncate"><strong className="text-slate-700">Insc. Mun:</strong> {inscricaoMunicipal}</div>}
                {telefonePrestador && <div className="truncate"><strong className="text-slate-700">Fone:</strong> {telefonePrestador}</div>}
              </div>
            </div>
          </div>

        </div>
      ) : (
        /* ================================================== FUNIL ============ */
        <div className="space-y-6">

          {/*
            ============================================================
            PARA FAZER HOJE — a régua dos três contatos
            ============================================================

            Proposta enviada e não respondida quase nunca é um "não"; costuma
            ser um "esqueci". Este painel transforma isso em tarefa do dia.

            ⚠️ NADA É ENVIADO SOZINHO, e isso é escolha, não limitação. Uma
               régua automática vira spam no dia em que der defeito, e quem
               paga é a reputação do MEI com o cliente dele. Aqui o sistema
               diz com quem falar e entrega o texto pronto; quem aperta o
               botão é uma pessoa.

            ⚠️ E não há nada para configurar. Ferramenta de acompanhamento que
               precisa ser ligada antes de servir nunca chega a ser usada.
               Quando não há ninguém para contatar, este painel some.
          */}
          {paraFazerHoje.length > 0 && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-amber-100/60 border-b border-amber-200 flex items-center gap-2">
                <BellRing className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-extrabold text-amber-900 uppercase tracking-wider">
                  Para fazer hoje
                </h3>
                <span className="text-[10px] font-extrabold text-amber-700 bg-white/70 border border-amber-200 px-1.5 py-0.5 rounded">
                  {paraFazerHoje.length}
                </span>
                <span className="hidden sm:block text-[10px] text-amber-700/80 font-medium ml-1">
                  propostas esperando um retorno seu
                </span>
              </div>

              <div className="divide-y divide-amber-200/60">
                {paraFazerHoje.map(({ orcamento: orc, contato }) => {
                  const link = linkWhatsApp(orc.clienteTelefone, contato.mensagem);
                  return (
                    <div key={orc.id} className="p-4 space-y-2.5 text-left">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800">
                            {orc.clienteNome}
                            {orc.numero ? <span className="text-slate-400 font-normal"> · nº {orc.numero}</span> : null}
                          </p>
                          <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                            {contato.titulo} · proposta enviada há {contato.diasDesdeOEnvio} dia(s) · {brl(Number(orc.total) || 0)}
                          </p>
                        </div>
                        <span className={`shrink-0 text-[9px] font-extrabold uppercase tracking-wider px-2 py-1 rounded-md border ${
                          contato.diasDeAtraso > 0
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-white text-amber-700 border-amber-200"
                        }`}>
                          {rotuloDoPrazo(contato)}
                        </span>
                      </div>

                      {/* A mensagem inteira, à vista. Ninguém manda um texto que não leu. */}
                      <p className="text-[11px] text-slate-600 leading-relaxed bg-white border border-amber-200/70 rounded-xl p-3">
                        {contato.mensagem}
                      </p>
                      <p className="text-[10px] text-slate-400 italic">{contato.porque}</p>

                      <div className="flex items-center gap-2 flex-wrap">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1.5 cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5" /> Abrir no WhatsApp
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">
                            Sem telefone no cadastro — copie a mensagem.
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => copiarMensagem(contato.mensagem)}
                          className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copiar
                        </button>
                        <button
                          type="button"
                          onClick={() => marcarContatoFeito(orc, contato.etapa)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCheck className="w-3.5 h-3.5" /> Já falei
                        </button>

                        <div className="flex-1" />

                        <button
                          type="button"
                          onClick={() => encerrarAcompanhamento(orc)}
                          className="text-[10px] text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
                          title="Para de lembrar deste orçamento, sem mexer na etapa do funil"
                        >
                          Não lembrar mais
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Placar das etapas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {ETAPAS.map((et) => {
              const lista = porEtapa(et.chave);
              const soma = lista.reduce((s, o) => s + (Number(o.total) || 0), 0);
              const c = CORES[et.cor];
              const Icone = et.icone;
              return (
                <div key={et.chave} className={`bg-white border rounded-2xl p-4 ${c.caixa}`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icone className={`w-3.5 h-3.5 ${c.texto}`} />
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">{et.rotulo}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-900 leading-none">{lista.length}</p>
                  <p className="text-[11px] text-slate-400 font-mono mt-1">{brl(soma)}</p>
                </div>
              );
            })}
          </div>

          {/* Taxa de conversão */}
          {historico.length > 0 && (() => {
            const decididos = porEtapa("aceito").length + porEtapa("recusado").length;
            const taxa = decididos ? Math.round((porEtapa("aceito").length / decididos) * 100) : 0;
            return (
              <div className="bg-white border border-slate-200/60 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Taxa de fechamento
                  </span>
                  <span className="text-sm font-extrabold text-slate-800">{taxa}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${taxa}%` }} />
                </div>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">
                  De {decididos} proposta(s) que o cliente respondeu, {porEtapa("aceito").length} fechou.
                  {porEtapa("enviado").length + porEtapa("negociando").length > 0 &&
                    ` Ainda há ${porEtapa("enviado").length + porEtapa("negociando").length} em aberto.`}
                </p>
              </div>
            );
          })()}

          {carregando && historico.length === 0 ? (
            <div className="flex justify-center py-16 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : historico.length === 0 ? (
            <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8 space-y-2">
              <p className="text-sm text-slate-400 italic">Nenhum orçamento no funil ainda.</p>
              <button
                onClick={() => setActiveTab("criar")}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-bold cursor-pointer"
              >
                Gerar minha primeira proposta &rarr;
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {ETAPAS.map((et) => {
                const lista = porEtapa(et.chave);
                if (!lista.length) return null;
                const c = CORES[et.cor];
                return (
                  <div key={et.chave} className="space-y-3">
                    <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] ${c.chip}`}>
                        {et.rotulo}
                      </span>
                      <span className="text-slate-300 font-normal">{lista.length}</span>
                    </h3>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {lista.map((orc) => {
                        const vencido = orc.validade && new Date(orc.validade + "T23:59:59") < new Date();
                        return (
                          <div key={orc.id} className="bg-white border border-slate-200/60 rounded-2xl p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">
                                  {orc.clienteNome}
                                  {orc.numero ? <span className="text-slate-300 font-normal"> · nº {orc.numero}</span> : null}
                                </p>
                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                                  {(orc.itens || []).length} item(ns) · criado em {dataBR(orc.createdAt)}
                                </p>
                              </div>
                              <span className="shrink-0 text-sm font-extrabold text-slate-900 font-mono">
                                {brl(Number(orc.total) || 0)}
                              </span>
                            </div>

                            <p className="text-[11px] text-slate-500 truncate">
                              {(orc.itens || []).map((i) => i.nome).filter(Boolean).join(" · ") || "Sem descrição"}
                            </p>

                            <div className="flex items-center gap-2 flex-wrap text-[10px]">
                              <span className={`font-bold ${vencido && et.chave !== "aceito" ? "text-red-600" : "text-slate-400"}`}>
                                {vencido ? "Venceu" : "Vale até"} {dataBR(orc.validade)}
                              </span>

                              {/*
                                Selo da régua: um pedaço de texto, sem botão.
                                Quem age é o painel "Para fazer hoje" lá em
                                cima; aqui o cartão só conta em que pé está,
                                para o funil continuar legível de relance.
                              */}
                              {(() => {
                                const c = proximoContato(orc);
                                if (!c) {
                                  return orc.acompanhamentoEncerrado ? (
                                    <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                                      <Clock className="w-2.5 h-2.5" /> Acompanhamento encerrado
                                    </span>
                                  ) : null;
                                }
                                return (
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wide border ${
                                    c.diasDeAtraso > 0 ? "bg-red-50 text-red-700 border-red-200"
                                      : c.diasDeAtraso === 0 ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-slate-50 text-slate-500 border-slate-200"
                                  }`}>
                                    <BellRing className="w-2.5 h-2.5" /> {rotuloDoPrazo(c)}
                                  </span>
                                );
                              })()}
                              {orc.vendaId && (
                                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wide">
                                  <ShoppingCart className="w-2.5 h-2.5" /> Virou venda
                                </span>
                              )}
                            </div>

                            {/* Ações: mover no funil, converter, ver, excluir */}
                            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                              {ETAPAS.filter((o) => o.chave !== et.chave).map((destino) => (
                                <button
                                  key={destino.chave}
                                  onClick={() => moverPara(orc, destino.chave)}
                                  className="px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                                  title={`Mover para ${destino.rotulo}`}
                                >
                                  {destino.chave === "aceito" ? <ArrowRight className="w-3 h-3 inline" /> :
                                   destino.chave === "recusado" ? <XCircle className="w-3 h-3 inline" /> :
                                   destino.chave === "enviado" ? <ArrowLeft className="w-3 h-3 inline" /> :
                                   <TrendingUp className="w-3 h-3 inline" />}
                                  <span className="ml-1">{destino.rotulo}</span>
                                </button>
                              ))}

                              <div className="flex-1" />

                              {et.chave === "aceito" && !orc.vendaId && onConverterEmVenda && (
                                <button
                                  onClick={() => converter(orc)}
                                  disabled={convertendo === orc.id}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-extrabold cursor-pointer uppercase tracking-wide disabled:opacity-60 flex items-center gap-1"
                                >
                                  {convertendo === orc.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <ShoppingCart className="w-3 h-3" />}
                                  Lançar venda
                                </button>
                              )}

                              <button
                                onClick={() => setActivePreviewQuote(orc)}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[10px] font-bold cursor-pointer"
                              >
                                Ver / PDF
                              </button>
                              <button
                                onClick={() => excluir(orc)}
                                className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                                title="Excluir orçamento"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ catálogo (premium) */}
      {showCatalogModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto print:hidden">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col max-h-[500px] my-auto">
            <div className="pt-safe px-6 pb-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <span>Escolher do seu Catálogo</span>
              </h3>
              <button
                onClick={() => { setShowCatalogModal(false); setItemDestino(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text" placeholder="Pesquisar itens cadastrados..."
                  value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 text-xs focus:ring-1 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>

            <div className="grow p-4 overflow-y-auto divide-y divide-slate-100">
              {loadingCatalog ? (
                <div className="py-12 flex flex-col items-center justify-center gap-1 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  <span className="text-xs">Buscando itens...</span>
                </div>
              ) : catalogItems.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <p className="text-xs italic">Você não possui itens no catálogo.</p>
                  <p className="text-[10px] mt-1">Cadastre em 'Catálogo', na tela inicial.</p>
                </div>
              ) : (
                catalogItems
                  .filter((item) => item.title.toLowerCase().includes(catalogSearch.toLowerCase()))
                  .map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectCatalogItem(item)}
                      className="py-3 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 rounded-lg -mx-1 px-2 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                          item.type === "serviço" ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                        }`}>
                          {item.type === "serviço" ? <Wrench className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-xs font-bold text-slate-800 truncate block">{item.title}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-900 font-mono">{brl(item.price)}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------- aceito: lançar no faturamento? -------- */}
      {perguntarVenda && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-5 print:hidden">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 space-y-4 shadow-xl text-left">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-slate-900">Orçamento aceito!</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">
                  {perguntarVenda.clienteNome} · {brl(Number(perguntarVenda.total) || 0)}
                </p>
              </div>
            </div>

            <p className="text-[12px] text-slate-600 leading-relaxed">
              Quer lançar essa venda no <strong>faturamento</strong> agora? Ela entra no Livro Caixa como
              entrada, passa a contar no seu faturamento anual do MEI e fica pronta para emitir nota fiscal.
            </p>

            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
              Se o cliente aceitou mas ainda não pagou, você pode só marcar como aceito agora e lançar
              depois, quando o dinheiro entrar. O botão "Lançar venda" continua no cartão.
            </p>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => converter(perguntarVenda)}
                disabled={!!convertendo}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl cursor-pointer uppercase tracking-wide disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {convertendo
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ShoppingCart className="w-4 h-4" />}
                Lançar {brl(Number(perguntarVenda.total) || 0)} no faturamento
              </button>
              <button
                type="button"
                onClick={() => setPerguntarVenda(null)}
                disabled={!!convertendo}
                className="w-full py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-2xl cursor-pointer disabled:opacity-50"
              >
                Só marcar como aceito, lanço depois
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================ VISUALIZADOR / FOLHA === */}
      {activePreviewQuote && createPortal((
        <div id="print-overlay" className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex justify-center items-start p-4 sm:p-6 md:p-10 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col my-4 sm:my-8">

            <div className="pt-safe px-6 pb-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between print:hidden">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span>Proposta nº {activePreviewQuote.numero || "—"}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button" onClick={baixarPdf} disabled={isSavingQuotePdf}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {isSavingQuotePdf
                    ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Gerando...</span></>
                    : <><Download className="w-4 h-4 text-blue-100" /><span>Baixar PDF</span></>}
                </button>
                {!isNativePlatform() && (
                  <button
                    type="button" onClick={() => window.print()}
                    className="px-3 py-2 bg-white hover:bg-slate-200 text-slate-600 border border-slate-200 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5"
                    title="Mandar direto para a impressora"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setActivePreviewQuote(null)}
                  className="bg-white hover:bg-slate-200 text-slate-600 border border-slate-200 p-2 rounded-xl cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/*
              A FOLHA.
              `data-folha` é o gancho do index.css que transforma isto em papel
              A4 na impressão. Compacta de propósito: espaçamentos generosos
              ficam bonitos na tela e empurram o conteúdo para a segunda página.
            */}
            <div
              ref={printableRef}
              data-folha="orcamento"
              className="p-6 md:p-8 space-y-5 bg-white font-sans text-slate-800"
            >
              {/* cabeçalho */}
              <div className="flex justify-between items-start gap-6 border-b border-slate-300/80 pb-4">
                <div className="space-y-1.5 max-w-sm text-left">
                  {/*
                    Preferimos a logo já convertida (`logoPronta`). Ela é a
                    mesma imagem, só que embutida — o que garante que a
                    impressão do navegador também a desenhe, em vez de deixar
                    um buraco branco esperando a rede.
                  */}
                  {planType === "premium" && (logoPronta || companyLogo) ? (
                    <div className="mb-1.5 shrink-0 max-w-[180px] max-h-12 overflow-hidden rounded-lg">
                      <img src={logoPronta || companyLogo} alt="Logo" referrerPolicy="no-referrer" className="h-9 object-contain block border-0" />
                    </div>
                  ) : null}
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-tight uppercase">{meiName}</h2>
                  <div className="space-y-0.5 text-slate-500 font-medium text-[11px]">
                    {cnpjPrestador && <p className="font-mono">CNPJ: {cnpjPrestador}</p>}
                    {inscricaoMunicipal && <p className="font-mono">Insc. Municipal: {inscricaoMunicipal}</p>}
                    {telefonePrestador && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3 text-slate-400" /> {telefonePrestador}</p>}
                  </div>
                </div>

                <div className="text-right space-y-1.5 shrink-0">
                  <div className="inline-block bg-slate-900 text-white font-bold text-[10px] tracking-widest uppercase px-3 py-1.5 rounded-md">
                    Orçamento
                  </div>
                  <p className="text-slate-800 font-bold text-sm">Nº {activePreviewQuote.numero || "—"}</p>
                  <p className="text-slate-500 text-[11px] font-medium">Emitido em {dataBR(activePreviewQuote.createdAt)}</p>
                </div>
              </div>

              {/* cliente */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/60 space-y-1.5 text-left">
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">Cliente</span>
                <h4 className="text-sm font-bold text-slate-800 leading-tight">{activePreviewQuote.clienteNome}</h4>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500 font-semibold pt-0.5">
                  {activePreviewQuote.clienteDocumento && (
                    <span><span className="text-slate-400 font-normal">CPF/CNPJ: </span>
                      <span className="font-mono text-slate-700">{activePreviewQuote.clienteDocumento}</span></span>
                  )}
                  {activePreviewQuote.clienteEmail && (
                    <span><span className="text-slate-400 font-normal">E-mail: </span>
                      <span className="text-slate-700">{activePreviewQuote.clienteEmail}</span></span>
                  )}
                  {activePreviewQuote.clienteTelefone && (
                    <span><span className="text-slate-400 font-normal">Telefone: </span>
                      <span className="text-slate-700">{activePreviewQuote.clienteTelefone}</span></span>
                  )}
                </div>
              </div>

              {/* itens */}
              <div className="space-y-2">
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block text-left">Itens</span>
                <div className="border border-slate-200/80 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-[11px] bg-white text-slate-600">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="py-2 px-3 font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">Descrição</th>
                        <th className="py-2 px-2 font-extrabold text-slate-500 uppercase tracking-wider text-[9px] text-center">Qtd.</th>
                        <th className="py-2 px-2 font-extrabold text-slate-500 uppercase tracking-wider text-[9px] text-right">Unit.</th>
                        <th className="py-2 px-3 font-extrabold text-slate-500 uppercase tracking-wider text-[9px] text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                      {itensDaFolha.map((it) => (
                        <tr key={it.id}>
                          <td className="py-2.5 px-3 text-slate-800 break-words">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                              it.tipo === "serviço" ? "bg-amber-400" : "bg-emerald-400"
                            }`} />
                            {it.nome}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono">{it.quantidade}</td>
                          <td className="py-2.5 px-2 text-right font-mono">{brl(it.valorUnitario)}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-950">
                            {brl(it.quantidade * it.valorUnitario)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* observações */}
              {activePreviewQuote.observacoes && (
                <div className="text-left space-y-1">
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">Observações</span>
                  <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">
                    {activePreviewQuote.observacoes}
                  </p>
                </div>
              )}

              {/* total e validade */}
              <div className="flex justify-between items-stretch gap-4 bg-slate-900 text-white rounded-2xl p-4 text-left">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">Validade</span>
                  <p className="text-xs font-bold text-blue-300 font-mono">{dataBR(activePreviewQuote.validade)}</p>
                  {Number(activePreviewQuote.desconto) > 0 && (
                    <p className="text-[10px] text-slate-400 pt-1">
                      Subtotal {brl(subtotalFolha)} · desconto {brl(Number(activePreviewQuote.desconto))}
                    </p>
                  )}
                </div>
                <div className="text-right flex flex-col justify-center items-end">
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">Valor total</span>
                  <span className="text-2xl font-bold font-mono tracking-tight text-white leading-tight">
                    {brl(Number(activePreviewQuote.total) || subtotalFolha)}
                  </span>
                </div>
              </div>

              {/* assinaturas */}
              <div className="grid grid-cols-2 gap-8 pt-8">
                <div className="text-center">
                  <div className="border-t border-slate-300 w-full mx-auto max-w-[190px] pt-1 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    Assinatura do Emissor
                  </div>
                </div>
                <div className="text-center">
                  <div className="border-t border-slate-300 w-full mx-auto max-w-[190px] pt-1 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    Aceite do Cliente
                  </div>
                </div>
              </div>

              {/* rodapé */}
              <div className="pt-3 border-t border-slate-100 text-center">
                {planType === "premium" ? (
                  <p className="text-[9px] text-slate-400 font-medium">
                    Obrigado por nos escolher! Atenciosamente, {meiName}.
                  </p>
                ) : (
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                    Gerado eletronicamente via MEI Flow
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5 print:hidden">
              <button
                onClick={() => setActivePreviewQuote(null)}
                className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Voltar
              </button>
            </div>

          </div>
        </div>
      ), document.body)}

    </div>
  );
}
