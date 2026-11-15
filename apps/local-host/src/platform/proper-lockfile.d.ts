declare module "proper-lockfile" {
  export function lock(
    path: string,
    options: {
      realpath: boolean;
      stale: number;
      update: number;
      retries: { retries: number; factor: number; minTimeout: number; maxTimeout: number };
      onCompromised: (error: Error) => void;
    },
  ): Promise<() => Promise<void>>;
}
