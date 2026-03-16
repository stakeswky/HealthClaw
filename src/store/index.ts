export { HealthStore } from "./HealthStore.js";
export type { StoreStats, UserStats } from "./HealthStore.js";
export {
  createMonthlyAggregate,
  getMonthKeyFromDate,
  isDateInMonth,
  mergeHealthData,
  updateMonthlyAggregateDays,
} from "./aggregation.js";
export type { MonthlyAggregate } from "./aggregation.js";