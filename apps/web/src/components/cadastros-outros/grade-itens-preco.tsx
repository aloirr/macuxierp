'use client';
/**
 * Grade editável dos itens da tabela de preço (T-0123, lote C). Cada linha é filial, produto, preço em reais e desconto máximo em %; o botão
 * Salvar envia só as linhas novas ou alteradas num `PUT` em lote (idempotente) e o erro volta à linha certa. Regras (RN-CAD-06) e corpo vêm do módulo,
 * por `lib/telas/cadastros-outros/itens-preco.ts`; a API revalida. Botões só na barra do rodapé da página (regra 12).
 */
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela } from '@macuxierp/ui';
import type { Perfil } from '@macuxierp/platform-sdk';
import { apiItensPreco } from '@macuxierp/cadastros/web';
import type { Opcao } from '@/lib/descritor/fontes';
import { aposResposta, chaveParaEnvio, novoEstado, type EstadoChave } from '@/lib/descritor/idempotencia';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { escrever } from '@/lib/acoes-cliente';
import { errosDaApiPorLinha, linhaVazia, lotePorLinha, type ErrosPorLinha, type LinhaPreco } from '@/lib/telas/cadastros-outros/itens-preco';
import { novaChave } from '@/lib/telas/comum';

type Campo = 'filial_id' | 'produto_id' | 'preco_centavos' | 'desconto_maximo_bp';

export function GradeItensPreco({ tabelaId, iniciais, filiais, produtos, perfil, voltar, proxima, rota }: {
  tabelaId: string; iniciais: readonly LinhaPreco[]; filiais: readonly Opcao[]; produtos: readonly Opcao[]; perfil: Perfil; voltar: string; proxima: string | null; rota: string;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<LinhaPreco[]>([...iniciais]);
  const originais = useRef<readonly LinhaPreco[]>(iniciais);
  const [erros, setErros] = useState<ErrosPorLinha>({});
  const [resultado, chaveResultado, mostrar, limpar] = useResultado();
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef<EstadoChave | null>(null);
  const contador = useRef(0);

  const trocar = (k: string, campo: Campo, v: string) => setLinhas((ls) => ls.map((l) => (l.chave === k ? { ...l, [campo]: v } : l)));
  const nova = () => setLinhas((ls) => [...ls, linhaVazia(`nova-${++contador.current}`)]);
  const descartarNova = (k: string) => setLinhas((ls) => ls.filter((l) => l.chave !== k));

  async function salvar() {
    limpar();
    const lote = lotePorLinha(linhas, originais.current, perfil);
    setErros(lote.erros);
    if (lote.nada) return mostrar(resultadoErro('Nada foi alterado.'));
    if (!lote.corpo) return mostrar(resultadoErro('Corrija as linhas marcadas e salve de novo.'));
    setOcupado(true);
    const estado = chaveParaEnvio(chave.current ?? novoEstado(novaChave), lote.corpo, novaChave);
    chave.current = estado;
    const r = await escrever({ metodo: 'PUT', caminho: apiItensPreco(tabelaId), corpo: lote.corpo, idempotencia: estado.chave, recarregar: rota });
    chave.current = aposResposta(estado, Boolean(r.definitivo));
    setOcupado(false);
    if (r.ok) {
      mostrar(resultadoSucesso(`${lote.corpo.itens.length} ${lote.corpo.itens.length === 1 ? 'item enviado' : 'itens enviados'}.`));
      chave.current = null;
      return router.refresh();
    }
    const { porLinha, geral } = errosDaApiPorLinha(r.campos, lote.chaves);
    setErros(porLinha);
    mostrar(resultadoErro(geral ?? r.mensagem));
  }

  const celulaErro = (l: LinhaPreco, campo: Campo | 'linha') => erros[l.chave]?.[campo];
  const campo = (l: LinhaPreco, c: Campo, rotulo: string, extra?: { inputMode?: 'decimal' }) => (
    <>
      <input aria-label={`${rotulo}, linha ${linhas.indexOf(l) + 1}`} value={l[c]} onChange={(e) => trocar(l.chave, c, e.target.value)} aria-invalid={celulaErro(l, c) ? true : undefined} {...extra} />
      {celulaErro(l, c) && <span className="erro-campo">{celulaErro(l, c)}</span>}
    </>
  );
  const seletor = (l: LinhaPreco, c: 'filial_id' | 'produto_id', rotulo: string, opcoes: readonly Opcao[]) => (
    <>
      <select aria-label={`${rotulo}, linha ${linhas.indexOf(l) + 1}`} value={l[c]} onChange={(e) => trocar(l.chave, c, e.target.value)} aria-invalid={celulaErro(l, c) ? true : undefined}>
        <option value="">Selecione</option>
        {/* o item gravado de uma opção fora das 200 primeiras continua visível */}
        {l[c] !== '' && !opcoes.some((o) => o.valor === l[c]) && <option value={l[c]}>{l[c]}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {celulaErro(l, c) && <span className="erro-campo">{celulaErro(l, c)}</span>}
    </>
  );
  const colunas: ColunaTabela<LinhaPreco>[] = [
    { id: 'filial_id', titulo: 'Filial', celula: (l) => seletor(l, 'filial_id', 'Filial', filiais) },
    { id: 'produto_id', titulo: 'Produto', celula: (l) => seletor(l, 'produto_id', 'Produto', produtos) },
    { id: 'preco_centavos', titulo: 'Preço (R$)', tipo: 'numero', celula: (l) => campo(l, 'preco_centavos', 'Preço em reais', { inputMode: 'decimal' }) },
    { id: 'desconto_maximo_bp', titulo: 'Desconto máximo (%)', tipo: 'numero', celula: (l) => campo(l, 'desconto_maximo_bp', 'Desconto máximo em porcentagem', { inputMode: 'decimal' }) },
    {
      id: 'situacao', titulo: 'Linha', celula: (l) => (
        <>
          {celulaErro(l, 'linha') && <span className="erro-campo">{celulaErro(l, 'linha')}</span>}
          {l.chave.startsWith('nova-') ? <button type="button" className="link-nome" onClick={() => descartarNova(l.chave)}>Descartar</button> : null}
        </>
      ),
    },
  ];

  return (
    <section>
      <div className="cartao-tabela tabela-rolavel">
        <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.chave} textoVazio="Nenhum item de preço nesta tabela. Use Adicionar linha." />
      </div>
      <div className="barra-acoes barra-rodape-lista">
        <button type="button" className="mx-botao" onClick={() => void salvar()} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar itens'}</button>
        <button type="button" className="mx-botao-secundario" onClick={nova} disabled={ocupado}>Adicionar linha</button>
        <Link className="mx-botao-secundario" href={voltar}>Voltar à tabela</Link>
        {proxima && <Link className="mx-botao-secundario" href={proxima}>Próxima página</Link>}
      </div>
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
    </section>
  );
}
