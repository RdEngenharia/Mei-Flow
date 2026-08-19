/**
 * ============================================================================
 * TESTES DE CPF / CNPJ
 * ============================================================================
 * Rodar: npx tsx src/utils/documentoBR.test.ts
 *
 * O que precisa continuar verdade, em ordem de gravidade:
 * 1. CNPJ ALFANUMÉRICO (vigente desde 31/07/2026) não pode ser mutilado pela
 *    máscara. Se a letra sumir, o cadastro do cliente fica errado e a nota
 *    fiscal sai errada junto.
 * 2. A máscara nunca devolve separador solto no fim — senão o backspace trava.
 * 3. O dígito verificador confere tanto no CNPJ numérico de sempre quanto no
 *    alfanumérico novo (mesma conta, ASCII-48).
 * 4. "Incompleto" nunca é reportado como "inválido" — alarme falso a cada
 *    tecla é pior que não avisar.
 */

import {
  soDocumento,
  mascararDocumento,
  pareceCnpj,
  cpfValido,
  cnpjValido,
  documentoValido,
  documentoInvalidoCompleto,
  rotuloDocumento,
} from "./documentoBR";

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
bloco("Limpeza");

t("tira ponto, barra e traço", soDocumento("12.345.678/0001-90") === "12345678000190");
t("deixa passar letra maiúscula (CNPJ alfanumérico)", soDocumento("12.ABC.345/01DE-35") === "12ABC34501DE35");
t("sobe minúscula para maiúscula", soDocumento("12abc34501de35") === "12ABC34501DE35");
t("corta o que passa de 14", soDocumento("123456789012345678") === "12345678901234");
t("letra nas duas últimas posições é descartada (DV é sempre numérico)", soDocumento("12ABC34501DEXY") === "12ABC34501DE", soDocumento("12ABC34501DEXY"));
t("vazio devolve vazio", soDocumento("") === "" && soDocumento(null) === "" && soDocumento(undefined) === "");

/* ========================================================================== */
bloco("Máscara enquanto digita — CPF");

t("3 dígitos ainda sem ponto", mascararDocumento("123") === "123", mascararDocumento("123"));
t("4 dígitos ganham o primeiro ponto", mascararDocumento("1234") === "123.4");
t("7 dígitos, dois pontos", mascararDocumento("1234567") === "123.456.7");
t("10 dígitos ganham o traço", mascararDocumento("1234567890") === "123.456.789-0");
t("CPF completo", mascararDocumento("12345678909") === "123.456.789-09");
t("CPF já formatado não duplica separador", mascararDocumento("123.456.789-09") === "123.456.789-09");

/* ========================================================================== */
bloco("Máscara enquanto digita — CNPJ");

t("12 dígitos viram formato CNPJ, não CPF", mascararDocumento("123456780001") === "12.345.678/0001", mascararDocumento("123456780001"));
t("CNPJ numérico completo", mascararDocumento("12345678000190") === "12.345.678/0001-90");
t("CNPJ já formatado não duplica separador", mascararDocumento("12.345.678/0001-90") === "12.345.678/0001-90");

/* ========================================================================== */
bloco("Máscara — CNPJ alfanumérico (vigente desde 31/07/2026)");

t("letra logo no começo já manda formatar como CNPJ", mascararDocumento("12A") === "12.A", mascararDocumento("12A"));
t("alfanumérico completo mantém TODAS as letras", mascararDocumento("12ABC34501DE35") === "12.ABC.345/01DE-35", mascararDocumento("12ABC34501DE35"));
t("alfanumérico já formatado sobrevive a uma segunda passada", mascararDocumento(mascararDocumento("12ABC34501DE35")) === "12.ABC.345/01DE-35");
t("com letra, mesmo curto, nunca vira CPF", pareceCnpj("1A") && rotuloDocumento("1A") === "CNPJ");
t("só número e curto continua sendo CPF", !pareceCnpj("123456789") && rotuloDocumento("123456789") === "CPF");

/* ========================================================================== */
bloco("Backspace não pode travar — máscara nunca termina em separador");

const parciais = ["1", "12", "123", "1234", "12345", "123456", "1234567", "12345678", "123456789",
  "1234567890", "12345678901", "123456789012", "1234567890123", "12345678901234",
  "1A", "12A", "12AB", "12ABC", "12ABC3", "12ABC34501DE", "12ABC34501DE3"];
const terminaEmSeparador = parciais.filter((p) => /[./-]$/.test(mascararDocumento(p)));
t("nenhum tamanho parcial termina em '.', '/' ou '-'", terminaEmSeparador.length === 0, terminaEmSeparador);

// O que o campo faz de verdade ao apagar: tira o último caractere do texto já
// mascarado e manda mascarar de novo. Isso precisa sempre encurtar.
const apagando = (texto: string) => mascararDocumento(texto.slice(0, -1));
t("apagar sobre um separador realmente encurta (não volta ao mesmo texto)", apagando("123.") !== "123." && apagando("12.345.678/") !== "12.345.678/");
t("apagar dígito por dígito chega em vazio sem travar", (() => {
  let texto = mascararDocumento("12ABC34501DE35");
  for (let i = 0; i < 50 && texto !== ""; i++) {
    const anterior = texto;
    texto = apagando(texto);
    if (texto === anterior) return false; // travou
  }
  return texto === "";
})());

/* ========================================================================== */
bloco("CPF — dígito verificador");

t("CPF válido conhecido", cpfValido("123.456.789-09"));
t("CPF com dígito trocado é recusado", !cpfValido("123.456.789-00"));
t("todos os dígitos iguais é recusado mesmo passando no módulo 11", !cpfValido("111.111.111-11"));
t("CPF incompleto não é válido", !cpfValido("123.456.789"));
t("CPF com letra não é CPF", !cpfValido("1234567890A"));

/* ========================================================================== */
bloco("CNPJ — dígito verificador (numérico e alfanumérico)");

t("CNPJ numérico válido", cnpjValido("11.222.333/0001-81"), "11222333000181");
t("CNPJ numérico com dígito trocado é recusado", !cnpjValido("11.222.333/0001-82"));
t("CNPJ alfanumérico válido (12.ABC.345/01DE-35)", cnpjValido("12.ABC.345/01DE-35"));
t("alfanumérico com dígito verificador trocado é recusado", !cnpjValido("12.ABC.345/01DE-36"));
t("alfanumérico com letra trocada muda o DV e é recusado", !cnpjValido("12.ABD.345/01DE-35"));
t("CNPJ incompleto é recusado", !cnpjValido("11.222.333/0001"));
t("tudo igual é recusado", !cnpjValido("11111111111111"));

/* ========================================================================== */
bloco("Aviso na tela — só quando já dá para afirmar que está errado");

t("campo vazio não acusa erro", !documentoInvalidoCompleto(""));
t("digitação pela metade não acusa erro", !documentoInvalidoCompleto("123.456"));
t("12 dígitos (a caminho do CNPJ) ainda não acusa erro", !documentoInvalidoCompleto("123456789012"));
t("CPF completo e errado acusa", documentoInvalidoCompleto("123.456.789-00"));
t("CPF completo e certo não acusa", !documentoInvalidoCompleto("123.456.789-09"));
t("CNPJ completo e errado acusa", documentoInvalidoCompleto("11.222.333/0001-82"));
t("CNPJ alfanumérico completo e certo não acusa", !documentoInvalidoCompleto("12.ABC.345/01DE-35"));

t("documentoValido aceita os dois tipos", documentoValido("123.456.789-09") && documentoValido("12.ABC.345/01DE-35"));

console.log(`\n${falhou === 0 ? "✓" : "✗"} ${passou} passaram, ${falhou} falharam\n`);
if (falhou > 0) process.exit(1);
