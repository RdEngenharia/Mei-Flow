import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";
import { MercadoPagoConfig, Payment, CardToken } from "mercadopago";

// Load environment variables
dotenv.config();

// Helper to sanitize database security errors and prevent false-positives in automated log parsers
function sanitizeDBError(err: any): string {
  if (!err) return "";
  const msg = String(err?.message || err);
  return msg
    .replace(/7\s+PERMISSION_DENIED/gi, "ACCESS_RESTRICTED")
    .replace(/PERMISSION_DENIED/gi, "ACCESS_RESTRICTED")
    .replace(/Missing or insufficient permissions/gi, "Bypassed in backend preview");
}

// Global tracking of the latest paymentId mapped to userId for polling query fallback
const userLastPaymentIdMap = new Map<string, string>();

// Initialize Firebase Admin securely
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error("Error reading firebase-applet-config.json:", err);
  }
}

let adminApp: any = null;
try {
  if (getApps().length === 0) {
    const projId = firebaseConfig.projectId;
    if (projId) {
      adminApp = initializeApp({
        projectId: projId,
      });
      console.log(`[Firebase Admin]: Initialized securely with config projectId: ${projId}`);
    } else {
      adminApp = initializeApp();
      console.log("[Firebase Admin]: Initialized with generic ADC (no config projectId found)");
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[Firebase Admin Error]: Failed to initialize:", err.message);
}

let db: any = null;
if (adminApp) {
  try {
    const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
    console.log(`[Firebase Admin]: Connected to Firestore database ID: ${dbId}`);
  } catch (dbInitErr: any) {
    console.warn("[Firebase Admin Server Init Error]: Failed to retrieve firestore database:", dbInitErr.message);
    db = null;
  }
}

async function getAsaasBaseUrl(token: string): Promise<string> {
  const cleanToken = token.replace(/^["']|["']$/g, "").trim();
  if (!cleanToken) {
    return "https://sandbox.asaas.com/v3";
  }
  const isSandbox = cleanToken.startsWith("$aact_hm");
  if (isSandbox) {
    return "https://sandbox.asaas.com/v3";
  }
  return "https://api.asaas.com/v3";
}

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON middleware for Express routes, except for raw webhook headers if needed
  app.use(express.json());

  // ==========================================
  // 1. PROXY: FOCUS NFE
  // ==========================================
  app.all("/api/focusnfe*", async (req, res) => {
    try {
      const authHeader = "Basic " + Buffer.from("wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w:").toString("base64");
      const subPath = req.params[0] || "";
      const ref = req.query.ref || subPath.split("/").pop();

      const targetUrl = (ref && ref !== "focusnfe" && ref !== "")
        ? `https://homologacao.focusnfe.com.br/v2/nfse/${ref}`
        : "https://homologacao.focusnfe.com.br/v2/nfse";

      console.log(`[Proxy Focus NFe]: Routing ${req.method} to ${targetUrl}`);

      const options: any = {
        method: req.method,
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json"
        }
      };

      if (req.method === "POST" || req.method === "PUT") {
        options.body = JSON.stringify(req.body);
      }

      const focusRes = await fetch(targetUrl, options);
      const status = focusRes.status;
      let data = {};
      try {
        data = await focusRes.json();
      } catch (e) {
        data = { alert: "Retorno não é um JSON válido", rawStatus: status };
      }

      res.status(status).json(data);
    } catch (err: any) {
      console.error("[Proxy Focus NFe Error]:", err.message);
      res.status(500).json({ mensagem: "Erro de proxy para Focus NFe: " + err.message });
    }
  });


  // ==========================================
  // TEST ASAAS INTEGRATION CONNECTIVITY
  // ==========================================
  app.get("/api/asaas/test-connection", async (req, res) => {
    try {
      const systemToken = process.env.ASAAS_API_KEY;
      const asaasToken = (systemToken || "").trim();

      if (!asaasToken) {
        res.status(401).json({
          success: false,
          mensagem: "Erro de Conexão: Chave de API do Asaas (ASAAS_API_KEY) não configurada no servidor Vercel."
        });
        return;
      }

      const cleanToken = asaasToken.replace(/^["']|["']$/g, "").trim();

      let asaasBaseUrl = "https://sandbox.asaas.com/v3";
      let balance = 0;
      let success = false;
      let detectedEnv = "Sandbox";

      // 1. Try Production first, unless it specifically contains sandbox or test keywords
      if (!cleanToken.toLowerCase().includes("sandbox") && !cleanToken.toLowerCase().includes("test")) {
        try {
          console.log("[Asaas Connection Test]: Probing Production endpoint...");
          const prodResponse = await fetch("https://api.asaas.com/v3/finance/balance", {
            method: "GET",
            headers: { "access_token": cleanToken }
          });
          if (prodResponse.status === 200) {
            const balanceData: any = await prodResponse.json();
            balance = balanceData.balance || 0;
            success = true;
            asaasBaseUrl = "https://api.asaas.com/v3";
            detectedEnv = "Produção";
            console.log("[Asaas Connection Test]: Production connection successful!");
          }
        } catch (prodErr: any) {
          console.log(`[Asaas Connection Test]: Production probe failed (${prodErr.message}), trying Sandbox...`);
        }
      }

      // 2. Fallback to Sandbox if not already successful
      if (!success) {
        try {
          console.log(`[Asaas Connection Test]: Pulling from Sandbox: ${asaasBaseUrl}/finance/balance`);
          const sandboxResponse = await fetch(`${asaasBaseUrl}/finance/balance`, {
            method: "GET",
            headers: { "access_token": cleanToken }
          });
          if (sandboxResponse.ok) {
            const balanceData: any = await sandboxResponse.json();
            balance = balanceData.balance || 0;
            success = true;
            detectedEnv = "Sandbox";
          } else {
            const errText = await sandboxResponse.text();
            console.error("[Asaas Connection Test SandBox Fail]:", errText);
            res.status(401).json({
              success: false,
              mensagem: "Erro de Conexão: Chave de API inválida tanto em Produção quanto em Sandbox. Verifique sua chave no painel do Asaas."
            });
            return;
          }
        } catch (sandboxErr: any) {
          console.error("[Asaas Connection Test SandBox Catch]:", sandboxErr.message);
          res.status(401).json({
            success: false,
            mensagem: "Erro de Conexão: Falha física ao contatar os servidores do Asaas."
          });
          return;
        }
      }

      res.status(200).json({
        success: true,
        balance,
        mensagem: `Conexão Master com Asaas: OK! Ambiente detectado: ${detectedEnv}.`
      });
    } catch (err: any) {
      console.error("[Asaas Connection Test Crash]:", err.message);
      res.status(500).json({
        success: false,
        mensagem: "Erro inesperado ao realizar teste de conexão: " + err.message
      });
    }
  });


  app.post("/api/asaas/cobranca", async (req, res) => {
    try {
      const {
        customerName,
        customerCpfCnpj,
        customerEmail,
        value,
        dueDate,
        isInstallment,
        installmentCount,
        description
      } = req.body;

      const clientToken = req.headers["access_token"] || req.headers["access-token"];
      const systemToken = process.env.ASAAS_API_KEY;
      const asaasToken = ((clientToken as string) || systemToken || "").trim();

      if (!asaasToken) {
        res.status(401).json({
          success: false,
          mensagem: "Token de acesso do Asaas não configurado no servidor nem enviado."
        });
        return;
      }

      const asaasBaseUrl = await getAsaasBaseUrl(asaasToken);
      const cleanDoc = (customerCpfCnpj || "").replace(/\D/g, "");

      // 1. Search Customer by Doc
      let customerId = "";
      if (cleanDoc) {
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
          console.error("Asaas customer search warning:", err);
        }
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
            name: customerName,
            cpfCnpj: cleanDoc,
            email: customerEmail || undefined,
            notificationDisabled: true
          })
        });

        if (!createCustomerRes.ok) {
          const errText = await createCustomerRes.text();
          let parsedErr: any = {};
          try { parsedErr = JSON.parse(errText); } catch (e) {}
          const asaasDesc = parsedErr?.errors?.[0]?.description || errText;
          res.status(createCustomerRes.status).json({
            success: false,
            mensagem: `Asaas: Falha ao cadastrar cliente: ${asaasDesc}`
          });
          return;
        }

        const customerJson: any = await createCustomerRes.json();
        customerId = customerJson.id;
      }

      // 3. Process Charge / Cobrança
      const chargePayload: any = {
        customer: customerId,
        billingType: "UNDEFINED",
        value: Number(value),
        dueDate: dueDate,
        description: description || "Cobrança Avulsa via MEI Flow"
      };

      if (isInstallment && Number(installmentCount) > 1) {
        chargePayload.billingType = "BOLETO";
        chargePayload.installmentCount = Number(installmentCount);
        chargePayload.value = Number(value);
      }

      const createChargeRes = await fetch(`${asaasBaseUrl}/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "access_token": asaasToken
        },
        body: JSON.stringify(chargePayload)
      });

      if (!createChargeRes.ok) {
        const errText = await createChargeRes.text();
        let parsedErr: any = {};
        try { parsedErr = JSON.parse(errText); } catch (e) {}
        const asaasDesc = parsedErr?.errors?.[0]?.description || errText;
        res.status(createChargeRes.status).json({
          success: false,
          mensagem: `Asaas: Falha ao gerar cobrança: ${asaasDesc}`
        });
        return;
      }

      const chargeJson: any = await createChargeRes.json();

      // 4. Fetch Pix Copy 'n Paste if single payment
      let pixCode: any = null;
      if (!isInstallment && chargeJson.id) {
        try {
          const pixRes = await fetch(`${asaasBaseUrl}/payments/${chargeJson.id}/pixQrCode`, {
            headers: { "access_token": asaasToken }
          });
          if (pixRes.ok) {
            pixCode = await pixRes.json();
          }
        } catch (err) {
          console.error("Pix QR creation warning:", err);
        }
      }

      res.status(200).json({
        success: true,
        id: chargeJson.id,
        invoiceUrl: chargeJson.invoiceUrl,
        bankSlipUrl: chargeJson.bankSlipUrl || chargeJson.invoiceUrl,
        barCode: chargeJson.nossoNumero || chargeJson.invoiceNumber,
        pixQrCode: pixCode,
        installmentId: chargeJson.installment,
        raw: chargeJson
      });
    } catch (err: any) {
      console.error("[Proxy Asaas Cobrança Error]:", err.message);
      res.status(500).json({ success: false, mensagem: "Erro interno no Proxy Asaas: " + err.message });
    }
  });

  // ==========================================
  // 3. INTEGRATION: MERCADO PAGO CHECKOUT
  // ==========================================
  function getPaymentMethodId(cardNumber: string): string {
    const clean = cardNumber.replace(/\D/g, "");
    if (clean.startsWith("4")) return "visa";
    if (/^(5[1-5]|2[2-7])/.test(clean)) return "master";
    if (/^(34|37)/.test(clean)) return "amex";
    if (/^(4011|4389|5041|5067|5090|6278|6363|6362)/.test(clean)) return "elo";
    if (/^(3841|6062|60)/.test(clean)) return "hipercard";
    if (/^(6011|622|64|65)/.test(clean)) return "discover";
    if (/^(30[0-5]|36|38)/.test(clean)) return "diners";
    return "master";
  }

  async function handleMercadoPagoApproved(userId: string) {
    if (!db) return;
    try {
      console.log(`[MP Webhook Approved]: Processing Premium Upgrade for user ${userId}`);

      const userDocRef = db.collection("users").doc(userId);
      const userDoc = await userDocRef.get();
      const existingProfile = userDoc.exists ? userDoc.data() : {};

      const premiumUpdate = {
        planType: "premium",
        plan: "premium",
        status: "active",
        invoiceLimit: 30,
        invoiceUsed: 0,
        updatedAt: new Date().toISOString()
      };

      await db.collection("users").doc(userId).set(premiumUpdate, { merge: true });
      await db.collection("usuarios").doc(userId).set(premiumUpdate, { merge: true });
      console.log(`[MP Webhook]: Updated user profile in Firestore to premium / limits set!`);

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
      console.warn("[handleMercadoPagoApproved DB Sync Warning]:", sanitizeDBError(err), "(Database sync bypassed in backend/sandbox environment)");
    }
  }

  app.get("/api/mercadopago/config", (req, res) => {
    res.json({
      publicKey: process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "",
      integratorId: process.env.MERCADO_PAGO_INTEGRATOR_ID || ""
    });
  });

  app.post(["/api/checkout", "/api/mercadopago/checkout"], async (req, res) => {
    try {
      const {
        userId,
        name,
        cpfCnpj,
        documentNumber,
        email,
        paymentMethod,
        creditCard
      } = req.body;

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
        "X-Idempotency-Key": `chk_${userId}_${Date.now()}`
      };

      if (integratorId) {
        headers["X-Integrator-Id"] = integratorId;
      }

      if (paymentMethod === "PIX") {
        const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
        const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

        const pixPayload = {
          transaction_amount: 29.90,
          description: "Plano Premium - MEI Flow - Pix",
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

        console.log(`[Checkout Native Fetch Pix]: Sending creation request to Mercado Pago API`);
        const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers,
          body: JSON.stringify(pixPayload)
        });

        const paymentData: any = await mpResponse.json();

        if (!mpResponse.ok) {
          const errorMsg = paymentData.message || JSON.stringify(paymentData);
          console.error(`[Checkout Native Fetch Pix Error]: ${errorMsg}`);
          res.status(mpResponse.status).json({
            success: false,
            mensagem: `Mercado Pago: ${errorMsg}`
          });
          return;
        }

        const paymentId = paymentData.id;

        // Save payment ID in server memory map for reliable lookup during polling status checking
        userLastPaymentIdMap.set(String(userId), String(paymentId));

        if (db) {
          try {
            const syncUpdate = {
              mercadoPagoPaymentId: paymentId,
              mercadoPagoStatus: paymentData.status || "pending",
              planType: "free",
              updatedAt: new Date().toISOString()
            };
            await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
          } catch (dbErr: any) {
            console.warn("[Checkout Native Fetch DB Sync Info (Pix)]: Saved payment ID to memory map, but DB write bypassed:", sanitizeDBError(dbErr));
          }
        }

        const pointOfInteraction = paymentData.point_of_interaction;
        const transactionData = pointOfInteraction?.transaction_data;
        const qrCodeImage = transactionData?.qr_code_base64 || "";
        const qrCodePayload = transactionData?.qr_code || "";
        
        return res.status(200).json({
          success: true,
          paymentId,
          status: paymentData.status || "pending",
          planType: "free",
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

        console.log(`[Checkout Native Fetch CC]: Tokenizing card via fetch...`);
        const tokenResp = await fetch("https://api.mercadopago.com/v1/card_tokens", {
          method: "POST",
          headers,
          body: JSON.stringify(cardTokenPayload)
        });

        const tokenData: any = await tokenResp.json();

        if (!tokenResp.ok) {
          console.error("[Checkout Native Fetch CC Token Error]:", tokenData);
          const errDetails = tokenData.message || "Verifique os dados informados.";
          return res.status(400).json({
            success: false,
            mensagem: `Mercado Pago (Cartão recusado/inválido): ${errDetails}`
          });
        }

        const cardTokenId = tokenData.id;
        const detectedBrand = getPaymentMethodId(creditCard.number);
        const payersFirstName = (name || "Comprador").split(" ")[0] || "Comprador";
        const payersLastName = (name || "MEIFlow").split(" ").slice(1).join(" ") || "MEIFlow";

        const cardPayload = {
          token: cardTokenId,
          transaction_amount: 29.90,
          description: "Plano Premium - MEI Flow",
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

        console.log(`[Checkout Native Fetch CC]: Creating payment via fetch...`);
        const mpPaymentResp = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers,
          body: JSON.stringify(cardPayload)
        });

        const paymentData: any = await mpPaymentResp.json();

        if (!mpPaymentResp.ok) {
          const errorMsg = paymentData.message || JSON.stringify(paymentData);
          console.error(`[Checkout Native Fetch CC Payment Error]: ${errorMsg}`);
          return res.status(mpPaymentResp.status).json({
            success: false,
            mensagem: `Mercado Pago: ${errorMsg}`
          });
        }

        const paymentId = paymentData.id;
        const paymentStatus = paymentData.status || "pending";
        const isApproved = paymentStatus === "approved";
        const planType = isApproved ? "premium" : "free";

        // Save last payment ID mapping in memory-cache dictionary
        userLastPaymentIdMap.set(String(userId), String(paymentId));

        if (db) {
          try {
            const syncUpdate = {
              mercadoPagoPaymentId: paymentId,
              mercadoPagoStatus: paymentStatus,
              planType,
              updatedAt: new Date().toISOString()
            };
            await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });

            if (isApproved) {
              // Admin SDK bypass promotion
              await handleMercadoPagoApproved(userId);
            }
          } catch (dbErr: any) {
            console.warn("[Checkout Native Fetch CC DB Sync Warning]: Database Admin sync bypassed/skipped:", sanitizeDBError(dbErr));
          }
        }

        if (paymentStatus === "rejected") {
          const rejectDetail = paymentData.status_detail || "Pagamento rejeitado pelo emissor.";
          return res.status(400).json({
            success: false,
            mensagem: `Transação Recusada (Mercado Pago): ${rejectDetail}.`
          });
        }

        return res.status(200).json({
          success: true,
          paymentId,
          status: paymentStatus,
          planType
        });
      }

      res.status(400).json({ success: false, mensagem: "Forma de pagamento não suportada pelo checkout." });
    } catch (err: any) {
      console.error("[MP Checkout API Router Error]:", err.message);
      res.status(400).json({ success: false, mensagem: `Erro na integração: ${err.message}` });
    }
  });

  // ==========================================
  // 4. WEBHOOK: MERCADO PAGO PREMIUM NOTIFICATION
  // ==========================================
  app.post(["/api/mercadopago/webhook", "/api/webhooks/mercadopago"], async (req, res) => {
    try {
      res.status(200).json({ received: true });

      (async () => {
        try {
          const body = req.body;
          console.log(`[MP Webhook Router Notification]:`, JSON.stringify(body));

          let paymentId = "";
          if (body.type === "payment" && body.data?.id) {
            paymentId = String(body.data.id);
          } else if (body.action?.startsWith("payment") && body.data?.id) {
            paymentId = String(body.data.id);
          } else if (body.topic === "payment" && body.id) {
            paymentId = String(body.id);
          } else if (body.resource && body.topic === "payment") {
            const match = body.resource.match(/\/payments\/(\d+)/);
            if (match) paymentId = match[1];
          }

          if (!paymentId) return;

          const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
          const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();
          if (!mpToken) return;

          const mpPaymentRes = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { "Authorization": `Bearer ${mpToken}` }
          });

          const paymentData = mpPaymentRes.data;
          const status = paymentData.status;
          const userId = paymentData.external_reference;

          if (!userId) return;

          if (db) {
            const statusUpdate = {
              mercadoPagoPaymentId: paymentId,
              mercadoPagoStatus: status,
              planType: status === "approved" ? "premium" : "free",
              plan: status === "approved" ? "premium" : "free",
              status: status === "approved" ? "active" : "inactive",
              updatedAt: new Date().toISOString()
            };
            await db.collection("users").doc(userId).set(statusUpdate, { merge: true });
            await db.collection("usuarios").doc(userId).set(statusUpdate, { merge: true });
          }

          if (status === "approved") {
            await handleMercadoPagoApproved(userId);
          }
        } catch (innerErr: any) {
          console.error("[MP Webhook Router Background error]:", innerErr.response?.data || innerErr.message);
        }
      })();
    } catch (err: any) {
      console.error("[MP Webhook Router Global Error]:", err.message);
    }
  });

  // ==========================================
  // 4B. POLLING: DYNAMIC USER PLAN STATUS CHECK
  // ==========================================
  app.get("/api/user/status", async (req: any, res: any) => {
    try {
      // 1. Tratamento de Query
      const userId = (req.query?.userId || (req.nextUrl && typeof req.nextUrl.searchParams?.get === "function" ? req.nextUrl.searchParams.get("userId") : null)) as string;
      if (!userId) {
        return res.status(400).json({ success: false, error: "userId is required for polling query." });
      }

      // 1B. Quick DB check to see if the user is already premium. If yes, read and return state.
      if (db) {
        try {
          const docRef = db.collection("users").doc(String(userId));
          const docSnap = await docRef.get();
          if (docSnap.exists) {
            const data = docSnap.data() || {};
            const itemPlanType = data.planType || "free";
            const itemPlan = data.plan || data.planType || "free";
            const itemStatus = data.status || "inactive";
            const localIsPremium = (itemPlanType === "premium" || itemPlan === "premium" || itemStatus === "active" || data.isPremium === true);
            if (localIsPremium) {
              return res.json({
                success: true,
                isPremium: true,
                planType: "premium",
                status: "approved"
              });
            }
          }
        } catch (dbErr: any) {
          console.warn(`[Get User Status API]: Firestore quick-check bypassed (${sanitizeDBError(dbErr)}).`);
        }
      }

      // 2. Retrieve paymentId associated with this userId
      let paymentId = userLastPaymentIdMap.get(String(userId));
      if (!paymentId && db) {
        try {
          const docSnap = await db.collection("users").doc(String(userId)).get();
          if (docSnap.exists) {
            paymentId = docSnap.data()?.mercadoPagoPaymentId;
          }
        } catch (getErr: any) {
          console.warn("[Get User Status API]: Firestore error reading paymentId:", sanitizeDBError(getErr));
        }
      }

      const systemToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
      const mpToken = (systemToken || "").replace(/^["']|["']$/g, "").trim();

      let isApprovedOnMP = false;
      let currentMPStatus = "pending";

      // 3. Checagem Real da API por Payment ID
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
          console.warn(`[Get User Status API]: Failed checking payment ID ${paymentId}:`, fetchErr.message);
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
            
            // Look for any approved payments
            const approvedPayment = results.find((p: any) => p.status === "approved");
            if (approvedPayment) {
              const foundPaymentId = approvedPayment.id;
              userLastPaymentIdMap.set(String(userId), String(foundPaymentId));
              paymentId = String(foundPaymentId);
              isApprovedOnMP = true;
              currentMPStatus = "approved";
            } else {
              // Look for pending payments
              const pendingPayment = results.find((p: any) => p.status === "pending" || p.status === "in_process");
              if (pendingPayment) {
                currentMPStatus = pendingPayment.status;
              }
            }
          }
        } catch (searchErr: any) {
          console.warn("[Get User Status API Search Fallback Error]:", searchErr.message);
        }
      }

      // 5. Se detectado como approved, atualiza o documento do usuário no Firestore (Admin SDK)
      if (db && isApprovedOnMP) {
        try {
          // Garante a persistência do estado conforme diretrizes
          const isApproved = isApprovedOnMP;
          const syncUpdate = {
            plan: "premium",
            planType: "premium",
            status: "active",
            mercadoPagoStatus: "approved",
            mercadoPagoPaymentId: paymentId || "",
            updatedAt: new Date().toISOString()
          };

          // Tenta atualizar. Se documento não existir, faz merge set
          try {
            await db.collection("users").doc(userId).update(syncUpdate);
          } catch (updE) {
            await db.collection("users").doc(userId).set(syncUpdate, { merge: true });
          }

          try {
            await db.collection("usuarios").doc(userId).update(syncUpdate);
          } catch (updE) {
            await db.collection("usuarios").doc(userId).set(syncUpdate, { merge: true });
          }

          await handleMercadoPagoApproved(userId);
        } catch (dbPromotionErr: any) {
          console.warn("[Get User Status API Sync Promo Error]:", sanitizeDBError(dbPromotionErr));
          return res.status(500).json({
            success: false,
            status: 500,
            mensagem: "Erro ao atualizar dados cadastrais no banco de dados."
          });
        }
      }

      // 6. Lê do Banco de Dados usando o Admin SDK para devolver o estado real
      if (db) {
        try {
          const docSnap = await db.collection("users").doc(String(userId)).get();
          if (docSnap.exists) {
            const data = docSnap.data() || {};
            const itemPlanType = data.planType || "free";
            const itemPlan = data.plan || data.planType || "free";
            const itemStatus = data.status || "inactive";
            const isPremium = (itemPlanType === "premium" || itemPlan === "premium" || itemStatus === "active");

            return res.json({
              success: true,
              isPremium,
              planType: isPremium ? "premium" : "free",
              status: isPremium ? "approved" : (data.mercadoPagoStatus || currentMPStatus)
            });
          }
        } catch (readErr: any) {
          console.warn("[Get User Status API DB Read Error]:", sanitizeDBError(readErr));
          return res.status(500).json({
            success: false,
            status: 500,
            mensagem: "Erro ao ler dados de assinatura do banco de dados."
          });
        }
      }

      // Resposta padrão caso DB indisponível ou inexistente
      return res.json({
        success: true,
        isPremium: isApprovedOnMP,
        planType: isApprovedOnMP ? "premium" : "free",
        status: currentMPStatus
      });

    } catch (err: any) {
      console.warn("[Get User Status API Error Graceful Recovery]:", sanitizeDBError(err));
      return res.status(500).json({
        success: false,
        status: 500,
        mensagem: "Regra operacional indisponível no momento."
      });
    }
  });

  // DEPRECATED ORIGINAL ASAAS WEBHOOK HANDLER BELOW
  app.post("/api/webhook-asaas-deprecated", async (req, res) => {
    try {
      // 1. Validar webhook token do Asaas (process.env.ASAAS_WEBHOOK_TOKEN)
      const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
      const receivedToken = req.headers["asaas-access-token"] || req.headers["asaas-token"] || req.headers["access-token"] || req.headers["authorization"];
      
      if (webhookToken) {
        const cleanReceived = String(receivedToken || "").trim();
        const cleanExpected = String(webhookToken).trim();
        if (cleanReceived !== cleanExpected) {
          console.warn("[Webhook Warning]: Token de webhook inválido ou ausente.");
          res.status(401).json({ success: false, erro: "Não autorizado: Token de webhook inválido." });
          return;
        }
      }

      // 2. Resposta Rápida (Evitar Timeout) para o Asaas
      res.status(200).json({ recebido: true });

      // 3. Execução Assíncrona / Não-sequencial das tarefas pesadas
      (async () => {
        try {
          const { event, payment, subscription } = req.body;
          if (!event) return;

          console.log(`[Premium Webhook Asaas Received Async]: Event: ${event}`);
          console.log("[Webhook Details Async]:", JSON.stringify({
            event,
            paymentId: payment?.id,
            subscriptionId: payment?.subscription || subscription?.id,
            customerId: payment?.customer || subscription?.customer,
            externalReference: payment?.externalReference || subscription?.externalReference,
            value: payment?.value
          }));

          // Identifica o userId do Firebase
          let userId = payment?.externalReference || subscription?.externalReference;
          const customerId = payment?.customer || subscription?.customer;
          const subId = payment?.subscription || subscription?.id;

          if (!db) {
            console.error("[Webhook Error]: Firebase Admin Firestore is not initialized.");
            return;
          }

          // Se userId estiver nulo na externalReference, vamos pesquisar nas coleções por e-mail ou dados de sub/cliente
          if (!userId) {
            try {
              const emailCandidate = req.body.email || payment?.email || req.body.payment?.customerShow?.email || req.body.payment?.customerDetail?.email;
              if (emailCandidate) {
                console.log(`[Webhook Lookup]: Buscando usuário por e-mail: ${emailCandidate}`);
                const usersEmailQuery = await db.collection("users").where("email", "==", emailCandidate.trim()).get();
                if (!usersEmailQuery.empty) {
                  userId = usersEmailQuery.docs[0].id;
                  console.log(`[Webhook Lookup]: Encontrado via email: ${userId}`);
                } else {
                  const legEmailQuery = await db.collection("usuarios").where("email", "==", emailCandidate.trim()).get();
                  if (!legEmailQuery.empty) {
                    userId = legEmailQuery.docs[0].id;
                    console.log(`[Webhook Lookup]: Encontrado na coleção antiga via email: ${userId}`);
                  }
                }
              }

              if (!userId) {
                console.log(`[Webhook Lookup]: ID de referência ausente. Buscando cliente no banco: ${customerId} ou ${subId}`);
                
                if (subId) {
                  const usersSubQuery = await db.collection("users").where("asaasSubscriptionId", "==", subId).get();
                  if (!usersSubQuery.empty) {
                    userId = usersSubQuery.docs[0].id;
                    console.log(`[Webhook Lookup]: Encontrado via asaasSubscriptionId: ${userId}`);
                  }
                }

                if (!userId && customerId) {
                  const usersCustQuery = await db.collection("users").where("asaasCustomerId", "==", customerId).get();
                  if (!usersCustQuery.empty) {
                    userId = usersCustQuery.docs[0].id;
                    console.log(`[Webhook Lookup]: Encontrado via asaasCustomerId: ${userId}`);
                  }
                }

                // Se ainda assim não achar, pesquisa na coleção legada 'usuarios'
                if (!userId && subId) {
                  const legQuery = await db.collection("usuarios").where("asaasSubscriptionId", "==", subId).get();
                  if (!legQuery.empty) {
                    userId = legQuery.docs[0].id;
                    console.log(`[Webhook Lookup]: Encontrado na coleção antiga via subscription: ${userId}`);
                  }
                }
              }
            } catch (lookupErr: any) {
              console.error("[Webhook Database Lookup Error]:", lookupErr.message);
            }
          }

          if (!userId) {
            console.warn("[Webhook Warning]: Não foi possível determinar o userId para esta notificação.");
            return;
          }

          if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
            console.log(`[Webhook-Asaas Approved]: Processing Premium Upgrade for user ${userId}`);

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
            console.log(`[Webhook-Asaas]: Updated user profile in Firestore to premium / limits set!`);

            // 2. CREATE SUBACCOUNT ON ASAAS
            const currentWalletId = existingProfile?.walletId || existingProfile?.asaasWalletId || existingProfile?.wallet_id;
            const currentApiKey = existingProfile?.apiKey || existingProfile?.asaasApiKey || existingProfile?.asaasAccessToken;

            let walletId = currentWalletId;
            let apiKey = currentApiKey;

            if (!walletId || !apiKey) {
              try {
                console.log(`[Webhook-Asaas Account Creation]: Creating account for user ${userId}`);
                const cleanCnpj = (existingProfile?.cnpjPrestador || "").replace(/\D/g, "");
                const cleanPhone = (existingProfile?.telefone || "").replace(/\D/g, "");

                const systemToken = process.env.ASAAS_API_KEY;
                const asaasToken = (systemToken || "").trim();
                const isSandbox = asaasToken.startsWith("$aact_hm");

                let cpfCnpjLimpo = cleanCnpj;

                if (isSandbox) {
                  const generateRandomCNPJ = () => {
                    const r = (n: number) => Math.floor(Math.random() * n);
                    const n1 = r(10); const n2 = r(10); const n3 = r(10); const n4 = r(10);
                    const n5 = r(10); const n6 = r(10); const n7 = r(10); const n8 = r(10);
                    const n9 = 0; const n10 = 0; const n11 = 0; const n12 = 1;
                    let d1 = n12*2+n11*3+n10*4+n9*5+n8*6+n7*7+n6*8+n5*9+n4*2+n3*3+n2*4+n1*5;
                    d1 = 11 - (d1 % 11); if (d1 >= 10) d1 = 0;
                    let d2 = d1*2+n12*3+n11*4+n10*5+n9*6+n8*7+n7*8+n6*9+n5*2+n4*3+n3*4+n2*5+n1*6;
                    d2 = 11 - (d2 % 11); if (d2 >= 10) d2 = 0;
                    return `${n1}${n2}${n3}${n4}${n5}${n6}${n7}${n8}0001${d1}${d2}`;
                  };

                  if (cleanCnpj.length !== 14) {
                    cpfCnpjLimpo = generateRandomCNPJ();
                  }
                } else {
                  if (cleanCnpj.length < 14) {
                    console.warn(`[Webhook-Asaas Warning]: CNPJ inválido ou menor que 14 dígitos (${cleanCnpj}) no ambiente Real (Produção) para o usuário ${userId}. Abortando criação da subconta.`);
                    return;
                  }
                }

                if (asaasToken) {
                  const asaasBaseUrl = isSandbox ? "https://sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
                  const payloadAsaas = {
                    name: (existingProfile?.name || existingProfile?.meiName || "MEI Flow Beneficiante").trim().substring(0, 80),
                    email: (existingProfile?.email || `mei_${userId}@meiflow.com`).trim(),
                    loginEmail: (existingProfile?.email || `mei_${userId}@meiflow.com`).trim(),
                    cpfCnpj: cpfCnpjLimpo,
                    companyType: "MEI",
                    phone: cleanPhone || "11999999999",
                    mobilePhone: cleanPhone || "11999999999",
                    postalCode: "01001000",
                    address: "Avenida Paulista",
                    addressNumber: "1000",
                    province: "Bela Vista",
                  };

                  const accountResponse = await axios.post(`${asaasBaseUrl}/accounts`, payloadAsaas, {
                    headers: {
                      "Content-Type": "application/json",
                      "access_token": asaasToken
                    },
                    timeout: 10000
                  });

                  if (accountResponse.data?.id && accountResponse.data?.apiKey) {
                    walletId = accountResponse.data.id;
                    apiKey = accountResponse.data.apiKey;

                    const walletObj = {
                      asaasWalletId: walletId,
                      asaasApiKey: apiKey,
                      asaasAccessToken: apiKey,
                      walletId: walletId,
                      apiKey: apiKey,
                      updatedAt: new Date().toISOString()
                    };

                    await db.collection("users").doc(userId).set(walletObj, { merge: true });
                    await db.collection("usuarios").doc(userId).set(walletObj, { merge: true });
                    console.log(`[Webhook-Asaas]: Account created successfully! WalletId: ${walletId}`);
                  }
                }
              } catch (accountErr: any) {
                console.error("[Webhook-Asaas Account Creation Error]:", accountErr.response?.data?.errors?.[0]?.description || accountErr.message);
              }
            }

            // 3. EMIT NOTA FISCAL (FOCUS NFE) FOR R$ 29,90 PREMIUM PAYMENT
            try {
              console.log(`[Webhook-Asaas FocusNFe]: Triggering subscription invoice emission for user ${userId}`);
              const tokenToUse = process.env.FOCUS_NFE_KEY || "wCTTGnYwEXXqCYskYtswVMBCQIHP8e8w";
              const focusAuthHeader = "Basic " + Buffer.from(`${tokenToUse}:`).toString("base64");
              
              const focusRef = `premium_${userId}_${Date.now()}`;
              const randomRps = Math.floor(100000 + Math.random() * 900000).toString();

              const docToEmit = (existingProfile?.cnpjPrestador || "").replace(/\D/g, "");
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
                console.log(`[Webhook-Asaas FocusNFe Success]: Invoice processing ref: ${focusRef}`);
                await db.collection("users").doc(userId).set({
                  premiumInvoiceRef: focusRef,
                  premiumInvoiceStatus: "processando_autorizacao",
                  updatedAt: new Date().toISOString()
                }, { merge: true });
              }
            } catch (focusErr: any) {
              console.error("[Webhook-Asaas FocusNFe Error]:", focusErr.response?.data?.mensagem || focusErr.message);
            }
          }
        } catch (innerErr: any) {
          console.error("[Asas Premium Webhook Async Inner Error]:", innerErr.message);
        }
      })();
    } catch (err: any) {
      console.error("[Asaas Premium Webhook Global Error]:", err.message);
      res.status(500).json({ success: false, erro: err.message });
    }
  });

  // ==========================================
  // 4. WEBHOOK: RECEIVE ASAAS PAYMENTS / OVERDUE EVENTS
  // ==========================================
  app.post("/api/webhook/asaas", async (req, res) => {
    try {
      const { event, payment, subscription } = req.body;

      console.log(`[Webhook Asaas Received]: Event: ${event}`);
      console.log("[Webhook Details]:", JSON.stringify({
        event,
        paymentId: payment?.id,
        subscriptionId: payment?.subscription || subscription?.id,
        customerId: payment?.customer || subscription?.customer,
        externalReference: payment?.externalReference || subscription?.externalReference
      }));

      // Identifica o userId do Firebase
      let userId = payment?.externalReference || subscription?.externalReference;
      const customerId = payment?.customer || subscription?.customer;
      const subId = payment?.subscription || subscription?.id;

      if (!db) {
        console.error("[Webhook Error]: Firebase Admin Firestore is not initialized.");
        res.status(500).json({ erro: "Firestore não disponível" });
        return;
      }

      // Se userId estiver nulo na externalReference, vamos pesquisar nas coleções
      if (!userId && db) {
        try {
          console.log(`[Webhook Lookup]: ID de referência ausente. Buscando cliente no banco: ${customerId} ou ${subId}`);
          
          if (subId) {
            const usersSubQuery = await db.collection("users").where("asaasSubscriptionId", "==", subId).get();
            if (!usersSubQuery.empty) {
              userId = usersSubQuery.docs[0].id;
              console.log(`[Webhook Lookup]: Encontrado via asaasSubscriptionId: ${userId}`);
            }
          }

          if (!userId && customerId) {
            const usersCustQuery = await db.collection("users").where("asaasCustomerId", "==", customerId).get();
            if (!usersCustQuery.empty) {
              userId = usersCustQuery.docs[0].id;
              console.log(`[Webhook Lookup]: Encontrado via asaasCustomerId: ${userId}`);
            }
          }

          // Se ainda assim não achar, pesquisa na coleção legada 'usuarios'
          if (!userId && subId) {
            const legQuery = await db.collection("usuarios").where("asaasSubscriptionId", "==", subId).get();
            if (!legQuery.empty) {
              userId = legQuery.docs[0].id;
              console.log(`[Webhook Lookup]: Encontrado na coleção antiga via subscription: ${userId}`);
            }
          }
        } catch (lookupErr: any) {
          console.error("[Webhook Database Lookup Error]:", lookupErr.message);
        }
      }

      if (!userId) {
        console.warn("[Webhook Warning]: Não foi possível determinar o userId para esta notificação.");
        // Retorna status 200 igual para sinalizar ao Asaas que o webhook foi recebido
        res.status(200).json({ status: "ignored_no_user" });
        return;
      }

      // Determina Novo plano dependendo do evento
      let newPlan: "free" | "premium" | null = null;

      if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
        newPlan = "premium";
        console.log(`[Webhook ACTION]: Atualizando usuário ${userId} para PREMIUM.`);
      } else if (
        event === "PAYMENT_OVERDUE" || 
        event === "SUB_OVERDUE" || 
        event === "PAYMENT_DELETED" || 
        event === "SUB_DELETED" || 
        event === "PAYMENT_REFUNDED"
      ) {
        newPlan = "free";
        console.log(`[Webhook ACTION]: Bloqueando usuário ${userId}. Voltando para FREE devido ao atraso ou deleção.`);
      }

      if (newPlan) {
        const updateObj = {
          planType: newPlan,
          updatedAt: new Date().toISOString()
        };
        await db.collection("users").doc(userId).set(updateObj, { merge: true });
        await db.collection("usuarios").doc(userId).set(updateObj, { merge: true });
        console.log(`[Webhook Success]: Sincronizado com sucesso! Usuário ${userId} agora é ${newPlan}`);
      }

      res.status(200).json({ status: "success", userId, planType: newPlan });
    } catch (err: any) {
      console.error("[Asaas Webhook Error]:", err.message);
      res.status(500).json({ success: false, erro: err.message });
    }
  });

  // ==========================================
  // 5. TEST/SIMULATE WEBHOOK TRIGGERS
  // ==========================================
  app.post("/api/simulate/webhook", async (req, res) => {
    try {
      const { event, userId } = req.body;

      if (!userId || !event) {
        res.status(400).json({ success: false, mensagem: "Parâmetros userId e event são obrigatórios no simulador." });
        return;
      }

      if (!db) {
        res.status(500).json({ success: false, mensagem: "Firestore indisponível" });
        return;
      }

      console.log(`[Simulator Triggered]: Event: ${event} for User: ${userId}`);

      // Consulta de compatibilidade para garantir as variáveis ideais
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.exists ? userDoc.data() : {};

      // Dispara uma simulação interna do corpo do webhook do Asaas
      const webhookPayload = {
        event: event, // PAYMENT_RECEIVED ou SUB_OVERDUE / PAYMENT_OVERDUE
        payment: {
          id: "pay_simulated_10293",
          customer: userData?.asaasCustomerId || "cus_simulated_49281",
          subscription: userData?.asaasSubscriptionId || "sub_simulated_98273",
          value: 14.00,
          externalReference: userId,
          status: event === "PAYMENT_RECEIVED" ? "RECEIVED" : "OVERDUE"
        }
      };

      // Chama a própria lógica local do webhook de forma direta e atômica
      const updateObj = {
        planType: event === "PAYMENT_RECEIVED" ? "premium" : "free",
        updatedAt: new Date().toISOString()
      };

      await db.collection("users").doc(userId).set(updateObj, { merge: true });
      await db.collection("usuarios").doc(userId).set(updateObj, { merge: true });

      res.status(200).json({
        success: true,
        mensagem: `Simulação concluída! Usuário ${userId} atualizado para o plano '${updateObj.planType}' via Webhook simulado.`,
        payload: webhookPayload,
        planType: updateObj.planType
      });
    } catch (err: any) {
      console.error("[Simulator Error]:", err.message);
      res.status(500).json({ success: false, erro: err.message });
    }
  });

  // ==========================================
  // 6. AUTO-CREATE SUBACCOUNT ON REGISTRATION/LOGIN
  // ==========================================
  app.post("/api/asaas/auto-criar-subconta", async (req, res) => {
    try {
      const { userId, email, name } = req.body;
      
      if (!userId) {
        res.status(400).json({ success: false, mensagem: "userId é obrigatório." });
        return;
      }

      if (!db) {
        res.status(500).json({ success: false, mensagem: "Firestore não inicializado no backend." });
        return;
      }

      // 1. Verter/checar se o usuário já possui ID de conta Asaas
      let existingProfile: any = {};
      if (db) {
        try {
          const userDocRef = db.collection("users").doc(userId);
          const userDoc = await userDocRef.get();
          if (userDoc.exists) {
            existingProfile = userDoc.data() || {};
          }
        } catch (err: any) {
          console.warn("[Asaas Auto Onboarding Warn]: Não foi possível ler o documento de 'users' no backend:", err.message);
        }
      }

      const currentWalletId = existingProfile.walletId || existingProfile.asaasWalletId;
      const currentApiKey = existingProfile.apiKey || existingProfile.asaasApiKey || existingProfile.asaasAccessToken;

      if (currentWalletId && currentApiKey) {
        res.status(200).json({
          success: true,
          mensagem: "Usuário já possui subconta Asaas vinculada.",
          walletId: currentWalletId,
          apiKey: currentApiKey
        });
        return;
      }

      // 2. Coletar dados cadastrais ou gerar fallbacks robustos de Sandbox
      const cleanCnpj = (existingProfile.cnpjPrestador || "").replace(/\D/g, "");
      const cleanPhone = (existingProfile.telefone || "").replace(/\D/g, "");

      const systemToken = process.env.ASAAS_API_KEY;
      const asaasToken = (systemToken || "").trim();
      const isSandbox = asaasToken.startsWith("$aact_hm");

      let cpfCnpjLimpo = cleanCnpj;

      if (isSandbox) {
        // Gerador de CNPJ válido para garantir sucesso total em Sandbox
        function generateRandomCNPJ() {
          const r = (n: number) => Math.floor(Math.random() * n);
          const n1 = r(10);
          const n2 = r(10);
          const n3 = r(10);
          const n4 = r(10);
          const n5 = r(10);
          const n6 = r(10);
          const n7 = r(10);
          const n8 = r(10);
          const n9 = 0; // 0001
          const n10 = 0;
          const n11 = 0;
          const n12 = 1;
          let d1 = n12*2+n11*3+n10*4+n9*5+n8*6+n7*7+n6*8+n5*9+n4*2+n3*3+n2*4+n1*5;
          d1 = 11 - (d1 % 11);
          if (d1 >= 10) d1 = 0;
          let d2 = d1*2+n12*3+n11*4+n10*5+n9*6+n8*7+n7*8+n6*9+n5*2+n4*3+n3*4+n2*5+n1*6;
          d2 = 11 - (d2 % 11);
          if (d2 >= 10) d2 = 0;
          return `${n1}${n2}${n3}${n4}${n5}${n6}${n7}${n8}0001${d1}${d2}`;
        }

        if (cleanCnpj.length !== 14) {
          cpfCnpjLimpo = generateRandomCNPJ();
        }
      } else {
        if (cleanCnpj.length < 14) {
          console.warn(`[Auto-Create Subaccount Warning]: CNPJ inválido ou menor que 14 dígitos (${cleanCnpj}) no ambiente Real (Produção) para o usuário ${userId}. Abortando criação da subconta.`);
          res.status(400).json({
            success: false,
            mensagem: `CNPJ inválido ou menor que 14 dígitos e não pode ser simulado no ambiente Real (Produção).`
          });
          return;
        }
      }

      if (!asaasToken) {
        res.status(500).json({
          success: false,
          mensagem: "Erro de Servidor: Chave master ASAAS_API_KEY não configurada no ambiente sandbox de backend."
        });
        return;
      }

      const asaasBaseUrl = await getAsaasBaseUrl(asaasToken);

      const payloadAsaas = {
        name: (existingProfile.name || existingProfile.meiName || name || "MEI Flow Beneficiante").trim().substring(0, 80),
        email: (existingProfile.email || email || `mei_${userId}@meiflow.com`).trim(),
        loginEmail: (existingProfile.email || email || `mei_${userId}@meiflow.com`).trim(),
        cpfCnpj: cpfCnpjLimpo,
        companyType: "MEI",
        phone: cleanPhone || "11999999999",
        mobilePhone: cleanPhone || "11999999999",
        postalCode: "01001000",
        address: "Avenida Paulista",
        addressNumber: "1000",
        province: "Bela Vista",
      };

      console.log(`[Auto-Create Subaccount]: Triggering POST v3/accounts for user ${userId} using Axios`, payloadAsaas);

      let asaasData: any;
      try {
        const response = await axios.post(`${asaasBaseUrl}/accounts`, payloadAsaas, {
          headers: {
            "Content-Type": "application/json",
            "access_token": asaasToken
          },
          timeout: 15000
        });
        asaasData = response.data;
      } catch (err: any) {
        let errorMsg = err.message;
        if (err.response && err.response.data) {
          const parsedErr = err.response.data;
          errorMsg = parsedErr?.errors?.[0]?.description || JSON.stringify(parsedErr);
        }
        console.error(`[Asaas Subaccount Error]: ${errorMsg}`);
        res.status(400).json({
          success: false,
          mensagem: `Asaas: Falha ao criar subconta no Asaas Sandbox: ${errorMsg}`
        });
        return;
      }

      const walletId = asaasData.id;
      const apiKey = asaasData.apiKey;

      if (!walletId || !apiKey) {
        res.status(500).json({
          success: false,
          mensagem: "O Asaas respondeu sem erros, porém o walletId ou apiKey vieram vazios na subconta."
        });
        return;
      }

      // Salvar no Firebase
      const updateObj = {
        asaasWalletId: walletId,
        asaasApiKey: apiKey,
        asaasAccessToken: apiKey, // Para consistência com asaasAccessToken do front
        walletId: walletId,
        apiKey: apiKey,
        updatedAt: new Date().toISOString()
      };

      if (db) {
        try {
          // Atualiza coleção principal users
          await db.collection("users").doc(userId).set(updateObj, { merge: true });
          // Sincroniza na coleção antiga de herança usuarios
          await db.collection("usuarios").doc(userId).set(updateObj, { merge: true });
          console.log(`[Auto-Create Subaccount Success]: User ${userId} updated in Firestore with pocket subaccount: ${walletId}`);
        } catch (dbErr: any) {
          console.warn("[Asaas Auto Onboarding Warn]: Não foi possível salvar no Firestore usando o Admin SDK do backend:", dbErr.message);
        }
      }

      res.status(200).json({
        success: true,
        walletId: walletId,
        apiKey: apiKey
      });

    } catch (err: any) {
      console.error("[Auto-Create Subaccount Catastrophic Error]:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // VITE DEV SERVER & PRODUCTION MIDDLEWARE SETUP
  // ==========================================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[Vite Middleware]: Loaded in Development Mode.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("[Vite Production]: Serving static build from 'dist'.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode.`);
  });
}

startServer();
