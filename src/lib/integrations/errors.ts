/** A provider API call failed. `status` is the HTTP status, when there was one. */
export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "IntegrationError";
  }

  /** The provider rejected the credentials: the user must reconnect. */
  get needsReauth(): boolean {
    return this.status === 400 || this.status === 401;
  }
}
