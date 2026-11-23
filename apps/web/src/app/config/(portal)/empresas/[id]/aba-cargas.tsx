'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { CaixaResumo, Chip, Dialogo } from '@macuxierp/ui';
import { FraseConfirmacao } from '@/components/frase-confirmacao';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import {
  AVISO_LIMITE_FDV, ROTULO_MODO, TEXTO_SUBSTITUIR, caixasDaConferencia, conferirArquivoEscolhido, enderecoModelo, linhasCargas, pedirConferencia, pedirErros, pedirGravacao, podeGravar,
  rotuloAdicionar, rotuloLinhaErro, textoEfeito, textoErrosOmitidos, textoLinhaErro, tituloImportar, type LinhaCarga, type Retorno,
} from '@/lib/config/cargas';
import {
  FRASE_SUBSTITUIR_TUDO, fraseConfere, nomeErrosCarga, plural, substituirPermitido, type CadastroCargaPortal, type EfeitoSubstituir as Efeito, type ModoGravarCarga, type SituacaoCargasPlataforma,
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
        {l.podeImportar ? (
          <>
            <Chip tom={l.chip.tom}>{l.chip.texto}</Chip>
            {l.ultima && <span className="apoio"> {l.ultima}</span>}
          </>
        ) : (
          <span className="carga-antes">Carregue antes: {l.antes}.</span>
        )}
      </span>
      <a className="carga-modelo" href={enderecoModelo(empresaId, l.cadastro)}>Modelo</a>
      <button type="button" className="mx-botao-secundario" disabled={!l.podeImportar} aria-label={`Importar ${l.rotulo}`} onClick={aoImportar}>Importar</button>
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
  const [frase, setFrase] = useState('');
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
      setFrase('');
      setConfirmando(true);
    } else setErro(r.ok ? 'Não foi possível calcular o efeito. Tente de novo.' : r.erro);
  };

  const gravar = async (modo: ModoGravarCarga) => {
    if (!arquivo || !conferencia || !podeGravar(conferencia)) return;
    if (modo === 'substituir_tudo' && !fraseConfere(frase, FRASE_SUBSTITUIR_TUDO)) return;
    const id = `gravar:${modo}:${arquivo.name}:${arquivo.size}:${arquivo.lastModified}`;
    setGravando(true);
    setErro('');
    const r = await pedirGravacao(empresaId, cadastro, arquivo, chaves.current.de(id), modo, frase);
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
  if (confirmando && efeito) {
    return (
      <Dialogo
        titulo={`Substituir tudo em ${tituloImportar(cadastro).replace('Importar ', '')}?`}
        aoFechar={() => setConfirmando(false)}
        rodape={
          <>
            <button type="button" className="mx-botao-secundario" onClick={() => { setConfirmando(false); setFrase(''); setErro(''); }}>Cancelar</button>
            <button type="button" className="mx-botao botao-perigo-cheio" data-destrutivo="true" disabled={gravando || !fraseConfere(frase, FRASE_SUBSTITUIR_TUDO)} onClick={() => void gravar('substituir_tudo')}>
              {gravando ? 'Substituindo…' : ROTULO_MODO.substituir_tudo}
            </button>
          </>
        }
      >
        <p>{TEXTO_SUBSTITUIR}</p>
        <EfeitoSubstituir cadastro={cadastro} efeito={efeito} />
        <FraseConfirmacao frase={FRASE_SUBSTITUIR_TUDO} valor={frase} aoMudar={setFrase} erro={!!erro} />
        {erro && <p className="erro" role="alert">{erro}</p>}
      </Dialogo>
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
          <button type="button" className="mx-botao" disabled={!pronto} onClick={() => void gravar('adicionar')}>{gravando ? 'Gravando…' : rotuloAdicionar(conferencia?.prontas ?? 0)}</button>
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
