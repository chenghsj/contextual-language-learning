/** Admission is serialized separately from execution: a queued input is durable before acknowledgement. */
export class GenerationQueue {
  private admission = Promise.resolve();
  private execution = Promise.resolve();
  private ids = new Set<string>();
  private cancelled = new Set<string>();
  private closed = false;
  async submit<T>(
    id: string,
    prepare: () => Promise<void>,
    run: () => Promise<T>,
  ): Promise<{ completion: Promise<T> }> {
    let release!: () => void;
    const previous = this.admission;
    this.admission = new Promise<void>(done => (release = done));
    await previous;
    try {
      if (this.closed) throw new Error("Native Host connection closed");
      if (this.ids.has(id)) throw new Error("This job is already queued or running");
      this.ids.add(id);
      try {
        await prepare();
      } catch (error) {
        this.ids.delete(id);
        throw error;
      }
      const completion = this.execution
        .then(async () => {
          if (this.closed) throw new Error("Native Host connection closed");
          if (this.cancelled.has(id))
            throw new DOMException("This operation was aborted.", "AbortError");
          return run();
        })
        .finally(() => {
          this.ids.delete(id);
          this.cancelled.delete(id);
        });
      this.execution = completion.then(
        () => {},
        () => {},
      );
      return { completion };
    } finally {
      release();
    }
  }
  cancel(id: string) {
    if (this.ids.has(id)) this.cancelled.add(id);
  }
  close() {
    this.closed = true;
  }
}
