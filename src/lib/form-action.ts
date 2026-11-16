import { CustomerConnectionError } from "./customer-connection";
import { ValidationError } from "./validation";

/** Result of a form's server action, for `useActionState`. */
export interface FormState {
  error?: string;
  message?: string;
}

/**
 * Runs a form action, turning expected failures into a message for the form.
 * Anything else (including Next's redirect/notFound signals) is rethrown.
 */
export async function runFormAction(
  action: () => Promise<FormState | void>,
): Promise<FormState> {
  try {
    return (await action()) ?? {};
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    if (error instanceof CustomerConnectionError) {
      return { error: "This customer is not available." };
    }
    throw error;
  }
}
