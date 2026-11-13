import type { Role } from '../db/repositories/users';

/**
 * Who may do what. Packers handle day-to-day scanning; supervisors and admins
 * manage master data and approve exceptions.
 */
export type Action =
  | 'products.edit'
  | 'products.import'
  | 'barcodes.register'
  | 'barcodes.import'
  | 'barcodes.changeStatus'
  | 'orders.create'
  | 'orders.edit'
  | 'users.manage';

const RULES: Record<Action, Role[]> = {
  'products.edit': ['supervisor', 'admin'],
  'products.import': ['supervisor', 'admin'],
  'barcodes.register': ['packer', 'supervisor', 'admin'],
  'barcodes.import': ['supervisor', 'admin'],
  'barcodes.changeStatus': ['supervisor', 'admin'],
  'orders.create': ['packer', 'supervisor', 'admin'],
  'orders.edit': ['supervisor', 'admin'],
  'users.manage': ['admin'],
};

export function can(role: Role, action: Action): boolean {
  return RULES[action].includes(role);
}
