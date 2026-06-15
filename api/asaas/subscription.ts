import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

// Securely initialize Firebase Admin in serverless environment
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error("Error reading firebase-applet-config.json in subscription API:", err);
  }
}

let appInitialized = false;
if (firebaseConfig.projectId) {
  try {
    if (getApps().length === 0) {
      initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
    appInitialized = true;
  } catch (err: any) {
    console.error("[Firebase Admin Serverless Error]: Failed to initialize:", err.message);
  }
}

const db = appInitialized ? getFirestore() : null;

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
      const searchRes = await fetch(`${asaasBaseUrl}/customers?cpfCnpj=${cleanDoc}`, {
        headers: { "access_token": asaasToken }
      });
      if (searchRes.ok) {
        const searchJson: any = await searchRes.json();
        if (searchJson.data && searchJson.data.length > 0) {
          customerId = searchJson.data[0].id;
        }
      }
    } catch (err) {
      console.error("Asaas customer search warning during serverless subscription:", err);
    }

    // 2. Create customer if not found
    if (!customerId) {
      const createCustomerRes = await fetch(`${asaasBaseUrl}/customers`, {
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

      if (!createCustomerRes.ok) {
        const errText = await createCustomerRes.text();
        let parsedErr: any = {};
        try { parsedErr = JSON.parse(errText); } catch (e) {}
        const asaasDesc = parsedErr?.errors?.[0]?.description || errText;
        res.status(400).json({
          success: false,
          mensagem: `Asaas: Falha ao cadastrar cliente: ${asaasDesc}`
        });
        return;
      }

      const customerJson: any = await createCustomerRes.json();
      customerId = customerJson.id;
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

    const createSubRes = await fetch(`${asaasBaseUrl}/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access_token": asaasToken
      },
      body: JSON.stringify(subPayload)
    });

    if (!createSubRes.ok) {
      const errText = await createSubRes.text();
      let parsedErr: any = {};
      try { parsedErr = JSON.parse(errText); } catch (e) {}
      const asaasDesc = parsedErr?.errors?.[0]?.description || errText;
      res.status(400).json({
        success: false,
        mensagem: `Asaas: Falha ao criar assinatura: ${asaasDesc}`
      });
      return;
    }

    const subJson: any = await createSubRes.json();
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
      const paymentsRes = await fetch(`${asaasBaseUrl}/payments?subscription=${subscriptionId}`, {
        headers: { "access_token": asaasToken }
      });
      if (paymentsRes.ok) {
        const paymentsJson: any = await paymentsRes.json();
        if (paymentsJson.data && paymentsJson.data.length > 0) {
          firstPayment = paymentsJson.data[0];
          
          if (firstPayment.id && paymentMethod === "PIX") {
            const pixRes = await fetch(`${asaasBaseUrl}/payments/${firstPayment.id}/pixQrCode`, {
              headers: { "access_token": asaasToken }
            });
            if (pixRes.ok) {
              pixQrCodeResult = await pixRes.json();
            }
          }
        }
      }
    } catch (payLinkErr) {
      console.error("Warning: Could not fetch serverless sub payments:", payLinkErr);
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
    console.error("[Asaas Create Subscription Serverless Error]:", err.message);
    res.status(500).json({ success: false, mensagem: "Erro interno no servidor ao processar assinatura: " + err.message });
  }
}
