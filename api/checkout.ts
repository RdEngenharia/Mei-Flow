import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";

// Fonte única de verdade para os valores cobrados (mesma referência usada em
// /api/mercadopago/checkout.ts e /api/plans/pricing.ts).
const PREMIUM_PRICING = {
  monthly: 14.0,
  annual: 14.0 * 12, // 168.00 — cobrança única equivalente a 12 meses
};

// Securely initialize Firebase Admin in serverless environment
const getFirebaseProjectId = () => {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) return config.projectId;
    } catch (err) {
      console.error("Error reading firebase-applet-config.json in checkout API:", err);
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
      console.log(`[Firebase Admin Checkout]: Initialized securely with service account certification for projectId: ${projId}`);
    } else if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin Checkout]: Initialized securely with projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin Checkout]: Initialized with generic ADC");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin MP Checkout Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = getFirebaseDatabaseId();
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin Checkout]: Connected to Firestore database ID: ${dbId}`);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin MP Checkout Init Warning]: Failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
}

export function getPaymentMethodId(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, "");
  if (clean.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(clean)) return "master";
  if (/^(34|37)/.test(clean)) return "amex";
  if (/^(4011|4389|5041|5067|5090|6278|6363|6362)/.test(clean)) return "elo";
  if (/^(3841|6062|60)/.test(clean)) return "hipercard";
  if (/^(6011|622|64|65)/.test(clean)) return "discover";
  if (/^(30[0-5]|36|38)/.test(clean)) return "diners";
  return "master"; // default fallback
}

// Helper to trigger Focus NFe on immediate card approvals
async function handleApprovedUpgrade(userId: string, existingProfile: any, transactionAmount: number, planDescription: string) {
  if (!db) return;
  try {
    console.log(`[MP Checkout Approved Helper]: Triggering Focus NFe for user ${userId}`);
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
      console.log(`[MP Checkout Approved Helper Success]: Invoice processing ref: ${focusRef}`);
      await db.collection("users").doc(userId).set({
        premiumInvoiceRef: focusRef,
        premiumInvoiceStatus: "processando_autorizacao",
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (focusErr: any) {
    console.error("[MP Checkout Approved Helper FocusNFe Error]:", focusErr.response?.data?.mensagem || focusErr.message);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    return res.status(200).json({
      publicKey: process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "",
      integratorId: process.env.MERCADO_PAGO_INTEGRATOR_ID || ""
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
  }

  try {
    const {
      userId,
      name,
      cpfCnpj,
      documentNumber,
      email,
      paymentMethod,
      creditCard,
      billingCycle
    } = req.body;

    const cycle: "monthly" | "annual" = billingCycle === "annual" ? "annual" : "monthly";
    const transactionAmount = cycle === "annual" ? PREMIUM_PRICING.annual : PREMIUM_PRICING.monthly;
    const planDescription = cycle === "annual"
      ? "Plano Premium MEI Flow - Pacote Anual (12 meses)"
      : "Plano Premium MEI Flow - Mensal";

    if (!userId || !email) {
      res.status(400).json({ success: false, mensagem: "Parâmetros obrigatórios ausentes: userId e email são obrigatórios." });
      return;
    }

    const docRaw = (documentNumber || cpfCnpj || "");
    const cleanDoc = docRaw.replace(/\D/g, "");

    if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
      res.status(400).json({
        success: false,
        mensagem: `Documento CPF ou CNPJ inválido (${docRaw}). Certifique-se de digitar 11 dígitos para CPF ou 14 dígitos para CNPJ.`
      });
      return;
    }

    const docType = cleanDoc.length === 11 ? "CPF" : "CNPJ";

    const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

    if (!mpToken) {
      res.status(500).json({
        success: false,
        mensagem: "Erro de Servidor: Credencial de Produção MERCADO_PAGO_ACCESS_TOKEN não configurada no ambiente."
      });
      return;
    }

    const sysIntegrator = process.env.MERCADO_PAGO_INTEGRATOR_ID;
    const integratorId = (sysIntegrator || "").replace(/^["']|["']$/g, "").trim();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${mpToken}`,
      "X-Idempotency-Key": `chk_s_${userId}_${Date.now()}`
    };

    if (integratorId) {
      headers["X-Integrator-Id"] = integratorId;
    }

    let dbProfile: any = {};
    if (db) {
      try {
        const uDoc = await db.collection("users").doc(userId).get();
        if (uDoc.exists) {
          dbProfile = uDoc.data();
        }
      } catch (dbReadErr: any) {
        console.error("Error reading user doc during checkout:", dbReadErr.message);
      }
    }

    if (paymentMethod === "PIX") {
      const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
      const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

      const pixPayload = {
        transaction_amount: transactionAmount,
        description: `${planDescription} - Pix`,
        payment_method_id: "pix",
        payer: {
          email: email.trim(),
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[MP Checkout Serverless Pix]: Sending payout creation to MP via fetch`);
      const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(pixPayload)
      });

      const paymentData: any = await mpResponse.json();

      if (!mpResponse.ok) {
        const errorMsg = paymentData.message || JSON.stringify(paymentData);
        console.error(`[MP Checkout Serverless Pix Error]: ${errorMsg}`);
        res.status(mpResponse.status).json({
          success: false,
          mensagem: `Mercado Pago: ${errorMsg}`
        });
        return;
      }

      const paymentId = paymentData.id;

      // Sync with Firestore
      if (db) {
        try {
          const syncUpdate = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType: paymentData.status === "approved" ? "premium" : "free",
            billingCycle: cycle,
            paymentMethod: "PIX",
            updatedAt: new Date().toISOString()
          };
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
          
          if (paymentData.status === "approved") {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
          }
        } catch (dbErr: any) {
          console.warn("[MP Checkout API DB Sync Warning (Pix)]:", dbErr.message);
        }
      }

      const pointOfInteraction = paymentData.point_of_interaction;
      const transactionData = pointOfInteraction?.transaction_data;
      const qrCodeImage = transactionData?.qr_code_base64 || "";
      const qrCodePayload = transactionData?.qr_code || "";

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType: paymentData.status === "approved" ? "premium" : "free",
        qrCodeBase64: qrCodeImage,
        qrCode: qrCodePayload,
        pixQrCode: {
          encodedImage: qrCodeImage,
          payload: qrCodePayload
        }
      });
    }

    if (paymentMethod === "CREDIT_CARD") {
      if (!creditCard) {
        return res.status(400).json({ success: false, mensagem: "Parâmetros de cartão de crédito ausentes no payload." });
      }

      const cardTokenPayload = {
        card_number: creditCard.number.replace(/\s/g, ""),
        expiration_month: String(creditCard.expiryMonth),
        expiration_year: String(creditCard.expiryYear),
        security_code: creditCard.ccv,
        cardholder: {
          name: creditCard.holderName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        }
      };

      console.log(`[Checkout Native Fetch CC Serverless]: Tokenizing card via fetch...`);
      const tokenResponse = await fetch("https://api.mercadopago.com/v1/card_tokens", {
        method: "POST",
        headers,
        body: JSON.stringify(cardTokenPayload)
      });

      const tokenData: any = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("[Checkout Native Fetch CC Token Serverless Error]:", tokenData);
        const errDetails = tokenData.message || "Verifique os dados informados.";
        return res.status(400).json({
          success: false,
          mensagem: `Mercado Pago (Cartão recusado/inválido): ${errDetails}`
        });
      }

      const cardTokenId = tokenData.id;
      const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
      const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

      // CICLO MENSAL: cria assinatura recorrente real (Preapproval). O Mercado
      // Pago cobra automaticamente todo mês no cartão, sem ação do usuário.
      if (cycle === "monthly") {
        const preapprovalPayload = {
          reason: planDescription,
          external_reference: userId,
          payer_email: email.trim(),
          card_token_id: cardTokenId,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: transactionAmount,
            currency_id: "BRL"
          },
          back_url: "https://mei-flow-flax.vercel.app",
          notification_url: "https://mei-flow-flax.vercel.app/api/mercadopago/webhook",
          status: "authorized"
        };

        console.log(`[Checkout Native Fetch CC Serverless]: Criando assinatura (Preapproval) recorrente mensal...`);
        const preapprovalResp = await fetch("https://api.mercadopago.com/preapproval", {
          method: "POST",
          headers,
          body: JSON.stringify(preapprovalPayload)
        });

        const preapprovalData: any = await preapprovalResp.json();

        if (!preapprovalResp.ok) {
          const errorMsg = preapprovalData.message || JSON.stringify(preapprovalData);
          console.error(`[Checkout Native Fetch CC Preapproval Serverless Error]: ${errorMsg}`);
          return res.status(preapprovalResp.status).json({
            success: false,
            mensagem: `Mercado Pago (Assinatura): ${errorMsg}`
          });
        }

        const preapprovalId = preapprovalData.id;
        const preapprovalStatus = preapprovalData.status;
        const isAuthorized = preapprovalStatus === "authorized";
        const planType: "free" | "premium" = isAuthorized ? "premium" : "free";

        if (db) {
          try {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + 30);
            const syncUpdate: any = {
              mercadoPagoPreapprovalId: preapprovalId,
              mercadoPagoStatus: preapprovalStatus,
              planType,
              billingCycle: "monthly",
              paymentMethod: "CREDIT_CARD",
              subscriptionType: "recurring",
              updatedAt: new Date().toISOString()
            };
            if (isAuthorized) {
              syncUpdate.premiumUntil = expirationDate.toISOString();
            }
            await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

            if (isAuthorized) {
              await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
            }
          } catch (dbErr: any) {
            console.warn("[Checkout Native Fetch CC Preapproval DB Sync Serverless Warning]:", dbErr.message);
          }
        }

        if (!isAuthorized) {
          return res.status(400).json({
            success: false,
            mensagem: `Assinatura não autorizada pelo Mercado Pago (status: ${preapprovalStatus}).`
          });
        }

        return res.status(200).json({
          success: true,
          preapprovalId,
          status: preapprovalStatus,
          planType,
          subscriptionType: "recurring"
        });
      }

      // CICLO ANUAL: cobrança única (12 meses pagos de uma vez), sem assinatura.
      const detectedBrand = getPaymentMethodId(creditCard.number);

      const cardPayload = {
        token: cardTokenId,
        transaction_amount: transactionAmount,
        description: planDescription,
        installments: 1,
        payment_method_id: detectedBrand,
        payer: {
          email: email.trim(),
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[Checkout Native Fetch CC Serverless]: Creating annual one-time payment via fetch...`);
      const mpPaymentResp = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(cardPayload)
      });

      const paymentData: any = await mpPaymentResp.json();

      if (!mpPaymentResp.ok) {
        const errorMsg = paymentData.message || JSON.stringify(paymentData);
        console.error(`[Checkout Native Fetch CC Payment Serverless Error]: ${errorMsg}`);
        return res.status(mpPaymentResp.status).json({
          success: false,
          mensagem: `Mercado Pago: ${errorMsg}`
        });
      }

      const isApproved = paymentData.status === "approved";
      const paymentId = paymentData.id;

      let planType: "free" | "premium" = "free";
      if (isApproved) {
        planType = "premium";
      }

      if (db) {
        try {
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 365);
          const syncUpdate: any = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType,
            billingCycle: "annual",
            paymentMethod: "CREDIT_CARD",
            subscriptionType: "one_time",
            updatedAt: new Date().toISOString()
          };
          if (isApproved) {
            syncUpdate.premiumUntil = expirationDate.toISOString();
          }
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

          if (isApproved) {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc }, transactionAmount, planDescription);
          }
        } catch (dbErr: any) {
          console.warn("[Checkout Native Fetch CC DB Sync Serverless Warning]: Database sync skipped", dbErr.message);
        }
      }

      if (paymentData.status === "rejected") {
        const rejectDetail = paymentData.status_detail || "Pagamento rejeitado pelo emissor.";
        return res.status(400).json({
          success: false,
          mensagem: `Transação Recusada (Mercado Pago): ${rejectDetail}.`
        });
      }

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType,
        subscriptionType: "one_time"
      });
    }

    res.status(400).json({ success: false, mensagem: "Forma de pagamento não suportada pelo checkout." });
  } catch (err: any) {
    console.error("[MP Checkout API Server Error]:", err.message);
    res.status(400).json({ success: false, mensagem: `Erro na integração com Mercado Pago: ${err.message}` });
  }
}
