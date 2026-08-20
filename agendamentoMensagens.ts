/**
 * ============================================================================
 * MEI FLOW — Modelos de mensagem do Agendamento (Fase 5)
 * ============================================================================
 *
 * O QUE É ISTO
 *
 * Os TEXTOS que o profissional cola no WhatsApp pessoal dele — ver
 * claude/AGENDAMENTO_GOOGLE_CALENDAR_ESTRUTURA.md, seção 8, no projeto "Mei
 * Flow". Os LINKS que esses textos carregam já existem desde as fases
 * anteriores (convite: Fase 3; acompanhamento: Fase 4); esta fase só guarda o
 * texto ao redor deles, editável livremente pelo profissional — igual o
 * próprio desenho documenta: "não passam pela API oficial do WhatsApp, então
 * o profissional escreve/edita livremente".
 *
 * A SUBSTITUIÇÃO DOS PLACEHOLDERS ({nome_do_cliente}, {data_hora}, {link})
 * ACONTECE NO FRONT, não aqui. Este arquivo só guarda e devolve o TEXTO cru
 * do modelo — quem tem os dados de cada agendamento na hora de copiar é a
 * tela, não o servidor. Rota nova a cada cópia seria complexidade sem ganho.
 *
 * ----------------------------------------------------------------------------
 * UM DOCUMENTO POR PROFISSIONAL, COM PADRÃO PRONTO
 *
 * Se o profissional nunca abriu "Modelos de mensagem", o GET devolve os
 * textos padrão (não grava nada) — assim os botões de copiar já funcionam em
 * qualquer tela desde o primeiro agendamento, sem exigir uma etapa de
 * configuração antes.
 *
 * ----------------------------------------------------------------------------
 * COMO INSTALAR
 *
 * 1. Salve como  agendamentoMensagens.ts  na raiz.
 * 2. Em meiflow-server.ts E em server.ts:
 *      import { registrarRotasAgendamentoMensagens } from "./agendamentoMensagens";
 *      registrarRotasAgendamentoMensagens(app, db);
 * 3. Rotas com prefixo /api/agendamento/mensagens — já coberto pelo rewrite
 *    /api/agendamento/:path* no vercel.json. Nada novo lá.
 * 4. Regra de `modelos_mensagem` no firestore.rules — deny-all, mesmo padrão
 *    de `tipos_agendamento` e `disponibilidade_agenda`.
 */

import { exigirUsuario as verificarLogin } from "./auth-firebase.js";

async function exigirUsuario(req: any): Promise<string> {
  return verificarLogin(req);
}

function erroParaStatus(err: any): number {
  return err?.message === "NAO_AUTENTICADO" ? 401 : 500;
}

function mensagemDeErro(status: number, err: any): string {
  return status === 401 ? "Faça login para continuar." : err?.message || "Algo deu errado.";
}

const agora = () => new Date().toISOString();

// ============================================================================
// PADRÕES — o que qualquer profissional recebe antes de personalizar
// ============================================================================

export const MODELOS_PADRAO = {
  convite:
    "Olá! Para agendar seu horário comigo é só acessar o link abaixo e escolher o dia que funcionar melhor " +
    "pra você:\n{link}",
  confirmacao:
    "Olá, {nome_do_cliente}! Seu agendamento está confirmado para {data_hora}. Você pode acompanhar tudo por " +
    "aqui, inclusive reagendar ou cancelar se precisar:\n{link}",
  avaliacao:
    "Oi, {nome_do_cliente}! Muito obrigado por confiar no meu trabalho 🙏 Se puder, deixe uma avaliação — isso " +
    "me ajuda muito a chegar em mais gente:\n{link}",
};

const LIMITE_CARACTERES = 2000;

function validar(body: any): { erro?: string; dados?: typeof MODELOS_PADRAO & { linkAvaliacaoGoogle: string } } {
  const convite = String(body?.convite ?? "").trim();
  const confirmacao = String(body?.confirmacao ?? "").trim();
  const avaliacao = String(body?.avaliacao ?? "").trim();
  const linkAvaliacaoGoogle = String(body?.linkAvaliacaoGoogle ?? "").trim();

  for (const [nome, texto] of Object.entries({ convite, confirmacao, avaliacao })) {
    if (!texto) return { erro: `A mensagem de ${nome} não pode ficar em branco.` };
    if (texto.length > LIMITE_CARACTERES) {
      return { erro: `A mensagem de ${nome} pode ter no máximo ${LIMITE_CARACTERES} caracteres.` };
    }
  }
  if (linkAvaliacaoGoogle && !/^https?:\/\//i.test(linkAvaliacaoGoogle)) {
    return { erro: "O link de avaliação do Google precisa começar com http:// ou https://." };
  }

  return { dados: { convite, confirmacao, avaliacao, linkAvaliacaoGoogle } };
}

export function registrarRotasAgendamentoMensagens(app: any, db: any) {
  const col = () => db.collection("modelos_mensagem");

  app.get("/api/agendamento/mensagens", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const snap = await col().doc(uid).get();
      if (!snap.exists) {
        return res.json({ success: true, ...MODELOS_PADRAO, linkAvaliacaoGoogle: "", personalizado: false });
      }
      const d = snap.data();
      res.json({
        success: true,
        convite: d.convite || MODELOS_PADRAO.convite,
        confirmacao: d.confirmacao || MODELOS_PADRAO.confirmacao,
        avaliacao: d.avaliacao || MODELOS_PADRAO.avaliacao,
        linkAvaliacaoGoogle: d.linkAvaliacaoGoogle || "",
        personalizado: true,
      });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  app.put("/api/agendamento/mensagens", async (req: any, res: any) => {
    try {
      const uid = await exigirUsuario(req);
      const v = validar(req.body);
      if (v.erro) return res.status(400).json({ success: false, mensagem: v.erro });

      const registro = { userId: uid, ...v.dados, atualizadoEm: agora() };
      await col().doc(uid).set(registro);
      res.json({ success: true, ...v.dados, personalizado: true });
    } catch (err: any) {
      const s = erroParaStatus(err);
      res.status(s).json({ success: false, mensagem: mensagemDeErro(s, err) });
    }
  });

  console.log("[Agendamento] Rotas de mensagens registradas: /api/agendamento/mensagens");
}
