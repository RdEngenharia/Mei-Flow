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
