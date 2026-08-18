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
  updateProfile,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
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
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';

// Carrega as configurações geradas pelo console do AI Studio / Firebase Blueprints
import firebaseConfigImport from '../firebase-applet-config.json';
import { Cliente, Transacao, Orcamento, ItemOrcamento } from './types';
// Converte a venda gravada em qualquer época para o formato atual, na leitura.
import { normalizarVenda } from './utils/recebimentos';
import { cadastrarEmpresaFocusNFe, CadastroEmpresaPayload } from './focusNFeService';

// Garante que o objeto process e process.env existam no ambiente de execução (browser/Vite) para evitar erros de referência críticos.
if (typeof globalThis !== 'undefined' && !(globalThis as any).process) {
  (globalThis as any).process = { env: {} };
}
if (typeof process !== 'undefined' && !process.env) {
  (process as any).env = {};
}

// Inicializa as variáveis lendo estritamente do process.env (Vercel) com suporte a fallback de import.meta.env (Vite) ou config local
const isProd = typeof process !== 'undefined' && (process.env.NODE_ENV === "production" || process.env.VERCEL === "1");

// Configuração estritamente protegida e lida via variáveis de ambiente com fallbacks de produção e contingência fixas de segurança de carregamento do app
const firebaseConfig: any = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBHRKyIuNTOaYseKCeKWrMoPGL1RrXGh3c",
  authDomain: "mei-flow-692d9.firebaseapp.com",
  databaseURL: "https://mei-flow-692d9-default-rtdb.firebaseio.com",
  projectId: "mei-flow-692d9",
  storageBucket: "mei-flow-692d9.firebasestorage.app",
  messagingSenderId: "481891312358",
  appId: process.env.FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:481891312358:web:022075fe512fc72ebe5127"
};

// Sincroniza process.env de forma segura para estarem disponíveis sob demanda no escopo global
if (typeof process !== 'undefined' && process.env) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = firebaseConfig.apiKey;
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = firebaseConfig.authDomain;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = firebaseConfig.projectId;
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID = firebaseConfig.appId;
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = firebaseConfig.storageBucket;
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = firebaseConfig.databaseURL;
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = firebaseConfig.messagingSenderId;
}

// Validação de inicialização amigável de produção (Evita o crash com tela branca jogando apenas console.error)
const apiKey = firebaseConfig.apiKey;
const authDomain = firebaseConfig.authDomain;
const projectId = firebaseConfig.projectId;

if (!apiKey || !authDomain || !projectId) {
  const missingKeys = [];
  if (!apiKey) missingKeys.push("apiKey (FIREBASE_API_KEY)");
  if (!authDomain) missingKeys.push("authDomain");
  if (!projectId) missingKeys.push("projectId");
  
  const errorMsg = `[WARNING FIREBASE INITIALIZATION]: Algumas chaves de configuração estão ausentes no ambiente: ${missingKeys.join(", ")}.`;
  console.error(errorMsg);
}

// Inicialização segura dos componentes do Firebase
const app = initializeApp(firebaseConfig);

// CRÍTICO: o projeto usa o banco Firestore "(default)" — é onde o backend (Admin SDK) grava
// os documentos, onde o Authentication está vinculado, e onde as regras de segurança reais
// foram publicadas e testadas. O firebase-applet-config.json (gerado automaticamente pelo
// AI Studio) trazia um "firestoreDatabaseId" apontando para um banco nomeado secundário
// (ai-studio-...), criado à parte pelo AI Studio e nunca usado pelo backend em produção.
// Usar esse banco aqui fazia o front-end ler/escrever em um Firestore diferente do que o
// resto do app usa — por isso a tela do Arquivo Digital nunca encontrava os documentos
// (ou recebia permission-denied, dependendo das regras daquele banco secundário vazio).
// Está fixo em "(default)" deliberadamente; não usar firestoreDatabaseId do AI Studio aqui.
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

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
    if (result.user) {
      const userRef = doc(db, 'users', result.user.uid);
      const docSnap = await getDoc(userRef);
      if (!docSnap.exists()) {
        const name = result.user.displayName || result.user.email?.split('@')[0] || "MEI";
        const email = result.user.email || "";
        const initialProfile = {
          uid: result.user.uid,
          name: name,
          email: email,
          planType: 'free',
          logoUrl: '',
          createdAt: new Date(),
          meiName: name,
          cnpjPrestador: '',
          inscricaoMunicipal: '',
          telefone: '',
          asaasAccessToken: '',
          companyLogo: '',
          updatedAt: new Date().toISOString()
        };
        await setDoc(userRef, initialProfile, { merge: true });

        // Também persiste na coleção legada 'usuarios'
        try {
          const legacyDocRef = doc(db, 'usuarios', result.user.uid);
          await setDoc(legacyDocRef, {
            uid: result.user.uid,
            meiName: name,
            email: email,
            cnpjPrestador: '',
            inscricaoMunicipal: '',
            telefone: '',
            asaasAccessToken: '',
            planType: 'free',
            companyLogo: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (legacyErr) {
          console.warn("Não foi possivel persistir na coleção usuarios legada para usuário Google:", legacyErr);
        }
      }
    }
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
  const path = 'customers';
  try {
    // Consulta da nova coleção 'customers' vinculando por userId
    const q1 = query(collection(db, 'customers'), where('userId', '==', meiUid));
    const snapshot1 = await getDocs(q1);
    
    // Fallback/compatibilidade para a tabela antiga de clientes
    const q2 = query(collection(db, 'clientes'), where('mei_uid', '==', meiUid));
    const snapshot2 = await getDocs(q2);

    const mapSnap = (snap: any, isOld: boolean) => snap.docs.map((docSnap: any) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        nome: isOld ? (data.nome || '') : (data.name || ''),
        documento: isOld ? (data.documento || '') : (data.cpfCnpj || ''),
        email: data.email || '',
        telefone: data.telefone || '',
        endereco: data.endereco || undefined,
        observacaoNfse: data.observacaoNfse || '',
        createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : data.createdAt) : new Date().toISOString()
      } as Cliente;
    });

    const list1 = mapSnap(snapshot1, false);
    const list2 = mapSnap(snapshot2, true);

    const merged = [...list1];
    list2.forEach((c: Cliente) => {
      if (!merged.some(m => m.id === c.id)) {
        merged.push(c);
      }
    });

    return merged;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * CARREGAR TRANSAÇÕES DO FIRESTORE (Filtrado estritamente para o MEI autenticado)
 */
export async function fetchTransacoesFromFirebase(meiUid: string): Promise<Transacao[]> {
  const path = 'transactions';
  try {
    // Consulta na nova coleção 'transactions' vinculando por userId
    const q1 = query(collection(db, 'transactions'), where('userId', '==', meiUid));
    const snapshot1 = await getDocs(q1);

    // Compatibilidade com a tabela legada 'transacoes'
    const q2 = query(collection(db, 'transacoes'), where('mei_uid', '==', meiUid));
    const snapshot2 = await getDocs(q2);

    const mapTransSnap = (snap: any, isOld: boolean) => snap.docs.map((docSnap: any) => {
      const data = docSnap.data();
      let dt = new Date().toISOString().split('T')[0];
      if (isOld) {
        dt = data.data || dt;
      } else if (data.date) {
        if (typeof data.date.toDate === 'function') {
          dt = data.date.toDate().toISOString().split('T')[0];
        } else {
          dt = new Date(data.date).toISOString().split('T')[0];
        }
      }
      return {
        id: docSnap.id,
        tipo: isOld ? (data.tipo || 'entrada') : (data.type || 'entrada'),
        valor: isOld ? (data.valor || 0) : (data.value || 0),
        data: dt,
        descricao: isOld ? (data.descricao || '') : (data.description || ''),
        categoria: data.categoria || 'Geral',
        clienteId: data.clienteId || undefined,
        clienteNome: data.clienteNome || undefined,
        clienteDocumento: data.clienteDocumento || undefined,
        formaPagamento: data.formaPagamento || 'Pix',
        vendaOrigemId: data.vendaOrigemId || undefined,
        origemTipo: data.origemTipo === 'material' || data.origemTipo === 'comissao' ? data.origemTipo : undefined
      } as Transacao;
    });

    const list1 = mapTransSnap(snapshot1, false);
    const list2 = mapTransSnap(snapshot2, true);

    const merged = [...list1];
    list2.forEach((t: Transacao) => {
      if (!merged.some(m => m.id === t.id)) {
        merged.push(t);
      }
    });

    return merged;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * INSERIR / ATUALIZAR CLIENTE (Com amarração de userId)
 */
export async function saveClienteToFirebase(meiUid: string, cliente: Cliente): Promise<void> {
  const path = `customers/${cliente.id}`;
  try {
    const docRef = doc(db, 'customers', cliente.id);
    await setDoc(docRef, {
      id: cliente.id,
      userId: meiUid,
      name: cliente.nome,
      cpfCnpj: cliente.documento || '',
      email: cliente.email || '',
      telefone: cliente.telefone || '',
      // Endereço do pagador: o boleto registrado exige em produção.
      endereco: cliente.endereco || null,
      // Observação padrão que entra na nota fiscal deste cliente.
      observacaoNfse: cliente.observacaoNfse || '',
      createdAt: cliente.createdAt ? new Date(cliente.createdAt) : new Date()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Converte uma data em formato brasileiro ("dd/mm/aaaa") para um objeto Date.
 *
 * POR QUE ISTO EXISTE: o app guarda a data como "25/12/2026", mas o JavaScript
 * lê esse formato como mês/dia/ano (padrão americano). O resultado era:
 *   - dias de 1 a 12  -> gravava com dia e mês TROCADOS (10/06 virava 6 de outubro)
 *   - dias de 13 a 31 -> virava "Invalid Date" e o Firestore RECUSAVA a gravação,
 *                        fazendo a despesa se perder silenciosamente.
 * Também aceita o formato ISO ("aaaa-mm-dd"), usado ao reler do banco.
 */
function parseDataBR(valor: string | Date | undefined | null): Date {
  if (!valor) return new Date();
  if (valor instanceof Date) return isNaN(valor.getTime()) ? new Date() : valor;

  const texto = String(valor).trim();

  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, dia, mes, ano] = br;
    const d = new Date(Number(ano), Number(mes) - 1, Number(dia));
    return isNaN(d.getTime()) ? new Date() : d;
  }

  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, ano, mes, dia] = iso;
    const d = new Date(Number(ano), Number(mes) - 1, Number(dia));
    return isNaN(d.getTime()) ? new Date() : d;
  }

  const fallback = new Date(texto);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

/**
 * INSERIR / ATUALIZAR TRANSAÇÃO (Com amarração de userId)
 */
export async function saveTransacaoToFirebase(meiUid: string, tx: Transacao): Promise<void> {
  const path = `transactions/${tx.id}`;
  try {
    const docRef = doc(db, 'transactions', tx.id);
    await setDoc(docRef, {
      id: tx.id,
      userId: meiUid,
      type: tx.tipo,
      value: tx.valor,
      description: tx.descricao,
      date: parseDataBR(tx.data),
      categoria: tx.categoria || 'Geral',
      clienteId: tx.clienteId || '',
      clienteNome: tx.clienteNome || '',
      clienteDocumento: tx.clienteDocumento || '',
      formaPagamento: tx.formaPagamento || 'Pix',
      // Despesa de comissão aponta para a venda que a originou. Sem isto, uma
      // saída de R$ 3.000 chamada "Comissão — Carlos" não tem como voltar para
      // a venda de onde saiu quando alguém for conferir.
      vendaOrigemId: tx.vendaOrigemId || '',
      // Distingue a despesa automática de comissão da compra de material
      // lançada à mão — as duas apontam para `vendaOrigemId`, só isto separa
      // qual é qual. Ver utils/composicaoValor.ts.
      origemTipo: tx.origemTipo || ''
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * EXCLUIR CLIENTE DO FIRESTORE
 */
export async function deleteClienteFromFirebase(clienteId: string): Promise<void> {
  const path = `customers/${clienteId}`;
  try {
    // Apaga do novo caminho 'customers'
    const docRef = doc(db, 'customers', clienteId);
    await deleteDoc(docRef);
    // Também garante apagamento do anterior para manter integridade
    try {
      await deleteDoc(doc(db, 'clientes', clienteId));
    } catch (_) {}
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * EXCLUIR TRANSAÇÃO DO FIRESTORE
 */
export async function deleteTransacaoFromFirebase(transacaoId: string): Promise<void> {
  const path = `transactions/${transacaoId}`;
  try {
    // Apaga do novo caminho 'transactions'
    const docRef = doc(db, 'transactions', transacaoId);
    await deleteDoc(docRef);
    // Também garante apagamento do anterior para manter integridade
    try {
      await deleteDoc(doc(db, 'transacoes', transacaoId));
    } catch (_) {}
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
  // 1. PRIMEIRO: Tenta criar o usuário no Firebase Authentication
  const result = await createUserWithEmailAndPassword(auth, email, password);
  
  if (result.user) {
    // 2. Tenta atualizar o displayName no Auth
    try {
      await updateProfile(result.user, { displayName: name });
    } catch (profileError) {
      console.warn("Aviso: Falha ao atualizar o displayName no Firebase Auth:", profileError);
    }
    
    const initialProfile = {
      uid: result.user.uid,
      name: name,
      email: email,
      planType: 'free',
      logoUrl: '',
      createdAt: new Date(),
      // backwards compatibility with old structure for App.tsx state bindings:
      meiName: name,
      cnpjPrestador: '',
      inscricaoMunicipal: '',
      telefone: '',
      asaasAccessToken: '',
      companyLogo: '',
      updatedAt: new Date().toISOString()
    };

    // 3. Tenta persistir o perfil inicial do usuário no Firestore (Coleção 'users' principal).
    // CORREÇÃO CRÍTICA: logo após createUserWithEmailAndPassword(), o token do novo usuário
    // pode ainda não ter propagado para a conexão ativa do Firestore (race condition conhecida
    // do SDK do Firebase). Isso fazia o primeiro setDoc falhar com "permission-denied" mesmo
    // com a conta e as regras corretas — e o código anterior reagia a essa falha DELETANDO a
    // conta recém-criada, fazendo cadastros desaparecerem do Authentication sem aviso real ao
    // usuário. Agora: tentamos novamente uma vez após um pequeno delay, e se ainda assim falhar,
    // a conta é MANTIDA (nunca apagamos a conta do usuário aqui) — o perfil pode ser
    // criado/completado depois, no próximo login ou na tela de configuração do MEI.
    const tentarSalvarPerfil = async (): Promise<boolean> => {
      try {
        const userDocRef = doc(db, 'users', result.user!.uid);
        await setDoc(userDocRef, initialProfile);

        // Também persiste na coleção legada 'usuarios' por segurança e prevenção de bugs legados
        try {
          const legacyDocRef = doc(db, 'usuarios', result.user!.uid);
          await setDoc(legacyDocRef, {
            uid: result.user!.uid,
            meiName: name,
            email: email,
            cnpjPrestador: '',
            inscricaoMunicipal: '',
            telefone: '',
            asaasAccessToken: '',
            planType: 'free',
            companyLogo: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        } catch (legacyErr) {
          console.warn("Não foi possivel persistir na coleção usuarios legada de forma secundária:", legacyErr);
        }

        console.log("Perfil inicial do usuário persistido com sucesso no Firestore.");
        return true;
      } catch (firestoreError) {
        console.warn("[Cadastro] Tentativa de salvar perfil inicial falhou:", firestoreError);
        return false;
      }
    };

    const sucesso = await tentarSalvarPerfil();
    if (!sucesso) {
      // Pequeno delay para dar tempo do token do novo usuário propagar para o Firestore,
      // e tenta novamente uma única vez.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const sucessoRetry = await tentarSalvarPerfil();
      if (!sucessoRetry) {
        console.warn(
          "[Cadastro] Não foi possível persistir o perfil inicial após nova tentativa. " +
          "A conta de autenticação foi mantida — o perfil será criado/completado no próximo login."
        );
      }
    }
  }
  
  return result.user;
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
 * ESQUECI MINHA SENHA: Envia um e-mail de redefinição de senha via Firebase Auth
 * para o endereço informado. Não lança erro para "e-mail não encontrado" — o
 * Firebase já trata isso de forma segura (não revela se o e-mail existe ou não),
 * então o chamador deve sempre mostrar uma mensagem genérica de sucesso ao usuário.
 */
export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error("Erro ao enviar e-mail de redefinição de senha:", error);
    throw error;
  }
}

/**
 * ALTERAR SENHA (usuário já logado): Por exigência de segurança do Firebase,
 * trocar a senha requer reautenticação recente. Por isso, pedimos a senha ATUAL
 * para reautenticar silenciosamente antes de aplicar a nova senha.
 */
export async function changeUserPassword(currentPassword: string, newPassword: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error("Nenhum usuário autenticado encontrado. Faça login novamente.");
  }
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  } catch (error) {
    console.error("Erro ao alterar a senha do usuário:", error);
    throw error;
  }
}

/* ==========================================================================
   VENDAS — e o cuidado que campo novo exige aqui

   ⚠️ As duas funções abaixo montam o documento CAMPO A CAMPO, nos dois
   sentidos. Campo que não estiver escrito nas duas listas não existe: some ao
   gravar, ou some ao ler. Foi assim que o acompanhamento do orçamento passou
   semanas voltando do zero (ver saveOrcamentoToFirebase, mais abaixo).

   Ao acrescentar qualquer coisa à venda, acrescente NOS DOIS lugares.
   ========================================================================== */

/**
 * O Firestore RECUSA `undefined` — a gravação inteira falha, não só o campo.
 * As parcelas têm vários campos opcionais (previsão, gatilho, forma), então
 * cada uma passa por aqui antes de subir.
 */
function limparIndefinidos<T extends Record<string, any>>(obj: T): T {
  const saida: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) saida[k] = v;
  }
  return saida;
}

/**
 * SALVAR NOVA VENDA: Grava uma venda na subcoleção do usuário logado: usuarios/{userId}/vendas
 *
 * ⚠️ `null` em vez de omitir, nos campos novos. Com `{ merge: true }`, omitir um
 *    campo o PRESERVA como estava — então uma venda parcelada que voltasse a ser
 *    à vista continuaria carregando o plano antigo no banco, invisível na tela e
 *    pronto para ressuscitar na próxima leitura. `null` apaga de verdade.
 */
export async function saveVendaToFirebase(userId: string, tx: Transacao): Promise<void> {
  const path = `usuarios/${userId}/vendas/${tx.id}`;
  try {
    const docRef = doc(db, 'usuarios', userId, 'vendas', tx.id);
    await setDoc(docRef, {
      id: tx.id,
      tipo: 'entrada',
      // Lembrete: em venda parcelada isto é O QUE JÁ ENTROU NO CAIXA.
      // O valor cheio está em valorTotal. Ver src/utils/recebimentos.ts.
      valor: tx.valor,
      data: tx.data,
      descricao: tx.descricao,
      categoria: tx.categoria,
      clienteId: tx.clienteId || '',
      clienteNome: tx.clienteNome || '',
      clienteDocumento: tx.clienteDocumento || '',
      formaPagamento: tx.formaPagamento || 'Pix',

      // ---- campos do recebimento parcelado e da comissão ----
      valorTotal: typeof tx.valorTotal === 'number' ? tx.valorTotal : null,
      recebimentos: Array.isArray(tx.recebimentos)
        ? tx.recebimentos.map(r => limparIndefinidos({
            id: r.id,
            valor: Number(r.valor) || 0,
            situacao: r.situacao === 'aguardando' ? 'aguardando' : 'recebido',
            rotulo: r.rotulo || undefined,
            forma: r.forma || undefined,
            dataRecebimento: r.dataRecebimento || undefined,
            previsao: r.previsao || undefined,
            gatilho: r.gatilho || undefined,
            cobrancaId: r.cobrancaId || undefined,
          }))
        : null,
      comissao: tx.comissao
        ? limparIndefinidos({
            beneficiario: String(tx.comissao.beneficiario || ''),
            base: tx.comissao.base === 'fixo' ? 'fixo' : 'percentual',
            percentual: typeof tx.comissao.percentual === 'number' ? tx.comissao.percentual : undefined,
            sobre: tx.comissao.sobre === 'recebido' ? 'recebido' : 'total',
            valor: Number(tx.comissao.valor) || 0,
            situacao: tx.comissao.situacao === 'paga' ? 'paga' : 'aPagar',
            dataPagamento: tx.comissao.dataPagamento || undefined,
            formaPagamento: tx.comissao.formaPagamento || undefined,
            despesaId: tx.comissao.despesaId || undefined,
            observacao: tx.comissao.observacao || undefined,
          })
        : null,
      orcamentoId: tx.orcamentoId || null,

      // Retrato de material × serviço, e o fornecedor que fatura o material
      // direto ao cliente, quando existir. Ver utils/composicaoValor.ts.
      composicao: tx.composicao
        ? limparIndefinidos({
            servico: Number(tx.composicao.servico) || 0,
            material: Number(tx.composicao.material) || 0,
          })
        : null,
      repasse: tx.repasse
        ? limparIndefinidos({
            ativo: !!tx.repasse.ativo,
            fornecedorNome: String(tx.repasse.fornecedorNome || ''),
            fornecedorDocumento: tx.repasse.fornecedorDocumento || undefined,
          })
        : null,

      // O createdAt de quem já existe não pode ser reescrito a cada baixa de
      // parcela: com merge, passar o valor antigo o preserva, e a ausência dele
      // numa venda nova cai no agora.
      createdAt: (tx as any).createdAt || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    // handleFirestoreError já lança — quem chamou trata no .catch().
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * BUSCAR TODAS AS VENDAS: Lista todas as vendas gravadas na subcoleção do usuário: usuarios/{userId}/vendas
 *
 * `normalizarVenda` converte na leitura, como `normalizarOrcamento` já fazia:
 * a venda gravada antes deste recurso vira uma parcela única já recebida, e
 * continua somando exatamente o que somava. Nada é migrado no banco.
 */
export async function fetchVendasFromFirebase(userId: string): Promise<Transacao[]> {
  const path = `usuarios/${userId}/vendas`;
  try {
    const colRef = collection(db, 'usuarios', userId, 'vendas');
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return normalizarVenda({
        id: docSnap.id,
        tipo: 'entrada',
        valor: Number(data.valor) || 0,
        data: data.data,
        descricao: data.descricao,
        categoria: data.categoria,
        clienteId: data.clienteId || undefined,
        clienteNome: data.clienteNome || undefined,
        clienteDocumento: data.clienteDocumento || undefined,
        formaPagamento: data.formaPagamento || 'Pix',
        valorTotal: typeof data.valorTotal === 'number' ? data.valorTotal : undefined,
        recebimentos: Array.isArray(data.recebimentos) && data.recebimentos.length
          ? data.recebimentos
          : undefined,
        comissao: data.comissao && data.comissao.beneficiario ? data.comissao : undefined,
        orcamentoId: data.orcamentoId || undefined,
        composicao: data.composicao && typeof data.composicao === 'object' ? data.composicao : undefined,
        repasse: data.repasse && data.repasse.ativo ? data.repasse : undefined,
        createdAt: data.createdAt || undefined,
      } as any) as Transacao;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/* ==========================================================================
   ORÇAMENTOS — funil de vendas
   ==========================================================================
   Até aqui os orçamentos viviam só no localStorage do navegador: abrir o MEI
   Flow no celular mostrava histórico vazio, e limpar o navegador apagava o
   funil inteiro. Agora ficam em usuarios/{userId}/orcamentos, que as regras do
   Firestore já liberam para o próprio dono — sem precisar de regra nova.
   ========================================================================== */

/**
 * Converte um orçamento salvo em qualquer época para o formato atual.
 *
 * Os primeiros orçamentos tinham UM item, em campos soltos (itemNome, itemValor).
 * Em vez de migrar o banco, convertemos na leitura: é reversível, não perde nada
 * e funciona com o que já está no navegador do usuário.
 */
export function normalizarOrcamento(o: any): Orcamento {
  const itens: ItemOrcamento[] = Array.isArray(o?.itens) && o.itens.length
    ? o.itens.map((it: any, i: number) => ({
        id: String(it?.id || `it_${i}`),
        tipo: it?.tipo === "produto" ? "produto" : "serviço",
        nome: String(it?.nome || ""),
        quantidade: Number(it?.quantidade) > 0 ? Number(it.quantidade) : 1,
        valorUnitario: Number(it?.valorUnitario) || 0,
      }))
    : [{
        id: "it_0",
        tipo: o?.itemTipo === "produto" ? "produto" : "serviço",
        nome: String(o?.itemNome || ""),
        quantidade: 1,
        valorUnitario: Number(o?.itemValor) || 0,
      }];

  const desconto = Number(o?.desconto) || 0;
  const soma = itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);

  return {
    id: String(o?.id || ""),
    numero: Number(o?.numero) || 0,
    clienteId: String(o?.clienteId || ""),
    clienteNome: String(o?.clienteNome || ""),
    clienteDocumento: o?.clienteDocumento || undefined,
    clienteEmail: o?.clienteEmail || undefined,
    clienteTelefone: o?.clienteTelefone || undefined,
    itens,
    desconto,
    // Confia no total gravado; sem ele, recalcula. Assim um desconto aplicado
    // ontem não muda de valor porque a regra mudou hoje.
    total: Number(o?.total) > 0 ? Number(o.total) : Math.max(0, soma - desconto),
    observacoes: o?.observacoes || undefined,
    validade: String(o?.validade || ""),
    situacao: (["enviado", "negociando", "aceito", "recusado"].includes(o?.situacao)
      ? o.situacao
      : "enviado") as Orcamento["situacao"],
    createdAt: String(o?.createdAt || new Date().toISOString()),
    atualizadoEm: o?.atualizadoEm || undefined,
    vendaId: o?.vendaId || undefined,

    /**
     * ⚠️ CAMPO NOVO PRECISA SER COPIADO AQUI TAMBÉM.
     *
     * Esta função monta o orçamento campo a campo. Tudo que for gravado e não
     * estiver listado aqui simplesmente não existe para a tela — foi assim que
     * o Arquivo Digital ficou sem o nome do cliente na primeira tentativa.
     */
    acompanhamento: Array.isArray(o?.acompanhamento)
      ? o.acompanhamento
          .map((c: any) => ({ etapa: Number(c?.etapa) || 0, quando: String(c?.quando || "") }))
          .filter((c: any) => c.etapa >= 1 && c.etapa <= 3 && c.quando)
      : [],
    acompanhamentoEncerrado: !!o?.acompanhamentoEncerrado,

    // Condição de pagamento combinada (entrada + saldo) e comissão prevista.
    condicaoPagamento: o?.condicaoPagamento && typeof o.condicaoPagamento === "object"
      ? {
          entradaPercentual: Number(o.condicaoPagamento.entradaPercentual) || undefined,
          entradaValor: Number(o.condicaoPagamento.entradaValor) || undefined,
          formaEntrada: o.condicaoPagamento.formaEntrada || undefined,
          formaSaldo: o.condicaoPagamento.formaSaldo || undefined,
          gatilhoSaldo: o.condicaoPagamento.gatilhoSaldo || undefined,
          previsaoSaldo: o.condicaoPagamento.previsaoSaldo || undefined,
        }
      : undefined,
    comissao: o?.comissao && o.comissao.beneficiario ? o.comissao : undefined,

    // Material e fornecedor — ver utils/composicaoValor.ts.
    mostrarComposicao: typeof o?.mostrarComposicao === "boolean" ? o.mostrarComposicao : undefined,
    repasse: o?.repasse && o.repasse.ativo ? o.repasse : undefined,
  };
}

/** Lista os orçamentos do usuário, já normalizados e do mais novo para o mais velho. */
export async function fetchOrcamentosFromFirebase(userId: string): Promise<Orcamento[]> {
  const path = `usuarios/${userId}/orcamentos`;
  try {
    const colRef = collection(db, 'usuarios', userId, 'orcamentos');
    const snapshot = await getDocs(colRef);
    return snapshot.docs
      .map(docSnap => normalizarOrcamento({ ...docSnap.data(), id: docSnap.id }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/** Cria ou atualiza um orçamento. A mesma função serve para mover no funil. */
export async function saveOrcamentoToFirebase(userId: string, orc: Orcamento): Promise<void> {
  const path = `usuarios/${userId}/orcamentos/${orc.id}`;
  try {
    const docRef = doc(db, 'usuarios', userId, 'orcamentos', orc.id);
    await setDoc(docRef, {
      id: orc.id,
      userId,
      numero: Number(orc.numero) || 0,
      clienteId: orc.clienteId || '',
      clienteNome: orc.clienteNome || '',
      clienteDocumento: orc.clienteDocumento || '',
      clienteEmail: orc.clienteEmail || '',
      clienteTelefone: orc.clienteTelefone || '',
      itens: (orc.itens || []).map(it => ({
        id: it.id,
        tipo: it.tipo,
        nome: it.nome,
        quantidade: Number(it.quantidade) || 1,
        valorUnitario: Number(it.valorUnitario) || 0,
      })),
      desconto: Number(orc.desconto) || 0,
      total: Number(orc.total) || 0,
      observacoes: orc.observacoes || '',
      validade: orc.validade || '',
      situacao: orc.situacao || 'enviado',
      vendaId: orc.vendaId || '',

      /**
       * ⚠️ ESTES DOIS CAMPOS FALTAVAM — E O SINTOMA ERA CRUEL.
       *
       * A régua de contato guarda aqui quais das três mensagens já foram
       * enviadas. Como a gravação monta o documento campo a campo, e estes não
       * estavam na lista, acontecia o seguinte: o usuário marcava "já mandei",
       * a notificação sumia da tela, o orçamento subia para a nuvem SEM o
       * registro — e, na próxima vez que a página carregasse, o lembrete
       * voltava. Todo dia. Como se o sistema não tivesse ouvido.
       *
       * Pior: o `setDoc` abaixo grava o documento INTEIRO. Então cada
       * salvamento não só deixava de gravar o acompanhamento: apagava o que já
       * existia. Por isso `{ merge: true }` agora — gravação parcial deixa de
       * poder destruir campo que ela não conhece.
       *
       * Lição: montar o documento campo a campo é seguro contra lixo, e
       * perigoso contra esquecimento. Ao acrescentar um campo ao orçamento,
       * acrescente TAMBÉM aqui — senão ele existe na tela e não existe amanhã.
       */
      acompanhamento: Array.isArray(orc.acompanhamento)
        ? orc.acompanhamento.map((c: any) => ({
            etapa: Number(c?.etapa) || 0,
            quando: String(c?.quando || '').slice(0, 10),
          }))
        : [],
      acompanhamentoEncerrado: !!orc.acompanhamentoEncerrado,

      // Condição de pagamento e comissão prevista — mesmo cuidado do bloco
      // acima: `null` para apagar de verdade quando a pessoa remove o combinado.
      condicaoPagamento: orc.condicaoPagamento
        ? limparIndefinidos({
            entradaPercentual: Number(orc.condicaoPagamento.entradaPercentual) || undefined,
            entradaValor: Number(orc.condicaoPagamento.entradaValor) || undefined,
            formaEntrada: orc.condicaoPagamento.formaEntrada || undefined,
            formaSaldo: orc.condicaoPagamento.formaSaldo || undefined,
            gatilhoSaldo: orc.condicaoPagamento.gatilhoSaldo || undefined,
            previsaoSaldo: orc.condicaoPagamento.previsaoSaldo || undefined,
          })
        : null,
      comissao: orc.comissao
        ? limparIndefinidos({
            beneficiario: String(orc.comissao.beneficiario || ''),
            base: orc.comissao.base === 'fixo' ? 'fixo' : 'percentual',
            percentual: typeof orc.comissao.percentual === 'number' ? orc.comissao.percentual : undefined,
            sobre: orc.comissao.sobre === 'recebido' ? 'recebido' : 'total',
            valor: Number(orc.comissao.valor) || 0,
            situacao: 'aPagar',
            observacao: orc.comissao.observacao || undefined,
          })
        : null,

      // Material e fornecedor — `null` apaga de verdade quando desmarcado,
      // mesmo motivo do bloco de condição de pagamento logo acima.
      mostrarComposicao: typeof orc.mostrarComposicao === 'boolean' ? orc.mostrarComposicao : null,
      repasse: orc.repasse
        ? limparIndefinidos({
            ativo: !!orc.repasse.ativo,
            fornecedorNome: String(orc.repasse.fornecedorNome || ''),
            fornecedorDocumento: orc.repasse.fornecedorDocumento || undefined,
          })
        : null,

      createdAt: orc.createdAt || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
  }
}

/** Remove um orçamento do funil. */
export async function deleteOrcamentoFromFirebase(userId: string, orcamentoId: string): Promise<void> {
  const path = `usuarios/${userId}/orcamentos/${orcamentoId}`;
  try {
    await deleteDoc(doc(db, 'usuarios', userId, 'orcamentos', orcamentoId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
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
 * SALVAR PERFIL DO USUÁRIO MEI: Grava informações cadastrais da empresa sob users/{userId}
 */
export async function saveUserProfileToFirebase(
  userId: string, 
  profileData: { 
    meiName: string; 
    cnpjPrestador: string; 
    inscricaoMunicipal?: string; 
    telefone?: string; 
    asaasAccessToken?: string;
    planType?: "free" | "premium";
    companyLogo?: string;
    emailPrestador?: string;
    enderecoPrestador?: { cep?: string; logradouro?: string; numero?: string; bairro?: string; cidade?: string; uf?: string };
    /**
     * Os três textos da régua de contato, escritos pelo próprio usuário.
     * Vazio significa "use o padrão" — e não "mande mensagem em branco".
     */
    mensagensContato?: { 1?: string; 2?: string; 3?: string };
    isCpfEmissor?: boolean;
  }
): Promise<void> {
  const path = `users/${userId}`;
  try {
    const docRef = doc(db, 'users', userId);

    // PROTEÇÃO DEFENSIVA: o Firestore tem um limite de ~1 MiB por documento.
    // Uma logo em base64 grande passa disso e trava QUALQUER atualização futura
    // do perfil (não só a logo) até alguém limpar o campo manualmente.
    //
    // ⚠️ O LIMITE AQUI ERA 50 KB, E ISSO ESTAVA DERRUBANDO LOGOS BOAS.
    //
    // A ideia original era "a logo sempre vem como URL do Storage, então
    // qualquer base64 aqui é engano". Só que quando o Storage recusa o envio —
    // regra não liberada, rede caindo — o App agora manda a imagem já encolhida
    // para ser guardada aqui mesmo, de propósito, como plano B. Uma logo de
    // 400 px pesa uns 60 KB: passava dos 50 KB e era jogada fora em silêncio,
    // que é justamente o defeito que estamos consertando.
    //
    // 700 KB deixa folga de sobra para os outros campos do cadastro e ainda
    // impede que uma foto de 2 MB corrompa o documento.
    const LIMITE_LOGO = 700_000;
    let safeCompanyLogo = profileData.companyLogo || '';
    if (safeCompanyLogo.startsWith('data:') && safeCompanyLogo.length > LIMITE_LOGO) {
      console.error(
        "[saveUserProfileToFirebase] companyLogo grande demais para o documento (tamanho:",
        safeCompanyLogo.length,
        "). Descartando para não corromper o cadastro — reduza a imagem antes de salvar."
      );
      safeCompanyLogo = '';
    }
    
    const dataToSave = {
      name: profileData.meiName,
      email: auth.currentUser?.email || '',
      logoUrl: safeCompanyLogo,
      updatedAt: new Date().toISOString(),
      isCpfEmissor: profileData.isCpfEmissor || false,
      
      // campos compatibilidade antiga do App:
      meiName: profileData.meiName,
      cnpjPrestador: profileData.cnpjPrestador,
      inscricaoMunicipal: profileData.inscricaoMunicipal || '',
      telefone: profileData.telefone || '',
      asaasAccessToken: profileData.asaasAccessToken || '',
      companyLogo: safeCompanyLogo,
      emailPrestador: profileData.emailPrestador || '',
      enderecoPrestador: profileData.enderecoPrestador || {},
      mensagensContato: profileData.mensagensContato || {}
    };

    await setDoc(docRef, dataToSave, { merge: true });
    
    // Sincroniza também na coleção antiga 'usuarios'
    try {
      const legacyDocRef = doc(db, 'usuarios', userId);
      await setDoc(legacyDocRef, dataToSave, { merge: true });
    } catch (legacyErr) {
      console.warn("Não foi possível persistir cópia em usuarios:", legacyErr);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * BUSCAR PERFIL DO USUÁRIO MEI: Obtém as informações cadastrais da empresa de users/{userId}
 */
export async function fetchUserProfileFromFirebase(userId: string): Promise<{ 
  meiName: string; 
  cnpjPrestador: string; 
  inscricaoMunicipal?: string; 
  telefone?: string; 
  asaasAccessToken?: string;
  planType?: "free" | "premium";
  companyLogo?: string;
  emailPrestador?: string;
  enderecoPrestador?: { cep?: string; logradouro?: string; numero?: string; bairro?: string; cidade?: string; uf?: string };
  mensagensContato?: { 1?: string; 2?: string; 3?: string };
  isCpfEmissor?: boolean;
  invoiceLimit?: number;
  invoiceUsed?: number;
} | null> {
  const path = `users/${userId}`;
  try {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        meiName: data.name || data.meiName || '',
        cnpjPrestador: data.cnpjPrestador || '',
        inscricaoMunicipal: data.inscricaoMunicipal || '',
        telefone: data.telefone || '',
        asaasAccessToken: data.asaasAccessToken || '',
        planType: data.planType || 'free',
        companyLogo: data.logoUrl || data.companyLogo || '',
        emailPrestador: data.emailPrestador || '',
        enderecoPrestador: data.enderecoPrestador || {},
        mensagensContato: data.mensagensContato || {},
        isCpfEmissor: data.isCpfEmissor || false,
        invoiceLimit: data.invoiceLimit !== undefined ? data.invoiceLimit : 30,
        invoiceUsed: data.invoiceUsed !== undefined ? data.invoiceUsed : 0
      };
    }
    
    // Fallback retroativo caso esteja na coleção antiga
    const legacyDocRef = doc(db, 'usuarios', userId);
    const legacySnap = await getDoc(legacyDocRef);
    if (legacySnap.exists()) {
      const data = legacySnap.data();
      return {
        meiName: data.meiName || '',
        cnpjPrestador: data.cnpjPrestador || '',
        inscricaoMunicipal: data.inscricaoMunicipal || '',
        telefone: data.telefone || '',
        asaasAccessToken: data.asaasAccessToken || '',
        planType: data.planType || 'free',
        companyLogo: data.companyLogo || '',
        emailPrestador: data.emailPrestador || '',
        enderecoPrestador: data.enderecoPrestador || {},
        mensagensContato: data.mensagensContato || {},
        isCpfEmissor: data.isCpfEmissor || false,
        invoiceLimit: data.invoiceLimit !== undefined ? data.invoiceLimit : 30,
        invoiceUsed: data.invoiceUsed !== undefined ? data.invoiceUsed : 0
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
