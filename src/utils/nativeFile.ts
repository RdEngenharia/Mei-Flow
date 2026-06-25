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
 * no APK nativo. Usa o método doc.html() do jsPDF, que internamente desenha o
 * elemento via html2canvas e pagina automaticamente o conteúdo longo.
 *
 * Substitui o padrão antigo de `window.print()`, que depende de um motor de
 * impressão do navegador — recurso que não existe dentro do WebView do
 * Capacitor no Android.
 *
 * @param element Elemento HTML a ser convertido (ex: o card do orçamento)
 * @param fileName Nome do arquivo final, com extensão .pdf
 */
export async function saveHtmlElementAsPdf(element: HTMLElement, fileName: string): Promise<void> {
  const { jsPDF: JsPDFClass } = await import("jspdf");
  const doc = new JsPDFClass({ unit: "pt", format: "a4" });

  await new Promise<void>((resolve, reject) => {
    try {
      doc.html(element, {
        callback: () => resolve(),
        html2canvas: {
          scale: 0.75,
          useCORS: true,
          logging: false,
        },
        autoPaging: "text",
        margin: [24, 24, 24, 24],
        width: 547, // largura útil em pt para A4 com margem de 24pt de cada lado
        windowWidth: element.scrollWidth || element.offsetWidth || 800,
      });
    } catch (err) {
      reject(err);
    }
  });

  await savePdfCrossPlatform(doc, fileName);
}
