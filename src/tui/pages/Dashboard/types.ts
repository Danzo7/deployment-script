/** Dashboard-specific types */

export type DetailTab = 'overview' | 'metrics' | 'logs' | 'deploys' | 'domains';
export type ActionMode =
  | 'none'
  | 'confirm-restart'
  | 'confirm-stop'
  | 'confirm-rollback'
  | 'cmd-palette';

export interface DashboardAction {
  type:
    | 'restart'
    | 'stop'
    | 'deploy'
    | 'rollback'
    | 'logs'
    | 'env'
    | 'view-nginx-config';
  appName: string;
  rollbackIndex?: number;
}
