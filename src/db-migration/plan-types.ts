export interface PlanStep {
  index: number;
  description: string;
  sql: string;
  hazardLevel: 'none' | 'warning' | 'destructive';
  transactional: boolean;
  hazards?: Array<{
    type: string;
    message: string;
  }>;
  timeoutMs?: number;
  lockTimeoutMs?: number;
}


export interface Plan {
  steps: PlanStep[];
  stats: {
    totalSteps: number;
    warnings: number;
    destructive: number;
  };
}
