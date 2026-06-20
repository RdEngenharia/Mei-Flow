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
  if (firebaseConfig.projectId) return firebaseConfig.projectId;
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  return "mei-flow-692d9"; // fallback
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
      console.log(`[Firebase Admin Download API]: Initialized securely for projectId: ${projId}`);
    } else if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Download API]: Initialized with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Download API]: Initialized with generic ADC");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin Download API Error]: Failed to initialize:", err.message);
}

let adminStorage: any = null;
if (adminApp) {
  try {
    adminStorage = getStorage(adminApp);
    console.log("[Firebase Admin Download API]: Storage instance initialized successfully.");
  } catch (storageInitErr: any) {
    console.warn("[Firebase Admin Download API Storage Init Warning]: Failed to retrieve storage instance:", storageInitErr.message);
    adminStorage = null;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed. Use GET.");
  }

  try {
    const { path: storagePath } = req.query;
    if (!storagePath) {
      return res.status(400).send("O parâmetro 'path' é obrigatório.");
    }

    if (!adminStorage) {
      return res.status(500).send("Serviço de Storage não está configurado ou ativo no servidor.");
    }

    const bucketName = firebaseConfig.storageBucket || "usina-rd-solar.firebasestorage.app";
    const bucket = adminStorage.bucket(bucketName);
    const fileRef = bucket.file(String(storagePath));
    
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).send("Documento não encontrado no Storage.");
    }

    const [metadata] = await fileRef.getMetadata();
    res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(String(storagePath))}"`);

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
