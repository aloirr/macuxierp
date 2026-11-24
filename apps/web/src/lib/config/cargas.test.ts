import { describe, expect, it, vi } from 'vitest';
import {
  CADASTROS_CARGA_PORTAL, CADASTROS_ZERAR_PORTAL, CODIGO_ZERAGEM_BLOQUEADA, ZeragemPlataformaResposta, FRASE_SUBSTITUIR_TUDO, FRASE_ZERAR_DADOS, MAX_BYTES_ARQUIVO_CARGA_PORTAL, ValidarCargaPlataformaResposta, fraseConfere, situacaoCarga, type EfeitoSubstituir,
} from '@macuxierp/platform-sdk';
import {
  AVISO_LIMITE_FDV, AVISO_ZERAR, ROTULO_ZERAR, TEXTO_ANTES_DE_ZERAR, TEXTO_ZERADO, textoZerado, bloqueiosDeTextos, pedirPreviaZerar, pedirZerar, podeConfirmarZerar, textoLevaJunto, textoSemChave, textosAnulados, textosBloqueios, textosMantidos, ROTULO_MODO, TEXTO_SUBSTITUIR, baseCargas, caixasDaConferencia, conferirArquivoEscolhido, enderecoModelo, linhasCargas, pedirConferencia, pedirErros, pedirGravacao,
  podeGravar, problemaDoArquivo, rotuloAdicionar, rotuloLinhaErro, textoEfeito, textoGravado, textoErrosOmitidos, textoLinhaErro, tituloImportar,
} from './cargas';

const CHAVE = '33333333-3333-4333-8333-333333333333';
const ORDEM = CADASTROS_CARGA_PORTAL.map((c) => c.cadastro);
import { EMP, conferencia, situacoes } from './cargas-fixtures';

const csv = (nome = 'produto.csv', tamanho = 20) => new File(['x'.repeat(tamanho)], nome, { type: 'text/csv' });
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
describe('linhas da aba Cargas (T-0058)', () => {
  const linhas = linhasCargas(situacoes({ filial: { situacao: 'carregado', quantidade: 1 }, produto: { situacao: 'com_erro', erros: 2 } }), 'America/Manaus');
  it('uma linha por cadastro, na ordem do SDK, numerada de 1 ao total', () => {
    expect(linhas.map((l) => l.cadastro)).toEqual(ORDEM);
    expect(linhas.map((l) => l.numero)).toEqual(CADASTROS_CARGA_PORTAL.map((_, i) => i + 1));
  });
  it('carregado: chip verde, data no fuso e quantidade no singular', () => {
    const l = linhas[0]!;
    expect(l.chip).toEqual({ tom: 'sucesso', texto: 'Carregado' });
    expect(l.ultima).toBe('23/11/2026 14:39 · 1 registro');
  });
  it('com erro: chip laranja "N com erro" e quantidade no plural', () => {
    const l = linhas.find((x) => x.cadastro === 'produto')!;
    expect(l.chip).toEqual({ tom: 'aviso', texto: '2 com erro' });
    expect(l.ultima).toBe('23/11/2026 14:39 · 44 registros');
  });
  it('não carregado: chip cinza, sem data; sem dados da API tudo vale não carregado', () => {
    const l = linhas.find((x) => x.cadastro === 'vendedor')!;
    expect(l.chip).toEqual({ tom: 'neutro', texto: 'Não carregado' });
    expect(l.ultima).toBeNull();
    expect(linhasCargas(null, 'America/Manaus').every((x) => x.situacao === 'nao_carregado')).toBe(true);
  });
  it('só as unidades são "(opcional)", sem ponto final', () => {
    expect(linhas.filter((l) => l.rotulo.includes('(opcional)')).map((l) => l.rotulo)).toEqual(['Unidades (opcional)']);
  });
  it('a situação do SDK: erros primeiro, depois ativos', () => {
    expect(situacaoCarga({ ativos: 5, erros: 1 })).toBe('com_erro');
    expect(situacaoCarga({ ativos: 5, erros: 0 })).toBe('carregado');
    expect(situacaoCarga({ ativos: 0, erros: 0 })).toBe('nao_carregado');
  });
  it('o endereço do modelo passa pelo portal, com a empresa', () => {
    expect(baseCargas(EMP)).toBe(`/config/empresas/${EMP}/cargas`);
    expect(enderecoModelo(EMP, 'preco')).toBe(`/config/empresas/${EMP}/cargas/preco/modelo`);
  });
});

describe('janela Importar: textos e caixas', () => {
  it('título, caixas no singular e no plural, e o "Adicionar N" com as prontas', () => {
    expect(tituloImportar('produto')).toBe('Importar Produtos');
    expect(caixasDaConferencia({ prontas: 44, com_erro: 2 })).toEqual({ prontas: { n: 44, texto: 'prontas para gravar' }, erros: { n: 2, texto: 'com erro (ficam de fora)' } });
    expect(caixasDaConferencia({ prontas: 1, com_erro: 1 })).toEqual({ prontas: { n: 1, texto: 'pronta para gravar' }, erros: { n: 1, texto: 'com erro (fica de fora)' } });
    expect(ROTULO_MODO).toEqual({ adicionar: 'Adicionar', substituir_tudo: 'Substituir tudo' });
    expect(rotuloAdicionar(44)).toBe('Adicionar 44');
    expect(rotuloAdicionar(0)).toBe('Adicionar');
    expect(textoErrosOmitidos(3)).toContain('Mais 3 erros');
  });
  it('a linha de erro: "Linha 21:" e o motivo do domain; a ação só entra se o motivo ainda não a traz', () => {
    const c = ValidarCargaPlataformaResposta.parse(conferencia());
    expect(`${rotuloLinhaErro(c.linhas[0]!)} ${textoLinhaErro(c.linhas[0]!)}`).toBe('Linha 21: O NCM 4202.22.10 exige CEST: preencha a coluna cest.');
    expect(rotuloLinhaErro({ linha: null })).toBe('Arquivo:');
    expect(textoLinhaErro({ motivo: 'Cabeçalho inválido.', acao: 'Baixe o modelo.' })).toBe('Cabeçalho inválido. Baixe o modelo.');
  });
  it('Adicionar e Substituir tudo só valem com ao menos uma linha pronta', () => {
    expect(podeGravar(null)).toBe(false);
    expect(podeGravar({ prontas: 0 })).toBe(false);
    expect(podeGravar({ prontas: 44 })).toBe(true);
  });
  it('confere o arquivo antes de enviar: extensão, vazio e tamanho', () => {
    expect(problemaDoArquivo(csv())).toBeNull();
    expect(problemaDoArquivo(csv('produto.xlsx'))).toMatch(/\.csv/);
    expect(problemaDoArquivo(csv('produto.csv', 0))).toMatch(/vazio/);
    expect(problemaDoArquivo({ name: 'a.csv', size: MAX_BYTES_ARQUIVO_CARGA_PORTAL + 1 })).toMatch(/limite/);
  });
});

describe('conferência automática ao escolher o arquivo', () => {
  it('uma chamada POST /validar?modo=adicionar sozinha, com o arquivo, e devolve as contagens e a lista', async () => {
    const enviar = vi.fn(async () => json({ ok: true, conferencia: conferencia() }));
    const r = await conferirArquivoEscolhido(EMP, 'produto', csv(), enviar);
    expect(enviar).toHaveBeenCalledTimes(1);
    const [url, init] = enviar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/config/empresas/${EMP}/cargas/produto/validar?modo=adicionar`);
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('arquivo')).toBeInstanceOf(File);
    expect(r.ok && r.valor.prontas).toBe(44);
    expect(r.ok && r.valor.com_erro).toBe(1);
    expect(r.ok && r.valor.efeito).toBeUndefined();
  });
  it('arquivo com problema local não chama o portal', async () => {
    const enviar = vi.fn();
    const r = await conferirArquivoEscolhido(EMP, 'produto', csv('produto.txt'), enviar);
    expect(enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false });
  });
  it('erro do portal vira a mensagem; 401 leva ao login; rede caída tem texto próprio', async () => {
    expect(await conferirArquivoEscolhido(EMP, 'produto', csv(), async () => json({ ok: false, erro: 'Seu acesso expirou. Entre de novo.', redirecionar: '/config/entrar' }, 401)))
      .toMatchObject({ ok: false, erro: 'Seu acesso expirou. Entre de novo.', redirecionar: '/config/entrar' });
    expect(await conferirArquivoEscolhido(EMP, 'produto', csv(), async () => { throw new Error('rede'); })).toMatchObject({ ok: false, erro: 'Sem conexão com o servidor. Tente de novo.' });
  });
  it('resposta fora do contrato não vira conferência (o efeito só vem no Substituir tudo)', async () => {
    expect(await conferirArquivoEscolhido(EMP, 'produto', csv(), async () => json({ ok: true, conferencia: { prontas: 'x' } }))).toMatchObject({ ok: false });
    expect(ValidarCargaPlataformaResposta.safeParse(conferencia({ efeito: { total: 1, a_inativar: 0, percentual: 0, acima_limite_fdv: false } })).success).toBe(false);
  });
  it('o contrato aceita erro de arquivo (linha nula)', () => {
    expect(ValidarCargaPlataformaResposta.safeParse(conferencia({ linhas: [{ linha: null, motivo: 'Cabeçalho inválido.', acao: 'Baixe o modelo.' }] })).success).toBe(true);
  });
});

describe('efeito do Substituir tudo: pedido só na confirmação', () => {
  const comEfeito = conferencia({ modo: 'substituir_tudo', efeito: { total: 266, a_inativar: 120, percentual: (120 * 100) / 266, acima_limite_fdv: true } });
  it('pedirConferencia em substituir_tudo vai com ?modo=substituir_tudo e traz o efeito', async () => {
    const enviar = vi.fn(async () => json({ ok: true, conferencia: comEfeito }));
    const r = await pedirConferencia(EMP, 'produto', csv(), 'substituir_tudo', enviar);
    expect((enviar.mock.calls[0] as unknown as [string])[0]).toBe(`/config/empresas/${EMP}/cargas/produto/validar?modo=substituir_tudo`);
    expect(r.ok && r.valor.efeito?.a_inativar).toBe(120);
  });
  it('diz quantos serão inativados e o percentual; acima de 30% vem o aviso do FDV', () => {
    expect(textoEfeito('produto', { total: 266, a_inativar: 120, percentual: (120 * 100) / 266 })).toBe('Vai inativar 120 de 266 produtos (45%).');
    expect(AVISO_LIMITE_FDV).toBe('Acima de 30%, o FDV pede confirmação no monitor de integração dele antes de aplicar.');
    expect(textoEfeito('produto', { total: 266, a_inativar: 0, percentual: 0 })).toBe('Não há produtos para inativar.');
    expect(TEXTO_SUBSTITUIR).toBe('O que não vier no arquivo fica inativo; nada é apagado.');
  });
});

describe('gravar', () => {
  const gravada = { cadastro: 'produto', modo: 'adicionar', gravadas: 44, com_erro: 1 };
  it('manda o mesmo arquivo, o modo na query e a Idempotency-Key, sem frase no Adicionar', async () => {
    const enviar = vi.fn(async () => json({ ok: true, gravacao: gravada }));
    const r = await pedirGravacao(EMP, 'produto', csv(), CHAVE, 'adicionar', 'lixo', enviar);
    const [url, init] = enviar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/config/empresas/${EMP}/cargas/produto/gravar?modo=adicionar`);
    expect((init.body as FormData).has('frase')).toBe(false);
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(CHAVE);
    expect(r.ok && r.valor.gravadas).toBe(44);
  });
  it('resposta definitiva recusada pede chave nova', async () => {
    const r = await pedirGravacao(EMP, 'produto', csv(), CHAVE, 'adicionar', '', async () => json({ ok: false, erro: 'Nenhuma linha pronta para gravar.', chaveNova: true }, 409));
    expect(r).toMatchObject({ ok: false, erro: 'Nenhuma linha pronta para gravar.', chaveNova: true });
  });
  it('substituir tudo manda o modo e a frase como digitada (a API normaliza)', async () => {
    const enviar = vi.fn(async () => json({ ok: true, gravacao: { ...gravada, modo: 'substituir_tudo', inativadas: 3, efeito: { total: 47, a_inativar: 3, percentual: 300 / 47, acima_limite_fdv: false } } }));
    const r = await pedirGravacao(EMP, 'produto', csv(), CHAVE, 'substituir_tudo', 'AUTORIZO SUBSTITUIR TUDO.', enviar);
    const [url, init] = enviar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('gravar?modo=substituir_tudo');
    expect((init.body as FormData).get('frase')).toBe('AUTORIZO SUBSTITUIR TUDO.');
    expect(r.ok && r.valor.inativadas).toBe(3);
  });
});

describe('baixar erros', () => {
  it('POST com o mesmo arquivo e devolve o CSV como Blob; falha vira mensagem', async () => {
    const enviar = vi.fn(async () => new Response('linha;motivo\r\n', { headers: { 'content-type': 'text/csv' } }));
    const r = await pedirErros(EMP, 'produto', csv(), enviar);
    const [url, init] = enviar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/config/empresas/${EMP}/cargas/produto/erros`);
    expect(init.method).toBe('POST');
    expect(r.ok && (await r.valor.text())).toContain('linha;motivo');
    expect(await pedirErros(EMP, 'produto', csv(), async () => json({ ok: false, erro: 'Sem permissão.' }, 403))).toMatchObject({ ok: false, erro: 'Sem permissão.' });
  });
});

describe('frase do Substituir tudo (SDK)', () => {
  it('ignora maiúsculas, espaços extras e o ponto final; o botão só liga quando bate', () => {
    expect(fraseConfere('', FRASE_SUBSTITUIR_TUDO)).toBe(false);
    expect(fraseConfere('AUTORIZO SUBSTITUIR TUDO.', FRASE_SUBSTITUIR_TUDO)).toBe(true);
    expect(fraseConfere('  autorizo   substituir  tudo  ', FRASE_SUBSTITUIR_TUDO)).toBe(true);
    expect(fraseConfere('autorizo substituir', FRASE_SUBSTITUIR_TUDO)).toBe(false);
  });
});

describe('zerar dados', () => {
  const zer = (extra: Record<string, unknown> = {}) => ZeragemPlataformaResposta.parse({ empresa_id: EMP, simulado: true, efetivos: ['produto'], apagados: [], anulados: [], mantidos: [], bloqueios: [], sem_chave: 0, ...extra });
  it('rótulos: um por cadastro do zerar, com o nome da carga no SDK', () => {
    expect(Object.keys(ROTULO_ZERAR)).toEqual([...CADASTROS_ZERAR_PORTAL]);
  });
  it('prévia: POST em zerar/previa com os cadastros escolhidos, sem chave, e a resposta validada', async () => {
    const enviar = vi.fn(async () => json({ ok: true, previa: zer({ sem_chave: 3 }) }));
    const ctl = new AbortController();
    const r = await pedirPreviaZerar(EMP, ['produto', 'cliente'], enviar, ctl.signal);
    const [url, init] = enviar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/config/empresas/${EMP}/cargas/zerar/previa`);
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(ctl.signal);
    expect(JSON.parse(init.body as string)).toEqual({ cadastros: ['produto', 'cliente'] });
    expect((init.headers as Record<string, string>)['idempotency-key']).toBeUndefined();
    expect(r.ok && r.valor.sem_chave).toBe(3);
  });
  it('textos do sem_chave no singular e no plural', () => {
    expect(textoSemChave(3)).toBe('3 registros foram ao FDV sem código de origem. Depois de zerar e carregar de novo, o FDV vai inativar os antigos e criar novos.');
    expect(textoSemChave(1)).toBe('1 registro foi ao FDV sem código de origem. Depois de zerar e carregar de novo, o FDV vai inativar o antigo e criar o novo.');
  });
  it('zerar manda cadastros, a frase (sem espaços nas pontas) e a Idempotency-Key', async () => {
    const enviar = vi.fn(async () => json({ ok: true }));
    const r = await pedirZerar(EMP, ['produto'], ` ${FRASE_ZERAR_DADOS} `, CHAVE, enviar);
    const [url, init] = enviar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/config/empresas/${EMP}/cargas/zerar`);
    expect(JSON.parse(init.body as string)).toEqual({ cadastros: ['produto'], frase: FRASE_ZERAR_DADOS });
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(CHAVE);
    expect(r.ok).toBe(true);
    expect(r.ok && r.valor).toBe(0);
    const comMantidos = await pedirZerar(EMP, ['produto'], FRASE_ZERAR_DADOS, CHAVE, async () => json({ ok: true, mantidos: 5 }));
    expect(comMantidos.ok && comMantidos.valor).toBe(5);
  });
  it('mantidos com o motivo "fiscal" do enum do SDK', () => {
    const fiscal = { cadastro: 'filial', motivo: 'fiscal', quantidade: 2 } as const;
    expect(textosMantidos([fiscal])?.detalhes).toEqual([`${ROTULO_ZERAR.filial}: 2 em filial com dado fiscal.`]);
  });
  it('422 zeragem_bloqueada: o código e os bloqueios chegam à tela; o 409 dados_mudaram traz o código para refazer a prévia', async () => {
    const bloqueado = await pedirZerar(EMP, ['preco'], FRASE_ZERAR_DADOS, CHAVE, async () => json({ ok: false, erro: 'Há integração ligada.', codigo: CODIGO_ZERAGEM_BLOQUEADA, bloqueios: ['preco:integracao_ligada', 'produto:lote_em_andamento'], chaveNova: true }, 422));
    expect(!bloqueado.ok && bloqueado.codigo).toBe(CODIGO_ZERAGEM_BLOQUEADA);
    expect(!bloqueado.ok && textosBloqueios(bloqueiosDeTextos(bloqueado.bloqueios ?? []))).toEqual([`Desligue o envio de ${ROTULO_ZERAR.preco} na aba Integração FDV antes de zerar.`, 'Há uma carga em andamento. Espere terminar para zerar.']);
    const mudou = await pedirZerar(EMP, ['preco'], FRASE_ZERAR_DADOS, CHAVE, async () => json({ ok: false, erro: 'Os dados mudaram. Confira de novo.', codigo: 'dados_mudaram', chaveNova: true }, 409));
    expect(!mudou.ok && mudou.codigo).toBe('dados_mudaram');
    expect(!mudou.ok && mudou.erro).toBe('Os dados mudaram. Confira de novo.');
  });
  it('"Leva junto": só o que a prévia zera além do escolhido, na ordem da API (o preço não entra ao marcar produto)', () => {
    expect(textoLevaJunto(['produto', 'produto_unidade', 'estoque'], ['produto'])).toBe('Leva junto: Unidades, Estoque.');
    const [a, b] = CADASTROS_ZERAR_PORTAL;
    expect(textoLevaJunto([a, b], [a])).toBe(`Leva junto: ${ROTULO_ZERAR[b]}.`);
    expect(textoLevaJunto(['produto'], ['produto'])).toBeNull();
  });
  it('mantidos: soma, e uma linha por cadastro e motivo', () => {
    expect(textosMantidos([])).toBeNull();
    expect(textosMantidos([{ cadastro: 'produto', motivo: 'pedido', quantidade: 3 }, { cadastro: 'produto', motivo: 'nota', quantidade: 2 }, { cadastro: 'cliente', motivo: 'titulo', quantidade: 4 }])).toEqual({
      total: 'Mantidos: 9',
      detalhes: ['Produtos: 3 em pedidos.', 'Produtos: 2 em notas.', 'Clientes: 4 em títulos.'],
    });
  });
  it('anulados: uma frase por coluna, singular e plural, sem as de quantidade zero', () => {
    expect(textosAnulados([
      { tabela: 'cliente', coluna: 'vendedor_id', quantidade: 12 },
      { tabela: 'cliente', coluna: 'tabela_preco_id', quantidade: 1 },
      { tabela: 'cliente', coluna: 'condicao_pagamento_id', quantidade: 0 },
    ])).toEqual(['12 clientes ficam sem vendedor.', '1 cliente fica sem tabela de preço.']);
  });
  it('bloqueios: a integração ligada nomeia o cadastro; a carga em andamento aparece uma vez', () => {
    expect(textosBloqueios([{ cadastro: 'preco', motivo: 'integracao_ligada' }, { cadastro: 'produto', motivo: 'lote_em_andamento' }, { cadastro: 'cliente', motivo: 'lote_em_andamento' }])).toEqual([`Desligue o envio de ${ROTULO_ZERAR.preco} na aba Integração FDV antes de zerar.`, 'Há uma carga em andamento. Espere terminar para zerar.']);
  });
  it('confirmar: precisa de seleção, prévia atual, nenhum bloqueio e a frase', () => {
    const ok = { selecionados: 1, previa: zer(), carregando: false, frase: 'AUTORIZO ZERAR OS DADOS.', enviando: false };
    expect(podeConfirmarZerar(ok)).toBe(true);
    expect(podeConfirmarZerar({ ...ok, selecionados: 0 })).toBe(false);
    expect(podeConfirmarZerar({ ...ok, previa: null })).toBe(false);
    expect(podeConfirmarZerar({ ...ok, carregando: true })).toBe(false);
    expect(podeConfirmarZerar({ ...ok, previa: zer({ bloqueios: [{ cadastro: 'preco', motivo: 'integracao_ligada' }] }) })).toBe(false);
    expect(podeConfirmarZerar({ ...ok, frase: 'autorizo zerar' })).toBe(false);
    expect(podeConfirmarZerar({ ...ok, enviando: true })).toBe(false);
  });
  it('a frase do zerar ignora maiúsculas, espaços e ponto final; os textos da janela são os aprovados', () => {
    expect(fraseConfere('AUTORIZO ZERAR OS DADOS.', FRASE_ZERAR_DADOS)).toBe(true);
    expect(fraseConfere('autorizo zerar os dados', FRASE_SUBSTITUIR_TUDO)).toBe(false);
    expect(fraseConfere('', FRASE_ZERAR_DADOS)).toBe(false);
    expect(TEXTO_ANTES_DE_ZERAR).toBe('Antes de zerar, exporte pelo BKO da empresa (Cadastros > Exportar).');
    expect(AVISO_ZERAR).toBe('Apaga os cadastros escolhidos e não tem volta.');
    expect(TEXTO_ZERADO).toBe('Dados zerados.');
    expect(textoZerado(0)).toBe('Dados zerados.');
    expect(textoZerado(5)).toBe('Dados zerados. Mantidos: 5 (em uso em pedido, título ou nota, ou filial com dado fiscal).');
  });
});

describe('endereços inativados no Substituir tudo de clientes (T-0070)', () => {
  const base: Pick<EfeitoSubstituir, 'total' | 'a_inativar' | 'percentual'> = { total: 40, a_inativar: 12, percentual: 30 };
  it('confirmação: soma "e N endereços" só com N > 0; sem o campo ou com 0, a frase não muda', () => {
    expect(textoEfeito('cliente', base)).toBe('Vai inativar 12 de 40 clientes (30%).');
    expect(textoEfeito('cliente', { ...base, enderecos_a_inativar: 0 })).toBe('Vai inativar 12 de 40 clientes (30%).');
    expect(textoEfeito('cliente', { ...base, enderecos_a_inativar: 1 })).toBe('Vai inativar 12 de 40 clientes (30%) e 1 endereço.');
    expect(textoEfeito('cliente', { ...base, enderecos_a_inativar: 5 })).toBe('Vai inativar 12 de 40 clientes (30%) e 5 endereços.');
    const zero = { total: 40, a_inativar: 0, percentual: 0 };
    expect(textoEfeito('cliente', { ...zero, enderecos_a_inativar: 1 })).toBe('Vai inativar 1 endereço e nenhum cliente.');
    expect(textoEfeito('cliente', { ...zero, enderecos_a_inativar: 3 })).toBe('Vai inativar 3 endereços e nenhum cliente.');
    expect(textoEfeito('cliente', { ...zero, enderecos_a_inativar: 5 })).toBe('Vai inativar 5 endereços e nenhum cliente.');
    expect(textoEfeito('cliente', { ...zero, enderecos_a_inativar: 0 })).toBe('Não há clientes para inativar.');
    expect(textoEfeito('cliente', zero)).toBe('Não há clientes para inativar.');
  });
  it('resultado: "5 endereços inativados", "1 endereço inativado"; nada com 0 ou sem o campo', () => {
    expect(textoGravado({ gravadas: 44 })).toBe('44 registros gravados.');
    expect(textoGravado({ gravadas: 1, enderecos_inativados: 0 })).toBe('1 registro gravado.');
    expect(textoGravado({ gravadas: 8, enderecos_inativados: 5 })).toBe('8 registros gravados. 5 endereços inativados.');
    expect(textoGravado({ gravadas: 8, enderecos_inativados: undefined })).toBe('8 registros gravados.');
    expect(textoGravado({ gravadas: 8, enderecos_inativados: 1 })).toBe('8 registros gravados. 1 endereço inativado.');
  });
});
