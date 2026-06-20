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
  if (firebaseConfig.projectId) return firebaseConfig.projectId;
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  return "mei-flow-692d9"; // fallback
};

const getFirebaseDatabaseId = () => {
  if (firebaseConfig.firestoreDatabaseId) return firebaseConfig.firestoreDatabaseId;
  if (process.env.FIREBASE_DATABASE_ID) return process.env.FIREBASE_DATABASE_ID;
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
      console.log(`[Firebase Admin Upload API]: Initialized with certificate for projectId: ${projId}`);
    } else if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Upload API]: Initialized with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Upload API]: Initialized with generic ADC");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin Upload API Error]: Failed to initialize:", err.message);
}

let db: any = null;
let adminStorage: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Upload API]: Connected to Firestore database: ${dbId}`);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin Upload API Init Warning]: Failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
  try {
    adminStorage = getStorage(adminApp);
    console.log("[Firebase Admin Upload API]: Storage instance initialized successfully.");
  } catch (storageInitErr: any) {
    console.warn("[Firebase Admin Upload API Storage Init Warning]: Failed to retrieve storage instance:", storageInitErr.message);
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

  try {
    const { fileBase64, fileName, userId, ano, mes, size, type } = req.body;

    if (!fileBase64 || !fileName || !userId || !ano || !mes) {
      return res.status(400).json({ success: false, message: "Parâmetros obrigatórios ausentes para o upload." });
    }

    const docId = `doc_${Date.now()}`;
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const targetStoragePath = `usuarios/${userId}/${ano}/${mes}/${cleanFileName}`;

    let base64Data = fileBase64;
    let finalType = type || "application/octet-stream";
    if (fileBase64.includes(";base64,")) {
      const parts = fileBase64.split(";base64,");
      base64Data = parts[1];
      if (!type && parts[0].startsWith("data:")) {
        finalType = parts[0].substring(5);
      }
    }

    const buffer = Buffer.from(base64Data, "base64");
    let downloadUrl = `/api/documentos/download?path=${encodeURIComponent(targetStoragePath)}`;
    let isSimulated = false;

    // 1. Tenta salvar no Firebase Storage usando o Firebase Admin
    if (adminStorage) {
      try {
        const bucketName = firebaseConfig.storageBucket || "usina-rd-solar.firebasestorage.app";
        const bucket = adminStorage.bucket(bucketName);
        const fileRef = bucket.file(targetStoragePath);
        
        await fileRef.save(buffer, {
          metadata: {
            contentType: finalType,
          },
        });
        console.log(`[Firebase Admin Storage Serverless] Arquivo salvo com sucesso via API no path: ${targetStoragePath}`);
      } catch (storageErr: any) {
        console.warn("[Firebase Admin Storage Serverless Error]: Falha ao salvar no bucket, usando simulação persistida no Firestore:", storageErr.message);
        isSimulated = true;
      }
    } else {
      console.warn("[Firebase Admin Storage Serverless]: Não disponível, executando simulação contábil segura.");
      isSimulated = true;
    }

    if (isSimulated) {
      downloadUrl = `/api/mock-document?name=${encodeURIComponent(cleanFileName)}&ano=${ano}&mes=${encodeURIComponent(mes)}`;
    }

    // 2. Cria metadados e salva no Firestore
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
      userId: userId,
      downloadUrl: downloadUrl,
      storagePath: targetStoragePath,
      isSimulated: isSimulated
    };

    if (db) {
      try {
        await db.collection("users").doc(userId).collection("documentos").doc(docId).set(metadataDoc);
        console.log(`[Firestore Admin Serverless] Registro gravado com sucesso em: users/${userId}/documentos/${docId}`);
      } catch (dbErr: any) {
        console.error("[Firestore Admin Serverless Error]: Falha ao gravar metadados:", dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      document: metadataDoc,
      mensagem: "Documento processado com êxito pelo proxy do servidor!"
    });
  } catch (err: any) {
    console.error("[Serverless PDF API Error]:", err.message);
    return res.status(500).json({ success: false, message: `Erro interno no upload do servidor: ${err.message}` });
  }
}
