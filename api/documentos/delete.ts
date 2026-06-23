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
        storageWarning = `O registro foi removido, mas o arquivo físico não pôde ser excluído: ${storageErr.message}`;
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
