/**
 * ============================================================================
 * CPF E CNPJ — a máscara que aparece enquanto a pessoa digita
 * ============================================================================
 *
 * O PEDIDO
 *
 * Ao cadastrar o documento de um cliente, os pontos, a barra e o traço devem
 * entrar sozinhos, no lugar certo. Antes o campo aceitava qualquer coisa, e o
 * mesmo cliente acabava salvo ora como "12345678000190", ora como
 * "12.345.678/0001-90" — o que atrapalha na hora de comparar e é feio no PDF.
 *
 * ⚠️ CNPJ AGORA PODE TER LETRA — E ISSO NÃO É OPCIONAL
 *
 * Desde 31/07/2026 a Receita Federal emite CNPJ ALFANUMÉRICO. O formato é:
 *
 *     [A-Z0-9]{12}[0-9]{2}     →     12.ABC.345/01DE-35
 *
 * As 12 primeiras posições aceitam letra maiúscula ou número; os 2 dígitos
 * verificadores continuam SEMPRE numéricos. A máscara visual não mudou — os
 * mesmos pontos, a mesma barra, o mesmo traço nos mesmos lugares. CNPJ antigo
 * (só número) continua válido e convivendo com o novo: quem já tem, não troca.
 *
 * Por isso este arquivo NÃO pode simplesmente jogar fora tudo que não é
 * dígito, que era o reflexo natural. Um cliente com CNPJ novo ficaria com o
 * documento mutilado no cadastro — e a nota fiscal sairia errada.
 *
 * CPF continua exclusivamente numérico: 11 dígitos, 000.000.000-00.
 *
 * COMO SE DECIDE ENTRE CPF E CNPJ ENQUANTO DIGITA
 *
 *   Tem letra?          → CNPJ, sem dúvida (CPF não tem letra).
 *   Só número, até 11   → CPF.
 *   Só número, 12 a 14  → CNPJ.
 *
 * O CÁLCULO DO DÍGITO VERIFICADOR
 *
 * Módulo 11, como sempre. A única novidade do alfanumérico é a conversão do
 * caractere: usa-se o valor da tabela ASCII menos 48 — o que mantém "0"–"9"
 * valendo 0–9 (nada muda para CNPJ antigo) e faz "A" valer 17, "B" 18, e
 * assim por diante.
 */

/* ==========================================================================
   LIMPEZA E MÁSCARA
   ========================================================================== */

/**
 * O documento sem nenhum enfeite: só letra maiúscula e número, no máximo 14.
 *
 * As duas últimas posições são os dígitos verificadores e não aceitam letra —
 * uma letra digitada ali é descartada em vez de empurrar o resto para o lado.
 */
export function soDocumento(valor: unknown): string {
  const bruto = String(valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const inicio = bruto.slice(0, 12);
  const verificadores = bruto.slice(12, 14).replace(/[^0-9]/g, "");
  return inicio + verificadores;
}

/** Este documento tem alguma letra? Se tem, só pode ser CNPJ. */
export function temLetra(valor: unknown): boolean {
  return /[A-Z]/.test(soDocumento(valor));
}

/** É para tratar como CNPJ? Ver a regra de decisão no topo do arquivo. */
export function pareceCnpj(valor: unknown): boolean {
  const d = soDocumento(valor);
  return temLetra(d) || d.length > 11;
}

/**
 * A máscara que o campo mostra enquanto a pessoa digita.
 *
 * ⚠️ NUNCA devolve um separador solto no fim ("123." ou "12.345/"). Se
 *    devolvesse, apagar com backspace ficaria travado: a pessoa apaga o ponto,
 *    a função põe o ponto de volta, e o cursor não anda. Cada separador só
 *    entra quando existe pelo menos um caractere depois dele.
 */
export function mascararDocumento(valor: unknown): string {
  const d = soDocumento(valor);
  if (!d) return "";
  return pareceCnpj(d) ? mascararCnpj(d) : mascararCpf(d);
}

/** 000.000.000-00 */
function mascararCpf(d: string): string {
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 9);
  const e = d.slice(9, 11);
  let saida = a;
  if (b) saida += `.${b}`;
  if (c) saida += `.${c}`;
  if (e) saida += `-${e}`;
  return saida;
}

/** 00.000.000/0000-00 — e também 12.ABC.345/01DE-35, o CNPJ alfanumérico. */
function mascararCnpj(d: string): string {
  const a = d.slice(0, 2);
  const b = d.slice(2, 5);
  const c = d.slice(5, 8);
  const e = d.slice(8, 12);
  const f = d.slice(12, 14);
  let saida = a;
  if (b) saida += `.${b}`;
  if (c) saida += `.${c}`;
  if (e) saida += `/${e}`;
  if (f) saida += `-${f}`;
  return saida;
}

/* ==========================================================================
   VALIDAÇÃO — o dígito verificador confere?
   ==========================================================================
   Isto NÃO trava nenhum cadastro. Serve para a tela avisar em voz baixa que
   o número parece errado, porque quem recusa de verdade é o banco (no boleto)
   e a prefeitura (na NFS-e) — e lá o erro aparece tarde, depois do trabalho
   feito. Um aviso na hora da digitação é mais barato que uma nota recusada.
   ========================================================================== */

/** Valor do caractere no módulo 11: ASCII menos 48. "0"→0 … "9"→9, "A"→17, "B"→18… */
function valorDoCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}

function digitoModulo11(base: string, pesos: number[]): number {
  const soma = base
    .split("")
    .reduce((s, c, i) => s + valorDoCaractere(c) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CPF válido: 11 dígitos, não são todos iguais, e os dois verificadores batem. */
export function cpfValido(valor: unknown): boolean {
  const d = soDocumento(valor);
  if (d.length !== 11 || /[A-Z]/.test(d)) return false;
  // 111.111.111-11 e afins passam na conta do módulo 11, mas não existem.
  if (/^(\d)\1{10}$/.test(d)) return false;

  const dv1 = digitoModulo11(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digitoModulo11(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[9]) && dv2 === Number(d[10]);
}

/**
 * CNPJ válido — serve para o numérico de sempre E para o alfanumérico novo,
 * porque a conversão ASCII-48 deixa os dígitos valendo eles mesmos.
 */
export function cnpjValido(valor: unknown): boolean {
  const d = soDocumento(valor);
  if (d.length !== 14) return false;
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(d)) return false;
  if (/^(.)\1{13}$/.test(d)) return false;

  const dv1 = digitoModulo11(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digitoModulo11(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}

/** Vale como CPF ou como CNPJ — é o que as telas perguntam. */
export function documentoValido(valor: unknown): boolean {
  return cpfValido(valor) || cnpjValido(valor);
}

/**
 * Já dá para dizer que está errado?
 *
 * Enquanto a pessoa está no meio da digitação, "incompleto" não é "errado" —
 * avisar antes da hora é um alarme falso que pisca a cada tecla. Só devolve
 * `true` quando o documento chegou a um tamanho fechado (11 ou 14) e mesmo
 * assim não confere.
 */
export function documentoInvalidoCompleto(valor: unknown): boolean {
  const d = soDocumento(valor);
  if (d.length !== 11 && d.length !== 14) return false;
  return !documentoValido(d);
}

/** Como chamar o que a pessoa digitou, para a mensagem da tela. */
export function rotuloDocumento(valor: unknown): "CPF" | "CNPJ" {
  return pareceCnpj(valor) ? "CNPJ" : "CPF";
}
