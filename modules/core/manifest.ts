import { defineModule, PERFIS_V1 } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'core',
  versao: '0.1.0',
  descricao: 'Plataforma do tenant: empresa, usuários, perfis, licenças, auditoria, arquivos, exportação LGPD.',
  depende: [],
  // RN-CORE-09: sem o analista de implantação.
  perfis: PERFIS_V1,
  web: { menus: ['Empresa', 'Usuários e perfis'] },
  publica: ['core.empresa.alterada@1', 'core.usuario.alterado@1', 'core.certificado.alterado@1', 'core.ambiente_fiscal.alterado@1'],
  consome: [],
});
