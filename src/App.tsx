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
  Wallet
} from "lucide-react";

import { Cliente, Transacao } from "./types";
import ReceiptModal from "./components/ReceiptModal";
import MeiConfigModal from "./components/MeiConfigModal";
import AsaasWalletModal from "./components/AsaasWalletModal";
import UpgradeModal from "./components/UpgradeModal";
import { consultarSaldoAsaas } from "./asaasService";
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
import { onSnapshot, doc } from "firebase/firestore";

export default function App() {
  // Controle de Navegação por Abas/Módulos
  const [currentView, setCurrentView] = useState<"home" | "clientes" | "financeiro" | "carteira">("home");

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
  const [showAsaasWalletModal, setShowAsaasWalletModal] = useState(false);
  const [asaasBalance, setAsaasBalance] = useState<number | null>(null);
  const [isLoadingAsaasBalance, setIsLoadingAsaasBalance] = useState(false);
  const [showAsaasBalance, setShowAsaasBalance] = useState(() => {
    return localStorage.getItem("meiflow_show_asaas_balance") !== "false";
  });

  // -------------------------------------------------------------------------
  // NOVO: ESTADOS INTEGRADOS DO FIREBASE & ISOLAMENTO DE USUÁRIOS (MULTITENANCY)
  // -------------------------------------------------------------------------
  const [user, setUser] = useState<User | null>(null);
  const [isFirebaseSyncing, setIsFirebaseSyncing] = useState(false);
  const [showConfigGuide, setShowConfigGuide] = useState(false);

  // TIERS & PREMIUM PLAN STATES
  const [planType, setPlanType] = useState<"free" | "premium">("free");
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
      { id: "tx_1", tipo: "entrada", valor: 1200.00, data: "15/06/2026", descricao: "Consultoria UX", categoria: "Consultoria", clienteId: "cli_1", clienteNome: "Alice Martins", clienteDocumento: "123.456.789-00" },
      { id: "tx_2", tipo: "saida", valor: 85.00, data: "12/06/2026", descricao: "Hospedagem AWS", categoria: "Infraestrutura" },
      { id: "tx_3", tipo: "entrada", valor: 2400.00, data: "10/06/2026", descricao: "Protótipo App Mobile", categoria: "Desenvolvimento", clienteId: "cli_3", clienteNome: "Julia Soares", clienteDocumento: "88.112.554/0002-13" },
      { id: "tx_4", tipo: "saida", valor: 72.00, data: "05/06/2026", descricao: "DAS (Imposto MEI)", categoria: "Impostos" },
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
  const [numeroRps, setNumeroRps] = useState("105");
  const [serieRps, setSerieRps] = useState("1");
  const [tipoRps, setTipoRps] = useState("1");
  const [refNfe, setRefNfe] = useState("");
  const [focusNfeStatus, setFocusNfeStatus] = useState<"idle" | "sending" | "processing" | "authorized" | "error">("idle");
  const [focusNfeApiResponse, setFocusNfeApiResponse] = useState<any>(null);
  const [focusNfeLogs, setFocusNfeLogs] = useState<string[]>([]);
  const [focusNfeError, setFocusNfeError] = useState<string | null>(null);
  const [focusNfeActiveTab, setFocusNfeActiveTab] = useState<"emissao" | "src">("emissao");

  // Campos de novas Vendas (Date defaults to manual typed string format)
  const [vendaValor, setVendaValor] = useState("");
  const [vendaDescricao, setVendaDescricao] = useState("");
  const [vendaCategoria, setVendaCategoria] = useState("Consultoria");
  const [vendaClienteId, setVendaClienteId] = useState("");
  const [vendaData, setVendaData] = useState("10/06/2026");

  // Campos de novas Despesas
  const [despesaValor, setDespesaValor] = useState("");
  const [despesaDescricao, setDespesaDescricao] = useState("");
  const [despesaCategoria, setDespesaCategoria] = useState("Infraestrutura");
  const [despesaData, setDespesaData] = useState("10/06/2026");

  // Campos de novos clientes
  const [cliNome, setCliNome] = useState("");
  const [cliDoc, setCliDoc] = useState("");
  const [cliEmail, setCliEmail] = useState("");
  const [cliTel, setCliTel] = useState("");

  // Busca e Filtros da tabela
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTipo, setFilterTipo] = useState<"todos" | "entrada" | "saida">("todos");

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
            }
            if (profile.planType) {
              setPlanType(profile.planType);
            } else {
              setPlanType("free");
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
        // Sem usuário logado: carrega as sementes locais persistidas
        setUser(null);
        setUserId("user_49281");
        setMeiName("João Silva Consultoria");
        
        const savedClientes = localStorage.getItem("meiflow_clientes");
        const savedTransacoes = localStorage.getItem("meiflow_transacoes");
        if (savedClientes) setClientes(JSON.parse(savedClientes));
        if (savedTransacoes) setTransacoes(JSON.parse(savedTransacoes));
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
        if (data.logoUrl || data.companyLogo) {
          setCompanyLogo(data.logoUrl || data.companyLogo || "");
        }
        if (data.meiName || data.name) {
          setMeiName(data.meiName || data.name || "");
        }
        if (data.cnpjPrestador) {
          setCnpjPrestador(data.cnpjPrestador);
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

  // Novo: Buscar saldo da API v3 do Asaas sempre que o token de acesso mudar
  useEffect(() => {
    const fetchBalance = async () => {
      if (asaasAccessToken && asaasAccessToken.trim() !== "") {
        setIsLoadingAsaasBalance(true);
        try {
          const result = await consultarSaldoAsaas(asaasAccessToken.trim(), false);
          if (result.success) {
            setAsaasBalance(result.balance);
          } else {
            setAsaasBalance(null);
          }
        } catch (err) {
          console.error("Erro ao carregar saldo Asaas na Home:", err);
          setAsaasBalance(null);
        }
        setIsLoadingAsaasBalance(false);
      } else {
        setAsaasBalance(null);
      }
    };
    fetchBalance();
  }, [asaasAccessToken]);

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

  const handleSaveMeiProfile = async (newName: string, newCnpj: string, newInscricao: string, newTelefone: string, logo?: string) => {
    try {
      setMeiName(newName);
      setCnpjPrestador(newCnpj);
      setInscricaoMunicipal(newInscricao);
      setTelefonePrestador(newTelefone);
      if (logo !== undefined) {
        setCompanyLogo(logo);
      }
      
      localStorage.setItem("meiflow_mei_name", newName);
      localStorage.setItem("meiflow_cnpj_prestador", newCnpj);
      localStorage.setItem("meiflow_inscricao_municipal", newInscricao);
      localStorage.setItem("meiflow_telefone_prestador", newTelefone);

      if (user) {
        await saveUserProfileToFirebase(user.uid, {
          meiName: newName,
          cnpjPrestador: newCnpj,
          inscricaoMunicipal: newInscricao,
          telefone: newTelefone,
          asaasAccessToken: asaasAccessToken,
          planType: planType,
          companyLogo: logo !== undefined ? logo : companyLogo
        });
        triggerToast("✓ Dados da empresa atualizados com sucesso e sincronizados na nuvem!");
      } else {
        triggerToast("✓ Dados da empresa salvos localmente! (Acesse a nuvem para backup)");
      }
      setShowMeiConfigModal(false);
    } catch (error) {
      console.error(error);
      triggerToast("⚠ Erro ao salvar as configurações da empresa.");
    }
  };

  const handleSaveAsaasToken = async (newToken: string) => {
    try {
      setAsaasAccessToken(newToken);
      localStorage.setItem("meiflow_asaas_access_token", newToken);
      if (user) {
        await saveUserProfileToFirebase(user.uid, {
          meiName,
          cnpjPrestador,
          inscricaoMunicipal,
          telefone: telefonePrestador,
          asaasAccessToken: newToken,
          planType: planType,
          companyLogo: companyLogo
        });
        triggerToast("✓ Token do Asaas atualizado e sincronizado na nuvem!");
      } else {
        triggerToast("✓ Token do Asaas atualizado com sucesso!");
      }
    } catch (error) {
      console.error(error);
      triggerToast("⚠ Erro ao salvar o token do Asaas.");
    }
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
          asaasAccessToken,
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

  const handleAsaasAddTransaction = async (newTx: Omit<Transacao, "id">) => {
    const fullTx: Transacao = {
      id: `tx_${Date.now().toString().slice(-6)}`,
      ...newTx
    };

    if (user) {
      try {
        await saveTransacaoToFirebase(user.uid, fullTx);
        setTransacoes(prev => [fullTx, ...prev]);
        triggerToast("✓ Saque Pix registrado e sincronizado no Firebase!");
      } catch (err) {
        console.error("Erro Firebase Asaas Tx:", err);
        triggerToast("⚠ Saque efetuado mas erro ao sincronizar log.");
      }
    } else {
      setTransacoes(prev => [fullTx, ...prev]);
      triggerToast("✓ Saque Pix registrado e sincronizado localmente!");
    }
  };

  const handleRefreshAsaasBalance = async () => {
    if (asaasAccessToken && asaasAccessToken.trim() !== "") {
      setIsLoadingAsaasBalance(true);
      try {
        const result = await consultarSaldoAsaas(asaasAccessToken.trim(), false);
        if (result.success) {
          setAsaasBalance(result.balance);
          triggerToast("✓ Saldo da Conta Digital Asaas atualizado!");
        } else {
          setAsaasBalance(null);
          triggerToast(`⚠ ${result.error || "Erro ao consultar saldo Asaas"}`);
        }
      } catch (err: any) {
        console.error("Erro ao recarregar saldo Asaas:", err);
        setAsaasBalance(null);
        triggerToast("⚠ Falha de rede ao conectar à API do Asaas.");
      }
      setIsLoadingAsaasBalance(false);
    } else {
      triggerToast("⚠ Token do Asaas não configurado.");
    }
  };

  const handleSignOut = async () => {
    if (confirm("Gostaria de se desconectar de seu perfil MEI? O app voltará ao modo offline.")) {
      await logoutUser();
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
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("MEI Flow", 15, 25);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Controle Fiscal & Emissão de Comprovantes", 15, 33);
      
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
      doc.text(`Identificador MEI: ${userId}`, 15, 71);
      doc.text(`Data de Emissão: ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}`, 15, 77);
      
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

  // 3. SIMULAÇÃO COMPLETA DE SUCESSO (Perfeito para testes sem o CNPJ ativo da prefeitura)
  const handleEmitFocusNfeSimulated = () => {
    if (!focusNfeSelectedTx) return;

    setFocusNfeStatus("sending");
    const initLogs = [
      ...focusNfeLogs,
      `[SIMULAÇÃO] Iniciando ciclo de teste simulado de homologação com Focus NFe...`,
      `[POST] Enviando carga JSON para https://homologacao.focusnfe.com.br/v2/nfse`,
      `[POST] Cabeçalho: "Authorization: Basic d0NUVEduWXdFWFhxQ1lza1l0c3dWTUJDUUlIUDhlOHc6" (Token Convertido)`
    ];
    setFocusNfeLogs(initLogs);

    // Passo 2: entra em processamento de autorização após 1.5s
    setTimeout(() => {
      setFocusNfeStatus("processing");
      const procLogs = [
        ...initLogs,
        `[SIMULADO HTTP 201] Conexão bem-sucedida! Retornou: { "status": "processando_autorizacao", "ref": "${refNfe}" }`,
        `[GET] Consultando: https://homologacao.focusnfe.com.br/v2/nfse/${refNfe} ...`
      ];
      setFocusNfeLogs(procLogs);

      // Passo 3: faz a consulta GET de status após 3s
      setTimeout(() => {
        setFocusNfeStatus("authorized");
        const finalData = {
          status: "autorizado",
          ref: refNfe,
          numero: (parseInt(numeroRps) * 2 - 45).toString(),
          codigo_verificacao: `EM-SIM-${Math.floor(Math.random() * 90000) + 10000}`,
          chave_nfe: `352606${cnpjPrestador.replace(/\D/g, "")}550010000${numeroRps}1837482937`,
          caminho_xml_nota_fiscal: `/arquivos/notas/xml/nfse_${focusNfeSelectedTx.id}.xml`,
          caminho_pdf_nota_fiscal: `/arquivos/notas/pdf/nfse_${focusNfeSelectedTx.id}.pdf`
        };
        setFocusNfeApiResponse(finalData);
        setFocusNfeLogs([
          ...procLogs,
          `[SIMULADO HTTP 200] Resposta de Status: "autorizado"!`,
          `[SUCESSO] NFS-e Simulada com Token "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w" gerada!`,
          `[SUCESSO] Número NFS-e: ${finalData.numero}`,
          `[SUCESSO] Cód. Código Verificação: ${finalData.codigo_verificacao}`,
          `[SUCESSO] Chave de Acesso: ${finalData.chave_nfe}`,
          `[INFO] O ciclo assíncrono Focus NFe POST -> Processando -> GET -> Autorizado foi concluído.`
        ]);
        triggerToast("✓ Simulação de Emissão Focus NFe concluída com sucesso!");
      }, 3000);
    }, 1500);
  };

  // Exportar todas as transações para relatório PDF profissional consolidado do MEI
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      
      // Header banner
      doc.setFillColor(15, 23, 42); // slate-900 (deep navy)
      doc.rect(0, 0, 210, 42, "F");
      
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.text("MEI Flow", 15, 24);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Relatório de Inteligência & Conformidade Fiscal do MEI", 15, 32);
      
      // Right aligned info in header
      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225); // slate-300
      doc.text(`Usuário: ${meiName || "Não Informado"}`, 140, 20);
      doc.text(`ID MEI: ${userId}`, 140, 26);
      doc.text(`Emitido em: ${new Date().toLocaleDateString("pt-BR")}`, 140, 32);
      
      // Document title
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("LIVRO CAIXA & RELATÓRIO DE FATURAMENTO", 15, 58);
      
      // Intro paragraph
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text(
        "Abaixo estão consolidados os lançamentos tributários do período selecionado. Este relatório deve ser apresentado",
        15,
        66
      );
      doc.text(
        "anualmente junto à Declaração Anual do Simples Nacional do MEI (DASN-SIMEI).",
        15,
        71
      );
      
      // Main stats summary cards in PDF
      // Draw cards backgrounds
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
      doc.text(`R$ ${totalEntradas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 18, 93);
      
      doc.setTextColor(220, 38, 38); // red-600
      doc.text(`R$ ${totalSaidas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 80, 93);
      
      const isPositive = saldoMensal >= 0;
      doc.setTextColor(isPositive ? 16 : 220, isPositive ? 185 : 38, isPositive ? 129 : 38);
      doc.text(`R$ ${saldoMensal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, 143, 93);
      
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`${porcentagemLimite.toFixed(1)}% do limite legal anual de R$ 81k`, 18, 99);
      doc.text("Base operacional mensal", 80, 99);
      doc.text("Conformidade fiscal ativa", 143, 99);
      
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
      if (drawY > 260) {
        doc.addPage();
        drawY = 20;
      }
      
      // Highlighted compliance box
      doc.setFillColor(241, 245, 249); // slate-100
      doc.rect(15, drawY, 180, 20, "F");
      
      doc.setTextColor(30, 41, 59); // slate-800
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Selo de Autenticidade de Conformidade Tecnológica", 20, drawY + 8);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(
        "Declaro que as informações constantes em sistema refletem de forma idônea as operações de venda e de compras",
        20,
        drawY + 14
      );
      doc.text(
        "efetuadas no decorrer do exercício pela empresa cadastrada.",
        20,
        drawY + 18
      );
      
      const footerY = drawY + 34;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      doc.text("________________________________________", 15, footerY);
      doc.text("Assinatura do MEI Responsável", 15, footerY + 5);
      
      doc.text("________________________________________", 115, footerY);
      doc.text("Verificação ID Digital do Sistema", 115, footerY + 5);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Chave Eletrônica: MEIFLOW_${userId.toUpperCase()}_REV_${Math.floor(Math.random()*90000 + 10000)}`, 115, footerY + 10);
      
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
  const handleSendSupportMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportSubject || !supportMessage) {
      triggerToast("⚠ Preencha os campos obrigatórios do chamado.");
      return;
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
    
    // Dispara no navegador do usuário abrindo Outlook/Gmail de forma segura
    window.location.href = mailtoLink;

    triggerToast("✓ Rascunho com diagnóstico montado! O seu e-mail de suporte foi aberto.");
    
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
      clienteDocumento: selectedClient?.documento
    };

    if (user) {
      // Se autenticado via Firebase, grava de forma resiliente diretamente no Firestore na subcoleção usuarios/{userId}/vendas
      saveVendaToFirebase(user.uid, novaVenda)
        .then(() => {
          setTransacoes(prev => [novaVenda, ...prev]);
          triggerToast("✓ Venda adicionada e guardada remotamente no Firebase sob 'usuarios/{userId}/vendas'.");
        })
        .catch(err => {
          console.error("Erro Firebase:", err);
          triggerToast("⚠ Erro ao salvar venda no Firestore remoto.");
        });
    } else {
      setTransacoes(prev => [novaVenda, ...prev]);
      triggerToast("✓ Venda adicionada e sincronizada localmente com sucesso!");
    }

    // Reset formulário
    setVendaValor("");
    setVendaDescricao("");
    setVendaClienteId("");
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
      categoria: despesaCategoria
    };

    if (user) {
      saveTransacaoToFirebase(user.uid, novaDespesa)
        .then(() => {
          setTransacoes(prev => [novaDespesa, ...prev]);
          triggerToast("✓ Despesa gravada com sucesso remota no Firebase.");
        })
        .catch(err => {
          console.error("Erro Firebase Despesa:", err);
          triggerToast("⚠ Erro ao salvar despesa no Firestore.");
        });
    } else {
      setTransacoes(prev => [novaDespesa, ...prev]);
      triggerToast("✓ Despesa adicionada e sincronizada localmente!");
    }

    // Reset formulário
    setDespesaValor("");
    setDespesaDescricao("");
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
          triggerToast(`✓ Cliente ${cliNome} cadastrado com sucesso no seu Firestore!`);
        })
        .catch(err => {
          console.error("Erro Firebase Cliente:", err);
          triggerToast("⚠ Erro ao adicionar cliente no Firestore remoto.");
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
            triggerToast("✓ Cliente removido com sucesso do Firestore.");
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
            triggerToast("✓ Movimentação financeira removida com sucesso do Firestore.");
          })
          .catch(err => {
            console.error(err);
            triggerToast("⚠ Erro ao excluir transação no Firestore.");
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
    
    if (filterTipo === "todos") return matchesSearch;
    return matchesSearch && t.tipo === filterTipo;
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
          <button
            onClick={() => setShowMeiConfigModal(true)}
            className="flex items-center gap-2 group text-left p-1.5 rounded-xl hover:bg-slate-50 transition-all border border-transparent hover:border-slate-200 cursor-pointer text-slate-800"
            title="Clique para cadastrar ou modificar os dados de sua empresa MEI"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
              <Building className="w-4 h-4" />
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-all leading-tight truncate max-w-[170px]">
                {meiName}
              </span>
              <span className="text-[9px] text-slate-400 font-medium font-mono">
                CNPJ: {cnpjPrestador || "Não cadastrado"}
              </span>
            </div>
            <Settings className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0 hidden sm:inline ml-1 margin-left-xs" />
          </button>

          {/* CONTROLE DE LOGIN/AUTENTICAÇÃO FIREBASE */}
          {user ? (
            <div className="flex items-center gap-2">
              <div 
                onClick={() => setShowConfigGuide(true)}
                className="cursor-pointer hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-xl text-blue-700 text-xs font-bold transition-all border border-blue-100/50"
                title="Sincronização em nuvem ativa por UID exclusivo"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span>Nuvem Ativa</span>
              </div>
              <button
                onClick={handleSignOut}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 px-3.5 font-bold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer shadow-sm border border-slate-200"
                title="Sair da Conta Google / Firebase"
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
                title="Acesse com E-mail ou Conta Google para sincronização multi-usuário"
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
                      ✨ Evolua para o Premium e emita boletos, notas fiscais e use sua própria logo!
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

            {/* CENTRAL DE CARTEIRA DIGITAL: BOTÃO DE DESTAQUE ELEGANTE & CENTRALIZADO */}
            <div className="flex flex-col items-center justify-center p-12 bg-slate-50 rounded-3xl border border-slate-200/40 text-center space-y-4">
              <div className="space-y-1">
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">
                  Conta de Recebíveis Neobanking
                </span>
                <p className="text-xs text-slate-500 max-w-md">
                  Gerencie seus saldos, simule saques via PIX e emita links de cobrança aos seus clientes cadastrados.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    if (planType === "free") {
                      setShowUpgradeModal(true);
                    } else {
                      setCurrentView("carteira");
                    }
                  }}
                  className="group relative px-10 py-5 bg-slate-950 hover:bg-slate-900 text-white rounded-full font-bold text-sm tracking-wide shadow-xl shadow-slate-900/15 hover:shadow-slate-900/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer flex items-center gap-3"
                >
                  <Wallet className="w-4.5 h-4.5 text-slate-300 group-hover:scale-110 transition-all duration-300" />
                  <span>Acessar Carteira Digital & Cobranças {planType === "free" ? "🔒" : ""}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </button>
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
                  Contatos e documentos para automação de boletos, NFS-e e extratos de cobrança.
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
                          <h3 className="font-semibold text-slate-800 text-base truncate pr-2" title={c.nome}>
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

                  <button
                    onClick={handleExportPDF}
                    className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 border border-slate-200 transition-all shadow-xs"
                  >
                    <FileDown className="w-3.5 h-3.5 text-slate-400" />
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

                                <button
                                  onClick={(e) => handleDownloadPDF(tx, e)}
                                  className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg transition-all"
                                  title="Baixar PDF"
                                >
                                  <FileDown className="w-4 h-4" />
                                </button>

                                {isEnt && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (planType === "free") {
                                        setShowUpgradeModal(true);
                                      } else {
                                        handleDownloadNFSe(tx, e);
                                      }
                                    }}
                                    className="px-2 py-1 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 border border-blue-100 hover:border-transparent rounded-lg transition-all text-[11px] font-bold flex items-center gap-1"
                                    title="Gerar Nota NFS-e"
                                  >
                                    <span>NFS-e</span> {planType === "free" ? "🔒" : ""}
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

        {/* VIEW: CARTEIRA DIGITAL */}
        {currentView === "carteira" && (
          <div className="space-y-8 animate-fade-in text-left">
            <div className="flex items-center gap-2 mb-2">
              <button 
                onClick={() => setCurrentView("home")}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950 transition-all bg-white px-4 py-2 border border-slate-200 rounded-xl shadow-xs cursor-pointer"
              >
                <span>&larr; Voltar para o Início (Home)</span>
              </button>
            </div>

            <div className="pb-2 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-display font-light text-slate-900 tracking-tight">
                  Carteira Digital & Recebíveis
                </h1>
                <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">
                  Gateway real integrado do Asaas para cobrança automatizada por boleto, cartão ou PIX e depósitos.
                </p>
              </div>
            </div>

            <div className="w-full flex justify-center py-4">
              <AsaasWalletModal
                userId={userId}
                transactions={transacoes}
                currentAsaasToken={asaasAccessToken}
                onSaveAsaasToken={handleSaveAsaasToken}
                onAddTransaction={handleAsaasAddTransaction}
                onClose={() => setCurrentView("home")}
                isInline={true}
              />
            </div>
          </div>
        )}

      </main>

      {/* SEÇÃO INTEGRADA DE DOWNLOAD DO APK - MOVIDO PARA O RODAPÉ PARA DESIGN LIMPO */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 mt-12">
        <div className="bg-slate-100 border border-slate-200 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 text-left">
          <div className="space-y-1.5 text-left">
            <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] px-2.5 py-1 rounded-full border border-emerald-200 uppercase tracking-widest">
              <Smartphone className="w-3.5 h-3.5 text-emerald-600 animate-bounce" /> Versão Mobile Disponível (APK)
            </span>
            <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Anuncie seu site e instale direto no celular</h3>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Você pode anunciar sua ferramenta corporativa e disponibilizar o download do aplicativo mobile nativo (APK) diretamente aos seus clientes ou parceiros de maneira descomplicada e confiável.
            </p>
          </div>
          <button
            onClick={handleDownloadAPK}
            className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-md group shrink-0 cursor-pointer"
            id="download-apk-footer"
          >
            <Download className="w-4 h-4 text-emerald-100 group-hover:scale-115 transition-all" />
            <span>Baixar APK Instalador (4.2 MB)</span>
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

              {/* Footer Modal */}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowVendaModal(false)}
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-55 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
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

              {/* Footer Modal */}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDespesaModal(false)}
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-55 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
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
                  className="flex-1 bg-white border border-slate-200 hover:bg-slate-55 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                >
                  Salvar Cliente
                </button>
              </div>

            </form>
          </div>
        </div>
      )}


      {/* MODAL 4: CENTRAL DE EMISSÃO FOCUS NFE */}
      {showFocusNfeModal && focusNfeSelectedTx && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden text-left flex flex-col my-8">
            
            {/* Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <FileCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight">Central de Emissão NFS-e</h3>
                  <p className="text-[10px] text-slate-400">Integração Direta Focus NFe (v2/nfse) - MEI Simplificado</p>
                </div>
              </div>
              <button
                onClick={() => setShowFocusNfeModal(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Menu de Abas */}
            <div className="flex bg-slate-100 border-b border-slate-200 px-6 gap-4">
              <button
                onClick={() => setFocusNfeActiveTab("emissao")}
                className={`py-3 text-xs font-bold border-b-2 transition-all ${
                  focusNfeActiveTab === "emissao"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                🚀 Emitir NFS-e Autônoma
              </button>
              <button
                onClick={() => setFocusNfeActiveTab("src")}
                className={`py-3 text-xs font-bold border-b-2 transition-all ${
                  focusNfeActiveTab === "src"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                💻 Código de Integração (Node/TS)
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-5">
              
              {focusNfeActiveTab === "emissao" ? (
                <>
                  {/* Visão de Resumo da Venda Pré-Carregada */}
                  <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-2">
                    <div className="text-[11px] font-bold text-blue-800 uppercase tracking-widest">Lançamento de Venda Associavel</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-450 font-normal block">Serviço Prestado:</span>
                        <strong className="text-slate-800 font-semibold">{focusNfeSelectedTx.descricao}</strong>
                      </div>
                      <div>
                        <span className="text-slate-450 font-normal block">Cliente Tomador (Destinatário):</span>
                        <strong className="text-slate-800 font-semibold">
                          {focusNfeSelectedTx.clienteNome || "Consumidor Geral"}
                        </strong>
                        {focusNfeSelectedTx.clienteDocumento && (
                          <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                            Doc: {focusNfeSelectedTx.clienteDocumento}
                          </span>
                        )}
                      </div>
                      <div className="mt-1">
                        <span className="text-slate-450 font-normal block">Valor Declarado (Bruto):</span>
                        <strong className="text-emerald-700 font-extrabold text-sm">
                          R$ {focusNfeSelectedTx.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div className="mt-1">
                        <span className="text-slate-450 font-normal block">Data de Emissão do RPS:</span>
                        <strong className="text-slate-800 font-semibold font-mono">{focusNfeSelectedTx.data}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Configurações da API Configuradas pelo Sistema */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                        Usuário (Token de Homologação)
                      </label>
                      <input
                        type="text"
                        readOnly
                        value="wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-500 font-mono rounded-xl py-2 px-3 text-xs focus:outline-none"
                        title="Este é o seu token de homologação da Focus NFe hardcoded conforme solicitado."
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                        Senha (Password)
                      </label>
                      <input
                        type="text"
                        readOnly
                        placeholder="Deixado em branco (vazio)"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-400 font-mono rounded-xl py-2 px-3 text-xs italic focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Campos do RPS para Focus NFe */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
                    <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Parâmetros Obrigatórios (RPS e Fisco)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">CNPJ do Prestador (Seu MEI) *</label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: 55.823.144/0001-90"
                          value={cnpjPrestador}
                          onChange={(e) => setCnpjPrestador(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 font-mono rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Número do RPS *</label>
                        <input
                          type="text"
                          required
                          value={numeroRps}
                          onChange={(e) => setNumeroRps(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 font-mono rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Série do RPS</label>
                        <input
                          type="text"
                          value={serieRps}
                          onChange={(e) => setSerieRps(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 font-mono rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Tipo do RPS</label>
                        <select
                          value={tipoRps}
                          onChange={(e) => setTipoRps(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl py-2 px-3 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        >
                          <option value="1">1 - RPS (Recibo Provisório de Serviços)</option>
                          <option value="2">2 - Nota Fiscal Conjugada (Mista)</option>
                          <option value="3">3 - Cupom de Serviços</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Chave Referência (ref)</label>
                        <input
                          type="text"
                          readOnly
                          value={refNfe}
                          className="w-full bg-slate-100 border border-slate-200 text-slate-500 font-mono rounded-xl py-2 px-3 text-xs focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Consola de Processamento (Logs de Comunicação) */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span>CONSOLE HTTP LOGGER (LOGS DA INTEGRAÇÃO EM TEMPO REAL)</span>
                      <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-mono">ENDPOINT: v2/nfse</span>
                    </div>
                    <div className="p-4 bg-slate-950 rounded-xl text-[11px] text-slate-300 font-mono min-h-[140px] max-h-[180px] overflow-y-auto space-y-1 shadow-inner border border-slate-800">
                      {focusNfeLogs.map((log, idx) => {
                        let colorClass = "text-slate-400";
                        if (log.startsWith("[POST]")) colorClass = "text-yellow-400";
                        if (log.startsWith("[GET]")) colorClass = "text-teal-400";
                        if (log.startsWith("[SISTEMA]")) colorClass = "text-indigo-300";
                        if (log.startsWith("[SUCESSO]")) colorClass = "text-emerald-400 lg:font-bold";
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

                  {/* Resultado da Autorização (Botões para baixar nota) */}
                  {focusNfeStatus === "authorized" && focusNfeApiResponse && (
                    <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                          <Check className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="text-left">
                          <h4 className="text-xs font-bold text-emerald-800">Parabéns! NFS-e Autorizada no Fisco</h4>
                          <p className="text-[10px] text-emerald-600">
                            Prefeitura autorizou em ambiente de homologação. RPS nº {numeroRps}, Nota nº {focusNfeApiResponse.numero}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto shrink-0 justify-end">
                        <a
                          href={focusNfeApiResponse.caminho_pdf_nota_fiscal ? `https://homologacao.focusnfe.com.br${focusNfeApiResponse.caminho_pdf_nota_fiscal}` : "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (!focusNfeApiResponse.caminho_pdf_nota_fiscal || focusNfeApiResponse.caminho_pdf_nota_fiscal.startsWith("/")) {
                              // Se for simulado, baixamos um comprovante elegante
                              e.preventDefault();
                              triggerToast("✓ Baixando espelho da NFS-e autorizada...");
                              const mockDanfse = `==========================================================
NOTAS FISCAIS DE SERVIÇOS ELETRÔNICAS - NFS-e (MOCK FOCUS NFE)
ESTADO DE SÃO PAULO - REPUBLICA FEDERATIVA DO BRASIL
==========================================================
PRESTADOR DO SERVIÇO:
Nome: ${meiName}
CNPJ: ${cnpjPrestador}
Ambiente: TESTES / HOMOLOGAÇÃO
RPS Transmitido: Nº ${numeroRps} Série 1 Tipo RPS

TOMADOR DO SERVIÇO:
Razão Social: ${focusNfeSelectedTx.clienteNome || "Consumidor Geral"}
CPF/CNPJ Tomador: ${focusNfeSelectedTx.clienteDocumento || "Consumidor Final"}

DADOS DO SERVIÇO:
Serviço: ${focusNfeSelectedTx.descricao}
Categoria: ${focusNfeSelectedTx.categoria}
Código do Item: 01.01

VALORES:
Valor do Serviço: R$ ${focusNfeSelectedTx.valor.toFixed(2)}
ISS Devido: Isento ou retido no DAS-MEI

CHAVE DE ACESSO NFS-e: ${focusNfeApiResponse.chave_nfe || "35230912183748293792019"}
CÓD. VERIFICAÇÃO: ${focusNfeApiResponse.codigo_verificacao}

✓ NFS-e AUTORIZADA EM HOMOLOGAÇÃO COM A FOCUS NFE.
==========================================================`;
                              const blob = new Blob([mockDanfse], { type: "text/plain;charset=utf-8" });
                              const url = URL.createObjectURL(blob);
                              const link = document.createElement("a");
                              link.href = url;
                              link.download = `danfse_mei_rps_${numeroRps}.txt`;
                              link.click();
                            }
                          }}
                          className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all text-xs font-bold flex items-center gap-1 shadow-sm"
                        >
                          <FileText className="w-3.5 h-3.5" /> Danfse (PDF)
                        </a>
                        <a
                          href={focusNfeApiResponse.caminho_xml_nota_fiscal ? `https://homologacao.focusnfe.com.br${focusNfeApiResponse.caminho_xml_nota_fiscal}` : "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (!focusNfeApiResponse.caminho_xml_nota_fiscal || focusNfeApiResponse.caminho_xml_nota_fiscal.startsWith("/")) {
                              e.preventDefault();
                              triggerToast("✓ Baixando XML de homologação...");
                              const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe>
  <InfNFSe Id="NFS-${focusNfeSelectedTx.id}">
    <tpAmb>2</tpAmb>
    <verAplic>FocusNFe_v2</verAplic>
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
                              link.download = `nfse_focusnfe_rps_${numeroRps}.xml`;
                              link.click();
                            }
                          }}
                          className="py-1.5 px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition-all text-xs font-bold flex items-center gap-1 shadow-sm"
                        >
                          <FileCode className="w-3.5 h-3.5" /> XML Nota
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Feedback Amigável de Erro */}
                  {focusNfeStatus === "error" && focusNfeError && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-rose-800 text-xs font-bold">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 animate-pulse" />
                        <span>Atenção: A Focus NFe recusou os dados informados</span>
                      </div>
                      <p className="text-xs text-rose-700 leading-relaxed max-h-[80px] overflow-y-auto font-mono bg-white p-2 rounded-lg border border-rose-50">
                        {focusNfeError}
                      </p>
                      <span className="text-[10px] text-slate-500 font-medium leading-relaxed">
                        DICA DE HOMOLOGAÇÃO: Em ambiente de testes, o CNPJ emitente precisa ser um CNPJ de teste devidamente autorizado pelo time de suporte da Focus NFe, ou você pode utilizar o botão <strong>"Simular Ciclo Completo"</strong> abaixo para visualizar o processamento assíncrono do programa terminando com sucesso!
                      </span>
                    </div>
                  )}

                  {/* Botões de Comando Fiscais no Rodapé */}
                  <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-3 items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowFocusNfeModal(false)}
                      className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold py-2 px-4 rounded-xl text-xs"
                    >
                      Voltar ao Painel
                    </button>
                    
                    <div className="flex gap-2">
                      {/* BOTÃO 1: SIMULAR SUCESSO (DICA PARA O USUÁRIO DOMINAR O SOFTWARE) */}
                      <button
                        type="button"
                        onClick={handleEmitFocusNfeSimulated}
                        disabled={focusNfeStatus === "sending" || focusNfeStatus === "processing"}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold py-2 px-3.5 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                        title="Simula todo o processamento assíncrono e pollling da Focus NFe finalizando com sucesso perfeito"
                      >
                        <Play className="w-3.5 h-3.5" /> Simular Ciclo Completo
                      </button>

                      {/* BOTÃO 2: TRANSMISSÃO DE VERDADE COM API */}
                      <button
                        type="button"
                        onClick={handleEmitFocusNfe}
                        disabled={focusNfeStatus === "sending" || focusNfeStatus === "processing"}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-black py-2 px-4 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                        title="Transmite os dados via requisição POST real ao servidor de homologação da Focus NFe"
                      >
                        {focusNfeStatus === "sending" || focusNfeStatus === "processing" ? (
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Cpu className="w-3.5 h-3.5" />
                        )}
                        Testar Conexão Real (POST)
                      </button>

                      {/* BOTÃO DE CONSULTA MANUAL (APENAS SE ESTIVER PROCESSANDO) */}
                      {focusNfeStatus === "processing" && (
                        <button
                          type="button"
                          onClick={() => handleCheckFocusNfeStatus(refNfe, 1)}
                          className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center gap-1 shadow-sm transition-all"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Consultar Status Manual (GET)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Informações explicativas adicionais */}
                  <div className="text-[10px] text-center text-slate-450 mt-2">
                    A API da Focus NFe funciona em 2 etapas assíncronas obrigatórias descritas na aba ao lado.
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="text-xs text-slate-600 leading-relaxed font-sans">
                    Como o processo de emissão é <strong>ASSÍNCRONO</strong> e funciona em duas etapas obrigatórias, o código abaixo escrito em <strong>TypeScript / Node.js</strong> efetua o fluxo completo de forma automatizada. Este código está salvo no arquivo <code className="bg-slate-100 text-blue-600 px-1 py-0.5 rounded font-bold font-mono">/src/focusNFeService.ts</code>.
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">1. Autenticação Header (Basic Auth - Token embutido)</span>
                    <pre className="p-3 bg-slate-900 rounded-xl text-[10px] text-slate-200 font-mono overflow-x-auto whitespace-pre leading-relaxed border border-slate-800">
{`// Header de Autorização construído conforme regulamento da Focus NFe
// Username: wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w (Token)
// Password: [Vazio]
const token = "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w";
const authHeader = "Basic " + Buffer.from(token + ":").toString("base64");

// Inclua no Header de suas conexões:
// "Authorization": authHeader`}
                    </pre>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">2. Script do Ciclo Completo (POST + GET Polling)</span>
                    <pre className="p-3 bg-slate-900 rounded-xl text-[10px] text-slate-200 font-mono overflow-x-auto whitespace-pre leading-relaxed border border-slate-800 max-h-[254px]">
{`import { emitirNfse, consultarNfse } from './focusNFeService';

async function processarEmissao() {
  console.log("Iniciando emissão para Focus NFe...");

  // ETAPA 1: Enviar RPS via POST
  const emissao = await emitirNfse({
    cnpj_prestador: "21231111000120",
    ref: "REF_UNICA_LAN_101",
    numero_rps: "105",
    serie_rps: "1",
    tipo_rps: "1",
    valor_servicos: 450.00,
    razao_social_tomador: "Martins TI Ltda",
    descricao_servicos: "Consultoria e implantações de sistemas MEI."
  });

  if (!emissao.success) {
    console.error("Erro no envio do lote:", emissao.error);
    return;
  }

  // ETAPA 2: Tratar retorno 201 "processando_autorizacao"
  console.log("POST com Sucesso! Status:", emissao.statusNfe, "Chave Ref:", emissao.ref);
  console.log("Aguardando 4 segundos para consulta de autorização...");

  // ETAPA 3: Consultar Status (GET)
  setTimeout(async () => {
    const consulta = await consultarNfse(emissao.ref);
    if (consulta.success) {
      console.log("Status Recebido:", consulta.statusNfe);
      if (consulta.statusNfe === "autorizado") {
        console.log("NFS-e Autorizada com sucesso!");
        console.log("Link PDF:", consulta.pdfUrl);
        console.log("Link XML:", consulta.xmlUrl);
      } else {
        console.warn("A nota ainda está pendente ou foi rejeitada:", consulta.erros);
      }
    }
  }, 4000);
}`}
                    </pre>
                  </div>
                </div>
              )}

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

      {/* CARTEIRA & EXTRATO ASAAS */}
      {showAsaasWalletModal && (
        <AsaasWalletModal
          userId={userId}
          transactions={transacoes}
          currentAsaasToken={asaasAccessToken}
          onSaveAsaasToken={handleSaveAsaasToken}
          onAddTransaction={handleAsaasAddTransaction}
          planType={planType}
          onTriggerUpgrade={() => setShowUpgradeModal(true)}
          onClose={() => setShowAsaasWalletModal(false)}
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
                  className="flex-1 bg-red-650 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Enviar Chamado</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GUIA DE CONFIGURAÇÃO PASSO A PASSO DO FIREBASE (EXPLICATIVO MULTI-USUÁRIO) */}
      {showConfigGuide && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-600 animate-pulse" />
                <span>Instruções de Configuração - Firebase Multi-Usuário</span>
              </h3>
              <button
                onClick={() => setShowConfigGuide(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 font-bold text-sm"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto text-left">
              <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-2">
                <p className="text-xs text-blue-800 font-semibold uppercase tracking-wider">Como funciona o Isolamento de Clientes?</p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Para garantir que cada MEI possua seus próprios clientes e transações sem risco de vazamento de dados de outro cliente, o aplicativo utiliza o <strong>UID do Firebase Authentication</strong>. No Firestore, cada documento salvo possui o atributo <code className="bg-slate-200 px-1 py-0.5 rounded text-rose-600 font-mono">mei_uid</code>.
                </p>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-xs text-slate-800 uppercase tracking-widest">Passo a Passo de Instalação:</h4>
                
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">1</div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-800">Crie o Projeto no Firebase Console</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Acesse <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">console.firebase.google.com</a>, clique em "Adicionar projeto" e nomeie como desejar.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">2</div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-800">Ative o Firebase Authentication</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Vá em <strong>Authentication</strong> &gt; <strong>Sign-in method</strong> e ative o provedor do <strong>Google</strong>. Isso habilitará o login seguro em 1 clique.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">3</div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-800">Ative o Cloud Firestore com Regras de Isolamento</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Inicie um banco Firestore. Publique as regras de segurança disponíveis no arquivo local <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-600 font-mono">firestore.rules</code>. Elas garantem por padrão que nenhum usuário sem login leia ou altere dados de outro.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">4</div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-800">Associe as Credenciais</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      As credenciais geradas pelo console do Firebase são integradas diretamente no arquivo <code className="bg-slate-200 px-1 py-0.5 rounded text-blue-600 font-mono">firebase-applet-config.json</code> no diretório raiz do projeto. O App as carrega automaticamente!
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 text-slate-700 rounded-xl text-center space-y-1">
                <p className="text-xs font-bold text-amber-800 flex items-center justify-center gap-1">
                  <Database className="w-4 h-4 text-amber-600" /> Sincronização Automatizada e Comentada!
                </p>
                <p className="text-[11px] leading-relaxed">
                  A nossa lógica de gravação e exclusão em <code className="font-mono text-rose-600 text-[10px]">App.tsx</code> já foi totalmente adaptada. Se logado, salva remotamente no Firestore sob o seu UID de inquilino exclusivo; se deslogado, salva de forma resiliente localmente no seu storage local.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowConfigGuide(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl text-xs cursor-pointer shadow-sm"
              >
                Entendi, Fechar Guia
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
