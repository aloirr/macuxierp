/**
 * Fixtures da carga de CSV do cadastros (`modules/cadastros/domain/carga/__fixtures__`) para os testes de banco de `tests/`.
 * O NCM 2106.90.30 da fixture exige CEST nas tabelas oficiais reais: `comNcmOficial` troca por NCM + CEST oficiais
 * (22021000 + 0300700) no `produto.csv`; os outros arquivos voltam como estão.
 */
import { join } from 'node:path';

export const PASTA_FIXTURE_CARGA = join(__dirname, '../../modules/cadastros/domain/carga/__fixtures__');

export const comNcmOficial = (nome: string, texto: string): string =>
  nome === 'produto.csv' ? texto.replace(';2106.90.30;;', ';22021000;0300700;').replace(';21069030;;', ';22021000;0300700;') : texto;
