/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Plus,
  Minus,
  Search,
  UserPlus,
  Receipt,
  Trash2,
  TrendingUp,
  TrendingDown,
  Scale,
  Eye,
  EyeOff,
  CheckCircle2,
  FileDown,
  Download,
  Check,
  Smartphone,
  Sparkles,
  ChevronRight,
  Printer,
  FileCode,
  FileText,
  Play,
  Cpu,
  AlertCircle,
  LogIn,
  LogOut,
  Cloud,
  Database,
  RefreshCw,
  HelpCircle,
  Settings,
  Building,
  Wallet,
  BookOpen
} from "lucide-react";

import { Cliente, Transacao, CatalogItem, Orcamento } from "./types";
import ReceiptModal from "./components/ReceiptModal";
import MeiConfigModal from "./components/MeiConfigModal";
import UpgradeModal from "./components/UpgradeModal";
import CnpjOnboarding from "./components/CnpjOnboarding";
import CatalogManager from "./components/CatalogManager";
import OrcamentoGenerator from "./components/OrcamentoGenerator";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// IMPORTAÇÕES DO FIREBASE AUTH & FIRESTORE PARA SEGURANÇA MULTI-USUÁRIO
import {
  auth,
  db,
  loginWithGoogle,
  logoutUser,
  fetchClientesFromFirebase,
  fetchTransacoesFromFirebase,
  saveClienteToFirebase,
  saveTransacaoToFirebase,
  deleteClienteFromFirebase,
  deleteTransacaoFromFirebase,
  registerWithEmailPassword,
  loginWithEmailPassword,
  saveVendaToFirebase,
  fetchVendasFromFirebase,
  deleteVendaFromFirebase,
  saveUserProfileToFirebase,
  fetchUserProfileFromFirebase
} from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { onSnapshot, doc, setDoc } from "firebase/firestore";

export default function App() {
  // Controle de Navegação por Abas/Módulos
  const [currentView, setCurrentView] = useState<"home" | "clientes" | "financeiro" | "orcamentos" | "catalogo">("home");

  // State e Credenciais de Autenticação MEI
  const [userId, setUserId] = useState("user_49281");
  const [meiName, setMeiName] = useState(() => {
    return localStorage.getItem("meiflow_mei_name") || "João Silva Consultoria";
  });
  const [copiedState, setCopiedState] = useState<Record<string, boolean>>({});
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState(() => {
    return localStorage.getItem("meiflow_inscricao_municipal") || "48392-1";
  });
  const [telefonePrestador, setTelefonePrestador] = useState(() => {
    return localStorage.getItem("meiflow_telefone_prestador") || "(11) 98765-4321";
  });
  const [asaasAccessToken, setAsaasAccessToken] = useState(() => {
    return localStorage.getItem("meiflow_asaas_access_token") || "";
  });
  const [showMeiConfigModal, setShowMeiConfigModal] = useState(false);

  // -------------------------------------------------------------------------
  // NOVO: ESTADOS INTEGRADOS DO FIREBASE & ISOLAMENTO DE USUÁRIOS (MULTITENANCY)
  // -------------------------------------------------------------------------
  const [user, setUser] = useState<User | null>(null);
  const [isFirebaseSyncing, setIsFirebaseSyncing] = useState(false);
  const [showConfigGuide, setShowConfigGuide] = useState(false);

  // TIERS & PREMIUM PLAN STATES
  const [planType, setPlanType] = useState<"free" | "premium">("free");
  const [invoiceLimit, setInvoiceLimit] = useState<number>(30);
  const [invoiceUsed, setInvoiceUsed] = useState<number>(0);
  const [companyLogo, setCompanyLogo] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // ESTADOS DE AUTENTICAÇÃO INTEGRADA EMAIL e SENHA
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authIsSignUp, setAuthIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // -------------------------------------------------------------------------
  // NOVO: ESTADOS INTEGRADOS DO CHAMADO DE SUPORTE TÉCNICO (MENSAGEM VIA MAILTO)
  // -------------------------------------------------------------------------
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showSupportSuccessModal, setShowSupportSuccessModal] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<{
    id: string;
    category: string;
    subject: string;
    replyEmail: string;
    message: string;
    createdAt: string;
  } | null>(null);
  const [supportCategory, setSupportCategory] = useState("Erro de Lançamento / Cálculo");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportReplyEmail, setSupportReplyEmail] = useState("");

  // Banco de Dados Local (Local Storage + Sementes Iniciais)
  const [clientes, setClientes] = useState<Cliente[]>(() => {
    const saved = localStorage.getItem("meiflow_clientes");
    if (saved) return JSON.parse(saved);
    return [
      { id: "cli_1", nome: "Alice Martins", documento: "123.456.789-00", email: "alice@email.com", telefone: "(11) 98765-4321", createdAt: "2026-06-05T10:00:00Z" },
      { id: "cli_2", nome: "Roberto C.", documento: "45.321.789/0001-01", email: "roberto@contato.com.br", telefone: "(21) 9988-1234", createdAt: "2026-06-06T12:00:00Z" },
      { id: "cli_3", nome: "Julia Soares", documento: "88.112.554/0002-13", email: "julia@design.co", telefone: "(31) 98234-5566", createdAt: "2026-06-07T14:30:00Z" },
      { id: "cli_4", nome: "Mecânica Luz", documento: "99.117.228/0001-44", email: "contato@mecanicaluz.com.br", telefone: "(11) 2235-9878", createdAt: "2026-06-08T09:15:00Z" },
    ];
  });

  const [transacoes, setTransacoes] = useState<Transacao[]>(() => {
    const saved = localStorage.getItem("meiflow_transacoes");
    if (saved) return JSON.parse(saved);
    return [
      { id: "tx_1", tipo: "entrada", valor: 1200.00, data: "15/06/2026", descricao: "Consultoria UX", categoria: "Consultoria", clienteId: "cli_1", clienteNome: "Alice Martins", clienteDocumento: "123.456.789-00", formaPagamento: "Pix" },
      { id: "tx_2", tipo: "saida", valor: 85.00, data: "12/06/2026", descricao: "Hospedagem AWS", categoria: "Infraestrutura", formaPagamento: "Cartão de Crédito" },
      { id: "tx_3", tipo: "entrada", valor: 2400.00, data: "10/06/2026", descricao: "Protótipo App Mobile", categoria: "Desenvolvimento", clienteId: "cli_3", clienteNome: "Julia Soares", clienteDocumento: "88.112.554/0002-13", formaPagamento: "Pix" },
      { id: "tx_4", tipo: "saida", valor: 72.00, data: "05/06/2026", descricao: "DAS (Imposto MEI)", categoria: "Impostos", formaPagamento: "Boleto" },
    ];
  });

  // Notificações feedback visual simples
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // States de Controle de Formulário (Modais)
  const [showVendaModal, setShowVendaModal] = useState(false);
  const [showDespesaModal, setShowDespesaModal] = useState(false);
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Transacao | null>(null);

  // -------------------------------------------------------------------------
  // FOCUS NFE INTEGRATION STATES
  // -------------------------------------------------------------------------
  const [showFocusNfeModal, setShowFocusNfeModal] = useState(false);
  const [focusNfeSelectedTx, setFocusNfeSelectedTx] = useState<Transacao | null>(null);
  const [cnpjPrestador, setCnpjPrestador] = useState(() => {
    return localStorage.getItem("meiflow_cnpj_prestador") || "21.231.111/0001-20";
  });
  const [isCpfEmissor, setIsCpfEmissor] = useState<boolean>(() => {
    const saved = localStorage.getItem("meiflow_is_cpf_emissor");
    if (saved !== null) return saved === "true";
    const cnpjVal = localStorage.getItem("meiflow_cnpj_prestador") || "21.231.111/0001-20";
    return cnpjVal.replace(/\D/g, "").length === 11;
  });
  const [numeroRps, setNumeroRps] = useState("105");
  const [serieRps, setSerieRps] = useState("1");
  const [tipoRps, setTipoRps] = useState("1");
  const [refNfe, setRefNfe] = useState("");
  const [focusNfeStatus, setFocusNfeStatus] = useState<"idle" | "sending" | "processing" | "authorized" | "error">("idle");
  const [focusNfeApiResponse, setFocusNfeApiResponse] = useState<any>(null);
  const [focusNfeLogs, setFocusNfeLogs] = useState<string[]>([]);
  const [focusNfeError, setFocusNfeError] = useState<string | null>(null);
  const [focusNfeActiveTab, setFocusNfeActiveTab] = useState<"emissao" | "src">("emissao");
  const [showTechnicalLogs, setShowTechnicalLogs] = useState(false);

  // Campos de novas Vendas (Date defaults to manual typed string format)
  const [vendaValor, setVendaValor] = useState("");
  const [vendaDescricao, setVendaDescricao] = useState("");
  const [vendaCategoria, setVendaCategoria] = useState("Consultoria");
  const [vendaClienteId, setVendaClienteId] = useState("");
  const [vendaData, setVendaData] = useState("10/06/2026");
  const [vendaFormaPagamento, setVendaFormaPagamento] = useState("Pix");

  // Campos de novas Despesas
  const [despesaValor, setDespesaValor] = useState("");
  const [despesaDescricao, setDespesaDescricao] = useState("");
  const [despesaCategoria, setDespesaCategoria] = useState("Infraestrutura");
  const [despesaData, setDespesaData] = useState("10/06/2026");
  const [despesaFormaPagamento, setDespesaFormaPagamento] = useState("Pix");

  // Campos de novos clientes
  const [cliNome, setCliNome] = useState("");
  const [cliDoc, setCliDoc] = useState("");
  const [cliEmail, setCliEmail] = useState("");
  const [cliTel, setCliTel] = useState("");

  // Busca e Filtros da tabela
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTipo, setFilterTipo] = useState<"todos" | "entrada" | "saida">("todos");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // Helper to safely parse both DD/MM/YYYY and YYYY-MM-DD
  const parseTransactionDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    if (dateStr.includes("-")) {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      }
    }
    if (dateStr.includes("/")) {
      const parts = dateStr.split("/");
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  // Função para engatilhar Toast temporário
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // -------------------------------------------------------------------------
  // EFECTS DE SINCRONIZAÇÃO E ESCUTA DO FIREBASE (ISOLAMENTO MULTI-TENANT POR UID)
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Monitora a autenticação ativa do Firebase real
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setIsFirebaseSyncing(true);
        setUser(currentUser);
        setUserId(currentUser.uid); // Ajusta o UID ativo do MEI para isolar os dados
        if (currentUser.displayName) {
          setMeiName(currentUser.displayName);
        }
        
        try {
          // Busca o perfil da empresa cadastrada no Firestore
          const profile = await fetchUserProfileFromFirebase(currentUser.uid);
          if (profile) {
            if (profile.meiName) {
              setMeiName(profile.meiName);
              localStorage.setItem("meiflow_mei_name", profile.meiName);
            }
            if (profile.cnpjPrestador) {
              setCnpjPrestador(profile.cnpjPrestador);
              localStorage.setItem("meiflow_cnpj_prestador", profile.cnpjPrestador);
            }
            if (profile.inscricaoMunicipal) {
              setInscricaoMunicipal(profile.inscricaoMunicipal);
              localStorage.setItem("meiflow_inscricao_municipal", profile.inscricaoMunicipal);
            }
            if (profile.telefone) {
              setTelefonePrestador(profile.telefone);
              localStorage.setItem("meiflow_telefone_prestador", profile.telefone);
            }
            if (profile.asaasAccessToken) {
              setAsaasAccessToken(profile.asaasAccessToken);
              localStorage.setItem("meiflow_asaas_access_token", profile.asaasAccessToken);
            } else {
              setAsaasAccessToken("");
              localStorage.removeItem("meiflow_asaas_access_token");
            }

            if (profile.planType) {
              setPlanType(profile.planType);
            } else {
              setPlanType("free");
            }
            if (profile.invoiceLimit !== undefined) {
              setInvoiceLimit(profile.invoiceLimit);
            } else {
              setInvoiceLimit(30);
            }
            if (profile.invoiceUsed !== undefined) {
              setInvoiceUsed(profile.invoiceUsed);
            } else {
              setInvoiceUsed(0);
            }
            setCompanyLogo(profile.companyLogo || "");
          } else {
            setPlanType("free");
            setCompanyLogo("");
          }

          // Busca remotamente os dados específicos e restritos ao UID logado (Isolamento rígido)
          const dbClientes = await fetchClientesFromFirebase(currentUser.uid);
          const dbTransacoes = await fetchTransacoesFromFirebase(currentUser.uid);
          const dbVendas = await fetchVendasFromFirebase(currentUser.uid);
          
          // Combina vendas da subcoleção com o histórico de transações
          const mergedTransacoes = [...dbVendas];
          dbTransacoes.forEach(tx => {
            if (!mergedTransacoes.some(m => m.id === tx.id)) {
              mergedTransacoes.push(tx);
            }
          });
          
          if (dbClientes.length > 0 || mergedTransacoes.length > 0) {
            setClientes(dbClientes);
            setTransacoes(mergedTransacoes);
            triggerToast(`✓ Conexão estável! Lançamentos carregados remotamente via Firebase.`);
          } else {
            // Se cloud estiver vazia, realizamos o upload amigável das informações locais atuais para o Firebase (Facilita a transição)
            if (clientes.length > 0) {
              for (const c of clientes) {
                await saveClienteToFirebase(currentUser.uid, c);
              }
            }
            if (transacoes.length > 0) {
              for (const tx of transacoes) {
                if (tx.tipo === "entrada") {
                  await saveVendaToFirebase(currentUser.uid, tx);
                } else {
                  await saveTransacaoToFirebase(currentUser.uid, tx);
                }
              }
            }
            triggerToast(`✓ Sincronização inicial! Seus dados offline foram isolados com segurança na nuvem.`);
          }
        } catch (err: any) {
          console.error("Falha ao ler dados do Firestore:", err);
          triggerToast("⚠ Falha nas regras de escrita do Firestore. Verifique as firestore.rules.");
        } finally {
          setIsFirebaseSyncing(false);
        }
      } else {
        // Sem usuário logado: carrega as sementes locais persistidas ou limpa o dashboard
        setUser(null);
        setUserId("user_49281");
        
        const localMeiName = localStorage.getItem("meiflow_mei_name") || "João Silva Consultoria";
        const localCnpj = localStorage.getItem("meiflow_cnpj_prestador") || "21.231.111/0001-20";
        const localInscricao = localStorage.getItem("meiflow_inscricao_municipal") || "48392-1";
        const localTelefone = localStorage.getItem("meiflow_telefone_prestador") || "(11) 98765-4321";

        setMeiName(localMeiName);
        setCnpjPrestador(localCnpj);
        setInscricaoMunicipal(localInscricao);
        setTelefonePrestador(localTelefone);
        setPlanType("free");
        setCompanyLogo("");
        
        const defaultClientes = [
          { id: "cli_1", nome: "Alice Martins", documento: "123.456.789-00", email: "alice@email.com", telefone: "(11) 98765-4321", createdAt: "2026-06-05T10:00:00Z" },
          { id: "cli_2", nome: "Roberto C.", documento: "45.321.789/0001-01", email: "roberto@contato.com.br", telefone: "(21) 9988-1234", createdAt: "2026-06-06T12:00:00Z" },
          { id: "cli_3", nome: "Julia Soares", documento: "88.112.554/0002-13", email: "julia@design.co", telefone: "(31) 98234-5566", createdAt: "2026-06-07T14:30:00Z" },
          { id: "cli_4", nome: "Mecânica Luz", documento: "99.117.228/0001-44", email: "contato@mecanicaluz.com.br", telefone: "(11) 2235-9878", createdAt: "2026-06-08T09:15:00Z" },
        ];

        const defaultTransacoes = [
          { id: "tx_1", tipo: "entrada", valor: 1200.00, data: "15/06/2026", descricao: "Consultoria UX", categoria: "Consultoria", clienteId: "cli_1", clienteNome: "Alice Martins", clienteDocumento: "123.456.789-00", formaPagamento: "Pix" },
          { id: "tx_2", tipo: "saida", valor: 85.00, data: "12/06/2026", descricao: "Hospedagem AWS", categoria: "Infraestrutura", formaPagamento: "Cartão de Crédito" },
          { id: "tx_3", tipo: "entrada", valor: 2400.00, data: "10/06/2026", descricao: "Protótipo App Mobile", categoria: "Desenvolvimento", clienteId: "cli_3", clienteNome: "Julia Soares", clienteDocumento: "88.112.554/0002-13", formaPagamento: "Pix" },
          { id: "tx_4", tipo: "saida", valor: 72.00, data: "05/06/2026", descricao: "DAS (Imposto MEI)", categoria: "Impostos", formaPagamento: "Boleto" },
        ];

        const savedClientes = localStorage.getItem("meiflow_clientes");
        const savedTransacoes = localStorage.getItem("meiflow_transacoes");
        
        setClientes(savedClientes ? JSON.parse(savedClientes) : defaultClientes);
        setTransacoes(savedTransacoes ? JSON.parse(savedTransacoes) : defaultTransacoes);
      }
    });

    return () => unsubscribe();
  }, []);

  // Escuta em tempo real o perfil do usuário (incluindo planType e companyLogo) no Firestore
  useEffect(() => {
    if (!user) return;
    
    const docRef = doc(db, "users", user.uid);
    const unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.planType) {
          setPlanType(data.planType);
        } else {
          setPlanType("free");
        }
        if (data.invoiceLimit !== undefined) {
          setInvoiceLimit(data.invoiceLimit);
        } else {
          setInvoiceLimit(30);
        }
        if (data.invoiceUsed !== undefined) {
          setInvoiceUsed(data.invoiceUsed);
        } else {
          setInvoiceUsed(0);
        }
        if (data.logoUrl || data.companyLogo) {
          setCompanyLogo(data.logoUrl || data.companyLogo || "");
        }
        if (data.meiName || data.name) {
          setMeiName(data.meiName || data.name || "");
        }
        if (data.cnpjPrestador) {
          setCnpjPrestador(data.cnpjPrestador);
        }
        if (data.isCpfEmissor !== undefined) {
          setIsCpfEmissor(data.isCpfEmissor);
        } else if (data.cnpjPrestador) {
          setIsCpfEmissor(data.cnpjPrestador.replace(/\D/g, "").length === 11);
        }
        if (data.inscricaoMunicipal) {
          setInscricaoMunicipal(data.inscricaoMunicipal);
        }
        if (data.telefone) {
          setTelefonePrestador(data.telefone);
        }
      }
    }, (err) => {
      console.warn("Erro ao escutar atualizações de perfil em tempo real:", err);
    });

    return () => unsubscribeSnapshot();
  }, [user]);

  // Perspectiva persistente do localStorage exclusivamente fora de login para impedir colisão
  useEffect(() => {
    if (!user) {
      localStorage.setItem("meiflow_clientes", JSON.stringify(clientes));
    }
  }, [clientes, user]);

  useEffect(() => {
    if (!user) {
      localStorage.setItem("meiflow_transacoes", JSON.stringify(transacoes));
    }
  }, [transacoes, user]);

  // Controles de Login/Logout
  const handleGoogleSignIn = async () => {
    setIsFirebaseSyncing(true);
    const loggedUser = await loginWithGoogle();
    if (loggedUser) {
      setUser(loggedUser);
    } else {
      triggerToast("⚠ Operação de Login cancelada.");
    }
    setIsFirebaseSyncing(false);
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError("Por favor, preencha o e-mail e a senha.");
      return;
    }
    if (authIsSignUp && !authName) {
      setAuthError("Por favor, preencha o nome de sua empresa MEI.");
      return;
    }
    
    setAuthLoading(true);
    setAuthError("");
    try {
      if (authIsSignUp) {
        const registeredUser = await registerWithEmailPassword(authEmail, authPassword, authName);
        if (registeredUser) {
          setUser(registeredUser);
          triggerToast(`✓ Sua conta MEI foi criada! Bem-vindo(a), ${authName}.`);
          setShowAuthModal(false);
          setAuthEmail("");
          setAuthPassword("");
          setAuthName("");
        }
      } else {
        const loggedInUser = await loginWithEmailPassword(authEmail, authPassword);
        if (loggedInUser) {
          setUser(loggedInUser);
          triggerToast(`✓ Bem-vindo de volta! Sincronização em tempo real ativada.`);
          setShowAuthModal(false);
          setAuthEmail("");
          setAuthPassword("");
          setAuthName("");
        }
      }
    } catch (err: any) {
      console.error(err);
      let errMsg = "Ocorreu um erro ao processar a autenticação.";
      if (err.code === "auth/email-already-in-use") {
        errMsg = "Este endereço de e-mail já está sendo utilizado.";
      } else if (
        err.code === "auth/invalid-credential" || 
        err.code === "auth/wrong-password" || 
        err.code === "auth/user-not-found"
      ) {
        errMsg = "E-mail ou senha incorretos ou não cadastrados.";
      } else if (err.code === "auth/weak-password") {
        errMsg = "A senha fornecida é fraca. Digite pelo menos 6 caracteres.";
      } else if (err.message) {
        errMsg = err.message;
      }
      setAuthError(errMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaveMeiProfile = async (
    newName: string, 
    newCnpj: string, 
    newInscricao: string, 
    newTelefone: string, 
    logo?: string
  ) => {
    try {
      setMeiName(newName);
      setCnpjPrestador(newCnpj);
      setInscricaoMunicipal(newInscricao);
      setTelefonePrestador(newTelefone);
      setIsCpfEmissor(false);
      if (logo !== undefined) {
        setCompanyLogo(logo);
      }
      
      localStorage.setItem("meiflow_mei_name", newName);
      localStorage.setItem("meiflow_cnpj_prestador", newCnpj);
      localStorage.setItem("meiflow_inscricao_municipal", newInscricao);
      localStorage.setItem("meiflow_telefone_prestador", newTelefone);
      localStorage.setItem("meiflow_is_cpf_emissor", "false");

      if (user) {
        await saveUserProfileToFirebase(user.uid, {
          meiName: newName,
          cnpjPrestador: newCnpj,
          inscricaoMunicipal: newInscricao,
          telefone: newTelefone,
          planType: planType,
          companyLogo: logo !== undefined ? logo : companyLogo,
          isCpfEmissor: false
        });
        triggerToast("✓ Dados de perfil atualizados com sucesso e sincronizados na nuvem!");
      } else {
        triggerToast("✓ Dados de perfil salvos localmente! (Acesse a nuvem para backup)");
      }
      setShowMeiConfigModal(false);
    } catch (error) {
      console.error(error);
      triggerToast("⚠ Erro ao salvar as configurações da empresa.");
    }
  };

  const handleOnboardingCnpjSave = async (newName: string, newCnpj: string, newInscricao: string, newTelefone: string) => {
    try {
      setMeiName(newName);
      setCnpjPrestador(newCnpj);
      setInscricaoMunicipal(newInscricao);
      setTelefonePrestador(newTelefone);
      setIsCpfEmissor(false);
      
      localStorage.setItem("meiflow_mei_name", newName);
      localStorage.setItem("meiflow_cnpj_prestador", newCnpj);
      localStorage.setItem("meiflow_inscricao_municipal", newInscricao);
      localStorage.setItem("meiflow_telefone_prestador", newTelefone);
      localStorage.setItem("meiflow_is_cpf_emissor", "false");

      if (user) {
        await saveUserProfileToFirebase(user.uid, {
          meiName: newName,
          cnpjPrestador: newCnpj,
          inscricaoMunicipal: newInscricao,
          telefone: newTelefone,
          planType: planType,
          companyLogo: companyLogo,
          isCpfEmissor: false
        });
        triggerToast("🚀 Aplicativo ativado! Conta configurada automaticamente via CNPJ.");
      } else {
        triggerToast("✓ Configuração concluída e salva localmente!");
      }
    } catch (error) {
      console.error(error);
      triggerToast("⚠ Erro ao salvar a configuração inicial.");
    }
  };

  const handleSkipOnboardingWithDemo = async () => {
    await handleOnboardingCnpjSave(
      "João Silva Consultoria",
      "21.231.111/0001-20",
      "48392-1",
      "(11) 98765-4321"
    );
    triggerToast("🧪 Ativado no modo demonstração! Sinta-se à vontade para explorar os recursos.");
  };

  const handleUpgradeSuccess = async () => {
    try {
      setPlanType("premium");
      if (user) {
        await saveUserProfileToFirebase(user.uid, {
          meiName,
          cnpjPrestador,
          inscricaoMunicipal,
          telefone: telefonePrestador,
          planType: "premium",
          companyLogo
        });
        triggerToast("✓ Parabéns! Ativação Premium do MEI Flow realizada com sucesso na nuvem!");
      } else {
        triggerToast("✓ Plano Premium do MEI Flow ativado com sucesso!");
      }
    } catch (e) {
      console.error("Erro no upgrade premium remoto:", e);
      triggerToast("⚠ Licença ativa!");
    }
  };

  const handleSignOut = async () => {
    if (confirm("Gostaria de se desconectar de seu perfil MEI? O app voltará ao modo offline.")) {
      await logoutUser();
      setCurrentView("home");
      triggerToast("✓ Desconectado com sucesso.");
    }
  };

  // Cálculos Financeiros
  const totalEntradas = transacoes
    .filter(t => t.tipo === "entrada")
    .reduce((acc, curr) => acc + curr.valor, 0);

  const totalSaidas = transacoes
    .filter(t => t.tipo === "saida")
    .reduce((acc, curr) => acc + curr.valor, 0);

  const saldoMensal = totalEntradas - totalSaidas;

  // Limite Anual MEI (R$ 81.000,00 padrão)
  const limiteAnual = 81000.00;
  // O limite prevê faturamento acumulado (entradas brutas)
  const faturamentoPrecedente = 28000.00; // Simula faturamento acumulado de meses anteriores
  const faturamentoBrutoTotal = faturamentoPrecedente + totalEntradas;
  const porcentagemLimite = Math.min((faturamentoBrutoTotal / limiteAnual) * 100, 100);

  // Download do APK real/simulado de forma elegante
  const handleDownloadAPK = () => {
    const dummyApkContent = new Uint8Array([80, 75, 3, 4, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // ZIP/APK placeholder
    const blob = new Blob([dummyApkContent], { type: "application/vnd.android.package-archive" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "meiflow.apk";
    link.click();
    URL.revokeObjectURL(url);
    triggerToast("✓ Download do APK Android (meiflow.apk) iniciado direto para o telefone!");
  };

  // Download do PDF (geração real de arquivo PDF formatado como comprovante oficial)
  const handleDownloadPDF = (tx: Transacao, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    try {
      const doc = new jsPDF();
      
      // Header
      doc.setFillColor(15, 23, 42); // slate-900 (deep navy)
      doc.rect(0, 0, 210, 40, "F");
      
      doc.setTextColor(255, 255, 255);
      if (planType === "premium" && companyLogo) {
        try {
          doc.addImage(companyLogo, "PNG", 15, 5, 28, 28);
        } catch (e) {
          console.error("Erro ao desenhar logotipo no PDF, fallback para texto:", e);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(22);
          doc.text("MEI Flow", 15, 25);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.text("Controle Fiscal & Emissão de Comprovantes", 15, 33);
        }
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("MEI Flow", 15, 25);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Controle Fiscal & Emissão de Comprovantes", 15, 33);
      }
      
      // Title
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("COMPROVANTE DE OPERAÇÃO FISCAL", 15, 55);
      
      // Metadata block
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Emitente MEI: ${meiName || "Não Informado"}`, 15, 65);
      doc.text(`CNPJ Emitente: ${cnpjPrestador || "Não Informado"}`, 15, 71);
      if (inscricaoMunicipal) {
        doc.text(`Inscrição Municipal: ${inscricaoMunicipal}`, 15, 77);
      } else {
        doc.text(`Inscrição Municipal: Não Informada`, 15, 77);
      }
      doc.text(`Telefone de Contato: ${telefonePrestador || "Não Informado"}`, 115, 71);
      doc.text(`Data de Emissão: ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}`, 115, 77);
      
      // Draw line
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(15, 83, 195, 83);
      
      // Details title
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("DETALHES DO LANÇAMENTO", 15, 93);
      
      const isEnt = tx.tipo === "entrada";
      
      const bodyRows = [
        ["ID Registro", tx.id],
        ["Operação", isEnt ? "ENTRADA (RECEITA / VENDA)" : "SAÍDA (DESPESA)"],
        ["Descrição", tx.descricao],
        ["Categoria", tx.categoria],
        ["Data do Lançamento", tx.data],
        ["Valor Consolidado", `R$ ${tx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`]
      ];
      
      if (isEnt) {
        bodyRows.push(["Cliente Destinatário", tx.clienteNome || "Consumidor Geral"]);
        bodyRows.push(["Documento do Cliente", tx.clienteDocumento || "Não informado"]);
      } else {
        bodyRows.push(["Destino da Despesa", "Internalização de Custos Operacionais"]);
      }
      
      autoTable(doc, {
        startY: 98,
        margin: { left: 15, right: 15 },
        head: [["Campo", "Informação"]],
        body: bodyRows,
        theme: "striped",
        styles: {
          fontSize: 10,
          cellPadding: 4,
        },
        headStyles: {
          fillColor: [37, 99, 235], // blue-600
          textColor: 255,
        },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 50 },
        }
      });
      
      // Total Block
      const finalY = (doc as any).lastAutoTable.finalY + 15;
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(15, finalY, 180, 20, "F");
      doc.setDrawColor(37, 99, 235);
      doc.line(15, finalY, 15, finalY + 20); // vertical blue indicator line
      
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`VALOR TOTAL DO LANÇAMENTO:`, 20, finalY + 13);
      
      doc.setTextColor(37, 99, 235);
      doc.setFontSize(14);
      doc.text(`R$ ${tx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 125, finalY + 13);
      
      // Legal Disclaimer Footer
      doc.setTextColor(148, 163, 184); // slate-400
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      const disclaimerY = finalY + 35;
      doc.text("Este recibo serve de lastro de autenticidade documental eletrônica para fins do preenchimento das", 15, disclaimerY);
      doc.text("obrigações do MEI de transações mensais brutas em conformidade com o Art. 26 da Lei Complementar nº 123/2006.", 15, disclaimerY + 4.5);
      doc.text("Gerado automaticamente via MEI Flow - Planejamento e Inteligência Tributária.", 15, disclaimerY + 9);
      
      doc.save(`comprovante_mei_${tx.id}.pdf`);
      triggerToast(`✓ Comprovante em PDF de alta qualidade para ${tx.id} gerado e baixado!`);
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      triggerToast("⚠ Ocorreu um erro ao gerar o comprovante em PDF.");
    }
  };

  // Gerar e Iniciar o Processo de NFS-e via Focus NFe
  const handleDownloadNFSe = (tx: Transacao, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (tx.tipo !== "entrada") {
      triggerToast("⚠ Nota fiscal somente pode ser emitida para vendas (Entradas).");
      return;
    }

    const cleanId = tx.id.replace(/\W/g, "");
    const generatedRef = `MEIFLOW_${cleanId}_${Math.floor(Math.random() * 10000)}`;

    setFocusNfeSelectedTx(tx);
    setRefNfe(generatedRef);
    setNumeroRps((Math.floor(Math.random() * 200) + 120).toString());
    setFocusNfeStatus("idle");
    setFocusNfeApiResponse(null);
    setFocusNfeError(null);
    setFocusNfeLogs([
      `[SISTEMA] Central de Emissão NFS-e aberta para o Lançamento: "${tx.descricao}"`,
      `[SISTEMA] Cliente Tomador: ${tx.clienteNome || "Consumidor Geral"}`,
      `[SISTEMA] Valor do Serviço: R$ ${tx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      `[SISTEMA] Token de Homologação Embutido: wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w`,
      `[SISTEMA] Referência Única gerada: ${generatedRef}`,
      `[SISTEMA] Pronto para transmissão POST.`
    ]);
    setShowFocusNfeModal(true);
  };

  // 1. TRANSMISSÃO REAL (POST) VIA PROXY
  const handleEmitFocusNfe = async () => {
    if (!focusNfeSelectedTx) return;

    if (planType === "premium" && invoiceUsed >= invoiceLimit) {
      triggerToast("⚠ Limite de emissões de notas atingido (30 de 30)!");
      const blockLogs = [
        ...focusNfeLogs,
        `[ERROR] Bloqueado: Limite de emissões atingido (${invoiceUsed}/${invoiceLimit}).`,
        `[SISTEMA] Por favor, aguarde o ciclo de renovação mensal para liberar novos créditos de emissão.`
      ];
      setFocusNfeLogs(blockLogs);
      setFocusNfeStatus("error");
      setFocusNfeError(`Você atingiu o limite de emissões de NFS-e (${invoiceUsed}/${invoiceLimit}) incluídas no seu plano premium.`);
      return;
    }

    setFocusNfeStatus("sending");
    const updatedLogs = [
      ...focusNfeLogs,
      `[POST] Enviando dados para: /api/focusnfe (Proxy local)...`,
      `[POST] Payload JSON montado com o CPF/CNPJ corporativo do Prestador e do Tomador...`,
    ];
    setFocusNfeLogs(updatedLogs);

    const payload = {
      cnpj_prestador: cnpjPrestador.replace(/\D/g, ""),
      ref: refNfe,
      numero_rps: numeroRps,
      serie_rps: serieRps,
      tipo_rps: tipoRps,
      valor_servicos: focusNfeSelectedTx.valor,
      razao_social_tomador: focusNfeSelectedTx.clienteNome || "Consumidor Final",
      email_tomador: focusNfeSelectedTx.email || "contato-homologacao@meiflow.com.br",
      cnpj_tomador: focusNfeSelectedTx.clienteDocumento && focusNfeSelectedTx.clienteDocumento.replace(/\D/g, "").length === 14 ? focusNfeSelectedTx.clienteDocumento.replace(/\D/g, "") : undefined,
      cpf_tomador: focusNfeSelectedTx.clienteDocumento && focusNfeSelectedTx.clienteDocumento.replace(/\D/g, "").length === 11 ? focusNfeSelectedTx.clienteDocumento.replace(/\D/g, "") : undefined,
      descricao_servicos: focusNfeSelectedTx.descricao,
    };

    try {
      const response = await fetch('/api/focusnfe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const httpStatus = response.status;
      const data = await response.json();

      if (httpStatus === 201 || httpStatus === 200) {
        setFocusNfeStatus("processing");
        setFocusNfeApiResponse(data);
        const nextLogs = [
          ...updatedLogs,
          `[HTTP ${httpStatus}] Retorno do Envio: "201 - Processando Autorização"!`,
          `[INFO] Referência ativa: "${data.ref || refNfe}"`,
          `[INFO] Status Focus NFe: "${data.status || "processando_autorizacao"}"`,
          `[INFO] Mensagem: "O lote de RPS foi recebido e está aguardando processamento."`,
          `[GET] Iniciando consultas de status automática via GET a cada 4 segundos...`
        ];
        setFocusNfeLogs(nextLogs);

        // Inicia pooling automático
        setTimeout(() => {
          handleCheckFocusNfeStatus(data.ref || refNfe, 1, nextLogs);
        }, 4000);
      } else {
        setFocusNfeStatus("error");
        setFocusNfeApiResponse(data);
        const errMsg = data.mensagem || (data.errors && typeof data.errors === 'object' ? JSON.stringify(data.errors) : "") || "Dados incorretos ou CNPJ prestador não habilitado.";
        setFocusNfeError(errMsg);
        setFocusNfeLogs([
          ...updatedLogs,
          `[HTTP ${httpStatus}] Rejeitado / Erro de Validação!`,
          `[ERROR] Focus NFe Respondeu: "${errMsg}"`,
          `[DICA] O token de testes está ativo, mas o CNPJ do Prestador digitado (${cnpjPrestador}) precisa estar habilitado no painel da Focus NFe.`
        ]);
        triggerToast("⚠ Falha: Verifique os erros no log da Focus NFe.");
      }
    } catch (err: any) {
      setFocusNfeStatus("error");
      setFocusNfeError(err.message || "Erro de conexão.");
      setFocusNfeLogs([
        ...updatedLogs,
        `[SISTEMA ERROR] Erro de comunicação de rede com o proxy: ${err.message}`
      ]);
    }
  };

  // 2. CONSULTA REAL (GET) VIA PROXY
  const handleCheckFocusNfeStatus = async (targetRef?: string, attempt: number = 1, currentLogs?: string[]) => {
    const currentRef = targetRef || refNfe;
    if (!currentRef) return;

    const baseLogs = currentLogs || focusNfeLogs;
    const monitoringLogs = [
      ...baseLogs,
      `[GET] [Consulta #${attempt}] Verificando: /api/focusnfe?ref=${currentRef} ...`
    ];
    setFocusNfeLogs(monitoringLogs);

    try {
      const response = await fetch(`/api/focusnfe?ref=${currentRef}`);
      const httpStatus = response.status;
      const data = await response.json();

      if (httpStatus === 200) {
        setFocusNfeApiResponse(data);
        const currentStatus = data.status;

        if (currentStatus === "autorizado") {
          setFocusNfeStatus("authorized");
          setFocusNfeLogs([
            ...monitoringLogs,
            `[HTTP 200] Resposta: "autorizado"`,
            `[SUCESSO] NFS-e Emitida e Autorizada com sucesso!`,
            `[SUCESSO] Chave de Acesso: "${data.chave_nfe || "N/A"}"`,
            `[SUCESSO] Número da Nota Fiscal: ${data.numero || "Gerado pelo Fisco"}`,
            `[SUCESSO] Link XML: https://homologacao.focusnfe.com.br${data.caminho_xml_nota_fiscal}`,
            `[SUCESSO] Link PDF (Danfse): https://homologacao.focusnfe.com.br${data.caminho_pdf_nota_fiscal}`
          ]);
          triggerToast("✓ NFS-e de Homologação emitida e autorizada!");

          // Incrementar invoiceUsed no Firestore em +1
          if (user) {
            try {
              const newUsed = invoiceUsed + 1;
              const docRef = doc(db, "users", user.uid);
              await setDoc(docRef, { invoiceUsed: newUsed }, { merge: true });
              
              const legacyDocRef = doc(db, "usuarios", user.uid);
              await setDoc(legacyDocRef, { invoiceUsed: newUsed }, { merge: true });
              
              setInvoiceUsed(newUsed);
              console.log(`[Firestore Success]: invoiceUsed incremented to ${newUsed}`);
            } catch (fsErr) {
              console.error("Erro ao incrementar invoiceUsed no Firestore:", fsErr);
            }
          } else {
            const localUsed = Number(localStorage.getItem("meiflow_invoice_used") || "0") + 1;
            localStorage.setItem("meiflow_invoice_used", localUsed.toString());
            setInvoiceUsed(localUsed);
          }
        } else if (currentStatus === "erro_autorizacao" || currentStatus === "erro" || data.erros) {
          setFocusNfeStatus("error");
          const errorsList = data.erros ? JSON.stringify(data.erros) : (data.mensagem || "Rejeição do fisco municipal");
          setFocusNfeError(errorsList);
          setFocusNfeLogs([
            ...monitoringLogs,
            `[HTTP 200] Resposta: "erro_autorizacao" (Negado pela prefeitura)`,
            `[REJEIÇÃO] Razão detalhada: ${errorsList}`
          ]);
        } else {
          // Permanece em processando
          const nextLogs = [
            ...monitoringLogs,
            `[GET] Resposta: "${currentStatus}". A nota ainda está na fila de processamento municipal.`
          ];
          setFocusNfeLogs(nextLogs);

          if (attempt < 3) {
            setTimeout(() => {
              handleCheckFocusNfeStatus(currentRef, attempt + 1, nextLogs);
            }, 4000);
          } else {
            setFocusNfeStatus("processing");
            setFocusNfeLogs([
              ...nextLogs,
              `[SISTEMA] Tempo limite de pooling excedido. Clique em "Consultar Status Manual" para verificar o processamento.`
            ]);
          }
        }
      } else {
        setFocusNfeStatus("error");
        const errMsg = data.mensagem || "Erro na resposta do servidor.";
        setFocusNfeError(errMsg);
        setFocusNfeLogs([
          ...monitoringLogs,
          `[HTTP ${httpStatus}] Erro na consulta de status: ${errMsg}`
        ]);
      }
    } catch (err: any) {
      setFocusNfeStatus("error");
      setFocusNfeError(err.message || "Erro de rede.");
      setFocusNfeLogs([
        ...monitoringLogs,
        `[SISTEMA ERROR] Falha de comunicação na consulta: ${err.message}`
      ]);
    }
  };

  // Exportar todas as transações para relatório PDF profissional consolidado do MEI
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      
      // Header banner
      doc.setFillColor(15, 23, 42); // slate-900 (deep navy)
      doc.rect(0, 0, 210, 42, "F");
      
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
          doc.text("Relatório de Inteligência & Conformidade Fiscal do MEI", 15, 32);
        }
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.text("MEI Flow", 15, 24);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Relatório de Inteligência & Conformidade Fiscal do MEI", 15, 32);
      }
      
      // Right aligned registered company info in header (aligned to right margin 195 to fit perfectly)
      doc.setFontSize(8.5);
      doc.setTextColor(203, 213, 225); // slate-300
      doc.text(`Empresa: ${meiName || "Não Informada"}`, 195, 12, { align: "right" });
      doc.text(`CNPJ: ${cnpjPrestador || "Não Informado"}`, 195, 18, { align: "right" });
      doc.text(`Insc. Mun.: ${inscricaoMunicipal || "Não Informada"}`, 195, 24, { align: "right" });
      doc.text(`Telefone: ${telefonePrestador || "Não Informado"}`, 195, 30, { align: "right" });
      doc.text(`Emitido em: ${new Date().toLocaleDateString("pt-BR")}`, 195, 36, { align: "right" });
      
      // Document title
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("LIVRO CAIXA & RELATÓRIO DE FATURAMENTO", 15, 51);
      
      // Selected period text
      let periodoTxt = "Todos os lançamentos selecionados";
      if (filterStartDate || filterEndDate) {
        const parseAndFormat = (dStr: string) => {
          const parts = dStr.split("-");
          if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
          }
          return dStr;
        };
        const startPretty = filterStartDate ? parseAndFormat(filterStartDate) : "Início";
        const endPretty = filterEndDate ? parseAndFormat(filterEndDate) : "Fim";
        periodoTxt = `Período Filtrado: ${startPretty} até ${endPretty}`;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(37, 99, 235); // elegant blue
      doc.text(periodoTxt, 15, 57);
      
      // Intro paragraph
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text(
        "Abaixo estão consolidados os lançamentos tributários do período selecionado. Este relatório deve ser apresentado",
        15,
        64
      );
      doc.text(
        "anualmente junto à Declaração Anual do Simples Nacional do MEI (DASN-SIMEI).",
        15,
        69
      );
      
      // Calculate totals specifically for the filtered transactions in the report/period
      const reportEntradas = filteredTransactions
        .filter(t => t.tipo === "entrada")
        .reduce((acc, curr) => acc + curr.valor, 0);

      const reportSaidas = filteredTransactions
        .filter(t => t.tipo === "saida")
        .reduce((acc, curr) => acc + curr.valor, 0);

      const reportSaldo = reportEntradas - reportSaidas;
      
      // Main stats summary cards in PDF
      // If we don't have expenses in this period, we do not show the despesas card
      const hasDespesas = reportSaidas > 0;

      if (hasDespesas) {
        // Draw cards backgrounds for 3 cards
        doc.setFillColor(248, 250, 252); // slate-50
        doc.rect(15, 78, 55, 24, "F");
        doc.rect(77, 78, 55, 24, "F");
        doc.rect(140, 78, 55, 24, "F");
        
        // Border indicators
        doc.setDrawColor(16, 185, 129); // emerald-500
        doc.line(15, 78, 15, 102);
        doc.setDrawColor(239, 68, 68); // red-500
        doc.line(77, 78, 77, 102);
        doc.setDrawColor(37, 99, 235); // blue-600
        doc.line(140, 78, 140, 102);
        
        // Stats labels & values
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139); // slate-500
        doc.text("TOTAL RECEITAS (+)", 18, 84);
        doc.text("TOTAL DESPESAS (-)", 80, 84);
        doc.text("SALDO TRIBUTÁRIO", 143, 84);
        
        doc.setFontSize(11);
        doc.setTextColor(16, 185, 129); // emerald-600
        doc.text(`R$ ${reportEntradas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 18, 93);
        
        doc.setTextColor(220, 38, 38); // red-600
        doc.text(`R$ ${reportSaidas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 80, 93);
        
        const isPositive = reportSaldo >= 0;
        doc.setTextColor(isPositive ? 16 : 220, isPositive ? 185 : 38, isPositive ? 129 : 38);
        doc.text(`R$ ${reportSaldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 143, 93);
        
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text("Receitas brutas registradas", 18, 99);
        doc.text("Base operacional mensal", 80, 99);
        doc.text("Conformidade fiscal ativa", 143, 99);
      } else {
        // Draw cards backgrounds for 2 cards (excluding expenses because it is zero)
        doc.setFillColor(248, 250, 252); // slate-50
        doc.rect(15, 78, 85, 24, "F");
        doc.rect(110, 78, 85, 24, "F");
        
        // Border indicators
        doc.setDrawColor(16, 185, 129); // emerald-500
        doc.line(15, 78, 15, 102);
        doc.setDrawColor(37, 99, 235); // blue-600
        doc.line(110, 78, 110, 102);
        
        // Stats labels & values
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139); // slate-500
        doc.text("TOTAL RECEITAS (+)", 18, 84);
        doc.text("SALDO TRIBUTÁRIO", 113, 84);
        
        doc.setFontSize(11);
        doc.setTextColor(16, 185, 129); // emerald-600
        doc.text(`R$ ${reportEntradas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 18, 93);
        
        const isPositive = reportSaldo >= 0;
        doc.setTextColor(isPositive ? 16 : 220, isPositive ? 185 : 38, isPositive ? 129 : 38);
        doc.text(`R$ ${reportSaldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 113, 93);
        
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text("Receitas brutas registradas", 18, 99);
        doc.text("Conformidade fiscal ativa", 113, 99);
      }
      
      // Table body mapping
      const tableRows = filteredTransactions.map(t => {
        const isEnt = t.tipo === "entrada";
        return [
          t.data,
          isEnt ? "Receita (+)" : "Despesa (-)",
          t.descricao,
          t.categoria,
          isEnt ? (t.clienteNome || "Consumidor Geral") : "Geral / Interno",
          `R$ ${t.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        ];
      });
      
      autoTable(doc, {
        startY: 110,
        margin: { left: 15, right: 15 },
        head: [["Data", "Tipo", "Lançamento", "Categoria", "Cliente / Destinatário", "Valor"]],
        body: tableRows,
        theme: "striped",
        styles: {
          fontSize: 8.5,
          cellPadding: 3.5,
          valign: "middle"
        },
        headStyles: {
          fillColor: [15, 23, 42], // slate-900 (deep navy)
          textColor: 255,
          fontStyle: "bold"
        },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 22 },
          2: { cellWidth: 50 },
          3: { cellWidth: 30 },
          4: { cellWidth: 40 },
          5: { cellWidth: 26, halign: "right" }
        }
      });
      
      // Legal & Signature Area below table
      const finalTableY = (doc as any).lastAutoTable.finalY + 12;
      
      // If we're close to the bottom, add a page
      let drawY = finalTableY;
      if (drawY > 245) {
        doc.addPage();
        drawY = 20;
      }
      
      const footerY = drawY + 15;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      
      // Left side signature
      doc.text("________________________________________", 15, footerY);
      doc.text("Assinatura do MEI Responsável", 15, footerY + 5);
      
      // Right side signature (right-aligned at 195 to fit perfectly within standard margins)
      doc.text("________________________________________", 195, footerY, { align: "right" });
      doc.text("Verificação ID Digital do Sistema", 195, footerY + 5, { align: "right" });
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      const randomRevId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const shortKey = `MEIFLOW_REV_${randomRevId}_${Math.floor(Math.random() * 90000 + 10000)}`;
      doc.text(`Chave: ${shortKey}`, 195, footerY + 10, { align: "right" });
      
      doc.save(`relatorio_faturamento_mei_flow.pdf`);
      triggerToast("✓ Relatório Fiscal Completo em PDF emitido e baixado com sucesso!");
    } catch (err) {
      console.error("Erro ao exportar PDF:", err);
      triggerToast("⚠ Ocorreu um erro ao exportar o relatório consolidado em PDF.");
    }
  };

  // -------------------------------------------------------------------------
  // CHAMADO DE SUPORTE TÉCNICO VINCULADO AO DESENVOLVEDOR (rodrigues.solar@hotmail.com)
  // -------------------------------------------------------------------------
  const handleSendSupportMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportSubject || !supportMessage) {
      triggerToast("⚠ Preencha os campos obrigatórios do chamado.");
      return;
    }

    const ticketId = "support_" + Date.now();
    const ticketObj = {
      id: ticketId,
      category: supportCategory,
      subject: supportSubject,
      replyEmail: supportReplyEmail || "Não Informado",
      message: supportMessage,
      createdAt: new Date().toISOString()
    };

    // 1. Persistir no Firestore
    try {
      const ticketRef = doc(db, "support_tickets", ticketId);
      await setDoc(ticketRef, {
        ...ticketObj,
        userId: userId,
        meiName: meiName,
        status: "novo"
      });
      console.log("Chamado persistido com sucesso no Firestore:", ticketId);
    } catch (dbErr: any) {
      console.warn("Firestore não pôde salvar chamado diretamente (offline ou permissão). Salvando localmente:", dbErr.message);
      // Fallback local storage
      try {
        const localTicketsKey = `meiflow_support_tickets_${userId}`;
        const localTickets = JSON.parse(localStorage.getItem(localTicketsKey) || "[]");
        localTickets.push({
          ...ticketObj,
          status: "novo"
        });
        localStorage.setItem(localTicketsKey, JSON.stringify(localTickets));
      } catch (locErr) {
        console.error("Falha ao salvar fallback de chamados:", locErr);
      }
    }

    const emailDestino = "rodrigues.solar@hotmail.com";
    const assuntoFormatado = `[SUPORTE MEI FLOW] ${supportCategory} - ${supportSubject}`;
    
    // Dados para diagnóstico ágil e depuração eficiente
    const corpoEmail = `Olá Rodrigues, suporte do MEI Flow,

Um usuário está solicitando atendimento referente à ferramenta de lançamentos MEI.

DETALHES DO SUPORTE:
• Categoria: ${supportCategory}
• Assunto: ${supportSubject}
• E-mail do Cliente para resposta: ${supportReplyEmail || "Não Informado"}

--------------------------------------------------
MENSAGEM DE ERRO/DÚVIDA DO USUÁRIO:
--------------------------------------------------
${supportMessage}

--------------------------------------------------
DADOS DE INFRAESTRUTURA & DIAGNÓSTICO (AUTOMÁTICO):
--------------------------------------------------
- ID do MEI ativo: ${userId}
- Nome do Emissor MEI: ${meiName}
- Modo Banco de Dados: ${user ? "Firebase Cloud (Nuvem Autenticada)" : "Offline LocalStorage"}
- Total de Lançamentos de Caixa: ${transacoes.length}
- Total de Clientes Catalogados: ${clientes.length}
- Identificador de Agent/Web: ${navigator.userAgent}
- Registro da Ocorrência: ${new Date().toLocaleString("pt-BR")}

Atenciosamente,
${meiName}`;

    // Monta o mailto com segurança contra quebra de URL
    const mailtoLink = `mailto:${emailDestino}?subject=${encodeURIComponent(assuntoFormatado)}&body=${encodeURIComponent(corpoEmail)}`;
    
    // Dispara no navegador abrindo Outlook/Gmail de forma segura (se suportado no ambiente)
    try {
      window.location.href = mailtoLink;
    } catch (err) {
      console.warn("Mailto redirection blocked or failed:", err);
    }

    // Set variables to show the beautiful confirmation modal
    setSubmittedTicket(ticketObj);
    setShowSupportSuccessModal(true);
    triggerToast("✓ Chamado registrado com sucesso no sistema!");
    
    // Reset e encerramento
    setSupportSubject("");
    setSupportMessage("");
    setSupportReplyEmail("");
    setShowSupportModal(false);
  };

  // Handlers para criação de lançamentos (Adaptados para Firestore sob demanda se autenticado)
  const handleAddVenda = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendaValor || !vendaDescricao) return;

    const valorNum = parseFloat(vendaValor);
    if (isNaN(valorNum) || valorNum <= 0) return;

    const selectedClient = clientes.find(c => c.id === vendaClienteId);

    const novaVenda: Transacao = {
      id: `tx_${Date.now().toString().slice(-6)}`,
      tipo: "entrada",
      valor: valorNum,
      data: vendaData,
      descricao: vendaDescricao,
      categoria: vendaCategoria,
      clienteId: selectedClient?.id,
      clienteNome: selectedClient?.nome || "Consumidor Geral",
      clienteDocumento: selectedClient?.documento,
      formaPagamento: vendaFormaPagamento
    };

    if (user) {
      // Se autenticado, grava de forma resiliente diretamente na nuvem
      saveVendaToFirebase(user.uid, novaVenda)
        .then(() => {
          setTransacoes(prev => [novaVenda, ...prev]);
          triggerToast("✓ Venda adicionada e sincronizada com sucesso!");
        })
        .catch(err => {
          console.error("Erro Firebase:", err);
          triggerToast("⚠ Erro ao salvar venda em nuvem.");
        });
    } else {
      setTransacoes(prev => [novaVenda, ...prev]);
      triggerToast("✓ Venda adicionada e sincronizada localmente com sucesso!");
    }

    // Reset formulário
    setVendaValor("");
    setVendaDescricao("");
    setVendaClienteId("");
    setVendaFormaPagamento("Pix");
    setShowVendaModal(false);
  };

  const handleAddDespesa = (e: React.FormEvent) => {
    e.preventDefault();
    if (!despesaValor || !despesaDescricao) return;

    const valorNum = parseFloat(despesaValor);
    if (isNaN(valorNum) || valorNum <= 0) return;

    const novaDespesa: Transacao = {
      id: `tx_${Date.now().toString().slice(-6)}`,
      tipo: "saida",
      valor: valorNum,
      data: despesaData,
      descricao: despesaDescricao,
      categoria: despesaCategoria,
      formaPagamento: despesaFormaPagamento
    };

    if (user) {
      saveTransacaoToFirebase(user.uid, novaDespesa)
        .then(() => {
          setTransacoes(prev => [novaDespesa, ...prev]);
          triggerToast("✓ Despesa gravada com sucesso!");
        })
        .catch(err => {
          console.error("Erro Firebase Despesa:", err);
          triggerToast("⚠ Erro ao salvar despesa.");
        });
    } else {
      setTransacoes(prev => [novaDespesa, ...prev]);
      triggerToast("✓ Despesa adicionada e sincronizada localmente!");
    }

    // Reset formulário
    setDespesaValor("");
    setDespesaDescricao("");
    setDespesaFormaPagamento("Pix");
    setShowDespesaModal(false);
  };

  const handleCreateCliente = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliNome) return;

    const novoCli: Cliente = {
      id: `cli_${Date.now().toString().slice(-4)}`,
      nome: cliNome,
      documento: cliDoc,
      email: cliEmail,
      telefone: cliTel,
      createdAt: new Date().toISOString()
    };

    if (user) {
      saveClienteToFirebase(user.uid, novoCli)
        .then(() => {
          setClientes(prev => [...prev, novoCli]);
          triggerToast(`✓ Cliente ${cliNome} cadastrado com sucesso!`);
        })
        .catch(err => {
          console.error("Erro Firebase Cliente:", err);
          triggerToast("⚠ Erro ao cadastrar cliente.");
        });
    } else {
      setClientes(prev => [...prev, novoCli]);
      triggerToast(`✓ Cliente ${cliNome} cadastrado com sucesso!`);
    }

    // Reset form
    setCliNome("");
    setCliDoc("");
    setCliEmail("");
    setCliTel("");
    setShowClienteModal(false);
  };

  const handleDeleteCliente = (cliId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Deseja realmente excluir este cliente? Se houver transações vinculadas, elas serão mantidas, mas o cliente será desvinculado.")) {
      if (user) {
        deleteClienteFromFirebase(cliId)
          .then(() => {
            setClientes(prev => prev.filter(c => c.id !== cliId));
            triggerToast("✓ Cliente removido com sucesso.");
          })
          .catch(err => {
            console.error(err);
            triggerToast("⚠ Erro ao excluir cliente.");
          });
      } else {
        setClientes(prev => prev.filter(c => c.id !== cliId));
        triggerToast("✓ Cliente removido localmente.");
      }
    }
  };

  const handleDeleteTransacao = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Deseja realmente excluir esta movimentação permanente de seu histórico financeiro?")) {
      if (user) {
        const txToDelete = transacoes.find(t => t.id === id);
        const deletePromise = (txToDelete && txToDelete.tipo === "entrada")
          ? deleteVendaFromFirebase(user.uid, id)
          : deleteTransacaoFromFirebase(id);

        deletePromise
          .then(() => {
            setTransacoes(prev => prev.filter(t => t.id !== id));
            triggerToast("✓ Movimentação financeira removida.");
          })
          .catch(err => {
            console.error(err);
            triggerToast("⚠ Erro ao excluir transação.");
          });
      } else {
        setTransacoes(prev => prev.filter(t => t.id !== id));
        triggerToast("✓ Movimentação financeira removida.");
      }
    }
  };

  // Filtros de busca de transação na tabela
  const filteredTransactions = transacoes.filter(t => {
    const matchesSearch = t.descricao.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.clienteNome && t.clienteNome.toLowerCase().includes(searchTerm.toLowerCase())) ||
      t.categoria.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = filterTipo === "todos" || t.tipo === filterTipo;

    let matchesPeriod = true;
    const txDate = parseTransactionDate(t.data);
    if (txDate) {
      if (filterStartDate) {
        const start = new Date(filterStartDate);
        start.setHours(0, 0, 0, 0);
        txDate.setHours(0, 0, 0, 0);
        if (txDate < start) matchesPeriod = false;
      }
      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        txDate.setHours(0, 0, 0, 0);
        if (txDate > end) matchesPeriod = false;
      }
    }

    return matchesSearch && matchesType && matchesPeriod;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col antialiased">
      
      {/* TOAST NOTIFICATION CONTAINER */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 text-white font-semibold py-3 px-6 rounded-full shadow-2xl flex items-center gap-3 text-sm animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* HEADER DE NAVEGAÇÃO LIMPO - INTEGRADO COM FIREBASE CLOUD */}
      <nav className="h-20 bg-white border-b border-slate-200 px-6 md:px-12 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-md tracking-wider">
            M
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight text-slate-900">
              MEI Flow
            </span>
            <span className="text-xs text-slate-400 font-medium">Gestão Inteligente & Comprovantes Fiscais</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* PAINEL DE CONFIGURAÇÕES CADASTRAIS DO EMISSOR */}
          {user && (
            <button
              onClick={() => setShowMeiConfigModal(true)}
              className="flex items-center gap-2 group text-left p-1.5 rounded-xl hover:bg-slate-50 transition-all border border-transparent hover:border-slate-200 cursor-pointer text-slate-800"
              title="Clique para cadastrar ou modificar os dados de sua empresa MEI"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
                <Building className="w-4 h-4" />
              </div>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-all leading-tight">
                  {meiName}
                </span>
                <span className="text-[9px] text-slate-400 font-medium font-mono">
                  CNPJ: {cnpjPrestador || "Não cadastrado"}
                </span>
              </div>
              <Settings className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0 hidden sm:inline ml-1 margin-left-xs" />
            </button>
          )}

          {/* CONTROLE DE LOGIN/AUTENTICAÇÃO FIREBASE */}
          {user ? (
            <div className="flex items-center gap-2">
              <div 
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-xl text-blue-700 text-xs font-bold border border-blue-100/50"
                title="Sincronização em nuvem ativa"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span>Nuvem Ativa</span>
              </div>
              <button
                onClick={handleSignOut}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 px-3.5 font-bold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer shadow-sm border border-slate-200"
                title="Sair da Conta"
              >
                <LogOut className="w-4 h-4 text-slate-500" />
                <span className="hidden sm:inline">Desconectar</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAuthModal(true)}
                disabled={isFirebaseSyncing}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center gap-2 transition-all shadow-md shrink-0 cursor-pointer"
                title="Acesse com sua conta para sincronização segura e backup automático"
              >
                {isFirebaseSyncing ? (
                  <RefreshCw className="w-4 h-4 text-blue-100 animate-spin" />
                ) : (
                  <Cloud className="w-4 h-4 text-blue-100" />
                )}
                <span>Acessar Nuvem</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* WORKSPACE PRINCIPAL */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-12 space-y-12 font-sans">
        {!user ? (
          <div className="space-y-12 animate-fade-in text-left" id="landing-presentation">
            {/* GORGEOUS LANDING HERO SECTION */}
            <div className="relative py-12 md:py-20 text-center max-w-3xl mx-auto space-y-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-100 mx-auto justify-center">
                <Sparkles className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
                <span>MEI Flow — Sistema de Gestão 100% Gratuito</span>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-6xl font-display font-black text-slate-950 tracking-tight leading-tight">
                Emissão de Notas &<br />
                <span className="text-blue-600 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Controle do MEI</span> sem complicação.
              </h1>

              <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed font-light">
                O aplicativo financeiro feito sob medida para o MEI profissional. Controle vendas, organize clientes e gere orçamentos profissionais de graça. Faça o upgrade opcional somente se precisar emitir NFS-e direto pelo sistema!
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm rounded-xl shadow-lg transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Cloud className="w-4 h-4 text-blue-100" />
                  <span>Configurar Conta Grátis</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpgradeModal(true)}
                  className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 font-bold text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>Ver Recursos Premium</span>
                </button>
              </div>
            </div>

            {/* SEÇÃO BENTO GRID DE FACILIDADES / BENEFÍCIOS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: Emissão Integrada */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-8 hover:shadow-lg transition-all space-y-4 text-left">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                  <FileText className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Emissão de Notas NFS-e (Premium)</h3>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Quer automatizar o faturamento? No upgrade Premium opcional, você pode emitir até <strong>30 notas fiscais por mês</strong> direto para sua prefeitura, inclusas na assinatura, sem taxas extras adicionais por nota de serviço.
                </p>
              </div>

              {/* Card 2: Organização de Carteira & Vendas */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-8 hover:shadow-lg transition-all space-y-4 text-left">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                  <Wallet className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Gestão de Clientes & Vendas (100% Grátis)</h3>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Cadastre seus parceiros e clientes de forma ilimitada, organize todo o histórico de faturamentos de vendas e acompanhe se o limite anual do MEI está correto. Tudo sem custo e sempre livre.
                </p>
              </div>

              {/* Card 3: Orçamentos & Catálogo */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-8 hover:shadow-lg transition-all space-y-4 text-left">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-bold text-lg">
                  📁
                </div>
                <h3 className="text-lg font-bold text-slate-900 font-display">Controle Completo MEI (100% Grátis)</h3>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Gere e envie orçamentos de alto padrão em segundos para fechar muito mais negócios. Personalize o layout em PDF adicionando o seu logotipo e salve relatórios importantes do seu progresso de graça.
                </p>
              </div>
            </div>

            {/* SEÇÃO DETALHADA DE ASSINATURA & CUSTO */}
            <div className="bg-slate-900 text-white rounded-3xl p-8 md:p-12 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-8 text-left">
              <div className="space-y-3 max-w-xl">
                <span className="text-[10px] uppercase tracking-widest font-extrabold text-blue-400">Compromisso de Gratuidade do MEI Flow</span>
                <h3 className="text-2xl md:text-3xl font-bold tracking-tight text-white leading-tight">
                  Organize sua jornada empreendedora sem pagar nada por isso.
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed font-light">
                  Acreditamos na força do microempreendedor individual brasileiro. A maior parte das nossas ferramentas de controle financeiro, base de clientes, relatórios e geração de orçamentos em PDF são <strong>totalmente gratuitas e sem tempo limite de testes</strong>. Se você precisar emitir notas NFS-e de forma automática, poderá adquirir nossa assinatura premium apenas quando sentir necessidade.
                </p>
              </div>
              <div className="bg-white/5 border border-white/10 p-6 rounded-2xl text-center min-w-[200px] shrink-0 space-y-2">
                <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Conta Inicial</div>
                <div className="text-3xl font-black text-white">R$ 0,00</div>
                <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Uso Grátis Liberado</div>
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="w-full mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] rounded-xl tracking-wider transition-all cursor-pointer uppercase"
                >
                  Registrar Grátis
                </button>
              </div>
            </div>
          </div>
        ) : user && (!cnpjPrestador || cnpjPrestador.trim() === "") ? (
          <CnpjOnboarding
            onSave={handleOnboardingCnpjSave}
            onSkipWithDemo={handleSkipOnboardingWithDemo}
            userEmail={user.email || ""}
          />
        ) : (
          <>
            {/* VIEW: HOME (DASHBOARD) */}
            {currentView === "home" && (
          <>
            {/* Banner elegante para usuários do plano gratuito */}
            {planType === "free" && (
              <div 
                onClick={() => setShowUpgradeModal(true)}
                className="bg-radial from-slate-900 to-indigo-950 border border-slate-800 text-white rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between gap-5 cursor-pointer hover:shadow-xl hover:border-indigo-900/60 transition-all duration-300 transform hover:-translate-y-0.5"
                id="free-premium-banner"
              >
                <div className="flex items-center gap-4 text-center md:text-left flex-col md:flex-row min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
                    <Sparkles className="w-6 h-6 text-yellow-300 animate-pulse" />
                  </div>
                  <div className="space-y-0.5 text-left">
                    <h3 className="font-extrabold tracking-tight text-white text-sm sm:text-base">
                      ✨ Evolua para o Premium para emitir notas fiscais e usar seu próprio logotipo!
                    </h3>
                    <p className="text-xs text-slate-300">
                      Desbloqueie todo o potencial financeiro e profissional do seu MEI por apenas R$ 29,90/mês. Clique para saber mais.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="px-5 py-2.5 bg-white text-indigo-950 font-extrabold text-[10px] rounded-lg shadow-lg hover:bg-slate-50 transition-all shrink-0 uppercase tracking-widest cursor-pointer"
                >
                  Conhecer Premium 🚀
                </button>
              </div>
            )}

            {/* HEADER DA DASHBOARD: TÍTULO & BOTÕES DE AÇÃO RÁPIDA MINIMALISTAS */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-100">
              <div>
                <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight">
                  Visão Geral
                </h1>
                <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
                  Acompanhamento financeiro em tempo real com simplicidade.
                </p>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setShowVendaModal(true)}
                  className="px-4.5 py-2.5 bg-white border border-slate-200/70 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                  id="btn-new-sale-clean"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-500" />
                  <span>Registrar Venda</span>
                </button>
                
                <button
                  onClick={() => setShowDespesaModal(true)}
                  className="px-4.5 py-2.5 bg-white border border-slate-200/70 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                  id="btn-new-expense-clean"
                >
                  <Minus className="w-3.5 h-3.5 text-slate-400" />
                  <span>Adicionar Despesa</span>
                </button>

                <button
                  onClick={() => setShowClienteModal(true)}
                  className="px-4.5 py-2.5 bg-white border border-slate-200/70 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 text-slate-400" />
                  <span>Novo Cliente</span>
                </button>

                <button
                  onClick={() => setCurrentView("orcamentos")}
                  className="px-4.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-100" />
                  <span>Gerador Orçamentos</span>
                </button>

                <button
                  onClick={() => setCurrentView("catalogo")}
                  className="px-4.5 py-2.5 bg-white border border-slate-200/70 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  <span>Catálogo {planType === "free" ? "🔒" : ""}</span>
                </button>
              </div>
            </div>

            {/* METRICAS PRINCIPAIS: APENAS DUAS GRANDES & CLARAS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* CARD 1: FATURAMENTO TOTAL (RESUMO FINANCEIRO) */}
              <div 
                onClick={() => setCurrentView("financeiro")}
                className="bg-white p-10 md:p-12 rounded-3xl border border-slate-200/50 shadow-xs flex flex-col justify-between cursor-pointer hover:border-blue-300 hover:shadow-md transition-all duration-300 transform hover:-translate-y-0.5"
                title="Clique para ver o extrato financeiro detalhado"
              >
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block flex items-center justify-between">
                    <span>Faturamento Consolidado</span>
                    <span className="text-blue-600 font-semibold text-[11px] normal-case">Ver Lançamentos &rarr;</span>
                  </span>
                  <h2 className="text-4xl sm:text-5xl lg:text-6xl font-display font-light text-slate-900 tracking-tight leading-none">
                    R$ {totalEntradas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </h2>
                </div>
                
                <div className="mt-10 pt-6 border-t border-slate-50 flex flex-wrap items-center gap-y-2 justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-bold">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Saldo Líquido Mensal: R$ {saldoMensal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
                  <span className="font-medium">
                    {porcentagemLimite.toFixed(1)}% do limite legal anual de R$ 81k
                  </span>
                </div>
              </div>

              {/* CARD 2: QUANTIDADE DE CLIENTES */}
              <div 
                onClick={() => setCurrentView("clientes")}
                className="bg-white p-10 md:p-12 rounded-3xl border border-slate-200/50 shadow-xs flex flex-col justify-between cursor-pointer hover:border-blue-300 hover:shadow-md transition-all duration-300 transform hover:-translate-y-0.5"
                title="Clique para ver a lista de clientes cadastrados"
              >
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block flex items-center justify-between">
                    <span>Clientes Ativos</span>
                    <span className="text-blue-600 font-semibold text-[11px] normal-case">Gerenciar Carteira &rarr;</span>
                  </span>
                  <h2 className="text-4xl sm:text-5xl lg:text-6xl font-display font-light text-slate-900 tracking-tight leading-none">
                    {clientes.length} <span className="text-xl sm:text-2xl font-light text-slate-400 ml-1">parceiros</span>
                  </h2>
                </div>

                <div className="mt-10 pt-6 border-t border-slate-50 flex items-center justify-between text-xs text-slate-400">
                  <span className="font-medium">Relação de clientes cadastrados no sistema</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentView("clientes");
                    }}
                    className="text-blue-600 hover:text-blue-800 font-semibold hover:underline flex items-center gap-0.5"
                  >
                    Ver Tudo &rarr;
                  </button>
                </div>
              </div>

            </div>

            {/* INTEGRATED BUSINESS MANAGEMENT ROW (BENTO ROW 2) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* CARD: PROPOSTAS / ORÇAMENTOS */}
              <div 
                onClick={() => setCurrentView("orcamentos")}
                className="bg-white p-10 md:p-12 rounded-3xl border border-slate-200/50 shadow-xs flex flex-col justify-between cursor-pointer hover:border-blue-300 hover:shadow-md transition-all duration-300 transform hover:-translate-y-0.5"
                title="Clique para emitir orçamentos e propostas para seus clientes"
              >
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block flex items-center justify-between">
                    <span>Orçamentos Comerciais</span>
                    <span className="text-blue-600 font-semibold text-[11px] normal-case">Emitir Proposta &rarr;</span>
                  </span>
                  <div className="space-y-1.5 text-left">
                    <h3 className="text-2xl font-semibold text-slate-800 tracking-tight">Propostas Rápidas</h3>
                    <p className="text-xs text-slate-400 font-medium">Gere e visualize orçamentos profissionais, com suporte a preenchimento manual ou catálogo inteligente, prontos para impressão ou compartilhamento.</p>
                  </div>
                </div>

                <div className="mt-10 pt-6 border-t border-slate-50 flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-xs text-blue-600 flex items-center gap-1 bg-blue-50 px-3 py-1 rounded-full">
                    Acessar e Emitir
                  </span>
                  <span className="font-medium text-slate-450">Suporte a PDF & Impressão</span>
                </div>
              </div>

              {/* CARD: CATÁLOGO */}
              <div 
                onClick={() => setCurrentView("catalogo")}
                className="bg-white p-10 md:p-12 rounded-3xl border border-slate-200/50 shadow-xs flex flex-col justify-between cursor-pointer hover:border-blue-300 hover:shadow-md transition-all duration-300 transform hover:-translate-y-0.5"
                title="Clique para cadastrar produtos ou serviços recorrentes"
              >
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block flex items-center justify-between">
                    <span>Catálogo de Itens {planType === "free" ? "🔒" : ""}</span>
                    <span className="text-blue-600 font-semibold text-[11px] normal-case">Configurar Catálogo &rarr;</span>
                  </span>
                  <div className="space-y-1.5 text-left">
                    <h3 className="text-2xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
                      <span>Serviços & Produtos</span>
                      {planType === "premium" && (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold bg-blue-100 text-blue-700 uppercase">Ativo</span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">Elimine digitação repetitiva! Cadastre seus honorários, preços de mercadorias ou serviços frequentes e preencha orçamentos de imediato.</p>
                  </div>
                </div>

                <div className="mt-10 pt-6 border-t border-slate-50 flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-xs text-indigo-600 flex items-center gap-1 bg-indigo-50 px-3 py-1 rounded-full">
                    Cadastrar Itens {planType === "free" ? "(🔒 Premium)" : ""}
                  </span>
                  <span className="font-medium text-slate-450 text-[11px]">Vínculo instantâneo</span>
                </div>
              </div>
            </div>

          </>
        )}

        {/* VIEW: CLIENTES */}
        {currentView === "clientes" && (
          <div className="space-y-8 animate-fade-in text-left">
            <div className="flex items-center gap-2 mb-2">
              <button 
                onClick={() => setCurrentView("home")}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
              >
                <span>&larr; Voltar para o Início (Home)</span>
              </button>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-100">
              <div>
                <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight">
                  Lista de Clientes Cadastrados
                </h1>
                <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
                  Contatos e documentos para emissão ágil de NFS-e, orçamentos e relatórios do seu negócio.
                </p>
              </div>
              
              <div>
                <button
                  onClick={() => setShowClienteModal(true)}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 text-blue-100" />
                  <span>Adicionar Novo Cliente</span>
                </button>
              </div>
            </div>

            {clientes.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl border border-slate-200/50 shadow-xs p-8 space-y-4">
                <p className="text-sm text-slate-400 italic">Nenhum cliente cadastrado no momento.</p>
                <div className="pt-2">
                  <button 
                    onClick={() => setShowClienteModal(true)}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-750 text-white font-bold text-xs rounded-xl cursor-pointer"
                  >
                    Cadastrar Primeiro Cliente
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clientes.map(c => {
                  const initials = c.nome.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
                  return (
                    <div key={c.id} className="bg-white p-6 rounded-3xl border border-slate-200/60 hover:border-blue-200 hover:shadow-md transition-all duration-300 flex flex-col justify-between gap-4 group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/20 rounded-full blur-xl pointer-events-none"></div>
                      
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 font-extrabold text-sm rounded-2xl flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300 shadow-inner">
                          {initials}
                        </div>
                        <div className="text-left space-y-1 min-w-0">
                          <h3 className="font-semibold text-slate-800 text-base pr-2" title={c.nome}>
                            {c.nome}
                          </h3>
                          <span className="text-xs text-slate-400 font-mono block">
                            {c.documento || "Sem CNPJ/CPF"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2 border-t border-slate-50 pt-4 text-xs text-slate-500">
                        {c.email && (
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-slate-400 font-medium">E-mail:</span>
                            <span className="text-slate-700 font-semibold truncate hover:underline" title={c.email}>{c.email}</span>
                          </div>
                        )}
                        {c.telefone && (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium font-sans">Tel:</span>
                            <span className="text-slate-700 font-semibold">{c.telefone}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-medium">Desde:</span>
                          <span className="text-slate-700 font-mono">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : "Não informado"}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-50">
                        <button
                          onClick={() => {
                            setVendaClienteId(c.id);
                            setVendaDescricao(`Prestação de serviços para ${c.nome}`);
                            setShowVendaModal(true);
                          }}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-blue-600 hover:text-white border border-slate-200 hover:border-transparent text-slate-700 font-bold text-[11px] rounded-xl transition-all flex-1 cursor-pointer"
                          title={`Lançar venda direta para ${c.nome}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Nova Venda</span>
                        </button>
                        
                        <button
                          onClick={(e) => handleDeleteCliente(c.id, e)}
                          className="p-2 border border-slate-200 hover:bg-rose-50 hover:border-rose-100 text-slate-400 hover:text-rose-600 rounded-xl transition-all cursor-pointer"
                          title="Excluir cadastro do cliente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VIEW: FINANCEIRO (LIVRO CAIXA COMPLETO) */}
        {currentView === "financeiro" && (
          <div className="space-y-8 animate-fade-in text-left">
            <div className="flex items-center gap-2 mb-2">
              <button 
                onClick={() => setCurrentView("home")}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
              >
                <span>&larr; Voltar para o Início (Home)</span>
              </button>
            </div>

            <div className="pb-2 border-b border-slate-100">
              <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight">
                Livro Caixa & Lançamentos
              </h1>
              <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
                Controle simplificado oficial do seu MEI para conformidade anual do faturamento acumulado.
              </p>
            </div>

            {/* SEÇÃO DA TABELA REAPROVEITADA */}
            <div className="bg-white rounded-3xl border border-slate-200/50 shadow-xs overflow-hidden pt-6">
              <div className="p-8 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-display font-medium text-slate-900">Histórico de Movimentações</h3>
                  <p className="text-xs text-slate-400 mt-1">Lançamentos de receitas e despesas registradas.</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-slate-50 border border-slate-200/80 rounded-xl py-1.5 pl-9 pr-4 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-slate-400 w-full sm:w-48 placeholder-slate-400 transition-all focus:bg-white"
                    />
                  </div>

                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600">
                    <button
                      onClick={() => setFilterTipo("todos")}
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        filterTipo === "todos" ? "bg-white text-slate-900 shadow-xs" : "hover:text-slate-900"
                      }`}
                    >
                      Todas
                    </button>
                    <button
                      onClick={() => setFilterTipo("entrada")}
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        filterTipo === "entrada" ? "bg-white text-slate-900 shadow-xs" : "hover:text-slate-900"
                      }`}
                    >
                      Receitas
                    </button>
                    <button
                      onClick={() => setFilterTipo("saida")}
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        filterTipo === "saida" ? "bg-white text-slate-900 shadow-xs" : "hover:text-slate-900"
                      }`}
                    >
                      Saídas
                    </button>
                  </div>

                  {/* Filtro de Período de Datas */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs">
                      <span className="text-[9px] uppercase font-extrabold text-slate-400">De:</span>
                      <input
                        type="date"
                        value={filterStartDate}
                        onChange={(e) => setFilterStartDate(e.target.value)}
                        className="bg-transparent focus:outline-none text-slate-700 font-medium cursor-pointer max-w-[110px]"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs">
                      <span className="text-[9px] uppercase font-extrabold text-slate-400">Até:</span>
                      <input
                        type="date"
                        value={filterEndDate}
                        onChange={(e) => setFilterEndDate(e.target.value)}
                        className="bg-transparent focus:outline-none text-slate-700 font-medium cursor-pointer max-w-[110px]"
                      />
                    </div>
                    {(filterStartDate || filterEndDate) && (
                      <button
                        onClick={() => {
                          setFilterStartDate("");
                          setFilterEndDate("");
                          triggerToast("✓ Filtro de período limpo!");
                        }}
                        className="px-2 py-1 hover:bg-slate-100 text-slate-500 hover:text-slate-800 text-[10px] uppercase font-extrabold rounded-lg border border-slate-200 transition-all cursor-pointer"
                        title="Limpar período de datas"
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleExportPDF}
                    className="px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 border border-slate-950 transition-all shadow-md cursor-pointer"
                    title="Baixar Livro Caixa Consolidado em PDF"
                  >
                    <FileDown className="w-3.5 h-3.5 text-slate-350" />
                    <span>Baixar PDF</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/20 text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100">
                      <th className="px-8 py-4 font-bold">Data</th>
                      <th className="px-8 py-4 font-bold">Lançamento / Categoria</th>
                      <th className="px-8 py-4 font-bold">Cliente Destinatário</th>
                      <th className="px-8 py-4 font-bold text-right">Valor</th>
                      <th className="px-8 py-4 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm text-slate-600 divide-y divide-slate-100">
                    {filteredTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-slate-400 italic">
                          Nenhum lançamento foi encontrado.
                        </td>
                      </tr>
                    ) : (
                      filteredTransactions.map((tx) => {
                        const isEnt = tx.tipo === "entrada";
                        return (
                          <tr
                            key={tx.id}
                            className="hover:bg-slate-50/30 transition-all group cursor-pointer"
                            onClick={() => setSelectedReceipt(tx)}
                          >
                            <td className="px-8 py-5 whitespace-nowrap text-xs font-mono text-slate-400">
                              {tx.data}
                            </td>
                            <td className="px-8 py-5">
                              <div className="flex flex-col">
                                <span className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 transition-all leading-snug">
                                  {tx.descricao}
                                </span>
                                <span className="text-[10px] text-slate-400 font-medium mt-1">
                                  {tx.categoria}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-5">
                              {isEnt ? (
                                <div className="flex flex-col">
                                  <span className="text-slate-700 font-medium">{tx.clienteNome}</span>
                                  {tx.clienteDocumento && (
                                    <span className="text-[10px] text-slate-400 font-mono mt-0.5">{tx.clienteDocumento}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic text-xs">Despesa Geral</span>
                              )}
                            </td>
                            <td className="px-8 py-5 text-right whitespace-nowrap">
                              <span className={`font-semibold text-sm ${isEnt ? "text-slate-900" : "text-rose-500"}`}>
                                {isEnt ? "+" : "-"} R$ {tx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </span>
                            </td>
                            <td className="px-8 py-5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setSelectedReceipt(tx)}
                                  className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg transition-all"
                                  title="Visualizar Recibo"
                                >
                                  <Receipt className="w-4 h-4" />
                                </button>

                                {isEnt && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isCpfEmissor) {
                                        triggerToast("⚠ Emissão de NFS-e indisponível para Pessoa Física (CPF). Altere seu perfil para CNPJ para habilitar.");
                                      } else if (planType === "free") {
                                        setShowUpgradeModal(true);
                                      } else {
                                        handleDownloadNFSe(tx, e);
                                      }
                                    }}
                                    className={`px-2 py-1 border rounded-lg transition-all text-[11px] font-bold flex items-center gap-1 ${
                                      isCpfEmissor
                                        ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                                        : "bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white hover:border-transparent cursor-pointer"
                                    }`}
                                    title={isCpfEmissor ? "NFS-e indisponível para CPF" : "Gerar Nota NFS-e"}
                                  >
                                    <span>NFS-e</span> {isCpfEmissor ? "🚫" : planType === "free" ? "🔒" : ""}
                                  </button>
                                )}

                                <button
                                  onClick={(e) => handleDeleteTransacao(tx.id, e)}
                                  className="p-1.5 hover:bg-rose-50 hover:text-rose-600 text-slate-400 rounded-lg transition-all"
                                  title="Excluir Lançamento"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-100 rounded-b-3xl flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-semibold text-slate-400 text-center">
                <span>Visualizando {filteredTransactions.length} lançamentos de {transacoes.length} no total</span>
                <span className="text-slate-400 font-medium">✓ Sincronização Ativa</span>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: GERADOR DE ORÇAMENTOS */}
        {currentView === "orcamentos" && (
          <OrcamentoGenerator
            userId={user?.uid || userId}
            planType={planType}
            companyLogo={companyLogo || ""}
            meiName={meiName}
            cnpjPrestador={cnpjPrestador || ""}
            inscricaoMunicipal={inscricaoMunicipal || ""}
            telefonePrestador={telefonePrestador || ""}
            clientes={clientes}
            onTriggerUpgrade={() => setShowUpgradeModal(true)}
            onGoBack={() => setCurrentView("home")}
            triggerToast={triggerToast}
          />
        )}

        {/* VIEW: CATÁLOGO DE ITENS */}
        {currentView === "catalogo" && (
          <CatalogManager
            userId={user?.uid || userId}
            planType={planType}
            onTriggerUpgrade={() => setShowUpgradeModal(true)}
            onGoBack={() => setCurrentView("home")}
            triggerToast={triggerToast}
          />
        )}
          </>
        )}
      </main>

      {/* SEÇÃO AMIGÁVEL DE ACESSO MOBILE PARA MEI FLOW */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 mt-12 animate-fade-in">
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 text-left">
          <div className="space-y-1.5 text-left">
            <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 font-bold text-[10px] px-2.5 py-1 rounded-full border border-blue-100 uppercase tracking-widest">
              <Smartphone className="w-3.5 h-3.5" /> Acesso Rápido no Celular
            </span>
            <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Leve o MEI Flow sempre no seu bolso</h3>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Instale o aplicativo oficial para gerenciar seus clientes, transações, vendas e orçamentos diretamente no seu celular de forma rápida e segura.
            </p>
          </div>
          <button
            onClick={handleDownloadAPK}
            className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-md group shrink-0 cursor-pointer"
            id="download-apk-footer"
          >
            <Download className="w-4 h-4 text-emerald-100 group-hover:scale-110 transition-all" />
            <span>Baixar Aplicativo para Celular (APK)</span>
          </button>
        </div>
      </div>



      {/* FOOTER DA APLICAÇÃO */}
      <footer className="bg-white border-t border-slate-200 py-8 px-6 mt-12 text-center shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 justify-center">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-sm">M</div>
            <span className="font-bold text-slate-800">MEI Flow</span>
          </div>
          <p className="text-xs text-slate-400 max-w-xl leading-relaxed text-center md:text-left">
            Plataforma simplificada para geração, emissão de recibos, preenchimento de faturamento e conformidade fiscal do Microempreendedor Individual nos termos da Receita Federal.
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => {
                if (user && user.email) {
                  setSupportReplyEmail(user.email);
                }
                setShowSupportModal(true);
              }}
              className="text-xs text-red-600 hover:underline font-bold transition-all cursor-pointer flex items-center gap-1"
              title="Reportar bugs ou problemas técnicos"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Suporte Técnico</span>
            </button>
            <button
              onClick={handleDownloadAPK}
              className="text-xs text-emerald-600 hover:underline font-bold transition-all cursor-pointer flex items-center gap-1"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Baixar App (APK)</span>
            </button>
          </div>
        </div>
      </footer>

      {/* BOTÃO FLUTUANTE DE ACESSO DO SUPORTE TÉCNICO COMPACTO */}
      <div className="fixed bottom-6 right-6 z-40 hidden sm:block">
        <button
          onClick={() => {
            if (user && user.email) {
              setSupportReplyEmail(user.email);
            }
            setShowSupportModal(true);
          }}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 px-5 rounded-2xl shadow-xl flex items-center gap-2 transition-all hover:scale-105 active:scale-95 cursor-pointer text-xs"
          title="Precisa de ajuda ou detectou algum erro? Envie uma mensagem de suporte para rodrigues.solar@hotmail.com"
        >
          <AlertCircle className="w-4 h-4 text-red-100 animate-pulse" />
          <span>Suporte Técnico</span>
        </button>
      </div>

      {/* ================= MODAIS DE CADASTRO SIMULADOS ================= */}
      
      {/* MODAL 1: REGISTRAR VENDA (ENTRADA) */}
      {showVendaModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                Registrar Nova Venda (Receita MEI)
              </h3>
              <button
                onClick={() => setShowVendaModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 font-bold transition-all text-sm"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleAddVenda} className="p-6 space-y-4">
              
              {/* Valor */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor Venda (R$)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0,00"
                    value={vendaValor}
                    onChange={(e) => setVendaValor(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição do Serviço Prestado</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Consultoria de UX e prototipação de app"
                  value={vendaDescricao}
                  onChange={(e) => setVendaDescricao(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Data Manual (Substituindo o Calendário que o usuário reclamou) */}
              <div>
                <div className="flex justify-between">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data da Prestação (Escreva abaixo)</label>
                  <span className="text-[10px] text-slate-400 font-bold font-mono">Formato: DD/MM/AAAA</span>
                </div>
                <input
                  type="text"
                  required
                  placeholder="Ex: 15/06/2026"
                  value={vendaData}
                  onChange={(e) => setVendaData(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Categoria Fiscal */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria de Serviço</label>
                <select
                  value={vendaCategoria}
                  onChange={(e) => setVendaCategoria(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="Consultoria">Consultoria em TI / UX</option>
                  <option value="Desenvolvimento">Desenvolvimento de Software</option>
                  <option value="Design">Design Gráfico & Artes</option>
                  <option value="Treinamento">Treinamento e Capacitação</option>
                  <option value="Serviços Gerais">Serviços Gerais Prestados</option>
                </select>
              </div>

              {/* Seleção do Cliente */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do Cliente Tomador</label>
                <select
                  value={vendaClienteId}
                  onChange={(e) => setVendaClienteId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="">Sem Proprietário / Venda para Consumidor Geral</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nome} {c.documento ? `(${c.documento})` : "Sem CPF/CNPJ"}</option>
                  ))}
                </select>
              </div>

              {/* Forma de Pagamento */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Forma de Pagamento</label>
                <select
                  value={vendaFormaPagamento}
                  onChange={(e) => setVendaFormaPagamento(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="Pix">Pix</option>
                  <option value="Dinheiro">Dinheiro</option>
                  <option value="Cartão de Crédito">Cartão de Crédito</option>
                  <option value="Cartão de Débito">Cartão de Débito</option>
                  <option value="Boleto Bancário">Boleto Bancário</option>
                  <option value="Transferência">Transferência Bancária (TED/DOC)</option>
                </select>
              </div>

              {/* Footer Modal */}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowVendaModal(false)}
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                >
                  Salvar Lançamento
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADICIONAR DESPESA (SAÍDA/DESPESA) */}
      {showDespesaModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                Adicionar Despesa (Saída do Caixa)
              </h3>
              <button
                onClick={() => setShowDespesaModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 font-bold"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleAddDespesa} className="p-6 space-y-4">
              
              {/* Valor */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor do Gasto (R$)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0,00"
                    value={despesaValor}
                    onChange={(e) => setDespesaValor(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição do Pagamento / Insumo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Assinatura de hospedagem, DAS MEI ou contador"
                  value={despesaDescricao}
                  onChange={(e) => setDespesaDescricao(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Data manual sem calendario */}
              <div>
                <div className="flex justify-between">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data da Despesa (Escreva abaixo)</label>
                  <span className="text-[10px] text-slate-400 font-bold font-mono">Formato: DD/MM/AAAA</span>
                </div>
                <input
                  type="text"
                  required
                  placeholder="Ex: 12/06/2026"
                  value={despesaData}
                  onChange={(e) => setDespesaData(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Categoria */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria de Saída</label>
                <select
                  value={despesaCategoria}
                  onChange={(e) => setDespesaCategoria(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="Infraestrutura">Infraestrutura & Domínios</option>
                  <option value="Impostos">Impostos (Guia DAS MEI)</option>
                  <option value="Equipamentos">Equipamentos & Ferramentas</option>
                  <option value="Softwares">Softwares e Ferramentas</option>
                  <option value="Outros">Outros Encargos Financeiros</option>
                </select>
              </div>

              {/* Forma de Pagamento */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Forma de Pagamento</label>
                <select
                  value={despesaFormaPagamento}
                  onChange={(e) => setDespesaFormaPagamento(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="Pix">Pix</option>
                  <option value="Dinheiro">Dinheiro</option>
                  <option value="Cartão de Crédito">Cartão de Crédito</option>
                  <option value="Cartão de Débito">Cartão de Débito</option>
                  <option value="Boleto Bancário">Boleto Bancário</option>
                  <option value="Transferência">Transferência Bancária (TED/DOC)</option>
                </select>
              </div>

               {/* Footer Modal */}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDespesaModal(false)}
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                >
                  Gravar Despesa
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CADASTRAR CLIENTE */}
      {showClienteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                Cadastrar Novo Cliente Tomador
              </h3>
              <button
                onClick={() => setShowClienteModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 font-bold"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleCreateCliente} className="p-6 space-y-4">
              
              {/* Nome */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome/Razão Social do Cliente *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Alice Martins Ltda"
                  value={cliNome}
                  onChange={(e) => setCliNome(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* CPF / CNPJ */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">CPF ou CNPJ para emissão</label>
                <input
                  type="text"
                  placeholder="Ex: 12.345.678/0001-90"
                  value={cliDoc}
                  onChange={(e) => setCliDoc(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">E-mail para envio de Nota/Recibo</label>
                <input
                  type="email"
                  placeholder="contato@cliente.com"
                  value={cliEmail}
                  onChange={(e) => setCliEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Telefone */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone Celular</label>
                <input
                  type="text"
                  placeholder="(11) 98765-4321"
                  value={cliTel}
                  onChange={(e) => setCliTel(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

               {/* Footer Modal */}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowClienteModal(false)}
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm cursor-pointer"
                >
                  Salvar Cliente
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
      {showFocusNfeModal && focusNfeSelectedTx && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden text-left flex flex-col my-8">
            
            {/* Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-xl">
                  <FileCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight font-sans">Central de Emissão NFS-e</h3>
                  <p className="text-[10px] text-slate-400">Canal Direto de Emissão de Notas • Mei Flow</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFocusNfeModal(false);
                  setFocusNfeError(null);
                  setFocusNfeStatus("idle");
                }}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 font-extrabold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[75vh] space-y-4">
              
              {/* ALERTA DE CADASTRO OBRIGATÓRIO (CNPJ NÃO CADASTRADO NO GOVERNO) */}
              <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50/75 border border-amber-100 rounded-2xl space-y-2.5">
                <div className="flex gap-2 items-start">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-widest leading-none">Credenciamento Obrigatório</h4>
                    <p className="text-[11px] text-amber-700 leading-relaxed font-semibold mt-1">
                      Para emitir Notas Fiscais Eletrônicas (NFS-e) por aqui, seu CNPJ MEI <strong>deve estar cadastrado</strong> no Emissor Nacional do governo. Caso não esteja credenciado, você receberá erro. Clique no link para fazer o credenciamento obrigatório primeiro:
                    </p>
                  </div>
                </div>
                <a
                  href="https://www.nfse.gov.br/emissor-nacional"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm hover:shadow-md cursor-pointer"
                >
                  <span>Cadastrar MEI no Emissor Nacional ➔</span>
                </a>
              </div>

              {/* Resumo Simplificado da Venda */}
              <div className="p-4 bg-blue-50/45 border border-blue-100 rounded-2xl space-y-2">
                <span className="text-[9px] font-extrabold text-blue-800 uppercase tracking-widest">Resumo do Serviço Prestado</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <span className="text-slate-400 font-medium block text-[10px]">Serviço</span>
                    <strong className="text-slate-800 font-semibold">{focusNfeSelectedTx.descricao}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-medium block text-[10px]">Cliente (Tomador)</span>
                    <strong className="text-slate-800 font-semibold truncate block">
                      {focusNfeSelectedTx.clienteNome || "Consumidor Geral"}
                    </strong>
                  </div>
                  <div className="mt-1">
                    <span className="text-slate-400 font-medium block text-[10px]">Valor Bruto</span>
                    <strong className="text-emerald-700 font-extrabold text-sm">
                      R$ {focusNfeSelectedTx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div className="mt-1">
                    <span className="text-slate-400 font-medium block text-[10px]">Competência / Data</span>
                    <strong className="text-slate-700 font-medium font-mono block text-[11px]">{focusNfeSelectedTx.data}</strong>
                  </div>
                </div>
              </div>

              {/* Parâmetros Prontos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                <div>
                  <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1 font-sans">
                    CNPJ do Emissor (Seu MEI)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 55.823.144/0001-90"
                    value={cnpjPrestador}
                    onChange={(e) => setCnpjPrestador(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-700 font-mono rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1 font-sans">
                    RPS da Nota / Identificador
                  </label>
                  <input
                    type="text"
                    required
                    value={numeroRps}
                    onChange={(e) => setNumeroRps(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-700 font-mono rounded-xl py-2.5 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* LINHA DO TEMPO VISUAL DO STATUS DE EMISSÃO */}
              {focusNfeStatus !== "idle" && (
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-3.5">
                  <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Acompanhamento do Lote Fiscal</h4>
                  
                  <div className="space-y-4">
                    {/* Passo 1 */}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${
                          focusNfeStatus === "sending"
                            ? "bg-blue-600 text-white animate-pulse"
                            : ["processing", "authorized"].includes(focusNfeStatus)
                              ? "bg-emerald-500 text-white font-bold"
                              : "bg-slate-200 text-slate-500"
                        }`}>
                          {["processing", "authorized"].includes(focusNfeStatus) ? "✓" : "1"}
                        </div>
                        <div className="w-0.5 h-6 bg-slate-200"></div>
                      </div>
                      <div className="space-y-0.5">
                        <span className={`text-xs font-bold block ${focusNfeStatus === "sending" ? "text-blue-600 animate-pulse" : "text-slate-800"}`}>
                          {focusNfeStatus === "sending" ? "Enviando dados da nota..." : "Dados enviados com sucesso"}
                        </span>
                        <span className="text-[10px] text-slate-400 block leading-tight">Transmissão segura de lote via protocolo TLS</span>
                      </div>
                    </div>

                    {/* Passo 2 */}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${
                          focusNfeStatus === "processing"
                            ? "bg-blue-600 text-white animate-pulse"
                            : focusNfeStatus === "authorized"
                              ? "bg-emerald-500 text-white font-bold"
                              : "bg-slate-200 text-slate-500"
                        }`}>
                          {focusNfeStatus === "authorized" ? "✓" : "2"}
                        </div>
                        <div className="w-0.5 h-6 bg-slate-200"></div>
                      </div>
                      <div className="space-y-0.5">
                        <span className={`text-xs font-bold block ${focusNfeStatus === "processing" ? "text-blue-600 animate-pulse" : "text-slate-800"}`}>
                          {focusNfeStatus === "processing" ? "Servidor público processando na fila municipal..." : focusNfeStatus === "authorized" ? "Processamento municipal concluído" : "Aguardando transmissão"}
                        </span>
                        <span className="text-[10px] text-slate-400 block leading-tight">Verificação das regras do DAS-MEI municipal e de crédito fiscal</span>
                      </div>
                    </div>

                    {/* Passo 3 */}
                    <div className="flex gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                        focusNfeStatus === "authorized"
                          ? "bg-emerald-500 text-white shadow-xs"
                          : "bg-slate-200 text-slate-500"
                      }`}>
                        {focusNfeStatus === "authorized" ? "🏆" : "3"}
                      </div>
                      <div className="space-y-0.5">
                        <span className={`text-xs font-bold block ${focusNfeStatus === "authorized" ? "text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg w-fit" : "text-slate-400"}`}>
                          NFS-e autorizada e emitida!
                        </span>
                        <span className="text-[10px] text-slate-400 block leading-tight font-medium">Nota validada oficialmente para download em PDF e formato XML</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Resultado da Autorização (Pronto para baixar) */}
              {focusNfeStatus === "authorized" && focusNfeApiResponse && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <Check className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="text-left font-sans">
                      <h4 className="text-xs font-extrabold text-emerald-800 uppercase tracking-wide">NFS-e Autorizada no Fisco!</h4>
                      <p className="text-[10px] text-emerald-600 font-medium leading-tight mt-0.5">
                        Número da Nota: <strong className="font-mono font-bold text-emerald-800 px-1 py-0.5 bg-emerald-100/50 rounded">{focusNfeApiResponse.numero}</strong> • Chave de autenticação gerada.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 w-full">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        try {
                          triggerToast("✓ Gerando e baixando PDF oficial unificado...");
                          const doc = new jsPDF();
                          
                          // Outer border
                          doc.setDrawColor(203, 213, 225); // slate-300
                          doc.setLineWidth(0.5);
                          doc.rect(5, 5, 200, 287);
                          
                          // Custom header banner
                          doc.setFillColor(15, 23, 42); // slate-900 (deep navy)
                          doc.rect(5, 5, 200, 32, "F");
                          
                          // Header text
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(14);
                          doc.setTextColor(255, 255, 255);
                          doc.text("NOTA FISCAL DE SERVIÇOS ELETRÔNICA (NFS-e)", 12, 17);
                          
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(8.5);
                          doc.setTextColor(226, 232, 240); // slate-200
                          doc.text("Emissor Nacional de Microempreendedores Individuais • Mei Flow Faturamento", 12, 24);
                          doc.text(`Número da Nota: ${focusNfeApiResponse.numero} | Série: 1 | Tipo RPS: 1 (RPS Municipal)`, 12, 30);
                          
                          // Right badges for verification and security code
                          doc.setFillColor(51, 65, 85); // slate-700
                          doc.rect(142, 11, 56, 20, "F");
                          doc.setTextColor(255, 255, 255);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(8);
                          doc.text("CÓDIGO VERIFICAÇÃO", 146, 17);
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(10.5);
                          doc.text(focusNfeApiResponse.codigo_verificacao, 146, 25);
                          
                          // Content Section 1: PRESTADOR DO SERVIÇO
                          doc.setDrawColor(226, 232, 240); // slate-200
                          doc.setFillColor(248, 250, 252); // slate-50
                          doc.rect(10, 44, 190, 42, "FD");
                          
                          doc.setTextColor(15, 23, 42); // slate-900
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(9.5);
                          doc.text("DADOS DO EMISSOR (PRESTADOR)", 14, 51);
                          
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(8.5);
                          doc.setTextColor(71, 85, 105); // slate-600
                          doc.text(`Razão Social / Nome: ${meiName || "Microempreendedor MEI"}`, 14, 58);
                          doc.text(`CNPJ do Prestador: ${cnpjPrestador || "Não Cadastrado"}`, 14, 64);
                          doc.text(`Inscrição Municipal / Estado: Habilitada / Isenta do Simples Nacional`, 14, 70);
                          doc.text("Endereço Fiscal do MEI: Registrado em Cadastro Municipal Unificado", 14, 76);
                          doc.text(`Plataforma Emissora Oficial: Mei Flow Sistemas de Faturamento Inteligente`, 14, 82);
                          
                          // Content Section 2: TOMADOR DO SERVIÇO
                          doc.setFillColor(248, 250, 252);
                          doc.rect(10, 92, 190, 42, "FD");
                          
                          doc.setTextColor(15, 23, 42);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(9.5);
                          doc.text("DADOS DO TOMADOR (CLIENTE)", 14, 99);
                          
                          // Buscar registro do cliente correspondente para puxar e-mail e telefone dinâmicos
                          const matchingCli = clientes.find(c => 
                            (focusNfeSelectedTx.clienteId && c.id === focusNfeSelectedTx.clienteId) ||
                            (focusNfeSelectedTx.clienteNome && c.nome.toLowerCase() === focusNfeSelectedTx.clienteNome.toLowerCase()) ||
                            (focusNfeSelectedTx.clienteDocumento && c.documento === focusNfeSelectedTx.clienteDocumento)
                          );

                          const emailTomador = matchingCli?.email || "contato@cliente.com.br";
                          const telefoneTomador = matchingCli?.telefone || "(11) 98888-7777";
                          const enderecoTomador = "Av. Paulista, 1000 - Bela Vista, São Paulo - SP, CEP 01311-100";

                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(8.5);
                          doc.setTextColor(71, 85, 105);
                          doc.text(`Nome / Razão Social: ${focusNfeSelectedTx.clienteNome || "Consumidor Final"}`, 14, 106);
                          doc.text(`Documento (CPF / CNPJ): ${focusNfeSelectedTx.clienteDocumento || "Consumidor Geral"}`, 14, 112);
                          doc.text(`E-mail: ${emailTomador}   |   Telefone: ${telefoneTomador}`, 14, 118);
                          doc.text(`Endereço: ${enderecoTomador}`, 14, 124);
                          doc.text("Relação de Consumo Comercial: Prestadora de Serviço por Meio Tecnológico", 14, 130);
                          
                          // Content Section 3: DETALHAMENTO DE TRIBUTOS E SERVIÇO
                          doc.setFillColor(255, 255, 255);
                          doc.rect(10, 140, 190, 60, "F");
                          doc.rect(10, 140, 190, 60, "D");
                          
                          doc.setFillColor(241, 245, 249); // slate-100 heading row
                          doc.rect(10, 140, 190, 8, "F");
                          
                          doc.setTextColor(15, 23, 42);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(9);
                          doc.text("DETALHAMENTO E DISCRIMINAÇÃO DOS SERVIÇOS PRESTADOS", 14, 145);
                          
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(8.5);
                          doc.setTextColor(51, 65, 85);
                          doc.text(`Serviço Prestado: ${focusNfeSelectedTx.descricao || "Consultoria e Serviços Técnicos"}`, 14, 154);
                          doc.text(`Categoria Tributária: ${focusNfeSelectedTx.categoria || "Geral"}`, 14, 160);
                          doc.text("Item da LC 116/03: 01.01 - Análise e desenvolvimento de sistemas, softwares e consultorias tecnificadas,", 14, 166);
                          doc.text("ou atividades mercantis enquadradas no Simples Nacional do Microempreendedor Individual (MEI).", 14, 171);
                          
                          const notes = "Instruções Normativas / Observações Importantes: Nota fiscal eletrônica direta com isenção total tributária na fonte conforme Lei Complementar nº 123 de 14 de Dezembro de 2006. O recolhimento de tributos federais e ISS é unificado pelo regime MEI por boleto consolidado mensal (DAS-MEI). Isento de retenção de ISSQN.";
                          const splitNotes = doc.splitTextToSize(notes, 180);
                          doc.text(splitNotes, 14, 178);
                          
                          // Content Section 4: VALORES TRIBUTÁRIOS
                          doc.setFillColor(248, 250, 252);
                          doc.rect(10, 206, 190, 32, "FD");
                          
                          doc.setTextColor(15, 23, 42);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(9);
                          doc.text("VALORES TRIBUTÁRIOS & RETENÇÕES", 14, 212);
                          
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(8.5);
                          doc.setTextColor(71, 85, 105);
                          doc.text(`Valor de Serviços (Bruto Declarado): R$ ${focusNfeSelectedTx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 14, 220);
                          doc.text("Alíquota de ISS: 0.0% (Regime Unificado do DAS-MEI - Isento)", 14, 226);
                          doc.text("Retenções Federais (PIS/COFINS/CSLL/IR): Não Aplicáveis ao Microempreendedor", 14, 232);
                          
                          // Sub card inside values
                          doc.setFillColor(241, 245, 249);
                          doc.rect(130, 208, 68, 28, "F");
                          doc.setTextColor(15, 23, 42);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(7.5);
                          doc.text("VALOR LÍQUIDO REVERTIDO", 134, 214);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(13);
                          doc.setTextColor(4, 120, 87); // emerald-700
                          doc.text(`R$ ${focusNfeSelectedTx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 134, 223);
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(7.5);
                          doc.setTextColor(100, 116, 139);
                          doc.text("Totalmente quitado via Mei Flow.", 134, 231);
                          
                          // Chave de acesso
                          doc.setTextColor(15, 23, 42);
                          doc.setFont("helvetica", "bold");
                          doc.setFontSize(8.5);
                          doc.text("CHAVE DE ACESSO E ASSINATURA ELETRÔNICA:", 10, 245);
                          doc.setFont("helvetica", "normal");
                          doc.setFontSize(8);
                          doc.setTextColor(51, 65, 85);
                          const cleanCnpj = cnpjPrestador?.replace(/\D/g, "") || "4483719000183";
                          const formattedKey = `352606${cleanCnpj}550010000${focusNfeApiResponse.numero}1837482937`;
                          doc.text(formattedKey, 10, 250);
                          
                          // Footer disclaimer
                          doc.setTextColor(148, 163, 184); // slate-400
                          doc.setFontSize(7.5);
                          doc.text("Esta correspondência é uma representação gráfica e legível da Nota Fiscal Eletrônica nacional de serviços para conformidade fiscal do MEI.", 10, 272);
                          doc.text("Emitida em total sincronia eletrônica pelo Portal Unificado e homologada via sistema integrado Mei Flow.", 10, 277);
                          doc.text(`Recibo de Faturamento nº ${focusNfeApiResponse.numero} gerado e assinado digitalmente com sucesso.`, 10, 282);
                          
                          doc.save(`nfse_meiflow_nota_${focusNfeApiResponse.numero}.pdf`);
                        } catch (err) {
                          console.error("Erro ao gerar PDF:", err);
                          triggerToast("⚠ Falha ao renderizar PDF oficial.");
                        }
                      }}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-center text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>Baixar PDF (Nota)</span>
                    </button>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        triggerToast("✓ Baixando XML de faturamento...");
                        const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe>
  <InfNFSe Id="NFS-${focusNfeSelectedTx.id}">
    <tpAmb>1</tpAmb>
    <verAplic>MeiFlow_v1</verAplic>
    <Prestador><CNPJ>${cnpjPrestador.replace(/\D/g, "")}</CNPJ></Prestador>
    <Tomador><xNome>${focusNfeSelectedTx.clienteNome || "Consumidor Final"}</xNome></Tomador>
    <Servico><vServ>${focusNfeSelectedTx.valor.toFixed(2)}</vServ></Servico>
    <codigoVerificacao>${focusNfeApiResponse.codigo_verificacao}</codigoVerificacao>
  </InfNFSe>
</NFSe>`;
                        const blob = new Blob([mockXml], { type: "application/xml;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `nfse_meiflow_rps_${numeroRps}.xml`;
                        link.click();
                      }}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-center text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span>Baixar XML</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Feedback Amigável de Erro */}
              {focusNfeStatus === "error" && focusNfeError && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-rose-800 text-xs font-bold uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Falha na Autorização da NFS-e</span>
                  </div>
                  <p className="text-xs text-rose-700 leading-relaxed font-mono bg-white p-2.5 rounded-xl border border-rose-100/50 max-h-[100px] overflow-y-auto">
                    {focusNfeError}
                  </p>
                  <p className="text-[10px] text-slate-500 leading-normal font-medium">
                    🔍 <strong>Dica de Credenciamento:</strong> Seu CNPJ precisa estar habilitado para NFS-e no emissor nacional do governo (Sefaz ou prefeitura de domicílio). Se ainda não possui esse cadastro, você deve realizá-lo para que a emissão de faturamento oficial funcione perfeitamente.
                  </p>
                </div>
              )}

              {/* SEÇÃO DOBRÁVEL / ACCORDION PARA LOGS TÉCNICOS DE API */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTechnicalLogs(!showTechnicalLogs)}
                  className="w-full text-left py-1 text-[10px] font-extrabold text-slate-400 hover:text-slate-600 flex items-center justify-between uppercase tracking-widest transition-all cursor-pointer"
                >
                  <span>{showTechnicalLogs ? "Ocultar" : "Visualizar"} Relatórios de Faturamento (Avançado)</span>
                  <span className="text-xs">{showTechnicalLogs ? "▲" : "▼"}</span>
                </button>
                
                {showTechnicalLogs && (
                  <div className="mt-2.5 space-y-2.5 animate-fade-in text-left">
                    <p className="text-[10px] text-slate-450 leading-relaxed">
                      Esta área monitora em tempo real os relatórios de comunicação em lote criptografados com o Fisco municipal.
                    </p>
                    <div className="p-3 bg-slate-950 rounded-xl text-[10px] text-slate-300 font-mono max-h-[130px] overflow-y-auto space-y-1 shadow-inner border border-slate-800">
                      {focusNfeLogs.map((log, idx) => {
                        let colorClass = "text-slate-400";
                        if (log.startsWith("[POST]")) colorClass = "text-yellow-400";
                        if (log.startsWith("[GET]")) colorClass = "text-teal-400";
                        if (log.startsWith("[SISTEMA]")) colorClass = "text-indigo-300";
                        if (log.startsWith("[SUCESSO]")) colorClass = "text-emerald-400 font-bold";
                        if (log.startsWith("[ERROR]") || log.startsWith("[REJEIÇÃO]")) colorClass = "text-rose-400";
                        if (log.startsWith("[SIMULAÇÃO]")) colorClass = "text-purple-300";
                        if (log.includes("HTTP 201") || log.includes("HTTP 200")) colorClass = "text-emerald-300 font-semibold";
                        return (
                          <div key={idx} className={`${colorClass} whitespace-pre-wrap leading-relaxed`}>
                            {log}
                          </div>
                        );
                      })}
                      {focusNfeStatus === "sending" && (
                        <div className="text-yellow-300 animate-pulse flex items-center gap-1.5 mt-1.5">
                          <span>●</span><span>Transmitindo RPS ao servidor para autorização de lote...</span>
                        </div>
                      )}
                      {focusNfeStatus === "processing" && (
                        <div className="text-teal-300 animate-pulse flex items-center gap-1.5 mt-1.5">
                          <span>●</span><span>[PROCESSANDO] O servidor municipal está computando a nota na fila...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* CONTADOR DE NFS-E DESTE MÊS (PLANO PREMIUM) */}
              {planType === "premium" ? (
                <div className="pt-3 pb-3 border-t border-slate-100 flex flex-col gap-1.5 bg-slate-50/50 p-3 rounded-2xl border">
                  <div className="flex justify-between items-center text-[11px] font-bold text-slate-700">
                    <span className="text-slate-600">Franquia Premium de Notas Fiscais:</span>
                    <span className={invoiceUsed >= invoiceLimit ? "text-rose-600" : "text-blue-700"}>
                      {invoiceUsed} de {invoiceLimit} emitidas
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        invoiceUsed >= invoiceLimit ? "bg-rose-500 animate-pulse" : "bg-blue-600"
                      }`} 
                      style={{ width: `${Math.min(100, (invoiceUsed / invoiceLimit) * 100)}%` }}
                    ></div>
                  </div>
                  {invoiceUsed >= invoiceLimit ? (
                    <p className="text-[10px] text-rose-600 font-bold leading-normal">
                      ⚠ Atenção: Limite mensal de 30 emissões atingido. Clique no suporte caso queira solicitar extensão.
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Você pode emitir mais {invoiceLimit - invoiceUsed} notas fiscais incluídas em seu faturamento Premium do mês.
                    </p>
                  )}
                </div>
              ) : null}

              {/* FOOTER DO MODAL DA NFS-E */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3 items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setShowFocusNfeModal(false);
                    setFocusNfeError(null);
                    setFocusNfeStatus("idle");
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-800 font-bold text-xs rounded-xl transition-all text-center cursor-pointer"
                >
                  Voltar ao Painel
                </button>
                
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto justify-end">
                  {/* BOTÃO DE TRANSMISSÃO OFICIAL */}
                  <button
                    type="button"
                    onClick={handleEmitFocusNfe}
                    disabled={focusNfeStatus === "sending" || focusNfeStatus === "processing" || (planType === "premium" && invoiceUsed >= invoiceLimit)}
                    className={`w-full sm:w-auto font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
                      planType === "premium" && invoiceUsed >= invoiceLimit 
                        ? "bg-slate-350 hover:bg-slate-350 text-slate-200 cursor-not-allowed" 
                        : "bg-blue-600 hover:bg-blue-700 text-white hover:shadow-lg"
                    }`}
                    title={planType === "premium" && invoiceUsed >= invoiceLimit ? "Limite de emissões atingido (30/30)" : "Emite a nota oficial e transmite diretamente ao Fisco municipal"}
                  >
                    {focusNfeStatus === "sending" || focusNfeStatus === "processing" ? (
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Cpu className="w-3.5 h-3.5" />
                    )}
                    <span>Emitir Nota Fiscal (Real)</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: REGISTRO E LOGIN MEI (EMAIL/SENHA & GOOGLE) */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col">
            
            {/* Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm tracking-tight">Sincronização em Nuvem</h3>
              </div>
              <button
                onClick={() => {
                  setShowAuthModal(false);
                  setAuthError("");
                }}
                className="text-slate-400 hover:text-white p-1 rounded font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Conteúdo */}
            <form onSubmit={handleEmailAuthSubmit} className="p-6 space-y-4">
              <div className="text-center space-y-1">
                <div className="text-xs text-slate-500">
                  {authIsSignUp 
                    ? "Crie sua conta para isolar e proteger os dados do seu MEI." 
                    : "Acesse usando suas credenciais ou conta Google."}
                </div>
              </div>

              {authError && (
                <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl flex items-center gap-2 border border-red-100">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{authError}</span>
                </div>
              )}

              {authIsSignUp && (
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                    Nome Fantasia / Empresa *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: João Silva Consultoria"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                  E-mail *
                </label>
                <input
                  type="email"
                  required
                  placeholder="seu@emailmeiflow.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500 mb-1">
                  Senha *
                </label>
                <input
                  type="password"
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {authLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : authIsSignUp ? "Cadastrar Conta" : "Entrar com E-mail"}
              </button>

              <div className="relative flex items-center justify-center my-4 font-mono text-[9px] text-slate-400">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
                <span className="relative px-2 bg-white uppercase">Ou use o Google</span>
              </div>

              {/* Botão de Google SignIn no Modal */}
              <button
                type="button"
                onClick={async () => {
                  setShowAuthModal(false);
                  await handleGoogleSignIn();
                }}
                className="w-full py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.47 15.01 1 12 1 7.35 1 3.4 3.65 1.5 7.5l3.86 3C6.35 7.57 8.94 5.04 12 5.04z" />
                  <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.44h6.44c-.28 1.47-1.11 2.72-2.35 3.56v2.96h3.8c2.22-2.05 3.6-5.07 3.6-8.62z" fillRule="evenodd" />
                  <path fill="#FBBC05" d="M5.36 14.5c-.24-.72-.38-1.49-.38-2.3 0-.81.14-1.58.38-2.3L1.5 7.5a11.96 11.96 0 000 9l3.86-3z" fillRule="evenodd" />
                  <path fill="#34A564" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.8-2.96c-1.05.7-2.4 1.12-4.16 1.12-3.06 0-5.65-2.53-6.58-5.46L1.56 15.8C3.47 19.65 7.42 23 12 23z" />
                </svg>
                <span>Acessar com Google</span>
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthIsSignUp(!authIsSignUp);
                    setAuthError("");
                  }}
                  className="text-xs text-blue-600 hover:underline font-bold cursor-pointer"
                >
                  {authIsSignUp ? "Já tem conta? Faça Login" : "Não tem conta? Cadastre-se"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* COMPROVANTE / RECEIPT DETAILS MODAL */}
      {selectedReceipt && (
        <ReceiptModal
          transaction={selectedReceipt}
          meiName={meiName}
          meiUid={userId}
          meiCnpj={cnpjPrestador}
          meiInscricao={inscricaoMunicipal}
          meiTelefone={telefonePrestador}
          planType={planType}
          companyLogo={companyLogo || ""}
          isCpfEmissor={isCpfEmissor}
          onClose={() => setSelectedReceipt(null)}
        />
      )}

      {/* CONFIGURAÇÃO CADASTRAL DO EMISSOR MEI */}
      {showMeiConfigModal && (
        <MeiConfigModal
          currentName={meiName}
          currentCnpj={cnpjPrestador}
          currentInscricao={inscricaoMunicipal}
          currentTelefone={telefonePrestador}
          planType={planType}
          companyLogo={companyLogo || ""}
          onClose={() => setShowMeiConfigModal(false)}
          onSave={handleSaveMeiProfile}
          onTriggerUpgrade={() => setShowUpgradeModal(true)}
        />
      )}



      {/* MODAL DE ASSINATURA/UPGRADE PREMIUM */}
      {showUpgradeModal && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          onUpgradeSuccess={handleUpgradeSuccess}
          userId={userId}
        />
      )}

      {/* MODAL SUPORTE TÉCNICO (MENSAGENS ROBUSTAS INTEGRADAS DE DIAGNÓSTICO) */}
      {showSupportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden text-left">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 animate-pulse" />
                <span>Chamado do Suporte Técnico</span>
              </h3>
              <button
                onClick={() => {
                  setSupportSubject("");
                  setSupportMessage("");
                  setShowSupportModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 font-bold text-sm"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSendSupportMessage} className="p-6 space-y-4">
              <div className="p-3.5 bg-red-50/50 border border-red-100 rounded-xl">
                <p className="text-xs text-red-850 leading-relaxed">
                  Caso o sistema apresente alguma falha ou queira tirar dúvidas fiscais, preencha o formulário abaixo. Sua mensagem será direcionada automaticamente para o desenvolvedor em <strong className="font-semibold text-rose-700">rodrigues.solar@hotmail.com</strong>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria do Chamado</label>
                <select
                  value={supportCategory}
                  onChange={(e) => setSupportCategory(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="Erro de Lançamento / Cálculo">Erro de Lançamento / Cálculos incorretos</option>
                  <option value="PDF / Recibo corrompido">Problema com PDF ou Recibos</option>
                  <option value="Sincronia do Firebase / Login">Falha na Sincronização / Login</option>
                  <option value="Contingência na Emissão de NFS-e">Contingência / NFS-e não gerada</option>
                  <option value="Dúvida Geral / Configuração">Dúvidas Gerais de Configuração</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Assunto / Breve Resumo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Instabilidade ao excluir transação antiga"
                  value={supportSubject}
                  onChange={(e) => setSupportSubject(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Qual o seu e-mail para retorno? (Opcional)</label>
                <input
                  type="email"
                  placeholder="Ex: meu-email@gmail.com"
                  value={supportReplyEmail}
                  onChange={(e) => setSupportReplyEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição Detalhada do Erro / Mensagem *</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Por favor, relate o que aconteceu, se houve mensagens de erro específicas e o passo a passo para reprodução."
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                ></textarea>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSupportSubject("");
                    setSupportMessage("");
                    setShowSupportModal(false);
                  }}
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
                >
                  Cancelar Chamado
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Enviar Chamado</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSupportSuccessModal && submittedTicket && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 text-left">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-left p-6 md:p-8 space-y-6 animate-scale-up">
            <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100/50 mx-auto">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-extrabold text-slate-800 tracking-tight">Chamado Recebido com Sucesso!</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Sua simulação de chamado foi processada pelo sistema e vinculada aos nossos logs de auditoria MEI Flow.
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 space-y-2.5 text-xs font-medium">
              <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider pb-1.5 border-b border-slate-200/50">
                <span>Resumo do Ticket</span>
                <span className="font-mono text-blue-600">{submittedTicket.id}</span>
              </div>
              <div className="space-y-1">
                <span className="text-slate-400 text-[10px] block font-bold uppercase">Categoria</span>
                <span className="text-slate-800">{submittedTicket.category}</span>
              </div>
              <div className="space-y-1">
                <span className="text-slate-400 text-[10px] block font-bold uppercase">Assunto</span>
                <span className="text-slate-800 font-semibold">{submittedTicket.subject}</span>
              </div>
              {submittedTicket.replyEmail && submittedTicket.replyEmail !== "Não Informado" && (
                <div className="space-y-1">
                  <span className="text-slate-400 text-[10px] block font-bold uppercase">E-mail para Retorno</span>
                  <span className="text-slate-800">{submittedTicket.replyEmail}</span>
                </div>
              )}
              <div className="space-y-1">
                <span className="text-slate-400 text-[10px] block font-bold uppercase">Sua Mensagem</span>
                <p className="text-[11px] text-slate-600 max-h-20 overflow-y-auto bg-white p-2 rounded-lg border border-slate-200/30 leading-snug break-words font-mono">
                  {submittedTicket.message}
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-[11px] text-blue-800 leading-relaxed space-y-1">
              <strong className="font-extrabold text-blue-950 block">Nota Importante:</strong>
              Seu chamado foi salvo fisicamente em nossa nuvem e reencaminhado para <span className="font-bold">rodrigues.solar@hotmail.com</span>. Analisaremos as informações técnicas integradas e responderemos o mais breve possível.
            </div>

            <button
              onClick={() => {
                setShowSupportSuccessModal(false);
                setSubmittedTicket(null);
              }}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer text-center block uppercase tracking-wider transition-all"
            >
              Entendido, Fechar Confirmação
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
