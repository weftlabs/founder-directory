export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  return Boolean(
    secret &&
    (auth === `Bearer ${secret}` ||
      request.headers.get("x-cron-secret") === secret),
  );
}
