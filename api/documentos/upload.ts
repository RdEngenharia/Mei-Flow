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
  return "mei-flow-692d9"; // Forçado fixo correto
};

const getFirebaseDatabaseId = () => {
  const isVercelProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  if (isVercelProd) return "(default)";
  if (process.env.FIREBASE_DATABASE_ID) return process.env.FIREBASE_DATABASE_ID;
  if (firebaseConfig.firestoreDatabaseId) return firebaseConfig.firestoreDatabaseId;
  return "(default)";
};

let adminApp: any = null;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;
const projId = "mei-flow-692d9"; // Forçado fixo conforme orientação da Vercel

// Bypass de Sandbox: Detecta se está rodando sob e-mail padrão do sandbox do AI Studio / sem chaves reais de produção
const isSandbox = !clientEmail || !privateKey || clientEmail.includes("ais-sandbox") || (clientEmail.includes("gserviceaccount.com") && !clientEmail.includes("mei-flow-692d9"));

if (isSandbox) {
  console.warn("[Firebase Admin Upload API WARNING]: Acesso ao ambiente real bloqueado. Nenhuma credencial de produção válida foi fornecida, ou o servidor está rodando sob a conta padrão de sandbox do AI Studio.");
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
        storageBucket: firebaseConfig.storageBucket || "mei-flow-692d9.appspot.com" // Forçado fixo correto com fallback robusto
      });
      console.log(`[Firebase Admin Upload API]: Inicializado com sucesso via chaves para o projeto de produção: ${projId}`);
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
    console.log("[Firebase Admin Upload API]: Instância do Storage ativada via credenciais autorizadas.");
  } catch (storageInitErr: any) {
    console.error("[Firebase Admin Upload API Storage Error]:", storageInitErr.message);
    adminStorage = null;
  }
}

// Ensure Vercel serverless function body size limit is handled correctly (default limit: 4.5MB for serverless functions, base64 is accepted)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  // Bypass de Sandbox: Se o servidor estiver rodando no sandbox sem chaves, barra o upload para prevenir erro de permissão 403 genérico
  if (isSandbox || !adminStorage || !db) {
    return res.status(403).json({
      success: false,
      message: "Acesso Negado (Ambiente Sandbox sem Credenciais Reais de Produção): O backend detectou que o servidor está rodando na infraestrutura sandbox do AI Studio (ais-sandbox). Para que os uploads e a persistência de documentos de faturamento funcionem com segurança no Firebase Storage do seu projeto, configure as variáveis de ambiente FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY nas configurações de variáveis do repositório/ambiente de execução."
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

    // 1. Tenta salvar no Firebase Storage copiando diretamente ou assinando
    if (!adminStorage) {
      throw new Error("O Firebase Admin Storage não foi inicializado corretamente no servidor para realizar o upload.");
    }

    // Tenta pegar do config, senão usa o ID do projeto com o sufixo padrão do Firebase
    const bucketName = firebaseConfig.storageBucket || "mei-flow-692d9.appspot.com";
    const bucket = adminStorage.bucket(bucketName);
    const fileRef = bucket.file(targetStoragePath);

    // Se solicitado, assina a requisição retornando uma URL para upload PUT direto
    if (getSignedUrl) {
      let uploadUrl = "";
      try {
        const [signedUrl] = await fileRef.getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, // 15 minutos
          contentType: finalType,
        });
        uploadUrl = signedUrl;
        console.log(`[Firebase Admin Storage Serverless] URL assinada gerada com sucesso para: ${targetStoragePath}`);
      } catch (signErr: any) {
        console.error("[Firebase Admin Storage Serverless Error] Falha de assinatura GCS:", signErr.message);
        throw new Error(`Falha ao assinar requisição de upload: ${signErr.message}`);
      }

      // De forma proativa, salva os metadados do arquivo que será enviado no Firestore
      if (!db) {
        throw new Error("O Firebase Admin Firestore não foi inicializado corretamente no servidor.");
      }

      const metadataDoc = {
        id: docId,
        nome: fileName,
        url: downloadUrl,
        ano: ano,
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
        await db.collection("documentos_mei").doc(docId).set(metadataDoc);
        console.log(`[Firestore Admin Serverless] Registro proativo gravado na raiz: documentos_mei/${docId}`);
      } catch (dbErr: any) {
        console.error("[Firestore Admin Serverless Error] Erro ao gravar metadados:", dbErr.message);
        throw new Error(`Erro ao salvar metadados: ${dbErr.message}`);
      }

      return res.status(200).json({
        success: true,
        uploadUrl,
        downloadUrl,
        document: metadataDoc,
        mensagem: "Upload autorizado e assinado por 15 minutos."
      });
    }

    // Fallback: Upload tradicional em Base64
    if (!actualFileBase64) {
      return res.status(400).json({ success: false, message: "Parâmetro fileBase64 ou fileData é obrigatório para upload direto clássico." });
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
        metadata: {
          contentType: finalType,
        },
      });
      console.log(`[Firebase Admin Storage Serverless] Arquivo salvo de contingência no path: ${targetStoragePath}`);
    } catch (storageErr: any) {
      console.error("[Firebase Admin Storage Serverless Error]: Falha ao salvar no bucket:", storageErr.message);
      throw new Error(`Erro ao persistir arquivo no Firebase Storage: ${storageErr.message}`);
    }

    // 2. Cria metadados e salva no Firestore para o upload tradicional
    if (!db) {
      throw new Error("O Firebase Admin Firestore não foi inicializado corretamente no servidor para gravar os metadados.");
    }

    const metadataDoc = {
      id: docId,
      nome: fileName,
      url: downloadUrl,
      ano: ano,
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
      await db.collection("documentos_mei").doc(docId).set(metadataDoc);
      console.log(`[Firestore Admin Serverless] Registro gravado com sucesso na raiz em: documentos_mei/${docId}`);
    } catch (dbErr: any) {
      console.error("[Firestore Admin Serverless Error]: Falha ao gravar metadados no Firestore:", dbErr.message);
      throw new Error(`Erro ao salvar metadados do documento no banco de dados Firestore: ${dbErr.message}`);
    }

    return res.status(200).json({
      success: true,
      document: metadataDoc,
      mensagem: "Documento salvo e publicado com sucesso no Firebase!"
    });
  } catch (err: any) {
    console.error("[Serverless PDF API Error]:", err.message);
    return res.status(500).json({ success: false, message: `Erro no upload do servidor: ${err.message}` });
  }
}
