/**
 * ============================================================================
 * TESTES DA CENTRAL DE NOTIFICAÇÕES
 * ============================================================================
 * Rodar: npx tsx src/utils/notificacoes.test.ts
 *
 * O que precisa continuar verdade, em ordem de gravidade:
 * 1. O DAS avisa exatamente 1 dia antes e no dia — nem cedo, nem tarde, e o
 *    ajuste de fim de semana não pode empurrar o aviso para o dia errado.
 * 2. Recebimento SEM previsão nunca gera aviso — é a diferença entre "aviso
 *    útil" e "alarme inventado" que motivou este recurso inteiro.
 * 3. Recebimento com previsão só avisa a partir do dia (nunca antes), e some
 *    quando marcado como recebido (não é responsabilidade deste arquivo, mas
 *    o filtro por `situacao === "aguardando"` é o que garante isso).
 */

import {
  vencimentoDasDoMes,
  notificacaoDas,
  notificacoesRecebimento,
  notificacaoLimiteMei,
  notificacaoCertificado,
  notificacaoCobrancasVencidas,
  ordenarNotificacoes,
} from "./notificacoes";

let passou = 0;
let falhou = 0;
function t(nome: string, condicao: boolean, detalhe?: unknown) {
  if (condicao) passou++;
  else {
    falhou++;
    console.error(`  ✗ ${nome}${detalhe !== undefined ? `\n      obtido: ${JSON.stringify(detalhe)}` : ""}`);
  }
}
function bloco(titulo: string) { console.log(`\n${titulo}`); }

/* ========================================================================== */
bloco("Regra do dia 20 (DAS)");

t("dia 20 de agosto/2026 é quinta — fica no dia 20", vencimentoDasDoMes("2026-08-01") === "2026-08-20", vencimentoDasDoMes("2026-08-01"));
t("dia 20 de junho/2026 é sábado — empurra para segunda 22", vencimentoDasDoMes("2026-06-01") === "2026-06-22", vencimentoDasDoMes("2026-06-01"));
t("dia 20 de setembro/2026 é domingo — empurra para segunda 21", vencimentoDasDoMes("2026-09-01") === "2026-09-21", vencimentoDasDoMes("2026-09-01"));

bloco("Aviso do DAS");

t("um dia antes do vencimento (19/08) avisa 'amanhã'", notificacaoDas("2026-08-19").length === 1 && notificacaoDas("2026-08-19")[0].id.endsWith("amanha"));
t("no dia do vencimento (20/08) avisa 'hoje', urgente", notificacaoDas("2026-08-20")[0]?.severidade === "urgente");
t("dois dias antes não avisa nada", notificacaoDas("2026-08-18").length === 0);
t("um dia depois não avisa nada (não sabemos se foi pago)", notificacaoDas("2026-08-21").length === 0);
t("no mês com vencimento empurrado (22/06, segunda), o dia 22 avisa 'hoje'", notificacaoDas("2026-06-22")[0]?.titulo.includes("hoje"));
t("e o dia 21/06 (domingo, véspera do vencimento empurrado) avisa 'amanhã'", notificacaoDas("2026-06-21").length === 1, notificacaoDas("2026-06-21"));
t("mas a sexta 19/06 (3 dias antes) não avisa nada", notificacaoDas("2026-06-19").length === 0);
t("mas o sábado 20/06 em si não gera aviso (não é dia útil de vencimento)", notificacaoDas("2026-06-20").length === 0);

/* ========================================================================== */
bloco("Recebimento com previsão");

const parcelas = [
  { vendaId: "v1", parcelaId: "p1", clienteNome: "Jonatan", valor: 15000, previsaoISO: "2026-08-10", situacao: "aguardando" as const },
  { vendaId: "v2", parcelaId: "p2", clienteNome: "Maria", valor: 500, previsaoISO: "2026-08-18", situacao: "aguardando" as const },
  { vendaId: "v3", parcelaId: "p3", clienteNome: "Carlos", valor: 2000, previsaoISO: "2026-08-25", situacao: "aguardando" as const },
  { vendaId: "v4", parcelaId: "p4", clienteNome: "Sem data", valor: 8000, situacao: "aguardando" as const }, // sem previsaoISO
  { vendaId: "v5", parcelaId: "p5", clienteNome: "Já pago", valor: 100, previsaoISO: "2026-08-01", situacao: "recebido" as const },
];

const hoje = "2026-08-18";
const avisos = notificacoesRecebimento(parcelas, hoje);

t("parcela sem previsão NUNCA gera aviso", !avisos.some((a) => a.vendaId === "v4"));
t("parcela já recebida não gera aviso mesmo com previsão passada", !avisos.some((a) => a.vendaId === "v5"));
t("previsão futura (25/08) não gera aviso ainda", !avisos.some((a) => a.vendaId === "v3"));
t("previsão de hoje (18/08) gera aviso 'aviso' (não urgente)", avisos.find((a) => a.vendaId === "v2")?.severidade === "aviso");
t("previsão passada (10/08) gera aviso urgente", avisos.find((a) => a.vendaId === "v1")?.severidade === "urgente");
t("o mais atrasado vem primeiro", avisos[0]?.vendaId === "v1", avisos.map((a) => a.vendaId));
t("total de 2 avisos (v1 e v2) — v3 e v4 e v5 ficam de fora", avisos.length === 2, avisos.length);
t("o texto cita o nome do cliente", avisos.find((a) => a.vendaId === "v1")?.titulo.includes("Jonatan"));

/* ========================================================================== */
bloco("Limite anual do MEI");

t("abaixo de 80% não avisa", notificacaoLimiteMei(50000, 81000).length === 0);
t("exatamente 80% avisa (aviso)", notificacaoLimiteMei(64800, 81000)[0]?.severidade === "aviso");
t("acima de 95% avisa urgente", notificacaoLimiteMei(78000, 81000)[0]?.severidade === "urgente");
t("limite zerado não quebra (sem divisão por zero)", notificacaoLimiteMei(1000, 0).length === 0);

/* ========================================================================== */
bloco("Certificado A1");

t("sem dado (nulo) não avisa", notificacaoCertificado(null).length === 0);
t("60 dias não avisa", notificacaoCertificado(60).length === 0);
t("30 dias avisa (aviso)", notificacaoCertificado(30)[0]?.severidade === "aviso");
t("7 dias avisa urgente", notificacaoCertificado(7)[0]?.severidade === "urgente");
t("já vencido (negativo) avisa urgente com texto de vencido", notificacaoCertificado(-3)[0]?.titulo.includes("vencido"));

/* ========================================================================== */
bloco("Boletos vencidos");

t("zero vencidos não avisa", notificacaoCobrancasVencidas(0, 0).length === 0);
t("um vencido usa singular", notificacaoCobrancasVencidas(1, 150).length === 1 && notificacaoCobrancasVencidas(1, 150)[0].titulo === "1 boleto vencido");
t("vários usa plural com quantidade", notificacaoCobrancasVencidas(5, 750)[0].titulo === "5 boletos vencidos");

/* ========================================================================== */
bloco("Ordenação final");

const misto = [
  ...notificacaoLimiteMei(78000, 81000), // urgente, categoria "limite"
  ...notificacaoDas("2026-08-19"), // aviso, categoria "das"
  ...notificacaoCertificado(5), // urgente, categoria "certificado"
];
const ordenado = ordenarNotificacoes(misto);
const primeiroAviso = ordenado.findIndex((n) => n.severidade === "aviso");
const ultimoUrgente = ordenado.map((n) => n.severidade).lastIndexOf("urgente");
t("todo urgente aparece antes de todo aviso", primeiroAviso === -1 || ultimoUrgente < primeiroAviso, { primeiroAviso, ultimoUrgente });
t("primeiro item é urgente", ordenado[0]?.severidade === "urgente");
t("último item é o aviso (DAS)", ordenado[ordenado.length - 1]?.categoria === "das");
t("dentro dos urgentes, DAS teria prioridade sobre certificado se ambos existissem", (() => {
  const ambos = ordenarNotificacoes([...notificacaoCertificado(5), ...notificacaoDas("2026-08-20")]);
  return ambos[0]?.categoria === "das";
})());

console.log(`\n${falhou === 0 ? "✓" : "✗"} ${passou} passaram, ${falhou} falharam\n`);
if (falhou > 0) process.exit(1);
