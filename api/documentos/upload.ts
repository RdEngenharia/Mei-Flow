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
  const isVercelProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  if (isVercelProd) return "(default)";
  if (process.env.FIREBASE_DATABASE_ID) return process.env.FIREBASE_DATABASE_ID;
  if (firebaseConfig.firestoreDatabaseId) return firebaseConfig.firestoreDatabaseId;
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
        // Gravando de forma centralizada de acordo com a regra 4
        await db.collection("documentos_mei").doc(docId).set(metadataDoc);
        console.log(`[Firestore] Registro proativo gravado na coleção 'documentos_mei': ${docId}`);
      } catch (dbErr: any) {
        console.error("[Firestore Error] Erro ao gravar metadados na coleção raiz 'documentos_mei':", dbErr.message);
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
      // Gravando de forma centralizada de acordo com a regra 4
      await db.collection("documentos_mei").doc(docId).set(metadataDoc);
      console.log(`[Firestore] Registro gravado com sucesso na coleção 'documentos_mei': ${docId}`);
    } catch (dbErr: any) {
      console.error("[Firestore Error]: Falha ao gravar metadados na coleção raiz 'documentos_mei':", dbErr.message);
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
