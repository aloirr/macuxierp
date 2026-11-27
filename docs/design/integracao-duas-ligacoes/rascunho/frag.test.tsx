import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup as h } from 'react-dom/server';
import { it } from 'vitest';
import { TabelaDensa, Chip, ResultadoAcao, SeloPlataforma } from '/home/user/macuxierp/packages/ui/src/index.ts';
import { AssinaturaErp } from '/home/user/macuxierp/packages/ui/src/marca.tsx';
const D = '/tmp/claude-0/-home-user/66ca79f9-5f4b-5c55-9272-2a0a9ee3a203/scratchpad/integracao-v0324/frag/';
const w = (n: string, x: any) => writeFileSync(D + n + '.html', h(x));
const acoes = (p: string) => <button type="button" className="mx-botao-secundario" aria-haspopup="menu">{p} ▾</button>;
it('fragmentos', () => {
  w('topo', <header className="topo topo-plataforma mx-fundo-escuro"><span className="marca"><AssinaturaErp fundo="grafite" /></span><SeloPlataforma /><nav aria-label="Plataforma"><a href="#">Empresas</a></nav><span className="espaco" /><span>Superadmin Macuxi</span><form><button className="mx-botao-secundario" type="button">Sair</button></form></header>);
  for (const [n, tom, t] of [['chip-recebendo','sucesso','Recebendo'],['chip-emdia','sucesso','Em dia'],['chip-semchave','neutro','Sem chave'],['chip-atrasado','aviso','Atrasado'],['chip-ligado','sucesso','Ligado'],['chip-desligado','neutro','Desligado'],['chip-concluido','sucesso','Concluído'],['chip-comerro','aviso','Com erro']] as const) w(n, <Chip tom={tom}>{t}</Chip>);
  w('res-erro-fdv', <ResultadoAcao resultado={{ tom: 'erro', texto: 'Não foi possível salvar. Confira os campos marcados.' }} />);
  w('res-ok-teste', <ResultadoAcao resultado={{ tom: 'sucesso', texto: 'Teste iniciado.' }} />);
  w('res-vazio', <ResultadoAcao resultado={null} />);
  const lotes = [
    { id: 1, cadastro: 'Clientes', em: '27/11/2026 10:24', rec: 1250, err: 0, s: 'chip-concluido' },
    { id: 2, cadastro: 'Produtos', em: '27/11/2026 10:21', rec: 840, err: 3, s: 'chip-comerro' },
    { id: 3, cadastro: 'Preços', em: '27/11/2026 09:58', rec: 840, err: 0, s: 'chip-concluido' },
  ];
  const tomL = (s: string) => s === 'chip-comerro' ? <Chip tom="aviso">Com erro</Chip> : <Chip tom="sucesso">Concluído</Chip>;
  w('tab-lotes', <TabelaDensa legenda="Lotes recebidos do sistema do cliente" chaveLinha={(l: any) => l.id} linhas={lotes} colunas={[
    { id: 'cadastro', titulo: 'Cadastro', celula: (l: any) => l.cadastro },
    { id: 'em', titulo: 'Recebido em', tipo: 'data', celula: (l: any) => l.em },
    { id: 'rec', titulo: 'Recebidos', tipo: 'numero', celula: (l: any) => l.rec.toLocaleString('pt-BR') },
    { id: 'err', titulo: 'Com erro', tipo: 'numero', celula: (l: any) => l.err },
    { id: 's', titulo: 'Situação', tipo: 'status', celula: (l: any) => tomL(l.s) },
  ] as any} />);
  const cargas = [
    { c: 'Clientes', s: ['sucesso','Carregado'], u: '27/11/2026 10:24', r: '1.250', e: '0', o: 'Automática' },
    { c: 'Produtos', s: ['aviso','Com erro'], u: '27/11/2026 10:21', r: '840', e: '3', o: 'Automática' },
    { c: 'Preços', s: ['sucesso','Carregado'], u: '27/11/2026 09:58', r: '840', e: '0', o: 'Automática' },
    { c: 'Formas de pagamento', s: ['sucesso','Carregado'], u: '26/11/2026 16:02', r: '12', e: '0', o: 'Planilha' },
    { c: 'Vendedores', s: ['neutro','Vazio'], u: '—', r: '—', e: '—', o: '—' },
  ];
  w('tab-cargas', <TabelaDensa legenda="Cadastros recebidos" chaveLinha={(l: any) => l.c} linhas={cargas} colunas={[
    { id: 'c', titulo: 'Cadastro', celula: (l: any) => l.c },
    { id: 's', titulo: 'Situação', tipo: 'status', celula: (l: any) => <Chip tom={l.s[0]}>{l.s[1]}</Chip> },
    { id: 'u', titulo: 'Última carga', tipo: 'data', celula: (l: any) => l.u },
    { id: 'r', titulo: 'Registros', tipo: 'numero', celula: (l: any) => l.r },
    { id: 'e', titulo: 'Com erro', tipo: 'numero', celula: (l: any) => l.e },
    { id: 'o', titulo: 'Origem', celula: (l: any) => l.o },
    { id: 'a', titulo: 'Ações', celula: () => acoes('Ações') },
  ] as any} />);
  const env = [
    { c: 'Clientes', on: true, u: '27/11/2026 10:25', f: null },
    { c: 'Produtos', on: true, u: '27/11/2026 10:22', f: 'O FDV recusou 3 registros. Veja o Log.' },
    { c: 'Preços', on: true, u: '27/11/2026 09:59', f: null },
    { c: 'Formas de pagamento', on: false, u: '—', f: null },
    { c: 'Vendedores', on: false, u: '—', f: null },
  ];
  w('tab-envio', <TabelaDensa legenda="Cadastros enviados ao Macuxi FDV" chaveLinha={(l: any) => l.c} linhas={env} colunas={[
    { id: 'c', titulo: 'Cadastro', celula: (l: any) => l.c },
    { id: 's', titulo: 'Situação', tipo: 'status', celula: (l: any) => <span className={l.on ? 'selo selo-ativo' : 'selo selo-inativo'}>{l.on ? 'Ligado' : 'Desligado'}</span> },
    { id: 'u', titulo: 'Último envio', tipo: 'data', celula: (l: any) => l.u },
    { id: 'f', titulo: 'Falha', celula: (l: any) => l.f ?? <span className="apoio">—</span> },
    { id: 'a', titulo: 'Ações', celula: () => acoes('Ações') },
  ] as any} />);
});
