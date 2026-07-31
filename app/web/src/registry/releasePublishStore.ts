import type {RegistryEnvelope, RegistryReleasePublishResponse} from './registryTypes';
import {RegistryMethods} from './registryMethods';

export type ReleasePublishJob = NonNullable<RegistryReleasePublishResponse['job']>;
export type ReleasePublishListener = (publishingHubId: string, job: ReleasePublishJob) => void;

export class ReleasePublishStore {
  private readonly jobs = new Map<string, ReleasePublishJob>();
  private readonly listeners = new Set<ReleasePublishListener>();

  ingest(envelope: RegistryEnvelope): boolean {
    if (
      envelope.type !== 'event'
      || envelope.method !== RegistryMethods.ReleasePublishUpdated
      || !envelope.hubId
      || !envelope.payload
      || typeof envelope.payload !== 'object'
      || Array.isArray(envelope.payload)
    ) return false;
    const job = (envelope.payload as {job?: unknown}).job;
    if (!job || typeof job !== 'object' || Array.isArray(job) || typeof (job as {id?: unknown}).id !== 'string') {
      return false;
    }
    const typed = job as ReleasePublishJob;
    this.jobs.set(this.key(envelope.hubId, typed.id), typed);
    for (const listener of this.listeners) listener(envelope.hubId, typed);
    return true;
  }

  get(hubId: string, jobId: string): ReleasePublishJob | undefined {
    return this.jobs.get(this.key(hubId, jobId));
  }

  subscribe(listener: ReleasePublishListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private key(hubId: string, jobId: string): string {
    return `${hubId}\u0000${jobId}`;
  }
}
