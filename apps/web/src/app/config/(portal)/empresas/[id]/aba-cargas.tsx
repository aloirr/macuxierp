'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CaixaResumo, Chip, Dialogo } from '@macuxierp/ui';
import { ConfirmarComFrase } from '@/components/confirmar-com-frase';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import {
  AVISO_LIMITE_FDV, AVISO_ZERAR, ROTULO_MODO, ROTULO_ZERAR, TEXTO_ANTES_DE_ZERAR, TEXTO_SUBSTITUIR, textoZerado, bloqueiosDeTextos, podeConfirmarZerar, textoLevaJunto, textosAnulados, textosBloqueios, textosMantidos, caixasDaConferencia, conferirArquivoEscolhido, enderecoModelo, linhasCargas, pedirConferencia, pedirErros, pedirGravacao, pedirPreviaZerar, pedirZerar, podeGravar,
  rotuloAdicionar, rotuloLinhaErro, textoEfeito, textoSemChave, textoErrosOmitidos, textoLinhaErro, tituloImportar, type LinhaCarga, type Retorno,
} from '@/lib/config/cargas';
import {
  CADASTROS_ZERAR_PORTAL, CODIGO_ZERAGEM_BLOQUEADA, FRASE_SUBSTITUIR_TUDO, FRASE_ZERAR_DADOS, nomeErrosCarga, plural, substituirPermitido, type CadastroCargaPortal, type EfeitoSubstituir as Efeito, type CadastroZerarPortal, type ModoGravarCarga, type SituacaoCargasPlataforma, type ZeragemPlataformaResposta,
  type ValidarCargaPlataformaResposta as Conferencia,
} from '@macuxierp/platform-sdk';

/**
 * Aba "Cargas" da ficha da empresa (T-0058, v0.3.5): uma linha por cadastro, na ordem do módulo; "Importar" abre a conferência
 * automática (sem botão Validar), "Adicionar" acrescenta e atualiza, "Substituir tudo" pede uma frase. Tudo passa pelos route handlers do portal
 * (`/config/empresas/:id/cargas/...`, cookie mx_config). O arquivo fica só na memória desta tela, o tempo do envio.
 */

/** 401 e a troca de senha pendente levam a outra página; o resto volta como texto. */
function seguir(r: Retorno<unknown>): void {
  if (!r.ok && r.redirecionar) window.location.assign(r.redirecionar);
}

export function AbaCargas({ empresaId, dados, fuso }: { empresaId: string; dados: SituacaoCargasPlataforma | null; fuso: string }) {
  const router = useRouter();
  const [importar, setImportar] = useState<CadastroCargaPortal | null>(null);
  const [zerar, setZerar] = useState(false);
  const [aviso, setAviso] = useState('');
  const linhas = linhasCargas(dados, fuso);

  if (!dados) {
    return (
      <>
        <p className="erro" role="alert">Não foi possível carregar as cargas.</p>
        <a className="mx-botao-secundario" href={`/config/empresas/${encodeURIComponent(empresaId)}?aba=cargas`}>Tentar de novo</a>
      </>
    );
  }
  return (
    <section aria-labelledby="h-cargas">
      <div className="cabeca-cargas">
        <h2 id="h-cargas">Cargas</h2>
        <button type="button" className="mx-botao-secundario botao-perigo-contorno" onClick={() => setZerar(true)}>Zerar dados</button>
      </div>
      {aviso && <p className="faixa-aviso" role="status">{aviso}</p>}
      <ul className="lista-cargas">
        {linhas.map((l) => <LinhaDaCarga key={l.cadastro} linha={l} empresaId={empresaId} aoImportar={() => setImportar(l.cadastro)} />)}
      </ul>
      {importar && (
        <ImportarCarga
          empresaId={empresaId}
          cadastro={importar}
          aoFechar={() => setImportar(null)}
          aoGravar={(n) => {
            setImportar(null);
            setAviso(`${plural(n, 'registro gravado', 'registros gravados')}.`);
            router.refresh();
          }}
        />
      )}
      {zerar && (
        <ZerarDados
          empresaId={empresaId}
          aoFechar={() => setZerar(false)}
          aoZerar={(mantidos) => {
            setZerar(false);
            setAviso(textoZerado(mantidos));
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/** Nome do arquivo e, depois da conferência, a contagem das linhas de dados (prontas + com erro): "clientes.csv · 134 linhas". */
export function rotuloArquivo(nome: string, conferencia: Conferencia | null): string {
  return conferencia ? `${nome} · ${plural(conferencia.prontas + conferencia.com_erro, 'linha', 'linhas')}` : nome;
}

/** O que o "Substituir tudo" faria neste cadastro; acima de 30% o FDV pede confirmação no monitor dele. Só na janela de confirmação. */
export function EfeitoSubstituir({ cadastro, efeito }: { cadastro: CadastroCargaPortal; efeito: Efeito }) {
  return (
    <div className="efeito-substituir">
      <p>{textoEfeito(cadastro, efeito)}</p>
      {efeito.acima_limite_fdv && <p className="faixa-aviso" role="status">{AVISO_LIMITE_FDV}</p>}
    </div>
  );
}

/** Salva o CSV devolvido pelo portal (o arquivo só passa pela memória). */
function salvarCsv(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** As duas caixas, a lista "Linha N: motivo" e "Baixar erros" (POST com o mesmo arquivo; `aoBaixar` ausente = sem botão). */
export function PainelConferencia({ conferencia, aoBaixar }: { conferencia: Conferencia; aoBaixar?: () => void }) {
  const caixas = caixasDaConferencia(conferencia);
  return (
    <>
      <div className="caixas-conferencia" role="status">
        <CaixaResumo tom="sucesso" numero={caixas.prontas.n} texto={caixas.prontas.texto} />
        <CaixaResumo tom="erro" numero={caixas.erros.n} texto={caixas.erros.texto} />
      </div>
      {conferencia.linhas.length > 0 && (
        <ul className="lista-problemas" aria-label="Linhas com erro">
          {conferencia.linhas.map((p, i) => (
            <li key={`${p.linha ?? 'a'}-${i}`}>
              <b>{rotuloLinhaErro(p)}</b> {textoLinhaErro(p)}
            </li>
          ))}
        </ul>
      )}
      {conferencia.linhas_omitidas > 0 && <p className="apoio">{textoErrosOmitidos(conferencia.linhas_omitidas)}</p>}
      {conferencia.com_erro > 0 && aoBaixar && <button type="button" className="mx-botao-secundario baixar-erros" onClick={aoBaixar}>Baixar erros</button>}
    </>
  );
}

function LinhaDaCarga({ linha: l, empresaId, aoImportar }: { linha: LinhaCarga; empresaId: string; aoImportar: () => void }) {
  return (
    <li className="linha-carga" data-cadastro={l.cadastro}>
      <span className="carga-numero" aria-hidden="true">{l.numero}</span>
      <span className="carga-nome">{l.rotulo}</span>
      <span className="carga-situacao">
        <Chip tom={l.chip.tom}>{l.chip.texto}</Chip>
        {l.ultima && <span className="apoio"> {l.ultima}</span>}
      </span>
      <a className="carga-modelo" href={enderecoModelo(empresaId, l.cadastro)}>Modelo</a>
      <button type="button" className="mx-botao-secundario" aria-label={`Importar ${l.rotulo}`} onClick={aoImportar}>Importar</button>
    </li>
  );
}

export function ImportarCarga({ empresaId, cadastro, aoFechar, aoGravar }: { empresaId: string; cadastro: CadastroCargaPortal; aoFechar: () => void; aoGravar: (n: number) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  /** O efeito vem do validar em modo `substituir_tudo`, pedido só ao abrir a confirmação. */
  const [efeito, setEfeito] = useState<Efeito | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');
  const pedido = useRef(0);
  const chaves = useRef(new ChavesIdempotencia());

  /** Escolher o arquivo já confere: sem botão Validar. Resposta de arquivo anterior é descartada. */
  const escolher = async (f: File | null) => {
    const n = ++pedido.current;
    setArquivo(f);
    setConferencia(null);
    setEfeito(null);
    setErro('');
    if (!f) return;
    setConferindo(true);
    const r = await conferirArquivoEscolhido(empresaId, cadastro, f);
    if (n !== pedido.current) return;
    setConferindo(false);
    seguir(r);
    if (r.ok) setConferencia(r.valor);
    else setErro(r.erro);
  };

  /** "Substituir tudo": pede o efeito (validar em modo substituir_tudo) e só então abre a confirmação. */
  const pedirSubstituir = async () => {
    if (!arquivo || !podeGravar(conferencia)) return;
    setConferindo(true);
    setErro('');
    const r = await pedirConferencia(empresaId, cadastro, arquivo, 'substituir_tudo');
    setConferindo(false);
    seguir(r);
    if (r.ok && r.valor.efeito) {
      setEfeito(r.valor.efeito);
      setConfirmando(true);
    } else setErro(r.ok ? 'Não foi possível calcular o efeito. Tente de novo.' : r.erro);
  };

  const idGravar = (modo: ModoGravarCarga) => `gravar:${modo}:${arquivo?.name}:${arquivo?.size}:${arquivo?.lastModified}`;

  /** Adicionar: a chave da ação se repete em falha de rede. O Substituir tudo usa o `ConfirmarComFrase`, que cuida da chave. */
  const gravarAdicionando = async () => {
    if (!arquivo || !conferencia || !podeGravar(conferencia)) return;
    const id = idGravar('adicionar');
    setGravando(true);
    setErro('');
    const r = await pedirGravacao(empresaId, cadastro, arquivo, chaves.current.de(id), 'adicionar');
    chaves.current.aposResposta(id, { ok: r.ok, chaveNova: !r.ok && r.chaveNova });
    setGravando(false);
    seguir(r);
    if (r.ok) aoGravar(r.valor.gravadas);
    else setErro(r.erro);
  };

  const baixarErros = async () => {
    if (!arquivo) return;
    const r = await pedirErros(empresaId, cadastro, arquivo);
    seguir(r);
    if (r.ok) salvarCsv(r.valor, nomeErrosCarga(cadastro));
    else setErro(r.erro);
  };

  const ocupado = conferindo || gravando;
  if (confirmando && efeito && arquivo) {
    return (
      <ConfirmarComFrase
        titulo={`Substituir tudo em ${tituloImportar(cadastro).replace('Importar ', '')}?`}
        frase={FRASE_SUBSTITUIR_TUDO}
        rotulo={ROTULO_MODO.substituir_tudo}
        rotuloEnviando="Substituindo…"
        idEnvio={idGravar('substituir_tudo')}
        podeEnviar={podeGravar(conferencia)}
        enviar={(chave, frase) => pedirGravacao(empresaId, cadastro, arquivo, chave, 'substituir_tudo', frase)}
        aoSucesso={(g) => aoGravar(g.gravadas)}
        aoFechar={() => setConfirmando(false)}
        aviso={TEXTO_SUBSTITUIR}
      >
        <EfeitoSubstituir cadastro={cadastro} efeito={efeito} />
      </ConfirmarComFrase>
    );
  }
  const pronto = !ocupado && podeGravar(conferencia);
  return (
    <Dialogo
      titulo={tituloImportar(cadastro)}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="mx-botao-secundario" onClick={aoFechar}>Cancelar</button>
          {substituirPermitido(cadastro) && <button type="button" className="mx-botao-secundario botao-perigo-contorno" disabled={!pronto} onClick={() => void pedirSubstituir()}>{ROTULO_MODO.substituir_tudo}</button>}
          <button type="button" className="mx-botao" disabled={!pronto} onClick={() => void gravarAdicionando()}>{gravando ? 'Gravando…' : rotuloAdicionar(conferencia?.prontas ?? 0)}</button>
        </>
      }
    >
      <div className="escolher-arquivo">
        <label className="mx-botao-secundario escolher-botao">
          Escolher arquivo
          <input type="file" className="so-leitor" accept=".csv,text/csv" disabled={ocupado} onChange={(e) => void escolher(e.target.files?.[0] ?? null)} />
        </label>
        <span className="apoio" aria-live="polite">{conferindo ? 'Conferindo…' : arquivo ? rotuloArquivo(arquivo.name, conferencia) : 'Nenhum arquivo escolhido'}</span>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {conferencia && <PainelConferencia conferencia={conferencia} aoBaixar={() => void baixarErros()} />}
    </Dialogo>
  );
}

/** Faixa de aviso do zerar: registros que foram ao FDV sem código de origem; some quando não há nenhum. */
export function AvisoSemChave({ semChave }: { semChave: number }) {
  return semChave > 0 ? <p className="faixa-aviso" role="status">{textoSemChave(semChave)}</p> : null;
}

/** Uma linha por motivo, só quando há conteúdo: "Leva junto", "Mantidos" (com o detalhe), anulados e bloqueios. Pura sobre a prévia. */
export function ResumoPrevia({ previa, escolhidos }: { previa: ZeragemPlataformaResposta; escolhidos: readonly CadastroZerarPortal[] }) {
  const junto = textoLevaJunto(previa.efetivos, escolhidos);
  const mantidos = textosMantidos(previa.mantidos);
  const anulados = textosAnulados(previa.anulados);
  return (
    <div className="previa-zerar" aria-live="polite">
      {junto && <p>{junto}</p>}
      {mantidos && (
        <div>
          <p>{mantidos.total}</p>
          <ul className="lista-simples apoio">{mantidos.detalhes.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {anulados.length > 0 && <ul className="lista-simples">{anulados.map((t) => <li key={t}>{t}</li>)}</ul>}
      <AvisoSemChave semChave={previa.sem_chave} />
    </div>
  );
}

/** "Zerar dados": escolhe os cadastros (ao menos um), vê a prévia (que refaz a cada mudança) e confirma com a frase. */
export function ZerarDados({ empresaId, aoFechar, aoZerar, selecaoInicial = [...CADASTROS_ZERAR_PORTAL], previaInicial = null }: { empresaId: string; aoFechar: () => void; aoZerar: (mantidos: number) => void; selecaoInicial?: readonly CadastroZerarPortal[]; previaInicial?: ZeragemPlataformaResposta | null }) {
  const [selecao, setSelecao] = useState<readonly CadastroZerarPortal[]>(selecaoInicial);
  const [previa, setPrevia] = useState<ZeragemPlataformaResposta | null>(previaInicial);
  const [carregando, setCarregando] = useState(false);
  const [erroPrevia, setErroPrevia] = useState('');
  const [bloqueiosApi, setBloqueiosApi] = useState<string[]>([]);
  const [recontar, setRecontar] = useState(0);
  // Seleção na ordem do contrato (a chave de idempotência e a prévia não dependem da ordem dos cliques).
  const escolhidos = CADASTROS_ZERAR_PORTAL.filter((c) => selecao.includes(c));

  useEffect(() => {
    if (escolhidos.length === 0) { setPrevia(null); setCarregando(false); return; }
    const ctl = new AbortController();
    setCarregando(true);
    setErroPrevia('');
    const t = setTimeout(() => {
      void pedirPreviaZerar(empresaId, escolhidos, fetch, ctl.signal).then((r) => {
        if (ctl.signal.aborted) return;
        setCarregando(false);
        seguir(r);
        if (r.ok) { setPrevia(r.valor); setBloqueiosApi([]); } else { setPrevia(null); setErroPrevia(r.erro); }
      });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [empresaId, escolhidos.join(','), recontar]);

  const alternar = (c: CadastroZerarPortal) => { setBloqueiosApi([]); setSelecao((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c])); };
  const bloqueiosTela = bloqueiosApi.length > 0 ? textosBloqueios(bloqueiosDeTextos(bloqueiosApi)) : [];
  // Bloqueios (da prévia e da resposta do zerar) ficam no rodapé fixo, junto do botão desligado.
  const bloqueiosFixos = [...new Set([...(previa && escolhidos.length > 0 ? textosBloqueios(previa.bloqueios) : []), ...bloqueiosTela])];

  return (
    <ConfirmarComFrase
      titulo="Zerar dados da empresa?"
      frase={FRASE_ZERAR_DADOS}
      rotulo="Zerar dados"
      rotuloEnviando="Zerando…"
      idEnvio={`zerar:${escolhidos.join(',')}`}
      podeEnviar={podeConfirmarZerar({ selecionados: escolhidos.length, previa, carregando, frase: FRASE_ZERAR_DADOS, enviando: false })}
      enviar={(chave, frase) => pedirZerar(empresaId, escolhidos, frase, chave)}
      aoSucesso={aoZerar}
      aoFalha={(r) => {
        if (r.codigo === CODIGO_ZERAGEM_BLOQUEADA) { setBloqueiosApi(r.bloqueios ?? []); return r.erro; }
        if (r.codigo === 'dados_mudaram') setRecontar((n) => n + 1);
        return undefined;
      }}
      aoFechar={aoFechar}
      aviso={AVISO_ZERAR}
      tomAviso="erro"
      bloqueio={bloqueiosFixos.length > 0 ? <ul className="faixa-erro lista-simples sem-margem" role="alert" aria-label="Zerar bloqueado">{bloqueiosFixos.map((t) => <li key={t}>{t}</li>)}</ul> : undefined}
    >
      <p className="sem-margem">{TEXTO_ANTES_DE_ZERAR}</p>
      <fieldset className="escolha-zerar">
        <legend>O que zerar</legend>
        <div className="grade-zerar">
          {CADASTROS_ZERAR_PORTAL.map((c) => (
            <label key={c} className="opcao-zerar">
              <input type="checkbox" className="mx-checkbox" checked={selecao.includes(c)} onChange={() => alternar(c)} />
              <span>{ROTULO_ZERAR[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {escolhidos.length === 0 && <p className="apoio">Escolha ao menos um cadastro.</p>}
      {erroPrevia && <p className="erro" role="alert">{erroPrevia}</p>}
      {previa && escolhidos.length > 0 && <ResumoPrevia previa={previa} escolhidos={escolhidos} />}
    </ConfirmarComFrase>
  );
}
