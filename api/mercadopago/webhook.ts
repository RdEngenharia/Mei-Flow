import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";

// Fonte única de verdade para os valores cobrados (mesma referência usada em
// /api/checkout.ts, /api/mercadopago/checkout.ts e /api/plans/pricing.ts).
const PREMIUM_PRICING = {
  monthly: 14.0,
  annual: 14.0 * 12, // 168.00
};

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in webhook API:", err);
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
      console.log(`[Firebase Admin Webhook]: Initialized securely with service account certification for projectId: ${projId}`);
    } else if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Webhook]: Initialized securely with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Webhook]: Initialized with generic ADC (no config projectId found)");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin Webhook Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Webhook]: Connected to Firestore database ID: ${dbId}`);
  } catch (dbInitErr: any) {
    console.error("[Firebase Admin Webhook Init Error]: failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
}

async function handleApprovedUpgrade(userId: string, billingCycle: "monthly" | "annual", transactionAmount: number, planDescription: string) {
  if (!db) {
    console.error("[MP Webhook Error]: No DB instance initialized inside webhook.");
    return;
  }
  try {
    console.log(`[MP Webhook Approved]: Processing Premium Upgrade for user ${userId}`);

    // Fetch User profile
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    const existingProfile = userDoc.exists ? userDoc.data() : {};

    // 1. UPDATE USER TO PREMIUM CONTROLS
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + (billingCycle === "annual" ? 365 : 30));
    const premiumUpdate = {
      planType: "premium",
      plan: "premium",
      status: "active",
      premiumUntil: expirationDate.toISOString(),
      invoiceLimit: 30,
      invoiceUsed: 0,
      updatedAt: new Date().toISOString()
    };

    await db.collection("users").doc(userId).set(premiumUpdate, { merge: true });
    await db.collection("usuarios").doc(userId).set(premiumUpdate, { merge: true });
    console.log(`[MP Webhook]: Updated user profile in Firestore to premium / limits set!`);

    // 2. EMIT NOTA FISCAL (FOCUS NFE) PARA O PAGAMENTO PREMIUM APROVADO
    try {
      console.log(`[MP Webhook FocusNFe]: Triggering subscription invoice emission for user ${userId}`);
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
        console.log(`[MP Webhook FocusNFe Success]: Invoice processing ref: ${focusRef}`);
        await db.collection("users").doc(userId).set({
          premiumInvoiceRef: focusRef,
          premiumInvoiceStatus: "processando_autorizacao",
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (focusErr: any) {
      console.error("[MP Webhook FocusNFe Error]:", focusErr.response?.data?.mensagem || focusErr.message);
    }
  } catch (err: any) {
    console.error("[handleApprovedUpgrade Webhook Error]:", err.message);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  try {
    // Quick acknowledge to Mercado Pago to avoid retry locks
    res.status(200).json({ received: true });

    // Extract transaction detail in background to preserve lifecycle
    (async () => {
      try {
        const body = req.body;
        console.log(`[MP Webhook Received]:`, JSON.stringify(body));

        const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

        if (!mpToken) {
          console.error("[MP Webhook Error]: Token MERCADO_PAGO_ACCESS_TOKEN is missing in environment.");
          return;
        }

        // ====================================================
        // EVENTO DE ASSINATURA (Preapproval): criação, autorização ou
        // cancelamento da assinatura recorrente em si.
        // ====================================================
        const isPreapprovalEvent =
          body.type === "subscription_preapproval" ||
          body.topic === "subscription_preapproval" ||
          (body.action && body.action.startsWith("subscription_preapproval"));

        if (isPreapprovalEvent) {
          const preapprovalId = body.data?.id || body.id;
          if (!preapprovalId) return;

          const preapprovalRes = await axios.get(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
            headers: { "Authorization": `Bearer ${mpToken}` }
          });
          const preapprovalData = preapprovalRes.data;
          const preapprovalStatus = preapprovalData.status; // authorized | paused | cancelled
          const userId = preapprovalData.external_reference;
          if (!userId || !db) return;

          if (preapprovalStatus === "cancelled" || preapprovalStatus === "paused") {
            // Assinatura cancelada/pausada: revoga o premium imediatamente.
            const statusUpdate = {
              mercadoPagoStatus: preapprovalStatus,
              planType: "free",
              plan: "free",
              status: "inactive",
              updatedAt: new Date().toISOString()
            };
            console.log(`[MP Webhook]: Preapproval ${preapprovalId} status "${preapprovalStatus}" para user ${userId}. Revogando premium.`);
            await db.collection("users").doc(userId).set(statusUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(statusUpdate, { merge: true });
          }
          // "authorized" já é tratado no momento da criação (checkout); a
          // confirmação contínua de cada cobrança mensal chega via "payment".
          return;
        }

        // ====================================================
        // EVENTO DE PAGAMENTO (cobrança única OU renovação mensal
        // automática gerada por uma assinatura ativa)
        // ====================================================
        let paymentId = "";
        
        // Handle standard MP Webhook topics representation
        if (body.type === "payment" && body.data?.id) {
          paymentId = String(body.data.id);
        } else if (body.action?.startsWith("payment") && body.data?.id) {
          paymentId = String(body.data.id);
        } else if (body.topic === "payment" && body.id) {
          paymentId = String(body.id);
        } else if (body.resource && body.topic === "payment") {
          // resource could be something like "https://api.mercadopago.com/v1/payments/12345"
          const match = body.resource.match(/\/payments\/(\d+)/);
          if (match) paymentId = match[1];
        }

        if (!paymentId) {
          console.warn("[MP Webhook Notification Warning]: Could not extract paymentId from body.");
          return;
        }

        console.log(`[MP Webhook Query]: Querying payment info for ID ${paymentId}`);
        const mpPaymentRes = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: {
            "Authorization": `Bearer ${mpToken}`
          }
        });

        const paymentData = mpPaymentRes.data;
        const status = paymentData.status;
        const userId = paymentData.external_reference;

        console.log(`[MP Webhook Query Response]: Status: ${status} for ExternalRef (userId): ${userId}`);

        if (!userId) {
          console.warn(`[MP Webhook Notification Warning]: Payment ${paymentId} has no external_reference/userId.`);
          return;
        }

        // Lê o billingCycle previamente salvo no checkout para calcular a
        // duração correta da validade (também cobre renovações automáticas:
        // cada nova cobrança mensal aprovada estende o premiumUntil por mais
        // 30 dias).
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

          // Sync current status to Firestore
          const statusUpdate = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: status,
            updatedAt: new Date().toISOString()
          };
          await db.collection("users").doc(userId).set(statusUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(statusUpdate, { merge: true });
        }

        if (status === "approved") {
          const transactionAmount = billingCycle === "annual" ? PREMIUM_PRICING.annual : PREMIUM_PRICING.monthly;
          const planDescription = billingCycle === "annual"
            ? "Plano Premium MEI Flow - Pacote Anual (12 meses)"
            : "Plano Premium MEI Flow - Mensal";
          await handleApprovedUpgrade(userId, billingCycle, transactionAmount, planDescription);
        }
      } catch (innerErr: any) {
        console.error("[MP Webhook Notification Background processing Error]:", innerErr.response?.data || innerErr.message);
      }
    })();
  } catch (err: any) {
    console.error("[MP Webhook Notification Global Error]:", err.message);
  }
}
