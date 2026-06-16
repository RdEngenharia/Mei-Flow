import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in webhook API:", err);
    }
  }
  return "mei-flow-692d9"; // fallback
};

const projId = getFirebaseProjectId();
let appInitialized = false;

if (projId) {
  try {
    if (getApps().length === 0) {
      initializeApp({
        projectId: projId,
      });
    }
    appInitialized = true;
  } catch (err: any) {
    console.error("[Firebase Admin Webhook Error]: Failed to initialize:", err.message);
  }
}

const db = appInitialized ? getFirestore() : null;

async function handleApprovedUpgrade(userId: string) {
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
    const premiumUpdate = {
      planType: "premium",
      invoiceLimit: 30,
      invoiceUsed: 0,
      updatedAt: new Date().toISOString()
    };

    await db.collection("users").doc(userId).set(premiumUpdate, { merge: true });
    await db.collection("usuarios").doc(userId).set(premiumUpdate, { merge: true });
    console.log(`[MP Webhook]: Updated user profile in Firestore to premium / limits set!`);

    // 2. EMIT NOTA FISCAL (FOCUS NFE) FOR R$ 29,90 PREMIUM PAYMENT
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
        valor_servicos: 29.90,
        tomador: {
          ...tomadorBody,
          razao_social: cleanName,
          email: cleanEmail,
        },
        servico: {
          aliquota: 0,
          discriminacao: `Assinatura de Softwares e Serviços Premium MEI Flow - Faturamento Integrado Mensal. Referente ao pagamento aprovado de R$ 29,90.`,
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

        // Fetch official payment from Mercado Pago
        const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
        const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

        if (!mpToken) {
          console.error("[MP Webhook Error]: Token MERCADO_PAGO_ACCESS_TOKEN is missing in environment.");
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

        if (db) {
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
          await handleApprovedUpgrade(userId);
        }
      } catch (innerErr: any) {
        console.error("[MP Webhook Notification Background processing Error]:", innerErr.response?.data || innerErr.message);
      }
    })();
  } catch (err: any) {
    console.error("[MP Webhook Notification Global Error]:", err.message);
  }
}
