/**
 * ============================================================================
 * LOGO DA EMPRESA — de onde ela vem e por que às vezes sumia
 * ============================================================================
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * O MEI Flow guardava a logo dentro do documento do usuário no Firestore, em
 * base64. Só que o Firestore tem um teto rígido de ~1 MiB por documento, e uma
 * imagem em base64 estoura isso com facilidade — o erro "The value of property
 * companyLogo is longer than 1048487 bytes" bloqueava QUALQUER atualização de
 * perfil, não só a logo. A correção foi mandar a imagem para o Firebase Storage
 * e guardar apenas a URL (uma string curta).
 *
 * A correção certa criou um efeito colateral que passou despercebido: a partir
 * dali `companyLogo` deixou de ser "data:image/png;base64,..." e passou a ser
 * "https://firebasestorage.googleapis.com/...". E TODO o resto do sistema ainda
 * esperava data URI:
 *
 *   • o gerador da nota fiscal no servidor só aceitava logo começando com
 *     "data:image" — com URL, simplesmente ignorava e a nota saía sem logo;
 *   • `doc.addImage(url, ...)` do jsPDF não busca a imagem na rede, precisa dos
 *     bytes em mãos;
 *   • o html2canvas até tenta buscar, mas a resposta vinha sem cabeçalho CORS e
 *     ele desenhava um vazio, sem erro nenhum.
 *
 * Daí o relato "nos orçamentos não aparece a minha logo" e "ao inserir uma logo
 * na configuração não atualizou nas notas fiscais".
 *
 * Esta função aceita as duas formas e devolve sempre um data URI pronto para o
 * jsPDF. Funciona no navegador e no servidor (ambos têm fetch). Nunca lança:
 * documento sem logo é um detalhe estético, não pode derrubar uma emissão.
 */

/** Cache por URL — a mesma logo é usada em toda nota e todo orçamento. */
const cache = new Map<string, string>();

export async function carregarLogoBase64(origem?: string | null): Promise<string | undefined> {
  const src = String(origem || "").trim();
  if (!src) return undefined;

  // Já é data URI: nada a buscar.
  if (src.startsWith("data:image")) return src;
  if (!/^https?:\/\//i.test(src)) return undefined;

  const guardada = cache.get(src);
  if (guardada) return guardada;

  try {
    const resp = await fetch(src);
    if (!resp.ok) return undefined;

    const tipo = (resp.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!tipo.startsWith("image/")) return undefined;

    const bytes = new Uint8Array(await resp.arrayBuffer());
    // Imagem gigante não vale o risco de estourar a memória do gerador.
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) return undefined;

    let b64 = "";
    const maybeBuffer = (globalThis as any).Buffer;
    if (maybeBuffer) {
      b64 = maybeBuffer.from(bytes).toString("base64");
    } else {
      // Navegador: em pedaços, porque String.fromCharCode(...) com um array
      // grande estoura a pilha de argumentos.
      let bruto = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bruto += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as any);
      }
      b64 = btoa(bruto);
    }

    const dataUri = `data:${tipo};base64,${b64}`;
    cache.set(src, dataUri);
    return dataUri;
  } catch {
    // Rede fora, CORS, URL vencida — o documento sai com o monograma.
    return undefined;
  }
}

/** Usado quando o usuário troca a logo, para a próxima geração buscar de novo. */
export function limparCacheLogo() {
  cache.clear();
}
