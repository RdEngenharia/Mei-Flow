/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  query, 
  where, 
  setDoc,
  deleteDoc,
  getDocFromServer,
  getDoc
} from 'firebase/firestore';

// Carrega as configurações geradas pelo console do AI Studio / Firebase Blueprints
import firebaseConfig from '../firebase-applet-config.json';
import { Cliente, Transacao } from './types';
import { cadastrarEmpresaFocusNFe, CadastroEmpresaPayload } from './focusNFeService';

// Inicialização segura dos componentes do Firebase
const app = initializeApp(firebaseConfig);

// CRÍTICO: Ativação correta do banco do Firestore vinculando o ID do banco
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Provedor padrão para login via Google (ideal para ambiente de popups e IFrames)
export const googleProvider = new GoogleAuthProvider();

// ==========================================
// 1. TRATAMENTO ROBUSTO DE ERROS FIRESTORE
// ==========================================
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
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
  }
}

/**
 * Função centralizadora de erros para depuração remota e mitigação de falhas de segurança
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
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
  console.error('[Firebase Connection Error Debug info]: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validar se o cliente está conectado ao Firestore
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is currently offline.");
    }
  }
}

// Execute connection test silently
testConnection();

// =========================================================
// 2. ISOLAMENTO MULTI-TENANT (GARANTE QUE CADA MEI TENHA SEUS DADOS)
// =========================================================

/**
 * AUTENTICAÇÃO: Realiza Login via Provedor Google (Pop-up compatível de IFrame)
 */
export async function loginWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Erro ao autenticar com o Google:", error);
    return null;
  }
}

/**
 * LOGOUT: Desconecta o usuário ativo
 */
export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Erro ao efetuar logout:", error);
  }
}

/**
 * CARREGAR CLIENTES DO FIRESTORE (Filtrado estritamente para o MEI autenticado)
 */
export async function fetchClientesFromFirebase(meiUid: string): Promise<Cliente[]> {
  const path = 'clientes';
  try {
    // Consulta restringida por índice no mei_uid para impedir visualização de dados alheios
    const q = query(collection(db, path), where('mei_uid', '==', meiUid));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        nome: data.nome || '',
        documento: data.documento || '',
        email: data.email || '',
        telefone: data.telefone || '',
        createdAt: data.createdAt || new Date().toISOString()
      } as Cliente;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * CARREGAR TRANSAÇÕES DO FIRESTORE (Filtrado estritamente para o MEI autenticado)
 */
export async function fetchTransacoesFromFirebase(meiUid: string): Promise<Transacao[]> {
  const path = 'transacoes';
  try {
    const q = query(collection(db, path), where('mei_uid', '==', meiUid));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        tipo: data.tipo,
        valor: data.valor,
        data: data.data,
        descricao: data.descricao,
        categoria: data.categoria,
        clienteId: data.clienteId || undefined,
        clienteNome: data.clienteNome || undefined,
        clienteDocumento: data.clienteDocumento || undefined
      } as Transacao;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * INSERIR / ATUALIZAR CLIENTE (Com amarração de mei_uid)
 */
export async function saveClienteToFirebase(meiUid: string, cliente: Cliente): Promise<void> {
  const path = `clientes/${cliente.id}`;
  try {
    const docRef = doc(db, 'clientes', cliente.id);
    await setDoc(docRef, {
      id: cliente.id,
      mei_uid: meiUid, // Vinculação forçada contra sequestro de dados
      nome: cliente.nome,
      documento: cliente.documento || '',
      email: cliente.email || '',
      telefone: cliente.telefone || '',
      createdAt: cliente.createdAt
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * INSERIR / ATUALIZAR TRANSAÇÃO (Com amarração de mei_uid)
 */
export async function saveTransacaoToFirebase(meiUid: string, tx: Transacao): Promise<void> {
  const path = `transacoes/${tx.id}`;
  try {
    const docRef = doc(db, 'transacoes', tx.id);
    await setDoc(docRef, {
      id: tx.id,
      mei_uid: meiUid, // Amarração imutável para garantir posse privativa
      tipo: tx.tipo,
      valor: tx.valor,
      data: tx.data,
      descricao: tx.descricao,
      categoria: tx.categoria,
      clienteId: tx.clienteId || '',
      clienteNome: tx.clienteNome || '',
      clienteDocumento: tx.clienteDocumento || ''
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * EXCLUIR CLIENTE DO FIRESTORE
 */
export async function deleteClienteFromFirebase(clienteId: string): Promise<void> {
  const path = `clientes/${clienteId}`;
  try {
    const docRef = doc(db, 'clientes', clienteId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * EXCLUIR TRANSAÇÃO DO FIRESTORE
 */
export async function deleteTransacaoFromFirebase(transacaoId: string): Promise<void> {
  const path = `transacoes/${transacaoId}`;
  try {
    const docRef = doc(db, 'transacoes', transacaoId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==========================================
// NOVAS FUNÇÕES: EMAIL & SENHA + SUBCOLEÇÃO VENDAS
// ==========================================

/**
 * CADASTRO: Registra um novo MEI com E-mail e Senha e define o nome fantasia
 */
export async function registerWithEmailPassword(email: string, password: string, name: string): Promise<User | null> {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    if (result.user) {
      await updateProfile(result.user, { displayName: name });
    }
    return result.user;
  } catch (error) {
    console.error("Erro no cadastro com e-mail e senha:", error);
    throw error;
  }
}

/**
 * LOGIN: Autentica um MEI já cadastrado com E-mail e Senha
 */
export async function loginWithEmailPassword(email: string, password: string): Promise<User | null> {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error("Erro de login com e-mail e senha:", error);
    throw error;
  }
}

/**
 * SALVAR NOVA VENDA: Grava uma venda na subcoleção do usuário logado: usuarios/{userId}/vendas
 */
export async function saveVendaToFirebase(userId: string, tx: Transacao): Promise<void> {
  const path = `usuarios/${userId}/vendas/${tx.id}`;
  try {
    const docRef = doc(db, 'usuarios', userId, 'vendas', tx.id);
    await setDoc(docRef, {
      id: tx.id,
      tipo: 'entrada',
      valor: tx.valor,
      data: tx.data,
      descricao: tx.descricao,
      categoria: tx.categoria,
      clienteId: tx.clienteId || '',
      clienteNome: tx.clienteNome || '',
      clienteDocumento: tx.clienteDocumento || '',
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * BUSCAR TODAS AS VENDAS: Lista todas as vendas gravadas na subcoleção do usuário: usuarios/{userId}/vendas
 */
export async function fetchVendasFromFirebase(userId: string): Promise<Transacao[]> {
  const path = `usuarios/${userId}/vendas`;
  try {
    const colRef = collection(db, 'usuarios', userId, 'vendas');
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        tipo: 'entrada',
        valor: data.valor,
        data: data.data,
        descricao: data.descricao,
        categoria: data.categoria,
        clienteId: data.clienteId || undefined,
        clienteNome: data.clienteNome || undefined,
        clienteDocumento: data.clienteDocumento || undefined
      } as Transacao;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * DELETAR VENDA DA SUBCOLEÇÃO: Exclui uma venda específica do caminho usuarios/{userId}/vendas/{vendaId}
 */
export async function deleteVendaFromFirebase(userId: string, vendaId: string): Promise<void> {
  const path = `usuarios/${userId}/vendas/${vendaId}`;
  try {
    const docRef = doc(db, 'usuarios', userId, 'vendas', vendaId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * SALVAR PERFIL DO USUÁRIO MEI: Grava informações cadastrais da empresa sob usuarios/{userId}
 */
export async function saveUserProfileToFirebase(userId: string, profileData: { meiName: string; cnpjPrestador: string; inscricaoMunicipal?: string; telefone?: string; asaasAccessToken?: string }): Promise<void> {
  const path = `usuarios/${userId}`;
  try {
    const docRef = doc(db, 'usuarios', userId);
    await setDoc(docRef, {
      meiName: profileData.meiName,
      cnpjPrestador: profileData.cnpjPrestador,
      inscricaoMunicipal: profileData.inscricaoMunicipal || '',
      telefone: profileData.telefone || '',
      asaasAccessToken: profileData.asaasAccessToken || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * BUSCAR PERFIL DO USUÁRIO MEI: Obtém as informações cadastrais da empresa de usuarios/{userId}
 */
export async function fetchUserProfileFromFirebase(userId: string): Promise<{ meiName: string; cnpjPrestador: string; inscricaoMunicipal?: string; telefone?: string; asaasAccessToken?: string } | null> {
  const path = `usuarios/${userId}`;
  try {
    const docRef = doc(db, 'usuarios', userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        meiName: data.meiName || '',
        cnpjPrestador: data.cnpjPrestador || '',
        inscricaoMunicipal: data.inscricaoMunicipal || '',
        telefone: data.telefone || '',
        asaasAccessToken: data.asaasAccessToken || ''
      };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * INTEGRAÇÃO ONBOARDING: Automatiza o cadastro do MEI na Focus NFe e atualiza o seu perfil no Firestore.
 * Vincula permanentemente a conta do usuário às credenciais e logs da Focus NFe.
 */
export async function onboardUserMeiWithFocusNFe(
  userId: string,
  profileData: {
    meiName: string;
    cnpjPrestador: string;
    inscricaoMunicipal?: string;
    email: string;
    telefone?: string;
    regimeTributario?: "SIMPLES_NACIONAL" | "SIMPLES_NACIONAL_MEI" | "REGIME_NORMAL" | number;
    logradouro?: string;
    numero?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
  }
) {
  // 1. Executa chamada para registrar na API de empresas da Focus NFe
  const payload: CadastroEmpresaPayload = {
    cnpj: profileData.cnpjPrestador,
    razao_social: profileData.meiName,
    inscricao_municipal: profileData.inscricaoMunicipal,
    email: profileData.email,
    telefone: profileData.telefone,
    regime_tributario: profileData.regimeTributario || "SIMPLES_NACIONAL",
    logradouro: profileData.logradouro,
    numero: profileData.numero,
    bairro: profileData.bairro,
    municipio: profileData.municipio,
    uf: profileData.uf,
    cep: profileData.cep,
    environment: "homologacao" // Default para testes, alterável em Produção
  };

  const focusResponse = await cadastrarEmpresaFocusNFe(payload);

  // 2. Registra o status e o ID de vinculação fiscal de volta no Firestore do Usuário
  const path = `usuarios/${userId}`;
  try {
    const docRef = doc(db, 'usuarios', userId);
    
    const updateData = {
      meiName: profileData.meiName,
      cnpjPrestador: profileData.cnpjPrestador,
      inscricaoMunicipal: profileData.inscricaoMunicipal || '',
      focusNfeEmail: profileData.email,
      focusNfeVinculada: focusResponse.success,
      focusNfeEmpresaId: focusResponse.success ? focusResponse.empresaId : null,
      focusNfeStatus: focusResponse.success ? "ATIVO_INTEGRADO" : "PENDENTE_INTEGRACAO",
      focusNfeLog: focusResponse.success 
        ? "Vinculação fiscal autogerada com sucesso!" 
        : `Erro na integração: ${focusResponse.error || "Desconhecido"}`,
      updatedAt: new Date().toISOString()
    };

    await setDoc(docRef, updateData, { merge: true });

    return {
      success: focusResponse.success,
      focusResponse,
      firestoreData: updateData
    };
  } catch (firestoreError) {
    console.error("Erro ao salvar status da Focus NFe no Firestore:", firestoreError);
    // Mesmo se o Firestore falhar por regras, retorna o status do microsserviço Focus NFe
    return {
      success: focusResponse.success,
      focusResponse,
      error: "Focus NFe cadastrado com sucesso, mas erro ao registrar logs no Firestore"
    };
  }
}

