import { readFileSync, writeFileSync } from 'node:fs';
const S = process.argv[2], R = '/home/user/macuxierp';
const f = (n) => readFileSync(`${S}/frag/${n}.html`, 'utf8');
const css = ['packages/ui/src/tokens.css', 'packages/ui/src/botoes.css', 'apps/web/src/app/globals.css'].map((p) => readFileSync(`${R}/${p}`, 'utf8')).join('\n');
// Proposta nova (vai para o globals.css pelo engenheiro-apps):
const proposta = `
/* v0.3.24: aba Integração com duas ligações (docs/design/integracao-duas-ligacoes) */
.casca-plataforma .conteudo { max-width: 1280px; margin: 0 auto; }
.cabeca-aba { display: flex; gap: 12px; align-items: center; justify-content: flex-end; flex-wrap: wrap; margin: 0 0 12px; }
.ligacoes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
@media (max-width: 900px) { .ligacoes { grid-template-columns: minmax(0, 1fr); } }
.ligacao { margin: 0; }
.ligacao h2 { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.ligacao .seta { color: var(--mx-cor-texto-secundario); font-weight: 400; }
.ligacao .ficha { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.direcao h2 .seta { color: var(--mx-cor-texto-secundario); font-weight: 400; }
.form-linha { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin: 0 0 12px; }
.form-linha .campo { margin: 0; }
.form-linha .campo input { width: 120px; }
.campo select { width: 100%; padding: 10px; border: 1px solid var(--mx-cor-borda-campo); border-radius: 6px; font: inherit; background: var(--mx-cor-branco); }
.campo input[aria-invalid="true"] { border-color: var(--mx-cor-erro-texto); }
`;
const titulo = (de, para) => `${de} <span class="seta" aria-hidden="true">→</span><span class="sr-only"> para o </span> ${para}`;
const ROTULO_FDV = 'Macuxi FDV'; // decisão 49: troca num lugar só
const pagina = (nome, aba, corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${nome}</title><style>${css}\n${proposta}</style></head><body>
<div class="casca-plataforma">${f('topo')}<main id="conteudo" class="conteudo">
<p class="apoio"><a href="#">Empresas</a></p>
<div class="titulo-selo"><h1>Distribuidora Exemplo Ltda</h1>${f('chip-ligado').replace('Ligado', 'Ativa')}</div>
<p class="apoio">Código: <span class="codigo">EX0001</span></p>
<nav class="abas-texto" aria-label="Abas da empresa"><a href="#">Empresa</a><a href="#" ${aba === 'i' ? 'aria-current="page"' : ''}>Integração</a><a href="#" ${aba === 'd' ? 'aria-current="page"' : ''}>Dados</a></nav>
${corpo}
</main></div></body></html>`;

const cabeca = `<div class="cabeca-aba"><span class="apoio" aria-live="polite">Atualizado às 10:31</span><button type="button" class="mx-botao-secundario">Atualizar</button></div>`;

// ---------- Integração: estado normal ----------
const entradaOk = `<section class="bloco ligacao" aria-labelledby="h-l1">
<h2 id="h-l1">${titulo('Sistema do cliente', 'ERP')}</h2>
<dl class="ficha">
<div><dt>Situação</dt><dd>${f('chip-recebendo')}</dd></div>
<div><dt>Último contato</dt><dd>27/11/2026 10:24</dd></div>
<div><dt>Código</dt><dd class="codigo">sistema-cliente</dd></div>
<div><dt>Chave</dt><dd class="codigo">mxe_k3P9…</dd></div>
</dl>
<div class="barra-acoes"><button type="button" class="mx-botao-secundario">Trocar chave</button><button type="button" class="mx-botao-secundario">Revogar chave</button>${f('res-vazio')}</div>
</section>`;
const fdvOk = (extra = '') => `<section class="bloco ligacao" aria-labelledby="h-l2">
<h2 id="h-l2">${titulo('ERP', ROTULO_FDV)}</h2>
<dl class="ficha">
<div><dt>Situação</dt><dd>${f('chip-emdia')}</dd></div>
<div><dt>Último contato</dt><dd>27/11/2026 10:25</dd></div>
<div><dt>Código</dt><dd class="codigo">fdv-exemplo</dd></div>
<div><dt>Chave</dt><dd class="codigo">mxf_7Hq2…</dd></div>
<div><dt>Ambiente</dt><dd>Produção</dd></div>
</dl>
<div class="barra-acoes"><button type="button" class="mx-botao-secundario">Trocar chave</button><button type="button" class="mx-botao-secundario">Testar conexão</button>${extra || f('res-vazio')}</div>
</section>`;
writeFileSync(`${S}/integracao.html`, pagina('Integração', 'i', `${cabeca}<div class="ligacoes">${entradaOk}${fdvOk(f('res-ok-teste'))}</div>`));

// ---------- Integração: sem chave + erro depois de agir ----------
const entradaSem = `<section class="bloco ligacao" aria-labelledby="h-l1">
<h2 id="h-l1">${titulo('Sistema do cliente', 'ERP')}</h2>
<form><label class="campo"><span>Código</span><input name="conector_id" value="sistema-cliente"></label>
<p class="apoio">Letras, números, ponto, hífen e sublinhado. Até 100.</p>
<div class="barra-acoes"><button type="submit" class="mx-botao">Gerar chave</button>${f('res-vazio')}</div></form>
</section>`;
const fdvSem = `<section class="bloco ligacao" aria-labelledby="h-l2">
<h2 id="h-l2">${titulo('ERP', ROTULO_FDV)}</h2>
<form><label class="campo"><span>Código</span><input name="conector_id" value="fdv-exemplo"></label>
<label class="campo"><span>Chave</span><input name="chave" type="password" value="abc123" aria-invalid="true"></label>
<p class="erro-campo" role="alert" style="margin:-12px 0 16px">A chave tem pelo menos 32 caracteres.</p>
<label class="campo"><span>Ambiente</span><select name="ambiente"><option>Teste</option></select></label>
<div class="barra-acoes"><button type="submit" class="mx-botao">Salvar chave</button>${f('res-vazio')}</div></form>
</section>`;
writeFileSync(`${S}/integracao-sem-chave.html`, pagina('Integração', 'i', `${cabeca}<div class="ligacoes">${entradaSem}${fdvSem}</div>`));

// ---------- Dados ----------
const dados = `<section class="bloco direcao" aria-labelledby="h-d1">
<h2 id="h-d1">${titulo('Sistema do cliente', 'ERP')}</h2>
<div class="tabela-rolavel com-sinal-rolagem legenda-so-leitor">${f('tab-cargas')}</div>
</section>
<section class="bloco direcao" aria-labelledby="h-d2">
<h2 id="h-d2">${titulo('ERP', ROTULO_FDV)}</h2>
<form class="form-linha"><label class="campo"><span>Registros por lote</span><input type="number" value="1000"></label><button type="submit" class="mx-botao-secundario">Salvar</button>${f('res-vazio')}</form>
<div class="tabela-rolavel com-sinal-rolagem tabela-fdv legenda-so-leitor">${f('tab-envio')}</div>
<div class="barra-acoes"><button type="button" class="mx-botao-secundario">Zerar pedidos não faturados</button></div>
</section>`;
writeFileSync(`${S}/dados.html`, pagina('Dados', 'd', dados));
console.log('ok');
