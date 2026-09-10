import { addTraceabilityFields } from '../db/add-traceability-migration.js';
import { Logger } from '../utils/logger.js';

export async function addTraceability() {
  try {
    Logger.info('Starting traceability migration...');
    await addTraceabilityFields();
    Logger.success('Traceability migration completed successfully!');
    Logger.info('All entities now track createdBy and updatedBy fields.');
  } catch (error) {
    Logger.error('Traceability migration failed:', error);
    throw error;
  }
}
