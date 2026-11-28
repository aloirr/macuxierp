'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialogo, RegiaoErros, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { GRUPOS_REGRA, acoesDaRegra, corpoDaRegra, type CampoRegra, type ErrosRegra, type ValoresRegra } from '@macuxierp/fiscal/web';
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { escrever } from '@/lib/acoes-cliente';
import { resultadoErro } from '@/lib/resultado-acao';
import { aposResposta, chaveParaEnvio, novoEstado, type EstadoChave } from '@/lib/descritor/idempotencia';
import { API_REGRA, API_REGRAS, ROTA_REGRAS_FISCAIS, TEXTO_CAMPO } from '@/lib/telas/fiscal';
import { novaChave } from '@/lib/telas/comum';

/** Campo da API que a tela mostra em outro campo (a fonte é um par: tipo e referência). */
const CAMPO_DA_TELA: Readonly<Record<string, string>> = { fonte: 'fonte_referencia' };

interface Props {
  modo: 'criar' | 'editar';
  perfil: Perfil;
  /** Valores digitados iniciais (o módulo os monta: `valoresDaRegra`). */
  valores: ValoresRegra;
  /** Só na edição: o id da regra e o `updated_at` que viaja como If-Match. */
  id?: string;
  versao?: string;
}

/**
 * Formulário da regra fiscal (T-0127): campos e grade vêm do módulo (`GRUPOS_REGRA`, 12 colunas), a validação é a do `domain` (`corpoDaRegra`) e a API
 * revalida. Uma barra de botões só, no rodapé (regra 12): Salvar e Descartar à esquerda, Excluir (vermelho) à direita. Quem não tem
 * `fiscal.regra.editar` vê os campos desligados e não tem barra de escrita.
 */
export function FormularioRegra({ modo, perfil, valores: iniciais, id, versao }: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresRegra>(iniciais);
  const [erros, setErros] = useState<ErrosRegra>({});
  const [resultado, chaveResultado, mostrar, limpar] = useResultado();
  const [ocupado, setOcupado] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const chave = useRef<EstadoChave | null>(null);
  const editavel = pode(perfil, 'fiscal.regra.editar');
  const barra = acoesDaRegra(perfil, modo);
  const trocar = (nome: string, v: string) => setValores((x) => ({ ...x, [nome]: v }));

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editavel) return;
    limpar();
    const r = corpoDaRegra(valores);
    setErros(r.ok ? {} : r.erros);
    if (!r.ok) return;
    setOcupado(true);
    const criar = modo === 'criar';
    const estado = chaveParaEnvio(chave.current ?? novoEstado(novaChave), r.corpo, novaChave);
    chave.current = estado;
    const e = await escrever({
      metodo: criar ? 'POST' : 'PUT', caminho: criar ? API_REGRAS : API_REGRA.replace(':id', id ?? ''), corpo: r.corpo,
      ...(criar ? { idempotencia: estado.chave } : { versao: versao ?? '' }), recarregar: ROTA_REGRAS_FISCAIS,
    });
    chave.current = aposResposta(estado, Boolean(e.definitivo));
    setOcupado(false);
    if (e.ok) return router.push(ROTA_REGRAS_FISCAIS);
    setErros(Object.fromEntries(Object.entries(e.campos ?? {}).map(([k, m]) => [CAMPO_DA_TELA[k] ?? k, m])));
    mostrar(resultadoErro(e.mensagem));
  }

  async function excluir() {
    setOcupado(true);
    const e = await escrever({ metodo: 'DELETE', caminho: API_REGRA.replace(':id', id ?? ''), recarregar: ROTA_REGRAS_FISCAIS });
    setOcupado(false);
    setExcluindo(false);
    if (e.ok) return router.push(ROTA_REGRAS_FISCAIS);
    mostrar(resultadoErro(e.mensagem));
  }

  const descartar = () => { setValores(iniciais); setErros({}); limpar(); };
  const acao = (a: 'salvar' | 'descartar' | 'excluir') => [...barra.esquerda, ...barra.direita].find((x) => x.id === a);

  return (
    <form className="formulario" onSubmit={(ev) => void salvar(ev)} noValidate aria-busy={ocupado} aria-label={modo === 'criar' ? 'Nova regra fiscal' : 'Regra fiscal'}>
      <RegiaoErros temErro={Object.keys(erros).length > 0 || resultado !== null} />
      {GRUPOS_REGRA.map((g) => (
        <fieldset key={g.id} className="cartao-ficha" aria-labelledby={`h-regra-${g.id}`}>
          <h2 id={`h-regra-${g.id}`} className="titulo-cartao">{g.titulo}</h2>
          <div className="formulario">
            {g.campos.map((c) => <CampoDaRegra key={c.nome} campo={c} valor={valores[c.nome] ?? ''} erro={erros[c.nome]} desligado={!editavel || ocupado} aoMudar={(v) => trocar(c.nome, v)} />)}
          </div>
        </fieldset>
      ))}
      <div className="barra-acoes barra-bloco">
        {acao('salvar') && <button className="mx-botao" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : acao('salvar')?.rotulo}</button>}
        {acao('descartar') && <button className="mx-botao-secundario" type="button" disabled={ocupado} onClick={descartar}>{acao('descartar')?.rotulo}</button>}
        {!editavel && <Link className="mx-botao-secundario" href={ROTA_REGRAS_FISCAIS}>Voltar</Link>}
        {acao('excluir') && <button className="mx-botao-secundario botao-perigo-contorno botao-direita" type="button" disabled={ocupado} onClick={() => setExcluindo(true)}>{acao('excluir')?.rotulo}</button>}
      </div>
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
      {excluindo && (
        <Dialogo
          titulo="Excluir esta regra?"
          aviso="A regra deixa de valer nas próximas notas. A exclusão fica registrada."
          aoFechar={() => setExcluindo(false)}
          rodape={(
            <div className="barra-acoes">
              <button className="mx-botao" type="button" disabled={ocupado} onClick={() => void excluir()}>Excluir regra</button>
              <button className="mx-botao-secundario" type="button" onClick={() => setExcluindo(false)}>Cancelar</button>
            </div>
          )}
        >
          <></>
        </Dialogo>
      )}
    </form>
  );
}

function CampoDaRegra({ campo: c, valor, erro, desligado, aoMudar }: { campo: CampoRegra; valor: string; erro: string | undefined; desligado: boolean; aoMudar: (v: string) => void }) {
  const id = `campo-${c.nome}`;
  const texto = TEXTO_CAMPO[c.nome];
  const rotulo = texto?.rotulo ?? c.rotulo;
  const ajuda = texto?.ajuda ?? c.ajuda;
  const comum = { id, disabled: desligado, 'aria-invalid': erro ? true : undefined, 'aria-describedby': erro ? `${id}-erro` : ajuda ? `${id}-ajuda` : undefined } as const;
  return (
    <label className={`campo campo-alinhado campo-col-${c.colunas}`} htmlFor={id}>
      <span>{rotulo}{c.obrigatorio ? ' *' : ''}</span>
      {c.opcoes ? (
        <select {...comum} value={valor} onChange={(e) => aoMudar(e.target.value)}>
          {c.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      ) : (
        <input {...comum} type={c.tipo === 'data' ? 'date' : 'text'} lang="pt-BR" inputMode={c.tipo === 'percentual' || c.tipo === 'decimal4' ? 'decimal' : undefined} value={valor} onChange={(e) => aoMudar(e.target.value)} />
      )}
      {ajuda && <small className="apoio" id={`${id}-ajuda`}>{ajuda}</small>}
      {erro && <span id={`${id}-erro`} className="erro-campo">{erro}</span>}
    </label>
  );
}
