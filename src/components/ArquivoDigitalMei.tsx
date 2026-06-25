import React, { useState, useEffect, useRef } from "react";
import { 
  Folder, 
  FolderOpen, 
  FileText, 
  Upload, 
  Trash2, 
  Download, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Calendar, 
  Search, 
  ShieldCheck, 
  Info, 
  ChevronRight, 
  X, 
  Loader2,
  RefreshCw,
  Sparkles,
  Printer
} from "lucide-react";
import { db, auth } from "../firebase";
import { User } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { downloadRemoteFileCrossPlatform, isNativePlatform } from "../utils/nativeFile";

interface DocumentoMEI {
  id: string;
  nome: string;
  tamanho: number;
  tipo: string;
  uploadedAt: string;
  ano: number;
  mes: string;
  userId: string;
  downloadUrl: string;
  storagePath: string;
  isSimulated?: boolean;
  url?: string;
  criadoEm?: string;
}

interface UserProfile {
  meiName?: string;
  cnpjPrestador?: string;
}

interface ArquivoDigitalMeiProps {
  userId: string;
  userProfile?: UserProfile;
  planType?: "free" | "premium";
  onTriggerUpgrade?: () => void;
}

// Meses do ano em formato padrão
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export default function ArquivoDigitalMei({ userId, userProfile, planType = "free", onTriggerUpgrade }: ArquivoDigitalMeiProps) {
  const currentYear = new Date().getFullYear(); // 2026 no contexto atual
  
  // Limite legal de 5 anos fiscais (ex: 2026, 2025, 2024, 2023, 2022)
  const limiteAnosFiscais = 5;
  const anosValidos = Array.from({ length: limiteAnosFiscais }, (_, i) => currentYear - i);
  const anoMaisAntigoPermitido = currentYear - (limiteAnosFiscais - 1); // 2022

  // Estados de navegação e visualização
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Lista de arquivos recuperados do Firestore
  const [documentos, setDocumentos] = useState<DocumentoMEI[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Controle de Diálogo no Mobile (Drawer)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [showFreeLockModal, setShowFreeLockModal] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  // Monitoramento reativo do usuário com Firebase Auth para garantir alinhamento perfeito de ID e permissões no cliente
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);

  // Controla se o Firebase Auth já confirmou o estado de login (logado ou deslogado).
  // Enquanto isAuthLoading === true, NENHUMA query ao Firestore deve ser disparada,
  // pois o token de autenticação ainda não está garantidamente pronto.
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setIsAuthLoading(false); // Auth já respondeu (com ou sem usuário)
    });
    return () => unsubscribe();
  }, []);

  // Busca síncrona/realtime de documentos do usuário para o ano selecionado
  useEffect(() => {
    // Enquanto o Firebase Auth ainda não confirmou o estado de login, não faz nada.
    // Isso evita que o onSnapshot rode com o UID nulo/indefinido na inicialização,
    // o que disparava o erro "Missing or insufficient permissions".
    if (isAuthLoading) {
      return;
    }

    // Usa exclusivamente o UID vindo do Firebase Auth (currentUser).
    // Não há fallback para a prop "userId" sozinha: as regras do Firestore exigem
    // request.auth != null, então qualquer query só é válida com o usuário
    // efetivamente autenticado no Firebase Auth.
    const uid = currentUser?.uid || null;

    if (!uid) {
      console.log("[ArquivoDigitalMei] Usuário não autenticado no Firebase Auth. Query não será executada.");
      setDocumentos([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    // Consulta documentos do usuário logado e do ano selecionado na coleção raiz "documentos"
    const q = query(
      collection(db, "documentos"),
      where("userId", "==", uid),
      where("ano", "==", Number(selectedYear))
    );

    const unsubscribe = onSnapshot(
      q, 
      (snapshot) => {
        const docsList: DocumentoMEI[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          docsList.push({
            id: docSnap.id,
            nome: data.nome || "",
            tamanho: data.tamanho || 0,
            tipo: data.tipo || "",
            uploadedAt: data.uploadedAt || data.criadoEm || new Date().toISOString(),
            ano: Number(data.ano),
            mes: data.mes || "",
            userId: uid,
            downloadUrl: data.downloadUrl || data.url || "",
            storagePath: data.storagePath || "",
            isSimulated: data.isSimulated || false,
            url: data.url || data.downloadUrl || "",
            criadoEm: data.criadoEm || data.uploadedAt || new Date().toISOString()
          });
        });

        // Filtra de acordo com a regra de retenção de 5 anos no cliente para blindagem extra de segurança fiscal
        const docsFiltrados = docsList.filter(docItem => docItem.ano >= anoMaisAntigoPermitido);
        
        const expiradosCount = docsList.length - docsFiltrados.length;
        if (expiradosCount > 0) {
          console.warn(`${expiradosCount} arquivos expiraram o prazo legal de 5 anos fiscais e foram bloqueados pela regra contábil digital.`);
        }

        setDocumentos(docsFiltrados);
        setIsLoading(false);
      }, 
      (error) => {
        console.error("[ArquivoDigitalMei] Erro no Firestore:", error.message);
        
        // Tratamento de erro de permissão amigável e focado na usabilidade, sem quebrar o app
        if (error.message.toLowerCase().includes("permission") || error.code?.includes("permission-denied")) {
          setErrorMsg(
            "Sua privacidade e segurança fiscal vêm em primeiro lugar. Certifique-se de estar logado na sua conta MEI Flow para sincronizar suas pastas e visualizar arquivamentos criptografados."
          );
        } else {
          setErrorMsg("Erro ao sincronizar arquivos das pastas. Tente novamente em alguns instantes.");
        }
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isAuthLoading, currentUser, selectedYear, anoMaisAntigoPermitido]);

  // Imprime um documento com layout otimizado para fins tributários / contabilidade
  const handlePrintDocument = async (docItem: DocumentoMEI) => {
    // window.open()/window.print() não funcionam de forma confiável dentro do
    // WebView do Capacitor no Android. Como o documento já existe como
    // arquivo pronto (PDF ou imagem) no Storage, a forma mais simples e
    // robusta no APK é baixar o arquivo original direto para a pasta de
    // Downloads do celular, em vez de tentar abrir uma janela de impressão.
    if (isNativePlatform()) {
      setIsLoading(true);
      try {
        const extension = docItem.tipo?.includes("pdf") ? "pdf" : (docItem.tipo?.split("/")[1] || "jpg");
        const safeName = (docItem.nome || `comprovante_${docItem.id}`).replace(/[^\w.\-]+/g, "_");
        const fileName = safeName.includes(".") ? safeName : `${safeName}.${extension}`;
        await downloadRemoteFileCrossPlatform(docItem.downloadUrl, fileName, docItem.tipo || "application/octet-stream");
        setSuccessMsg(`"${docItem.nome}" baixado com sucesso para a pasta Downloads do seu celular.`);
      } catch (err: any) {
        console.error("Erro ao baixar documento no Android:", err);
        setErrorMsg("Não foi possível baixar o documento. Verifique sua conexão e tente novamente.");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Por favor, habilite a permissão de popups para imprimir seus comprovantes.");
      return;
    }
    
    const formattedDate = new Date(docItem.uploadedAt).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    
    const sizeStr = formatBytes(docItem.tamanho);
    const meiNameDisplay = userProfile?.meiName || "Microempreendedor Individual";
    const cnpjDisplay = userProfile?.cnpjPrestador || "Não Informado";
    
    printWindow.document.write(`
      <html>
        <head>
          <title>MEI Flow - Comprovante de Conformidade Fiscal</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #1e293b; background: #ffffff; }
            .header { text-align: center; border-bottom: 2px solid #cbd5e1; padding-bottom: 15px; margin-bottom: 25px; }
            .title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
            .subtitle { font-size: 11px; color: #64748b; font-weight: 605; text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; }
            .info-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 16px; margin-bottom: 25px; border: 1px solid #e2e8f0; padding: 18px; border-radius: 12px; background: #f8fafc; }
            .info-item { font-size: 13px; }
            .info-label { font-weight: 700; color: #334155; display: block; margin-bottom: 3px; }
            .info-value { color: #475569; }
            .document-container { text-align: center; margin-top: 25px; border: 1px dashed #cbd5e1; padding: 20px; border-radius: 12px; }
            .preview-img { max-width: 100%; max-height: 480px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05); }
            .footer { margin-top: 45px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; line-height: 1.5; }
            .no-print-bar { background: #f1f5f9; border-radius: 8px; border: 1px solid #e2e8f0; padding: 12px 18px; margin-bottom: 25px; display: flex; align-items: center; justify-between; }
            .no-print-bar p { font-size: 12px; color: #475569; margin: 0; }
            .btn-print { background: #2563eb; color: white; border: none; padding: 8px 16px; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 12px; }
            .btn-print:hover { background: #1d4ed8; }
            @media print {
              .no-print-bar { display: none; }
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="no-print-bar">
            <div>
              <p><strong>Modo de Impressão de Auditoria Fiscal</strong></p>
              <p style="font-size: 11px; margin-top: 2px;">Use este comprovante para fins de escrituração fiscal do MEI, Livro Caixa e justificativa do limite SIMEI.</p>
            </div>
            <button onclick="window.print()" class="btn-print">Imprimir Documento</button>
          </div>

          <div class="header">
            <h1 class="title">Arquivo Digital Digitalizado</h1>
            <p class="subtitle">Guarda Documental de Conformidade do Contribuinte MEI (Prazo Legal de 5 Anos)</p>
          </div>
          
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Microempreendedor (Razão Social)</span>
              <span class="info-value">${meiNameDisplay}</span>
            </div>
            <div class="info-item">
              <span class="info-label">CNPJ MEI</span>
              <span class="info-value">${cnpjDisplay}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Nome Original do Arquivo</span>
              <span class="info-value">${docItem.nome}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Período Contábil</span>
              <span class="info-value">${docItem.mes} de ${docItem.ano}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Selo Temporal de Protocolo</span>
              <span class="info-value">${formattedDate}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Metadados de Tamanho / Tipo</span>
              <span class="info-value">${sizeStr} (${docItem.tipo || "Não categorizado"})</span>
            </div>
          </div>

          <div class="document-container">
            <p style="font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 15px;">Visualização Física Anexada pelo Auditor</p>
            ${docItem.tipo.startsWith("image/") ? `
              <img src="${docItem.downloadUrl}" class="preview-img" alt="Documento" />
            ` : `
              <iframe src="${docItem.downloadUrl}" style="width: 100%; height: 500px; border: none; background: white;"></iframe>
            `}
          </div>

          <div class="footer">
            <p>Este comprovante foi catalogado digitalmente no MEI Flow através de armazenamento em nuvem criptografado de conformidade fiscal.</p>
            <p>A guarda dos documentos que compõem a receita bruta mensal é obrigatória por lei durante o prazo de 5 (cinco) anos a contar do primeiro dia do exercício seguinte ao da emissão.</p>
          </div>
          
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 400);
            };
          </script>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  // Upload Manual de Documentos e comprovantes
  const handleFileUpload = async (file: File) => {
    const uid = currentUser?.uid || auth.currentUser?.uid || null;

    if (!uid) {
      setErrorMsg("Identificação não encontrada. Por favor, faça login para salvar.");
      return;
    }

    if (!selectedMonth) {
      setErrorMsg("Selecione uma pasta de mês no Painel antes de enviar o comprovante.");
      return;
    }

    // Valida o ano selecionado
    if (selectedYear < anoMaisAntigoPermitido) {
      setErrorMsg(`Não é permitido armazenar arquivos para anos fiscais anteriores a ${anoMaisAntigoPermitido} devido à regra legal dos 5 anos.`);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setStorageWarning(null);

    const readAsDataURL = (fileToRead: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("Falha ao processar arquivo como Data URL."));
          }
        };
        reader.onerror = () => reject(reader.error || new Error("Erro na leitura do arquivo."));
        reader.readAsDataURL(fileToRead);
      });
    };

    try {
      let dataUrl = "";
      try {
        dataUrl = await readAsDataURL(file);
      } catch (readErr: any) {
        throw new Error(`Erro ao preparar o arquivo: ${readErr.message}`);
      }

      let savedDoc: any = null;
      let uploadSucceeded = false;

      // 1. Tentar upload de alta performance por URL assinada no Storage
      try {
        const signedResponse = await fetch("/api/documentos/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            getSignedUrl: true,
            fileName: file.name,
            uid: uid,
            ano: selectedYear,
            mes: selectedMonth,
            size: file.size,
            type: file.type || "application/octet-stream"
          })
        });

        if (signedResponse.ok) {
          const signedData = await signedResponse.json();
          if (signedData.success) {
            const { uploadUrl, document: docMeta } = signedData;

            // PUT binário diretamente no bucket usando o link assinado
            const putResponse = await fetch(uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": file.type || "application/octet-stream"
              },
              body: file
            });

            if (putResponse.ok) {
              savedDoc = docMeta;
              uploadSucceeded = true;
              console.log("[Storage GCS Signed Upload] Sucesso direto!");
            } else {
              console.warn("[GCS Signed Upload] Falha no PUT. Recorrendo a contingência Base64...");
            }
          }
        }
      } catch (signedErr: any) {
        console.warn("[Signed Upload Fallback Match] Erro no upload assinado. Recorrendo a contingência Base64...", signedErr);
      }

      // 2. Fallback caso falhe o upload assinado
      if (!uploadSucceeded) {
        const uploadResponse = await fetch("/api/documentos/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fileData: dataUrl,
            fileName: file.name,
            uid: uid,
            id: `doc_${Date.now()}`,
            ano: selectedYear,
            mes: selectedMonth,
            size: file.size,
            type: file.type || "application/octet-stream"
          })
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(errorText || `Erro no servidor (${uploadResponse.status}).`);
        }

        const resJson = await uploadResponse.json();
        if (!resJson.success) {
          throw new Error(resJson.message || "O backend indicou falha no processamento.");
        }

        savedDoc = resJson.document;
      }

      setSuccessMsg(`Documento "${file.name}" guardado com sucesso na pasta de ${selectedMonth}/${selectedYear}!`);
      
      if (savedDoc && savedDoc.isSimulated) {
        setStorageWarning("Aviso de simulação: O backend utilizou contingência de visualização estrita devido a limitações de credencial no bucket.");
      }
    } catch (err: any) {
      console.error("Erro ao realizar upload:", err);
      setErrorMsg("Falha ao registrar documento. Verifique sua conexão e tente novamente.");
    } finally {
      setIsLoading(false);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
    }
  };

  // Exclui um documento específico
  const deletarDocumento = async (docItem: DocumentoMEI) => {
    const uid = currentUser?.uid || auth.currentUser?.uid || null;

    if (!uid) {
      setErrorMsg("Erro: Você precisa estar autenticado para excluir.");
      return;
    }

    if (!window.confirm(`Deseja realmente excluir o documento "${docItem.nome}" de forma definitiva das pastas?`)) {
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // A exclusão (registro do Firestore + arquivo físico do Storage) é feita
      // pelo backend, via Admin SDK. As Storage Rules do projeto bloqueiam
      // propositalmente qualquer "write" (e portanto "delete") direto do client,
      // então tentar deleteObject() aqui sempre resultaria em "storage/unauthorized".
      const response = await fetch("/api/documentos/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: docItem.id,
          uid: uid,
          storagePath: docItem.storagePath
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Falha ao excluir o documento.");
      }

      if (result.warning) {
        setErrorMsg(result.warning);
      } else {
        setSuccessMsg(`Documento "${docItem.nome}" excluído das pastas.`);
      }
    } catch (err: any) {
      console.error("Erro ao deletar:", err);
      setErrorMsg("Erro ao deletar documento. Tente novamente em alguns instantes.");
    } finally {
      setIsLoading(false);
    }
  };

  // Drag and drop do arquivo
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Formata o tamanho legivelmente
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Filtra documentos listados para o ano e o mês ativo selecionado, permitindo buscas dinâmicas
  const documentosFiltrados = documentos.filter(docItem => {
    const combinaAno = docItem.ano === selectedYear;
    const combinaMes = selectedMonth ? docItem.mes === selectedMonth : true;
    const combinaFiltroTexto = searchTerm ? docItem.nome.toLowerCase().includes(searchTerm.toLowerCase()) : true;
    return combinaAno && combinaMes && combinaFiltroTexto;
  });

  // Conta documentos por mês no ano selecionado para exibir no grid das pastas
  const contarDocsPorMes = (mesNome: string) => {
    return documentos.filter(docItem => docItem.ano === selectedYear && docItem.mes === mesNome).length;
  };

  return (
    <div className="w-full">
      {/* 1. SEÇÃO DE ATALHO DIRETO DO COMPROVANTE (EXIBIDO NA DASHBOARD/HOME) */}
      <div 
        onClick={() => {
          if (planType === "free") {
            setShowFreeLockModal(true);
          } else {
            setIsMobileDrawerOpen(true);
          }
        }}
        className="w-full bg-white p-6 rounded-3xl border border-slate-200/50 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all duration-300 flex items-center justify-between group"
        id="dashboard-documentos-compact-card"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 group-hover:scale-105 transition-transform">
            <Folder className="w-6 h-6 text-indigo-600" />
          </div>
          <div className="text-left space-y-0.5">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>Arquivo Digital do MEI</span>
              {planType === "free" ? (
                <span className="inline-flex items-center gap-1 bg-amber-100/60 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                  🔒 Premium
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-indigo-100/60 text-indigo-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                  Conformidade Contábil
                </span>
              )}
            </h4>
            <p className="text-xs text-slate-400 font-medium">
              Organize seus comprovantes mensais, recibos e notas de compras divididas por pastas do ano fiscal do SIMEI.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs shrink-0 pl-2">
          <span>{planType === "free" ? "Desbloquear" : "Abrir Pastas"}</span>
          <ChevronRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>

      {/* 1B. MODAL DE UPSELL — exibido quando o plano free clica no Arquivo Digital */}
      {showFreeLockModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden text-center my-auto">
            <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-950 text-white p-7 relative">
              <button
                onClick={() => setShowFreeLockModal(false)}
                className="absolute right-4 text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
                style={{ top: "calc(var(--safe-top) + 1rem)" }}
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-indigo-400/30">
                <Folder className="w-6 h-6 text-indigo-300" />
              </div>
              <h3 className="text-lg font-extrabold tracking-tight">Arquivo Digital é Premium</h3>
              <p className="text-xs text-slate-300 mt-1.5 max-w-xs mx-auto">
                Guarde notas fiscais e comprovantes na nuvem por 5 anos, organizados por mês e prontos para baixar quando precisar.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <button
                onClick={() => {
                  setShowFreeLockModal(false);
                  onTriggerUpgrade?.();
                }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-yellow-300" />
                <span>Quero ser Premium</span>
              </button>
              <button
                onClick={() => setShowFreeLockModal(false)}
                className="w-full py-2.5 text-slate-500 hover:text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. DRAWER COMPLETO DO ARQUIVO DIGITAL */}
      {isMobileDrawerOpen && planType === "premium" && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end transition-opacity duration-300 animate-fade-in">
          <div 
            className="w-full max-w-2xl bg-slate-50 h-full overflow-y-auto relative"
            id="mei-arquivo-drawer-container"
          >
            {/* Header do Drawer (agora rola junto com o conteúdo, em vez de fixo —
                garante que o botão de fechar nunca fique inacessível em telas onde
                a barra de status/notch reduz o espaço disponível) */}
            <div className="pt-safe bg-white border-b border-slate-100 px-6 pb-5 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                  <FolderOpen className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="text-left">
                  <h3 className="font-display font-bold text-xl text-slate-900 tracking-tight">
                    Arquivo Digital
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                    Guarda Digital de Comprovantes (5 anos)
                  </p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setSelectedMonth("");
                }}
                className="w-9 h-9 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                title="Fechar Pastas"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo das Pastas */}
            <div className="p-6 space-y-6">

              {/* Enquanto o Firebase Auth ainda não confirmou o login, exibe um loading
                  dedicado e não renderiza pastas/erros, evitando qualquer flash de
                  "permission-denied" antes do token estar pronto. */}
              {isAuthLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                  <p className="text-xs font-semibold">Verificando sua sessão...</p>
                </div>
              ) : !currentUser ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs flex items-start gap-2.5 text-left">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>Você precisa estar logado para visualizar e enviar comprovantes.</div>
                </div>
              ) : (
              <>
              {/* Tratamento e Exibição de Alertas e Erros de Permissão Amigáveis */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-start gap-3 text-red-700 animate-fade-in">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-left leading-relaxed">
                    <p className="font-bold">Aviso de Sincronização Temporária</p>
                    <p className="mt-1">{errorMsg}</p>
                    <button 
                      onClick={() => {
                        setSelectedYear(selectedYear); // Recarrega o effect
                        setErrorMsg(null);
                      }} 
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-800 hover:bg-red-200 rounded-lg font-bold text-[10px] uppercase tracking-wide transition-colors"
                    >
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Reconectar Pastas
                    </button>
                  </div>
                </div>
              )}

              {successMsg && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-2xl text-xs flex items-start gap-2.5 animate-fade-in text-left">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>{successMsg}</div>
                </div>
              )}

              {storageWarning && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs flex items-start gap-2.5 animate-fade-in text-left">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>{storageWarning}</div>
                </div>
              )}

              {/* Seletor do Ano Fiscal */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-left">
                  Passo 1: Escolha o Ano de Exercício Fiscal
                </span>
                <div className="grid grid-cols-5 gap-2">
                  {anosValidos.map((ano) => (
                    <button
                      key={ano}
                      onClick={() => {
                        setSelectedYear(ano);
                        setSelectedMonth(""); // Limpa o mês ativo após trocar o ano
                        setErrorMsg(null);
                      }}
                      className={`py-2 px-1 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                        selectedYear === ano
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {ano}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid dos Meses - Pastas Virtuais */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-left">
                  Passo 2: Clique para Abrir uma Pasta Mensal ({selectedYear})
                </span>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  {MESES.map((mes) => {
                    const docsNoMes = contarDocsPorMes(mes);
                    const isSelected = selectedMonth === mes;
                    return (
                      <button
                        key={mes}
                        onClick={() => {
                          setSelectedMonth(mes);
                          setErrorMsg(null);
                        }}
                        className={`p-3 rounded-2xl transition-all flex flex-col items-center justify-center gap-1 cursor-pointer border ${
                          isSelected
                            ? "bg-indigo-50 border-indigo-400 text-indigo-700"
                            : "bg-white border-slate-200/60 hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <div className="relative">
                          <Folder className={`w-8 h-8 ${isSelected ? "text-indigo-500 fill-indigo-100" : "text-slate-400"}`} />
                          {docsNoMes > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[8px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center animate-pulse shadow-sm">
                              {docsNoMes}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-semibold tracking-tight">{mes}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Área do Mês Selecionado */}
              {selectedMonth ? (
                <div className="bg-white border border-slate-200/50 rounded-3xl p-5 space-y-5 text-left">
                  
                  {/* Cabeçalho da Pasta Física */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <span className="text-[10px] bg-indigo-100/60 text-indigo-700 px-2 py-0.5 rounded font-bold uppercase">Pasta Aberta</span>
                      <h4 className="text-base font-extrabold text-slate-800 tracking-tight mt-1">
                        {selectedMonth} de {selectedYear}
                      </h4>
                    </div>
                    <button 
                      onClick={() => {
                        setSelectedMonth("");
                        setErrorMsg(null);
                      }}
                      className="text-xs text-slate-400 hover:text-indigo-600 font-bold"
                    >
                      Fechar Pasta
                    </button>
                  </div>

                  {/* Dropzone do Arquivo */}
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => uploadFileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer flex flex-col items-center gap-2 ${
                      isDragging 
                        ? "border-indigo-500 bg-indigo-50/40" 
                        : "border-slate-200 hover:border-indigo-450 bg-slate-50/50"
                    }`}
                  >
                    <input 
                      type="file" 
                      ref={uploadFileInputRef} 
                      onChange={handleFileChange}
                      accept="image/*,application/pdf"
                      className="hidden" 
                    />
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-xs text-indigo-600">
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5 text-indigo-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">
                        Arraste ou Toque para Enviar Comprovante
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        PDF ou Imagem (Máximo 5MB) para fins de Livro Caixa.
                      </p>
                    </div>
                  </div>

                  {/* Lista de Comprovantes com Filtro de Mês */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                      <span>Comprovantes desta pasta ({documentosFiltrados.length})</span>
                      <span>Opções</span>
                    </div>

                    {documentosFiltrados.length === 0 ? (
                      <div className="text-center py-6 border border-dashed border-slate-100 rounded-2xl bg-slate-50/20">
                        <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                        <p className="text-xs text-slate-400 mt-1.5 font-semibold">Nenhum documento guardado neste mês.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {documentosFiltrados.map((docItem) => (
                          <div 
                            key={docItem.id}
                            className="bg-slate-50/55 border border-slate-100 hover:border-slate-200 hover:bg-slate-50 p-3 rounded-2xl flex items-center justify-between gap-3 text-xs transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 bg-white border border-slate-100 rounded-xl flex items-center justify-center shrink-0 shadow-3xs">
                                <FileText className="w-4.5 h-4.5 text-slate-500" />
                              </div>
                              <div className="text-left min-w-0">
                                <p className="font-bold text-slate-800 truncate" title={docItem.nome}>
                                  {docItem.nome}
                                </p>
                                <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                  <Clock className="w-3 h-3 text-slate-350" />
                                  {new Date(docItem.uploadedAt).toLocaleDateString("pt-BR")}
                                  <span className="text-[9px] font-mono font-bold bg-slate-100 px-1 rounded text-slate-500 ml-1">
                                    {formatBytes(docItem.tamanho)}
                                  </span>
                                </p>
                              </div>
                            </div>
                            
                            {/* Ações do Comprovante */}
                            <div className="flex items-center gap-1.5">
                              {/* Botão de download de aba nova */}
                              <button 
                                onClick={() => window.open(docItem.downloadUrl, "_blank")}
                                className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-150/80 hover:bg-indigo-100 hover:text-indigo-750 text-indigo-650 rounded-lg flex items-center gap-1 shadow-3xs transition-all cursor-pointer font-bold text-[10px] shrink-0"
                                title="Visualizar / Baixar Comprovante"
                              >
                                <Download className="w-3 h-3 shrink-0" />
                                <span>Visualizar</span>
                              </button>
                              
                              {/* Botão de Impressão Especial (no APK, baixa o arquivo direto) */}
                              <button 
                                onClick={() => handlePrintDocument(docItem)}
                                className="w-8 h-8 bg-white border border-slate-200/80 hover:bg-emerald-50 hover:text-emerald-600 rounded-lg flex items-center justify-center shadow-xs text-slate-500 transition-all cursor-pointer"
                                title={isNativePlatform() ? "Baixar Comprovante Fiscal" : "Imprimir Comprovante Fiscal"}
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => deletarDocumento(docItem)}
                                className="w-8 h-8 bg-white border border-slate-200/80 hover:bg-red-50 hover:text-red-600 rounded-lg flex items-center justify-center shadow-xs text-slate-400 hover:border-red-150 transition-all cursor-pointer"
                                title="Remover"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                <div className="bg-slate-100/60 p-6 rounded-2xl text-center text-slate-400 text-xs border border-dashed border-slate-200 flex flex-col items-center gap-2">
                  <Folder className="w-8 h-8 text-slate-300" />
                  <p className="font-bold text-slate-600">Nenhum mês ativo</p>
                  <p className="max-w-xs mx-auto text-[11px] font-medium leading-normal text-slate-400">
                    Selecione qual pasta de mês acima você gostaria de abrir para ver arquivos ou fazer upload de novos comprovantes.
                  </p>
                </div>
              )}

              </>
              )}

            </div>

            {/* Footer do Drawer com Contador Real de Documentos */}
            <div className="pb-safe bg-white px-6 pt-4.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
              <span className="flex items-center gap-1.5 font-semibold text-indigo-600">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                Espelho em Nuvem Sincronizado
              </span>
              <span>
                Total de comprovantes no ano: <strong className="text-slate-700">{documentos.length}</strong>
              </span>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
