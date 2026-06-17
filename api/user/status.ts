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
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.firestoreDatabaseId) return config.firestoreDatabaseId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json for database ID inside status API:", err);
    }
  }
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
async function upgradeToPremium(userId: string, paymentId: string) {
  if (!db) return;
  try {
    const syncUpdate = {
      plan: "premium",
      planType: "premium",
      status: "active",
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
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET." });
  }

  try {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required for status query." });
    }

    // 1. Check if user already has premium plan in Firestore database
    if (db) {
      try {
        const uDoc = await db.collection("users").doc(userId).get();
        if (uDoc.exists) {
          const data = uDoc.data() || {};
          const itemPlanType = data.planType || "free";
          const itemPlan = data.plan || data.planType || "free";
          const itemStatus = data.status || "inactive";
          const isPremium = (itemPlanType === "premium" || itemPlan === "premium" || itemStatus === "active" || data.isPremium === true);
          
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
        console.warn(`[Status API Firestore Quick-Check Bypassed]: ${sanitizeDBError(dbErr)}`);
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
        console.warn("[Status API Firestore error reading paymentId]:", sanitizeDBError(getErr));
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
      await upgradeToPremium(userId, paymentId);
    }

    // 6. Return standard representation
    return res.status(200).json({
      success: true,
      isPremium: isApprovedOnMP,
      planType: isApprovedOnMP ? "premium" : "free",
      status: currentMPStatus
    });

  } catch (err: any) {
    console.warn("[Status API Graceful Recovery]:", sanitizeDBError(err));
    return res.status(500).json({
      success: false,
      mensagem: "Erro ao processar verificação de pagamento operacional."
    });
  }
}
