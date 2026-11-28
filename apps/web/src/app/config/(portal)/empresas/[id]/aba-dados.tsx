'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { CaixaResumo, Chip, Dialogo, DialogoMotivo, MenuAcoes, ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela } from '@macuxierp/ui';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { ConfirmarComFrase } from '@/components/confirmar-com-frase';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { salvarCsv } from '@/lib/baixar-csv';
import { acoesDaCarga, avisoCarga, estadoCargaCompleta, menuDaLinha } from '@/lib/config/integracao-fdv';
import { cargaCompletaFdvAcao } from '@/lib/acoes-cliente';
import { origemDaCarga, ultimoLoteDoCadastro } from '@/lib/config/ligacoes';
import { AUSENTE } from '@/lib/config/empresa';
import {
  AVISO_LIMITE_FDV, ROTULO_MODO, TEXTO_SUBSTITUIR, caixasDaConferencia, conferirArquivoEscolhido, enderecoModelo, linhasCargas, pedirConferencia, pedirErros, pedirGravacao,
  podeGravar, rotuloAdicionar, rotuloLinhaErro, textoEfeito, textoGravado, textoErrosOmitidos, textoLinhaErro, tituloImportar, type LinhaCarga, type Retorno,
} from '@/lib/config/cargas';
import {
  FRASE_SUBSTITUIR_TUDO, nomeErrosCarga, plural, substituirPermitido, type CadastroCargaPortal, type IntegracaoFdvPlataforma, type PortalEntradaLeitura, type EfeitoSubstituir as Efeito, type GravarCargaPlataformaResposta, type ModoGravarCarga, type SituacaoCargasPlataforma,
  type ValidarCargaPlataformaResposta as Conferencia,
} from '@macuxierp/platform-sdk';

/**
 * Aba "Dados" da ficha da empresa (era "Cargas", T-0058; T-0086 v0.3.12; v0.3.24: dividida pelos dois sentidos das ligações,
 * "Sistema do cliente → ERP" com os cadastros recebidos e "ERP → Força de vendas" com os enviados, `SecaoEnvioFdv`): cargas recentes e importação numa tabela só, uma linha por
 * cadastro, com situação, última carga (data, hora, registros e origem), Modelo, Importar e Carga completa (reenvia tudo ao FDV, com
 * confirmação; decisão do PO em 24/11: a carga completa fica aqui, não na aba Integração). "Importar" abre a conferência
 * automática (sem botão Validar), "Adicionar" acrescenta e atualiza, "Substituir tudo" pede uma frase. O "Zerar" saiu daqui: é por
 * cadastro, na aba Integração. Tudo passa pelos route handlers do portal (`/config/empresas/:id/cargas/...`, cookie mx_config). O
 * arquivo fica só na memória desta tela, o tempo do envio.
 */

export const LEGENDA_RECEBIDOS = 'Cadastros recebidos';

/** 401 e a troca de senha pendente levam a outra página; o resto volta como texto. */
function seguir(r: Retorno<unknown>): void {
  if (!r.ok && r.redirecionar) window.location.assign(r.redirecionar);
}

export function AbaDados({ empresaId, dados, fuso, integracao = null, entrada = null }: { empresaId: string; dados: SituacaoCargasPlataforma | null; fuso: string; integracao?: IntegracaoFdvPlataforma | null; entrada?: PortalEntradaLeitura | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [carga, setCarga] = useState<LinhaCarga | null>(null);
  const chaves = useRef(new ChavesIdempotencia());
  const [importar, setImportar] = useState<CadastroCargaPortal | null>(null);
  // 36 A: o retorno das ações do menu "Ações" (Carga completa, Importar) fica logo abaixo da tabela, não no topo.
  const [resultado, chaveResultado, mostrar] = useResultado();
  const linhas = linhasCargas(dados, fuso);
  // O último lote de cada cadastro, calculado uma vez por linha (RD-1118).
  const lotes = new Map(linhas.map((l) => [l.cadastro, ultimoLoteDoCadastro(entrada?.lotes ?? [], l.cadastro)] as const));

  if (!dados) {
    return (
      <>
        <p className="erro" role="alert">Não foi possível carregar os dados.</p>
        <a className="mx-botao-secundario" href={`/config/empresas/${encodeURIComponent(empresaId)}?aba=integracao`}>Recarregar</a>
      </>
    );
  }
  /** Uma Idempotency-Key por entidade; só renova depois de resposta definitiva. Cadastro com duas entidades (condição, cliente) manda uma por vez. */
  const pedirCargaCompleta = (l: LinhaCarga) => {
    setCarga(null);
    iniciar(async () => {
      for (const e of estadoCargaCompleta(l.cadastro, integracao).entidades) {
        const id = `carga:${e}`;
        const r = await cargaCompletaFdvAcao(empresaId, e, chaves.current.de(id));
        chaves.current.aposResposta(id, r);
        if (!r.ok) return mostrar(resultadoErro(r.erro || 'Não foi possível pedir a carga completa. Tente de novo.'));
      }
      mostrar(resultadoSucesso(`Carga completa pedida: ${l.rotulo}.`));
      router.refresh();
    });
  };
  const colunas: ColunaTabela<LinhaCarga>[] = [
    // #840: em tela estreita a última carga sobe para sob o nome e a coluna dela some (só um dos dois aparece, por CSS).
    { id: 'cadastro', titulo: 'Cadastro', celula: (l) => <>{l.rotulo}<span className="carga-sob-nome">Última carga: {l.ultima ?? AUSENTE}</span></> },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => <Chip tom={l.chip.tom}>{l.chip.texto}</Chip> },
    { id: 'ultima', titulo: 'Última carga', tipo: 'data', celula: (l) => l.ultima ?? AUSENTE },
    // "Registros" e "Com erro" são do último lote recebido pela ligação do sistema do cliente (a tabela "Lotes recebidos" saiu, RD-1103).
    { id: 'registros', titulo: 'Registros', tipo: 'numero', celula: (l) => lotes.get(l.cadastro)?.recebidos ?? '—' },
    { id: 'comErro', titulo: 'Com erro', tipo: 'numero', celula: (l) => lotes.get(l.cadastro)?.com_erro ?? '—' },
    { id: 'origem', titulo: 'Origem', celula: (l) => origemDaCarga(l.ultimaEm, lotes.get(l.cadastro) ?? null) ?? '—' },
    { id: 'acoes', titulo: 'Ações', celula: (l) => {
      const c = estadoCargaCompleta(l.cadastro, integracao);
      // Botão "Ações" (T-0099): Importar à vista; o Modelo (baixa o CSV) e a Carga completa ficam no menu.
      const a = acoesDaCarga(c, pendente);
      const fazer: Record<string, () => void> = { importar: () => setImportar(l.cadastro), modelo: () => window.location.assign(enderecoModelo(empresaId, l.cadastro)), 'carga-completa': () => setCarga(l) };
      return <MenuAcoes rotuloLinha={l.rotulo} {...menuDaLinha(a, fazer)} />;
    } },
  ];
  return (
    <div className="dados-entrada">
      <div className="tabela-rolavel com-sinal-rolagem tabela-dados legenda-so-leitor">
        <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.cadastro} textoVazio="Nenhum cadastro." legenda={LEGENDA_RECEBIDOS} />
      </div>
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
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
            mostrar(resultadoSucesso(textoGravado(g)));
            router.refresh();
          }}
        />
      )}
    </div>
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
          <input type="file" className="entrada-arquivo" accept=".csv,text/csv" disabled={ocupado} onChange={(e) => void escolher(e.target.files?.[0] ?? null)} />
        </label>
        <span className="apoio" aria-live="polite">{conferindo ? 'Conferindo…' : arquivo ? rotuloArquivo(arquivo.name, conferencia) : 'Nenhum arquivo escolhido'}</span>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {conferencia && <PainelConferencia conferencia={conferencia} aoBaixar={() => void baixarErros()} />}
    </Dialogo>
  );
}
