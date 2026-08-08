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

/**
 * ============================================================================
 * ENCOLHER A LOGO ANTES DE GUARDAR
 * ============================================================================
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * A logo que o usuário escolhe é a foto que ele tem: normalmente 1500 ou 2000
 * pixels de lado, 1 a 2 MB. Do jeito que estava, essa imagem inteira era
 * enviada ao Firebase Storage — e se esse envio falhasse por qualquer motivo
 * (regra do Storage não liberada, rede caindo no meio, arquivo grande demais),
 * o código descartava a logo em silêncio e o usuário só descobria depois,
 * quando voltava ao sistema e ela não estava mais lá.
 *
 * Encolher resolve na raiz. Num documento a logo é impressa com 14 a 16 mm de
 * lado; 400 pixels já é mais resolução do que qualquer impressora aproveita. E
 * uma imagem de 400 pixels pesa algumas dezenas de KB — pequena o bastante para
 * caber com folga dentro do próprio cadastro no Firestore, que é o plano B
 * quando o Storage não colabora.
 *
 * Só roda no navegador (usa canvas). No servidor devolve a imagem como veio.
 */
export async function prepararLogo(dataUri: string, maxLado = 400): Promise<string> {
  const src = String(dataUri || "");
  if (!src.startsWith("data:image")) return src;
  if (typeof document === "undefined" || typeof Image === "undefined") return src;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("imagem ilegível"));
      i.src = src;
    });

    const lado = Math.max(img.naturalWidth, img.naturalHeight) || maxLado;
    // Já é pequena: não mexe. Reprocessar só perderia qualidade à toa.
    if (lado <= maxLado && src.length < 200_000) return src;

    const escala = Math.min(1, maxLado / lado);
    const largura = Math.max(1, Math.round(img.naturalWidth * escala));
    const altura = Math.max(1, Math.round(img.naturalHeight * escala));

    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const ctx = tela.getContext("2d");
    if (!ctx) return src;
    // PNG preserva transparência — logo com fundo transparente continua assim.
    ctx.drawImage(img, 0, 0, largura, altura);
    const menor = tela.toDataURL("image/png");

    return menor.length < src.length ? menor : src;
  } catch {
    // Não conseguiu encolher: segue com a original. Melhor grande do que nenhuma.
    return src;
  }
}

/**
 * Quanto uma string ocupa dentro de um documento do Firestore.
 * O teto é 1.048.487 bytes para o documento INTEIRO, então usamos uma folga
 * grande: o cadastro tem outros campos, e passar do limite trava toda a
 * gravação do perfil, não só a da logo.
 */
export const LIMITE_LOGO_FIRESTORE = 700_000;

export function cabeNoFirestore(texto?: string): boolean {
  if (!texto) return true;
  return new TextEncoder().encode(texto).length <= LIMITE_LOGO_FIRESTORE;
}
