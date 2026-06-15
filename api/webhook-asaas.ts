import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import axios from "axios";

// Securely initialize Firebase Admin in serverless environment
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error("Error reading firebase-applet-config.json in serverless webhook:", err);
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
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    // 1. Validar webhook token do Asaas (process.env.ASAAS_WEBHOOK_TOKEN)
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    const receivedToken = req.headers["asaas-access-token"] || req.headers["asaas-token"] || req.headers["access-token"] || req.headers["authorization"];
    
    if (webhookToken) {
      const cleanReceived = String(receivedToken || "").trim();
      const cleanExpected = String(webhookToken).trim();
      if (cleanReceived !== cleanExpected) {
        console.warn("[Webhook Warning]: Token de webhook inválido ou ausente.");
        return res.status(401).json({ success: false, erro: "Não autorizado: Token de webhook inválido." });
      }
    }

    // 2. Resposta Rápida (Evitar Timeout)
    res.status(200).json({ recebido: true });

    // 3. Execução Assíncrona das tarefas pesadas
    (async () => {
      try {
        const { event, payment, subscription } = req.body;
        if (!event) return;

        console.log(`[Premium Serverless Webhook Received]: Event: ${event}`);

        // Identifica o userId do Firebase
        let userId = payment?.externalReference || subscription?.externalReference;
        const customerId = payment?.customer || subscription?.customer;
        const subId = payment?.subscription || subscription?.id;

        if (!db) {
          console.error("[Serverless Webhook Error]: Firebase Admin Firestore is not initialized.");
          return;
        }

        // Se userId estiver nulo na externalReference, vamos pesquisar nas coleções por e-mail ou dados de sub/cliente
        if (!userId) {
          try {
            const emailCandidate = req.body.email || payment?.email || req.body.payment?.customerShow?.email || req.body.payment?.customerDetail?.email;
            if (emailCandidate) {
              const usersEmailQuery = await db.collection("users").where("email", "==", emailCandidate.trim()).get();
              if (!usersEmailQuery.empty) {
                userId = usersEmailQuery.docs[0].id;
              } else {
                const legEmailQuery = await db.collection("usuarios").where("email", "==", emailCandidate.trim()).get();
                if (!legEmailQuery.empty) {
                  userId = legEmailQuery.docs[0].id;
                }
              }
            }

            if (!userId) {
              if (subId) {
                const usersSubQuery = await db.collection("users").where("asaasSubscriptionId", "==", subId).get();
                if (!usersSubQuery.empty) {
                  userId = usersSubQuery.docs[0].id;
                }
              }

              if (!userId && customerId) {
                const usersCustQuery = await db.collection("users").where("asaasCustomerId", "==", customerId).get();
                if (!usersCustQuery.empty) {
                  userId = usersCustQuery.docs[0].id;
                }
              }

              if (!userId && subId) {
                const legQuery = await db.collection("usuarios").where("asaasSubscriptionId", "==", subId).get();
                if (!legQuery.empty) {
                  userId = legQuery.docs[0].id;
                }
              }
            }
          } catch (lookupErr: any) {
            console.error("[Serverless Webhook Lookup Error]:", lookupErr.message);
          }
        }

        if (!userId) {
          console.warn("[Serverless Webhook Warning]: Não foi possível determinar o userId.");
          return;
        }

        if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
          console.log(`[Serverless Webhook-Asaas Approved]: Processing Premium Upgrade for user ${userId}`);

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
          console.log(`[Serverless Webhook]: Updated user profile in Firestore to premium / limits set!`);

          // 2. CREATE SUBACCOUNT ON ASAAS
          const currentWalletId = existingProfile?.walletId || existingProfile?.asaasWalletId || existingProfile?.wallet_id;
          const currentApiKey = existingProfile?.apiKey || existingProfile?.asaasApiKey || existingProfile?.asaasAccessToken;

          let walletId = currentWalletId;
          let apiKey = currentApiKey;

          if (!walletId || !apiKey) {
            try {
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
                  console.warn(`[Serverless Webhook Warning]: CNPJ inválido ou menor que 14 dígitos (${cleanCnpj}) no ambiente Real (Produção) para o usuário ${userId}. Abortando criação da subconta.`);
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
                }
              }
            } catch (accountErr: any) {
              console.error("[Serverless Webhook Account Creation Error]:", accountErr.message);
            }
          }

          // 3. EMIT NOTA FISCAL (FOCUS NFE) FOR R$ 29,90 PREMIUM PAYMENT
          try {
            const tokenToUse = (process.env.FOCUS_NFE_KEY || "").trim();
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

            const isAsaasSandbox = (process.env.ASAAS_API_KEY || "").trim().startsWith("$aact_hm");
            const focusUrl = isAsaasSandbox ? "https://homologacao.focusnfe.com.br/v2/nfse" : "https://api.focusnfe.com.br/v2/nfse";
            const focusResponse = await axios.post(focusUrl, focusNfePayload, {
              headers: {
                "Content-Type": "application/json",
                "Authorization": focusAuthHeader
              },
              timeout: 10000
            });

            if (focusResponse.status === 201 || focusResponse.status === 200) {
              await db.collection("users").doc(userId).set({
                premiumInvoiceRef: focusRef,
                premiumInvoiceStatus: "processando_autorizacao",
                updatedAt: new Date().toISOString()
              }, { merge: true });
            }
          } catch (focusErr: any) {
            console.error("[Serverless Webhook FocusNFe Error]:", focusErr.message);
          }
        }
      } catch (innerErr: any) {
        console.error("[Serverless Webhook Async Inner Error]:", innerErr.message);
      }
    })();
  } catch (err: any) {
    console.error("[Serverless Webhook Global Error]:", err.message);
    res.status(500).json({ success: false, erro: err.message });
  }
}
