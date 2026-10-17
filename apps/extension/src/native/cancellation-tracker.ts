import type { HostMessage, HostRequest } from "@contextual/core";

export type CancellationState = Record<
  string,
  {
    kind: "standard" | "custom";
    status: "pending" | "unconfirmed";
  }
>;

/** A successful send is not a successful cancellation. Keep uncertainty visible until Host confirms. */
export class CancellationTracker {
  private cancelled = new Set<string>();
  private requests = new Map<
    string,
    {
      id: string;
      kind: "standard" | "custom";
      status: "pending" | "unconfirmed";
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private changed: (state: CancellationState) => void) {}
  private publish() {
    this.changed(
      Object.fromEntries(
        [...this.requests].map(([jobId, { kind, status }]) => [jobId, { kind, status }]),
      ),
    );
  }
  request(jobId: string, kind: "standard" | "custom"): HostRequest | null {
    const previous = this.requests.get(jobId);
    if (previous?.status === "pending") return null;
    clearTimeout(previous?.timer);
    const request = {
      id: crypto.randomUUID(),
      kind,
      status: "pending" as "pending" | "unconfirmed",
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    request.timer = setTimeout(() => this.unconfirmed(jobId), 30_000);
    this.requests.set(jobId, request);
    this.publish();
    return { id: request.id, jobId, type: kind === "custom" ? "cancelCustom" : "cancel" };
  }
  unconfirmed(jobId: string) {
    const request = this.requests.get(jobId);
    if (!request) return;
    clearTimeout(request.timer);
    request.status = "unconfirmed";
    this.publish();
  }
  private confirmed(jobId: string) {
    clearTimeout(this.requests.get(jobId)?.timer);
    if (this.requests.delete(jobId)) this.publish();
  }
  wasCancelled(jobId: string) {
    return this.cancelled.has(jobId);
  }
  receive(message: HostMessage): boolean {
    if (message.type === "job") {
      if (message.job.status === "cancelled") this.cancelled.add(message.job.id);
      else this.cancelled.delete(message.job.id);
      if (["cancelled", "completed"].includes(message.job.status)) {
        this.confirmed(message.job.id);
        return false;
      }
    }
    const entry = [...this.requests].find(([, request]) => request.id === message.id);
    if (!entry) return false;
    if (message.type === "cancelled") {
      this.cancelled.add(entry[0]);
      this.confirmed(entry[0]);
    } else if (message.type === "error") this.unconfirmed(entry[0]);
    return message.type === "cancelled" || message.type === "error";
  }
  disconnect() {
    for (const jobId of this.requests.keys()) this.unconfirmed(jobId);
  }
  dispose() {
    for (const request of this.requests.values()) clearTimeout(request.timer);
    this.requests.clear();
    this.cancelled.clear();
  }
}
