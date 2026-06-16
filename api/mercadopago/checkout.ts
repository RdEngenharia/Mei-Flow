import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";
import { MercadoPagoConfig, Payment, CardToken } from "mercadopago";

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
      console.error("Error reading firebase-applet-config.json in checkout API:", err);
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
    console.error("[Firebase Admin MP Checkout Error]: Failed to initialize:", err.message);
  }
}

let db: any = null;
if (appInitialized) {
  try {
    db = getFirestore();
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin MP Checkout Init Warning]: Google ADC is not configured. Firestore operations are disabled in this server instance:", dbInitErr.message);
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
async function handleApprovedUpgrade(userId: string, existingProfile: any) {
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
      email,
      paymentMethod,
      creditCard
    } = req.body;

    if (!userId || !name || !cpfCnpj || !email) {
      res.status(400).json({ success: false, mensagem: "Parâmetros obrigatórios ausentes para o checkout." });
      return;
    }

    const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

    if (!mpToken) {
      res.status(500).json({
        success: false,
        mensagem: "Erro de Servidor: Credencial de Produção MERCADO_PAGO_ACCESS_TOKEN não configurada no ambiente."
      });
      return;
    }

    console.log(`[MP Checkout Serverless]: Processing checkout for ${name} using ${paymentMethod}`);
    
    const cleanDoc = cpfCnpj.replace(/\D/g, "");
    if (cleanDoc.length !== 14) {
      res.status(400).json({
        success: false,
        mensagem: `Documento CNPJ inválido (${cpfCnpj}). O CNPJ deve conter exatamente 14 dígitos.`
      });
      return;
    }
    const docType = "CNPJ";
    
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

    const payersFirstName = name.split(" ")[0] || "MEI";
    const payersLastName = name.split(" ").slice(1).join(" ") || "Flow";

    const sysIntegrator = process.env.MERCADO_PAGO_INTEGRATOR_ID;
    const integratorId = (sysIntegrator || "").replace(/^["']|["']$/g, "").trim();

    const mpConfigOptions: any = {
      timeout: 5000,
    };
    if (integratorId) {
      mpConfigOptions.integratorId = integratorId;
    }

    const mpClient = new MercadoPagoConfig({
      accessToken: mpToken,
      options: mpConfigOptions,
    });

    const paymentSdk = new Payment(mpClient);
    const cardTokenSdk = new CardToken(mpClient);

    if (paymentMethod === "PIX") {
      // Create Pix payment on Mercado Pago
      const pixPayload = {
        transaction_amount: 29.90,
        description: "Plano Premium - MEI Flow",
        payment_method_id: "pix",
        payer: {
          email: email,
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[MP Checkout Pix Payload]: Sending payout creation to MP via official SDK`);
      const paymentData = await paymentSdk.create({
        body: pixPayload,
        requestOptions: {
          idempotencyKey: `pix_${userId}_${Date.now()}`
        }
      });

      const paymentId = paymentData.id;

      // Sync with Firestore
      if (db) {
        try {
          const syncUpdate = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType: paymentData.status === "approved" ? "premium" : "free",
            updatedAt: new Date().toISOString()
          };
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
          
          if (paymentData.status === "approved") {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc });
          }
        } catch (dbErr: any) {
          console.error("[MP Checkout API DB Sync Error (Pix)]:", dbErr.message);
        }
      }

      // Map back to format expected by current UI
      const pointOfInteraction = paymentData.point_of_interaction;
      const transactionData = pointOfInteraction?.transaction_data;
      
      const qrCodePayload = transactionData?.qr_code || "";
      const qrCodeImage = transactionData?.qr_code_base64 || "";

      return res.status(200).json({
        success: true,
        paymentId,
        status: paymentData.status,
        planType: paymentData.status === "approved" ? "premium" : "free",
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

      // Tokenize card first using security client parameters representation
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

      console.log(`[MP Checkout serverless]: Tokenizing card via SDK...`);
      let tokenResp: any;
      try {
        tokenResp = await cardTokenSdk.create({
          body: cardTokenPayload
        });
      } catch (tokenErr: any) {
        console.error("[MP Tokenization Error]:", tokenErr);
        const errDetails = tokenErr.message || "Verifique os dados informados.";
        return res.status(400).json({
          success: false,
          mensagem: `Mercado Pago (Cartão recusado/inválido): ${errDetails}`
        });
      }

      const cardTokenId = tokenResp.id;
      const detectedBrand = getPaymentMethodId(creditCard.number);

      const cardPayload = {
        token: cardTokenId,
        transaction_amount: 29.90,
        description: "Plano Premium - MEI Flow",
        installments: 1,
        payment_method_id: detectedBrand,
        payer: {
          email: email,
          first_name: payersFirstName,
          last_name: payersLastName,
          identification: {
            type: docType,
            number: cleanDoc
          }
        },
        external_reference: userId
      };

      console.log(`[MP Checkout serverless]: Creating card payment via SDK...`);
      const paymentData = await paymentSdk.create({
        body: cardPayload,
        requestOptions: {
          idempotencyKey: `card_${userId}_${Date.now()}`
        }
      });

      const isApproved = paymentData.status === "approved";
      const paymentId = paymentData.id;

      let planType: "free" | "premium" = "free";
      if (isApproved) {
        planType = "premium";
      }

      // Sync user profile status
      if (db) {
        try {
          const syncUpdate = {
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatus: paymentData.status,
            planType,
            updatedAt: new Date().toISOString()
          };
          await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

          if (isApproved) {
            await handleApprovedUpgrade(userId, { ...dbProfile, name, email, cnpjPrestador: cleanDoc });
          }
        } catch (dbErr: any) {
          console.error("[MP Checkout API DB Sync Error (Credit Card)]:", dbErr.message);
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
        planType
      });
    }

    res.status(400).json({ success: false, mensagem: "Forma de pagamento não suportada pelo checkout." });
  } catch (err: any) {
    console.error("[MP Checkout API Server Error]:", err.response?.data || err.message);
    let errorMessage = "Erro na integração com Mercado Pago.";
    if (err.response?.data) {
      const data = err.response.data;
      const details = data.cause && Array.isArray(data.cause)
        ? data.cause.map((c: any) => `${c.description || c.code} (${c.data || ""})`).join(", ")
        : data.message;
      errorMessage = `Erro de Validação do Mercado Pago: ${details || JSON.stringify(data)}`;
    } else {
      errorMessage = `Erro de Conexão com Mercado Pago: ${err.message}`;
    }
    res.status(400).json({ success: false, mensagem: errorMessage });
  }
}
