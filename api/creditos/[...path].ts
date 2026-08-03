/**
 * Rota da Vercel para tudo que começa com /api/creditos/...
 *
 * Não tem lógica aqui de propósito: o código de verdade está em
 * creditos.ts, na raiz do projeto, e é montado por meiflow-server.ts.
 * Assim o mesmo código serve para a Vercel e para o server.ts local.
 */
import app from "../../meiflow-server";

export default app;
