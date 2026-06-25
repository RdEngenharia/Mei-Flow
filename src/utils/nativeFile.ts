/**
 * Utilitário central para salvar arquivos PDF gerados pelo jsPDF, funcionando
 * de forma correta tanto na versão web (navegador) quanto dentro do APK
 * (WebView do Capacitor no Android).
 *
 * PROBLEMA QUE ISSO RESOLVE:
 * - `doc.save()` do jsPDF e `window.print()` dependem de um navegador completo
 *   com gerenciador de downloads/impressão. Dentro do WebView do Capacitor,
 *   esses recursos simplesmente não existem ou são bloqueados silenciosamente
 *   (nenhum erro aparece, o arquivo só nunca é salvo).
 * - A solução é detectar quando o app está rodando como APK nativo e, nesse
 *   caso, gravar o PDF diretamente na pasta pública de Downloads do Android
 *   via plugin nativo, em vez de depender do comportamento de navegador.
 */
import type { jsPDF } from "jspdf";

/**
 * Detecta se o app está rodando dentro do APK nativo (via Capacitor) ou no
 * navegador comum (web).
 */
export function isNativePlatform(): boolean {
  return typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();
}

/**
 * Resolve a URL absoluta correta para chamadas de API, tanto na web quanto
 * dentro do APK.
 *
 * PROBLEMA QUE ISSO RESOLVE: dentro do WebView do Capacitor, a página é
 * servida a partir de "https://localhost" (não do domínio real da Vercel).
 * Isso significa que tanto caminhos relativos ("/api/...") quanto a técnica
 * comum de resolver via `window.location.origin` SEMPRE retornam
 * "https://localhost" dentro do APK — fazendo qualquer chamada de API
 * bater num WebView local que não tem essas rotas, devolvendo a página de
 * erro HTML do próprio WebView em vez de JSON (erro clássico:
 * "Unexpected token '<', '<!doctype'... is not valid JSON").
 *
 * A solução é: dentro do APK, SEMPRE usar a URL absoluta de produção,
 * nunca confiar em window.location.origin.
 *
 * @param path Caminho da API, começando com "/" (ex: "/api/checkout")
 */
export function getApiUrl(path: string): string {
  if (isNativePlatform()) {
    return `https://mei-flow-flax.vercel.app${path}`;
  }
  if (typeof window !== "undefined" && window.location) {
    return `${window.location.origin}${path}`;
  }
  return `https://mei-flow-flax.vercel.app${path}`;
}

/**
 * Salva um documento jsPDF já montado, escolhendo automaticamente o método
 * correto conforme o ambiente:
 * - Web: usa doc.save() normalmente (comportamento padrão do navegador).
 * - APK (Capacitor/Android): grava o arquivo na pasta pública de Downloads
 *   via @capgo/capacitor-file-sharer, que usa a MediaStore API do Android
 *   (funciona em qualquer versão do Android, incluindo 13+, sem exigir as
 *   permissões antigas de armazenamento que pararam de funcionar).
 *
 * @param doc Instância do jsPDF já preenchida, antes de qualquer chamada a .save()
 * @param fileName Nome do arquivo, com extensão .pdf
 * @returns Promise que resolve quando o arquivo foi salvo com sucesso
 */
export async function savePdfCrossPlatform(doc: jsPDF, fileName: string): Promise<void> {
  if (!isNativePlatform()) {
    // Ambiente web normal: comportamento padrão do jsPDF, sem mudanças.
    doc.save(fileName);
    return;
  }

  // Ambiente APK nativo: gera o PDF como base64 e grava direto na pasta
  // pública de Downloads do Android via plugin nativo.
  try {
    const base64Data = doc.output("datauristring"); // já vem como "data:application/pdf;base64,...."
    const { FileSharer } = await import("@capgo/capacitor-file-sharer");
    await FileSharer.save({
      filename: fileName,
      contentType: "application/pdf",
      base64Data,
      android: {
        saveDirectory: "downloads",
      },
    });
  } catch (err) {
    console.error("[savePdfCrossPlatform] Falha ao salvar PDF no Android:", err);
    throw err;
  }
}

/**
 * Baixa um arquivo já existente em uma URL remota (ex: um comprovante salvo
 * no Storage) e grava na pasta pública de Downloads do Android. Usado quando
 * o arquivo já existe pronto no servidor — não precisa ser gerado, só
 * transferido para o dispositivo.
 *
 * Na web, simplesmente abre a URL numa nova aba (comportamento equivalente
 * ao link de download que o navegador já trata nativamente).
 *
 * @param url URL pública do arquivo (ex: docItem.downloadUrl)
 * @param fileName Nome do arquivo final, com extensão
 * @param contentType MIME type do arquivo (ex: "application/pdf", "image/jpeg")
 */
export async function downloadRemoteFileCrossPlatform(
  url: string,
  fileName: string,
  contentType: string
): Promise<void> {
  if (!isNativePlatform()) {
    window.open(url, "_blank");
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falha ao buscar arquivo remoto: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const base64Data: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const { FileSharer } = await import("@capgo/capacitor-file-sharer");
    await FileSharer.save({
      filename: fileName,
      contentType,
      base64Data,
      android: {
        saveDirectory: "downloads",
      },
    });
  } catch (err) {
    console.error("[downloadRemoteFileCrossPlatform] Falha ao baixar/salvar arquivo:", err);
    throw err;
  }
}

/**
 * Converte um elemento HTML visível na tela em um PDF e salva, funcionando
 * tanto na web (window.print() normalmente não funciona dentro do APK) quanto
 * no APK nativo.
 *
 * IMPORTANTE: usa html2canvas-pro (e não o doc.html() automático do jsPDF,
 * que internamente carrega o html2canvas clássico) porque o html2canvas
 * original não suporta funções de cor modernas como oklch() — usadas pelo
 * Tailwind CSS v4 — e quebra com "Attempting to parse an unsupported color
 * function oklch". O html2canvas-pro é um fork mantido, com a mesma API,
 * que corrige justamente esse problema.
 *
 * @param element Elemento HTML a ser convertido (ex: o card do orçamento)
 * @param fileName Nome do arquivo final, com extensão .pdf
 */
export async function saveHtmlElementAsPdf(element: HTMLElement, fileName: string): Promise<void> {
  const { default: html2canvas } = await import("html2canvas-pro");
  const { jsPDF: JsPDFClass } = await import("jspdf");

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  // Calcula as dimensões em mm para caber numa folha A4, preservando a
  // proporção original do elemento capturado, com paginação automática
  // se o conteúdo for mais alto que uma página.
  const pageWidth = 210; // A4 em mm
  const pageHeight = 297; // A4 em mm
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const imgWidthMm = usableWidth;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  const doc = new JsPDFClass({ unit: "mm", format: "a4" });
  const usableHeight = pageHeight - margin * 2;

  if (imgHeightMm <= usableHeight) {
    // Cabe em uma única página.
    doc.addImage(imgData, "JPEG", margin, margin, imgWidthMm, imgHeightMm);
  } else {
    // Conteúdo mais alto que uma página: divide em múltiplas páginas,
    // "deslizando" uma janela de recorte sobre a imagem capturada.
    let heightLeftMm = imgHeightMm;
    let positionMm = 0;
    let firstPage = true;

    while (heightLeftMm > 0) {
      if (!firstPage) doc.addPage();
      doc.addImage(imgData, "JPEG", margin, margin - positionMm, imgWidthMm, imgHeightMm);
      heightLeftMm -= usableHeight;
      positionMm += usableHeight;
      firstPage = false;
    }
  }

  await savePdfCrossPlatform(doc, fileName);
}
