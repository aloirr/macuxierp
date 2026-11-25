'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { CaixaResumo, Chip, Dialogo, DialogoMotivo, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { ConfirmarComFrase } from '@/components/confirmar-com-frase';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { salvarCsv } from '@/lib/baixar-csv';
import { avisoCarga, estadoCargaCompleta, rotuloComLote } from '@/lib/config/integracao-fdv';
import { cargaCompletaFdvAcao } from '../acoes-integracao-fdv';
import {
  AVISO_LIMITE_FDV, ROTULO_MODO, TEXTO_SUBSTITUIR, caixasDaConferencia, conferirArquivoEscolhido, enderecoModelo, linhasCargas, pedirConferencia, pedirErros, pedirGravacao,
  podeGravar, rotuloAdicionar, rotuloLinhaErro, textoEfeito, textoGravado, textoErrosOmitidos, textoLinhaErro, tituloImportar, type LinhaCarga, type Retorno,
} from '@/lib/config/cargas';
import {
  FRASE_SUBSTITUIR_TUDO, nomeErrosCarga, plural, substituirPermitido, type CadastroCargaPortal, type IntegracaoFdvPlataforma, type EfeitoSubstituir as Efeito, type GravarCargaPlataformaResposta, type ModoGravarCarga, type SituacaoCargasPlataforma,
  type ValidarCargaPlataformaResposta as Conferencia,
} from '@macuxierp/platform-sdk';

/**
 * Aba "Dados" da ficha da empresa (era "Cargas", T-0058; T-0086 v0.3.12): cargas recentes e importação numa tabela só, uma linha por
 * cadastro, com situação, última carga (data, hora, registros e origem), Modelo, Importar e Carga completa (reenvia tudo ao FDV, com
 * confirmação; decisão do PO em 24/11: a carga completa fica aqui, não na aba Integração). "Importar" abre a conferência
 * automática (sem botão Validar), "Adicionar" acrescenta e atualiza, "Substituir tudo" pede uma frase. O "Zerar" saiu daqui: é por
 * cadastro, na aba Integração. Tudo passa pelos route handlers do portal (`/config/empresas/:id/cargas/...`, cookie mx_config). O
 * arquivo fica só na memória desta tela, o tempo do envio.
 */

/** 401 e a troca de senha pendente levam a outra página; o resto volta como texto. */
function seguir(r: Retorno<unknown>): void {
  if (!r.ok && r.redirecionar) window.location.assign(r.redirecionar);
}

/**
 * Origem da última carga. O contrato (`UltimaCarga`) ainda não diz se veio do Conector ou de CSV: as cargas desta aba são todas
 * por CSV, então é "CSV" quando há carga e "—" sem ela. `Conector` entra aqui quando o SDK trouxer o campo.
 */
export const origemDaCarga = (l: Pick<LinhaCarga, 'ultima'>): 'CSV' | 'Conector' | null => (l.ultima ? 'CSV' : null);

export function AbaDados({ empresaId, dados, fuso, integracao = null }: { empresaId: string; dados: SituacaoCargasPlataforma | null; fuso: string; integracao?: IntegracaoFdvPlataforma | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [carga, setCarga] = useState<LinhaCarga | null>(null);
  const [falha, setFalha] = useState('');
  const chaves = useRef(new ChavesIdempotencia());
  const [importar, setImportar] = useState<CadastroCargaPortal | null>(null);
  const [aviso, setAviso] = useState('');
  const linhas = linhasCargas(dados, fuso);

  if (!dados) {
    return (
      <>
        <p className="erro" role="alert">Não foi possível carregar os dados.</p>
        <a className="mx-botao-secundario" href={`/config/empresas/${encodeURIComponent(empresaId)}?aba=dados`}>Tentar de novo</a>
      </>
    );
  }
  /** Uma Idempotency-Key por entidade; só renova depois de resposta definitiva. Cadastro com duas entidades (condição, cliente) manda uma por vez. */
  const pedirCargaCompleta = (l: LinhaCarga) => {
    setCarga(null);
    setFalha('');
    iniciar(async () => {
      for (const e of estadoCargaCompleta(l.cadastro, integracao).entidades) {
        const id = `carga:${e}`;
        const r = await cargaCompletaFdvAcao(empresaId, e, chaves.current.de(id));
        chaves.current.aposResposta(id, r);
        if (!r.ok) return setFalha(r.erro || 'Não foi possível pedir a carga completa. Tente de novo.');
      }
      setAviso(`Carga completa pedida: ${l.rotulo}.`);
      router.refresh();
    });
  };
  const colunas: ColunaTabela<LinhaCarga>[] = [
    { id: 'cadastro', titulo: 'Cadastro', celula: (l) => l.rotulo },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => <Chip tom={l.chip.tom}>{l.chip.texto}</Chip> },
    { id: 'ultima', titulo: 'Última carga', tipo: 'data', celula: (l) => l.ultima ?? '—' },
    { id: 'origem', titulo: 'Origem', celula: (l) => origemDaCarga(l) ?? '—' },
    { id: 'acoes', titulo: 'Ações', celula: (l) => {
      const c = estadoCargaCompleta(l.cadastro, integracao);
      return (
        <span className="barra-acoes" style={{ margin: 0 }}>
          <a className="carga-modelo" href={enderecoModelo(empresaId, l.cadastro)} aria-label={`Modelo de ${l.rotulo}`}>Modelo</a>
          <button type="button" className="mx-botao-secundario" aria-label={`Importar ${l.rotulo}`} onClick={() => setImportar(l.cadastro)}>Importar</button>
          {c.visivel && <button type="button" className="mx-botao-secundario" style={{ whiteSpace: 'nowrap' }} disabled={pendente || c.loteEmVoo} aria-label={`Carga completa: ${l.rotulo}`} onClick={() => setCarga(l)}>{rotuloComLote(c.loteEmVoo, 'Carga completa')}</button>}
        </span>
      );
    } },
  ];
  return (
    <section aria-label="Dados">
      {aviso && <p className="faixa-aviso" role="status">{aviso}</p>}
      {falha && <p className="erro" role="alert">{falha}</p>}
      <div className="tabela-rolavel com-sinal-rolagem tabela-dados legenda-so-leitor">
        <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.cadastro} textoVazio="Nenhum cadastro." legenda="Cargas por cadastro" />
      </div>
      {carga && (
        <DialogoMotivo
          titulo={`Carga completa de ${carga.rotulo}?`}
          aviso={avisoCarga}
          semTexto
          rotuloConfirmar="Carga completa"
          aoConfirmar={() => pedirCargaCompleta(carga)}
          aoCancelar={() => setCarga(null)}
        />
      )}
      {importar && (
        <ImportarCarga
          empresaId={empresaId}
          cadastro={importar}
          aoFechar={() => setImportar(null)}
          aoGravar={(g) => {
            setImportar(null);
            setAviso(textoGravado(g));
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

/** O que o "Substituir tudo" faria neste cadastro; acima de 30% o FDV pode segurar o envio (aviso único em cargas.ts). Só na janela de confirmação. */
export function EfeitoSubstituir({ cadastro, efeito }: { cadastro: CadastroCargaPortal; efeito: Efeito }) {
  return (
    <div className="efeito-substituir">
      <p>{textoEfeito(cadastro, efeito)}</p>
      {efeito.acima_limite_fdv && <p className="faixa-aviso" role="status">{AVISO_LIMITE_FDV}</p>}
    </div>
  );
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

export function ImportarCarga({ empresaId, cadastro, aoFechar, aoGravar }: { empresaId: string; cadastro: CadastroCargaPortal; aoFechar: () => void; aoGravar: (g: Pick<GravarCargaPlataformaResposta, 'gravadas' | 'enderecos_inativados'>) => void }) {
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
    if (r.ok) aoGravar(r.valor);
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
        aoSucesso={(g) => aoGravar(g)}
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
