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
  Sparkles
} from "lucide-react";
import { db, auth, storage } from "../firebase";
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, onSnapshot } from "firebase/firestore";
import { ref, uploadString, getDownloadURL, deleteObject } from "firebase/storage";

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
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Meses do ano em formato padrão
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export default function ArquivoDigitalMei({ userId, userProfile }: ArquivoDigitalMeiProps) {
  const currentYear = new Date().getFullYear(); // 2026 no contexto atual
  
  // Limite legal de 5 anos fiscais (ex: 2026, 2025, 2024, 2023, 2022)
  const limiteAnosFiscais = 5;
  const anosValidos = Array.from({ length: limiteAnosFiscais }, (_, i) => currentYear - i);
  const anoMaisAntigoPermitido = currentYear - (limiteAnosFiscais - 1); // 2022  // Estados de navegação e visualização
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Lista de arquivos recuperados
  const [documentos, setDocumentos] = useState<DocumentoMEI[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  // Estado para drag and drop
  const [isDragging, setIsDragging] = useState(false);
  
  // Diálogo no Mobile (Drawer)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  // Controle de Auditoria Silenciosa de 5 Anos
  const hasCleanedUpRef = useRef(false);

  // Busca síncrona/realtime de documentos do usuário
  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !user.uid || userId === "demouser_49281") {
      console.log("[ArquivoDigitalMei] Inicialização abortada: Usuário não autenticado no Firebase Auth.");
      return;
    }
    const uid = user.uid;

    setIsLoading(true);
    setErrorMsg(null);

    // Consulta documentos do usuário logado diretamente na coleção raiz documentos_mei autorizada
    const q = query(
      collection(db, "documentos_mei"),
      where("userId", "==", uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
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

      // Filtra de acordo com a regra de retenção de 5 anos no cliente para blindagem extra
      const docsFiltrados = docsList.filter(docItem => docItem.ano >= anoMaisAntigoPermitido);
      
      const expiradosCount = docsList.length - docsFiltrados.length;
      if (expiradosCount > 0) {
        console.warn(`${expiradosCount} arquivos expiraram o prazo legal de 5 anos fiscais e foram bloqueados da visualização pela regra contábil digital.`);
      }

      setDocumentos(docsFiltrados);
      setIsLoading(false);
    }, (error) => {
      console.error("[ArquivoDigitalMei] Erro de permissão no Firestore:", error.message);
      setErrorMsg(`Erro de permissão no Firestore: ${error.message}`);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [userId, anoMaisAntigoPermitido]);

  // Rotina silenciosa e automática de retenção legal (5 anos contábeis)
  const executarRotinaLimpezaSilenciosa = async () => {
    const user = auth.currentUser;
    if (!user || !user.uid || userId === "demouser_49281") return;
    const uid = user.uid;
    
    console.log(`[Regra do Fisco (5 Anos)] Iniciando varredura em segundo plano. Prazo permitido: ${anoMaisAntigoPermitido} até ${currentYear}.`);

    try {
      // 1. Busca todos os documentos do usuário na coleção raiz documentos_mei autorizada
      const queryAll = query(
        collection(db, "documentos_mei"),
        where("userId", "==", uid)
      );
      const querySnap = await getDocs(queryAll);
      
      let removidosCount = 0;

      for (const docSnap of querySnap.docs) {
        const data = docSnap.data();
        const docAno = Number(data.ano);
        const docId = docSnap.id;

        if (docAno < anoMaisAntigoPermitido) {
          console.warn(`[Regra do Fisco (5 Anos)] Documento expirado encontrado: ${data.nome} (${docAno}). Excurga permanente...`);
          
          // Excluir metadado do Firestore
          await deleteDoc(doc(db, "documentos_mei", docId));
          
          // Excluir do Storage se houver path e não for simulação
          if (data.storagePath && !data.isSimulated) {
            try {
              const storageRef = ref(storage, data.storagePath);
              await deleteObject(storageRef);
            } catch (err) {
              console.info("[Regra do Fisco (5 Anos) Info] Arquivo físico já indisponível no Storage.");
            }
          }
          removidosCount++;
        }
      }

      if (removidosCount > 0) {
        console.log(`[Regra do Fisco (5 Anos)] Varredura bem-sucedida! ${removidosCount} arquivos expirados reciclados.`);
      }
    } catch (err: any) {
      console.warn("[Regra do Fisco (5 Anos)] Erro ao contatar Firestore ou executar limpeza silenciosa:", err.message);
    }
  };

  // Efeito automático para rodar a auditoria legal em segundo plano silenciosamente
  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !user.uid || userId === "demouser_49281" || hasCleanedUpRef.current) return;
    
    const timer = setTimeout(() => {
      executarRotinaLimpezaSilenciosa();
      hasCleanedUpRef.current = true;
    }, 2000);

    return () => clearTimeout(timer);
  }, [userId]);

  // Trata o upload do arquivo
  const handleFileUpload = async (file: File) => {
    const user = auth.currentUser;
    if (!user || !user.uid || userId === "demouser_49281") {
      setErrorMsg("Erro: Você precisa estar autenticado para realizar uploads.");
      return;
    }
    const uid = user.uid;

    if (!selectedMonth) {
      setErrorMsg("Por favor, selecione uma pasta de mês antes de efetuar o upload do documento.");
      return;
    }

    // Valida ano e restrição contábil no frontend
    if (selectedYear < anoMaisAntigoPermitido) {
      setErrorMsg(`Não é permitido armazenar arquivos para anos fiscais anteriores a ${anoMaisAntigoPermitido} (Regra de retenção de 5 anos).`);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setStorageWarning(null);

    const docId = `doc_${Date.now()}`;
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const targetStoragePath = `usuarios/${uid}/${selectedYear}/${selectedMonth}/${cleanFileName}`;

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
      // 1. Converter o arquivo físico para Data URL (Base64) para contingência
      let dataUrl = "";
      try {
        dataUrl = await readAsDataURL(file);
      } catch (readErr: any) {
        throw new Error(`Erro ao preparar o arquivo: ${readErr.message}`);
      }

      let savedDoc: any = null;
      let uploadSucceeded = false;

      // Tenta upload de alta performance por URL assinada (Evita limites de tamanho de corpo de requisição do proxy do container)
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

            // PUT binário diretamente no bucket do Firebase Storage usando o link assinado
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
              console.log("[Modern GCS Signed Upload] Sucesso direto!");
            } else {
              console.warn("[GCS Signed Upload] Falha no PUT com código:", putResponse.status, ". Recorrendo a contingência Base64...");
            }
          }
        }
      } catch (signedErr: any) {
        console.warn("[Signed Upload Fallback Match] Erro CORS/Rede no link assinado. Recorrendo a contingência Base64...", signedErr);
      }

      // Se falhar o upload usando link assinado direto, recorremos à contingência clássica de proxy de upload base64
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
          throw new Error(resJson.message || "O backend indicou falha no processamento do upload.");
        }

        savedDoc = resJson.document;
      }

      setSuccessMsg(`Documento "${file.name}" guardado com sucesso na pasta de ${selectedMonth}/${selectedYear}!`);
      
      if (savedDoc && savedDoc.isSimulated) {
        setStorageWarning("Aviso de CORS/Bucket: O backend utilizou contingência local de visualização devido a políticas estritas do bucket.");
      }
    } catch (err: any) {
      console.error("Erro ao realizar upload:", err);
      setErrorMsg(`Falha ao registrar documento: ${err.message}`);
    } finally {
      setIsLoading(false);
      // Limpa input
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
    }
  };

  // Gerenciamento de drag & drop
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
      const file = e.dataTransfer.files[0];
      handleFileUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      handleFileUpload(file);
    }
  };

  // Exclui um documento específico
  const deletarDocumento = async (docItem: DocumentoMEI) => {
    const user = auth.currentUser;
    if (!user || !user.uid || userId === "demouser_49281") {
      setErrorMsg("Erro: Você precisa estar autenticado para excluir documentos.");
      return;
    }
    const uid = user.uid;

    if (!window.confirm(`Deseja realmente excluir o arquivo "${docItem.nome}"?`)) {
      return;
    }

    setIsLoading(true);

    try {
      // 1. Remove do Firestore na coleção raiz documentos_mei autorizada
      await deleteDoc(doc(db, "documentos_mei", docItem.id));

      // 2. Remove do Storage se não for simulado
      if (!docItem.isSimulated && docItem.storagePath) {
        try {
          const fileRef = ref(storage, docItem.storagePath);
          await deleteObject(fileRef);
        } catch (storageErr) {
          console.warn("Falha física ao remover do storage (pode já ter sido limpo reativamente):", storageErr);
        }
      }

      setSuccessMsg(`Documento "${docItem.nome}" excluído das pastas.`);
    } catch (err: any) {
      console.error("Erro ao deletar:", err);
      setErrorMsg(`Erro ao deletar documento: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Formata o tamanho em bytes para algo legível
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Filtra documentos listados para o ano e mês selecionados, além de busca textual
  const documentosFiltrados = documentos.filter(docItem => {
    const combinaAno = docItem.ano === selectedYear;
    const combinaMes = selectedMonth ? docItem.mes === selectedMonth : true;
    const combinaFiltroTexto = searchTerm ? docItem.nome.toLowerCase().includes(searchTerm.toLowerCase()) : true;
    return combinaAno && combinaMes && combinaFiltroTexto;
  });

  // Conta os documentos por mês no ano corrente para exibir bolinhas indicativas fáceis de tocar
  const contarDocsPorMes = (mesNome: string) => {
    return documentos.filter(docItem => docItem.ano === selectedYear && docItem.mes === mesNome).length;
  };

  return (
    <div className="w-full">
      {/* 1. SEÇÃO COMPACTA DA DASHBOARD (NA HOME) */}
      <div 
        onClick={() => setIsMobileDrawerOpen(true)}
        className="w-full bg-white p-6 rounded-3xl border border-slate-200/50 shadow-xs cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all duration-300 flex items-center justify-between group"
        id="dashboard-documentos-compact-card"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 group-hover:scale-105 transition-transform">
            <Folder className="w-6 h-6 text-indigo-600" />
          </div>
          <div className="text-left space-y-0.5">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>Documentos Guardados</span>
              <span className="inline-flex items-center gap-1 bg-indigo-100/60 text-indigo-700 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase">
                Arquivo Digital do MEI
              </span>
            </h4>
            <p className="text-xs text-slate-400 font-medium">
              Acesse e organize seus comprovantes, notas e relatórios contábeis para a Declaração Anual.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs shrink-0 pl-2">
          <span className="hidden sm:inline">Visualizar Pastas</span>
          <ChevronRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>

      {/* 2. DRAWER DE NAVEGAÇÃO ESPELHADA (PROJETADO PARA CELULARES / MOBILE) */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-end transition-opacity duration-300">
          <div 
            className="w-full max-w-2xl bg-slate-50 h-full flex flex-col shadow-2xl relative overflow-hidden"
            id="mei-arquivo-drawer-container"
          >
            {/* Header do Drawer */}
            <div className="bg-white border-b border-slate-100 px-6 py-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                  <FolderOpen className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="text-left">
                  <h3 className="font-display font-light text-xl text-slate-900 tracking-tight">
                    Arquivo Digital do MEI
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                    Contabilidade Digital Fiscal
                  </p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setSelectedMonth("");
                }}
                className="w-9 h-9 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                title="Fechar Gaveta"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo Principal do Drawer (Pastas e Arquivos) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Avisos rápidos de Sucesso / Erro */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-xs flex items-start gap-2.5 animate-fade-in text-left">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>{errorMsg}</div>
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

              <>
                  {/* Seletor de Ano Fiscal de toque fácil (Mobile friendly) */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-left">
                      Passo 1: Selecione o Ano Fiscal
                    </span>
                    <div className="grid grid-cols-5 gap-2">
                      {anosValidos.map((ano) => (
                        <button
                          key={ano}
                          onClick={() => {
                            setSelectedYear(ano);
                            setSelectedMonth(""); // reseta o mês ao trocar o ano
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
                    <p className="text-[10px] text-slate-400 text-left font-light leading-normal mt-1 block">
                      💡 Em conformidade com a Legislação Digital, apenas os últimos 5 anos fiscais são exibidos. Anos anteriores expiraram o prazo de auditoria.
                    </p>
                  </div>

                  {/* Grid de Meses (Pastas Virtuais de Toque Ágil) */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-left">
                      Passo 2: Selecione a Pasta Mensal ({selectedYear})
                    </span>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {MESES.map((mes) => {
                        const docsNoMes = contarDocsPorMes(mes);
                        const isSelected = selectedMonth === mes;
                        return (
                          <button
                            key={mes}
                            onClick={() => setSelectedMonth(mes)}
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
                            <span className="text-[11px] font-bold tracking-tight">{mes}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Área de Visualização da Pasta Selecionada */}
                  {selectedMonth ? (
                    <div className="bg-white border border-slate-200/50 rounded-3xl p-5 space-y-5 text-left">
                      
                      {/* Título de Cabeçalho da Pasta */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div>
                          <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-bold uppercase">Pasta Ativa</span>
                          <h4 className="text-base font-extrabold text-slate-800 tracking-tight mt-1 flex items-center gap-1.5">
                            <span>{selectedMonth} / {selectedYear}</span>
                          </h4>
                        </div>
                        <button 
                          onClick={() => setSelectedMonth("")}
                          className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                        >
                          Limpar seleção
                        </button>
                      </div>

                      {/* Caixa de Upload do File (Drag & Drop + Toque) */}
                      <div 
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => uploadFileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer flex flex-col items-center gap-2 ${
                          isDragging 
                            ? "border-indigo-500 bg-indigo-50/40" 
                            : "border-slate-200 hover:border-indigo-400/80 bg-slate-50/50"
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
                            Arraste ou Toque para Enviar comprovante
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Formatos aceitos: PDF ou Imagem de Recibos/Notas (Max 5MB)
                          </p>
                        </div>
                      </div>

                      {/* Lista de Documentos nesta Pasta Especial */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 pt-1">
                          <span>Comprovantes ({documentosFiltrados.length})</span>
                          <span>Tamanho</span>
                        </div>

                        {documentosFiltrados.length === 0 ? (
                          <div className="text-center py-6 border border-dashed border-slate-100 rounded-2xl bg-slate-50/20">
                            <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                            <p className="text-xs text-slate-400 mt-1.5 font-medium">Nenhum documento guardado nesta pasta ainda.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {documentosFiltrados.map((docItem) => (
                              <div 
                                key={docItem.id}
                                className="bg-slate-50/50 border border-slate-100 hover:border-slate-200 hover:bg-slate-50 p-3 rounded-2xl flex items-center justify-between gap-3 text-xs transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 bg-white border border-slate-150 rounded-xl flex items-center justify-center shrink-0">
                                    <FileText className="w-4.5 h-4.5 text-slate-500" />
                                  </div>
                                  <div className="text-left min-w-0">
                                    <p className="font-bold text-slate-800 truncate" title={docItem.nome}>
                                      {docItem.nome}
                                    </p>
                                    <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                      <Clock className="w-3 h-3 text-slate-350" />
                                      {new Date(docItem.uploadedAt).toLocaleDateString("pt-BR")}
                                      {docItem.isSimulated && (
                                        <span className="bg-amber-100 text-amber-800 px-1 rounded text-[8px] font-extrabold uppercase ml-1">
                                          Simulador
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-semibold text-slate-500 font-mono">
                                    {formatBytes(docItem.tamanho)}
                                  </span>
                                  <a 
                                    href={docItem.downloadUrl} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="w-8 h-8 bg-white border border-slate-200/80 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg flex items-center justify-center shadow-xs text-slate-500 transition-all cursor-pointer"
                                    title="Baixar Comprovante"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                  <button
                                    onClick={() => deletarDocumento(docItem)}
                                    className="w-8 h-8 bg-white border border-slate-200/80 hover:bg-red-50 hover:text-red-600 rounded-lg flex items-center justify-center shadow-xs text-slate-400 hover:border-red-150 transition-all cursor-pointer animate-fade-in"
                                    title="Remover Documento"
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
                        Por favor, selecione qual mês acima (Passo 2) você gostaria de abrir para ver documentos arquivados ou fazer upload de novos recibos.
                      </p>
                    </div>
                  )}
                </>

            </div>

            {/* Footer do Drawer / Status Resumido */}
            <div className="bg-white px-6 py-4.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
              <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                Espelho em Nuvem Ativo
              </span>
              <span>
                Total de comprovantes: <strong className="text-slate-700">{documentos.length}</strong>
              </span>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
