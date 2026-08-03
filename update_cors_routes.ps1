# Script gerado automaticamente para atualizar as 8 rotas de API com CORS
# Rode este script DENTRO da pasta raiz do projeto (Mei-Flow-main)

$content_3 = @'
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import path from "path";
import fs from "fs";

// Load configuration helper for Vercel Serverless/Pages router context
const getFirebaseConfig = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      console.error("Error reading firebase-applet-config.json inside API:", err);
    }
  }
  return {};
};

const firebaseConfig = getFirebaseConfig();

const getFirebaseProjectId = () => {
  return "mei-flow-692d9"; 
};

const getFirebaseDatabaseId = () => {
  // CONFIRMADO (via testes diretos no console do Firebase e na app real): o banco
  // Firestore em uso é o "(default)". É lá que o Authentication está vinculado, onde
  // os documentos de upload aparecem, e onde as regras de segurança reais foram
  // publicadas e testadas. O "firestoreDatabaseId" do firebase-applet-config.json
  // (gerado pelo AI Studio) aponta para um banco nomeado secundário, paralelo e não
  // utilizado pelo restante do app — usá-lo aqui faria o backend gravar em um lugar
  // que o front-end nunca lê. Mantido fixo em "(default)" deliberadamente.
  if (process.env.FIREBASE_DATABASE_ID) return process.env.FIREBASE_DATABASE_ID;
  return "(default)";
};

let adminApp: any = null;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const projId = "mei-flow-692d9"; 

const isSandbox = !clientEmail || !privateKey;

if (isSandbox) {
  console.warn("[Firebase Admin Upload API WARNING]: Acesso ao ambiente real bloqueado. Faltam chaves de produção.");
} else {
  try {
    if (getApps().length === 0) {
      // Limpeza profunda da chave para garantir que o validador RSA do Google aceite na Vercel
      const formattedPrivateKey = privateKey!
        .replace(/\\n/g, '\n')
        .replace(/"/g, '')
        .trim();
      
      adminApp = initializeApp({
        credential: cert({
          projectId: projId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey,
        }),
        // Força a URL nativa do seu projeto (conforme visto no seu print do console do Firebase)
        databaseURL: `https://${projId}-default-rtdb.firebaseio.com`,
        storageBucket: firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app"
      });
      console.log(`[Firebase Admin Upload API]: Inicializado com sucesso com privilégios Admin para: ${projId}`);
    } else {
      adminApp = getApps()[0];
    }
  } catch (err: any) {
    console.error("[Firebase Admin Upload API Error]: Falha crítica na autenticação com chaves:", err.message);
  }
}

let db: any = null;
let adminStorage: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Upload API]: Conectado ao Firestore: ${dbId}`);
  } catch (dbInitErr: any) {
    console.error("[Firebase Admin Upload API Firestore Error]:", dbInitErr.message);
    db = null;
  }
  try {
    adminStorage = getStorage(adminApp);
    console.log("[Firebase Admin Upload API]: Instância do Storage ativada.");
  } catch (storageInitErr: any) {
    console.error("[Firebase Admin Upload API Storage Error]:", storageInitErr.message);
    adminStorage = null;
  }
}

// Função auxiliar assíncrona recomendada pelo usuário para configurar regras de CORS no GCS Direct
async function configureBucketCors(bucketInstance: any) {
  try {
    await bucketInstance.setCorsConfiguration([
      {
        maxAgeSeconds: 3600,
        method: ["GET", "POST", "PUT", "DELETE", "HEAD"],
        origin: ["*"],
        responseHeader: ["Content-Type", "Authorization", "x-goog-meta-*"],
      },
    ]);
    console.log("[GCS CORS Configuration]: Regras injetadas com sucesso no bucket.");
  } catch (corsErr: any) {
    console.error("[GCS CORS Configuration Error]: Falha ao gravar regras de CORS:", corsErr.message);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  // CORS: necessário para que o app empacotado como APK (Capacitor) consiga
  // chamar esta API. Dentro do WebView do Android, a página é servida a
  // partir da origem fixa "https://localhost" — diferente do domínio real
  // (meiflow.rdhomologacao.com.br) usado na versão web. Sem esses headers,
  // o navegador bloqueia a requisição no preflight (OPTIONS) antes mesmo
  // dela chegar à lógica da rota, com o erro:
  // "No 'Access-Control-Allow-Origin' header is present on the requested resource".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  if (isSandbox || !adminStorage || !db) {
    return res.status(403).json({
      success: false,
      message: "Acesso Negado (Ambiente Sandbox sem Credenciais Reais de Produção)."
    });
  }

  try {
    const { fileBase64, fileData, fileName, userId, uid, ano, mes, size, type, getSignedUrl } = req.body;

    const actualFileBase64 = fileBase64 || fileData;
    const actualUserId = userId || uid;

    if (!fileName || !actualUserId || !ano || !mes) {
      return res.status(400).json({ success: false, message: "Parâmetros obrigatórios ausentes para o upload." });
    }

    const docId = `doc_${Date.now()}`;
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const targetStoragePath = `usuarios/${actualUserId}/${ano}/${mes}/${cleanFileName}`;
    let finalType = type || "application/octet-stream";

    const downloadUrl = `/api/documentos/download?path=${encodeURIComponent(targetStoragePath)}`;

    const bucketName = firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app";
    const bucket = adminStorage.bucket(bucketName);
    
    // Chamada obrigatória com configureBucketCors para habilitar o CORS na primeira execução de produção
    await configureBucketCors(bucket);

    const fileRef = bucket.file(targetStoragePath);

    // 1. Upload Assinado
    if (getSignedUrl) {
      let uploadUrl = "";
      try {
        const [signedUrl] = await fileRef.getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, 
          contentType: finalType,
        });
        uploadUrl = signedUrl;
      } catch (signErr: any) {
        console.error("[Firebase Admin Storage Error] Falha de assinatura GCS:", signErr.message);
        throw new Error(`Falha ao assinar requisição de upload: ${signErr.message}`);
      }

      const metadataDoc = {
        id: docId,
        nome: fileName,
        url: downloadUrl,
        ano: Number(ano), // Garante tipo numérico — a query do front usa Number(selectedYear)
        mes: mes,
        criadoEm: new Date().toISOString(),
        tamanho: size || 0,
        tipo: finalType,
        uploadedAt: new Date().toISOString(),
        userId: actualUserId,
        downloadUrl: downloadUrl,
        storagePath: targetStoragePath,
        isSimulated: false
      };

      try {
        // Gravando de forma centralizada de acordo com a regra 4
        await db.collection("documentos").doc(docId).set(metadataDoc);
        console.log(`[Firestore] Registro proativo gravado na coleção 'documentos': ${docId}`);
      } catch (dbErr: any) {
        console.error("[Firestore Error] Erro ao gravar metadados na coleção raiz 'documentos':", dbErr.message);
        throw new Error(`Erro ao salvar metadados: ${dbErr.message}`);
      }

      return res.status(200).json({
        success: true,
        uploadUrl,
        downloadUrl,
        document: metadataDoc,
        mensagem: "Upload autorizado e assinado."
      });
    }

    // 2. Upload Tradicional Base64
    if (!actualFileBase64) {
      return res.status(400).json({ success: false, message: "Parâmetro em base64 ausente." });
    }

    let base64Data = actualFileBase64;
    if (actualFileBase64.includes(";base64,")) {
      const parts = actualFileBase64.split(";base64,");
      base64Data = parts[1];
      if (!type && parts[0].startsWith("data:")) {
        finalType = parts[0].substring(5);
      }
    }

    const buffer = Buffer.from(base64Data, "base64");

    try {
      await fileRef.save(buffer, {
        metadata: { contentType: finalType },
      });
      console.log(`[Firebase Storage] Arquivo salvo com sucesso no path: ${targetStoragePath}`);
    } catch (storageErr: any) {
      console.error("[Firebase Storage Error]:", storageErr.message);
      throw new Error(`Erro ao persistir arquivo no Firebase Storage: ${storageErr.message}`);
    }

    const metadataDoc = {
      id: docId,
      nome: fileName,
      url: downloadUrl,
      ano: Number(ano), // Garante tipo numérico — a query do front usa Number(selectedYear)
      mes: mes,
      criadoEm: new Date().toISOString(),
      tamanho: size || buffer.length,
      tipo: finalType,
      uploadedAt: new Date().toISOString(),
      userId: actualUserId,
      downloadUrl: downloadUrl,
      storagePath: targetStoragePath,
      isSimulated: false
    };

    try {
      // Gravando de forma centralizada de acordo com a regra 4
      await db.collection("documentos").doc(docId).set(metadataDoc);
      console.log(`[Firestore] Registro gravado com sucesso na coleção 'documentos': ${docId}`);
    } catch (dbErr: any) {
      console.error("[Firestore Error]: Falha ao gravar metadados na coleção raiz 'documentos':", dbErr.message);
      throw new Error(`Erro ao salvar metadados no banco: ${dbErr.message}`);
    }

    return res.status(200).json({
      success: true,
      document: metadataDoc,
      mensagem: "Documento salvo e publicado com sucesso!"
    });
  } catch (err: any) {
    console.error("[Serverless PDF API Error]:", err.message);
    return res.status(500).json({ success: false, message: `Erro no upload do servidor: ${err.message}` });
  }
}

'@
Set-Content -Path "api\documentos\upload.ts" -Value $content_4 -Encoding UTF8
Write-Host "Atualizado: api/documentos/upload.ts"

$content_9 = @'
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import path from "path";
import fs from "fs";

// Load configuration helper for Vercel Serverless/Pages router context
const getFirebaseConfig = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      console.error("Error reading firebase-applet-config.json inside API:", err);
    }
  }
  return {};
};

const firebaseConfig = getFirebaseConfig();

const getFirebaseDatabaseId = () => {
  // CONFIRMADO (via testes diretos no console do Firebase e na app real): o banco
  // Firestore em uso é o "(default)".
  if (process.env.FIREBASE_DATABASE_ID) return process.env.FIREBASE_DATABASE_ID;
  return "(default)";
};

let adminApp: any = null;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const projId = "mei-flow-692d9";

const isSandbox = !clientEmail || !privateKey;

if (isSandbox) {
  console.warn("[Firebase Admin Delete API WARNING]: Acesso ao ambiente real bloqueado. Faltam chaves de produção.");
} else {
  try {
    if (getApps().length === 0) {
      const formattedPrivateKey = privateKey!
        .replace(/\\n/g, '\n')
        .replace(/"/g, '')
        .trim();

      adminApp = initializeApp({
        credential: cert({
          projectId: projId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey,
        }),
        databaseURL: `https://${projId}-default-rtdb.firebaseio.com`,
        storageBucket: firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app"
      });
      console.log(`[Firebase Admin Delete API]: Inicializado com sucesso com privilégios Admin para: ${projId}`);
    } else {
      adminApp = getApps()[0];
    }
  } catch (err: any) {
    console.error("[Firebase Admin Delete API Error]: Falha crítica na autenticação com chaves:", err.message);
  }
}

let db: any = null;
let adminStorage: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
  } catch (dbInitErr: any) {
    console.error("[Firebase Admin Delete API Firestore Error]:", dbInitErr.message);
    db = null;
  }
  try {
    adminStorage = getStorage(adminApp);
  } catch (storageInitErr: any) {
    console.error("[Firebase Admin Delete API Storage Error]:", storageInitErr.message);
    adminStorage = null;
  }
}

export default async function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed. Use POST." });
  }

  if (isSandbox || !adminStorage || !db) {
    return res.status(403).json({
      success: false,
      message: "Acesso Negado (Ambiente Sandbox sem Credenciais Reais de Produção)."
    });
  }

  try {
    const { docId, userId, uid, storagePath } = req.body;
    const actualUserId = userId || uid;

    if (!docId || !actualUserId) {
      return res.status(400).json({ success: false, message: "Parâmetros obrigatórios ausentes: docId e userId." });
    }

    // Validação de segurança: confirma que o documento pertence de fato ao usuário
    // que está pedindo a exclusão, já que esta rota usa o Admin SDK (que ignora as
    // regras do Firestore/Storage). Isso evita que alguém exclua arquivos de outro
    // usuário só descobrindo um docId e enviando outro userId no corpo da requisição.
    const docRef = db.collection("documentos").doc(String(docId));
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      // Documento já não existe no Firestore — nada a fazer, considera sucesso (idempotente).
      return res.status(200).json({ success: true, mensagem: "Documento já não existia no banco de dados." });
    }

    const docData = docSnap.data();
    if (docData.userId !== actualUserId) {
      return res.status(403).json({ success: false, message: "Você não tem permissão para excluir este documento." });
    }

    // 1. Remove o registro do Firestore
    await docRef.delete();

    // 2. Remove o arquivo físico do Storage (Admin SDK ignora as Storage Rules,
    // que bloqueiam "write" — e portanto "delete" — direto do client por design)
    const pathToDelete = storagePath || docData.storagePath;
    let storageDeleted = false;
    let storageWarning: string | null = null;

    if (pathToDelete) {
      try {
        const bucketName = firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app";
        const bucket = adminStorage.bucket(bucketName);
        const fileRef = bucket.file(String(pathToDelete));
        const [exists] = await fileRef.exists();
        if (exists) {
          await fileRef.delete();
          storageDeleted = true;
        } else {
          storageDeleted = true; // já não existia, considera como removido
        }
      } catch (storageErr: any) {
        console.error("[Firebase Admin Delete API Storage Error]: Falha ao remover arquivo físico:", storageErr.message);
        storageWarning = "O registro foi removido, mas o arquivo físico não pôde ser excluído. Tente novamente mais tarde.";
      }
    } else {
      storageDeleted = true; // não havia caminho de storage associado (ex: registro legado)
    }

    return res.status(200).json({
      success: true,
      storageDeleted,
      mensagem: storageWarning || "Documento excluído com sucesso.",
      warning: storageWarning
    });
  } catch (err: any) {
    console.error("[Firebase Admin Delete API Error]:", err.message);
    return res.status(500).json({ success: false, message: `Erro ao excluir documento: ${err.message}` });
  }
}

'@
Set-Content -Path "api\documentos\delete.ts" -Value $content_10 -Encoding UTF8
Write-Host "Atualizado: api/documentos/delete.ts"

$content_15 = @'
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import path from "path";
import fs from "fs";

// Load configuration helper for Vercel Serverless/Pages router context
const getFirebaseConfig = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      console.error("Error reading firebase-applet-config.json inside API:", err);
    }
  }
  return {};
};

const firebaseConfig = getFirebaseConfig();

const getFirebaseProjectId = () => {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  if (firebaseConfig.projectId) return firebaseConfig.projectId;
  return "mei-flow-692d9"; 
};

let adminApp: any = null;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const projId = getFirebaseProjectId();

// Bypass de Sandbox: Detecta se está rodando sob e-mail padrão do sandbox do AI Studio / sem chaves reais de produção
const isSandbox = !clientEmail || !privateKey || clientEmail.includes("ais-sandbox") || (clientEmail.includes("gserviceaccount.com") && !clientEmail.includes("mei-flow-692d9"));

if (isSandbox) {
  console.warn("[Firebase Admin Download API WARNING]: Acesso ao ambiente real bloqueado. Nenhuma credencial de produção válida foi fornecida, ou o servidor está rodando sob a conta padrão de sandbox do AI Studio.");
} else {
  try {
    if (getApps().length === 0) {
      const formattedPrivateKey = privateKey!.replace(/\\n/g, '\n');
      adminApp = initializeApp({
        credential: cert({
          projectId: projId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey,
        }),
        storageBucket: firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app"
      });
      console.log(`[Firebase Admin Download API]: Inicializado com sucesso via chaves para o projeto de produção: ${projId}`);
    } else {
      adminApp = getApps()[0];
    }
  } catch (err: any) {
    console.error("[Firebase Admin Download API Error]: Falha crítica na autenticação com chaves:", err.message);
  }
}

let adminStorage: any = null;
if (adminApp) {
  try {
    adminStorage = getStorage(adminApp);
    console.log("[Firebase Admin Download API]: Instância do Storage ativada via credenciais autorizadas.");
  } catch (storageInitErr: any) {
    console.error("[Firebase Admin Download API Storage Error]:", storageInitErr.message);
    adminStorage = null;
  }
}

export default async function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed. Use GET.");
  }

  // Bypass de Sandbox: Se o servidor estiver rodando no sandbox sem chaves, barra o download para prevenir erro de permissão 403 genérico
  if (isSandbox || !adminStorage) {
    return res.status(403).send("Acesso Negado (Ambiente Sandbox sem Credenciais Reais de Produção): O download de arquivos do Firebase Storage exige que o servidor esteja devidamente autenticado com as chaves FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY correspondentes às credenciais do seu projeto Firebase de produção.");
  }

  try {
    const { path: storagePath } = req.query;
    if (!storagePath) {
      return res.status(400).send("O parâmetro 'path' é obrigatório.");
    }

    // Extração de userId do storagePath para validação de segurança
    const pathParts = String(storagePath).split('/');
    let ownerId = "";
    if (pathParts[0] === "usuarios" && pathParts[1]) {
      ownerId = pathParts[1];
    }

    // Validação de segurança simples: se houver usuário autenticado no req.user ou headers/queries
    const requesterId = req.user?.uid || req.headers["x-user-id"] || req.query.requesterId;
    if (ownerId && requesterId && ownerId !== requesterId) {
      return res.status(403).send("Acesso Negado: Você não tem permissão para acessar os documentos de outro usuário.");
    }

    if (!adminStorage) {
      return res.status(500).send("Serviço de Storage não está configurado ou ativo no servidor.");
    }

    const bucketName = firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app";
    const bucket = adminStorage.bucket(bucketName);
    const fileRef = bucket.file(String(storagePath));
    
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).send("Documento não encontrado no Storage.");
    }

    const [metadata] = await fileRef.getMetadata();
    const fileName = String(storagePath).split('/').pop() || 'documento';
    res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    // Stream download direct to user
    const stream = fileRef.createReadStream();
    return new Promise((resolve, reject) => {
      stream.on("error", (err: any) => {
        console.error("Stream reader error:", err);
        reject(err);
      });
      res.on("finish", resolve);
      stream.pipe(res);
    });
  } catch (err: any) {
    console.error("[Serverless PDF Download Error]:", err.message);
    return res.status(500).send(`Erro ao processar download do documento: ${err.message}`);
  }
}

'@
Set-Content -Path "api\documentos\download.ts" -Value $content_16 -Encoding UTF8
Write-Host "Atualizado: api/documentos/download.ts"

$content_21 = @'
// Fonte única de verdade para os valores cobrados (mesma referência usada em
// /api/checkout.ts, /api/mercadopago/checkout.ts e /api/mercadopago/webhook.ts).
const PREMIUM_PRICING = {
  monthly: 14.0,
  annual: 14.0 * 12, // 168.00 — cobrança única equivalente a 12 meses
};

export default function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET." });
  }

  res.status(200).json({
    success: true,
    currency: "BRL",
    monthly: PREMIUM_PRICING.monthly,
    annual: PREMIUM_PRICING.annual,
    annualMonthlyEquivalent: Number((PREMIUM_PRICING.annual / 12).toFixed(2))
  });
}

'@
Set-Content -Path "api\plans\pricing.ts" -Value $content_22 -Encoding UTF8
Write-Host "Atualizado: api/plans/pricing.ts"

$content_27 = @'
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in status API:", err);
    }
  }
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return process.env.GOOGLE_CLOUD_PROJECT;
  }
  return "mei-flow-692d9"; // fallback
};

const getFirebaseDatabaseId = () => {
  // CONFIRMADO: o banco Firestore em uso é o "(default)". O firestoreDatabaseId
  // do AI Studio aponta para um banco nomeado secundário, não utilizado.
  if (process.env.FIREBASE_DATABASE_ID) {
    return process.env.FIREBASE_DATABASE_ID;
  }
  return "(default)";
};

let adminApp: any = null;
try {
  if (getApps().length === 0) {
    const projId = getFirebaseProjectId();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projId && clientEmail && privateKey) {
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
      adminApp = initializeApp({
        credential: cert({
          projectId: projId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey,
        })
      });
      console.log(`[Firebase Admin Status]: Initialized securely with service account certification for projectId: ${projId}`);
    } else if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Status]: Initialized securely with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Status]: Initialized with generic ADC");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin Status Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Status]: Connected to Firestore database ID: ${dbId}`);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin MP Status Init Warning]: Failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
}

// Format error logger
const sanitizeDBError = (err: any): string => {
  const msg = err.message || JSON.stringify(err);
  if (msg.includes("PERMISSION_DENIED")) {
    return "ACCESS_RESTRICTED: Insufficient permissions to execute the operation.";
  }
  return msg;
};

// Helper inside status to process live promotion on verified approvals
async function upgradeToPremium(userId: string, paymentId: string, billingCycle: "monthly" | "annual" = "monthly") {
  if (!db) return;
  try {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + (billingCycle === "annual" ? 365 : 30));
    const syncUpdate = {
      plan: "premium",
      planType: "premium",
      status: "active",
      premiumUntil: expirationDate.toISOString(),
      mercadoPagoStatus: "approved",
      mercadoPagoPaymentId: paymentId,
      updatedAt: new Date().toISOString()
    };
    await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
    await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
    console.log(`[Status User API]: Successfully verified payment and promoted userId ${userId} to premium.`);
  } catch (err) {
    console.error("[Status User API Promotion Error]:", err);
  }
}

export default async function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET." });
  }

  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required for status query." });
  }

  try {
    // 1. Check if user already has premium plan in Firestore database
    if (db) {
      try {
        const uDocRef = db.collection("users").doc(userId);
        const uDoc = await uDocRef.get();
        if (uDoc.exists) {
          const data = uDoc.data() || {};
          const itemPlanType = data.planType || "free";
          const itemPlan = data.plan || data.planType || "free";
          const itemStatus = data.status || "inactive";
          const isPremium = (itemPlanType === "premium" || itemPlan === "premium" || itemStatus === "active" || data.isPremium === true);

          // EXPIRAÇÃO AUTOMÁTICA: se o premium já passou da data de validade
          // (premiumUntil) sem renovação confirmada, reverte para "free" aqui
          // mesmo. Cobre o caso do Pix, que não renova sozinho.
          if (isPremium && data.premiumUntil) {
            const isExpired = new Date(data.premiumUntil).getTime() < Date.now();
            if (isExpired) {
              const downgradeUpdate = {
                planType: "free",
                plan: "free",
                status: "inactive",
                updatedAt: new Date().toISOString()
              };
              console.log(`[Status API AUTO-DOWNGRADE]: Premium do usuário ${userId} expirou em ${data.premiumUntil}.`);
              await uDocRef.set(downgradeUpdate, { merge: true });
              try {
                await db.collection("usuarios").doc(userId).set(downgradeUpdate, { merge: true });
              } catch {
                // segue mesmo se a coleção legada falhar
              }
              return res.status(200).json({
                success: true,
                isPremium: false,
                planType: "free",
                status: "expired"
              });
            }
          }

          if (isPremium) {
            return res.status(200).json({
              success: true,
              isPremium: true,
              planType: "premium",
              status: "approved"
            });
          }
        }
      } catch (dbErr: any) {
        const errorMsg = sanitizeDBError(dbErr);
        console.warn(`[Status API Firestore Quick-Check Bypassed]: ${errorMsg}`);
        // If it's a restricted or structural block from the environment, treat as pending wait
        if (errorMsg.includes("ACCESS_RESTRICTED") || errorMsg.includes("PERMISSION_DENIED")) {
          return res.status(200).json({
            success: true,
            isPremium: false,
            planType: "free",
            status: "pending",
            message: "Aguardando confirmação do banco"
          });
        }
      }
    }

    // 2. Fetch payment ID registered in Firestore
    let paymentId = "";
    if (db) {
      try {
        const uDoc = await db.collection("users").doc(userId).get();
        if (uDoc.exists) {
          paymentId = uDoc.data()?.mercadoPagoPaymentId || "";
        }
      } catch (getErr: any) {
        const errorMsg = sanitizeDBError(getErr);
        console.warn("[Status API Firestore error reading paymentId]:", errorMsg);
        if (errorMsg.includes("ACCESS_RESTRICTED") || errorMsg.includes("PERMISSION_DENIED")) {
          return res.status(200).json({
            success: true,
            isPremium: false,
            planType: "free",
            status: "pending",
            message: "Aguardando confirmação do banco"
          });
        }
      }
    }

    const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

    let isApprovedOnMP = false;
    let currentMPStatus = "pending";

    // 3. Query Mercado Pago by Payment ID
    if (mpToken && paymentId) {
      try {
        const payResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { "Authorization": `Bearer ${mpToken}` }
        });
        if (payResp.ok) {
          const payData: any = await payResp.json();
          currentMPStatus = payData.status || "pending";
          if (currentMPStatus === "approved") {
            isApprovedOnMP = true;
          }
        }
      } catch (fetchErr: any) {
        console.warn(`[Status API]: Failed checking payment ID ${paymentId}:`, fetchErr.message);
      }
    }

    // 4. Fallback search by external_reference (userId) if paymentId can't be resolved or API failed
    if (mpToken && !isApprovedOnMP) {
      try {
        const searchResp = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(userId)}`, {
          headers: { "Authorization": `Bearer ${mpToken}` }
        });
        if (searchResp.ok) {
          const searchData: any = await searchResp.json();
          const results = searchData.results || [];
          
          const approvedPayment = results.find((p: any) => p.status === "approved");
          if (approvedPayment) {
            paymentId = String(approvedPayment.id);
            isApprovedOnMP = true;
            currentMPStatus = "approved";
          } else {
            const pendingPayment = results.find((p: any) => p.status === "pending" || p.status === "in_process");
            if (pendingPayment) {
              currentMPStatus = pendingPayment.status;
            }
          }
        }
      } catch (searchErr: any) {
        console.warn("[Status API Search Fallback Error]:", searchErr.message);
      }
    }

    // 5. Update user to Premium if approved
    if (isApprovedOnMP) {
      try {
        let billingCycle: "monthly" | "annual" = "monthly";
        if (db) {
          try {
            const existingDoc = await db.collection("users").doc(userId).get();
            if (existingDoc.exists && existingDoc.data()?.billingCycle === "annual") {
              billingCycle = "annual";
            }
          } catch {
            // assume mensal se não conseguir ler
          }
        }
        await upgradeToPremium(userId, paymentId, billingCycle);
      } catch (updErr: any) {
        const errorMsg = sanitizeDBError(updErr);
        console.warn("[Status API Promotion Error caught gracefully]:", errorMsg);
        if (errorMsg.includes("ACCESS_RESTRICTED") || errorMsg.includes("PERMISSION_DENIED")) {
          // Keep loop waiting with status pending
          return res.status(200).json({
            success: true,
            isPremium: false,
            planType: "free",
            status: "pending",
            message: "Aguardando confirmação do banco"
          });
        }
      }
    }

    // 6. Return standard representation
    return res.status(200).json({
      success: true,
      isPremium: isApprovedOnMP,
      planType: isApprovedOnMP ? "premium" : "free",
      status: isApprovedOnMP ? "approved" : currentMPStatus
    });

  } catch (err: any) {
    const errorMsg = sanitizeDBError(err);
    console.warn("[Status API Graceful Recovery]:", errorMsg);
    // Guarantee returning a standard pending/waiting state under any error/contingency/ACCESS_RESTRICTED
    return res.status(200).json({
      success: true,
      isPremium: false,
      planType: "free",
      status: "pending",
      message: "Aguardando confirmação do banco"
    });
  }
}

'@
Set-Content -Path "api\user\status.ts" -Value $content_28 -Encoding UTF8
Write-Host "Atualizado: api/user/status.ts"

$content_33 = @'
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in check-expiration API:", err);
    }
  }
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return process.env.GOOGLE_CLOUD_PROJECT;
  }
  return "mei-flow-692d9"; // fallback
};

const getFirebaseDatabaseId = () => {
  // CONFIRMADO: o banco Firestore em uso é o "(default)".
  if (process.env.FIREBASE_DATABASE_ID) {
    return process.env.FIREBASE_DATABASE_ID;
  }
  return "(default)";
};

let adminApp: any = null;
try {
  if (getApps().length === 0) {
    const projId = getFirebaseProjectId();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projId && clientEmail && privateKey) {
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
      adminApp = initializeApp({
        credential: cert({
          projectId: projId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey,
        })
      });
    } else if (projId) {
      adminApp = initializeApp({ projectId: projId });
    } else {
      adminApp = initializeApp();
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin Check-Expiration Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin Check-Expiration Init Warning]:", dbInitErr.message);
    db = null;
  }
}

// ==========================================
// EXPIRAÇÃO LEVE: chamada uma vez ao carregar o app (ex: junto do
// onAuthStateChanged), garantindo que o downgrade de premium expirado
// (pagamentos Pix sem renovação automática) aconteça mesmo sem o usuário
// passar pelo fluxo de checkout/polling. Não consulta a API do Mercado
// Pago — só confere a data salva no Firestore (rápido e barato).
// ==========================================
export default async function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET." });
  }

  const userId = req.query?.userId as string;
  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required." });
  }

  if (!db || userId === "user_49281") {
    return res.json({ success: true, planType: "free", expired: false });
  }

  try {
    const docRef = db.collection("users").doc(String(userId));
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.json({ success: true, planType: "free", expired: false });
    }

    const data = docSnap.data() || {};
    const itemPlanType = data.planType || "free";
    const itemPlan = data.plan || data.planType || "free";
    const itemStatus = data.status || "inactive";
    const isPremiumNow = (itemPlanType === "premium" || itemPlan === "premium" || itemStatus === "active" || data.isPremium === true);

    if (isPremiumNow && data.premiumUntil) {
      const isExpired = new Date(data.premiumUntil).getTime() < Date.now();
      if (isExpired) {
        const downgradeUpdate = {
          planType: "free",
          plan: "free",
          status: "inactive",
          updatedAt: new Date().toISOString()
        };
        console.log(`[Check-Expiration AUTO-DOWNGRADE]: Premium do usuário ${userId} expirou em ${data.premiumUntil}.`);
        await docRef.set(downgradeUpdate, { merge: true });
        try {
          await db.collection("usuarios").doc(String(userId)).set(downgradeUpdate, { merge: true });
        } catch {
          // segue mesmo se a coleção legada falhar
        }
        return res.json({ success: true, planType: "free", expired: true });
      }
    }

    return res.json({ success: true, planType: isPremiumNow ? "premium" : "free", expired: false });
  } catch (err: any) {
    console.warn("[Check-Expiration API Error]:", err.message);
    return res.json({ success: true, planType: "free", expired: false });
  }
}

'@
Set-Content -Path "api\user\check-expiration.ts" -Value $content_34 -Encoding UTF8
Write-Host "Atualizado: api/user/check-expiration.ts"

$content_39 = @'
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";

// Fonte única de verdade para os valores cobrados (mesma referência usada em
// /api/mercadopago/checkout.ts e /api/plans/pricing.ts).
const PREMIUM_PRICING = {
  monthly: 14.0,
  annual: 14.0 * 12, // 168.00 — cobrança única equivalente a 12 meses
};

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in checkout API:", err);
    }
  }
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return process.env.GOOGLE_CLOUD_PROJECT;
  }
  return "mei-flow-692d9"; // fallback
};

const getFirebaseDatabaseId = () => {
  // CONFIRMADO: o banco Firestore em uso é o "(default)". O firestoreDatabaseId
  // do AI Studio aponta para um banco nomeado secundário, não utilizado.
  if (process.env.FIREBASE_DATABASE_ID) {
    return process.env.FIREBASE_DATABASE_ID;
  }
  return "(default)";
};

let adminApp: any = null;
try {
  if (getApps().length === 0) {
    const projId = getFirebaseProjectId();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projId && clientEmail && privateKey) {
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
      adminApp = initializeApp({
        credential: cert({
          projectId: projId,
          clientEmail: clientEmail,
          privateKey: formattedPrivateKey,
        })
      });
      console.log(`[Firebase Admin Checkout]: Initialized securely with service account certification for projectId: ${projId}`);
    } else if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Checkout]: Initialized securely with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Checkout]: Initialized with generic ADC");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin MP Checkout Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Checkout]: Connected to Firestore database ID: ${dbId}`);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin MP Checkout Init Warning]: Failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
}

export function getPaymentMethodId(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, "");
  if (clean.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(clean)) return "master";
  if (/^(34|37)/.test(clean)) return "amex";
  if (/^(4011|4389|5041|5067|5090|6278|6363|6362)/.test(clean)) return "elo";
  if (/^(3841|6062|60)/.test(clean)) return "hipercard";
  if (/^(6011|622|64|65)/.test(clean)) return "discover";
  if (/^(30[0-5]|36|38)/.test(clean)) return "diners";
  return "master"; // default fallback
}

// Helper to trigger Focus NFe on immediate card approvals
async function handleApprovedUpgrade(userId: string, existingProfile: any, transactionAmount: number, planDescription: string) {
  if (!db) return;
  try {
    console.log(`[MP Checkout Approved Helper]: Triggering Focus NFe for user ${userId}`);
    const tokenToUse = process.env.FOCUS_NFE_KEY || "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w";
    const focusAuthHeader = "Basic " + Buffer.from(`${tokenToUse}:`).toString("base64");
    
    const focusRef = `premium_${userId}_${Date.now()}`;
    const randomRps = Math.floor(100000 + Math.random() * 900000).toString();

    const docToEmit = (existingProfile?.cnpjPrestador || existingProfile?.cnpj || "").replace(/\D/g, "");
    const cleanEmail = existingProfile?.email || "tomador@meiflow.com";
    const cleanName = existingProfile?.name || existingProfile?.meiName || "Assinante MEI Flow";

    const tomadorBody: any = {};
    if (docToEmit.length === 14) {
      tomadorBody.cnpj = docToEmit;
    } else if (docToEmit.length === 11) {
      tomadorBody.cpf = docToEmit;
    } else {
      tomadorBody.cnpj = "4483719000183";
    }

    const focusNfePayload = {
      cnpj_prestador: "4483719000183",
      ref: focusRef,
      numero_rps: randomRps,
      serie_rps: "1",
      tipo_rps: "1",
      valor_servicos: transactionAmount,
      tomador: {
        ...tomadorBody,
        razao_social: cleanName,
        email: cleanEmail,
      },
      servico: {
        aliquota: 0,
        discriminacao: `${planDescription} - Faturamento Integrado. Referente ao pagamento aprovado de R$ ${transactionAmount.toFixed(2)}.`,
        codigo_municipio: "3550308",
        item_lista_servico: "01.01"
      }
    };

    const isFocusTest = !process.env.FOCUS_NFE_KEY || 
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("test") || 
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("homolog") || 
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("development") ||
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("sandbox");
    const focusUrl = isFocusTest ? "https://homologacao.focusnfe.com.br/v2/nfse" : "https://api.focusnfe.com.br/v2/nfse";
    
    const focusResponse = await axios.post(focusUrl, focusNfePayload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": focusAuthHeader
      },
      timeout: 10000
    });

    if (focusResponse.status === 201 || focusResponse.status === 200) {
      console.log(`[MP Checkout Approved Helper Success]: Invoice processing ref: ${focusRef}`);
      await db.collection("users").doc(userId).set({
        premiumInvoiceRef: focusRef,
        premiumInvoiceStatus: "processando_autorizacao",
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (focusErr: any) {
    console.error("[MP Checkout Approved Helper FocusNFe Error]:", focusErr.response?.data?.mensagem || focusErr.message);
  }
}

export default async function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      publicKey: process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "",
      integratorId: process.env.MERCADO_PAGO_INTEGRATOR_ID || ""
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
  }

  try {
    const {
      userId,
      name,
      cpfCnpj,
      documentNumber,
      email,
      paymentMethod,
      creditCard,
      billingCycle
    } = req.body;

    const cycle: "monthly" | "annual" = billingCycle === "annual" ? "annual" : "monthly";
    const transactionAmount = cycle === "annual" ? PREMIUM_PRICING.annual : PREMIUM_PRICING.monthly;
    const planDescription = cycle === "annual"
      ? "Plano Premium MEI Flow - Pacote Anual (12 meses)"
      : "Plano Premium MEI Flow - Mensal";

    if (!userId || !email) {
      res.status(400).json({ success: false, mensagem: "Parâmetros obrigatórios ausentes: userId e email são obrigatórios." });
      return;
    }

    const docRaw = (documentNumber || cpfCnpj || "");
    const cleanDoc = docRaw.replace(/\D/g, "");

    if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
      res.status(400).json({
        success: false,
        mensagem: `Documento CPF ou CNPJ inválido (${docRaw}). Certifique-se de digitar 11 dígitos para CPF ou 14 dígitos para CNPJ.`
      });
      return;
    }

    const docType = cleanDoc.length === 11 ? "CPF" : "CNPJ";

    const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

    if (!mpToken) {
      res.status(500).json({
        success: false,
        mensagem: "Erro de Servidor: Credencial de Produção MERCADO_PAGO_ACCESS_TOKEN não configurada no ambiente."
      });
      return;
    }

    const sysIntegrator = process.env.MERCADO_PAGO_INTEGRATOR_ID;
    const integratorId = (sysIntegrator || "").replace(/^["']|["']$/g, "").trim();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${mpToken}`,
      "X-Idempotency-Key": `chk_s_${userId}_${Date.now()}`
    };

    if (integratorId) {
      headers["X-Integrator-Id"] = integratorId;
    }

    let dbProfile: any = {};
    if (db) {
      try {
        const uDoc = await db.collection("users").doc(userId).get();
        if (uDoc.exists) {
          dbProfile = uDoc.data();
        }
      } catch (dbReadErr: any) {
        console.error("Error reading user doc during checkout:", dbReadErr.message);
      }
    }

    if (paymentMethod === "PIX") {
      const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
      const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

      const pixPayload = {
        transaction_amount: transactionAmount,
        description: `${planDescription} - Pix`,
        payment_method_id: "pix",
        payer: {
          email: email.trim(),
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[MP Checkout Serverless Pix]: Sending payout creation to MP via fetch`);
      const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(pixPayload)
      });

      const paymentData: any = await mpResponse.json();

      if (!mpResponse.ok) {
        const errorMsg = paymentData.message || JSON.stringify(paymentData);
        console.error(`[MP Checkout Serverless Pix Error]: ${errorMsg}`);
        res.status(mpResponse.status).json({
          success: false,
          mensagem: `Mercado Pago: ${errorMsg}`
        });
        return;
      }

      const paymentId = paymentData.id;

      // Sync with Firestore
      if (db) {
        try {
          const syncUpdate = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType: paymentData.status === "approved" ? "premium" : "free",
            billingCycle: cycle,
            paymentMethod: "PIX",
            updatedAt: new Date().toISOString()
          };
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
          
          if (paymentData.status === "approved") {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
          }
        } catch (dbErr: any) {
          console.warn("[MP Checkout API DB Sync Warning (Pix)]:", dbErr.message);
        }
      }

      const pointOfInteraction = paymentData.point_of_interaction;
      const transactionData = pointOfInteraction?.transaction_data;
      const qrCodeImage = transactionData?.qr_code_base64 || "";
      const qrCodePayload = transactionData?.qr_code || "";

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType: paymentData.status === "approved" ? "premium" : "free",
        qrCodeBase64: qrCodeImage,
        qrCode: qrCodePayload,
        pixQrCode: {
          encodedImage: qrCodeImage,
          payload: qrCodePayload
        }
      });
    }

    if (paymentMethod === "CREDIT_CARD") {
      if (!creditCard) {
        return res.status(400).json({ success: false, mensagem: "Parâmetros de cartão de crédito ausentes no payload." });
      }

      const cardTokenPayload = {
        card_number: creditCard.number.replace(/\s/g, ""),
        expiration_month: String(creditCard.expiryMonth),
        expiration_year: String(creditCard.expiryYear),
        security_code: creditCard.ccv,
        cardholder: {
          name: creditCard.holderName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        }
      };

      console.log(`[Checkout Native Fetch CC Serverless]: Tokenizing card via fetch...`);
      const tokenResponse = await fetch("https://api.mercadopago.com/v1/card_tokens", {
        method: "POST",
        headers,
        body: JSON.stringify(cardTokenPayload)
      });

      const tokenData: any = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("[Checkout Native Fetch CC Token Serverless Error]:", tokenData);
        const errDetails = tokenData.message || "Verifique os dados informados.";
        return res.status(400).json({
          success: false,
          mensagem: `Mercado Pago (Cartão recusado/inválido): ${errDetails}`
        });
      }

      const cardTokenId = tokenData.id;
      const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
      const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

      // CICLO MENSAL: cria assinatura recorrente real (Preapproval). O Mercado
      // Pago cobra automaticamente todo mês no cartão, sem ação do usuário.
      if (cycle === "monthly") {
        const preapprovalPayload = {
          reason: planDescription,
          external_reference: userId,
          payer_email: email.trim(),
          card_token_id: cardTokenId,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: transactionAmount,
            currency_id: "BRL"
          },
          back_url: "https://mei-flow-flax.vercel.app",
          notification_url: "https://mei-flow-flax.vercel.app/api/mercadopago/webhook",
          status: "authorized"
        };

        console.log(`[Checkout Native Fetch CC Serverless]: Criando assinatura (Preapproval) recorrente mensal...`);
        const preapprovalResp = await fetch("https://api.mercadopago.com/preapproval", {
          method: "POST",
          headers,
          body: JSON.stringify(preapprovalPayload)
        });

        const preapprovalData: any = await preapprovalResp.json();

        if (!preapprovalResp.ok) {
          const errorMsg = preapprovalData.message || JSON.stringify(preapprovalData);
          console.error(`[Checkout Native Fetch CC Preapproval Serverless Error]: ${errorMsg}`);
          return res.status(preapprovalResp.status).json({
            success: false,
            mensagem: `Mercado Pago (Assinatura): ${errorMsg}`
          });
        }

        const preapprovalId = preapprovalData.id;
        const preapprovalStatus = preapprovalData.status;
        const isAuthorized = preapprovalStatus === "authorized";
        const planType: "free" | "premium" = isAuthorized ? "premium" : "free";

        if (db) {
          try {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + 30);
            const syncUpdate: any = {
              mercadoPagoPreapprovalId: preapprovalId,
              mercadoPagoStatus: preapprovalStatus,
              planType,
              billingCycle: "monthly",
              paymentMethod: "CREDIT_CARD",
              subscriptionType: "recurring",
              updatedAt: new Date().toISOString()
            };
            if (isAuthorized) {
              syncUpdate.premiumUntil = expirationDate.toISOString();
            }
            await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

            if (isAuthorized) {
              await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
            }
          } catch (dbErr: any) {
            console.warn("[Checkout Native Fetch CC Preapproval DB Sync Serverless Warning]:", dbErr.message);
          }
        }

        if (!isAuthorized) {
          return res.status(400).json({
            success: false,
            mensagem: `Assinatura não autorizada pelo Mercado Pago (status: ${preapprovalStatus}).`
          });
        }

        return res.status(200).json({
          success: true,
          preapprovalId,
          status: preapprovalStatus,
          planType,
          subscriptionType: "recurring"
        });
      }

      // CICLO ANUAL: cobrança única (12 meses pagos de uma vez), sem assinatura.
      const detectedBrand = getPaymentMethodId(creditCard.number);

      const cardPayload = {
        token: cardTokenId,
        transaction_amount: transactionAmount,
        description: planDescription,
        installments: 1,
        payment_method_id: detectedBrand,
        payer: {
          email: email.trim(),
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[Checkout Native Fetch CC Serverless]: Creating annual one-time payment via fetch...`);
      const mpPaymentResp = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(cardPayload)
      });

      const paymentData: any = await mpPaymentResp.json();

      if (!mpPaymentResp.ok) {
        const errorMsg = paymentData.message || JSON.stringify(paymentData);
        console.error(`[Checkout Native Fetch CC Payment Serverless Error]: ${errorMsg}`);
        return res.status(mpPaymentResp.status).json({
          success: false,
          mensagem: `Mercado Pago: ${errorMsg}`
        });
      }

      const isApproved = paymentData.status === "approved";
      const paymentId = paymentData.id;

      let planType: "free" | "premium" = "free";
      if (isApproved) {
        planType = "premium";
      }

      if (db) {
        try {
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 365);
          const syncUpdate: any = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType,
            billingCycle: "annual",
            paymentMethod: "CREDIT_CARD",
            subscriptionType: "one_time",
            updatedAt: new Date().toISOString()
          };
          if (isApproved) {
            syncUpdate.premiumUntil = expirationDate.toISOString();
          }
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

          if (isApproved) {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
          }
        } catch (dbErr: any) {
          console.warn("[Checkout Native Fetch CC DB Sync Serverless Warning]: Database sync skipped", dbErr.message);
        }
      }

      if (paymentData.status === "rejected") {
        const rejectDetail = paymentData.status_detail || "Pagamento rejeitado pelo emissor.";
        return res.status(400).json({
          success: false,
          mensagem: `Transação Recusada (Mercado Pago): ${rejectDetail}.`
        });
      }

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType,
        subscriptionType: "one_time"
      });
    }

    res.status(400).json({ success: false, mensagem: "Forma de pagamento não suportada pelo checkout." });
  } catch (err: any) {
    console.error("[MP Checkout API Server Error]:", err.message);
    res.status(400).json({ success: false, mensagem: `Erro na integração com Mercado Pago: ${err.message}` });
  }
}

'@
Set-Content -Path "api\checkout.ts" -Value $content_40 -Encoding UTF8
Write-Host "Atualizado: api/checkout.ts"

$content_45 = @'
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";

// Fonte única de verdade para os valores cobrados (mesma referência usada em
// /api/checkout.ts e /api/plans/pricing.ts).
const PREMIUM_PRICING = {
  monthly: 14.0,
  annual: 14.0 * 12, // 168.00 — cobrança única equivalente a 12 meses
};

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in checkout API:", err);
    }
  }
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return process.env.GOOGLE_CLOUD_PROJECT;
  }
  return "mei-flow-692d9"; // fallback
};

const getFirebaseDatabaseId = () => {
  // CONFIRMADO: o banco Firestore em uso é o "(default)". O firestoreDatabaseId
  // do AI Studio aponta para um banco nomeado secundário, não utilizado.
  if (process.env.FIREBASE_DATABASE_ID) {
    return process.env.FIREBASE_DATABASE_ID;
  }
  return "(default)";
};

let adminApp: any = null;
try {
  if (getApps().length === 0) {
    const projId = getFirebaseProjectId();
    if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Checkout]: Initialized securely with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Checkout]: Initialized with generic ADC (no config projectId found)");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin MP Checkout Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Checkout]: Connected to Firestore database ID: ${dbId}`);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin MP Checkout Init Warning]: Failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
}

export function getPaymentMethodId(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, "");
  if (clean.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(clean)) return "master";
  if (/^(34|37)/.test(clean)) return "amex";
  if (/^(4011|4389|5041|5067|5090|6278|6363|6362)/.test(clean)) return "elo";
  if (/^(3841|6062|60)/.test(clean)) return "hipercard";
  if (/^(6011|622|64|65)/.test(clean)) return "discover";
  if (/^(30[0-5]|36|38)/.test(clean)) return "diners";
  return "master"; // default fallback
}

// Helper to trigger Focus NFe on immediate card approvals
async function handleApprovedUpgrade(userId: string, existingProfile: any, transactionAmount: number, planDescription: string) {
  if (!db) return;
  try {
    console.log(`[MP Checkout Approved Helper]: Triggering Focus NFe for user ${userId}`);
    const tokenToUse = process.env.FOCUS_NFE_KEY || "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w";
    const focusAuthHeader = "Basic " + Buffer.from(`${tokenToUse}:`).toString("base64");
    
    const focusRef = `premium_${userId}_${Date.now()}`;
    const randomRps = Math.floor(100000 + Math.random() * 900000).toString();

    const docToEmit = (existingProfile?.cnpjPrestador || existingProfile?.cnpj || "").replace(/\D/g, "");
    const cleanEmail = existingProfile?.email || "tomador@meiflow.com";
    const cleanName = existingProfile?.name || existingProfile?.meiName || "Assinante MEI Flow";

    const tomadorBody: any = {};
    if (docToEmit.length === 14) {
      tomadorBody.cnpj = docToEmit;
    } else if (docToEmit.length === 11) {
      tomadorBody.cpf = docToEmit;
    } else {
      tomadorBody.cnpj = "4483719000183";
    }

    const focusNfePayload = {
      cnpj_prestador: "4483719000183",
      ref: focusRef,
      numero_rps: randomRps,
      serie_rps: "1",
      tipo_rps: "1",
      valor_servicos: transactionAmount,
      tomador: {
        ...tomadorBody,
        razao_social: cleanName,
        email: cleanEmail,
      },
      servico: {
        aliquota: 0,
        discriminacao: `${planDescription} - Faturamento Integrado. Referente ao pagamento aprovado de R$ ${transactionAmount.toFixed(2)}.`,
        codigo_municipio: "3550308",
        item_lista_servico: "01.01"
      }
    };

    const isFocusTest = !process.env.FOCUS_NFE_KEY || 
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("test") || 
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("homolog") || 
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("development") ||
                        process.env.FOCUS_NFE_KEY.toLowerCase().includes("sandbox");
    const focusUrl = isFocusTest ? "https://homologacao.focusnfe.com.br/v2/nfse" : "https://api.focusnfe.com.br/v2/nfse";
    
    const focusResponse = await axios.post(focusUrl, focusNfePayload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": focusAuthHeader
      },
      timeout: 10000
    });

    if (focusResponse.status === 201 || focusResponse.status === 200) {
      console.log(`[MP Checkout Approved Helper Success]: Invoice processing ref: ${focusRef}`);
      await db.collection("users").doc(userId).set({
        premiumInvoiceRef: focusRef,
        premiumInvoiceStatus: "processando_autorizacao",
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (focusErr: any) {
    console.error("[MP Checkout Approved Helper FocusNFe Error]:", focusErr.response?.data?.mensagem || focusErr.message);
  }
}

export default async function handler(req: any, res: any) {
  // CORS: necessário para o app empacotado como APK (Capacitor), que chama
  // a API a partir da origem fixa "https://localhost".
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      publicKey: process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "",
      integratorId: process.env.MERCADO_PAGO_INTEGRATOR_ID || ""
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
  }

  try {
    const {
      userId,
      name,
      cpfCnpj,
      documentNumber,
      email,
      paymentMethod,
      creditCard,
      billingCycle
    } = req.body;

    const cycle: "monthly" | "annual" = billingCycle === "annual" ? "annual" : "monthly";
    const transactionAmount = cycle === "annual" ? PREMIUM_PRICING.annual : PREMIUM_PRICING.monthly;
    const planDescription = cycle === "annual"
      ? "Plano Premium MEI Flow - Pacote Anual (12 meses)"
      : "Plano Premium MEI Flow - Mensal";

    if (!userId || !email) {
      res.status(400).json({ success: false, mensagem: "Parâmetros obrigatórios ausentes: userId e email são obrigatórios." });
      return;
    }

    const docRaw = (documentNumber || cpfCnpj || "");
    const cleanDoc = docRaw.replace(/\D/g, "");

    if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
      res.status(400).json({
        success: false,
        mensagem: `Documento CPF ou CNPJ inválido (${docRaw}). Certifique-se de digitar 11 dígitos para CPF ou 14 dígitos para CNPJ.`
      });
      return;
    }

    const docType = cleanDoc.length === 11 ? "CPF" : "CNPJ";

    const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

    if (!mpToken) {
      res.status(500).json({
        success: false,
        mensagem: "Erro de Servidor: Credencial de Produção MERCADO_PAGO_ACCESS_TOKEN não configurada no ambiente."
      });
      return;
    }

    const sysIntegrator = process.env.MERCADO_PAGO_INTEGRATOR_ID;
    const integratorId = (sysIntegrator || "").replace(/^["']|["']$/g, "").trim();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${mpToken}`,
      "X-Idempotency-Key": `chk_s_${userId}_${Date.now()}`
    };

    if (integratorId) {
      headers["X-Integrator-Id"] = integratorId;
    }

    let dbProfile: any = {};
    if (db) {
      try {
        const uDoc = await db.collection("users").doc(userId).get();
        if (uDoc.exists) {
          dbProfile = uDoc.data();
        }
      } catch (dbReadErr: any) {
        console.error("Error reading user doc during checkout:", dbReadErr.message);
      }
    }

    if (paymentMethod === "PIX") {
      const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
      const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

      const pixPayload = {
        transaction_amount: transactionAmount,
        description: `${planDescription} - Pix`,
        payment_method_id: "pix",
        payer: {
          email: email.trim(),
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[MP Checkout Serverless Pix]: Sending payout creation to MP via fetch`);
      const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(pixPayload)
      });

      const paymentData: any = await mpResponse.json();

      if (!mpResponse.ok) {
        const errorMsg = paymentData.message || JSON.stringify(paymentData);
        console.error(`[MP Checkout Serverless Pix Error]: ${errorMsg}`);
        res.status(mpResponse.status).json({
          success: false,
          mensagem: `Mercado Pago: ${errorMsg}`
        });
        return;
      }

      const paymentId = paymentData.id;

      // Sync with Firestore
      if (db) {
        try {
          const syncUpdate = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType: paymentData.status === "approved" ? "premium" : "free",
            billingCycle: cycle,
            paymentMethod: "PIX",
            updatedAt: new Date().toISOString()
          };
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
          
          if (paymentData.status === "approved") {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
          }
        } catch (dbErr: any) {
          console.warn("[MP Checkout API DB Sync Warning (Pix)]: Database sync skipped in backend due to sandbox credentials. Synchronization is safely delegated to client side.", dbErr.message);
        }
      }

      const pointOfInteraction = paymentData.point_of_interaction;
      const transactionData = pointOfInteraction?.transaction_data;
      const qrCodeImage = transactionData?.qr_code_base64 || "";
      const qrCodePayload = transactionData?.qr_code || "";

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType: paymentData.status === "approved" ? "premium" : "free",
        qrCodeBase64: qrCodeImage,
        qrCode: qrCodePayload,
        pixQrCode: {
          encodedImage: qrCodeImage,
          payload: qrCodePayload
        }
      });
    }

    if (paymentMethod === "CREDIT_CARD") {
      if (!creditCard) {
        return res.status(400).json({ success: false, mensagem: "Parâmetros de cartão de crédito ausentes no payload." });
      }

      const cardTokenPayload = {
        card_number: creditCard.number.replace(/\s/g, ""),
        expiration_month: String(creditCard.expiryMonth),
        expiration_year: String(creditCard.expiryYear),
        security_code: creditCard.ccv,
        cardholder: {
          name: creditCard.holderName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        }
      };

      console.log(`[Checkout Native Fetch CC Serverless]: Tokenizing card via fetch...`);
      const tokenResponse = await fetch("https://api.mercadopago.com/v1/card_tokens", {
        method: "POST",
        headers,
        body: JSON.stringify(cardTokenPayload)
      });

      const tokenData: any = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("[Checkout Native Fetch CC Token Serverless Error]:", tokenData);
        const errDetails = tokenData.message || "Verifique os dados informados.";
        return res.status(400).json({
          success: false,
          mensagem: `Mercado Pago (Cartão recusado/inválido): ${errDetails}`
        });
      }

      const cardTokenId = tokenData.id;
      const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
      const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

      // CICLO MENSAL: cria assinatura recorrente real (Preapproval). O Mercado
      // Pago cobra automaticamente todo mês no cartão, sem ação do usuário.
      if (cycle === "monthly") {
        const preapprovalPayload = {
          reason: planDescription,
          external_reference: userId,
          payer_email: email.trim(),
          card_token_id: cardTokenId,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: transactionAmount,
            currency_id: "BRL"
          },
          back_url: "https://mei-flow-flax.vercel.app",
          notification_url: "https://mei-flow-flax.vercel.app/api/mercadopago/webhook",
          status: "authorized"
        };

        console.log(`[Checkout Native Fetch CC Serverless]: Criando assinatura (Preapproval) recorrente mensal...`);
        const preapprovalResp = await fetch("https://api.mercadopago.com/preapproval", {
          method: "POST",
          headers,
          body: JSON.stringify(preapprovalPayload)
        });

        const preapprovalData: any = await preapprovalResp.json();

        if (!preapprovalResp.ok) {
          const errorMsg = preapprovalData.message || JSON.stringify(preapprovalData);
          console.error(`[Checkout Native Fetch CC Preapproval Serverless Error]: ${errorMsg}`);
          return res.status(preapprovalResp.status).json({
            success: false,
            mensagem: `Mercado Pago (Assinatura): ${errorMsg}`
          });
        }

        const preapprovalId = preapprovalData.id;
        const preapprovalStatus = preapprovalData.status;
        const isAuthorized = preapprovalStatus === "authorized";
        const planType: "free" | "premium" = isAuthorized ? "premium" : "free";

        if (db) {
          try {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + 30);
            const syncUpdate: any = {
              mercadoPagoPreapprovalId: preapprovalId,
              mercadoPagoStatus: preapprovalStatus,
              planType,
              billingCycle: "monthly",
              paymentMethod: "CREDIT_CARD",
              subscriptionType: "recurring",
              updatedAt: new Date().toISOString()
            };
            if (isAuthorized) {
              syncUpdate.premiumUntil = expirationDate.toISOString();
            }
            await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

            if (isAuthorized) {
              await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
            }
          } catch (dbErr: any) {
            console.warn("[Checkout Native Fetch CC Preapproval DB Sync Serverless Warning]:", dbErr.message);
          }
        }

        if (!isAuthorized) {
          return res.status(400).json({
            success: false,
            mensagem: `Assinatura não autorizada pelo Mercado Pago (status: ${preapprovalStatus}).`
          });
        }

        return res.status(200).json({
          success: true,
          preapprovalId,
          status: preapprovalStatus,
          planType,
          subscriptionType: "recurring"
        });
      }

      // CICLO ANUAL: cobrança única (12 meses pagos de uma vez), sem assinatura.
      const detectedBrand = getPaymentMethodId(creditCard.number);

      const cardPayload = {
        token: cardTokenId,
        transaction_amount: transactionAmount,
        description: planDescription,
        installments: 1,
        payment_method_id: detectedBrand,
        payer: {
          email: email.trim(),
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[Checkout Native Fetch CC Serverless]: Creating annual one-time payment via fetch...`);
      const mpPaymentResp = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(cardPayload)
      });

      const paymentData: any = await mpPaymentResp.json();

      if (!mpPaymentResp.ok) {
        const errorMsg = paymentData.message || JSON.stringify(paymentData);
        console.error(`[Checkout Native Fetch CC Payment Serverless Error]: ${errorMsg}`);
        return res.status(mpPaymentResp.status).json({
          success: false,
          mensagem: `Mercado Pago: ${errorMsg}`
        });
      }

      const isApproved = paymentData.status === "approved";
      const paymentId = paymentData.id;

      let planType: "free" | "premium" = "free";
      if (isApproved) {
        planType = "premium";
      }

      if (db) {
        try {
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 365);
          const syncUpdate: any = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType,
            billingCycle: "annual",
            paymentMethod: "CREDIT_CARD",
            subscriptionType: "one_time",
            updatedAt: new Date().toISOString()
          };
          if (isApproved) {
            syncUpdate.premiumUntil = expirationDate.toISOString();
          }
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

          if (isApproved) {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
          }
        } catch (dbErr: any) {
          console.warn("[Checkout Native Fetch CC DB Sync Serverless Warning]: Database sync skipped in backend due to sandbox credentials. Synchronization is safely delegated to client side.", dbErr.message);
        }
      }

      if (paymentData.status === "rejected") {
        const rejectDetail = paymentData.status_detail || "Pagamento rejeitado pelo emissor.";
        return res.status(400).json({
          success: false,
          mensagem: `Transação Recusada (Mercado Pago): ${rejectDetail}.`
        });
      }

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType,
        subscriptionType: "one_time"
      });
    }

    res.status(400).json({ success: false, mensagem: "Forma de pagamento não suportada pelo checkout." });
  } catch (err: any) {
    console.error("[MP Checkout API Server Error]:", err.message);
    res.status(400).json({ success: false, mensagem: `Erro na integração com Mercado Pago: ${err.message}` });
  }
}

'@
Set-Content -Path "api\mercadopago\checkout.ts" -Value $content_46 -Encoding UTF8
Write-Host "Atualizado: api/mercadopago/checkout.ts"
