/**
 * ============================================================================
 * LOGOMARCA OFICIAL DA NFS-e — para o cabeçalho do DANFSe
 * ============================================================================
 *
 * A NT 008/2026 não deixa margem: o canto esquerdo do DANFSe leva "a logomarca
 * da NFS-e", e a própria norma publica o arquivo. Não é a logo do MEI — o
 * cabeçalho do documento auxiliar é padronizado nacionalmente, e é justamente
 * por ser igual em todo lugar que um contador o reconhece de imediato.
 *
 * A imagem oficial está em:
 * https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-danfs-e/
 *
 * ----------------------------------------------------------------------------
 * POR QUE A IMAGEM MORA DENTRO DE UM ARQUIVO .ts, E NÃO COMO .png NA PASTA
 *
 * O mesmo gerador roda em dois lugares: no navegador e no servidor. Um arquivo
 * de imagem solto exigiria caminho, empacotador e leitura de disco — três
 * coisas que se comportam diferente em cada ambiente e que já quebraram
 * silenciosamente neste projeto (foi assim que a logo do MEI sumiu das notas).
 * Texto embutido num módulo funciona igual nos dois, sem configuração.
 *
 * ----------------------------------------------------------------------------
 * ENQUANTO ESTIVER VAZIO
 *
 * O gerador desenha uma aproximação da marca com texto. Fica parecida e não
 * atrapalha nada — mas não é a marca oficial. Assim que a imagem for colocada
 * aqui, o cabeçalho passa a ser idêntico ao da folha que o Portal emite.
 */

/**
 * Logomarca horizontal da NFS-e, em data:image/png;base64.
 *
 * Deixe como string vazia enquanto a imagem não estiver disponível — o
 * desenho de reserva entra sozinho.
 */
export const LOGO_NFSE_BASE64 = "";

/** Verdadeiro quando há imagem para desenhar. */
export function temLogoNfse(): boolean {
  return typeof LOGO_NFSE_BASE64 === "string" && LOGO_NFSE_BASE64.startsWith("data:image");
}
