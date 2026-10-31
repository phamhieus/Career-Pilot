export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const unauthorized = () => new AppError(401, 'unauthorized', 'Sign in required');
