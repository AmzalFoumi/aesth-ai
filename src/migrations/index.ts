import * as migration_20260703_183348_products_table from './20260703_183348_products_table';

export const migrations = [
  {
    up: migration_20260703_183348_products_table.up,
    down: migration_20260703_183348_products_table.down,
    name: '20260703_183348_products_table'
  },
];
