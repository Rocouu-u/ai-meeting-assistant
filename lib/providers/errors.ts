export class ProviderError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "ProviderError";
    this.statusCode = statusCode;
  }
}
