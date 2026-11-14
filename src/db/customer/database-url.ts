import { requireEnv } from "@/db/env";

const CUSTOMER_DATABASE_NAME =
  /^customer_[0-9a-f]{8}(_[0-9a-f]{4}){3}_[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Whether `name` follows the customer-database naming convention. */
export function isCustomerDatabaseName(name: string): boolean {
  return CUSTOMER_DATABASE_NAME.test(name);
}

/**
 * Throws unless `name` follows the naming convention. Database names are
 * interpolated into DDL and connection strings, so nothing else may pass.
 */
export function assertCustomerDatabaseName(name: string): void {
  if (!isCustomerDatabaseName(name)) {
    throw new Error(`Not a customer database name: ${JSON.stringify(name)}`);
  }
}

/** Database name for a customer: `customer_<uuid with underscores>`. */
export function customerDatabaseName(customerId: string): string {
  if (!isUuid(customerId)) {
    throw new Error(`Not a customer id: ${JSON.stringify(customerId)}`);
  }
  return `customer_${customerId.toLowerCase().replaceAll("-", "_")}`;
}

/**
 * Connection string for a customer database: the control-plane server and
 * credentials from DATABASE_URL, with the database swapped.
 */
export function buildCustomerDatabaseUrl(databaseName: string): string {
  assertCustomerDatabaseName(databaseName);
  const url = new URL(requireEnv("DATABASE_URL"));
  url.pathname = `/${databaseName}`;
  return url.toString();
}
