/**
 * Rota única da Vercel para os módulos do MEI Flow.
 *
 * POR QUE UM ARQUIVO SÓ:
 * O plano gratuito da Vercel permite no máximo 12 funções por publicação. O
 * projeto já usa 11 com as rotas antigas, então três arquivos separados
 * (efi, cobrancas, creditos) estouravam o limite. Este arquivo único atende
 * os três — continua sendo 1 função.
 *
 * COMO A VERCEL DECIDE QUEM RESPONDE:
 * Arquivo específico sempre ganha do curinga. Ou seja, /api/checkout continua
 * indo para api/checkout.ts, /api/documentos/upload continua indo para
 * api/documentos/upload.ts, e assim por diante. Só o que NÃO tem arquivo
 * próprio — /api/efi/..., /api/cobrancas/..., /api/creditos/... — cai aqui.
 *
 * Nenhuma rota existente muda de comportamento.
 */
import app from "../meiflow-server";

export default app;
