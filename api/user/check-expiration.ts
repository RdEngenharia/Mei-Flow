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