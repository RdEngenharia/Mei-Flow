/**
 * ============================================================================
 * MEI FLOW — Ponte para a Vercel
 * ============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Rodando na sua máquina, quem atende as rotas é o server.ts. Na Vercel, não:
 * lá quem responde são os arquivos dentro da pasta api/. Por isso o teste em
 * https://meiflow.rdhomologacao.com.br/api/efi/test-connection deu 404 — o
 * código estava certo, só não era ele que respondia.
 *
 * Este arquivo monta UMA vez o mesmo aplicativo Express com os três módulos, e
 * os arquivos em api/efi, api/cobrancas e api/creditos apenas o reaproveitam.
 * Assim não existe código duplicado: corrigir aqui vale para os dois mundos.
 *
 * ⚠️ Este arquivo fica na RAIZ do projeto, junto de server.ts, efi.ts,
 *    cobrancas.ts e creditos.ts. Não coloque dentro de api/ — tudo que está
 *    lá dentro a Vercel transforma em rota.
 */

import express from "express";
import path from "path";
import fs from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { registrarRotasEfi } from "./efi.js";
import { registrarRotasCobrancas } from "./cobrancas.js";
import { registrarRotasCreditos } from "./creditos.js";
import { registrarRotasNfse } from "./nfse.js";
import { registrarRotasEquipe } from "./equipe.js";
import { registrarRotasPlano } from "./plano.js";

// ---------------------------------------------------------------------------
// Firebase Admin — mesmo padrão do server.ts e dos outros arquivos de api/
// ---------------------------------------------------------------------------

function lerFirebaseConfig(): any {
  try {
    const p = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err: any) {
    console.error("[MEI Flow] Falha ao ler firebase-applet-config.json:", err.message);
  }
  return {};
}

const firebaseConfig = lerFirebaseConfig();

let adminApp: any = null;
try {
  if (getApps().length === 0) {
    const projectId = "mei-flow-692d9";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const bucket = firebaseConfig.storageBucket || "mei-flow-692d9.firebasestorage.app";

    if (clientEmail && privateKey) {
      adminApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
        storageBucket: bucket,
      });
    } else {
      adminApp = initializeApp({ projectId, storageBucket: bucket });
    }
  } else {
    adminApp = getApps()[0];
  }
} catch (err: any) {
  console.error("[MEI Flow] Falha ao iniciar Firebase Admin:", err.message);
}

let db: any = null;
let adminStorage: any = null;
if (adminApp) {
  try {
    const dbId = process.env.FIREBASE_DATABASE_ID || "(default)";
    db = dbId === "(default)" ? getFirestore(adminApp) : getFirestore(adminApp, dbId);
  } catch (err: any) {
    console.warn("[MEI Flow] Firestore indisponível:", err.message);
  }
  try {
    adminStorage = getStorage(adminApp);
  } catch (err: any) {
    console.warn("[MEI Flow] Storage indisponível:", err.message);
  }
}

// ---------------------------------------------------------------------------
// O aplicativo
// ---------------------------------------------------------------------------

const app = express();

// CORS — dentro do APK (Capacitor) a origem é "https://localhost", que sem
// isto seria bloqueada pelo navegador antes mesmo de sair do celular.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ⚠️ A Vercel já entrega o corpo da requisição pronto em req.body. Se o
// express.json() rodar depois disso, ele lê um fluxo já consumido e ZERA o
// corpo. Por isso só ativamos quando ninguém interpretou antes — o que faz o
// mesmo arquivo funcionar na Vercel e na máquina local.
app.use((req: any, res, next) => {
  if (req.body !== undefined) return next();
  express.json({ limit: "50mb" })(req, res, next);
});

registrarRotasEfi(app, db, adminStorage, firebaseConfig);
registrarRotasCobrancas(app, db);
registrarRotasCreditos(app, db);
registrarRotasNfse(app, db, adminStorage, firebaseConfig);
registrarRotasEquipe(app, db);
registrarRotasPlano(app, db);

// Rede de segurança: se alguém chamar uma rota que não existe, responde em
// JSON explicando, em vez da página de erro genérica da Vercel.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    mensagem: `Rota não encontrada: ${req.method} ${req.url}`,
    dica: "Confira o endereço. As rotas começam com /api/efi, /api/cobrancas, /api/creditos ou /api/nfse.",
  });
});

export default app;
export { db, adminStorage, firebaseConfig };
