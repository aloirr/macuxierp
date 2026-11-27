import { describe, expect, it } from 'vitest';
import { ENTIDADES_ENVIO_FDV, MonitorConectorFdv, CADASTROS_ZERAR_PORTAL } from '@macuxierp/platform-sdk';
import { ROTULO_TENTAR_DE_NOVO } from '@/components/integracao-fdv/log';
import { TEXTO_MOTIVO_FDV, acaoNoBko, acaoNoPortal } from '../integracao-fdv-textos';
import { CAMINHO_BKO_INTEGRACAO_FDV, ROTULOS_FDV, RETORNOS_FDV, TEXTO_INATIVA_NO_FDV, cadastroDoZerar, csvErrosLog, errosNaoListados, maisRecente, nomeCsvErrosFdv, textoAtualizado, textoInativacaoFdv, textoReprocessarOk, textoZerarJuntos, vistaMonitor } from './operacao-fdv';

const mon = (extra: Record<string, unknown> = {}) =>
  MonitorConectorFdv.parse({ identificador: 'erp-1', situacao: 'em_dia', versao: '1.4.2', ultimo_sinal_em: '2026-11-24T19:59:00.000Z', fila: { lotes: 1, linhas: 1 }, lido_em: '2026-11-24T20:00:00.000Z', ...extra });

describe('operação da Integração FDV no /config (T-0086)', () => {
  it('vista do Monitor: textos, fuso e plural da fila', () => {
    const v = vistaMonitor(mon(), 'America/Manaus');
    expect(v).toMatchObject({ identificador: 'erp-1', versao: '1.4.2', ultimoSinal: '24/11/2026 15:59', fila: '1 lote · 1 linha', situacao: { texto: 'Em dia', tom: 'sucesso' } });
    const d = vistaMonitor(mon({ identificador: null, versao: null, ultimo_sinal_em: null, situacao: 'desativado', fila: { lotes: 0, linhas: 0 } }), 'America/Manaus');
    expect(d).toMatchObject({ identificador: '—', versao: '—', ultimoSinal: '—', situacao: { texto: 'Desativado', tom: 'neutro' }, fila: '0 lotes · 0 linhas' });
    expect(vistaMonitor(mon({ situacao: 'atrasado' }), 'America/Manaus').situacao).toEqual({ texto: 'Atrasado', tom: 'aviso' });
  });
  it('"Atualizado às hh:mm" no fuso do tenant, não no UTC', () => {
    expect(textoAtualizado('2026-11-24T18:39:00.000Z', 'America/Manaus')).toBe('Atualizado às 14:39');
    expect(textoAtualizado('2026-11-24T18:39:00.000Z', 'America/Sao_Paulo')).toBe('Atualizado às 15:39');
  });
  it('mantém o Monitor mais recente entre o da página e o do Atualizar', () => {
    const velho = mon({ lido_em: '2026-11-24T20:00:00.000Z' });
    const novo = mon({ lido_em: '2026-11-24T20:05:00.000Z' });
    expect(maisRecente(velho, novo)).toBe(novo);
    expect(maisRecente(novo, velho)).toBe(novo);
    expect(maisRecente(null, velho)).toBe(velho);
    expect(maisRecente(null, null)).toBeNull();
  });
  it('Reprocessar: a mensagem com as contagens', () => {
    expect(textoReprocessarOk(0, 0)).toBe('Nada a reprocessar.');
    expect(textoReprocessarOk(1, 5)).toBe('Reprocessando 1 falha e 5 pendentes.');
  });
  it('CSV dos erros: separador ;, BOM, só código, campo e quantidade', () => {
    const csv = csvErrosLog({ erros: [{ codigo: 'cnpj_invalido', campo: 'documento', quantidade: 3 }, { codigo: 'ncm_ausente', campo: null, quantidade: 1 }] });
    expect(csv).toBe('\uFEFFcodigo;campo;quantidade\r\ncnpj_invalido;documento;3\r\nncm_ausente;;1\r\n');
    expect(nomeCsvErrosFdv('cliente')).toBe('erros-cliente.csv');
  });
  it('erros que o Log não lista = total menos a soma dos grupos', () => {
    expect(errosNaoListados({ total_erros: 10, erros: [{ codigo: 'a', campo: null, quantidade: 4 }] })).toBe(6);
    expect(errosNaoListados({ total_erros: 0, erros: [] })).toBe(0);
  });
  it('"Abrir no BKO da empresa" é só o caminho da tela (sem host)', () => {
    expect(CAMINHO_BKO_INTEGRACAO_FDV).toBe('/integracao-fdv/integracao-fdv');
  });
  it('Zerar por cadastro: cada linha usa um cadastro do Zerar; forma/prazo e cliente/endereço dizem que zeram juntos', () => {
    for (const e of ENTIDADES_ENVIO_FDV) expect(CADASTROS_ZERAR_PORTAL).toContain(cadastroDoZerar(e));
    expect(cadastroDoZerar('prazo_pagamento')).toBe('condicao_pagamento');
    expect(cadastroDoZerar('cliente_endereco')).toBe('cliente');
    expect(textoZerarJuntos('forma_pagamento')).toBe('Zera também as condições de pagamento.');
    expect(textoZerarJuntos('prazo_pagamento')).toBe('Zera também as formas de pagamento.');
    expect(textoZerarJuntos('cliente')).toBe('Zera também os endereços e os contatos.');
    expect(textoZerarJuntos('cliente_endereco')).toBe('Zera também os clientes e os contatos.');
    expect(textoZerarJuntos('produto')).toBeNull();
    // RD-2328: sem explicação interna ("usam o mesmo cadastro") em nenhum aviso
    for (const e of ENTIDADES_ENVIO_FDV) expect(textoZerarJuntos(e) ?? '').not.toMatch(/mesmo cadastro|usam/);
    expect(TEXTO_INATIVA_NO_FDV).toBe('Também inativa no Macuxi FDV.');
  });
  it('ROTULOS_FDV: um nome por ação, usado nos botões e nos textos que os citam (RD-X7)', () => {
    expect(ROTULOS_FDV).toEqual({ salvarChave: 'Salvar chave', trocarChave: 'Trocar chave', tentarDeNovo: 'Tentar de novo' });
    expect(acaoNoPortal('corrigir_credencial')).toBe(`Use "${ROTULOS_FDV.trocarChave}".`);
    expect(ROTULO_TENTAR_DE_NOVO).toBe(ROTULOS_FDV.tentarDeNovo);
  });
  it('motivos e ação de nova tentativa (RD-X4, RD-X5): sem "Fale com a Macuxi" no motivo, uma frase só para "aguarde"', () => {
    expect(TEXTO_MOTIVO_FDV.versao).toBe('O FDV não aceita mais esta versão do conector.');
    expect(TEXTO_MOTIVO_FDV.topologia).toBe('Outro conector já envia este cadastro ao FDV.');
    // a faixa do topo da aba (sem licença) já traz a ação "Ligue o módulo na aba Empresa"; o motivo da linha só diz o fato
    expect(TEXTO_MOTIVO_FDV.licenca_erp).toBe('Sem licença da Integração FDV.');
    expect(TEXTO_MOTIVO_FDV.licenca_fdv).toBe('A licença do FDV não permite o envio.'); // recusa do lado do FDV: "Ligue o módulo" não a resolve
    expect(acaoNoPortal('aguardar_retentativa')).toBe('Aguarde: o envio se repete sozinho.');
    expect(acaoNoBko('aguardar_retentativa')).toBe(acaoNoPortal('aguardar_retentativa'));
  });
  it('retornos das ações (36 A): um nome por ação, texto curto e sem repetir o rótulo', () => {
    expect(RETORNOS_FDV.testeIniciado).toBe('Teste iniciado. Veja "Último sinal" no Monitor.');
    expect(RETORNOS_FDV.chaveSalva).toBe('Chave salva.');
    expect(RETORNOS_FDV.envioLiberado).toBe('Envio liberado.');
    expect(RETORNOS_FDV.naoEstavaParado).toBe('Este cadastro não estava parado.');
    expect(RETORNOS_FDV.limiteSalvo).toBe('Registros por lote salvos.');
    expect(RETORNOS_FDV.ligado).toBe('Cadastro ligado.');
    expect(RETORNOS_FDV.desligado).toBe('Cadastro desligado.');
  });
  it('inativação no FDV por entidade do Hub', () => {
    expect(textoInativacaoFdv(undefined)).toBeNull();
    expect(textoInativacaoFdv([])).toBeNull();
    expect(textoInativacaoFdv([{ entidade: 'produto', quantidade: 12 }])).toBe('Produtos: 12');
  });
});
