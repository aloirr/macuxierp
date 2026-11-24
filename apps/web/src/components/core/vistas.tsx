import type { MatrizDePerfis } from '@/lib/telas/core';
import type { quadroEmpresaFiscal } from '@macuxierp/core/web';
import { Selo } from '@/components/descritor/ui-cliente';

/**
 * Quadros só de leitura do core: perfis e permissões (T-0087) e empresa e ambiente fiscal (T-0088). Servidor, sem estado: recebem o que
 * o adaptador montou (`lib/telas/core.ts`). O ambiente fiscal NÃO tem botão de troca: produção só pela rota da T-0030 (RN-CORE-08).
 */
/** O grupo já diz o módulo: a linha mostra o código sem o prefixo (o completo vai no title) até o SDK trazer o rótulo em português da ação. */
const semPrefixo = (acao: string): string => acao.split('.').slice(1).join('.') || acao;

export function VistaPerfis({ matriz }: { matriz: MatrizDePerfis }) {
  return (
    <section aria-label="Permissões por perfil">
      <div className="tabela-rolavel">
        <table className="matriz-perfis">
          <thead>
            <tr>
              <th scope="col">Permissão</th>
              {matriz.perfis.map((p) => <th key={p.perfil} scope="col">{p.rotulo}</th>)}
            </tr>
          </thead>
          {matriz.grupos.map((g) => (
            <tbody key={g.modulo}>
              <tr className="matriz-grupo"><th scope="colgroup" colSpan={matriz.perfis.length + 1}>{g.rotulo}</th></tr>
              {g.linhas.map((l) => (
                <tr key={l.acao}>
                  <th scope="row" title={l.acao}>{semPrefixo(l.acao)}</th>
                  {l.por_perfil.map((pode, i) => (
                    <td key={matriz.perfis[i]?.perfil ?? i}>{pode ? <span>Sim</span> : <span aria-label="Não">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

export function VistaAmbienteFiscal({ quadro }: { quadro: ReturnType<typeof quadroEmpresaFiscal> }) {
  const e = quadro.empresa;
  return (
    <section aria-label="Empresa e ambiente fiscal">
      <dl className="ficha">
        <div><dt>Razão social</dt><dd>{e.razao_social}</dd></div>
        {e.nome_fantasia && <div><dt>Nome fantasia</dt><dd>{e.nome_fantasia}</dd></div>}
        <div><dt>CNPJ</dt><dd className="num sem-quebra">{e.cnpj}</dd></div>
        {e.ie && <div><dt>Inscrição estadual</dt><dd className="num sem-quebra">{e.ie}</dd></div>}
        <div><dt>Fuso horário</dt><dd>{e.fuso}</dd></div>
      </dl>
      <h2>Ambiente por filial</h2>
      {quadro.filiais.length === 0 ? (
        <p className="apoio">Nenhuma filial com ambiente fiscal configurado.</p>
      ) : (
        <div className="tabela-rolavel">
          <table>
            <thead><tr><th scope="col">Filial</th><th scope="col">Ambiente</th></tr></thead>
            <tbody>
              {quadro.filiais.map((f) => (
                <tr key={f.filial_id}>
                  <th scope="row">{f.filial}</th>
                  <td><Selo selo={{ texto: f.rotulo, tom: f.ambiente === 'producao' ? 'ok' : 'aviso' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {quadro.texto_homologacao && <p className="apoio" data-texto-homologacao>{quadro.texto_homologacao}</p>}
    </section>
  );
}
