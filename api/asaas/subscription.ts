import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

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
      console.error("Error reading firebase-applet-config.json in subscription API:", err);
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
    console.error("[Firebase Admin Serverless Error]: Failed to initialize:", err.message);
  }
}

const db = appInitialized ? getFirestore() : null;

// Helper function to safely fetch from Asaas API with robust try-catch and specific error formatting
async function fetchAsaas(url: string, options: any) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Not JSON (could be raw string or HTML <!DOCTYPE...)
      if (!res.ok) {
        const err: any = new Error(`Asaas API responded with status ${res.status}`);
        err.response = { data: text };
        throw err;
      }
      data = text;
    }

    if (!res.ok) {
      const err: any = new Error(`Asaas API responded with status ${res.status}`);
      err.response = { data: data };
      throw err;
    }

    return data;
  } catch (error: any) {
    // Requirements: Se a requisição der erro, faça o código dar um console.error('Erro detalhado do Asaas:', error.response?.data || error.message)
    console.error('Erro detalhado do Asaas:', error.response?.data || error.message);
    throw error;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  try {
    const {
      userId,
      name,
      cpfCnpj,
      email,
      paymentMethod,
      creditCard
    } = req.body;

    if (!userId || !name || !cpfCnpj || !email) {
      res.status(400).json({ success: false, mensagem: "Parâmetros obrigatórios ausentes para assinatura." });
      return;
    }

    const systemToken = process.env.ASAAS_API_KEY;
    const asaasToken = (systemToken || "").trim();

    if (!asaasToken) {
      res.status(500).json({
        success: false,
        mensagem: "Erro de Servidor: Chave master ASAAS_API_KEY não foi configurada."
      });
      return;
    }

    // Dynamic endpoint logic based on whether the key starts with $aact_hm
    const isSandbox = asaasToken.startsWith("$aact_hm");
    const asaasBaseUrl = isSandbox ? "https://sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
    const cleanDoc = cpfCnpj.replace(/\D/g, "");

    console.log(`[Asaas Subscription Serverless]: Creating Premium subscription for ${name} (${cleanDoc}) using ${asaasBaseUrl}`);

    // 1. Search Customer by Doc
    let customerId = "";
    try {
      const searchRes = await fetchAsaas(`${asaasBaseUrl}/customers?cpfCnpj=${cleanDoc}`, {
        headers: { "access_token": asaasToken }
      });
      if (searchRes && searchRes.data && searchRes.data.length > 0) {
        customerId = searchRes.data[0].id;
      }
    } catch (err: any) {
      console.warn("Asaas customer search warning during serverless subscription:", err.response?.data || err.message);
    }

    // 2. Create customer if not found
    if (!customerId) {
      try {
        const customerJson = await fetchAsaas(`${asaasBaseUrl}/customers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "access_token": asaasToken
          },
          body: JSON.stringify({
            name,
            cpfCnpj: cleanDoc,
            email,
            notificationDisabled: true
          })
        });
        customerId = customerJson.id;
      } catch (err: any) {
        const errorMsg = err.response?.data?.errors?.[0]?.description || JSON.stringify(err.response?.data) || err.message;
        res.status(400).json({
          success: false,
          mensagem: `Asaas: Falha ao cadastrar cliente: ${errorMsg}`
        });
        return;
      }
    }

    // 3. Create Subscription (Valor Fixo: R$ 29,90)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateStr = tomorrow.toISOString().split("T")[0];

    const subPayload: any = {
      customer: customerId,
      billingType: paymentMethod, // BOLETO / PIX / CREDIT_CARD
      value: 29.90,
      nextDueDate: dueDateStr,
      cycle: "MONTHLY",
      description: "Assinatura Plano Premium - MEI Flow",
      externalReference: userId
    };

    if (paymentMethod === "CREDIT_CARD" && creditCard) {
      subPayload.creditCard = {
        holderName: creditCard.holderName,
        number: creditCard.number,
        expiryMonth: creditCard.expiryMonth,
        expiryYear: creditCard.expiryYear,
        ccv: creditCard.ccv
      };
      subPayload.creditCardHolderInfo = {
        name: name,
        email: email,
        cpfCnpj: cleanDoc,
        postalCode: "01001000",
        addressNumber: "123",
        phone: "11999999999"
      };
    }

    let subJson: any;
    try {
      subJson = await fetchAsaas(`${asaasBaseUrl}/subscriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "access_token": asaasToken
        },
        body: JSON.stringify(subPayload)
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.errors?.[0]?.description || JSON.stringify(err.response?.data) || err.message;
      res.status(400).json({
        success: false,
        mensagem: `Asaas: Falha ao criar assinatura: ${errorMsg}`
      });
      return;
    }

    const subscriptionId = subJson.id;

    // 4. Salva a relação no Firestore
    let planType: "free" | "premium" = "free";
    if (paymentMethod === "CREDIT_CARD" && subJson.status === "ACTIVE") {
      planType = "premium";
    }

    if (db) {
      try {
        const userUpdate = {
          asaasCustomerId: customerId,
          asaasSubscriptionId: subscriptionId,
          planType: planType,
          updatedAt: new Date().toISOString()
        };
        await db.collection("users").doc(userId).set(userUpdate, { merge: true });
        await db.collection("usuarios").doc(userId).set(userUpdate, { merge: true });
        console.log(`[Firestore Sync Serverless]: Linked subscriber ${userId} with subId ${subscriptionId}`);
      } catch (dbErr: any) {
        console.error("[Firestore Sync Serverless Error]:", dbErr.message);
      }
    }

    // 5. Busca cobrança gerada para disponibilizar Pix QR Code/Payload se for PIX
    let firstPayment: any = null;
    let pixQrCodeResult: any = null;

    try {
      console.log(`[Asaas Pix Integration]: Fetching payments for subscription ${subscriptionId}`);
      let paymentsJson: any = null;
      
      // Method A: Direct subscriptions/{id}/payments
      try {
        paymentsJson = await fetchAsaas(`${asaasBaseUrl}/subscriptions/${subscriptionId}/payments`, {
          headers: { "access_token": asaasToken }
        });
        if (paymentsJson && paymentsJson.data && paymentsJson.data.length > 0) {
          firstPayment = paymentsJson.data[0];
          console.log(`[Asaas Pix Integration - Method A]: Found initial payment ${firstPayment.id}`);
        }
      } catch (methodAErr: any) {
        console.warn("[Asaas Pix Integration]: Method A (subscriptions/{id}/payments) failed:", methodAErr.response?.data || methodAErr.message);
      }

      // Method B: Filter payments?subscription={id}
      if (!firstPayment) {
        try {
          console.log(`[Asaas Pix Integration]: Falling back to Method B (payments?subscription=${subscriptionId})`);
          paymentsJson = await fetchAsaas(`${asaasBaseUrl}/payments?subscription=${subscriptionId}`, {
            headers: { "access_token": asaasToken }
          });
          if (paymentsJson && paymentsJson.data && paymentsJson.data.length > 0) {
            firstPayment = paymentsJson.data[0];
            console.log(`[Asaas Pix Integration - Method B]: Found initial payment ${firstPayment.id}`);
          }
        } catch (methodBErr: any) {
          console.error("[Asaas Pix Integration]: Method B (payments?subscription) failed:", methodBErr.response?.data || methodBErr.message);
        }
      }

      if (firstPayment) {
        console.log(`[Asaas Pix Integration]: Found initial payment ${firstPayment.id} with status ${firstPayment.status}`);
        
        if (firstPayment.id && paymentMethod === "PIX") {
          try {
            console.log(`[Asaas Pix Integration]: Requesting Pix QR Code for payment ${firstPayment.id}`);
            pixQrCodeResult = await fetchAsaas(`${asaasBaseUrl}/payments/${firstPayment.id}/pixQrCode`, {
              headers: { "access_token": asaasToken }
            });
            console.log(`[Asaas Pix Integration]: Successfully fetched Pix QR Code.`, pixQrCodeResult);
          } catch (pixErr: any) {
            console.error("Asaas fetch Pix QR Code warning:", pixErr.response?.data || pixErr.message);
          }
        }
      } else {
        console.warn(`[Asaas Pix Integration]: No payments found linked to subscription ${subscriptionId} via both methods.`);
      }
    } catch (payLinkErr: any) {
      console.error("Warning: Could not fetch serverless sub payments:", payLinkErr.response?.data || payLinkErr.message);
    }

    res.status(201).json({
      success: true,
      subscriptionId,
      customerId,
      planType,
      status: subJson.status,
      invoiceUrl: firstPayment?.invoiceUrl || subJson.invoiceUrl || "",
      bankSlipUrl: firstPayment?.bankSlipUrl || firstPayment?.invoiceUrl || "",
      pixQrCode: pixQrCodeResult,
      paymentId: firstPayment?.id || null
    });

  } catch (err: any) {
    console.error("[Asaas Create Subscription Serverless Error]:", err.response?.data || err.message);
    res.status(500).json({ success: false, mensagem: "Erro interno no servidor ao processar assinatura: " + err.message });
  }
}
