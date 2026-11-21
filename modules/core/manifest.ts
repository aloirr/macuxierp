import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'core',
  versao: '0.1.0',
  descricao: 'Plataforma do tenant: empresa, usuários, perfis, licenças, auditoria, arquivos, exportação LGPD.',
  depende: [],
  perfis: ['administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura'],
  web: { menus: ['Empresa', 'Usuários e perfis'] },
  publica: ['core.empresa.alterada@1', 'core.usuario.alterado@1'],
  consome: [],
});
