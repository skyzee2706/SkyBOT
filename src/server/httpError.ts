// Error dengan status HTTP; pesannya ditampilkan ke user (lihat error handler di app.ts)
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
