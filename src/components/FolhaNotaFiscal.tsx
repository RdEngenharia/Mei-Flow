import React from "react";
import { descricaoDoCodigo } from "../data/servicosNfse";

/**
 * ============================================================================
 * FOLHA DA NOTA FISCAL (DANFSe) — o que sai no papel e no PDF
 * ============================================================================
 *
 * ⚠️ ISTO É DOCUMENTO AUXILIAR. Nenhum PDF de nota fiscal tem valor fiscal —
 *    nem o do próprio governo, que também se identifica como "Documento
 *    Auxiliar da NFS-e". O documento fiscal é o XML, guardado no Arquivo
 *    Digital. A função desta folha é ser lida por gente e permitir a
 *    verificação pela chave de acesso ou pelo QR.
 *
 * ⚠️ CABE EM UMA FOLHA A4, E PRECISA CONTINUAR CABENDO. O gerador de PDF
 *    reduz a escala para caber; passando do ponto, a letra fica ilegível. Ao
 *    acrescentar bloco novo, rode o teste que renderiza esta folha e mede a
 *    altura antes de publicar.
 *
 * DE ONDE VÊM OS DADOS
 *
 *   • `dados`   — lidos do XML da nota. É a fonte da verdade: o número da
 *                 NFS-e, por exemplo, é atribuído pelo Portal e NÃO é o número
 *                 da DPS que nós escolhemos.
 *   • `nota`    — o resumo guardado no banco, usado como reserva quando o XML
 *                 não veio.
 *   • `cliente` — o cadastro do cliente. Endereço e telefone do tomador vêm
 *                 daqui porque o Portal não os recebe hoje na DPS.
 *
 * Este arquivo existe separado do NotaFiscalPanel de propósito: assim a folha
 * pode ser renderizada isolada num teste, com dados reais, e conferida antes de
 * ir para o usuário.
 */

export type DadosFolhaNota = {
  nota: any;
  dados?: any;
  cliente?: any;
  qrCode?: string;
  carregando?: boolean;
  meiName?: string;
  cnpjPrestador?: string;
  cnpjDoCertificado?: string;
  inscricaoMunicipal?: string;
  telefonePrestador?: string;
  emailPrestador?: string;
  municipioPrestador?: string;
  enderecoPrestador?: { cep?: string; logradouro?: string; numero?: string; bairro?: string; cidade?: string; uf?: string };
  companyLogo?: string;
  refFolha?: React.RefObject<HTMLDivElement | null>;
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataBR = (iso?: string) => {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};

/** Formata CPF (11) ou CNPJ (14); qualquer outra coisa volta como veio. */
const docBR = (v?: string) => {
  const n = String(v || "").replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v || "";
};

const cepBR = (v?: string) => {
  const n = String(v || "").replace(/\D/g, "");
  return n.length === 8 ? n.replace(/(\d{5})(\d{3})/, "$1-$2") : (v || "");
};

const foneBR = (v?: string) => {
  const n = String(v || "").replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return v || "";
};

/**
 * Iniciais para o monograma de quem não tem logo.
 *
 * "RD SOLUCOES DIGITAIS" tem que virar RD, e não RS: quando a primeira palavra
 * já é uma sigla curta, ela É a marca. Só quando não há sigla é que pegamos a
 * inicial das duas primeiras palavras.
 */
const iniciais = (nome?: string) => {
  const palavras = String(nome || "MEI").trim().split(/\s+/).filter(Boolean);
  if (!palavras.length) return "MF";
  if (palavras[0].length <= 3) return palavras[0].slice(0, 2).toUpperCase();
  return palavras.filter((w) => w.length > 1).slice(0, 2)
    .map((w) => w[0]).join("").toUpperCase() || "MF";
};

/** Competência é mês/ano — imprimir a data cheia confunde com a emissão. */
const competenciaBR = (iso?: string) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : "—";
};

/** Quebra a chave de 50 dígitos em grupos de 4 — bem mais fácil de conferir. */
const chaveEmGrupos = (c?: string) =>
  String(c || "").replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim();

export default function FolhaNotaFiscal({
  nota, dados, cliente, qrCode, carregando,
  meiName, cnpjPrestador, cnpjDoCertificado, inscricaoMunicipal, telefonePrestador,
  emailPrestador, municipioPrestador, enderecoPrestador, companyLogo, refFolha,
}: DadosFolhaNota) {

  const descricaoDoServicoNacional = descricaoDoCodigo(
    String(dados?.servico?.codigoTributacao || nota?.servicoCodigo || "")
  );

  return (
    <div ref={refFolha} data-folha="danfse" className="px-8 py-5 bg-white font-sans text-slate-800">

      {/*
        DANFSe do MEI Flow.

        ⚠️ ISTO É DOCUMENTO AUXILIAR. Nenhum PDF de nota fiscal tem valor
           fiscal — nem o do próprio governo, que também se identifica
           como "Documento Auxiliar". O documento fiscal é o XML.

        O conteúdo sai do XML da nota (dados). Endereço e telefone do
        TOMADOR são a exceção: o Portal não os recebe hoje, então vêm do
        cadastro de clientes (cliente).

        ⚠️ CABE EM UMA FOLHA. Ao acrescentar bloco novo, confira no PDF —
           o gerador reduz a escala para caber, e a partir de certo ponto
           a letra fica ilegível.
      */}

      {/* --------------------------------------------------- cabeçalho */}
      <div className="flex items-start justify-between gap-8">
        <div className="flex items-start gap-3.5 min-w-0">
          {companyLogo ? (
            <img src={companyLogo} alt="" referrerPolicy="no-referrer"
                 className="w-12 h-12 rounded-xl object-contain shrink-0 border border-slate-200 bg-white" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 font-bold text-lg">
              {iniciais(meiName || dados?.prestador?.nome)}
            </div>
          )}
          <div className="min-w-0 pt-0.5">
            <h1 className="text-[17px] font-bold text-slate-900 leading-tight truncate">
              {meiName || dados?.prestador?.nome || "—"}
            </h1>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
              Documento Auxiliar da Nota Fiscal de Serviço eletrônica
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400">NFS-e Nº</p>
          <p className="text-3xl font-bold text-slate-900 leading-none tabular-nums">
            {dados?.numeroNfse || nota.numeroNfse || nota.numero}
          </p>
          <p className="text-[9px] text-slate-400 font-mono mt-1">
            Série {dados?.serie || nota.serie} · DPS nº {dados?.numeroDps || nota.numero}
          </p>
          {((dados?.ambiente || nota.ambiente || "").startsWith("homolog")) ? (
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-[8px] font-extrabold uppercase tracking-widest">
              Teste — sem validade fiscal
            </span>
          ) : (
            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[8px] font-extrabold uppercase tracking-widest">
              Autorizada
            </span>
          )}
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-indigo-600 via-indigo-300 to-transparent mt-3" />

      {/* -------------------------------------------------------- datas */}
      <div className="grid grid-cols-4 gap-5 py-3">
        <div>
          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Emissão</p>
          <p className="text-[11px] font-semibold text-slate-800 font-mono">
            {dataBR(String(dados?.emitidaEm || nota.emitidaEm || "").slice(0, 10))}
          </p>
        </div>
        <div>
          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Competência</p>
          <p className="text-[11px] font-semibold text-slate-800 font-mono">{competenciaBR(dados?.competencia)}</p>
        </div>
        <div>
          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Local da prestação</p>
          <p className="text-[11px] font-semibold text-slate-800">
            {municipioPrestador || enderecoPrestador?.cidade ||
              (dados?.servico?.localPrestacao ? `IBGE ${dados.servico.localPrestacao}` : "—")}
          </p>
        </div>
        <div>
          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Ambiente</p>
          <p className="text-[11px] font-semibold text-slate-800">
            {((dados?.ambiente || nota.ambiente || "")).startsWith("produ") ? "Produção" : "Homologação"}
          </p>
        </div>
      </div>

      {/* ------------------------------------------ prestador / tomador */}
      <div className="grid grid-cols-2 gap-3">

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-indigo-50/60 border-b border-slate-200">
            <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-indigo-700">Prestador do serviço</p>
          </div>
          <div className="px-4 py-2.5 space-y-1.5">
            <div>
              <p className="text-[13px] font-bold text-slate-900 leading-tight">{meiName || "—"}</p>
              {dados?.prestador?.nome && dados.prestador.nome !== meiName && (
                <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{dados.prestador.nome}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">CNPJ</p>
                <p className="text-[10px] font-mono text-slate-800">
                  {docBR(dados?.prestador?.cnpj || cnpjPrestador || cnpjDoCertificado) || "—"}
                </p>
              </div>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Inscrição Municipal</p>
                <p className="text-[10px] font-mono text-slate-800">
                  {dados?.prestador?.inscricaoMunicipal || inscricaoMunicipal || "—"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Endereço</p>
              <p className="text-[10px] text-slate-700 leading-snug">
                {dados?.prestador?.logradouro || enderecoPrestador?.logradouro
                  ? <>
                      {dados?.prestador?.logradouro || enderecoPrestador?.logradouro}
                      {(dados?.prestador?.numero || enderecoPrestador?.numero) ? `, ${dados?.prestador?.numero || enderecoPrestador?.numero}` : ""}
                      {(dados?.prestador?.bairro || enderecoPrestador?.bairro) ? ` — ${dados?.prestador?.bairro || enderecoPrestador?.bairro}` : ""}
                      <br />
                      {(municipioPrestador || enderecoPrestador?.cidade) ? `${municipioPrestador || enderecoPrestador?.cidade}` : ""}
                      {enderecoPrestador?.uf ? ` / ${enderecoPrestador.uf}` : ""}
                      {(dados?.prestador?.cep || enderecoPrestador?.cep) ? ` · CEP ${cepBR(dados?.prestador?.cep || enderecoPrestador?.cep)}` : ""}
                    </>
                  : "—"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Telefone</p>
                <p className="text-[10px] font-mono text-slate-800">
                  {foneBR(dados?.prestador?.fone || telefonePrestador) || "—"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">E-mail</p>
                <p className="text-[10px] text-slate-800 truncate">
                  {dados?.prestador?.email || emailPrestador || "—"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Regime tributário</p>
              <p className="text-[10px] text-slate-700">
                {dados?.regime?.opSimpNac === "3"
                  ? "Simples Nacional — ME / EPP"
                  : dados?.regime?.opSimpNac === "1"
                    ? "Não optante pelo Simples Nacional"
                    : "Simples Nacional — Microempreendedor Individual (MEI)"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-100 border-b border-slate-200">
            <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-slate-600">Tomador do serviço</p>
          </div>
          {(dados ? dados.tomador : nota.clienteNome) ? (
            <div className="px-4 py-2.5 space-y-1.5">
              <div>
                <p className="text-[13px] font-bold text-slate-900 leading-tight">
                  {dados?.tomador?.nome || nota.clienteNome || "—"}
                </p>
                <p className="text-[10px] text-slate-500 leading-snug mt-0.5">
                  {String(dados?.tomador?.documento || nota.clienteDocumento || "").replace(/\D/g, "").length === 14
                    ? "Pessoa jurídica" : "Pessoa física"}
                </p>
              </div>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">CPF / CNPJ</p>
                <p className="text-[10px] font-mono text-slate-800">
                  {docBR(dados?.tomador?.documento || nota.clienteDocumento) || "—"}
                </p>
              </div>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Endereço</p>
                <p className="text-[10px] text-slate-700 leading-snug">
                  {cliente?.endereco?.logradouro
                    ? <>
                        {cliente.endereco.logradouro}
                        {cliente.endereco.numero ? `, ${cliente.endereco.numero}` : ""}
                        {cliente.endereco.bairro ? ` — ${cliente.endereco.bairro}` : ""}
                        <br />
                        {cliente.endereco.cidade || ""}
                        {cliente.endereco.uf ? ` / ${cliente.endereco.uf}` : ""}
                        {cliente.endereco.cep ? ` · CEP ${cepBR(cliente.endereco.cep)}` : ""}
                      </>
                    : "Não informado no cadastro"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Telefone</p>
                  <p className="text-[10px] font-mono text-slate-800">{foneBR(cliente?.telefone) || "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">E-mail</p>
                  <p className="text-[10px] text-slate-800 truncate">
                    {dados?.tomador?.email || cliente?.email || "—"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Município de incidência do ISSQN</p>
                <p className="text-[10px] text-slate-700">
                  {municipioPrestador || enderecoPrestador?.cidade || "—"}
                  {dados?.servico?.localPrestacao ? ` — IBGE ${dados.servico.localPrestacao}` : ""}
                </p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Tomador não identificado
              </p>
              <p className="text-[9px] text-slate-400 mt-1">A nota foi emitida sem identificação do cliente.</p>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ serviço */}
      <div className="rounded-xl border border-slate-200 overflow-hidden mt-2.5">
        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200">
          <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-slate-600">Discriminação do serviço</p>
        </div>
        <div className="px-4 py-2.5 space-y-2">
          <p className="text-[12px] text-slate-900 leading-relaxed font-medium">
            {dados?.servico?.descricao || nota.descricaoServico || (carregando ? "Carregando..." : "—")}
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Cód. Tributação Nacional</p>
              <p className="text-[11px] font-mono font-semibold text-slate-800">
                {String(dados?.servico?.codigoTributacao || nota.servicoCodigo || "")
                  .replace(/(\d{2})(\d{2})(\d{2})/, "$1.$2.$3") || "—"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Cód. NBS</p>
              <p className="text-[11px] font-mono font-semibold text-slate-800">
                {dados?.servico?.codigoNbs
                  ? String(dados.servico.codigoNbs).replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3.$4")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Local da prestação</p>
              <p className="text-[11px] font-mono font-semibold text-slate-800">
                {dados?.servico?.localPrestacao || "—"}
              </p>
            </div>
          </div>
          {descricaoDoServicoNacional && (
            <p className="text-[9px] text-slate-400 leading-relaxed pt-1">
              <span className="font-semibold text-slate-500">Lista de serviços:</span> {descricaoDoServicoNacional}
            </p>
          )}
        </div>
      </div>

      {/* --------------------------------------------------- tributação */}
      <div className="rounded-xl border border-slate-200 overflow-hidden mt-2.5">
        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200">
          <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-slate-600">Tributação</p>
        </div>
        <div className="px-4 py-2.5 grid grid-cols-5 gap-3">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Tipo de tributação</p>
            <p className="text-[10px] text-slate-800">
              {dados?.valores?.issTributavel === false ? "Não tributável" : "Operação tributável"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Retenção do ISSQN</p>
            <p className="text-[10px] text-slate-800">{dados?.valores?.issRetido ? "Retido" : "Não retido"}</p>
          </div>
          <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Base de cálculo</p>
            <p className="text-[10px] font-mono text-slate-800">
              {dados?.valores?.baseCalculo ? brl(dados.valores.baseCalculo) : "—"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Alíquota</p>
            <p className="text-[10px] font-mono text-slate-800">
              {dados?.valores?.aliquota ? `${dados.valores.aliquota}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">ISSQN apurado</p>
            <p className="text-[10px] font-mono text-slate-800">
              {dados?.valores?.valorIss ? brl(dados.valores.valorIss) : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------ informações complementares */}
      <div className="rounded-xl border border-slate-200 overflow-hidden mt-2.5">
        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200">
          <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-slate-600">Informações complementares</p>
        </div>
        <div className="px-4 py-2.5">
          {(dados?.servico?.informacoesComplementares || nota.observacao) && (
            <p className="text-[10px] text-slate-700 leading-relaxed whitespace-pre-line">
              {dados?.servico?.informacoesComplementares || nota.observacao}
            </p>
          )}
          <p className="text-[9px] text-slate-400 mt-2">
            Totais aproximados dos tributos conforme Lei nº 12.741/2012:{" "}
            {dados?.valores?.totalTributos ? brl(dados.valores.totalTributos) : "não informado"}.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------ valores */}
      <div className="mt-2.5 rounded-xl bg-slate-900 text-white overflow-hidden">
        <div className="flex items-stretch">
          <div className="flex-1 px-5 py-3.5 grid grid-cols-3 gap-x-5 gap-y-2.5 border-r border-white/10">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Valor do serviço</p>
              <p className="text-[11px] font-mono text-slate-100">
                {brl(Number(dados?.valores?.servico || nota.valor || 0))}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Desconto incondicionado</p>
              <p className="text-[11px] font-mono text-slate-100">{brl(Number(dados?.valores?.descontoIncondicionado || 0))}</p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Deduções / Reduções</p>
              <p className="text-[11px] font-mono text-slate-100">{brl(Number(dados?.valores?.deducoes || 0))}</p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Desconto condicionado</p>
              <p className="text-[11px] font-mono text-slate-100">{brl(Number(dados?.valores?.descontoCondicionado || 0))}</p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">ISSQN retido</p>
              <p className="text-[11px] font-mono text-slate-100">
                {brl(dados?.valores?.issRetido ? Number(dados?.valores?.valorIss || 0) : 0)}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Total das retenções</p>
              <p className="text-[11px] font-mono text-slate-100">
                {brl(dados?.valores?.issRetido ? Number(dados?.valores?.valorIss || 0) : 0)}
              </p>
            </div>
          </div>
          <div className="w-[190px] shrink-0 px-5 py-3.5 flex flex-col justify-center items-end bg-white/5">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Valor líquido da NFS-e</p>
            <p className="text-[28px] font-bold tabular-nums leading-tight mt-0.5">
              {brl(Number(dados?.valores?.liquido || dados?.valores?.servico || nota.valor || 0))}
            </p>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- verificação */}
      <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 flex items-center gap-4">
        {qrCode ? (
          <img src={qrCode} alt="QR Code de verificação"
               className="w-[78px] h-[78px] shrink-0 rounded-lg bg-white p-1 border border-slate-200" />
        ) : (
          <div className="w-[78px] h-[78px] shrink-0 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-[7px] text-slate-400 text-center px-1">
            {carregando ? "gerando" : "QR indisponível"}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[8px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Chave de acesso da NFS-e</p>
          <p className="font-mono text-[10.5px] text-slate-800 break-all mt-1 leading-snug">
            {chaveEmGrupos(dados?.chave || nota.chave) || "—"}
          </p>
          <p className="text-[9px] text-slate-500 mt-1.5 leading-relaxed">
            Aponte a câmera para o código ou consulte a chave em{" "}
            <span className="font-semibold text-slate-700">nfse.gov.br</span> para conferir a
            autenticidade desta nota.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------- rodapé */}
      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-end justify-between gap-6">
        <p className="text-[8px] text-slate-400 leading-relaxed max-w-lg">
          Documento auxiliar da NFS-e, gerado a partir do arquivo XML da nota. O documento fiscal é o
          próprio XML, guardado no Arquivo Digital.
        </p>
        <p className="text-[8px] text-slate-300 font-semibold shrink-0">Emitido via MEI Flow</p>
      </div>
    </div>
  );
}
