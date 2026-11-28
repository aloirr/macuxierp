import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { RegraDetalhe, FonteRegra } from '@macuxierp/fiscal/contracts';
import { ROTULO_CRT, ROTULO_TRIBUTO, paginaRegras, valoresDaRegra } from '@macuxierp/fiscal/web';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, DadosInvalidos, NaoAutenticado, SemPermissao, buscarRegistro, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { UUID_PADRAO } from '@/lib/uuid';
import { FormularioRegra } from '@/components/fiscal/formulario-regra';
import { Selo } from '@/components/descritor/ui-cliente';
import { FalhaIndisponivel } from '@/components/falha-indisponivel';
import { TEXTO_SEM_PERMISSAO } from '@/lib/telas/comum';
import { API_REGRA } from '@/lib/telas/fiscal';

/** Sessão vencida e senha provisória resolvem com redirect; sem permissão e API fora do ar viram texto fixo. */
function falha(e: unknown): React.ReactElement {
  if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
  if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
  if (e instanceof SemPermissao) return <p className="erro" role="alert">{TEXTO_SEM_PERMISSAO}</p>;
  if (e instanceof ApiIndisponivel || e instanceof DadosInvalidos) return <FalhaIndisponivel requestId={e instanceof ApiIndisponivel ? e.requestId : undefined} />;
  throw e;
}

/** Nova regra (T-0127): formulário vazio, com os padrões do módulo. A API revalida e só aceita quem tem `fiscal.regra.editar`. */
export function TelaRegraNova({ perfil }: { perfil: Perfil }) {
  return <FormularioRegra modo="criar" perfil={perfil} valores={valoresDaRegra()} />;
}

/** Regra aberta para editar: o `updated_at` viaja como If-Match; quem só vê abre com os campos desligados e sem a barra de escrita. */
export async function TelaRegraDetalhe({ acesso, perfil, id }: { acesso: string; perfil: Perfil; id: string }) {
  if (!UUID_PADRAO_COMPLETO.test(id)) notFound();
  try {
    const regra = await buscarRegistro(API_REGRA.replace(':id', id), RegraDetalhe, acesso, 'regra fiscal');
    if (regra === null) notFound();
    return <FormularioRegra modo="editar" perfil={perfil} valores={valoresDaRegra(regra)} id={regra.id} versao={regra.updated_at} />;
  } catch (e) {
    return falha(e);
  }
}
const UUID_PADRAO_COMPLETO = new RegExp(`^${UUID_PADRAO}$`);

const Tributo = z.object({
  ok: z.boolean(),
  versao: z.string().optional(),
  fonte: FonteRegra.nullable().optional(),
  erros: z.array(z.object({ mensagem: z.string() }).passthrough()).optional(),
});
const Resolucao = z.object({ data_emissao: z.string(), icms: Tributo, ipi: Tributo, pis: Tributo, cofins: Tributo });

/** Tipo da fonte em português: o mesmo texto da coluna "Tipo da fonte" da lista do fiscal (uma montagem só, a do módulo). */
const colunaTipoFonte = paginaRegras.colunas.find((c) => c.id === 'fonte_tipo');
const tipoDaFonte = (fonte: { tipo: string; referencia: string } | null | undefined): string => (fonte && colunaTipoFonte ? String((colunaTipoFonte.valor as (l: unknown) => unknown)({ fonte })) : '');

const CAMPOS_VALE = ['ncm', 'cfop', 'uf_origem', 'uf_destino', 'tipo_cliente', 'crt'] as const;
const TIPOS_CLIENTE = [{ valor: 'contribuinte', rotulo: 'Contribuinte' }, { valor: 'isento', rotulo: 'Isento' }, { valor: 'nao_contribuinte', rotulo: 'Não contribuinte' }];

/**
 * "Qual regra vale" (RN-FIS-01): a consulta fica na URL (`vale_ncm`, `vale_cfop`...), então funciona sem JavaScript e a resposta é a da API
 * (`GET /v1/fiscal/regras/resolver`): a mesma escolha do cálculo. Só leitura (`fiscal.ver`); o botão fica na barra do bloco.
 */
export async function QualRegraVale({ acesso, rota, busca }: { acesso: string; rota: string; busca: URLSearchParams }) {
  const q = Object.fromEntries(CAMPOS_VALE.map((c) => [c, (busca.get(`vale_${c}`) ?? '').trim()]));
  const preenchida = CAMPOS_VALE.every((c) => q[c] !== '');
  let resultado: React.ReactElement | null = null;
  if (preenchida) {
    try {
      const r = await getValidado(`/v1/fiscal/regras/resolver?${new URLSearchParams(q).toString()}`, Resolucao, acesso, 'qual regra vale', true);
      resultado = (
        <div className="tabela-rolavel">
          <table>
            <caption className="pular">Regra que vale para cada tributo</caption>
            <thead><tr><th scope="col">Tributo</th><th scope="col">Situação</th><th scope="col">Versão</th><th scope="col">Tipo da fonte</th><th scope="col">Fonte</th></tr></thead>
            <tbody>
              {(['icms', 'ipi', 'pis', 'cofins'] as const).map((t) => {
                const x = r[t];
                return (
                  <tr key={t}>
                    <th scope="row">{ROTULO_TRIBUTO[t]}</th>
                    <td><Selo selo={{ texto: x.ok ? 'Regra encontrada' : 'Sem regra', tom: x.ok ? 'ok' : 'erro' }} />{!x.ok && x.erros?.[0] && <span className="apoio"> {x.erros[0].mensagem}</span>}</td>
                    <td>{x.versao ?? ''}</td>
                    <td>{tipoDaFonte(x.fonte)}</td>
                    <td>{x.fonte ? x.fonte.referencia : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    } catch (e) {
      if (e instanceof DadosInvalidos) resultado = <p className="erro" role="alert">Confira os dados: NCM com 8 dígitos, CFOP com 4 e as UFs com 2 letras.</p>;
      else return falha(e);
    }
  }
  const campo = (nome: (typeof CAMPOS_VALE)[number], rotulo: string, colunas: number, opcoes?: readonly { valor: string; rotulo: string }[]) => (
    <label className={`campo campo-col-${colunas}`}>
      <span>{rotulo}</span>
      {opcoes ? (
        <select name={`vale_${nome}`} defaultValue={q[nome]}><option value="">Selecione</option>{opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}</select>
      ) : (
        <input name={`vale_${nome}`} defaultValue={q[nome]} maxLength={nome === 'ncm' ? 8 : nome === 'cfop' ? 4 : 2} autoComplete="off" />
      )}
    </label>
  );
  return (
    <>
    <section className="cartao-ficha cartao-consulta" aria-labelledby="h-vale">
      <h2 id="h-vale" className="titulo-cartao">Qual regra vale</h2>
      <p className="apoio">Informe a operação com os 8 dígitos do NCM, o CFOP de 4 e as UFs de 2 letras; a resposta é a regra que o cálculo usaria hoje.</p>
      <form method="get" action={rota} className="formulario">
        {campo('ncm', 'NCM (produto)', 2)}
        {campo('cfop', 'CFOP', 2)}
        {campo('uf_origem', 'UF origem', 2)}
        {campo('uf_destino', 'UF destino', 2)}
        {campo('tipo_cliente', 'Cliente', 2, TIPOS_CLIENTE)}
        {campo('crt', 'Regime (CRT)', 2, Object.entries(ROTULO_CRT).map(([valor, rotulo]) => ({ valor, rotulo })))}
        <div className="barra-acoes barra-bloco"><button className="mx-botao-secundario" type="submit">Consultar</button></div>
      </form>
    </section>
    {resultado && (
      <section className="cartao-ficha cartao-consulta" aria-labelledby="h-vale-resultado">
        <h2 id="h-vale-resultado" className="titulo-cartao">Regra que vale</h2>
        {resultado}
      </section>
    )}
    </>
  );
}
