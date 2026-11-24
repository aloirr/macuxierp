import { describe, expect, it } from 'vitest';
import { requisicaoConfigurarBandeira } from '@macuxierp/faturamento/web';
import type { ConfiguracaoFilialResposta } from '@macuxierp/faturamento/contracts';
import { PERFIS, type Perfil } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import { executorDeAcoes, escritaDeclarada, telaDaRota } from '../telas';
import { ROTA_BANDEIRA, TELA_BANDEIRA, cartoesDaBandeira, validarAcaoBandeira } from './bandeira';
import type { AcaoVista } from '../descritor/tipos';

const A = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const B = '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d';
const FILIAIS = [{ id: A, nome: 'Matriz Manaus' }, { id: B, nome: 'Filial Parintins' }];
const cfg = (filial_id: string, ligada: boolean): ConfiguracaoFilialResposta => ({ filial_id, faturamento_real_nfe_simulada: ligada, ambiente: 'homologacao' });
const CHAVE = 'chave-do-clique-0001';

describe('bandeira da NF-e simulada por filial (T-0088, RN-FAT-04)', () => {
  it('o administrador vê Ligar (desligada) e Desligar (ligada), com o diálogo do módulo e o PUT da filial', () => {
    const [matriz, parintins] = cartoesDaBandeira('administrador', FILIAIS, { [A]: cfg(A, false), [B]: cfg(B, true) });
    expect(matriz?.selo).toEqual({ texto: 'Desligada', tom: 'neutro' });
    expect(parintins?.selo).toEqual({ texto: 'Ligada', tom: 'ok' });
    expect(matriz?.ambiente?.texto).toMatch(/Homologação/);
    expect(matriz?.acao).toMatchObject({
      rotulo: 'Ligar', metodo: 'PUT', caminho: `/v1/faturamento/filiais/${A}/configuracao`, entrada: 'confirmar', tituloDialogo: 'Ligar a bandeira: Matriz Manaus?', rotuloConfirmar: 'Ligar', rotuloFechar: 'Voltar', destrutivo: false, principal: true,
    });
    expect(parintins?.acao).toMatchObject({ rotulo: 'Desligar', tituloDialogo: 'Desligar a bandeira: Filial Parintins?', rotuloConfirmar: 'Desligar' });
    expect(parintins?.acao?.principal).toBeUndefined();
  });
  it('os outros perfis veem a situação sem botão; vendedor nem chega à página (menu e rota)', () => {
    for (const perfil of PERFIS.filter((p): p is Perfil => p !== 'administrador')) {
      expect(cartoesDaBandeira(perfil, FILIAIS, { [A]: cfg(A, true), [B]: cfg(B, false) }).every((c) => c.acao === null && c.selo !== undefined), perfil).toBe(true);
    }
    const mods = [{ id: 'faturamento' as const, menus: ['Pedidos a faturar', 'Notas fiscais', 'Rejeições', 'Títulos a receber'] }];
    expect(resolverPagina(montarMenu(mods, MANIFESTOS, 'vendedor'), ROTA_BANDEIRA, 'vendedor')).toBeUndefined();
    for (const perfil of ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'] as const) expect(resolverPagina(montarMenu(mods, MANIFESTOS, perfil), ROTA_BANDEIRA, perfil)?.pagina?.rota, perfil).toBe(ROTA_BANDEIRA);
  });
  it('configuração que não carregou vira aviso só naquele cartão, sem botão', () => {
    const [matriz, parintins] = cartoesDaBandeira('administrador', FILIAIS, { [A]: null, [B]: cfg(B, false) });
    expect(matriz).toMatchObject({ acao: null, indisponivel: expect.stringContaining('Não foi possível ler') });
    expect(parintins?.acao?.rotulo).toBe('Ligar');
  });
  it('o corpo do PUT e a Idempotency-Key são os do módulo: a mesma chave do clique vai ao cabeçalho', () => {
    const [matriz] = cartoesDaBandeira('administrador', FILIAIS, { [A]: cfg(A, false), [B]: cfg(B, true) });
    const acao = matriz?.acao as AcaoVista;
    expect(validarAcaoBandeira(acao, { texto: '', chave: CHAVE })).toEqual({ ok: true, corpo: { faturamento_real_nfe_simulada: true } });
    const m = requisicaoConfigurarBandeira(A, true, CHAVE);
    expect(m).toEqual({ ok: true, requisicao: { metodo: 'PUT', caminho: acao.caminho, cabecalhos: { 'Idempotency-Key': CHAVE }, corpo: { faturamento_real_nfe_simulada: true } } });
    const desligar = cartoesDaBandeira('administrador', FILIAIS, { [A]: cfg(A, true) })[0]?.acao as AcaoVista;
    expect(validarAcaoBandeira(desligar, { texto: '', chave: CHAVE })).toEqual({ ok: true, corpo: { faturamento_real_nfe_simulada: false } });
  });
  it('chave fora do padrão é recusada pelo módulo (a escrita não sai sem Idempotency-Key válida)', () => {
    const acao = cartoesDaBandeira('administrador', FILIAIS, { [A]: cfg(A, false) })[0]?.acao as AcaoVista;
    expect(validarAcaoBandeira(acao, { texto: '', chave: 'x' }).ok).toBe(false);
  });
  it('o shell só aceita o PUT da configuração da filial (nada de POST nem de troca de ambiente)', () => {
    expect(telaDaRota(ROTA_BANDEIRA)).toBe(TELA_BANDEIRA);
    expect(executorDeAcoes(ROTA_BANDEIRA)).toBe(TELA_BANDEIRA);
    expect(escritaDeclarada('PUT', `/v1/faturamento/filiais/${A}/configuracao`)).toBe(true);
    expect(escritaDeclarada('POST', `/v1/faturamento/filiais/${A}/configuracao`)).toBe(false);
    expect(escritaDeclarada('PUT', `/v1/core/ambientes-fiscais/${A}`)).toBe(false);
    expect(TELA_BANDEIRA.escritas).toHaveLength(1);
  });
});
