import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Load environment variables
dotenv.config();

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

let appInitialized = false;
if (firebaseConfig.projectId) {
  try {
    if (getApps().length === 0) {
      initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
    appInitialized = true;
    console.log(`[Firebase Admin]: Initialized securely for project: ${firebaseConfig.projectId}`);
  } catch (err: any) {
    console.error("[Firebase Admin Error]: Failed to initialize:", err.message);
  }
} else {
  console.warn("[Firebase Admin Warning]: No projectId found in firebase-applet-config.json. Firestore syncing will fail.");
}

const db = appInitialized ? getFirestore() : null;

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
  // 2. PROXY: ASAAS COBRANÇA
  // ==========================================
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

      const isProd = !asaasToken.startsWith("$") && !asaasToken.toLowerCase().includes("sandbox") && !asaasToken.toLowerCase().includes("test");
      const asaasBaseUrl = isProd ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
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
  // 3. INTEGRATION: CREATE SUBSCRIPTION (PREMIUM)
  // ==========================================
  app.post("/api/asaas/subscription", async (req, res) => {
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

      const isProd = !asaasToken.startsWith("$") && !asaasToken.toLowerCase().includes("sandbox") && !asaasToken.toLowerCase().includes("test");
      const asaasBaseUrl = isProd ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
      const cleanDoc = cpfCnpj.replace(/\D/g, "");

      console.log(`[Asaas Subscription]: Creating Premium subscription for ${name} (${cleanDoc})`);

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
        console.error("Asaas customer search warning during subscription:", err);
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
      // Definimos o primeiro vencimento para amanhã para gerar a cobrança imediatamente
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
        // Holder info is typically required
        subPayload.creditCardHolderInfo = {
          name: name,
          email: email,
          cpfCnpj: cleanDoc,
          postalCode: "01001000", // CEP paulista padrão para testes
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

      // 4. Salva a relação no Firestore com status pendente
      let planType: "free" | "premium" = "free";
      
      // Se for Cartão de Crédito e o status for ACTIVE diretamente, podemos já liberar o Premium
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
          console.log(`[Firestore Sync]: Linked subscriber ${userId} with subId ${subscriptionId}`);
        } catch (dbErr: any) {
          console.error("[Firestore Sync Error]:", dbErr.message);
        }
      }

      // 5. Busca cobrança gerada para a assinatura para disponibilizar formas de pagamento (como Pix/Boleto Link)
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
            
            // Se for PIX ou Boleto, gera o QR Code / informações
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
        console.error("Warning: Could not fetch sub payments:", payLinkErr);
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
      console.error("[Asaas Create Subscription Server Error]:", err.message);
      res.status(500).json({ success: false, mensagem: "Erro interno ao processar assinatura: " + err.message });
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
          value: 29.90,
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
