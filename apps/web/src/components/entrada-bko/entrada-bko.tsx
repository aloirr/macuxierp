import { Chip, TabelaDensa, type ColunaTabela } from '@macuxierp/ui';
import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { ROTULO_ENTIDADE } from '@macuxierp/integracao-fdv/web';
import { MENSAGEM_DONO_CLIENTE, type LinhaEntradaBko } from '@/lib/entrada-bko-provisorio';
import { situacaoDaEntrada, textoLinhaStatus, textoUltimoLote } from '@/lib/entrada-bko';

/** Chip neutro ao lado do título do cadastro cujo dono é o servidor do cliente. */
export function ChipDonoCliente() {
  return <Chip tom="neutro">{MENSAGEM_DONO_CLIENTE}</Chip>;
}

/** Linha de status abaixo do título (texto de apoio, estático, sem `role="status"`). */
export function LinhaStatusEntrada({ linha, fuso }: { linha: LinhaEntradaBko; fuso: string }) {
  return <p className="apoio" data-testid="status-entrada">{textoLinhaStatus(linha, fuso)}</p>;
}

/** Bloco "Entrada do cliente" da Integração do BKO: só leitura, sem seletor nem botão. */
export function BlocoEntradaCliente({ linhas, fuso }: { linhas: readonly LinhaEntradaBko[]; fuso: string }) {
  const ordenadas = ENTIDADES_ENVIO_FDV.flatMap((e) => linhas.filter((l) => l.cadastro === e));
  const colunas: ColunaTabela<LinhaEntradaBko>[] = [
    { id: 'cadastro', titulo: 'Cadastro', celula: (l) => ROTULO_ENTIDADE[l.cadastro] },
    { id: 'dono', titulo: 'Dono', celula: (l) => (l.dono === 'cliente' ? 'Servidor do cliente' : 'Macuxi ERP') },
    { id: 'ultimo', titulo: 'Último lote', tipo: 'data', celula: (l) => textoUltimoLote(l, fuso) },
    { id: 'erros', titulo: 'Erros abertos', tipo: 'numero', celula: (l) => String(l.erros) },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => { const s = situacaoDaEntrada(l); return s ? <Chip tom={s.tom}>{s.texto}</Chip> : '—'; } },
  ];
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="h-entrada" data-testid="bloco-entrada">
      <h2 id="h-entrada">Entrada do cliente</h2>
      <div className="tabela-rolavel com-sinal-rolagem">
        <TabelaDensa colunas={colunas} linhas={ordenadas} chaveLinha={(l) => l.cadastro} textoVazio="Nenhum cadastro." legenda="Dono e situação da entrada por cadastro" />
      </div>
    </section>
  );
}
